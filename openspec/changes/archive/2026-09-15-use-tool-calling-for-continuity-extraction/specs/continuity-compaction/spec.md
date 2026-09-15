## MODIFIED Requirements

### Requirement: Expose degradation without creating another agent turn

The extension SHALL provide a bounded reason for native fallback and include source/evidence/file coverage information in successful continuity output. Empty output, truncated output, unavailable model/auth, provider failure, failed structural or semantic validation, and exhausted tool-protocol retries SHALL all permit native fallback rather than being changed into extension-requested cancellation. When a synthesis response does not contain the named continuity tool, or contains a different tool, the extension MAY issue at most two additional synthesis requests containing an explicit correction that the named tool is mandatory. A response that contains the named continuity tool but whose arguments fail the declared tool schema SHALL NOT be repaired through another extension extraction request and SHALL fall back immediately. Provider errors, authentication failures, input-budget failures, rendering failures, and explicit cancellation SHALL also bypass re-asks. Diagnostics SHALL NOT contain raw conversation text, credentials, or full provider responses, and SHALL NOT themselves create an additional model request, continuation, or retry. Pi's native fallback can make its own summarization requests and is not guaranteed to succeed; those requests SHALL NOT be described as reuse of the failed continuity result or as an extra extension retry. Native fallback success SHALL NOT authorize an extension-started assistant turn for default `/continuity`; it SHALL trigger the single explicitly requested continuation only for `/continuity continue`.

#### Scenario: Missing tool call is re-asked within the bound

- **WHEN** the synthesis response completes without the named continuity tool
- **THEN** the extension sends a correction request requiring that tool
- **AND** it performs no more than two such re-asks for the extraction attempt
- **AND** it does not accept ordinary text or raw JSON as a successful continuity result

#### Scenario: Retry exhaustion permits native fallback

- **WHEN** the initial synthesis response and both correction attempts do not contain the named continuity tool
- **THEN** the extension reports bounded extraction failure
- **AND** Pi may perform native compaction
- **AND** no extension continuation or assistant turn starts because of the failed extraction

#### Scenario: Named tool arguments fail schema validation

- **WHEN** the named continuity tool is called but its arguments fail the declared tool schema
- **THEN** the extension reports structural extraction failure
- **AND** it does not issue a repair request for that response
- **AND** Pi may perform native compaction

#### Scenario: Non-retryable provider or host failure

- **WHEN** authentication, provider transport, cancellation, input budget, or final rendering fails
- **THEN** the extension follows the existing failure or cancellation path without a correction request
- **AND** progress state and continuation guards remain correctly cleaned up

#### Scenario: Successful extraction after a missing-tool retry

- **WHEN** a correction attempt contains the named tool and its arguments pass tool-schema, semantic, evidence, and rendering validation
- **THEN** the extension commits the continuity compaction normally
- **AND** persisted usage accounts for all synthesis attempts in that successful extraction
- **AND** no extra assistant turn is started unless the initiating command explicitly requested `/continuity continue`

#### Scenario: Native fallback remains distinct from extension retries

- **WHEN** all extension extraction attempts fail and Pi subsequently performs native compaction
- **THEN** the native request is not described as reuse of an extension result or as an extension retry
- **AND** default `/continuity` remains compact-only while `/continuity continue` preserves its existing explicit continuation behavior

#### Scenario: Invalid quotes but useful semantic summary

- **WHEN** the semantic summary is valid but some quotation references fail validation
- **THEN** valid semantic content and remaining valid evidence can still be used
- **AND** the successful summary reports rejected quotations

#### Scenario: Missing model or failed authentication

- **WHEN** continuity synthesis cannot obtain a usable model or authentication
- **THEN** it returns no replacement and reports an unavailable-model or unavailable-auth reason
- **AND** it neither bypasses authentication nor starts a second extension extraction request

#### Scenario: Empty or truncated output permits native fallback

- **WHEN** continuity extraction returns no usable tool call or a length-truncated response
- **THEN** it does not commit a partial continuity summary or request cancellation solely because of that extraction failure
- **AND** Pi can perform native compaction after the bounded missing-tool retry policy, if applicable, is exhausted
- **AND** a successful native commit starts an assistant turn only when the initiating command was `/continuity continue`

#### Scenario: Native fallback also fails

- **WHEN** continuity extraction fails and the same model/auth/context problem prevents Pi's native compaction from committing
- **THEN** no manual continuation starts and no source-verified continuity success is reported
- **AND** the failure is not hidden by a schema pass, fallback attempt, or success-shaped status
