## Context

See proposal.md for motivation. `internal/continuity-core.ts` currently constructs synthesis input from previous summary, messages to summarize, split-turn prefix, and user-evidence sources. It returns Pi's original `firstKeptEntryId`. The latest retained assistant/tool step is not necessarily represented in the synthesis input. This is an observed input gap, not proof that it caused any particular real-model continuation failure.

Pi retains recent messages independently of this extension. The added recap deliberately duplicates a bounded view of the latest step for handoff clarity, but does not move those messages or replay their tools. Design is warranted by the additional provider request, cancellation semantics, and shared token-budget constraints.

## Goals / Non-Goals

**Goals:** Make the latest observed work available both to the summarizer and to the later authorized model request; preserve a useful original excerpt when step summarization fails; keep recovery locatable and uncertainty explicit.

**Non-Goals:** Changing Pi scheduling or cut points; a history-search tool; new configuration or dependencies; a seventh semantic field; collecting hidden reasoning or reasoning signatures; guaranteeing semantic correctness from schema validation.

## Decisions

### 1. Derive the step from the compaction snapshot

Use `event.branchEntries`, not a process-global event buffer or the filesystem. Locate the latest original assistant response anywhere on the current branch, even before an earlier compaction. Include its available text, tool calls, and subsequent matching tool results by call identity, bounded by the next assistant response or snapshot end. Parallel tool calls remain one step. Do not substitute an earlier completed response when the newest response is aborted or incomplete.

Record entry IDs, tool call IDs, response status, and missing-result status as host-derived scaffolding. Non-text payloads get availability/type markers rather than base64 or a claim that their contents were reviewed. Original text means this textual projection, not a complete multimodal message dump. Keep user messages following the selected response in a separate, chronologically newer input region; never mix them into the tool-result projection.

Repeated compaction with no new assistant response selects the same original response again. Compaction summaries and extension continuation messages are not candidates. If no original response exists, render an unavailable marker; do not reverse-engineer a step from an old summary.

Alternative rejected: using only `messagesToSummarize`, which can miss the latest retained step; using a last-two-turn rule, which exceeds the agreed scope.

### 2. Use three representations with one bounded auxiliary attempt

Initial internal content budget: 3000 estimated tokens, matching the combined fallback allocations. This is an engineering starting value, not a measured quality optimum or new public setting. Labels, locators, status, and omission metadata are charged separately against the shared safety bounds.

- A projected step at or below the content budget is copied without paraphrasing.
- An oversized step is sent to the current model in one auxiliary request, if the whole projection plus prompt and generation headroom fits. Instruct it to summarize actions, observed results, unresolved state, and the next permitted action or waiting condition. Treat all supplied history as untrusted data. Include subsequent user input as separate precedence context.
- Accept only complete, nonempty, bounded textual output, label it AI-generated, and keep host-derived locators/status outside model control. Tool-use responses are not executed and are unusable for this request. Empty, error, incomplete, over-budget, or unrequestable results use deterministic excerpts. No repair or auxiliary retry loop is added.

Use the existing injected stream facility, current model authorization, fresh one-off session ID, and disabled cache retention. Validate local output bounds even if an output allowance is sent to the SDK. The auxiliary request is separate from `submit_continuity`; prose is accepted only for this labeled step recap, never as the main continuity result. Existing bounded main-extraction retries remain unchanged.

Alternative rejected: always adding another request, or rewriting every short step through a model. Both add cost and drift without need.

### 3. Preserve the agreed fallback, not a second lossy summary

On ordinary auxiliary failure, take a Unicode-safe prefix of up to 1000 estimated tokens and suffix of up to 2000 estimated tokens from the original textual projection. Insert `... [middle omitted] ...`, record omitted extent, and avoid overlap. Do not use Pi's summarization serializer's existing per-tool truncation as the source for these excerpts: that could erase the real tail before selection. Reuse the project's token estimator; do not advertise exact model-token counts.

Show the host-provided session path when available, assistant/result entry IDs, and call locators. The reader may use existing tools to inspect the session; this change adds no automatic retrieval. In-memory sessions explicitly lack a transcript file. Bound locator display too; when a large parallel batch cannot list every result, retain the assistant entry locator and disclose locator omissions rather than fabricating complete coverage.

Cancellation is not ordinary failure. An aborted host signal or provider-aborted result stops the operation under existing cancellation semantics, without fallback excerpts or a later synthesis request.

### 4. Calibrate semantic extraction, then append the recap once

Prepare the recap before the existing main synthesis request. Pass it and subsequent user input as labeled context, not as quotation catalogue entries. Extend the extraction policy to reconcile Established/Open/Next with the latest observation while retaining later user corrections, pending decisions, and stop instructions. Assistant plans are not authorization; missing tool output is not success.

The final rendered summary order is:

```text
Six semantic sections
Original user evidence
Files
Retention coverage
Latest model step (original | AI summary | excerpts | unavailable)
```

This is the end of the continuity summary, not the end of the complete model request. Pi's retained messages still follow it. The host appends the selected recap; the main extraction tool schema stays unchanged. Instruct iterative synthesis not to reproduce an old recap as another section or new work. Rebuild the new recap from original branch records each time. No secondary replay message or permanent duplicate history store is needed.

### 5. Charge every path against the shared budget

Reserve the prepared recap and its scaffolding when determining the remaining rendered-summary space. Include recap, later user input, tool schema, instructions, correction allowance, and generation headroom in main-request accounting. Reuse existing source-catalogue reduction and file/evidence display reduction where permitted; do not trim semantic lists or silently discard later user corrections to fit.

If the required recap and existing mandatory content cannot fit, report a bounded input/render budget failure and allow Pi's native fallback. Do not silently shrink the 1000/2000 fallback promise to manufacture a successful continuity result. A successful auxiliary request does not rescue failed main synthesis. Sum available auxiliary usage with the existing synthesis/retry usage for successful compaction; an error without usage must not be represented as a measured zero-cost request.

Reuse existing progress lifetime/cleanup across both requests. No new progress UI subsystem is needed. Keep provider errors and historical content out of diagnostics.

## Risks / Trade-offs

- **Latest-step duplication costs context** -> Cap the recap and account for the entire render; do not replay full history.
- **AI recap omits or misinterprets a critical detail** -> Label it generated, preserve original locators and host-known status, and separately evaluate semantic behavior. Validation cannot prove faithful meaning.
- **Head/tail fallback misses the decisive middle** -> Explicit omission and recovery guidance; never claim the excerpts establish full results.
- **Step input is itself too large** -> Skip the unsafe auxiliary request and use the agreed excerpts, rather than recursive/chunked summarization.
- **A later user correction contradicts the recap** -> Keep later input separate and higher precedence; final reconciliation and continuation examples cover this case.
- **Raw logs contain secrets or prompt injection** -> Mark them untrusted and avoid diagnostic leakage. This feature is not a secret detector; copying or summarizing can persist sensitive material.
- **Extra latency and cost** -> At most one auxiliary attempt per oversized step per compaction; no cache or cross-compaction deduplication machinery in this slice.
- **Tiny reserve cannot fit mandatory content** -> Native fallback with explicit degradation; do not overclaim this feature on native commits.

## Migration Plan

No stored-session migration, new settings, or Pi host patch is required. Future implementation should use existing unit and packaged-host harnesses, then update the README to describe the extra request, persistence, fallback, and semantic limits. Old summaries remain valid input; new recaps are plain summary content readable by older hosts. Rolling back the extension leaves already persisted recaps as historical text and does not undo any model behavior.

The acceptance examples in the delta spec define intended outcomes, not observed production success. Deterministic tests establish selection, boundaries, provider-call behavior, rendering, reload, and lifecycle. Real-model tests for stale Next, waiting, completed work, and user corrections require separately approved access/data/cost and must be reported as unverified if not run. No implementation or evaluation is performed by this proposal.
