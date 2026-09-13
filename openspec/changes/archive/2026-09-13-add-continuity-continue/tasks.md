## 1. Add the explicit command mode

- [x] 1.1 Update the focused command tests in `tests/continuity.test.ts` to preserve compact-only `/continuity`, reject unsupported arguments with `Usage: /continuity [continue]`, and require `/continuity continue` to enqueue exactly one hidden continuation with `triggerTurn: true` only after matching successful completion; run the focused test before runtime changes and record the expected failure.
- [x] 1.2 In `internal/continuity-core.ts`, parse only the empty argument or exact `continue`, carry the selected mode and cancellation state on the unique pending request, and restore the legacy continuation send only for a matching successful `/continuity continue`; verify the focused test passes.
- [x] 1.3 Extend duplicate, repeated-terminal, stale-callback, cancellation, native-fallback, terminal-error, and synchronous-start-failure unit cases so default mode never continues, explicit mode continues at most once after a successful commit, and later requests remain correctly guarded; run `npm test -- tests/continuity.test.ts` and `npm run check`.

## 2. Preserve both lifecycle contracts on real host seams

- [x] 2.1 Extend `scripts/lib/run-pi-continuity-host-e2e.mjs` with a bounded `/continuity continue` phase that requires a fresh persisted compaction before the hidden continuation triggers the assistant request, and verifies retained summary, quotations, identities, and files remain model-visible; retain all existing default compact-only and explicit-new-task assertions.
- [x] 2.2 Cover explicit-mode native fallback success plus cancellation, failure, duplicate, and at-most-once terminal boundaries without changing ordinary `/compact` or threshold/overflow ownership; run both packed-host commands against the exact CI-pinned host SHAs and inspect the phase-specific faux request receipts.

## 3. Document and verify the opt-in behavior

- [x] 3.1 Update `README.md` to document `/continuity` as compact-only, `/continuity continue` as explicit compact-and-continue, unsupported argument handling, native-fallback semantics, and unchanged `/compact` and automatic-compaction behavior; verify it matches the delta specification.
- [x] 3.2 Run `npm test`, `npm run check`, both CI-pinned packed-host E2Es, `git diff --check`, and `openspec validate add-continuity-continue --strict`; report deterministic/faux-host scope separately from unverified real-model semantic fidelity.
- [x] 3.3 Review the final diff against every acceptance scenario, confirm no configuration, dependency, persisted-schema, built-in `/compact`, or automatic scheduler changes, and present evidence for user acceptance before any spec sync, archive, release, commit, or push.
