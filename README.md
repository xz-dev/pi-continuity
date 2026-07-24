# pi-continuity

`pi-continuity` gives [Pi](https://github.com/earendil-works/pi) a small, branch-aware continuity checkpoint at compaction time. It asks the current model to extract the task, completion condition, constraints, established facts, open work, and next actions, then stores that canonical structure in the compaction entry and renders a deterministic summary from it.

The checkpoint is context for the next genuine user turn. **The extension never starts a model turn.**

## Compatibility

Version 0.1.0 targets Pi 0.82.0 and Node.js 22.19.0 or newer. The package uses only public APIs exported by Pi's bundled core packages.

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

Controls are append-only session entries and apply only to the current branch. A set control remains authoritative across later checkpoints until it is unlocked or cleared. `clear` clears controls; it does not delete session history.

## Compaction behavior

The same handler covers all Pi compaction reasons:

- **Manual:** `/compact` attempts to create a continuity checkpoint.
- **Threshold:** automatic threshold compaction attempts the same checkpoint and leaves turn scheduling to Pi.
- **Overflow:** overflow recovery attempts the same checkpoint while preserving Pi's `willRetry` behavior; Pi alone owns the retry.

If the current model or authentication is unavailable, cancellation occurs, the model call fails, or output does not match the strict schema, the handler returns no custom result and Pi falls back to native compaction.

A later valid continuity checkpoint becomes current. A later native or non-continuity compaction clears the current checkpoint view but preserves branch-local controls, ready for a future continuity checkpoint. Session start, tree navigation, and completed compaction rebuild the view from Pi's current branch.

## Design and non-goals

Canonical checkpoint details are versioned and strict. They retain both the model-generated baseline and the effective projection after user controls, so unlocking a field always restores the generated value. Pi-authored fields include the checkpoint identity, timestamp, compaction provenance, and `authorization.mayStartTurn: false`; the model supplies only bounded task-state fields. The Markdown summary is derived deterministically from the effective projection. User controls are custom entries that do not enter LLM context.

This package does not abort runs, trigger messages, queue work, schedule timers, invoke compaction, or maintain a filesystem ledger. It does not implement Oh My Pi `preserveData` semantics or provider-native remote compaction.

## Security

Pi extensions execute with the same system access as Pi. Review this repository before installing it. Conversation and prior-summary text are treated as untrusted data in the extraction prompt, and model output is accepted only through a strict bounded schema, but those checks do not turn an extension or model provider into a security boundary.

## License

MIT
