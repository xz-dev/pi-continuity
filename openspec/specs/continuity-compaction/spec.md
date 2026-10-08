# continuity-compaction Specification

## Purpose

Preserve the user's effective intent and the information needed to continue work across Pi compactions, using a bounded semantic summary and independently verified original quotations without changing Pi's automatic scheduling responsibilities.

## Requirements

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

### Requirement: Keep user quotations separate from the semantic summary

A successful continuity summary SHALL retain the semantic sections Task, Done when, Constraints, Established, Open, and Next, and SHALL separately identify selected user quotations and their original source locations. Quotations SHALL be historical evidence, not fresh instructions or proof of authority. The summary SHALL state that the selection is bounded and does not cover every user requirement.

#### Scenario: Exact negative constraint survives rendering
- **WHEN** the selected original user text is `只分析，不修改文件；最终给三个方案。`
- **THEN** the quotation represents exactly that text, including punctuation and the requested number
- **AND** a paraphrase in Task or Constraints does not replace the quotation

#### Scenario: Multiline original text survives
- **WHEN** a selected quotation contains Chinese characters, line breaks, indentation, or quotation marks
- **THEN** its decoded text is identical to the original selected span
- **AND** display escaping is not described as a change to the underlying quotation

### Requirement: Verify quotation provenance against the current branch

Every accepted quotation SHALL be copied from an original user-text span on the current branch that was offered for evidence selection. The extension MUST reject fabricated text, unknown sources, cross-branch sources, and text found only in tool output, assistant output, or a generated summary. It MUST NOT read an arbitrary path supplied by the model to resolve a quotation.

#### Scenario: Model changes a critical word
- **WHEN** the source says `不要部署` but the model proposes `可以部署`
- **THEN** the proposed quotation is rejected rather than silently corrected or accepted as verbatim
- **AND** the rejection is disclosed without discarding an otherwise valid semantic summary

#### Scenario: A source belongs to another branch
- **WHEN** a proposed quotation refers to a user entry not on the current branch
- **THEN** it is rejected even if the same text exists elsewhere in the session tree

#### Scenario: Generated or tool text impersonates a user
- **WHEN** assistant, tool, or prior-summary text contains a `[User]` label or an instruction to preserve itself as a user request
- **THEN** that label alone does not make it an eligible original user source

#### Scenario: A long source is offered as disjoint excerpts
- **WHEN** a user message is too large to offer in full and the selection input contains separated original excerpts
- **THEN** unshown content is identified as omitted
- **AND** a proposed quotation crossing the unshown gap is rejected

### Requirement: Carry original evidence across repeated compactions

Previously accepted quotations SHALL be reconstructed from their original current-branch sources, not from rewritten prior-summary prose. A quotation SHALL remain eligible for carry-forward when the model merely omits it from its response. Removal SHALL require an explicit retirement decision, unavailable source, or a disclosed budget decision. Explicit retirements SHALL identify the prior quotation and whether it was superseded, satisfied, or is outside the current task, and SHALL cite a verifiable newer original user span supporting that decision. Source validation does not prove that the cited text semantically justifies retirement.

#### Scenario: Model forgets an earlier constraint
- **WHEN** a valid prior quotation says `未经确认不要推送` and the next extraction neither reselects nor explicitly retires it
- **THEN** it remains in the carried evidence if it fits the evidence budget
- **AND** its wording is read from the original source

#### Scenario: Later user correction supersedes an earlier value
- **WHEN** the user first asks for port `8080`, later explicitly corrects it to `8081`, and the extraction retires the earlier quotation as superseded and selects the correction
- **THEN** the new evidence and effective semantic state use `8081`
- **AND** the older quotation is not presented as a still-active requirement

#### Scenario: Unsupported retirement is rejected
- **WHEN** the model proposes retirement without a valid newer original user source, including when only assistant output asserts completion
- **THEN** the prior quotation remains eligible for carry-forward
- **AND** the rejected retirement is disclosed

#### Scenario: Repeated compaction and restart
- **WHEN** three compactions and a session restart occur while a selected constraint remains effective and within budget
- **THEN** its quotation is still resolved from the same original span rather than a summary of a summary

#### Scenario: Legacy or unavailable evidence
- **WHEN** prior compaction has no recognized evidence metadata, or an original source is unavailable
- **THEN** the session remains usable and a bounded selection can be rebuilt from available current-branch user text
- **AND** unavailable evidence is disclosed rather than fabricated from prior-summary prose

#### Scenario: Native fallback interrupts evidence metadata
- **WHEN** the latest compaction is native or has unrecognized evidence metadata even though an older continuity compaction has recognized metadata
- **THEN** the extension rebuilds from available branch sources rather than silently treating the older evidence as current
- **AND** output distinguishes rebuilt selection from uninterrupted evidence carry-forward

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

### Requirement: Update semantic state without silently changing intent

The semantic extraction policy SHALL update prior state rather than restart from scratch or append another summary layer. It SHALL preserve still-effective positive and negative constraints even when recent conversation does not repeat them; prefer later explicit user corrections over earlier requirements; distinguish verified facts from uncertain assumptions; retain unanswered requests and pending user decisions; and distinguish completed work from active work. The active request SHALL include the latest unfulfilled user input, including a question, comparison, or decision request, and SHALL NOT be replaced by a historical plan or the summarizer's own assignment. Completed actions SHALL NOT become new next actions merely because their original request remains quoted. Exact paths, commands, identifiers, relevant values, failure messages, and rejected approaches SHALL be retained when necessary to continue. Tool inputs establish attempts, not successful outcomes; invalidated facts SHALL become unresolved rather than remain asserted as current facts.

#### Scenario: Positive and negative constraints remain distinct and effective
- **WHEN** the user requires `只用上游公开 API` and `不要修改配置` and neither requirement has been withdrawn
- **THEN** both remain constraints after compaction, even if neither is repeated in recent turns

#### Scenario: Work has completed but a decision is still pending
- **WHEN** implementation is complete, one test still fails, and deployment is awaiting user approval
- **THEN** completed implementation is not listed as unfinished
- **AND** the failing test and pending approval remain open
- **AND** Next does not treat pending approval as permission to deploy

#### Scenario: A question is still unanswered
- **WHEN** the latest relevant user request asks for a comparison and no answer has been delivered
- **THEN** that request remains open rather than being collapsed into historical discussion

#### Scenario: A prior attempted fix failed
- **WHEN** a command failed with a specific error and a proposed fix has not been verified
- **THEN** the summary retains the failed attempt and relevant exact error
- **AND** does not describe the issue as resolved

#### Scenario: Latest question takes precedence over an older action plan
- **WHEN** an earlier plan names an implementation action but the user's latest unfulfilled input asks for an explanation before proceeding
- **THEN** the current request and immediate next action concern that explanation
- **AND** the older plan remains context rather than fresh permission to execute

#### Scenario: All requested work has been satisfied
- **WHEN** the user's requested work and questions have all been resolved and no new request is pending
- **THEN** the summary states that there is no active unfulfilled request and leaves no invented next action
- **AND** historical quotations do not reopen completed work

#### Scenario: An attempt or earlier fact lacks current verification
- **WHEN** a tool was invoked without a successful result, or a previously passing test became stale after a relevant change
- **THEN** the attempted action is not described as a verified success
- **AND** the missing result or required re-verification remains unresolved

### Requirement: Budget extraction without silent semantic-list slicing

The extension SHALL distinguish a content-scaled summary target from actual SDK/model output limits and from abnormal-response safety bounds. The target SHALL account for the volume of state requiring summarization instead of assigning every extraction a fixed small output allowance. A complete result SHALL NOT be rejected solely for exceeding that soft target. Input, parse, quotation, and rendered-output bounds SHALL be mutually consistent with the effective budget and disclosed where they affect selection. Semantic lists SHALL use an aggregate safety ceiling rather than an unconditional 24-items-per-category limit. Lists that fit the enforced bounds SHALL NOT be truncated by position. If semantic extraction exceeds an enforced safety bound or is incomplete, the extension SHALL return no replacement and disclose the reason, allowing Pi's existing fallback.

#### Scenario: Twenty-five short independent items fit
- **WHEN** a valid extraction contains 25 distinct short open items and fits the aggregate and total bounds
- **THEN** all 25 remain present in the rendered Open section

#### Scenario: A complete summary exceeds its soft target
- **WHEN** a generated summary exceeds the suggested length but is complete and fits the declared safety bounds and usable context
- **THEN** the extension accepts it rather than invoking native fallback merely because the target was exceeded

#### Scenario: More relevant state requires a larger target
- **WHEN** an extraction must preserve substantially more relevant state and the model/context boundaries have room for a larger summary
- **THEN** its target can grow with that state instead of being constrained by the same fixed small output allocation
- **AND** a smaller unrelated parsing or rendering cap does not negate the larger effective allowance

#### Scenario: A semantic safety bound is exceeded
- **WHEN** extraction exceeds the declared aggregate item bound or total semantic budget
- **THEN** the entire semantic result is rejected with a bounded reason
- **AND** the extension does not silently keep only the first or last items

#### Scenario: Generation reaches its output limit
- **WHEN** the provider returns a length-limited or incomplete extraction
- **THEN** the extension identifies the result as incomplete, does not commit it as a valid continuity summary, and leaves fallback to Pi

### Requirement: Bound quotation selection and disclose coverage

Quotation evidence SHALL have an independent budget. When valid evidence cannot all fit, the extension SHALL prefer constraints and corrections over task descriptions, use recency as a secondary ordering within a priority class, keep complete selected quotations, and disclose omitted evidence. The extension MUST NOT claim to have detected every semantic omission simply because its mechanical coverage counts are zero.

#### Scenario: Evidence exceeds its budget
- **WHEN** accepted candidate quotations exceed the evidence budget
- **THEN** a deterministic subset of complete quotations is rendered with an omission count and source-recovery guidance
- **AND** a quotation is not shortened without disclosure to make it fit

#### Scenario: A selected quotation is too long
- **WHEN** a proposed quotation exceeds the declared per-quotation limit
- **THEN** it is rejected as over limit, without chopping its text or changing the original session entry

#### Scenario: No mechanical omission is detected
- **WHEN** every offered candidate and accepted quotation fits
- **THEN** the summary still describes its evidence as selected rather than claiming complete preservation of all user requirements

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

### Requirement: Honor accepted compaction focus without broadening command behavior

On a continuity-owned compaction event with an explicit focus supplied by the host, the extractor SHALL use that focus to prioritize relevant information while retaining the strict format, source validation, and still-effective constraints. The extension MUST NOT reinterpret instructions embedded in conversation or tool data as changes to its extraction protocol.

#### Scenario: Focus requests exact test evidence
- **WHEN** an accepted continuity compaction event carries a focus to preserve failed test commands and acceptance conditions
- **THEN** the synthesis input includes that focus separately from untrusted conversation data
- **AND** ordinary `/compact` continues to use Pi's native focus handling

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

### Requirement: Assess continued behavior separately from mechanical validity

Acceptance of the retention improvement SHALL evaluate actual continuation after repeated compactions, using Hermes as the primary behavioral reference and explicit user requirements as the authority. Checks SHALL distinguish source exactness, structural validity, fallback occurrence, and semantic/action correctness. Equivalent performance to the reference MUST NOT be claimed from its reputation, the presence of similar prompts, or deterministic tests alone. If real-model continuation has not been evaluated, that outcome SHALL remain explicitly unverified.

#### Scenario: Exact quotations survive but continued behavior is wrong
- **WHEN** a three-compaction continuation preserves a quotation and valid summary structure but executes a prohibited action, skips an unanswered request, or treats pending approval as permission
- **THEN** behavioral acceptance fails even though source and schema checks pass

#### Scenario: Only deterministic checks have been run
- **WHEN** source-validation, rendering, and host-lifecycle tests pass without an approved real-model continuation evaluation
- **THEN** those bounded results are reported as passing
- **AND** semantic fidelity and comparison with Hermes remain unverified rather than inferred from those results
