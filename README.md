# pi-continuity

`pi-continuity` gives [Pi](https://github.com/earendil-works/pi) a small, branch-aware continuity checkpoint at compaction time. During Pi's provider-neutral `session_before_compact` lifecycle, the extension contributes an additive portable projection with custom type `pi-continuity/checkpoint/v1`. It asks the current model to extract the task, completion condition, constraints, established facts, open work, and next actions, then supplies strict checkpoint details and a deterministic Markdown summary for Pi to store on the generic compaction boundary.

The projection is context for the next genuine user turn. Its authorization explicitly guarantees `authorization.mayStartTurn: false`.

## Compatibility

Version 0.2.0 requires Node.js 22.19.0 or newer and Pi implementation commit `0f979e9e` or a descendant/downstream patch carrying the provider-transparent compaction lifecycle. No published Pi version contains that lifecycle yet.

The normal checks use the packaged Pi types. `npm run test:pi-worktree` additionally performs a strict, source-aliased typecheck and exercises the actual Pi lifecycle against a compatible Pi Git worktree. Set the absolute `PI_REPO` path to select that worktree:

```sh
PI_REPO=/path/to/pi-worktree npm run test:pi-worktree
```

## Install

```sh
pi install git:github.com/xz-dev/pi-continuity
```

or:

```sh
pi install https://github.com/xz-dev/pi-continuity
```

Update the installed package with:

```sh
pi update --extensions
```

## Usage

Run `/continuity` or `/continuity status` to inspect the current branch state.

```text
/continuity task <text>
/continuity done-when <text>
/continuity forbid <item>, <item>
/continuity forbid ["item one", "item two"]
/continuity mark active|blocked|done|unknown
/continuity unlock task|done-when|forbid|status|all
/continuity clear
```

## Status and controls

Controls are append-only session entries and apply only to the current branch. A set control remains authoritative across later checkpoints until it is unlocked or cleared. `clear` clears controls; it does not delete session history. Status reports the currently committed checkpoint with those controls applied, or reports that no valid checkpoint is installed.

## Compaction behavior

The same additive projection hook covers every Pi compaction reason:

- **Manual:** `/compact` may include a continuity projection.
- **Threshold:** automatic threshold compaction may include the same projection; Pi owns turn scheduling.
- **Overflow:** overflow recovery may include the same projection; Pi owns overflow retry and preserves its `willRetry` behavior.

The extension does not choose whether the primary compaction is provider-native checkpoint or text, and does not inspect the provider, API, model, or opaque native checkpoint. It does not start or queue turns, invoke compaction, abort work, or own overflow retry. A missing model or authentication, cancellation, model failure, or invalid extraction simply contributes no projection and leaves Pi's primary compaction behavior unchanged.

Extension state changes only after Pi has committed the generic boundary and emitted `session_compact`. Failure, cancellation, or boundary append rejection leaves the prior checkpoint and controls unchanged.

Each committed generic compaction boundary supersedes the prior continuity checkpoint. A valid matching `pi-continuity/checkpoint/v1` projection is installed; a later boundary with no matching projection or with malformed matching details clears the checkpoint while preserving branch-local controls. For sessions created before generic boundaries, legacy `compaction.details` remains readable alongside the new format. Session start, tree navigation, and committed compaction rebuild the view from Pi's current branch.

## Design and non-goals

Canonical checkpoint details are versioned and strict. They retain both the model-generated baseline and the effective projection after user controls, so unlocking a field restores the generated value. Continuity creates the checkpoint identity, timestamp, compaction metadata, and `authorization.mayStartTurn: false` from Pi lifecycle provenance; the model supplies only bounded task-state fields. The Markdown summary is derived deterministically from the effective projection. User controls are custom entries that do not enter LLM context.

This package supplies one provider-neutral additive projection. It does not replace or reinterpret Pi's primary compaction, implement Oh My Pi `preserveData` semantics, or manage provider-native remote compaction. It does not trigger messages, schedule timers, or maintain a filesystem ledger.

## Security

Pi extensions execute with the same system access as Pi. Review this repository before installing it. Conversation and prior-summary text are treated as untrusted data in the extraction prompt, and model output is accepted only through a strict bounded schema, but those checks do not turn an extension or model provider into a security boundary.

## License

MIT
