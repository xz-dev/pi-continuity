## Why

Continuity extraction currently asks the model to emit raw JSON text and then relies on local parsing and schema validation. Models that add prose, omit fields, or otherwise return malformed structure trigger `invalid-json` or `invalid-schema`, causing Pi to fall back to native compaction without source-verified continuity retention. Provider-supported tool calling can make the extraction contract explicit and reduce avoidable structural failures without changing the compaction entry contract.

## What Changes

- Make continuity synthesis request a dedicated tool call that fills the existing six-field summary, evidence-selection, and retirement form.
- Require the dedicated tool call as the only successful extraction channel; do not accept arbitrary assistant text or a raw-JSON compatibility result.
- Declare the continuity result with a synthesis-only JSON Schema/TypeBox tool definition and use pi-ai's existing tool-call validator instead of duplicating JSON parsing and shape checks.
- Require the named continuity tool as the only successful extraction channel; if the model does not call it or calls a different tool, re-ask up to two times with an explicit correction prompt.
- Treat invalid arguments from the named tool, provider errors, cancellation, and other non-retryable extraction failures as unavailable and let Pi native compaction continue.
- Preserve the current unavailable/fallback behavior when the retry limit is exhausted or validation fails.
- Preserve `cacheRetention: "none"` and fresh synthesis session IDs; tool definitions must remain local to the one-off synthesis request and must not enter the main agent tool set.

## Capabilities

### New Capabilities

- `tool-based-continuity-extraction`: Generate continuity summaries through a synthesis-only JSON Schema tool call with bounded re-asks and existing fallback guarantees.

### Modified Capabilities

- `continuity-compaction`: Permit up to two extraction re-asks when the required tool is not called, while preserving immediate fallback for invalid tool arguments and other non-retryable failures.

## Impact

- `internal/continuity-core.ts`: tool schema construction, existing pi-ai tool validation, response extraction, bounded retry classification, and progress accounting.
- `tests/continuity.test.ts`: tool-call success, validator failures, missing/wrong-tool retries, retry exhaustion, streamed tool-call events, and fallback coverage.
- `@earendil-works/pi-ai` peer API: relies on existing `Context.tools`, `ToolCall`, and `validateToolCall()`; no dependency version change is planned.
- Compaction cache behavior: every synthesis attempt remains an uncached one-off request; retries may add up to two additional synthesis requests but do not change main-session prompt caching.
