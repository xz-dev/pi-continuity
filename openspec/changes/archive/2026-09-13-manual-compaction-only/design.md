## Context

See `proposal.md` for the user need and `specs/continuity-compaction/spec.md` for the changed contract.

Current source at `addc79f` places the unwanted behavior in `createContinuityExtension` in `internal/continuity-core.ts`: the manual command calls `ctx.compact`, and its successful terminal callback sends a hidden `pi-continuity/continue` message with `triggerTurn: true`. This callback runs after either continuity extraction or a native fallback commits.

The same closure's `manualPending` also distinguishes `/continuity` from ordinary manual `/compact`, rejects overlapping commands, and protects a newer request from stale callbacks. It is not solely continuation state. `historyText` filters the old custom-message identity before extraction. The packed-host harness currently depends on automatic continuation both for request counts and for checking model-visible evidence/files.

A short design is warranted despite the small runtime deletion: removing message emission must not remove pending-request ownership or inadvertently weaken the retention tests.

## Goals / Non-Goals

**Goals:**
- Change the terminal command effect without changing compaction/extraction ownership.
- Preserve request-identity cleanup and existing old-session compatibility.
- Prove both absence of unsolicited assistant requests and availability of committed context on a later explicit input.

**Non-Goals:**
- No new command, argument, configuration toggle, task-completion classifier, persistent idle flag, or scheduler.
- No clearing or rewriting `Open`/`Next`, no task reset, and no automatic retirement of evidence because the command was invoked.
- No changes to extraction prompts/budgets, evidence schema, progress implementation, host queue behavior, or Pi's threshold/overflow handling.
- No model-quality benchmark, dependency upgrade, publishing, installation, or live-session change as part of this slice.

## Decisions

### 1. Remove the trigger at its source

Delete the command completion path's continuation-message emission, including the exception handling used solely around that send. Keep the completion callback to release the matching pending request; keep error and synchronous-start-failure cleanup.

Remove the request's `cancelled` flag and its read/write only if, as in the current source, they solely gate the deleted continuation. Keep a unique per-request identity and preserve the actual cancellation result returned by the extraction handler. A plain pending boolean is not equivalent: a stale callback must not release a newer request. Do not release pending state merely when extraction ends; native fallback or host commit can still be outstanding.

Alternatives rejected: setting `triggerTurn: false` would still inject an unwanted instruction for a later turn; changing the message's visibility does not remove the extra turn; a toggle or `--continue` argument adds behavior the user did not request.

### 2. Retain context without granting execution authority

Keep the current semantic summary, evidence/file retention, and `CONTINUE_TYPE` history filter. The constant remains useful for transcripts produced by older versions even though the extension no longer emits that message. Preserve genuine user messages that happen to use the old continuation wording.

No transcript migration or retroactive message deletion is needed. Manual compaction is neither proof that every task is complete nor permission to act on unfinished items. Existing summary fidelity rules continue to apply when a user later submits a request.

Alternative rejected: deleting the legacy filter along with the sender would reintroduce old orchestration text as apparent task context. Clearing summary task fields would discard information unrelated to the unwanted scheduling effect.

### 3. Keep the no-turn guarantee scoped to this command

The extension must schedule no assistant turn because of `/continuity`, regardless of summary content or fallback outcome. For an idle session with no other queued work, the observable result is a committed compaction followed by waiting for input.

Do not intercept Pi's independently queued messages, disable other extensions, or interfere with automatic overflow retries to enforce global silence. Threshold and overflow tests retain their host-owned assistant-request expectations; summarizer calls are not assistant work turns.

### 4. Split host checks at the user-input boundary

Reuse `tests/continuity.test.ts` and the existing packed-host faux-provider harness; add no framework or replacement harness.

- Unit/command boundary: update the successful and fallback callbacks to expect no `sendMessage`, including repeated terminal notifications, duplicates, cancellation, and errors. Prove stale-callback isolation by issuing another command while the newer request is pending and checking that it remains deduplicated, rather than relying on a now-always-zero send count. Verify another command is accepted once the current request terminates.
- Host compact-only phase: call `/continuity`, settle through the existing host seam, assert a fresh compaction is committed/persisted when successful, and assert zero assistant requests and no added legacy continuation entry. Count plugin/native summarization separately. Preserve exact fallback, cancellation, deduplication, usage, and progress assertions.
- Explicit-input phase: only after the compact-only assertions pass, submit a distinct user request representing a new task through the normal session prompt API. Check that this is the trigger for the assistant request, that the committed summary is already persisted, and that verified quotations, identities, and displayed files reach the model-visible context. There must still be no new extension continuation entry.
- Keep three-round carry-forward, fresh-extension JSONL reload, correction, sibling isolation, native-gap reconstruction, and legacy-message filtering coverage. Move context assertions currently inside the automatic-continuation responder to explicitly requested follow-up phases rather than deleting them.
- Preserve automatic threshold/overflow expectations: the host fixture currently expects one/two assistant calls respectively, with no plugin continuation message.

This is a mechanical scheduling/context-delivery check. A faux provider cannot prove that a real model interprets a new task correctly or establish semantic equivalence with Hermes; those existing limits remain documented.

## Risks / Trade-offs

- **Removing pending state with the sender could make `/continuity` fall through to native handling or allow overlaps.** Mitigation: retain identity-based request ownership and assert command behavior at the callback boundary.
- **A harness could pass by observing no assistant request even when compaction did nothing.** Mitigation: require a fresh committed entry, persisted summary, expected extraction/native counts, and successful later explicit input.
- **Deleting continuation assertions could erase retention coverage.** Mitigation: separate idle and explicit-input phases, retaining context assertions across repeated compaction/reload.
- **An old `37 faux requests` receipt or `commit-before-continue` PASS label would describe obsolete checks.** Mitigation: update harness labels and README from fresh dual-host results; do not mechanically reuse old totals or claim previous runs validate this change.
- **Users previously relying on implicit continuation must now type their next request.** Mitigation: document this intentional behavior change, without adding an opt-in continuation mechanism.
- **Other queued work can still run under Pi's control.** Mitigation: state the command-local boundary and use an otherwise idle isolated session for the no-turn acceptance example.

## Migration Plan

After separate implementation authorization, deliver one compact-only behavior slice with its existing unit and packed-host checks, then update the README. Run `npm test`, `npm run check`, and both existing host E2E commands; record each exact host revision and the new request receipt. No package-version change or installation is part of this plan.

Existing session summaries and evidence metadata stay compatible. Keep old continuation-message filtering when loading prior sessions. Sync the delta into the main specification through the normal OpenSpec workflow after implementation verification; do not rewrite archived changes.

If rollback is needed, use the prior extension revision through the usual separately authorized release/install process. Its automatic continuation behavior would return and must be disclosed; no data rollback is required.
