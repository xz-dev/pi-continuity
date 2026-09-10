## Why

Automatic compaction can display `Auto-compacting... (escape to cancel)` for a long time with zero feedback: pi-continuity's extraction spends ~99% of that time in one blocking LLM call, and Pi's compaction status indicator is core-owned and not updatable by extensions. Users cannot tell whether the run is alive, which phase it is in, or how large the request is.

## What Changes

- Show a transient, extension-owned progress widget above the editor during continuity extraction (`ctx.ui.setWidget`): current phase, elapsed seconds, and request size (prompt token estimate). Nothing is persisted; the widget is cleared on every exit path.
- Replace the single non-streaming `complete()` extraction call with pi-ai's `stream()` so the widget can report real in-call progress (`receiving summary ~N tokens`) from `text_delta` events. Final message, stop reasons, and validation semantics stay identical to today.
- Guarantee cleanup on all outcomes (commit, failure, cancel, compact-and-retry): progress state is a small explicit state machine with a single cleanup path (`try/finally` plus a `session_compact_failed` backstop listener), including clearing the elapsed-time interval so no ghost updates remain.
- Guard all UI work behind `ctx.hasUI`; print/JSON modes behave exactly as today (no widget, no progress output).
- Add host-level e2e coverage proving the widget lifecycle (shown during extraction, cleared after commit and after failure/cancel) against both supported hosts, alongside updated unit fakes for the streaming dependency.

## Capabilities

### New Capabilities

- `compaction-progress`: Transient, non-persistent progress display for continuity compaction extraction: phase + elapsed + request/response size in a widget, driven by an explicit lifecycle state machine with guaranteed cleanup, plus real token-level progress via streaming extraction. Distinct from `continuity-compaction` (summary content); this change covers only extraction-time user feedback.

### Modified Capabilities

None. The project's main `openspec/specs/` directory is currently empty; `continuity-compaction` is still an unarchived delta under `preserve-compaction-intent` and is not restated here.

## Impact

- **Code surfaces for a later apply:** `internal/continuity-core.ts` (synthesize + extension wiring), `internal/continuity-evidence.ts` only if a phase needs evidence stats (expected unchanged), `tests/continuity.test.ts` (streaming fakes), `tests/fixtures` / host harness usage in `scripts/lib/run-pi-continuity-host-e2e.mjs` flows, `README.md`.
- **APIs:** `ContinuityDependencies` gains a streaming entry point (`stream` from `@earendil-works/pi-ai/compat`); the `complete` dependency may be retained or dropped depending on final wiring (decided in design). No change to the extension event contract with Pi (`session_before_compact` result shape is unchanged).
- **Compatibility:** No behavior change in print/JSON mode. Summary content, budgets, validation, fallback rules, and the manual `/continuity` flow are unchanged. Works on both supported hosts (xz-dev/pi and upstream pi) because only stock extension UI APIs are used; `setWorkingMessage` is deliberately NOT used (it cannot update the core compaction indicator).
- **Dependencies:** No new packages. Uses existing `stream()`/`AssistantMessageEventStream` from `@earendil-works/pi-ai` compat and stock `ctx.ui.setWidget`.
- **Planning only:** This change creates planning artifacts. It does not edit code or authorize implementation.
