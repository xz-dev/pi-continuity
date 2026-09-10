## 1. Progress state machine

- [x] 1.1 Implement the progress FSM per design D2 (states PREPARING/AWAITING/RECEIVING/RENDERING plus terminal END with no out-edges; fresh instance per extraction, discarded after END; single idempotent `leave()` cleanup that stops the interval and clears widget key `pi-continuity`; text-only lines with phase + elapsed + token estimates). Verify: new unit tests pass asserting invariants 1-4 with a fake `ui` that records `setWidget` calls (`npx vitest --run`).
- [x] 1.2 Add FSM unit tests for terminal outcomes — success, failure, cancel, and `session_compact_failed` backstop — each ending with widget cleared and interval stopped. Verify: tests fail if `leave()` is skipped or called non-idempotently.

## 2. Streaming extraction

- [x] 2.1 Replace the `complete()` call in `synthesize()` with pi-ai compat `stream()` per design D3: same prompt/options (`signal`, `apiKey`, `headers`, `env`, `cacheRetention: "none"`, `sessionId`), count `text_delta`/`thinking_delta` lengths into the progress object, final message via `result()`. Verify: `npm run check` (tsc) passes and existing extraction unit tests still pass.
- [x] 2.2 Swap `ContinuityDependencies.complete` for `stream` and port unit fakes to `createAssistantMessageEventStream()` pushing scripted events; port the invalid-json / empty / truncated / provider-error scenarios. Verify: the ported failure-taxonomy tests produce the exact same failure reasons as before (`npx vitest --run`).
- [x] 2.3 Verify stop-reason parity through the stream: aborted → `"cancelled"`, `length` → incomplete-output, non-`stop` → model-error, usage taken from `result().usage`. Verify: dedicated unit tests for each mapping pass.

## 3. UI wiring

- [x] 3.1 Wire the FSM into the extension per design D4: `Begin` only when `ctx.hasUI`, phase transitions at the listed points, `leave()` in `finally` plus a `session_compact_failed` listener, all UI calls in try/catch. Verify: unit test with `hasUI: false` proves zero `setWidget` calls; `hasUI: true` shows the phase sequence preparing → awaiting → receiving → rendering → cleared.

## 4. Host e2e

- [x] 4.1 Add a success-path scenario to the host e2e harness asserting `extension_ui_request` `setWidget` events appear during continuity extraction (phase text present) and a final clear (`widgetLines` undefined) is observed before/after the compaction commit. Verify: `npm run test:e2e:xz-dev-pi` passes the new scenario.
- [x] 4.2 Add a failure-path scenario (reuse an existing faux-provider failure phase such as `invalid-json` or `provider-error`) asserting the widget is shown then cleared and native fallback still commits. Verify: `npm run test:e2e:xz-dev-pi` passes.
- [x] 4.3 Run the full host suite on both supported hosts. Verify: `npm run test:e2e:xz-dev-pi` and `npm run test:e2e:upstream-pi` both pass (RECEIVING-phase coverage may stay unit-level if the faux provider cannot stream — see design Open Questions note).

## 5. Docs and final gate

- [x] 5.1 Document the progress widget (what it shows, that nothing is persisted, buffered-gateway degradation) in `README.md`. Verify: README renders and matches implemented behavior.
- [ ] 5.2 Final gate: `npm run check`, `npx vitest --run`, and both e2e scripts all pass; manual TUI smoke of `/continuity` shows the widget live and gone afterward. Verify: all commands green and manual smoke observed.
