## Why

Continuity synthesis receives older history and a split-turn prefix but not necessarily the latest retained assistant step and its tool results. A summary can therefore describe an outdated next action even when Pi retains newer evidence; users need a bounded, explicit handoff showing where work actually stopped.

## What Changes

- Select the latest model step from the current branch at compaction time: one assistant response plus its matching available tool results, with source identifiers and incomplete-state markers.
- Append a separate latest-step recap at the end of the continuity summary, after its existing sections. Keep the six semantic fields and Pi's retained-message boundary unchanged.
- Preserve short steps as original textual records. For oversized steps, attempt one auxiliary AI summary of the step. If that attempt fails or cannot fit safely, retain the first 1000 and last 2000 estimated tokens with an explicit omission marker.
- Include session and entry locators for optional recovery. Disclose missing files, omitted content, and non-text content; do not add a retrieval service or automatically read the session back.
- Supply the bounded recap and any subsequent user correction to the existing synthesis request so Established, Open, and Next can reconcile against recent work. Historical instructions and tool output remain untrusted data.
- Preserve cancellation, native fallback, evidence verification, manual compact-only versus explicit continue behavior, and Pi-owned automatic scheduling. Auxiliary recap failure is not failure of otherwise valid continuity extraction.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `continuity-compaction`: Add a bounded latest-step handoff, oversized-step summarization and deterministic recovery excerpts; extend separated synthesis input regions without changing retained history or scheduling.

## Impact

Expected implementation surfaces are `internal/continuity-core.ts`, a small latest-step helper if needed, existing unit tests and host-e2e scenarios, and user-facing documentation. No new dependency, session database, agent tool, command, public configuration, or Pi host patch is planned. The dedicated `submit_continuity` envelope remains unchanged; the host renders the recap separately from the model's six-field result.

An oversized step can add one model request, latency, provider cost, and model-visible/persisted assistant or tool text. The recap is not a secret filter or a guarantee of correct continuation. This change plans deterministic contract checks and records real-model semantic validation separately; it does not authorize paid evaluation, deployment, or implementation in the proposal phase.
