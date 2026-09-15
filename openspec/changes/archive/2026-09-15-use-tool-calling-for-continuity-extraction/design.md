## Context

See proposal.md for motivation. Current continuity synthesis is a separate `stream()` request in `internal/continuity-core.ts`; it asks for raw JSON text, parses it, then applies strict local summary and evidence validation. The installed pi-ai API exposes `Context.tools`, `ToolCall.arguments`, stream tool-call events, and `validateToolCall()`. Provider adapters may repair or partially parse streamed tool arguments, so the host must still use the library validator before accepting a result. Existing compaction and progress contracts require native fallback on extraction failure, no unauthorized continuation, bounded diagnostics, and guaranteed widget cleanup. The synthesis request uses `cacheRetention: "none"` and a fresh session ID.

## Goals / Non-Goals

**Goals:**

- Replace free-form JSON output with one predeclared continuity tool schema.
- Reuse pi-ai's existing tool-call schema validator instead of duplicating JSON parsing and top-level shape checks.
- Re-ask only when the model fails to call the required tool, with a hard maximum of two re-asks.
- Fall back immediately when the required tool is called with invalid arguments or when a non-retryable host/provider failure occurs.
- Preserve evidence provenance checks, rendering budgets, progress cleanup, usage reporting, command semantics, and cache isolation.

**Non-Goals:**

- Do not add a main-session extension tool or expose continuity extraction to the user-facing agent loop.
- Do not change Pi's native compaction, branch summarization, automatic scheduling, or continuation command semantics.
- Do not hand-write a second JSON-schema validator or accept raw assistant JSON/text as a compatibility path.
- Do not add provider-specific strict-mode capability discovery or `toolChoice` mapping; the request uses the declared tool and prompt contract, while the returned call is validated locally.
- Do not retry provider errors, authentication errors, cancellation, input-budget failures, rendering failures, or invalid arguments from an already-called named tool.
- Do not introduce cache warming, stable synthesis sessions, or a general memory system.

## Decisions

### 1. Declare one synthesis-only tool schema

Define a TypeBox/JSON Schema tool for `{summary, quotes, retire}`. The schema contains the existing required summary fields, list item types and bounds, quotation fields and kinds, retirement fields and allowed reasons, and `additionalProperties: false` where supported. Include the schema in every synthesis request and tell the model that calling this named tool is mandatory and ordinary text is not an answer.

Do not register this definition with `ExtensionAPI.registerTool()`: it belongs only to the compaction sidecar request and must not alter the main agent's active tools or prompt-cache prefix.

### 2. Use pi-ai's validator at the acceptance boundary

After each stream completes, find the exact named continuity `ToolCall`. Require one named call as the successful response; missing or differently named calls are protocol failures. Pass the call and the same tool definition to pi-ai's `validateToolCall()`. Its TypeBox validator is responsible for structural validation and argument conversion. Remove the old extraction-only `JSON.parse(text)`, `isRecord`, `hasKeys`, and manual top-level array checks from the result path.

A successful tool-schema validation does not replace `selectEvidence()`: source IDs, quote text, branch membership, offsets, retirement ordering, evidence limits, and coverage remain host-trust decisions. The final semantic and rendering budget checks also remain because they are not JSON-schema concerns.

### 3. Bound correction requests to missing tool calls only

Use at most three synthesis attempts total: initial request plus two correction requests. A correction is triggered only when the completed response has no exact named continuity tool call, including an ordinary text response or a different tool. The correction request reuses the same evidence prompt and appends a short instruction that the named tool is mandatory and no text answer is accepted. Do not send a tool result message or invent an assistant turn; each correction is a fresh sidecar synthesis request.

If an exact named tool call exists but its arguments fail `validateToolCall()`, stop immediately and return the existing unavailable result. Do not ask the model to repair a malformed tool call. Provider/auth errors, cancellation, length truncation, input-budget failure, and render-budget failure also stop without correction. This keeps retries narrowly about protocol compliance rather than turning extraction into a repair loop.

### 4. Accumulate usage across attempts

Keep the final successful tool call's semantic result, but aggregate usage from every synthesis attempt that reached a provider response. This ensures the compaction entry's usage reflects the real cost of a successful retry. If no attempt succeeds, no extension compaction usage is committed; native Pi compaction owns its own usage.

### 5. Keep cache behavior unchanged

Every attempt continues using `cacheRetention: "none"` and a fresh session ID. Adding the tool schema and up to two correction requests increases cost only on extraction failures; it does not change main-session prompt caching or add the synthesis tool to the main agent request. Tests should assert the options on every attempt and the absence of a main-session tool registration.

### 6. Test the smallest meaningful matrix

Use faux stream fixtures for: valid named tool, missing tool then success, missing tool through all retries, wrong tool, named tool with invalid arguments, provider error, cancellation, truncation, evidence rejection after valid schema, usage accumulation, cache options, tool-call progress, and cleanup. Existing semantic corpus and host lifecycle tests remain the evidence for continuation behavior. Mocked tool-schema tests prove protocol plumbing, not real-model semantic retention.

## Risks / Trade-offs

- [Provider does not honor the prompt] The model may answer text instead of calling the tool. -> Re-ask at most twice, then use native fallback.
- [Provider adapter repairs arguments] A malformed stream may become `{}` or another partial object. -> Require the exact named tool and call pi-ai `validateToolCall()` before acceptance.
- [Schema is structurally valid but evidence is false] Tool schema cannot prove quote provenance or retirement correctness. -> Preserve `selectEvidence()` and host-derived evidence checks.
- [Retry cost] A missing tool can consume up to three synthesis requests. -> Restrict retries to protocol-missing responses; never retry provider, auth, cancellation, budget, render, or invalid-argument failures.
- [Input cost] Tool schema adds tokens to every synthesis request. -> Keep synthesis uncached by design and avoid changing the main conversation cache path.
- [Usage drift] A successful retry can under-report cost if only its response usage is stored. -> Aggregate usage across all completed attempts.

## Migration Plan

No persisted-data migration is required. Existing compaction entries remain readable because the committed summary, `details`, usage, and continuity metadata keep their current shapes. Deploy the tool-call synthesis path with bounded missing-tool retries. Roll back by restoring the previous synthesis response extraction and removing the new sidecar tool definition; existing entries remain compatible.

## Open Questions

None that change the selected scope or task breakdown.
