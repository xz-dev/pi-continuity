## Purpose

Provide reliable continuity extraction through a provider-facing tool-call form, reducing avoidable malformed-output failures while preserving local semantic validation, source provenance checks, bounded rendering, and Pi-native fallback behavior.

## ADDED Requirements

### Requirement: Extract continuity state through a dedicated tool form

The continuity extractor SHALL request one dedicated tool call whose arguments contain the complete continuity result: a six-field semantic summary, bounded quotation selections, and bounded evidence retirement decisions. The extractor MUST NOT treat arbitrary assistant prose as a successful tool-form result. The tool form SHALL represent the same semantic fields, evidence kinds, retirement reasons, and safety limits as the existing continuity extraction contract.

#### Scenario: Provider returns a valid continuity tool call

- **WHEN** the provider returns the dedicated continuity tool call with arguments containing a valid summary, quotations, and retirement decisions
- **THEN** the extension validates those arguments locally and commits the resulting continuity summary using the existing rendering and evidence rules
- **AND** the committed compaction retains usage, file details, evidence references, and coverage metadata as before

#### Scenario: Provider returns prose instead of the required tool call

- **WHEN** extraction completes without the dedicated continuity tool call, or returns only ordinary text content
- **THEN** the extension treats extraction as unavailable using the existing bounded failure path
- **AND** Pi may perform native compaction
- **AND** the extension does not commit prose as a continuity summary

### Requirement: Validate the predeclared tool form without provider-specific forcing

The extractor SHALL declare the complete continuity form as the named tool's JSON Schema before every synthesis attempt. It SHALL use the shared pi-ai tool-call validator as the structural acceptance boundary instead of maintaining a second continuity-specific JSON parser or top-level shape checker. It MUST NOT require provider-specific strict-mode discovery, constrained-sampling configuration, or forced-tool-choice mapping. Only one exact named continuity tool call whose arguments pass the declared schema can succeed.

#### Scenario: Named tool arguments match the declared schema

- **WHEN** the response contains exactly one named continuity tool call with structurally valid arguments
- **THEN** the shared pi-ai validator accepts the form
- **AND** continuity applies its existing semantic, evidence, and rendering checks before committing

#### Scenario: Named tool arguments fail the declared schema

- **WHEN** the response contains the named continuity tool but required fields, field types, enums, or closed-object boundaries are invalid
- **THEN** the extractor returns its existing structural failure and permits Pi native fallback
- **AND** it does not ask the model to repair that tool call

#### Scenario: Provider does not call the named tool

- **WHEN** the response contains text, no tool call, a different tool, or multiple tool calls
- **THEN** the extractor re-asks with the same declared tool and an explicit correction, subject to the bounded retry contract
- **AND** no text or partial tool output is committed

### Requirement: Preserve semantic and provenance validation after tool extraction

Tool-call structure SHALL NOT replace local validation. The extension MUST continue to reject malformed or semantically unsafe arguments, including missing or extra fields, empty required strings, duplicate semantic list entries, aggregate item overflow, invalid quotation references, fabricated quotation text, unsupported retirements, and evidence or rendering budget overflow. Rejected quotations or retirements SHALL remain disclosed through existing coverage metadata when the semantic summary itself is usable.

#### Scenario: Structurally valid but semantically invalid arguments

- **WHEN** a tool call contains duplicate list items, an over-limit list, or an empty required field
- **THEN** local validation rejects the continuity result with the existing schema or semantic failure reason
- **AND** Pi may perform native compaction
- **AND** no partial semantic list is silently committed

#### Scenario: Valid summary with rejected evidence selections

- **WHEN** the tool call contains a valid semantic summary and some quotation or retirement records fail source or ordering validation
- **THEN** valid semantic content and valid evidence are retained
- **AND** rejected evidence counts remain disclosed
- **AND** the rejected records do not authorize new work

### Requirement: Preserve compaction, progress, and cache contracts

Switching the extraction response format to a tool call SHALL preserve cancellation handling, `toolUse` handling, usage reporting, progress cleanup, manual `/continuity` behavior, automatic compaction ownership, and native fallback behavior. The synthesis request SHALL remain a separate one-off request with cache retention disabled and a fresh synthesis session identifier. Every bounded retry SHALL preserve those cache options. The dedicated tool definition SHALL NOT be added to the main agent tool set or alter main-session prompt-cache behavior.

#### Scenario: Tool-call extraction is cancelled or fails

- **WHEN** the provider aborts, errors, truncates, emits no usable tool call, returns a different tool, or returns locally invalid tool arguments
- **THEN** the extension reports the corresponding bounded extraction failure or cancellation
- **AND** it does not enqueue an extension continuation or start an assistant turn
- **AND** progress state is cleaned up
- **AND** Pi retains its existing native fallback opportunity

#### Scenario: Tool schema is used during synthesis

- **WHEN** continuity synthesis sends its dedicated tool definition
- **THEN** the synthesis request keeps `cacheRetention: "none"` and a fresh session identifier
- **AND** the tool definition is scoped to that synthesis request only
- **AND** the main conversation's cacheable request prefix and active tool set are unchanged

### Requirement: Verify the tool-call and retry contracts

The implementation SHALL test successful tool-call extraction, streamed tool-call events, missing/wrong/multiple-tool retries, retry exhaustion, tool-schema failure without retry, local semantic and evidence rejection, cancellation, usage accumulation, cache options, and progress cleanup. Tests SHALL distinguish deterministic tool/schema validity from real-model continuation fidelity; passing mocked tests SHALL NOT claim semantic equivalence across providers or real-model retention success.

#### Scenario: Deterministic tool contract tests pass

- **WHEN** faux provider tests emit valid and invalid dedicated tool responses and missing-tool retry sequences
- **THEN** the tests verify argument extraction, shared schema validation, retry bounds, usage, cache options, fallback, and cleanup without requiring network access
- **AND** the result is reported as deterministic contract coverage only

#### Scenario: Real-model behavior is not evaluated

- **WHEN** no approved real-model multi-compaction continuation test has been run
- **THEN** implementation verification reports structural and lifecycle results separately
- **AND** source fidelity and behavioral continuation remain unverified
