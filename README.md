# pi-continuity

`pi-continuity` gives [Pi](https://github.com/earendil-works/pi) a small, branch-aware continuity checkpoint at compaction time. During Pi's public `session_before_compact` lifecycle, the extension asks the current model to extract the task, completion condition, constraints, established facts, open work, and next actions. On success it returns Pi's standard `{ compaction }` result with strict checkpoint details and a deterministic Markdown summary.

The summary provides context for Pi's next model request, whether that is an overflow retry or a later user turn. The checkpoint details record `authorization.mayStartTurn: false` as extension-owned metadata; Pi does not interpret or enforce that field.

## Compatibility

Version 0.2.0 requires Node.js 22.19.0 or newer and Pi 0.82.0 or newer.

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

Controls are append-only session entries and apply only to the current branch. A set control remains authoritative across later checkpoints until it is unlocked or cleared. `clear` clears controls; it does not delete session history. Status reports the currently committed checkpoint with those controls applied, or reports that no valid checkpoint is present.

## Compaction behavior

The same upstream hook covers every Pi compaction reason:

- **Manual:** `/compact` may use the continuity compaction result.
- **Threshold:** automatic threshold compaction may use the same result; Pi owns turn scheduling.
- **Overflow:** overflow recovery may use the same result; Pi owns retry and preserves its `willRetry` behavior.

The extension returns a complete standard `CompactionResult`: deterministic summary, Pi-provided cut point and token count, synthesis usage, and the strict continuity checkpoint in `details`.

The extension does not start or queue turns, invoke compaction, abort work, or own retry. A missing model or authentication, cancellation, model failure, or invalid extraction returns `undefined`, leaving Pi to continue its own compaction behavior.

Checkpoint state changes after Pi commits the result and emits `session_compact`. Failure or cancellation leaves the prior checkpoint and controls unchanged. Each committed compaction supersedes the prior checkpoint; a later compaction with missing or malformed checkpoint details clears it while preserving branch-local controls. Session start, tree navigation, and `session_compact` rebuild the view from Pi's current branch.

## Design

Canonical checkpoint details are versioned and strict. They retain both the model-extracted state and the effective result after user controls, so unlocking a field restores the model-extracted value. Continuity creates the checkpoint identity, timestamp, compaction metadata, and `authorization.mayStartTurn: false`; the model supplies only bounded task-state fields. The Markdown summary is derived deterministically from the effective result. User controls are custom entries that do not enter LLM context.

## Security

Pi extensions execute with the same system access as Pi. Review this repository before installing it. Conversation and prior-summary text are treated as untrusted data in the extraction prompt, and model output is accepted only through a strict bounded schema, but those checks do not turn an extension or model provider into a security boundary.

## License

MIT
