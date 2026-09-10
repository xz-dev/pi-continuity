## Why

Repeated compaction can weaken the user's requirements, lose the latest unanswered request, or mistake attempted work for completed work. Low independent output limits can also force native fallback; the goal is faithful multi-round continuation, not merely valid JSON or a successfully committed summary.

## What Changes

- Use Hermes Agent's runtime compaction behavior as the primary reference: update a prior working-state summary with new evidence, preserve still-relevant context, track completed actions and their actual outcomes, and keep the latest unfulfilled user input active—including unanswered questions and pending decisions. Use pi-continue as a secondary source for reconciliation examples, evidence boundaries, and filtering plugin-owned continuation messages.
- Replace the fixed 4096-token proposal and its half-budget semantic allocation with a content-scaled summary target, explicitly separate from the SDK/model's actual output limits. Align input, parsing, evidence, and rendered-output safety bounds so an otherwise usable summary is not rejected by a smaller unrelated cap. Retain an aggregate safety ceiling instead of 24 items per category; never silently slice semantic lists.
- Retain the chosen bounded, source-verified quotations of task requirements, acceptance conditions, constraints, and corrections alongside the six-field semantic summary. Borrow Hermes's code-owned supplementation and recovery-guidance principle, without changing the contract to unlimited retention of every user message. The host copies selected original current-branch text; the model does not author canonical quotations or provenance.
- Carry valid prior quotations from their original sources across compactions. Require explicit retirement of obsolete quotations; omission from a model response alone does not retire them. Disclose source-selection, validation, and budget omissions without claiming complete coverage.
- Separate prior state, newly summarized history, split-turn prefix, original-source evidence, and explicit focus. Exclude known plugin-owned continuation messages from extraction so orchestration text cannot become the user's task. Preserve the host's retained recent context and cut point.
- Render essential file-operation context in the summary and retain compatible `readFiles` / `modifiedFiles` details across continuity compactions. Honor host-supplied focus without intercepting ordinary `/compact` or adding command syntax.
- Preserve manual compact-and-continue and Pi-owned automatic scheduling. By explicit user choice, all continuity extraction failures—including empty or truncated output—still permit Pi native fallback; a successful native commit still permits the existing one-time manual continuation. Report degradation without claiming a verified continuity result or guaranteed fallback success.
- Validate actual multi-round continuation with Hermes as the primary behavioral comparator: effective constraints, corrections, unanswered requests, completed work, pending approvals, and next actions. Mechanical schema/source checks and native-fallback frequency are separate measurements, not substitutes for semantic acceptance.

## Capabilities

### New Capabilities

- `continuity-compaction`: Source-verified, budgeted continuity summaries with repeated-compaction update rules, visible degradation, and preservation of the existing manual/automatic lifecycle contract. This is the first specification of an existing product area; it is not a new scheduler or memory subsystem.

### Modified Capabilities

None. The project's main `openspec/specs/` directory is currently empty.

## Impact

- **Baseline:** GitHub `7087ac8cf9b27a780d08d5232f2fd501f94258ec`, the six-field simplified implementation. It is three commits ahead of local `19aa8017e74666ab612cda173db8e79ddd0a231b`; `ac2b2a2` removed the older checkpoint/controls architecture. Implementation must use the simplified behavior, not resurrect the older local design.
- **Reference hierarchy:** Hermes Agent is the user's golden standard because of its reported strong practical performance. Runtime research is pinned to `NousResearch/hermes-agent@6e2b8e070d28b1a3381a3fb290b6b8d6cce13cef`, especially `agent/context_compressor.py`; pi-continue `42fa058aab1f2d9bb3b7768ac304e69f18c3a1e7` is secondary. A reference's reputation or passing unit tests does not establish equivalent behavior in this project.
- **Deliberate host adaptation:** Hermes's terminal-failure protection is not copied: the user explicitly retained Pi native fallback for all extraction failures. Native fallback can make additional model calls and can fail for the same underlying model/auth/context problem. Plugin cancellation and host cancellation remain distinct from permitting fallback.
- **Code surfaces for a later apply:** `internal/continuity-core.ts`; one focused internal evidence helper if needed; `tests/continuity.test.ts`; the existing `scripts/lib/run-pi-continuity-host-e2e.mjs` contract harness; `README.md`.
- **Compatibility:** Keep the public `/continuity` command, ordinary native `/compact`, current model/auth resolution, Pi cut point, usage reporting, native fallback, and existing Node/Pi compatibility floors. Existing sessions without evidence metadata remain readable. New extraction and optional details metadata are internal/versioned, not a revived checkpoint API.
- **Dependencies:** Reuse stock Pi APIs, TypeScript, Node, and the existing Vitest/host checks. No new database, tokenizer package, framework, or provider is required.
- **Planning only:** This change creates planning artifacts. It does not update the old local source to GitHub, edit code, stage changes, or authorize implementation. Existing dirty/untracked work must remain untouched.

## Non-goals

- Retaining every user message in model context indefinitely or guaranteeing that model-selected evidence covers every requirement.
- Reintroducing `/continuity task`, locks, status management, dual `modelExtracted/effective` checkpoints, authorization flags, or branch-state lifecycle handlers.
- Implementing micro-compaction, a long-term-memory/retrieval service, a second automatic summarizer pass, or new automatic continuation/retry ownership. Do not port Hermes's memory database, tail-rewrite scheduler, or pi-continue's artifact/AGENTS.md-writing state machine.
- Treating model-native output limits as unlimited generation, or copying a reference's numeric target without its context and failure behavior.
- Recovering tool-output content already omitted by the host serializer, or treating a preserved historical quotation as fresh authorization.
