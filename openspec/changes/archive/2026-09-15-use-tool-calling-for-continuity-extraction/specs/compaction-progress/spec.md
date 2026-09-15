## MODIFIED Requirements

### Requirement: Unchanged extraction contract

Switching extraction from raw text JSON to a schema-declared tool call SHALL preserve the summary content contract, budget rules, native-fallback behavior, usage reporting, progress cleanup, and manual `/continuity` flow specified by `continuity-compaction`. The response transport and structural failure taxonomy SHALL reflect the tool protocol: a valid result requires exactly one named continuity tool call whose arguments pass the declared schema. A missing, wrong, or multiple tool response MAY be re-asked at most twice; invalid arguments from the named tool, provider errors, cancellation, truncation, and budget failures SHALL NOT be retried by the extension. Progress SHALL remain one extraction lifecycle across bounded re-asks and SHALL end once on success, fallback, or cancellation.

#### Scenario: Same failure taxonomy

- **WHEN** the streamed response is truncated, omits the named tool through the retry bound, contains a wrong or multiple tool response, or calls the named tool with invalid arguments
- **THEN** the corresponding structural or incomplete failure permits the same native-fallback behavior
- **AND** partial tool arguments or ordinary text are not committed

#### Scenario: Missing tool is re-asked within one progress lifecycle

- **WHEN** the model omits the named continuity tool and a correction attempt is issued
- **THEN** the existing progress widget remains active for the extraction attempt
- **AND** tool-call deltas contribute to the received-response estimate
- **AND** the widget is cleared exactly once after success or exhausted fallback

#### Scenario: Cancellation parity

- **WHEN** the user aborts during the initial or correction streaming call
- **THEN** the run is treated as cancelled without another correction request or extension-started continuation turn
- **AND** the progress widget and timer enter their terminal cleanup state
