## 1. Tool Contract

- [x] 1.1 Define the synthesis-only TypeBox/JSON Schema tool for `{summary, quotes, retire}`, including required fields, allowed enums, non-empty summary strings, semantic-list bounds, structured evidence records, and closed objects; leave quote provenance, evidence record counts, and quote lengths to the existing local evidence checks, and verify the schema is accepted by the installed pi-ai `Tool` type.
- [x] 1.2 Add the mandatory-tool prompt text and a small correction prompt for missing or wrong tool calls; verify no raw assistant text/JSON is treated as a successful extraction path.

## 2. Synthesis Integration

- [x] 2.1 Send the declared tool only in the existing compaction sidecar request while preserving authentication, headers, environment, abort signal, context-budget accounting, `cacheRetention: "none"`, and fresh synthesis session IDs; verify the main agent tool set remains unchanged.
- [x] 2.2 Extract the exact named `ToolCall` from `toolcall_end`/final response events and validate it with pi-ai `validateToolCall()`; verify the old extraction-only `JSON.parse(text)` and duplicate top-level shape checks are no longer needed for tool arguments.
- [x] 2.3 Implement at most two re-asks when the response lacks the named tool or calls a different tool; verify the initial attempt plus two retries, retry exhaustion fallback, and successful retry path.
- [x] 2.4 Immediately fall back for invalid named-tool arguments, provider/auth errors, cancellation, truncation, input-budget failures, semantic/evidence failures, and rendering overflow; verify none of these paths creates an extra repair request or unauthorized continuation.
- [x] 2.5 Keep `selectEvidence()` and rendering checks as host-trust validation after tool-schema validation, and accumulate usage across attempts that receive provider responses; verify valid schema with invalid evidence is disclosed/rejected according to existing rules and successful retry usage is summed.
- [x] 2.6 Count tool-call deltas in progress updates and preserve terminal cleanup; verify success, retry exhaustion, invalid arguments, provider error, cancellation, and native fallback leave no active timer or transient widget.

## 3. Specification and Regression Verification

- [x] 3.1 Extend unit tests with tool-call fixtures covering valid extraction, missing/wrong-tool retries, retry exhaustion, invalid named-tool arguments, evidence rejection, usage accumulation, cache options, truncation, cancellation, provider error, and progress cleanup; verify `npm test` passes.
- [x] 3.2 Run TypeScript validation and verify no new diagnostics or pi-ai peer-API errors with `npm run check`.
- [x] 3.3 Run OpenSpec validation and the existing host/TUI smoke or E2E checks available for manual `/continuity`, `/continuity continue`, automatic compaction, native fallback, reload, and repeated compaction; report deterministic tool-contract results separately from real-model continuation fidelity.
