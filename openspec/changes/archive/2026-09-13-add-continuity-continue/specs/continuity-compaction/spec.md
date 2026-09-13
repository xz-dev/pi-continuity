## MODIFIED Requirements

### Requirement: Preserve the simplified continuity lifecycle

The extension SHALL make `/continuity` compact-only by default: it requests one manual compaction and MUST NOT enqueue a continuation message or start an assistant turn as a consequence of that command, including after a successful continuity or native-fallback commit. The extension SHALL additionally accept the exact optional command argument `continue`; `/continuity continue` SHALL request the same continuity-owned manual compaction and, after a successful continuity or native-fallback commit, enqueue one hidden extension continuation message and start one assistant turn. This explicit argument SHALL be the only extension command mode that restores the earlier compact-and-continue behavior. Unsupported arguments MUST NOT start compaction and SHALL display `Usage: /continuity [continue]`.

In an otherwise idle session without independently queued work, completion of default `/continuity` SHALL leave the session waiting for the user's next input. Retained `Open` and `Next` items SHALL NOT authorize the default mode to resume work, and invoking either mode SHALL NOT by itself mark historical work complete or clear retained task state. Ordinary `/compact` SHALL remain native; automatic threshold and overflow compaction SHALL remain scheduled by Pi. The extension MUST NOT add configuration, task-lock commands, checkpoint status management, or another continuation/retry scheduler.

#### Scenario: Manual continuity succeeds
- **WHEN** the user requests `/continuity` and its compaction commits successfully
- **THEN** the resulting summary is committed without an extension-enqueued continuation message or extension-started assistant turn
- **AND** an otherwise idle session waits for the user's next input
- **AND** repeated requests while the operation is pending do not duplicate compactions

#### Scenario: Explicit compact-and-continue succeeds
- **WHEN** the user requests `/continuity continue` and its compaction commits successfully
- **THEN** the compaction is committed before the extension enqueues one hidden continuation message
- **AND** the extension starts one assistant turn to continue from the committed summary
- **AND** the hidden continuation is not presented as a new user-authored instruction

#### Scenario: User compacts between tasks
- **GIVEN** the user considers the previous task finished and has not submitted another task or queued work
- **WHEN** the user runs default `/continuity` to prepare context for a new task
- **THEN** the extension compacts context without resuming the previous task
- **AND** a nonempty `Open` or `Next` section does not cause an assistant turn

#### Scenario: A later user request uses retained context
- **GIVEN** a default manual continuity compaction has committed without starting an assistant turn
- **WHEN** the user subsequently submits a new task
- **THEN** Pi can process that input with the committed summary and retained context available
- **AND** the extension does not prepend a hidden request to continue the previous task

#### Scenario: Native fallback succeeds for a manual continuity request
- **WHEN** continuity extraction fails but Pi subsequently commits a native compaction for a pending manual continuity request
- **THEN** default `/continuity` neither enqueues a continuation message nor starts an assistant turn
- **AND** `/continuity continue` enqueues one hidden continuation message and starts one assistant turn after that native commit
- **AND** neither mode claims that source-verified continuity evidence was produced by the native fallback
- **AND** a later manual request can proceed

#### Scenario: Compaction is cancelled or fails
- **WHEN** either manual continuity mode terminates by cancellation or error without a successful commit
- **THEN** no extension continuation message or assistant turn is started
- **AND** a later request can proceed after termination

#### Scenario: Duplicate or stale completion does not affect a later request
- **GIVEN** an earlier manual request has terminated and a newer manual request is pending
- **WHEN** a duplicate success or error notification for the earlier request arrives
- **THEN** the newer request remains guarded against duplicate compaction
- **AND** the stale notification does not enqueue a continuation or start an assistant turn
- **AND** a successful matching `/continuity continue` request starts at most one assistant turn

#### Scenario: Unsupported command argument
- **WHEN** the user supplies an argument other than the exact optional `continue` keyword
- **THEN** the extension displays `Usage: /continuity [continue]`
- **AND** no compaction, continuation message, or assistant turn is started

#### Scenario: Ordinary and automatic compaction retain their owners
- **WHEN** the user requests ordinary `/compact` or Pi initiates threshold or overflow compaction
- **THEN** ordinary `/compact` receives no replacement from this extension
- **AND** automatic compaction can receive a continuity summary without an extension-started turn or additional retry
- **AND** Pi retains responsibility for existing queued work and automatic compact-and-retry behavior

### Requirement: Expose degradation without creating another agent turn

The extension SHALL provide a bounded reason for native fallback and include source/evidence/file coverage information in successful continuity output. Empty output, truncated output, unavailable model/auth, provider failure, and failed structural or budget validation SHALL all permit native fallback rather than being changed into extension-requested cancellation. This does not override an explicit user/host cancellation. Diagnostics SHALL NOT contain raw conversation text, credentials, or full provider responses, and SHALL NOT themselves create an additional model request, continuation, or retry. Pi's native fallback can make its own summarization requests and is not guaranteed to succeed; those requests SHALL NOT be described as reuse of the failed continuity result or as an extra extension retry. Native fallback success SHALL NOT authorize an extension-started assistant turn for default `/continuity`; it SHALL trigger the single explicitly requested continuation only for `/continuity continue`.

#### Scenario: Invalid quotes but useful semantic summary
- **WHEN** the semantic summary is valid but some quotation references fail validation
- **THEN** valid semantic content and remaining valid evidence can still be used
- **AND** the successful summary reports rejected quotations

#### Scenario: Missing model or failed authentication
- **WHEN** continuity synthesis cannot obtain a usable model or authentication
- **THEN** it returns no replacement and reports an unavailable-model or unavailable-auth reason
- **AND** it neither bypasses authentication nor starts a second extension extraction request

#### Scenario: Empty or truncated output permits native fallback
- **WHEN** continuity extraction returns no usable text or a length-truncated response
- **THEN** it does not commit a partial continuity summary or request cancellation solely because of that extraction failure
- **AND** Pi can perform native compaction
- **AND** a successful native commit starts an assistant turn only when the initiating command was `/continuity continue`

#### Scenario: Native fallback also fails
- **WHEN** continuity extraction fails and the same model/auth/context problem prevents Pi's native compaction from committing
- **THEN** no manual continuation starts and no source-verified continuity success is reported
- **AND** the failure is not hidden by a schema pass, fallback attempt, or success-shaped status
