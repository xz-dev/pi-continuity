## 1. Lock the native eligibility boundary

- [x] 1.1 Add a bounded native-comparison fixture covering normal output, partial `error`/`aborted`, eligible `length`, real failed and empty tool results, context-excluded shell execution, empty text, signatures/tool calls, and later user corrections; verify expected replay survivors with the resolved Pi helpers and record actual package versions.
- [x] 1.2 Record the extension-loader probe on both cached supported hosts showing `pi-ai/api/*` is unavailable to extensions, and confirm the eligibility helper needs no host import beyond the already-loaded public `convertToLlm`; evidence is the probe log plus the packed-extension load in task 4.3.
- [x] 1.3 Implement the local source-eligibility predicate from the design (`convertToLlm`, assistant `error`/`aborted`, strictest empty-content rule); verify singleton decisions match whole-conversation native conversion for non-empty fixtures and are at least as strict for empty ones, original messages remain unchanged, and synthetic missing-result placeholders never become admitted source records.

## 2. Apply eligibility to continuity projections

- [x] 2.1 Route history and split-turn prefix projections through shared eligibility before serialization and content-derived budgeting; verify excluded text markers never reach captured synthesis requests, large excluded text does not change continuity-derived budgets, and eligible old history and the split-turn user request remain present.
- [x] 2.2 Change latest-step selection to the newest eligible original assistant while preserving original call/result matching; verify nonempty `error` and `aborted` attempts are skipped, actual failed tool results and eligible `length` responses survive, unrelated results stay excluded, and no eligible assistant produces the existing unavailable state.
- [x] 2.3 Preserve subsequent user input across skipped assistant records and retain original evidence boundaries; verify stop/correction messages remain newer context, quotation spans and entry IDs still resolve, `firstKeptEntryId` is unchanged, and no filtered branch copy alters provenance.
- [x] 2.4 Exercise short recaps, auxiliary step-summary requests, and head/tail fallback from the eligible projection only; verify excluded markers and fabricated results appear in none of these outputs, missing-result counts describe actual records, and repeated compaction does not recover an excluded step from an old recap.

## 3. Rebuild fresh file contributions

- [x] 3.1 Derive new file-operation sets from eligible history/prefix originals instead of trusting the unfiltered host aggregate; verify an excluded-only write path is absent from both persisted details and visible Files, while a path also mentioned by an eligible operation remains.
- [x] 3.2 Preserve compatible cumulative file details, modified-over-read precedence, and bounded display; verify a second compaction retains prior known files, full details survive display omission, and legacy metadata is not heuristically sanitized or presented as verified execution.

## 4. Reconcile documentation and verify integration

- [x] 4.1 Update README's latest-step and source-filtering descriptions to match the delta, including native-rule/version scope, real tool failures, and legacy limitations; verify no active documentation still promises that the newest replay-excluded assistant must be handed off, and validate this change with `openspec validate align-continuity-context-eligibility --strict`.
- [x] 4.2 Run `npm run check` and `npm test`; completion requires passing results, including existing cancellation, extraction fallback, usage, command ownership, evidence, and rendered-budget regressions without weakening their assertions.
- [x] 4.3 Run the offline supported-host smoke paths `npm run test:e2e:upstream-pi` and `npm run test:e2e:xz-dev-pi`, adding a native-parity phase that checks each host's native survivors appear and its exclusions stay absent in captured continuity requests; verify extension loading and continuity output respect native admission, source IDs/cut point survive, and the extension starts no extra turn. Inspect the runners first and obtain approval before any newly required networked or credentialed operation.
- [x] 4.4 Review all changed source projections against the delta scenarios and report exact checked versions, commands, and residual limits; completion evidence must distinguish deterministic/native-host coverage from unperformed live-model continuation evaluation and must not claim legacy cleanup, universal custom-provider parity, release, or deployment.
