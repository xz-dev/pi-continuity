## MODIFIED Requirements

### Requirement: Separate source regions without changing retained context

Continuity extraction SHALL distinguish prior summary state, newly summarized history, the prefix of an unfinished turn, original-source evidence, explicit compaction focus, and a separately labeled latest-model-step recap with subsequent user input. It SHALL exclude known extension-owned continuation messages rather than promote orchestration text into human intent. The unfinished-turn prefix SHALL remain eligible source material for the active request. The extension MUST preserve Pi's retained recent context and compaction cut point rather than introducing its own tail-pruning or replay scheduler. The latest-step recap SHALL supply progress context without becoming an original user quotation source or new execution authority.

#### Scenario: The active request is in a split-turn prefix
- **WHEN** Pi retains the latter part of a long turn while the user's task-defining message falls in the prefix to be summarized
- **THEN** continuity extraction receives that user request as original source material rather than considering only completed earlier turns
- **AND** the extension does not move Pi's retained boundary to implement a separate tail policy

#### Scenario: A plugin continuation message appears in history
- **WHEN** the history includes a message identified by the extension as its own continuation wrapper
- **THEN** it is excluded from task and quotation extraction
- **AND** an actual user's message is not excluded merely because its wording resembles a continuation request

#### Scenario: Recent work has already advanced beyond the old plan
- **GIVEN** older history says tests still need to run and the latest retained model step contains their failing result
- **WHEN** continuity synthesis runs
- **THEN** the synthesis input includes that result as latest-step context separately from older history
- **AND** the extraction policy reconciles Established, Open, and Next against the newer observation

## ADDED Requirements

### Requirement: Select one branch-local model step for handoff

The extension SHALL select the latest original recorded assistant response on the current branch at the compaction snapshot, together with available tool results matched to that response's tool calls. A compaction boundary MUST NOT exclude an otherwise available original step. Parallel calls in one response SHALL belong to one step. Selection MUST NOT substitute an earlier successful response for a newer failed or interrupted response, import sibling-branch records, or treat an extension message or generated recap as a model step. Missing results, interrupted responses, and unavailable non-text material SHALL be identified without inventing outcomes. Subsequent user messages present in the snapshot SHALL remain separate, newer context and SHALL take precedence over historical next actions.

#### Scenario: One response calls several tools
- **WHEN** the latest assistant response calls two tools and both results are available
- **THEN** the handoff includes both calls and their correctly matched results as one step
- **AND** it does not include a previous assistant step or an unrelated tool result

#### Scenario: A command was attempted but its result is absent
- **WHEN** the latest step invokes a side-effecting command without an available matching result
- **THEN** the handoff identifies the attempt and missing result
- **AND** it does not claim success or instruct unconditional re-execution

#### Scenario: A later user message stops the work
- **GIVEN** the latest assistant step proposes editing a file
- **WHEN** a subsequent user message in the compaction snapshot says to stop and only explain
- **THEN** the synthesis receives that later input separately
- **AND** the extraction policy gives the explanation request precedence over the historical editing plan

#### Scenario: Repeated compaction without a new model step
- **WHEN** another compaction occurs without a new assistant response and the last original step remains available on the current branch
- **THEN** the handoff is rebuilt from that same original step rather than from the prior generated recap
- **AND** the new summary contains one latest-step recap, without accumulating previous recap sections

#### Scenario: No original model step is available
- **WHEN** the current branch contains no available original assistant response
- **THEN** no prior recap is promoted to an original step
- **AND** ordinary continuity extraction proceeds with an explicit unavailable marker rather than a fabricated handoff

### Requirement: Append a bounded latest-step recap to the continuity summary

A successful continuity compaction with an available latest step SHALL append one labeled recap after the existing summary sections, not after Pi's retained messages in the complete model request. Its representation SHALL distinguish original textual records, an AI-generated summary, and deterministic excerpts. The six semantic fields and the dedicated continuity tool envelope SHALL remain unchanged. The recap SHALL contain source locators, identify its content as historical data rather than new instructions, and survive persistence as part of the committed summary. It MUST NOT re-execute tools, append a separate replay message, or change manual or automatic continuation ownership.

#### Scenario: A short step fits
- **WHEN** the latest step's textual representation fits the recap content budget
- **THEN** its available text, tool arguments, and results are copied without model paraphrasing into the recap
- **AND** no auxiliary step-summary request is made

#### Scenario: An oversized step is summarized successfully
- **WHEN** the latest step exceeds the recap content budget and one auxiliary summary request succeeds within the enforced limits
- **THEN** the final recap is labeled as an AI summary and records observed actions, results, unresolved state, and the next permitted action or waiting condition
- **AND** the bounded recap is supplied to continuity synthesis before it produces the six-field result

#### Scenario: The last response asks the user a question
- **WHEN** the latest step asks for a decision and no answer is present
- **THEN** recap summarization and semantic extraction identify waiting for that answer rather than inventing a decision

#### Scenario: Work is already complete
- **WHEN** available history establishes that all requested work is complete and there is no new request
- **THEN** the extraction policy leaves Next empty rather than reopening completed work because a recap exists

#### Scenario: Context is rebuilt after reload
- **WHEN** a successful compaction containing a recap is reloaded and a later authorized request is made
- **THEN** that request receives the recap as part of the committed summary followed by Pi's retained messages
- **AND** default manual compaction has not started an assistant turn merely to deliver it

### Requirement: Recover from step-summary failure with disclosed head and tail excerpts

For an oversized step whose auxiliary summary fails, is empty, incomplete, or over budget, or cannot be requested within the safe input budget, the extension SHALL use the first 1000 and last 2000 estimated tokens of the original textual step with an explicit `...` omission marker and a disclosure of missing middle content. Excerpts SHALL preserve Unicode boundaries, SHALL NOT overlap, and SHALL NOT be described as a complete step or verified outcome. The extension SHALL attach the host-provided session file path when available and entry identifiers with tool-call locators as applicable so the model can inspect original session records if needed. It MUST NOT invent an available transcript file, automatically retrieve it, or add another summary retry for this auxiliary operation.

#### Scenario: The step-summary provider fails
- **GIVEN** an oversized step begins with a tool invocation and ends with a failure result
- **WHEN** its auxiliary summary request fails
- **THEN** the recap contains the bounded original head and tail separated by the omission marker, with recovery locators
- **AND** otherwise valid continuity extraction can still commit without claiming the omitted middle was inspected successfully

#### Scenario: The step itself cannot fit a summary request
- **WHEN** the entire textual step and request headroom exceed the summarizing model's context window
- **THEN** no doomed auxiliary request is sent
- **AND** the deterministic head and tail fallback is used and marked incomplete

#### Scenario: The session has no transcript file
- **WHEN** the session is in-memory and excerpts are needed
- **THEN** the recap retains available entry locators and explicitly states that no transcript file is available
- **AND** it does not promise file-based recovery

#### Scenario: The user cancels compaction
- **WHEN** the host cancellation signal is aborted or the recap provider reports an aborted result
- **THEN** the extension follows its cancellation path rather than turning cancellation into excerpt fallback
- **AND** it makes no subsequent synthesis request or extension-started continuation for that cancelled attempt

### Requirement: Account for recap cost without weakening existing safety bounds

The recap content, labels, locators, subsequent user context, and any auxiliary request SHALL participate in the existing input, output, and rendered-summary safety checks. The head and tail allocations SHALL use the project's token estimator and SHALL be described as estimates, not exact tokenizer counts. The extension MUST NOT silently shrink the promised excerpt allocation, truncate semantic lists, or drop subsequent user corrections to manufacture a successful commit. If mandatory recap and summary content cannot fit, continuity SHALL disclose a bounded budget failure and allow native fallback. Auxiliary generation SHALL use the current model and authorized provider access, contribute available usage to the compaction total, honor cancellation, and remain outside the main agent tool set. A failed main continuity extraction SHALL retain its existing native fallback behavior regardless of recap success.

#### Scenario: The final summary cannot safely contain the fallback
- **WHEN** semantic content, required scaffolding, and the head-and-tail recap cannot fit within the rendered-summary limit
- **THEN** continuity declines the replacement and reports a budget failure instead of silently weakening the recap or semantic state
- **AND** native fallback is not represented as having produced this recap

#### Scenario: Only mechanical validation has run
- **WHEN** deterministic checks verify selection, excerpt boundaries, persistence, request counts, and lifecycle behavior
- **THEN** those results are reported as mechanical coverage
- **AND** AI-summary fidelity and correct continued behavior remain unverified until separately evaluated
