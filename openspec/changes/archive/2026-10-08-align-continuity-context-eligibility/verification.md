# Verification — align-continuity-context-eligibility

## Candidate and scope

- Repository: `pi-continuity`, branch `main`, baseline `fe5091029e43d2010999da3170453495d835c490`.
- Reviewed candidate: uncommitted working-tree changes. Implementation/review performed no branch, commit, push, archive, installation or deployment. The user subsequently authorized spec synchronization, archive, commit and push; those delivery operations do not imply installation or deployment.
- Implements the approved local eligibility rule plus native comparison tests and cross-host empty-message exclusion. `transformMessages` is test-only, never a runtime extension import or source of execution evidence.
- Existing `.pi/` and `.serena/` work is outside this change. On 2026-10-08, the approved archive workflow synchronized all four delta requirements into the main spec, verified exact agreement and preservation of unrelated requirements/scenarios, and passed `openspec validate --specs --strict` (3 specs).

## Checked environment

| Environment | Actual resolved versions (pi-ai / pi-agent-core / pi-coding-agent) | Revision | Empty-message policy |
| --- | --- | --- | --- |
| Installed test dependencies | 0.82.0 / 0.82.0 / 0.82.0 | Installed node_modules | Native retains empties; continuity excludes |
| Cached upstream | 0.85.1 / 0.85.1 / 0.85.1 | `e4c75a73222ae2c72abb5f5314fa35ee8effc508` | Native retains empties; continuity excludes |
| Cached xz-dev | 0.85.1 / 0.85.1 / 0.85.1 | `21d2fb3c9e5cdb12caa93f2884e8d0ebb0e6aeeb` | Native and continuity exclude empties |

Node: 26.3.0, linux-x64. Actual Vitest: 4.1.9. Package declarations are not resolved-version evidence: the manifest declares coding-agent 0.85.1 and Vitest 4.1.11, unlike this installed tree. No dependency install/update was needed.

## Automated gates

All commands run from this repository:

```sh
npm run check
npm test
openspec validate align-continuity-context-eligibility --strict
git diff --check
PI_OFFLINE=1 npm_config_offline=true E2E_HOST_SHA=e4c75a73222ae2c72abb5f5314fa35ee8effc508 npm run test:e2e:upstream-pi
PI_OFFLINE=1 npm_config_offline=true E2E_HOST_SHA=21d2fb3c9e5cdb12caa93f2884e8d0ebb0e6aeeb npm run test:e2e:xz-dev-pi
```

- Typecheck, strict OpenSpec validation and diff whitespace check: exit 0.
- Full deterministic suite: 6 files, 189 tests passed.
- Shared 21-case native fixture: singleton and full-conversation survivors agree in all three checked environments. Three empty cases intentionally differ on installed/upstream: empty user, empty assistant, blank text/thinking. Real failed/empty tool results, signatures, calls, length replies, images and unknown blocks remain eligible. The native synthetic missing result is absent from original-source selection.
- Both host runners: exit 0; validated fixed-SHA caches reused (no latest-main lookup, fetch, dependency installation or host build). Each reports 43 phases, 70 faux-provider requests, 29 compaction preparations, zero executed historical tools. Actual packed-extension loading, source IDs, original call/result locators, cut points, tokensBefore, auth, cancellation, fallback, command ownership and existing explicit continuation modes remain covered.
- These are fixed cache snapshots, not a claim about current upstream main. Default host scripts without `E2E_HOST_SHA` may use the network; do not interpret the commands above as authorization for that path.

Local full logs:

- `/var/tmp/continuity-final-check.log`
- `/var/tmp/continuity-final-tests.log`
- `/var/tmp/continuity-final-spec.log`
- `/var/tmp/continuity-final-diff.log`
- `/var/tmp/continuity-upstream-eligibility.log`
- `/var/tmp/continuity-xz-dev-eligibility.log`

## Loader constraint and regression sensitivity

The earlier actual `DefaultResourceLoader` probe on both cached hosts loaded zero extensions when importing `@earendil-works/pi-ai/api/transform-messages`. Root aliasing resolved it as nonexistent `packages/ai/dist/compat.js/api/transform-messages`. This failed probe explains the approved local route; it is not counted as a passing load. The implemented helper imports only public `convertToLlm`, and both packed-extension smoke runs pass.

Probe source/log: `/var/tmp/continuity-native-import-check.mjs`, `/var/tmp/continuity-native-import-check.log`; probe artifacts: `/var/tmp/continuity-native-import-s3eQsc`.

Before latest-step routing changed, five updated step tests failed on the old behavior. A later temporary mutation making eligibility admit every original caused 10 regression failures across the native comparison, latest-step selection, all three recap modes and excluded-size budget checks (log: `/var/tmp/continuity-eligibility-mutation.log`). The mutation was removed; final typecheck and all 189 tests passed afterward.

## Behavior-to-evidence map

- `tests/continuity-eligibility.test.ts` + `tests/fixtures/replay-eligibility.json`: native survivors, intentional empty differences, originals unchanged, no synthetic execution evidence.
- `tests/continuity-step.test.ts`: error/aborted/empty selection, eligible length and real failed results, missing results, interval-local call IDs, later user corrections across excluded responses, branch isolation and repeated compaction.
- `tests/continuity.test.ts`, `replay-eligible continuity projections`: history/prefix markers, original/AI/excerpt input and output, large excluded text budget invariance, exact quotation hash/spans, unchanged branch/cut point/tokensBefore, excluded-only files and eligible same-path retention, opaque legacy carry-forward. Existing persistence tests now seed real source operations instead of assuming an unfiltered aggregate is fresh authority; their cumulative/full-list/display-budget assertions remain.
- `scripts/lib/run-pi-continuity-host-e2e.mjs`: shared native comparison plus real packed loader and captured faux requests on both hosts, excluded attempts after each recap fixture, repeated compaction/reload, no extra turn for compact-only commands.

## Independent final review

- Verdict: **approved with explicit residual risk**; no blocking findings or required corrections.
- Reviewer: fresh-context `reviewer-final`, run `18aacce9-244c-40ce-929f-9534be740a0b`; report `/var/tmp/continuity-final-review.md`.
- Independently reran `npm run check`, `npm test` (6 files / 189 tests), strict change validation and `git diff --check`: all passed. Confirmed baseline, no staged files and unchanged candidate scope.
- Inspected both existing fixed-cache host receipts, native source, cache HEADs/manifests/outputs and actual package versions; did not rerun the host smoke commands. No independent live-model or HTTP-wire claim.
- Parent reconciled the review against the approved delta and existing evidence. No source/test repairs required; only this review record and the task completion checkbox changed after review.

## Residual limits

- Guarantees only fresh derivation from available originals. Previous summaries and inherited compatible file metadata are not retroactively sanitized.
- File paths still describe read/write/edit attempts, not verified completed side effects.
- Original signature-bearing and unknown content remains eligible; provider/model-specific representation transformations are not replicated or inspected.
- Does not rerun third-party context hooks, alter original session records/retained tail, or control Pi's independent native fallback.
- Native/faux coverage is not HTTP-wire coverage, live-model continuation fidelity, universal custom-provider compatibility, future-version parity, or remote CI evidence.
- Independent approval covers the reviewed candidate and checked versions only. Spec synchronization, archive, commit and push rely on the user's separate delivery authorization, not the review verdict.
