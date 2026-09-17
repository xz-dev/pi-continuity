## 1. Original-step selection and deterministic recap

- [x] 1.1 Inspect existing branch/message and test helpers, then implement selection of the latest original assistant step with call-ID-matched results and separate subsequent user input; verify parallel calls, missing/aborted results, sibling isolation, and repeated compaction across an older boundary with focused existing-framework tests.
- [x] 1.2 Add bounded textual projection and original/excerpt/unavailable rendering with session and entry locators; verify short-text exactness, 1000/2000 estimated-token Unicode-safe non-overlapping excerpts, explicit middle/non-text omissions, locator bounds, and in-memory recovery limitations.

## 2. Oversized-step summary and synthesis integration

- [x] 2.1 Add one auxiliary step-summary attempt only for oversized requestable steps using the current model and existing stream dependency; verify success, empty/error/length/over-budget responses, unrequestable input, no extra retries, auth handling, cancellation, usage, and one-off cache options with faux responses.
- [x] 2.2 Feed the bounded recap and later user input into the main synthesis request, reconcile Established/Open/Next policy, and append one host-rendered recap after existing summary sections without changing the tool envelope or retained boundary; verify emitted prompts and committed summaries, including two compactions with no intervening assistant response.
- [x] 2.3 Include recap/scaffolding and all requests in budget and usage accounting, preserving cleanup and main-extraction fallback; verify small-reserve budget rejection, full 1000/2000 fallback or explicit failure, existing semantic-list preservation, auxiliary-failure continuation into main synthesis, and cancellation without subsequent calls.

## 3. Host behavior and delivery evidence

- [x] 3.1 Extend the existing packaged-host harness with recap persistence/reload, manual compact-only, explicit continue, automatic threshold/overflow, and native fallback cases; verify unchanged cut points, no replayed tool execution or added continuation messages, and mode-correct request counts on both supported hosts.
- [x] 3.2 Add the agreed failed-test, waiting-for-user, completed-task, and later-stop examples to the existing semantic evaluation material; verify expected outcomes are explicit and distinguish mocked prompt/render checks from real-model evidence, reporting semantic behavior as unverified unless separately authorized evaluation is run.
- [x] 3.3 Update README with recap modes, initial 3000-token content budget, auxiliary cost, excerpt recovery, cancellation, and limitations; verify statements against actual implementation and run `npm test`, `npm run check`, `npm run test:e2e:upstream-pi`, and `npm run test:e2e:xz-dev-pi`, reporting any unavailable gate rather than claiming success.
