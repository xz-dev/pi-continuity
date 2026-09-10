## Context

See `proposal.md` for motivation and `specs/continuity-compaction/spec.md` for behavior. This design is required because source-backed evidence introduces a persisted data shape and budget/compatibility decisions.

### Baseline decision, based on code rather than file size alone

Use `7087ac8cf9b27a780d08d5232f2fd501f94258ec` from `xz-dev/pi-continuity`. GitHub's compare API reports it is three commits ahead of local `19aa8017e74666ab612cda173db8e79ddd0a231b`, with the local commit as merge base:

1. `ac2b2a2`: simplify continuity workflow;
2. `09959eb`: describe the two-feature product;
3. `7087ac8`: make cache-fixture identity self-contained.

| Surface | Local `19aa801` | Selected `7087ac8` | Decision |
|---|---|---|---|
| Model state | Seven fields, including `forbid/status` | Six fields, including positive and negative `constraints` | Keep six semantic fields |
| `/continuity` | Status and branch-local control commands | Manual compact, then one continuation | Preserve selected behavior |
| Ordinary `/compact` | Replaced by continuity extraction | Native unless selected by pending `/continuity` | Keep native |
| Automatic compaction | Hook supplies summary; Pi owns scheduling | Same ownership | Preserve |
| Persistence | Two state copies, identity/time/provenance/authorization metadata | File-operation details | Add only bounded quote references/coverage |
| State rebuilding | start/tree/compact hooks and branch fold | One before-compact hook, one pending-manual flag | Do not restore state rebuilding |
| Core source size | 610 lines | 190 lines | Smaller because obsolete product responsibilities were removed |
| Tests | Controls/checkpoint semantics | Commit-before-continuation, duplicate/cancel guards, native manual fallback and no automatic continuation | Retain new lifecycle tests; improve retention coverage |

The local locks did prevent rewriting explicitly locked values, but that requires a command/control subsystem. The user's chosen scope is automatic, bounded quotation evidence, not restoring locks. The six-field version is therefore the right base; it is not intrinsically more faithful until this change is applied.

Read-only evidence includes the complete selected core and unit-test files, the simplification commit's host-harness diff, and local Pi `0.82.0` public types/runtime. Stock Pi exposes `event.branchEntries`, `preparation.firstKeptEntryId`, prior summary, split-turn prefix, `fileOps`, `customInstructions`, `estimateTokens`, and read-only session identity/file access. Its context projection sends the summary text, not arbitrary compaction details. Its inspected file accumulator skips prior `fromHook` details. Its serializer clips individual tool results to 2000 characters.

### Primary reference: Hermes runtime, not an offline compressor

The user selected Hermes Agent as the golden standard because of its reported strong practical behavior. Pin this revision's reference to `NousResearch/hermes-agent@6e2b8e070d28b1a3381a3fb290b6b8d6cce13cef`. The relevant path is `ContextCompressor.compress()` and its summary-generation helpers, not the offline trajectory compressor or the default-disabled micro-compaction path. Treat pi-continue `42fa058aab1f2d9bb3b7768ac304e69f18c3a1e7` as supplementary.

| Verified reference behavior | Adaptation here |
|---|---|
| Initial and iterative prompts; update prior still-relevant state rather than accumulate summaries | Two prompt branches, one shared six-field contract |
| Active task means the latest unfulfilled user input, including questions and discussions | Map to `task`, `open`, and `next`; do not invent an extra task-state record |
| Content-scaled summary target; the compressor's auxiliary call deliberately omits `max_tokens` | Separate a soft target from SDK/model limits; remove the plugin's fixed request cap |
| Default lean mode appends code-built user excerpts, identifiers, and recovery guidance | Keep the chosen bounded key-quotation contract, with host-verified source spans and Pi transcript locators |
| Terminal empty/truncated/network failure after applicable fallback can abort summary replacement | Deliberate user-approved difference: all extraction failures still permit Pi native fallback |
| Own head/tail policy, tool demotion, optional micro-compaction, and session-search integration | Do not port these; keep Pi's preparation/cut point and existing session storage |

Hermes's main target uses 20% of estimated content, a 2000-token floor, and a default ceiling of `min(5% of context, 10000)`. This is prompt guidance, not a wire limit or a cap on all appended sections. The inspected website documentation still says 12000; source wins for this pinned comparison. Its lean user block is newest-first and character-bounded, with long-message/straddler truncation; its wording is not proof that every user message survived or that every byte was preserved. Our selection/offset/omission contract remains explicit instead of inheriting that claim.

## Goals / Non-Goals

**Goals:**
- Preserve working-state continuity through actual multi-round continuation, with Hermes as the primary behavioral comparator rather than proof of this implementation's quality.
- Make exactness a code-checked property of selected user-text spans, and keep semantic selection quality explicitly separate.
- Keep source lineage branch-local and reconstructible after restart using Pi's existing session entries.
- Make budget and fallback behavior deterministic and observable without additional agent turns.
- Preserve the simplified command and scheduling contract.

**Non-Goals:**
- General task-state ownership, hard enforcement of user prohibitions, or authoritative interpretation of user intent.
- New settings UI, tokenizer dependency, vector store, history-search tool, background summarization, or mandatory second LLM pass.
- Automatically reconciling the dirty old local checkout with the selected baseline during planning.

## Decisions

### 1. Keep six semantic fields; add a small extraction envelope

Keep `ContinuitySummary` and its six semantic fields. Retain `parseSummary` as the semantic validator; introduce a separate internal extraction validator. The model's new response is exactly:

```ts
{
  summary: {
    task: string,
    doneWhen: string,
    constraints: string[],
    established: string[],
    open: string[],
    next: string[]
  },
  quotes: Array<{
    sourceId: string,
    quote: string,
    kind: "task" | "acceptance" | "constraint" | "correction"
  }>,
  retire: Array<{
    evidenceId: string,
    reason: "superseded" | "satisfied" | "out_of_scope",
    sourceId: string,
    quote: string
  }>
}
```

`quotes` selects new original spans. `retire` explicitly proposes removal of an existing span and cites newer user text supporting that decision. The model cannot set persisted offsets, coverage counters, file lists, evidence identities, schema version, scheduling flags, or arbitrary metadata. There is no `status`, `effective`, or `authorization` field.

Top-level/semantic shape errors invalidate the extraction. Once the envelope and semantic summary are valid, individual malformed quotation/retirement records are rejected independently; they do not destroy useful semantic output or valid carried evidence. Excessive quote/retirement arrays are discarded with rejection counts rather than partially trusting their first entries.

Alternative rejected: a model-written `user_verbatim` array with no source check. Calling a field verbatim does not make it exact. Numeric offsets supplied directly by the model were also rejected: substring matching is easier to generate and verify.

### 2. Build an explicitly bounded source catalogue from raw branch entries

Add `internal/continuity-evidence.ts` for pure source/catalogue/verification/merge helpers; keep model invocation, rendering orchestration, and command lifecycle in `internal/continuity-core.ts`. No global evidence cache or new lifecycle listener is needed.

Take `event.branchEntries` as the immutable source snapshot for this compaction. Inspect the latest compaction on that branch: carry evidence only if that compaction has recognized metadata. Do not skip a native/unknown latest compaction to silently reuse older potentially stale evidence. Eligible source material is raw `type: "message"` entries whose original message role is `user`, using text content only. Do this before `convertToLlm`, which can turn summaries/custom content into user-role transport messages. String content is block index 0; array content uses the original content-array index. Images and non-text blocks are not converted into purported verbatim text.

Use a per-call `Map<sourceId, { entryId, blockIndex, start, end, text, branchOrder }>`; `sourceId` is a host-generated opaque catalogue key such as `s0`. Never interpret it as a path or parse model text into filesystem access.

Candidate order, with exact duplicates removed:
1. Original excerpts for valid evidence from the latest compaction, if its metadata is recognized.
2. The two newest user messages on the current branch, including kept messages, so recent corrections can affect relevance immediately.
3. On bootstrap without recognized metadata, the earliest user message in the prefix being compacted.
4. Newly summarized user text, newest first. With recognized metadata, the range starts at the previous compaction's kept boundary and ends at the new kept boundary; this includes a split turn's user prefix. On bootstrap use the available prefix up to the new boundary.

Before serializing ordinary history or turn-prefix messages, filter only messages identified as this extension's own `CONTINUE_TYPE` custom messages. Reuse the existing identity constant; do not filter raw user text by matching the continuation sentence or broad text prefixes. Keep prior summary, new history, and split-turn prefix as distinct prompt regions, and keep raw-source selection independent of transport-role conversion.

Keep existing Pi serialization for ordinary conversation/tool context; the catalogue is bounded additional source evidence, not a replacement serializer. A block up to 4000 characters is offered intact. For a longer block, offer first and last 2000-character windows separately, with their real offsets and an explicit omitted-middle count. Do not join the windows into a fictitious contiguous quotation. Stop adding windows at the catalogue budget; count unoffered blocks/windows/characters. Previously carried evidence can still be preserved by code even if its catalogue description cannot fit.

If a required kept boundary cannot be located in the branch snapshot, return native fallback with an `invalid-boundary` reason rather than guessing a range. The newest-user catalogue entries can be quoted even if Pi also retains them; this bounded duplication is accepted to protect current corrections without taking over the host's cut point.

Alternative rejected: enumerate every user message without an input budget. The transcript persists, but that does not make its entire contents free to send to the summarizer.

### 3. Resolve quotations by exact matching, then persist only source references

For each proposed quotation:
1. Require an offered source ID, allowed kind, non-empty text, valid Unicode text, and the per-quotation bound. Do not trim, normalize punctuation, change case, or normalize line endings.
2. Match the proposed text inside the offered contiguous source window. If repeated within that window, select the first occurrence deterministically.
3. Calculate absolute UTF-16 `start/end` offsets in the original text block.
4. Copy `originalText.slice(start, end)`; the copied value, not the model's string, is canonical.
5. Generate `id = SHA-256(JSON.stringify([entryId, blockIndex, start, end, copiedText]))` with Node's built-in crypto. Recompute this on rehydration to detect unavailable/altered source text.
6. Deduplicate by the host-generated identity, not paraphrase similarity.

Persist an optional namespace next to compatible file details:

```ts
{
  readFiles: string[],
  modifiedFiles: string[],
  continuity: {
    version: 1,
    evidence: Array<{
      id: string,
      entryId: string,
      blockIndex: number,
      start: number,
      end: number,
      kind: "task" | "acceptance" | "constraint" | "correction"
    }>,
    coverage: {
      mode: "selected",
      basis: "initial" | "carried" | "rebuilt",
      sourceWindowsOmitted: number,
      sourceCharsOmitted: number,
      selectionsRejected: number,
      retirementsRejected: number,
      evidenceBudgetOmitted: number,
      priorUnavailable: number,
      retired: number,
      filesOmitted: number
    }
  }
}
```

This is a bounded evidence index, not the old task checkpoint: no copied semantic state, timestamps, status controls, or authorization metadata. Quote text is rendered in the summary; original text remains in session history. Unknown metadata versions are ignored for evidence, and valid root file lists can still be used. `basis` distinguishes first selection, recognized carry-forward, and rebuilding after a native/legacy/unknown compaction; coverage counts describe this compaction, not a cumulative analytics history.

Rehydration resolves every reference only against current-branch raw user entries, checks offsets and the recomputed identity, and drops invalid references with a count. Never reconstruct a missing quote by copying prior-summary prose. A role of `user` is the stock host's available provenance, not cryptographic proof that no extension injected the message; document this limit.

### 4. Carry previous evidence unless explicitly retired or visibly displaced

The merge starts with revalidated prior evidence. Not mentioning an old quote in `quotes` does not delete it.

A retirement is accepted only when:
- its ID belongs to carried evidence;
- its reason is one of the three defined values;
- its supporting quote passes the same source-window validation;
- the supporting user source is later on the branch than the evidence being retired.

The model must cite an explicit correction, confirmation of completion, or task switch. A later timestamp alone is not a reason; an assistant's claim of completion is not user confirmation. The host proves source/order/exactness, not that the quoted sentence logically implies the proposed retirement. That semantic judgment remains evaluated model behavior, with a conservative prompt. Invalid retirements leave the prior evidence intact and increment a count.

Apply valid retirements, add verified selections, then allocate the evidence budget. Sort by priority (`constraint`/`correction`, then `acceptance`, then `task`), newest source order within a priority class, and stable evidence ID as final tie-breaker. Add whole quotations that fit; skip, count, and identify a bounded set of omitted source references for the remainder. Never take a prefix of a selected quote to force it into the output budget.

Only retained evidence is persisted. A retirement is not a permanent tombstone or global preference. With intact continuity metadata, earlier retired source messages are not rescanned as new input unless still inside the host's newly summarized range. After native fallback/legacy bootstrap, relevance may need to be reassessed from the available branch; disclose that evidence was rebuilt rather than promise an unbroken retention guarantee.

Alternative rejected: require the model to re-emit every old quotation verbatim on every compaction. That wastes output tokens and turns omission into silent deletion. Also rejected: preserve every quotation forever, which fossilizes obsolete tasks.

### 5. Separate a content-scaled target from request limits and safety bounds

Centralize initial constants in the existing core and pass them to evidence helpers. They are explicit starting values for evaluation, not new settings or benchmark-optimal claims. Use the public Pi `estimateTokens` on text-message representations; estimates are not exact tokenizer counts or multilingual guarantees.

Define the following per extraction, using positive finite integer capacities; invalid required context/reserve settings yield `input-budget` rather than guessed capacity:

```text
C = current model contextWindow
R = min(C, preparation.settings.reserveTokens)
G = min(R, positive model.maxTokens if known, otherwise R)
T = estimated tokens of prior summary + newly summarized history + split-turn prefix
    (exclude fixed instructions and the additional source catalogue to avoid counting it twice)
hermesTarget = max(2000, min(floor(0.20 * T), floor(0.05 * C), 10000))
responseTarget = min(hermesTarget, G)
rawTextLimit = 16 * R UTF-16 code units
```

`responseTarget` is approximate guidance for the generated extraction envelope, with semantic state taking priority and concise source selections—not a compulsory output length, a fixed semantic/evidence percentage, or a request `maxTokens`. A complete response above this target remains usable if it passes actual safety/render bounds. Small model/host capacities can lower the adapted target below Hermes's floor. `G` is a preflight allowance, not a promise about provider reasoning/output accounting.

| Bound or policy | Initial value | Purpose / action on excess |
|---|---:|---|
| Plugin request `maxTokens` | Omitted | Let SDK/model limits apply; do not impose the old 2048 or proposed 4096 cap |
| Final rendered summary `R` | Host reserve, default 16384 estimated tokens; at most `C` | One host-derived output allowance, replacing the independent 6144 limit |
| Raw response before parsing | `16 * R`, default 262144 code units | Generous abnormal-response guard, including JSON escaping and selection records |
| Semantic JSON / individual semantic strings | No separate 16000/2000/1000-character gates | Shape/types, shared raw bound, aggregate items, and final rendering already bound these |
| Aggregate semantic items | 128 across all four lists | Replace per-category 24; never silently slice semantic lists |
| Proposed quotes / retirements | 32 records in each array | Discard an oversized evidence array with counts; preserve usable semantic output |
| One selected quotation | 1200 code units | Reject that selection; never shorten it silently |
| Source catalogue | At most 6144 estimated tokens, including labels | Shrink whole-window allocation when input capacity requires it; count omissions |
| Evidence section | At most 1536 estimated tokens and remaining `R` | Count actual escaped text, labels, and source locators; retain whole prioritized quotations |
| File section | At most 512 estimated tokens and remaining `R` | Modified-first display; full available lists remain in details |
| Request headroom | 4096 estimated tokens beyond `G` | Conservative preflight margin; not a second wire limit |

For the normal host defaults, the final allowance is 16384, while the Hermes-like target tops out at 10000. This leaves room for code-appended evidence, file context, and rendering overhead without forcing semantic content into half a small generation cap. Host reserve is a deliberate Pi adaptation, not a number copied from Hermes. It bounds this extension's summary, not the entire future provider prompt: kept messages, tools, other extensions, and subsequent output still consume context and remain subject to Pi's scheduling and provider limits.

Use one plugin `complete` call with current auth, abort signal, disabled cache writes, and a fresh routing session ID as today. Omit the explicit `maxTokens` property. The inspected Pi AI 0.82.0 standard simple-options builder defaults to `model.maxTokens` and clamps against estimated available context; lower-level/provider routes differ. Consequently, omitting the plugin cap does not eliminate native caps or guarantee reasoning models enough visible-output tokens. Verify actual request behavior on both supported hosts/providers instead of treating an options-object assertion as wire proof.

Before calling, estimate the complete serialized request—including system instructions, history, prior summary, prefix, source catalogue, and focus—and require room for `G + 4096`. Remove catalogue windows in reverse allocation priority until this fits, recording omissions. If the base request still cannot fit, return `input-budget` without a plugin model call. Do not port Hermes's extra head/tail middle-truncation policy into Pi's already-prepared history.

After a complete response, enforce the shared raw guard and schema/item bounds. Reject empty, non-normal, or length-truncated output; never repair partial JSON or run a plugin retry. Render semantic sections plus mandatory coverage/recovery scaffolding first. If these alone exceed `R`, return `semantic-budget`. Allocate whole evidence entries and then file display within both their section ceilings and actual remaining `R`; remove file display before evidence if final labelled rendering needs adjustment. Recount the finished output, including omission markers; unresolved overflow yields `render-budget`. Never delete semantic list tails to manufacture success.

Alternatives rejected: fixed 4096 plus a half-budget semantic target; raising generation capacity while retaining smaller unrelated string/render gates; or equating no plugin cap with unlimited backend generation. The 128-item guard and host-derived `R` can still cause fallback; evaluate these cases rather than describing them as lossless.

### 6. Adapt Hermes's state update and prompt regions to six fields

Use an initial-summary instruction when no prior summary exists and an iterative-update instruction otherwise. Both share one schema, source-validation contract, and safety policy; no separate state model or second model pass. The update branch reconciles old entries against new evidence, retaining still-relevant state, moving proven completions out of open work, retaining failure causes, and removing only clearly obsolete information. Do not stack prior summaries as fresh prose layers.

Map the reference's working-state concerns into existing fields:

| Field | Meaning |
|---|---|
| `task` | Latest unfulfilled user input, including questions, decisions, or discussion; explicitly no active request when everything is resolved |
| `doneWhen` | Effective acceptance conditions for that request, including required verification or approval |
| `constraints` | Still-effective positive/negative limits, quantities, exceptions, and explicit corrections |
| `established` | Current verified results, completed actions with outcomes, decisions with reasons, and relevant failed attempts with causes; label uncertainty |
| `open` | Unanswered asks, pending decisions/approvals, blockers, missing tool results, and facts or fixes requiring re-verification |
| `next` | Immediate actions justified by the current unfulfilled request; no invented work or reopening completed historical requests |

Build labelled input regions for prior summary (when present), new history, split-turn prefix, source catalogue/carried evidence, and explicit focus. The prefix can hold the task-defining user message and must not be omitted merely because its later tool loop stays live in Pi. Keep source/data regions separate from summarizer instructions; a quoted user instruction is material to record, not a command for the summarizer to execute. Tool arguments establish an attempt, tool results establish observations, and assistant assertions are not independent verification.

Include concise rules and examples:
- Carry still-effective requirements even if new messages do not repeat them; revalidate conclusions that new evidence invalidates.
- `Use 8080` followed by `Use 8081, not 8080` updates the effective constraint; preserve the reason and propose retirement of obsolete original evidence using the newer user source.
- A test invocation with no successful result is not a pass; a failed test stays unresolved. A formerly passing test affected by new edits needs re-verification.
- `Explain this first; do not change code` makes the explanation current, not the historical implementation plan. Explicit stop/reversal signals supersede canceled work rather than leave it as the next action.
- Implementation complete but verification/approval pending remains open; historical deployment wording is not new permission to deploy.
- A fully satisfied conversation can have no active request and an empty `next`; an unanswered question cannot be dismissed as `None` merely because it is not an imperative.
- Preserve exact path/command/error/value/ID strings required to continue. Let code supply canonical selected original text instead of asking the model to rewrite it as purported verbatim evidence. Do not select secrets; no generic secret-detector or authentication-proof claim is made.
- Prior evidence omitted by the model remains carried; retirement still needs newer validated user-source support. This proves source/order/exactness, not the semantic validity of retirement.

Take pi-continue's item-reconciliation examples and message/evidence separation as supplementary guidance, not its parser's source strings as provenance. Do not copy Hermes's reference-only wrapper literally: its live-tail assumptions and statements that mentioned requests were already addressed can conflict with preserving a genuinely unanswered request here. Preserve historical-versus-current authority without installing a blanket rule that all old asks are complete or persistent memory overrides the user's latest correction.

Append accepted `event.customInstructions` in a separate final focus region. Focus affects detail allocation, not schema, source checks, budget safety, or unrelated effective constraints. Do not introduce `/continuity <focus>`; arguments keep the baseline usage error. Ordinary `/compact <focus>` remains native.

### 7. Render only what the next model actually receives

Render in this order:
1. The existing six semantic sections.
2. `## Original user evidence`, with historical-evidence/selected-coverage wording, source location, kind, and JSON-escaped original text.
3. `## Files`, prioritizing modified paths then read-only paths.
4. `## Retention coverage`, with mechanical omission/rejection counts and at most four omitted source locations.

Even zero counts mean only that no mechanical omission was detected, not that every meaningful requirement was selected. Do not expose checkpoint identity/time/status or `mayStartTurn` metadata. Do not turn section headings into an instruction to continue; the existing lifecycle already provides continuation.

For recovery guidance, use the code-owned `ctx.sessionManager.getSessionFile()` path plus entry/block/span when available. An in-memory session can show session ID and entry ID with a notice that no transcript file is available. The extension does not perform a new read or invent a retrieval tool; ordinary file tooling can inspect an existing JSONL transcript when needed. Bound recovery-reference rendering as part of the total summary budget.

### 8. Preserve cumulative files without assuming native inheritance

Reuse the selected baseline's `fileDetails` set logic. Merge `preparation.fileOps` with validated `readFiles/modifiedFiles` from the latest compaction on the current branch, including extension-owned results. Mark modified as the union of written/edited/prior-modified, remove modified paths from read-only, and sort deterministically.

Do not import private host helpers or patch Pi. Public `estimateTokens` is available, while file formatting can remain a few lines alongside the existing helper. Persist complete available compatible file lists as today; only model-visible display is budgeted. If latest details lack file lists, use available `fileOps` and do not invent historical paths. A preceding native compaction may already have lost some history; this extension cannot promise recovery beyond available data.

### 9. Use bounded outcomes and notifications, not another state machine

Refactor synthesis internally to distinguish success, cancellation, and fallback with a small reason union: `missing-model`, `auth-unavailable`, `model-error`, `empty-output`, `incomplete-output`, `invalid-json`, `invalid-schema`, `semantic-budget`, `input-budget`, `invalid-boundary`, and `render-budget`.

- Valid semantic output with some bad selections: retain good output/prior evidence and include coverage counts; do not trigger native fallback solely for one invalid quote.
- Empty/truncated/invalid semantic output, missing model/auth, provider failure, or exhausted base budget: issue one bounded diagnostic, return `undefined`, and allow Pi native fallback. Do not adopt Hermes's terminal-failure cancellation policy; the user explicitly chose native fallback for all extraction failures.
- Explicit user/host cancellation: return promptly and preserve the existing cancellation guard; do not reinterpret cancellation as permission to continue or as a schema/model failure.
- Use `ctx.ui.notify` for UI and a one-line stderr diagnostic when no UI is available. Include a reason code only, not raw output, prompts, credentials, or full exception strings.
- Do not persist a separate failure ledger, send diagnostic chat messages, start a second plugin extraction, or alter manual callbacks. A native fallback that commits successfully still fulfills the baseline manual callback and continues once.
- Native fallback is a new host summarization path, not repair/reuse of failed plugin text. It may make additional calls/retries and may fail for the same underlying auth/provider/context problem. A fallback attempt is not a successful commit; a native commit is not source-verified continuity output.

### 10. Evaluate behavior, with mechanical checks as separate evidence

Use the same bounded synthetic conversation/task corpus for the selected continuity baseline, this change, and the pinned Hermes runtime. Keep input facts, downstream model, task/environment assumptions, and expected outcomes comparable; record each path's own prompt, retained-context policy, budgets, and defaults rather than claiming identical internals. Primary questions are whether resumed work answers the outstanding request, obeys constraints/corrections, avoids repeating completed actions, and respects pending approval. Similar prompt text or more preserved characters is not the result being tested.

Cover at least three consecutive compactions with a correction between rounds, then JSONL reload and continuation. Include positive/negative constraints; `8080` to `8081`; completed code with failed tests or approval pending; a question/discussion still awaiting a reply; a stop/reversal; an attempted tool call without a success result; a failure later repaired; exact technical literals; and a fully resolved conversation. Test native-gap rebuilding and branch isolation deterministically without treating those tests as semantic proof.

Record, outside runtime state, the corpus/reference/model revisions, model requests, soft targets, actual output/stop reasons, native fallbacks, retained-context and summary sizes, token usage/cost where available, and per-expectation continuation outcomes. Distinguish plugin requests from host-native fallback requests. Report lost effective requirements, wrongly retained obsolete requirements, unanswered asks, repeated completed work, and unjustified next actions explicitly. If repetition is used, report all trials rather than a favorable sample. Do not add a permanent runtime analytics service.

Real-model evaluation requires approval for model cost and any data sent; use synthetic data by default, not private transcripts. Without approved or comparable model runs, deterministic/host checks can be reported as passing but behavioral fidelity and comparison with Hermes remain unverified. No claim of equivalence or improvement follows from Hermes's reported good experience alone.

## Risks / Trade-offs

- **Exact selected text is not complete understanding** → State the selected-coverage contract in docs/output; evaluate real-model task retention separately from deterministic source tests.
- **Model retirement can be semantically wrong despite a real supporting quote** → Require a newer user source, conservative retirement rules, and correction/approval examples; never claim mathematical intent preservation.
- **Catalogue/evidence budgets omit material** → Keep complete excerpts, rank constraints first, disclose omissions, and expose original source locations. Do not label omitted requirements as preserved.
- **Token estimates undercount some languages/models** → Keep raw-size guards and context headroom, use existing host estimation, and preserve provider-error/native fallback. Calibrate budgets with multilingual samples rather than adding a tokenizer package now.
- **Extra prompt/output tokens and file/quote sections reduce compression ratio** → Bound catalogue/display and use one plugin extraction; count native fallback calls separately and compare continuation quality as well as total token cost before changing defaults.
- **No plugin wire cap still permits native truncation or expensive output** → Keep SDK/model limits, complete-output checks, shared parsing/render guards, and actual request/cost evidence; do not describe a soft target as an enforceable provider cap.
- **Native fallback can bypass selected-evidence carry-forward** → Preserve the user's availability choice, visibly distinguish the degraded result, and rebuild after a native gap instead of implying continuous verified lineage.
- **A valid summary can still omit or misinterpret intent** → This does not automatically trigger schema fallback. Fail behavioral acceptance when resumed actions are wrong, even if mechanical checks pass.
- **Persisted references can become unavailable or session text can be edited externally** → Revalidate branch membership, offsets, and content-derived identity on every use; never trust reference metadata alone.
- **User-role entries can be injected by another extension** → Use original session roles, not serialized labels, and document the limit of stock provenance; this is not an extension security sandbox.
- **File continuity through arbitrary native or third-party compactors is not guaranteed** → Carry what is actually available, keep interoperable fields, and avoid promising full-session recovery.
- **Current local checkout is older and dirty** → Treat readiness for the chosen baseline as a prerequisite for later apply; this planning turn performs no pull, reset, overwrite, or branch operation.

## Migration Plan

1. Review these artifacts. Before a later apply, use an implementation workspace whose code reflects `7087ac8` or a reviewed descendant, preserving the current uncommitted cache-test and untracked work. If unavailable, stop and report the baseline mismatch; do not silently implement against the retired seven-field design.
2. Keep old six-section summaries readable. A session with no recognized `details.continuity` bootstraps evidence from available branch messages. Do not migrate/rewrite session JSONL files or old checkpoint/control records.
3. Implement the evidence helper and extraction integration, then budget/file/focus/diagnostic behavior. Keep each step verifiable through the existing test surfaces described in `tasks.md`.
4. Run existing unit/type checks and extend faux-provider host lifecycle checks, including actual outgoing option/request behavior. Perform the behavioral comparison from decision 10 only with approved model access/data/cost; otherwise keep that evidence explicitly pending. No implementation, external model evaluation, or approval for future paid calls is implied by completing these planning artifacts.
5. A rollback of the extension leaves standard summary text and compatible file fields available to Pi; unknown evidence metadata is ignored. No database rollback or new runtime service is involved.

## Evidence References

- Selected core: https://github.com/xz-dev/pi-continuity/blob/7087ac8cf9b27a780d08d5232f2fd501f94258ec/internal/continuity-core.ts
- Selected behavior tests: https://github.com/xz-dev/pi-continuity/blob/7087ac8cf9b27a780d08d5232f2fd501f94258ec/tests/continuity.test.ts
- Baseline comparison: https://github.com/xz-dev/pi-continuity/compare/19aa8017e74666ab612cda173db8e79ddd0a231b...7087ac8cf9b27a780d08d5232f2fd501f94258ec
- Local inspected host: `node_modules/@earendil-works/pi-coding-agent@0.82.0`, `docs/compaction.md`, `dist/core/extensions/types.d.ts`, `dist/core/session-manager.{js,d.ts}`, `dist/core/compaction/{compaction,utils}.js`, and `dist/index.d.ts`.
- Codex bounded user-history retention (local compaction path): https://github.com/openai/codex/blob/16ff14c266179e6a762dc8081e9dab73a96683e0/codex-rs/core/src/compact.rs#L683-L759
- **Primary Hermes runtime:** https://github.com/NousResearch/hermes-agent/blob/6e2b8e070d28b1a3381a3fb290b6b8d6cce13cef/agent/context_compressor.py — active-task template near 1587; target calculation 2896–2897 and default ceiling 638–641/1800–1803; auxiliary call without `max_tokens` 3183–3255; iterative update 3315–3375; failure handling 3448–3514/4391–4416; main pipeline 4587–4675.
- **Primary Hermes code-owned supplementation and its limits:** same pinned file, `_build_verbatim_user_section` 790–818, `_augment_summary_lean` 3103–3114, lean defaults 2259–2271. Its reference-only wrappers near 505/519 assume a different live-tail contract and are not copied literally.
- **Hermes documentation, subordinate to pinned source when inconsistent:** https://github.com/NousResearch/hermes-agent/blob/6e2b8e070d28b1a3381a3fb290b6b8d6cce13cef/website/docs/developer-guide/context-compression-and-caching.md — its 12000 target ceiling differs from source's 10000.
- **Secondary pi-continue:** https://github.com/Tiziano-AI/pi-continue/blob/42fa058aab1f2d9bb3b7768ac304e69f18c3a1e7/assets/system/history_update.md and the same revision's `extensions/continue/index.ts`, `src/blocks.ts`, and `src/model-settings.ts`. Item reconciliation is useful; normalized source/evidence strings are not original-source validation. Active handoff cancellation/proof behavior is not adopted.
- **Inspected SDK output behavior:** local `node_modules/@earendil-works/pi-ai@0.82.0`, `dist/api/simple-options.js:4–14`, plus provider-specific Anthropic/OpenAI request builders. These are read-only evidence, not private import targets. Reverify the supported hosts during apply.
- OpenCode iterative update rules: https://github.com/anomalyco/opencode/blob/57ef3828431790c53f8f333c7ffbfe88770a1812/packages/core/src/session/compaction.ts#L15-L55
- Gemini's verification pass is a comparison, not adopted here: https://github.com/google-gemini/gemini-cli/blob/85aca163f6c73ac6ce380b5447359146b8adcae4/packages/core/src/context/chatCompressionService.ts#L353-L478
