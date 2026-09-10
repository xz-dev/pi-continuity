## Context

See proposal.md — Why. Constraints verified against installed sources (`@earendil-works/pi-coding-agent@0.82.0`, `@earendil-works/pi-ai@0.82.0`):

- `Auto-compacting...` is core's `CompactionStatusIndicator` (kind `"compaction"`); `setWorkingMessage` only updates kind `"working"` (`interactive-mode.js`), so extensions **cannot** relabel the core row. Own surface required.
- `ctx.ui.setWidget(key, lines, { placement })` works in TUI and RPC modes (RPC emits `extension_ui_request` with `widgetLines`; string arrays only). The host e2e harness reads stdout, so widget set/update/clear is directly assertable there.
- pi-ai compat exports `stream(model, context, options)` → `AssistantMessageEventStream` (async iterable of `start/text_delta/.../done|error`, plus `result(): Promise<AssistantMessage>`). `StreamOptions` carries `signal`, `apiKey`, `headers`, `cacheRetention`, `sessionId` — parity with the options pi-continuity already passes to `complete()`.
- `synthesize()` in `internal/continuity-core.ts` spends ~99% of wall time in one `complete()` call; everything before/after is millisecond CPU work.

## Goals / Non-Goals

**Goals:**
- Transient above-editor widget: phase + elapsed seconds + prompt-token estimate, then received-token estimate during streaming.
- Real in-call progress by switching the extraction call from `complete()` to `stream()`.
- One explicit lifecycle state machine; exactly one idempotent cleanup path covering commit / failure / cancel / compact-and-retry.
- Zero behavior change in print/JSON mode and zero change to extraction outcomes.

**Non-Goals:**
- Persisting progress anywhere (session, logs, details metadata).
- Relabeling or replacing core's compaction indicator; no core/fork patch.
- Timeouts, cancel UX changes, progress for native fallback (Pi owns that path), branch-summary progress.
- Per-provider progress guarantees (buffered gateways just show a jump).

## Decisions

### D1: Widget surface (`setWidget`, key `pi-continuity`) — not `setStatus`, `notify`, or core patch

`setWidget` with string lines is the only surface that is (a) visible during compaction, (b) multi-line capable, (c) observable in the RPC-mode e2e harness. `setStatus` was rejected as primary (footer is easy to miss; keep as possible future addition), `notify` is transient toast spam, and patching xz-dev/pi core breaks upstream-host parity. Text-only lines (no component factory) keep RPC mode fully supported.

### D2: Progress as an explicit finite state machine

Programming-thinking model — the lifecycle is event-driven with terminal cleanup invariants, so model it as an FSM instead of scattered boolean flags.

States and transitions. A fresh FSM instance is created per extraction; every path — success, failure, cancel, host failure — MUST terminate in the single terminal state `END`, which clears all progress state (interval stopped, widget cleared) and has no outgoing transitions. After `END` the instance is discarded; nothing stays in or re-enters the compaction lifecycle.

```
                  Begin (session_before_compact accepted, hasUI)
                   |
                   v
              +---------+   Prepared(promptTokens)   +-----------+
              |PREPARING|--------------------------->| AWAITING  |
              +---------+                            +-----------+
                   |                                      |
                   |                           first stream event
                   |                           (start/text_delta)
                   |                                      v
                   |                                 +-----------+
                   |            Delta(chars)         |RECEIVING  |--+
                   |          +--------------------- |           |  | Delta
                   |          |                      +-----------+<-+
                   |          v                               |
                   |     (counter only,                       | StreamEnd
                   |      no transition)                      v
                   |                                   +-----------+
                   |           Rendered(result ready)  |RENDERING  |
                   +---------------------------------- |           |
                   |  (Failed/Cancelled short-circuit) +-----------+
                   |                                      |
                   v                                      v
   any state --Failed/Cancelled/HostFailed--> [ leave() ] --> END (terminal,
                                                              no out-edges,
                                                              instance dropped)
```

Events: `Begin`, `Prepared`, `StreamStart/Delta`, `StreamEnd`, `Rendered`, `Failed`, `Cancelled`, `HostFailed` (`session_compact_failed`).

Invariants (checked by tests):
1. Widget visible AND interval alive ⟺ state ∈ {PREPARING, AWAITING, RECEIVING, RENDERING}; in `END` neither exists.
2. `leave()` (stop interval + `setWidget(key, undefined)` + state→END) is the ONLY cleanup path, is idempotent (no-op from END), and every extraction path reaches it exactly once.
3. `END` is terminal: no transitions out of it; each extraction constructs a new FSM instance, so a stale instance can never be revived (one extraction at a time — Pi serializes compactions).
4. Timer tick and `Delta` only rewrite text inside the current state — they never transition.

Implementation shape: a tiny `createProgress(ui)` closure factory in `internal/continuity-core.ts` (or a new small `internal/continuity-progress.ts` if core grows past ~50 added lines) holding `state`, `startedAt`, `promptTokens`, `receivedChars`. A new instance is created per extraction and dropped after `END`. Rendering: one `setInterval(1000)` recomputing lines, plus immediate recompute on transitions. Deltas bump `receivedChars` only — cheap, no TUI churn. Elapsed + token estimates come from existing `textTokens`.

### D3: Stream consumption — replace `complete()` with `stream()`, keep semantics

- Call `stream(model, { systemPrompt, messages }, { apiKey, headers, env, signal, cacheRetention: "none", sessionId })` with the exact prompt/options synthesized today.
- Async-iterate events: count `text_delta` lengths (and `thinking_delta` separately if present; thinking is not part of the summary text). On iteration end, `await events.result()` for the final `AssistantMessage`.
- Downstream logic is byte-identical: same `stopReason` handling (`aborted`→cancelled, `length`→incomplete-output, non-`stop`→model-error), same text extraction from `content`, same usage from `result.usage`, same validation/failure taxonomy.
- Abort parity: `signal` abort ends iteration with an `error`/`aborted` terminal event; mapped to the existing `"cancelled"` result.
- `ContinuityDependencies`: replace `complete: typeof complete` with `stream: typeof stream` (single call site; keeping both would be a dead dependency — YAGNI). Unit fakes use the exported `createAssistantMessageEventStream()` to push scripted events then `end(finalMessage)`, so existing test scenarios (invalid-json, empty, truncated, provider-error) port mechanically.

### D4: UI wiring points inside `synthesize()`

- `Begin` after the manual/auto gate passes and `ctx.hasUI` is true (no progress object at all when `!hasUI` — zero overhead, zero output).
- `PREPARING`: before budget/evidence work. `AWAITING(promptTokens)`: right before the `stream()` call, with the token estimate from the existing budget loop. `RECEIVING`: first stream event. `RENDERING`: after `result()` resolves, before parse/validate/render-fit. `leave()`: in `finally` of the extraction, plus a `session_compact_failed` listener as backstop (idempotent — covers host-side failures where the handler already returned).
- The backstop listener is registered through a type-narrowed `pi.on` in try/catch: `session_compact_failed` is typed in newer Pi docs but absent from the 0.82 peer-floor type definitions; `pi.on` accepts any event name at runtime, so hosts without the event simply never invoke it and the `finally` path remains the guarantee.
- All UI calls wrapped defensively (try/catch), matching the existing `unavailable()` diagnostics pattern: progress must never break extraction.

### D5: e2e strategy — record widget calls through the harness's fake UI context

The existing `scripts/lib/run-pi-continuity-host-e2e.mjs` drives real pi builds **in-process**: it binds extensions with a proxied `uiContext` (`createNotifier`) that records `notify` and throws on unexpected UI calls. The harness gains a `setWidget` recorder on that proxy, so widget set/update/clear is directly assertable per scenario phase. Add assertions: (1) every manual `/continuity` success shows the preparing → awaiting → rendering phase sequence (RECEIVING may stay unit-level if the faux provider does not stream — see Open Questions) and ends with exactly one clear; (2) failure flows (`invalid-json`/`empty`/`truncated`/`provider-error`) and the `cancel`/`native-failure` flows show the widget then clear it, with native fallback behavior unchanged; (3) ordinary native `/compact` shows no continuity widget; (4) threshold/overflow automatic extractions show the full lifecycle. The proxy's throw-on-unknown surface also proves progress UI failures cannot break extraction (any regression surfaces as a harness assertion failure, not a crash). Unit tests cover FSM invariants with a fake `ui` + fake stream.

## Risks / Trade-offs

- **Gateway buffers SSE (no intermediate deltas)** → Widget shows AWAITING → jump to RENDERING. Acceptable degradation; documented in spec scenario. No mitigation code.
- **Interval left alive by a missed path** → Single `leave()` in `finally` + `session_compact_failed` backstop + idempotence invariant, all unit-tested.
- **`stream()` behavioral differences vs `complete()` on some provider (retries, error mapping inside pi-ai)** → Same pi-ai stack already serves interactive turns; e2e failure phases (`truncated`, `provider-error`) are re-run through the streaming path to prove the failure taxonomy is unchanged.
- **Widget flicker from 1s updates during streaming** → Deltas only bump a counter; text recomputed at 1Hz and on transitions. Trade-off accepted: up to 1s stale numbers.
- **RPC clients that ignore `extension_ui_request`** → Fire-and-forget by protocol; harmless.

## Migration Plan

N/A — additive UX plus an internal call-shape swap. Rollback = revert the commit; no data, session format, or metadata changes (compaction `details` untouched).

## Open Questions

None blocking. (Whether the faux e2e provider can emit slow/chunked SSE to make RECEIVING visible in e2e, or whether RECEIVING coverage stays unit-level, is an apply-time implementation detail that does not change specs, approach, or task breakdown.)
