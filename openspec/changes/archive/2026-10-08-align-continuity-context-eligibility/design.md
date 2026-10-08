## Context

See `proposal.md` for motivation and the delta in `specs/continuity-compaction/spec.md` for the behavior contract.

Current source paths have separate views of history:

- `internal/continuity-core.ts:historyText` calls `convertToLlm`, removes assistant thinking, and serializes the result. Both `messagesToSummarize` and `turnPrefixMessages` use it. This does not apply the later native provider replay exclusions.
- `internal/continuity-step.ts:selectLatestStep` selects the final original assistant irrespective of replay eligibility, then matches actual result entries and collects later user input. Its current tests intentionally retain `error`, `aborted`, and `length` responses together.
- `internal/continuity-core.ts:fileDetails` trusts `preparation.fileOps` plus previous compatible details. The inspected host's file collector reads assistant tool-call arguments without checking replay eligibility or observing a result.
- `internal/continuity-evidence.ts:prepareEvidence` relies on original branch entry IDs, ordering, and `firstKeptEntryId`; replacing that branch with a transformed message list would damage provenance and boundaries.

The installed Pi packages inspected during diagnosis report 0.82.0. Their shared native `transformMessages` excludes assistant `error` and `aborted`; `convertToLlm` excludes context-excluded shell executions. Local Pi source at commit `02d10232d` also drops empty messages, with exceptions for actual tool results and required signatures/tool calls. These are version-specific observations, not proof about every host or custom provider. The package declares peers `>=0.82.0`; its declared development coding-agent version and installed version differ, so validation must record actual resolved versions.

`transformMessages` is declared in pi-ai's `./api/*` export, but extensions cannot import it (see Decision 1). It is also a request converter, not an evidence API: it transforms content/IDs and synthesizes missing tool results.

## Goals / Non-Goals

**Goals:**

- Use one small, source-preserving eligibility seam for all fresh continuity projections.
- Keep that seam pinned to the native rule by comparison tests on every supported host, so a host change fails tests instead of silently diverging.
- Preserve original identities, user corrections, actual tool results, source-region boundaries, and existing cancellation/fallback behavior.
- Make native/continuity comparisons and end-to-end request capture prove absence of excluded records without claiming model-semantic fidelity.

**Non-Goals:**

- Reproduce an entire historical provider request, replay third-party `context` hooks, or build a provider registry/framework.
- Change the model's representation of images/reasoning or expose hidden reasoning in summaries.
- Redesign file tracking as a side-effect auditor, clean legacy summaries, rewrite session entries, or change usage accounting.
- Change commands, compaction scheduling, native fallback internals, or publish/deploy this extension.

## Decisions

### 1. Mirror the native whole-message rule locally, pinned by native comparison tests

Extensions cannot import pi-ai's `transformMessages`. Probes on cached upstream `e4c75a7` and xz-dev `21d2fb3` (both 0.85.1) show the extension loader aliases `@earendil-works/pi-ai` to `compat.js`, so `@earendil-works/pi-ai/api/transform-messages` resolves to a nonexistent `compat.js/api/...` path; none of the loader-exposed entry points export the converter.

Add one small source-eligibility predicate. It runs the host's public `convertToLlm` on the single original record, inheriting context exclusions such as `excludeFromContext` and host-specific conversions, then applies native replay's record-local whole-message exclusions: assistant `error`/`aborted`, and empty content as defined by the newest supported host (no meaningful text, reasoning, signature, tool call, or unknown block; tool results are never empty). Representation changes (images, reasoning conversion, ID normalization) and synthetic missing results stay outside the predicate. Return a decision about the original record, never transformed output.

Where checked hosts differ on empty messages (0.82.0 and upstream keep them; xz-dev drops them), continuity applies the approved exclusion on all hosts. This is a specific intentional difference, not a promise to compute the union of every future host's rules. Provider/model-dependent representation changes are not run by this predicate: original signature-bearing records remain eligible under the representation-preservation scenario, while the textual projection still does not expose those signatures.

Tests import the native converter directly, which works outside the extension loader. They compare singleton decisions with whole-conversation native conversion, and the host smoke runner checks each cached host's native survivors against continuity's captured requests. If a supported host makes eligibility history-dependent, stop and revise the seam rather than claiming parity.

Alternatives rejected:

- Hardcode `stopReason === "error"`: misses `aborted`, explicit context exclusion, and version-dependent exclusions, and repeats the original mistaken policy.
- Deep-import the converter by absolute path or bundle a pi-ai copy: machine- and version-specific, and diverges from the running host.
- Serialize the full native transformed history: would admit synthetic results as facts and lose source identity/content distinctions.
- Drop every message absent from the current retained window: destroys the very history compaction needs to summarize.
- Replay arbitrary extension hooks: risks side effects and confuses request-specific rewriting with historical eligibility.

### 2. Filter projections, never the authoritative branch

Use the shared eligibility decision in projection/selection code. `historyText` filters originals before existing LLM conversion and textual projection. History/prefix budgets then follow the filtered text automatically; host `tokensBefore` and measured usage remain untouched.

Keep `branchEntries`, entry IDs, and `firstKeptEntryId` unchanged. User evidence continues to read original text spans with original ordering. Where evidence admission needs the shared eligibility check, apply it inside source selection without renumbering the branch or changing quotation matching. Whitespace-only user content cannot become invented evidence; ordinary user requests must not disappear merely because they follow a failed model request.

For latest-step selection, choose the last eligible original assistant. Match results by original call ID within that step's original response interval; exclude no actual result merely for `isError`. Collect subsequent eligible user messages separately across skipped assistant records, rather than allowing the old `break` on the next raw assistant to hide a later correction. An absent eligible step still uses the existing unavailable state, with user intent available to ordinary extraction.

Auxiliary summaries, short recaps, and head/tail fallbacks all consume this selected projection. They must not rescan raw excluded responses. Filtering must not reclassify a `length` response, failed tool result, or non-text eligible response as successful; preserve status and existing disclosure.

### 3. Recompute fresh file information from eligible source regions

Derive new file-operation sets from eligible original `messagesToSummarize` and `turnPrefixMessages`, using existing host-compatible file-operation extraction semantics. Merge previous compatible file details exactly as cumulative continuity currently requires. Preserve modified-over-read precedence, sorted/deduplicated paths, bounded display, and persisted full lists.

Do not use unfiltered `preparation.fileOps` as the fresh authority, and do not subtract excluded path names from its aggregate: the same path can also occur in an eligible operation. Re-derivation preserves that eligible contribution. A proposed operation remains an attempt, not newly proven success; this change does not add a general tool-outcome interpreter.

Inherited file details and semantic summaries have insufficient per-record provenance to sanitize safely. Carry them forward without a new migration or claims of retroactive cleaning. The guarantee is preventing new contamination from available original records.

### 4. Change the existing latest-step contract explicitly

Update the README policy and replace the conflicting main-spec requirement through this delta's normal sync/archive workflow, not by pretending existing behavior violates its old contract. Split the existing parameterized `error`/`aborted`/`length` test: excluded statuses select an earlier eligible step or none; eligible length-limited responses remain selectable with incomplete status.

Keep the six-field synthesis schema, persisted compatible evidence/file shape, commands, native fallback, and continuation ownership unchanged. No feature flag or new user setting is needed.

### 5. Validate provenance and every model-facing route

Use fake-provider request capture plus the real resolved Pi conversion helpers. Include a fixture with a normal tool-use step and real failed result, followed by nonempty errored and aborted partial responses, a context-excluded execution, and a later user correction. Use unique text/path markers to test absence and retention at each seam.

Required checks:

- Native/continuity eligibility parity, including version-dependent empty content and signature/tool-call exceptions.
- History, split-turn prefix, latest-step choice, auxiliary summary requests, deterministic fallback excerpts, new file details/display, and content-derived budgets.
- Subsequent user corrections across excluded responses; original evidence IDs/spans and compaction cut point unchanged.
- No synthetic result becomes an observed result; failed actual results and eligible length-limited responses survive.
- No eligible assistant, repeated compaction, same-path eligible/excluded operations, inherited compatible file details, and bounded legacy behavior.
- Existing cancellation, fallback, usage, command lifecycle, and host-import smoke tests remain valid.

Tests must report actual resolved package versions. The existing upstream and xz-dev host smoke runners are compatibility gates, not proof of every provider or real-model continuation fidelity. Any networked/credentialed evaluation remains separately authorized.

## Risks / Trade-offs

- **Local rule drifts from a future host** → Native comparison tests and the per-host smoke parity phase fail; update the predicate deliberately rather than loosening the tests.
- **Eligibility becomes context-dependent** → Compare singleton admission against whole-conversation native conversion with fixture IDs; treat divergence as a blocker before accepting the helper.
- **Lost later user corrections after skipping a response** → Separate original result matching from later-user collection and test corrections on both sides of skipped records.
- **File aggregate lacks provenance** → Rebuild fresh contributions; preserve opaque inherited state and document that it is not sanitized.
- **Old summaries already contain excluded text** → Do not promise retroactive cleanup or delete valid prior state heuristically.
- **Native fallback may retain its own source behavior** → Keep fallback ownership unchanged and scope the guarantee to continuity-produced content.
- **Extra native conversion work per source record** → Keep the helper linear in source content and reuse its decisions within one preparation where needed; avoid new caching infrastructure.

## Migration Plan

1. Implement the shared admission seam and regression tests, then route existing projections and fresh file derivation through it.
2. Run type checks, the full deterministic suite, native comparison fixtures, and both existing supported-host smoke paths; record resolved versions and any gate not run.
3. Update README wording during implementation; synchronize the delta into the main spec only through the normal requested OpenSpec workflow. No on-disk session migration or configuration change is required.
4. A later, separately authorized release can ship the change. Rollback is restoring the prior extension version; compatible evidence/file details require no rollback migration. Neither upgrade nor rollback repairs summaries already committed under earlier policies.
