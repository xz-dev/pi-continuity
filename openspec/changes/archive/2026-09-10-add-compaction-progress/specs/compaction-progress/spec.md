## Purpose

Gives users live, transient feedback about what continuity compaction extraction is doing (phase, elapsed time, request/response size) so a long `Auto-compacting...` wait is understandable, without persisting anything or changing the summary itself.

## ADDED Requirements

### Requirement: Progress widget during extraction

While continuity extraction runs for a manual or automatic compaction, the system SHALL display a transient progress widget in the interactive TUI showing the current extraction phase and elapsed time. The widget MUST NOT be written to the session, the summary, or any persisted state.

#### Scenario: Widget shown during automatic compaction

- **WHEN** Pi-scheduled automatic compaction triggers continuity extraction in interactive mode
- **THEN** a progress widget is visible showing the current phase and elapsed seconds, and it updates as phases advance

#### Scenario: Widget shown during manual /continuity compaction

- **WHEN** the user runs `/continuity` and extraction begins in interactive mode
- **THEN** the same progress widget is shown with phase and elapsed time

#### Scenario: No UI in print or JSON mode

- **WHEN** extraction runs in print (`-p`) or JSON mode
- **THEN** no widget or progress output is emitted and behavior matches the pre-change extension

### Requirement: Phase and size information

The widget SHALL identify the extraction phase (preparing, waiting for the model, receiving the model response, validating/rendering) and SHALL include the extraction request size (estimated prompt tokens) once known. While the model response is streaming, the widget SHALL show the estimated received response tokens so the user can see forward progress during the LLM call.

#### Scenario: Waiting phase shows request size

- **WHEN** the extraction prompt has been assembled and the model call has started
- **THEN** the widget shows a waiting-for-model phase with the estimated prompt token count and elapsed time

#### Scenario: Streaming phase shows received tokens

- **WHEN** the model response streams text deltas
- **THEN** the widget updates to a receiving phase showing an estimate of tokens received so far

#### Scenario: Buffered provider degrades gracefully

- **WHEN** the provider or gateway delivers the response non-incrementally (no intermediate deltas)
- **THEN** the widget simply jumps from waiting to the next phase and no error is surfaced

### Requirement: Guaranteed cleanup on every outcome

The progress widget and any update timer SHALL be removed on every terminal outcome — successful commit, extraction failure with native fallback, user cancellation, and Pi compact-and-retry — so no stale progress state remains visible or active afterward.

#### Scenario: Cleared after successful commit

- **WHEN** the continuity compaction commits successfully
- **THEN** the widget and timer are cleared and the footer/widget area returns to its prior state

#### Scenario: Cleared after failure and native fallback

- **WHEN** extraction fails and Pi falls back to native compaction
- **THEN** the widget and timer are cleared and no ghost updates continue

#### Scenario: Cleared after user cancellation

- **WHEN** the user cancels the compaction (escape)
- **THEN** the widget and timer are cleared

#### Scenario: Cleared on compact-and-retry

- **WHEN** an automatic compaction fails with `session_compact_failed` (including will-retry overflow flows)
- **THEN** any progress state for that attempt is cleared before or as the next attempt starts

### Requirement: Unchanged extraction contract

Switching extraction to a streaming model call SHALL NOT change the externally observable extraction outcomes: the summary content contract, budget rules, validation failure reasons, native-fallback behavior, usage reporting, and the manual `/continuity` flow remain as specified by `continuity-compaction`.

#### Scenario: Same failure taxonomy

- **WHEN** the streamed response is truncated, empty, invalid JSON, or fails schema validation
- **THEN** the same failure reasons and native-fallback behavior apply as with the non-streaming call

#### Scenario: Cancellation parity

- **WHEN** the user aborts during the streaming call
- **THEN** the run is treated as cancelled exactly as with the non-streaming call (no continuation turn is started)
