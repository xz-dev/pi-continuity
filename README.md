# pi-continuity

`pi-continuity` gives [Pi](https://github.com/earendil-works/pi) a dedicated continuity summary whenever Pi compacts a session.

The extension asks the current model to extract only the information needed to resume work:

- the current task;
- the completion condition;
- constraints;
- established facts and decisions;
- open work;
- next actions.

It validates the extraction against a strict bounded schema and renders deterministic Markdown for Pi's standard compaction entry.

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

Run:

```text
/continuity
```

The command immediately requests Pi's manual compaction flow. Pi aborts and settles active work just as it does for its built-in `/compact` command. After the compaction commits successfully, pi-continuity sends one hidden custom message that starts a continuation turn from the new summary.

A failed or cancelled compaction does not start a continuation. Repeated `/continuity` requests while the same compaction is pending do not start duplicate compactions or turns.

## Automatic compaction

Pi's native threshold and overflow compaction also use the dedicated continuity summary:

- **Threshold:** Pi decides when to compact and whether queued work should continue.
- **Overflow:** Pi preserves its normal compact-and-retry behavior.

The extension does not define thresholds, initiate automatic turns, or take ownership of retry and queue scheduling.

Pi's built-in `/compact` remains native. The dedicated manual continuity flow is selected only by `/continuity`; automatic threshold and overflow events use the same summary without adding a plugin-started continuation.

## Failure behavior

Continuity synthesis is fail-open. If no model or authentication is available, the request is cancelled, the model fails, or its output does not match the schema, the extension returns no replacement result. Pi may then use its native compaction summary.

A successful continuity result preserves Pi's cumulative file-operation details: files only read remain under `readFiles`, while written or edited files appear under `modifiedFiles`.

## Security

Pi extensions execute with the same system access as Pi. Review this repository before installing it. Conversation and prior-summary text are treated as untrusted data in the extraction prompt, and model output is accepted only through a strict bounded schema, but those checks do not turn an extension or model provider into a security boundary.

## License

MIT
