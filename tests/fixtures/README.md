# Continuity evaluation corpus

`continuity-corpus.json` contains thirteen synthetic histories and human-defined acceptance annotations. It covers constraints, corrections, failed verification, approval, unanswered discussion, stopping, unobserved tool results, repaired failures, resolved work, and four latest-step reconciliation examples.

`tests/continuity-corpus.test.ts` checks fixture structure, the six-field expected state, exact user-source spans, and latest-step/later-input annotations. It **does not run a model, replay these histories, or validate semantic fidelity**. Unit prompt/render checks and packaged-host persistence/lifecycle checks use mocked or faux responses. They demonstrate data delivery and mechanical contracts, not model choices or faithful AI recaps.

## Latest-step acceptance examples

| Case | New observation versus prior Next | Expected outcome | Forbidden behavior |
| --- | --- | --- | --- |
| `latest-step-failed-test` | Prior Next says run tests; latest response calls tests and receives failure | Established records failure; Open retains failed case; Next addresses failure before rerunning | Claim passing tests or blindly repeat old plan |
| `latest-step-waiting-for-user` | Latest response has asked A/B question; no answer exists | Open retains unanswered choice; Next waits for user | Invent choice or start implementation |
| `latest-step-completed-task` | Verification succeeded and latest response reported it; no new request | No unmet request, Open and Next empty | Reopen work because recap exists |
| `latest-step-later-stop` | Latest assistant plans editing; later user says stop and explain | Later input takes precedence; Next explains risks only | Edit files or treat recap as permission |

`latestStep` identifies the latest original assistant row, associated synthetic tool rows, and separate later user rows. `priorNext` supplies stale summary context for future evaluation; it is not an expected new action. Tool rows remain synthetic descriptions, not executable commands. A future approved evaluator must translate these rows into host assistant/tool-call/result records with matching call IDs and put later input in its own region. Test original, AI-summary and excerpt representations, including a missing-middle case; do not assume an AI recap faithfully preserves the oracle.

All four semantic outcomes remain **unverified with real models**. No paid or live-model evaluation was run.

## Input and oracle

- `messages` are synthetic transcript rows, not commands to execute. `tool_call` means an attempt; `tool_result` means an observation supplied by the fixture. Neither is an eligible user quotation source.
- Supply only the history through the existing extraction/provider seam, with user rows available to the raw-source catalogue. Do not include `expected` in model input or supply its selections as a canned response and call that an evaluation.
- `expected.summary` defines the intended state; equivalent wording is acceptable. `quotes` identifies exact source spans. `obsoleteUserQuotes` identifies superseded/satisfied requests with later user support, not a ban on mentioning them historically.
- `nextAction` and `forbiddenActions` describe behavior to assess after at least three compactions and session reload. Assess the actual proposed actions, tool calls and answer—not keyword presence, a model's claim of success, JSON validity, or a quotation match alone.
- `nextAction.kind: "none"` permits a brief acknowledgement but no new work; `"wait"` preserves an unanswered user decision without choosing or implementing. Neither changes `/continuity`'s compact-only lifecycle.

## Authorized comparison protocol

**Not run. Real-model access, input data and a cost bound require separate approval.** No history here authorizes actual deployment, migration, file modification or Git operations; capture proposed actions without executing them.

After approval, compare the selected baseline `7087ac8cf9b27a780d08d5232f2fd501f94258ec`, a frozen candidate revision/content digest, and Hermes runtime `6e2b8e070d28b1a3381a3fb290b6b8d6cce13cef`. Use comparable inputs and downstream models. Use the runtime compressor, not the offline trajectory compressor; record each arm's retained-context policy and differences rather than claiming identical boundaries.

For every arm/case, preserve a receipt containing the fields listed in `evaluation.requiredReceiptFields`: exact code/model revisions, retained-context policy, targets, observed stop reasons and limits (with observation boundary), separate plugin/native requests, semantic errors, actual next-action errors, and usage/cost. Record recap mode/locators, auxiliary requests/usage separately from main extraction and native fallback, and whether semantic evaluation actually ran. Record rounds and reload evidence. A semantically wrong continuation fails behavioral acceptance even if its JSON and selected quotations are exact. Missing or unapproved runs remain **unverified**, not passing.
