## Why

`/continuity` currently always stops after manual compaction, but some users intentionally want the earlier compact-and-resume workflow. Adding an explicit `continue` argument restores that workflow without making ordinary `/continuity` or Pi's native `/compact` resume work unexpectedly.

## What Changes

- Add `/continuity continue` as an explicit compact-and-continue command.
- Keep `/continuity` compact-only and waiting for the user's next input.
- After `/continuity continue` commits either a continuity summary or a native fallback summary, enqueue the legacy hidden continuation message and start one assistant turn, matching the pre-compact-only behavior.
- Do not start a continuation after cancellation, terminal failure, a stale callback, or a duplicate command.
- Reject arguments other than the optional exact `continue` keyword with `Usage: /continuity [continue]`.
- Keep ordinary `/compact`, automatic threshold compaction, overflow recovery, summary extraction, persisted metadata, and legacy continuation-message filtering unchanged.
- Update focused unit tests, packed-host lifecycle checks, and user documentation for both command modes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `continuity-compaction`: Add an explicit compact-and-continue mode while preserving compact-only behavior as the default.

## Impact

- Runtime: `internal/continuity-core.ts`, limited to `/continuity` argument parsing and matching-request completion behavior.
- Verification: `tests/continuity.test.ts` and `scripts/lib/run-pi-continuity-host-e2e.mjs`, reusing existing fixtures and dual pinned Pi hosts.
- Documentation/specification: `README.md` and the `continuity-compaction` requirement.
- Compatibility: Existing `/continuity` and `/compact` behavior remains unchanged; only the new `/continuity continue` spelling opts into an assistant turn. No dependencies, configuration, persisted-data migration, or Pi host modification is required.
