# Continuity evaluation corpus

`continuity-corpus.json` contains nine synthetic histories and human-defined acceptance annotations. It covers constraints, corrections, failed verification, approval, unanswered discussion, stopping, unobserved tool results, repaired failures, and resolved work.

`tests/continuity-corpus.test.ts` checks fixture structure, the six-field expected state, and exact user-source spans. It **does not run a model, replay these histories, or validate semantic fidelity**. The separate host E2E exercises three-round persistence/lifecycle mechanically with a faux provider; it is not a behavioral evaluation of these nine cases.

## Input and oracle

- `messages` are synthetic transcript rows, not commands to execute. `tool_call` means an attempt; `tool_result` means an observation supplied by the fixture. Neither is an eligible user quotation source.
- Supply only the history through the existing extraction/provider seam, with user rows available to the raw-source catalogue. Do not include `expected` in model input or supply its selections as a canned response and call that an evaluation.
- `expected.summary` defines the intended state; equivalent wording is acceptable. `quotes` identifies exact source spans. `obsoleteUserQuotes` identifies superseded/satisfied requests with later user support, not a ban on mentioning them historically.
- `nextAction` and `forbiddenActions` describe behavior to assess after at least three compactions and session reload. Assess the actual proposed actions, tool calls and answer—not keyword presence, a model's claim of success, JSON validity, or a quotation match alone.
- `nextAction.kind: "none"` permits a brief acknowledgement but no new work. It does not change `/continuity`'s compact-only lifecycle.

## Authorized comparison protocol

**Not run. Real-model access, input data and a cost bound require separate approval.** No history here authorizes actual deployment, migration, file modification or Git operations; capture proposed actions without executing them.

After approval, compare the selected baseline `7087ac8cf9b27a780d08d5232f2fd501f94258ec`, a frozen candidate revision/content digest, and Hermes runtime `6e2b8e070d28b1a3381a3fb290b6b8d6cce13cef`. Use comparable inputs and downstream models. Use the runtime compressor, not the offline trajectory compressor; record each arm's retained-context policy and differences rather than claiming identical boundaries.

For every arm/case, preserve a receipt containing the fields listed in `evaluation.requiredReceiptFields`: exact code/model revisions, retained-context policy, targets, observed stop reasons and limits (with observation boundary), separate plugin/native requests, semantic errors, actual next-action errors, and usage/cost. Record rounds and reload evidence. A semantically wrong continuation fails behavioral acceptance even if its JSON and selected quotations are exact. Missing or unapproved runs remain **unverified**, not passing.
