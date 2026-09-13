## Context

See `proposal.md` and `specs/continuity-compaction/spec.md` for the requested behavior.

The current `/continuity` handler accepts no arguments, stores a unique `manualPending` request object, calls `ctx.compact`, and clears that matching request on completion or error. `session_before_compact` uses the pending identity to distinguish extension-owned `/continuity` from ordinary `/compact`; the latter remains native. Before the compact-only change, the matching success callback also sent a hidden `pi-continuity/continue` message with `triggerTurn: true`.

The old continuation-message identity and extraction filter still exist for compatibility with prior transcripts. Restoring the send only for an explicit argument therefore requires no new message schema or Pi API. The request object must carry both identity and the selected completion mode so stale callbacks cannot continue a newer request.

## Goals / Non-Goals

**Goals:**
- Preserve compact-only behavior for `/continuity` with no argument.
- Add `/continuity continue` as the only explicit compact-and-continue mode.
- Restore the old post-commit continuation sequence for that mode, including after successful native fallback.
- Preserve cancellation, terminal failure, duplicate-request, stale-callback, and synchronous-start-failure guarantees.
- Keep the committed summary and retained evidence available before the continuation turn starts.

**Non-Goals:**
- Do not change or intercept Pi's built-in `/compact`.
- Do not alter threshold/overflow scheduling, queued-input ownership, summary generation, evidence selection, persistence, or progress rendering.
- Do not add configuration, aliases, multiple continuation modes, transcript migration, dependencies, or Pi host changes.
- Starting a turn does not bypass retained constraints or grant approval for actions that still require explicit user authorization.

## Decisions

### 1. Use one exact optional argument

Normalize the command input with `trim()` and accept only `""` or `"continue"`. Empty input keeps the existing compact-only mode. Any other value reports `Usage: /continuity [continue]` and returns before creating pending state or starting compaction.

This is simpler and more explicit than a configuration toggle or changing the default behavior. It also leaves existing users and scripts compatible.

### 2. Carry continuation intent on the pending request identity

Replace the opaque pending object with a small request record containing the selected `continueAfterCommit` mode and cancellation state. The record itself remains the ownership token:

```text
manualPending === request
```

Only a callback matching the current request may clear it or enqueue continuation. This preserves the existing stale-callback guard and avoids a separate global mode flag that could leak into a later request.

Alternative rejected: infer the mode from the latest command text after compaction. That text is not part of the terminal callback contract and would make stale completion unsafe.

### 3. Restore the old send only after matching successful completion

The matching `onComplete` callback clears pending state, then sends the existing hidden `pi-continuity/continue` message with `triggerTurn: true` only when `continueAfterCommit` is true and the request was not cancelled. The message content and identity remain unchanged so the existing history filter continues to exclude it from future intent extraction.

A second completion callback sees that the request is no longer current and does nothing, guaranteeing at most one extension-started turn. Default `/continuity` follows the same completion cleanup but sends nothing.

The callback is intentionally attached to the host compaction operation rather than successful continuity extraction. Therefore `/continuity continue` also continues after Pi commits a native fallback summary, matching the historical behavior explicitly requested by the user.

Alternative rejected: continue only after source-verified extraction. That would be safer but would not restore the requested old behavior and would make the command's completion semantics depend on an internal fallback boundary.

### 4. Mark cancellation on the matching request

When continuity synthesis reports cancellation for an extension-owned manual request, mark that request cancelled before returning the host cancellation result. This reinstates the old defensive guard against a host invoking completion after an aborted path. Errors and synchronous start failures clear only the matching request and never continue.

### 5. Extend existing tests instead of adding a new harness

Keep the current compact-only examples as regression coverage for `/continuity`. Add focused cases for:

- argument parsing and rejection before compaction;
- one hidden continuation and one started turn after `/continuity continue` succeeds;
- continuation after native fallback commit;
- no continuation on cancellation, terminal error, synchronous start failure, duplicate request, or stale callback;
- at-most-once behavior under repeated completion notifications.

In the packed-host harness, retain all default compact-only and explicit-new-task phases. Add one bounded `/continuity continue` phase that proves the compaction entry is committed and persisted before the hidden continuation drives the assistant request, and that the request sees retained summary/evidence/files. Reuse the current faux provider and both pinned host revisions.

## Risks / Trade-offs

- **The explicit mode can resume work the user did not intend to authorize fully.** -> The argument itself requests a continuation turn, but retained constraints and approval gates remain authoritative; document that it is not blanket permission.
- **Native fallback lacks source-verified evidence but still continues.** -> Document this deliberate restoration of old behavior and keep fallback diagnostics visible.
- **A stale or duplicate callback could start more than one turn.** -> Gate clearing and sending on exact pending-object identity; test repeated and stale terminal notifications.
- **Testing only the message send could miss commit ordering.** -> Packed-host coverage must assert the compaction is persisted before the continuation request is observed.
- **Adding a mode could weaken default compact-only coverage.** -> Keep existing default phases intact and add the continue phase rather than repurposing them.

## Migration Plan

Implement as one small behavior slice: focused unit expectations first, runtime argument/mode handling second, packed-host coverage third, and README updates last. Run the existing type check, full unit suite, and both pinned packed-host E2Es. No package version, dependency, configuration, persisted-data, or host migration is required.

Rollback removes the `continue` argument path and restores the current opaque pending request; default `/continuity` and existing session data remain compatible. Sync the delta specification and archive the change only after implementation verification and user authorization.
