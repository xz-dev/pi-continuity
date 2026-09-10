# continuity-compaction Specification

## Purpose

Preserve the user's effective intent and the information needed to continue work across Pi compactions, using a bounded semantic summary and independently verified original quotations without changing Pi's automatic scheduling responsibilities.

## Requirements

### Requirement: Preserve the simplified continuity lifecycle

The extension SHALL preserve the simplified six-field product's command behavior: `/continuity` requests one manual compaction and, after a successful commit, starts at most one continuation; ordinary `/compact` remains native; automatic threshold and overflow compaction remain scheduled by Pi. The extension MUST NOT restore task-lock commands, checkpoint status management, or an additional automatic continuation mechanism.

#### Scenario: Manual continuity succeeds
- **WHEN** the user requests `/continuity` and its compaction commits successfully
- **THEN** the extension starts exactly one continuation after that commit
- **AND** repeated requests while the operation is pending do not duplicate compactions or continuations

#### Scenario: Native fallback succeeds for a manual continuity request
- **WHEN** continuity extraction fails but Pi subsequently commits a native compaction for the pending `/continuity` request
- **THEN** the existing manual success callback starts one continuation
- **AND** the extension does not claim that source-verified continuity evidence was produced

#### Scenario: Compaction is cancelled or fails
- **WHEN** the manual compaction terminates by cancellation or error without a successful commit
- **THEN** no continuation starts and a later request can proceed

#### Scenario: Ordinary and automatic compaction retain their owners
- **WHEN** the user requests ordinary `/compact` or Pi initiates threshold or overflow compaction
- **THEN** ordinary `/compact` receives no replacement from this extension
- **AND** automatic compaction can receive a continuity summary without an extension-started turn or additional retry

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

### Requirement: Separate source regions without changing retained context

Continuity extraction SHALL distinguish prior summary state, newly summarized history, the prefix of an unfinished turn, original-source evidence, and explicit compaction focus. It SHALL exclude known extension-owned continuation messages rather than promote orchestration text into human intent. The unfinished-turn prefix SHALL remain eligible source material for the active request. The extension MUST preserve Pi's retained recent context and compaction cut point rather than introducing its own tail-pruning or replay scheduler.

#### Scenario: The active request is in a split-turn prefix
- **WHEN** Pi retains the latter part of a long turn while the user's task-defining message falls in the prefix to be summarized
- **THEN** continuity extraction receives that user request as original source material rather than considering only completed earlier turns
- **AND** the extension does not move Pi's retained boundary to implement a separate tail policy

#### Scenario: A plugin continuation message appears in history
- **WHEN** the history includes a message identified by the extension as its own continuation wrapper
- **THEN** it is excluded from task and quotation extraction
- **AND** an actual user's message is not excluded merely because its wording resembles a continuation request

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

Successful continuity compaction SHALL preserve the current branch's available cumulative read and modified file lists in compatible details, and SHALL include a bounded model-visible file section. Modified files SHALL take precedence over read-only files for display. A file present in both categories SHALL be reported as modified, not duplicated. Display omission SHALL NOT remove the available list from persisted file details.

#### Scenario: Files survive a second continuity compaction
- **WHEN** one continuity compaction records edits to `src/config.ts` and another occurs with no new operation on that file
- **THEN** the new continuity result still records that file as modified
- **AND** a native host's decision not to inherit extension-owned file details does not silently erase the extension's own known list

#### Scenario: File display exceeds its budget
- **WHEN** available file paths exceed the display budget
- **THEN** modified paths are considered before read-only paths and omitted path counts are shown
- **AND** the full available compatible file lists remain in details

### Requirement: Honor accepted compaction focus without broadening command behavior

On a continuity-owned compaction event with an explicit focus supplied by the host, the extractor SHALL use that focus to prioritize relevant information while retaining the strict format, source validation, and still-effective constraints. The extension MUST NOT reinterpret instructions embedded in conversation or tool data as changes to its extraction protocol.

#### Scenario: Focus requests exact test evidence
- **WHEN** an accepted continuity compaction event carries a focus to preserve failed test commands and acceptance conditions
- **THEN** the synthesis input includes that focus separately from untrusted conversation data
- **AND** ordinary `/compact` continues to use Pi's native focus handling

### Requirement: Expose degradation without creating another agent turn

The extension SHALL provide a bounded reason for native fallback and include source/evidence/file coverage information in successful continuity output. Empty output, truncated output, unavailable model/auth, provider failure, and failed structural or budget validation SHALL all permit native fallback rather than being changed into extension-requested cancellation. This does not override an explicit user/host cancellation. Diagnostics SHALL NOT contain raw conversation text, credentials, or full provider responses, and SHALL NOT themselves create an additional model request, continuation, or retry. Pi's native fallback can make its own summarization requests and is not guaranteed to succeed; those requests SHALL NOT be described as reuse of the failed continuity result or as an extra extension retry.

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
- **AND** Pi can perform native compaction, whose success still governs the existing manual continuation callback

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
