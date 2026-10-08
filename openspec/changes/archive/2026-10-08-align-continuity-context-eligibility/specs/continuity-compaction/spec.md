## ADDED Requirements

### Requirement: Derive continuity from replay-eligible original records

For newly derived continuity content, the extension SHALL admit original records according to Pi's native whole-message history-replay exclusions, not according to whether their text describes success or failure. The extension SHALL additionally exclude otherwise empty messages on every supported host, including older/upstream hosts that retain them. Native comparison checks SHALL distinguish this intentional empty-message difference from unintended divergence. Records excluded by that policy MUST NOT contribute content to history or turn-prefix synthesis input, latest-step selection, auxiliary step-summary input, deterministic recap excerpts, newly collected file information, or content-derived budget estimates. Existing exclusions for extension-owned continuation wrappers SHALL remain in force. Eligibility SHALL constrain which original sources can contribute; it SHALL NOT require lossless reproduction of all eligible content.

The extension SHALL preserve eligible actual tool results, including failures, and original user provenance. Protocol-generated placeholder results MUST NOT become recorded execution evidence. Eligibility filtering MUST NOT mutate the original session, change entry identifiers or compaction boundaries, alter usage accounting, or re-execute arbitrary third-party context hooks. The guarantee SHALL cover fresh derivation from available original records, not claim to cleanse untraceable content already embedded in previous summaries or file details or to change Pi's independently owned native fallback.

#### Scenario: Failed and aborted partial responses are not reintroduced
- **GIVEN** original assistant responses with `error` and `aborted` statuses contain partial text and tool-call arguments that Pi excludes from replay
- **WHEN** continuity prepares extraction and a handoff
- **THEN** neither response contributes to any fresh continuity source projection, derived file path, or content-derived budget
- **AND** both original records remain unchanged in the session

#### Scenario: An execution record is explicitly excluded from context
- **WHEN** a recorded shell execution is marked excluded from context by Pi
- **THEN** continuity does not introduce its command or output into model-visible summaries or recaps
- **AND** an otherwise eligible execution with a failing exit code is not excluded merely because it failed

#### Scenario: A real tool reports a failed test
- **WHEN** an eligible assistant tool call has an actual recorded failed-test result
- **THEN** the eligible call and relevant failure result remain available as continuity source material
- **AND** the failure is not reclassified as a discarded provider response or a successful test

#### Scenario: Host empty-message rules differ between supported versions
- **WHEN** a supported host excludes an otherwise empty message from replay
- **THEN** continuity excludes that message on every supported host, so it does not displace an eligible latest step or acquire invented visible content
- **AND** actual tool results and messages carrying tool calls or required signatures are not treated as empty
- **AND** compatibility checks show each host's native exclusions are covered by continuity's exclusions

#### Scenario: Old history leaves the retained window
- **WHEN** an eligible original message belongs to the region Pi selected for compaction rather than the retained tail
- **THEN** it remains an eligible summarization source
- **AND** absence from the retained window is not treated as a replay prohibition

#### Scenario: A provider changes content representation
- **WHEN** Pi adapts an eligible message's images, reasoning blocks, signatures, or tool-call identifiers for a model
- **THEN** representation changes alone do not exclude the entire original record
- **AND** continuity retains its existing disclosure of uninspected non-text content rather than claiming to have inspected it

#### Scenario: Protocol repair adds a missing-result placeholder
- **WHEN** native request conversion would insert a synthetic missing-result placeholder for an eligible tool call
- **THEN** continuity continues to identify the original call as lacking a recorded result
- **AND** no synthetic result is assigned a source entry, counted as an observed tool failure, or used as proof of execution

#### Scenario: Excluded content is large
- **GIVEN** two snapshots differ only by the size of replay-excluded original output
- **WHEN** continuity computes its own content-derived input and recap budgets
- **THEN** the excluded text does not increase those budgets or trigger an auxiliary recap request
- **AND** the host's raw usage and compaction accounting remain unchanged

#### Scenario: Legacy summary provenance is unavailable
- **WHEN** a previous summary or cumulative file detail lacks per-record provenance
- **THEN** continuity preserves compatible carry-forward behavior without claiming that old content has been sanitized
- **AND** it does not delete valid prior state by guessing which text or paths came from excluded records

## MODIFIED Requirements

### Requirement: Separate source regions without changing retained context

Continuity extraction SHALL distinguish prior summary state, newly summarized history, the prefix of an unfinished turn, original-source evidence, explicit compaction focus, and a separately labeled latest-model-step recap with subsequent user input. It SHALL apply replay eligibility to original source records and exclude known extension-owned continuation messages rather than promote orchestration text into human intent. Replay-eligible content in the unfinished-turn prefix SHALL remain source material for the active request. The extension MUST preserve Pi's retained recent context and compaction cut point rather than introducing its own tail-pruning or replay scheduler. The latest-step recap SHALL supply progress context without becoming an original user quotation source or new execution authority.

#### Scenario: The active request is in a split-turn prefix
- **WHEN** Pi retains the latter part of a long turn while the user's task-defining message falls in the prefix to be summarized
- **THEN** continuity extraction receives that eligible user request as original source material rather than considering only completed earlier turns
- **AND** the extension does not move Pi's retained boundary to implement a separate tail policy

#### Scenario: A plugin continuation message appears in history
- **WHEN** the history includes a message identified by the extension as its own continuation wrapper
- **THEN** it is excluded from task and quotation extraction
- **AND** an actual user's message is not excluded merely because its wording resembles a continuation request

#### Scenario: Recent work has already advanced beyond the old plan
- **GIVEN** older history says tests still need to run and the latest eligible retained model step contains their failing result
- **WHEN** continuity synthesis runs
- **THEN** the synthesis input includes that result as latest-step context separately from older history
- **AND** the extraction policy reconciles Established, Open, and Next against the newer observation

### Requirement: Select one branch-local model step for handoff

The extension SHALL select the latest replay-eligible original recorded assistant response on the current branch at the compaction snapshot, together with available actual tool results matched to that response's tool calls. A compaction boundary MUST NOT exclude an otherwise available eligible original step. Parallel calls in one response SHALL belong to one step. Selection SHALL skip replay-excluded responses even when they are newer or contain partial text, but MUST NOT substitute an earlier successful response for a newer eligible response merely because the eligible step contains a real tool failure or incomplete work. Selection MUST NOT import sibling-branch records or treat an extension message or generated recap as a model step. Missing results, incomplete eligible responses, and unavailable non-text material SHALL be identified without inventing outcomes. Subsequent eligible user messages present in the snapshot SHALL remain separate, newer context and SHALL take precedence over historical next actions, including when replay-excluded assistant records occur between them and the selected step.

#### Scenario: One response calls several tools
- **WHEN** the latest eligible assistant response calls two tools and both results are available
- **THEN** the handoff includes both calls and their correctly matched results as one step
- **AND** it does not include a previous assistant step or an unrelated tool result

#### Scenario: A command was attempted but its result is absent
- **WHEN** the latest eligible step invokes a side-effecting command without an available matching result
- **THEN** the handoff identifies the attempt and missing result
- **AND** it does not claim success or instruct unconditional re-execution

#### Scenario: A later user message stops the work
- **GIVEN** the latest eligible assistant step proposes editing a file
- **WHEN** a subsequent user message in the compaction snapshot says to stop and only explain
- **THEN** the synthesis receives that later input separately
- **AND** the extraction policy gives the explanation request precedence over the historical editing plan

#### Scenario: Repeated compaction without a new model step
- **WHEN** another compaction occurs without a new eligible assistant response and the last eligible original step remains available on the current branch
- **THEN** the handoff is rebuilt from that same original step rather than from the prior generated recap
- **AND** the new summary contains one latest-step recap, without accumulating previous recap sections

#### Scenario: No original model step is available
- **WHEN** the current branch contains no available replay-eligible original assistant response
- **THEN** no excluded response or prior recap is promoted to an original step
- **AND** ordinary continuity extraction proceeds with an explicit unavailable marker rather than a fabricated handoff
- **AND** eligible user input remains available through the ordinary source regions

#### Scenario: Excluded attempts follow a valid step
- **GIVEN** an eligible original tool-use step with its actual result is followed by failed or aborted assistant responses that Pi excludes from replay
- **WHEN** continuity selects the latest step
- **THEN** it selects the eligible tool-use step and its matched actual result
- **AND** the excluded attempts contribute neither recap content nor missing-result counts

#### Scenario: A correction follows an excluded attempt
- **GIVEN** an eligible step is followed by an excluded assistant response and then an original user correction
- **WHEN** continuity prepares the handoff
- **THEN** the correction is retained as subsequent user context
- **AND** it takes precedence over the selected step's historical next action

#### Scenario: An eligible response stopped at its length limit
- **WHEN** Pi admits the latest original length-limited assistant response for replay
- **THEN** continuity selects that response rather than an older successful one
- **AND** its incomplete status remains visible without implying successful completion

### Requirement: Preserve file continuity in model-visible context

Successful continuity compaction SHALL preserve the current branch's available cumulative read and modified file lists in compatible details, and SHALL include a bounded model-visible file section. Newly collected file paths SHALL derive only from replay-eligible original records in the compaction source regions; replay-excluded tool-call arguments MUST NOT add a path merely because an unfiltered host-prepared aggregate contains it. Compatible previous file details SHALL retain their existing carry-forward behavior; the extension MUST NOT claim to sanitize inherited paths whose original provenance is unavailable. File-operation inputs SHALL remain evidence of attempts rather than independent proof of a completed side effect. Modified files SHALL take precedence over read-only files for display. A file present in both categories SHALL be reported as modified, not duplicated. Display omission SHALL NOT remove the available list from persisted file details.

#### Scenario: Files survive a second continuity compaction
- **WHEN** one continuity compaction records edits to `src/config.ts` and another occurs with no new operation on that file
- **THEN** the new continuity result still records that file as modified
- **AND** a native host's decision not to inherit extension-owned file details does not silently erase the extension's own known list

#### Scenario: File display exceeds its budget
- **WHEN** available file paths exceed the display budget
- **THEN** modified paths are considered before read-only paths and omitted path counts are shown
- **AND** the full available compatible file lists remain in details

#### Scenario: An excluded response contains a write call
- **GIVEN** a new path occurs only in a replay-excluded assistant's write-call arguments and an unfiltered host-prepared file aggregate
- **WHEN** continuity builds fresh file details and their visible section
- **THEN** the path is absent from both
- **AND** the call is not treated as an observed write

#### Scenario: An eligible and an excluded record mention the same path
- **WHEN** an eligible original operation and an excluded operation both name the same path
- **THEN** the eligible source still contributes that path
- **AND** filtering does not remove valid file information by subtracting path names associated with excluded records
