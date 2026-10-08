## Why

Continuity currently serializes original records that Pi excludes when replaying history to a model, allowing those records to re-enter context through summaries and latest-step recaps. The fix must align source eligibility with Pi's replay rules, rather than classify failed output as worthless or discard genuine tool failures.

## What Changes

- Apply one source-eligibility policy before continuity serializes history or turn prefixes, selects a latest step, derives new file information, or computes content-derived budgets.
- Mirror Pi's whole-message replay exclusions locally, including assistant `error` and `aborted` responses, while using the public host conversion for explicitly context-excluded records. Exclude empty messages on every supported host, with signature/tool-call/actual-result exceptions; native comparison tests explicitly record older/upstream hosts' intentional empty-message difference.
- **BREAKING**: Replace the existing rule that always selects the newest recorded assistant, even when failed or interrupted, with selection of the newest replay-eligible original assistant. Preserve actual matched tool results and subsequent user corrections.
- Preserve eligible failed tool results, user provenance, normal compaction of older history, and the distinction between a proposed tool call and an observed outcome.
- Prevent excluded records from contributing new file paths or reappearing through auxiliary recap requests and deterministic recap fallbacks. Do not promote provider-synthesized tool results into execution evidence.
- Add native-transformation comparison tests and regression coverage for every affected continuity input/output path, and update the documented latest-step policy.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `continuity-compaction`: Require replay-eligible original sources throughout continuity extraction, latest-step selection, derived budgets, and newly collected file information while preserving existing lifecycle, evidence, and compaction-boundary guarantees.

## Impact

- Expected implementation areas: `internal/continuity-core.ts`, `internal/continuity-step.ts`, their tests, and a small shared source-eligibility helper if needed. User-evidence sourcing must be checked for consistency without weakening provenance validation.
- Documentation: `README.md` and the `continuity-compaction` specification's existing latest-failed/interrupted-step policy.
- Compatibility: preserve Pi's compaction cut point, retained tail, six-field extraction schema, command behavior, fallback, cancellation, and usage accounting. No new dependency, user setting, provider framework, or retry scheduler is planned.
- This change governs fresh derivation from available original records. It does not rewrite original logs, erase charges, sanitize untraceable content already embedded in older summaries/file details, or modify Pi's native fallback implementation. Arbitrary third-party context hooks are not re-executed to reconstruct historical requests.
- Commit, release, installation, and deployment are outside this planning change.
