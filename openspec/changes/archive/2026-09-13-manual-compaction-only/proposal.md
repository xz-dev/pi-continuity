## Why

Users manually run `/continuity` to compact context, commonly after deciding the previous task is finished and before starting a new one. The current successful-compaction callback silently starts another assistant turn, treating context retention as permission to continue old work; the user explicitly rejects that behavior.

## What Changes

- **BREAKING**: Make `/continuity` compact only. Neither a successful continuity compaction nor a successful native fallback may cause the extension to enqueue a continuation message or start an assistant turn.
- Leave an otherwise idle session ready for the user's next input, regardless of whether the summary contains `Open` or `Next` items. Do not interpret manual compaction as a request to resume work or as evidence that all historical work is complete.
- Preserve pending-request deduplication, stale-callback isolation, terminal cleanup, cancellation, bounded diagnostics, native fallback, and the existing progress display.
- Preserve the six-field summary, source-backed quotations, file retention, and filtering of legacy extension-owned continuation messages. Retained context remains available when the user explicitly starts another task.
- Keep ordinary `/compact` native and Pi responsible for automatic threshold compaction, overflow recovery, and queued work. Add no continuation flag, configuration option, replacement command, or scheduler.
- Update existing lifecycle tests and user documentation. Separate compact-only assertions from explicitly requested post-compaction model calls so retention coverage is not lost.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `continuity-compaction`: Replace the manual compact-and-continue contract with compact-only behavior, including native fallback success, and remove the fallback requirement's dependency on a manual continuation callback.

## Impact

- Runtime: `internal/continuity-core.ts`, specifically the `/continuity` command's terminal callbacks. Existing extraction and history-filtering behavior remains intact.
- Verification: `tests/continuity.test.ts` and `scripts/lib/run-pi-continuity-host-e2e.mjs`; reuse existing Vitest fixtures and the isolated packed-host faux provider on both supported host families.
- Documentation: `README.md` manual-command description and verification claims. The new delta will update the main specification during the normal sync/archive workflow; archived changes remain historical records.
- Compatibility: Users who relied on automatic continuation must explicitly send their next request. No dependency, peer-version, command syntax, summary schema, or persisted metadata migration is required.
