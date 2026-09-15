# pi-continuity

`pi-continuity` gives [Pi](https://github.com/earendil-works/pi) a six-field continuity summary and a bounded selection of original user quotations when it compacts a session.

The model proposes what to retain. Code verifies each selected quotation against raw user text and copies it exactly into the summary Pi uses for a later explicit request. This protects **selected, validated, retained spans** from paraphrasing; it does not guarantee selection of every important instruction or correct behavior by a later model request.

## Compatibility and installation

Version 0.2.0 requires Node.js 22.19.0 or newer and Pi 0.82.0 or newer. Unit tests use Pi 0.82.0; the host verification below identifies the specific newer revisions tested, not a guarantee about every future release.

```sh
pi install git:github.com/xz-dev/pi-continuity
```

Or:

```sh
pi install https://github.com/xz-dev/pi-continuity
```

Update the installed package:

```sh
pi update --extensions
```

## Two features, unchanged ownership

### Manual compaction

```text
/continuity
/continuity continue
```

`/continuity` remains compact-only. Pi's manual compaction flow aborts and settles active work, as its built-in `/compact` does. After a successful continuity or native-fallback commit, the session waits for the user's next input; retained `Open` or `Next` state does not authorize an assistant turn.

`/continuity continue` explicitly opts into the earlier compact-and-resume workflow. After the continuity summary or a native fallback commits, the extension appends one hidden continuation message and starts one assistant turn from the committed context. This starts a turn; it does not override retained constraints or grant approval for actions that still require confirmation.

No other arguments are supported; invalid input reports `Usage: /continuity [continue]` without starting compaction. Pending duplicate commands do not create another compaction, stale callbacks cannot complete a later request, and repeated completion notifications start at most one turn. A failed or cancelled compaction never starts an assistant turn. Native fallback is not source-verified even when the explicit mode continues afterward.

### Pi-scheduled automatic compaction

Threshold and overflow events use the same extraction:

- **Threshold:** Pi decides when to compact and whether queued work continues.
- **Overflow:** Pi owns compact-and-retry behavior.

The extension does not set thresholds or own automatic retries and queues. Ordinary `/compact` stays native. Only explicit `/continuity continue` schedules an extension-started turn; there are no checkpoint, locking, approval or artifact-state commands.

## Progress display

While extraction runs, the interactive TUI shows a transient widget above the editor: the current phase (preparing evidence, waiting for the model, receiving the summary, validating), elapsed seconds, and request/response size estimates (prompt tokens, then streamed response tokens). Nothing is persisted to the session, the summary, or any file; the widget is removed on every outcome—commit, failure with native fallback, cancellation, and compact-and-retry. Providers or gateways that buffer the whole response simply jump from waiting to the next phase instead of counting up. Print (`-p`) and JSON modes emit nothing.

## What the summary contains

The semantic state has exactly six fields:

| Field | Meaning |
| --- | --- |
| `task` | Latest unmet request, including questions, comparisons and discussion—not automatically implementation |
| `doneWhen` | Acceptance conditions |
| `constraints` | Effective limits and corrections |
| `established` | Observations and decisions supported by the history |
| `open` | Unresolved work, failures and pending approvals |
| `next` | Smallest authorized next actions; empty when no work remains |

The extraction prompt distinguishes tool attempts from observed results, completed edits from passing tests, and a plan from approval. It asks the model to reconcile older state with newer corrections and stop signals. These are instructions to a model, not semantic correctness checks.

Pi's actual summary text contains the six semantic sections, **Original user evidence**, **Files**, and **Retention coverage**. User quotations and file paths are JSON-escaped; decoding a quotation recovers its exact original text, including newlines, quotes and indentation. Putting data only in compaction `details` would not make it visible to a later explicit model request, so retained evidence and displayed files are rendered into the summary itself.

### Selected original evidence

The model calls the synthesis-only `submit_continuity` tool with a schema-defined `summary/quotes/retire` envelope. Pi's shared tool validator checks that form; continuity code—not the model—then establishes provenance:

- Sources are raw user text blocks on the current branch, before `convertToLlm`, using their original block indices. Assistant output, tool results and generated summaries are not user sources.
- Selection must match one offered continuous window exactly. No trimming, whitespace normalization, gap joining or invented source paths is accepted. Offsets are absolute UTF-16 code units; invalid Unicode spans and overlong quotations are rejected, not shortened.
- Each identity is SHA-256 over `JSON.stringify([entryId, blockIndex, start, end, copiedText])`.
- The catalogue prioritizes validated carried evidence, the latest two user messages (including kept messages), the bootstrap user message, then newly summarized user blocks newest first. Blocks up to 4000 code units are offered whole; longer blocks use head/tail windows of about 2000 each, with gaps disclosed.
- Unmentioned prior evidence carries forward. Retirement requires a valid quotation from a newer user source. A validated retirement wins over a contradictory re-selection of that same identity in the same response; no permanent tombstone is created. The validator proves source identity and ordering, **not that the model's retirement reason is semantically justified**.
- Constraints and corrections take priority under the evidence budget, followed by acceptance and task spans. Whole quotations that do not fit are omitted and counted.

A quotation is historical evidence, not fresh permission to repeat completed work or bypass approval. Zero reported mechanical omissions does **not** mean all important intent was selected.

### Persistence, files and recovery

Compaction `details` retain compatible `readFiles` and `modifiedFiles` arrays plus a version-1 `continuity` namespace containing source references and coverage counters. References contain `id`, `entryId`, `blockIndex`, `start`, `end` and `kind`; they do not duplicate quotation text or store a second semantic summary.

On another compaction or after JSONL reload, references are revalidated against the raw current branch. Missing or changed source spans are counted as unavailable. Only the **latest current-branch compaction** supplies prior continuity metadata: after a native, legacy or unknown-version entry, coverage is `rebuilt`, not borrowed from an older continuity entry. Raw user sources can still be selected anew. Initial extraction reports `initial`; recognized prior metadata reports `carried`.

Available latest-compaction file metadata is merged with current file operations. Written/edited files take precedence over read-only files. Complete compatible arrays stay in `details`, while the displayed section is bounded and modified-first. Unavailable older metadata is not an independent file archive.

Coverage reports source-window/character omissions, rejected selections/retirements, evidence/file display omissions, unavailable prior references and retirements. Recovery text includes the transcript path when one exists, entry/block/span locators, and at most four omitted-source locations. In-memory sessions explicitly have no transcript file. These are recovery pointers, not automatic retrieval or a guarantee that omitted material can be recovered.

## Budgets: soft target versus safety bounds

Let `C` be the current model's context window, `R = min(C, Pi reserveTokens)`, and `G = min(R, positive model.maxTokens)` (or `R` when that model limit is unknown). Invalid context/reserve settings cause input-budget fallback.

For estimated content size `T` of the prior summary, prepared history and split-turn prefix, excluding fixed instructions and the extra catalogue:

```text
hermesTarget   = max(2000, min(floor(0.20*T), floor(0.05*C), 10000))
responseTarget = min(hermesTarget, G)
```

`responseTarget` is guidance, not a rejection threshold. A complete result above it is accepted if it fits the safety bounds. The plugin **does not pass an explicit `maxTokens` option**; SDK/provider/model limits still apply, and generation is not unlimited.

| Bound | Value |
| --- | --- |
| Final rendered summary | `R` estimated tokens; normally 16384 |
| Raw response, before trimming | `16 * R` UTF-16 code units; normally 262144 |
| Four semantic lists combined | At most 128 items; no separate 24-item/category limit |
| Semantic scalar/list item length | No independent 2000/1000-character gates; shared bounds still apply |
| Quote proposals / retirement proposals | At most 32 each; an oversized group is rejected and counted |
| One quotation | At most 1200 UTF-16 code units |
| Source catalogue | At most 6144 estimated tokens, reduced further when input space is short |
| Evidence / displayed files | Target ceilings 1536 / 512 estimated tokens, within remaining `R` |
| Request headroom | `G + 4096`, in addition to the complete request and system prompt |

The plugin uses Pi's public token estimator, not an exact tokenizer guarantee. History uses Pi's public serialization, including its own tool-output limits. The plugin reduces the extra source catalogue rather than adding separate history slicing. Rendering preserves complete semantic state and coverage/recovery scaffolding; if the total is too large, it reduces displayed files first, then whole quotations. It does not truncate semantic lists to manufacture success. If required content cannot fit, synthesis fails and Pi may fall back natively. These constants are initial choices, not proven semantic-quality optima.

## Failure and cancellation

All ordinary extraction failures allow Pi's native fallback: unavailable model/auth, provider error, length-limited output, invalid tool arguments/schema, invalid source boundaries, and input/semantic/render budget failures. Ordinary text and raw JSON are not accepted as continuity results. When the model omits `submit_continuity`, calls a different tool, or returns multiple tool calls, the plugin re-asks at most twice; exhausting those attempts falls back natively. A named tool call with invalid arguments is not repaired or retried. Individual structurally valid but unverifiable quotations can still be rejected while a valid semantic summary is committed, with coverage counts.

An explicit host/user cancellation or provider `aborted` result is different: the extension does not intentionally fall back or continue that cancelled request. A missing replacement returned alongside an already-aborted host signal is not permission to restart work.

Failures produce a bounded UI warning or one headless stderr line with a reason code. They do not create diagnostic chat messages or include raw provider errors, credentials or conversation text. Native fallback may make additional requests, has its own limits/retries, can itself fail, and does **not** guarantee source-verified retention. Conversely, a schema-valid but semantically wrong summary is not detected automatically and need not trigger fallback.

## Verification and its limits

```sh
npm test
npm run check
npm run test:e2e:upstream-pi
npm run test:e2e:xz-dev-pi
```

The host harness packs the extension, loads that package into isolated test sessions and uses a **faux provider**, not a real model. It builds the selected host through its existing root `build:offline` chain and validates the cached build. CI cache recipe and local validation use recipe 4. `E2E_HOST_SHA` can freeze the host revision instead of resolving its current `main`.

Mechanically verified host revisions:

| Host | Pi version | Commit |
| --- | --- | --- |
| `earendil-works/pi` | 0.85.1 | `f9bcd351dc3cedf989bc5fc0f8aa012db5737df2` |
| `xz-dev/pi` | 0.85.1 | `5b3df0ae01f0184fa746d6c78df1eec6873202ab` |

The scenarios cover default compact-only and explicit compact-and-continue manual behavior, explicit user-request context after default commits, commit-before-continuation ordering, three compactions and fresh-extension JSONL reload, exact evidence and files in later model context, corrections, sibling isolation, native-gap reconstruction, mode-specific native fallback success/failure, cancellation, duplicate commands, auth/usage, and automatic ownership. Each host run has a host-specific faux request receipt; at the **faux response factory after SDK normalization**, plugin requests have no `maxTokens` value and native requests have `13107`; this is not an HTTP-wire measurement or a statement about every provider. The threshold fixture changes the model window after the host's pre-prompt check to exercise scheduling; it is not a live capacity benchmark.

The [synthetic corpus](tests/fixtures/README.md) defines nine histories, expected source/state annotations and next-action outcomes after at least three compactions and reload. Deterministic tests validate its structure, not model choices. **Real-model semantic fidelity and the baseline/candidate/Hermes behavioral comparison have not been verified.** They require separately approved model access, data and cost. Wrong continuation behavior fails that evaluation even when source copying, tool-schema validation and persistence pass.

## Reference choices

The primary reference is Hermes Agent's [runtime `ContextCompressor`](https://github.com/NousResearch/hermes-agent/blob/6e2b8e070d28b1a3381a3fb290b6b8d6cce13cef/agent/context_compressor.py), pinned to `6e2b8e070d28b1a3381a3fb290b6b8d6cce13cef`: content-scaled guidance, initial/update reconciliation and bounded recovery context. This is not its offline trajectory compressor, and no Hermes database, retrieval or scheduling subsystem is imported.

[pi-continue v0.9.3](https://github.com/Tiziano-AI/pi-continue/tree/42fa058aab1f2d9bb3b7768ac304e69f18c3a1e7) is supplementary for reconciliation and message filtering. Its artifact/AGENTS state machine and fail-closed policy are not adopted. Reference-inspired design is not a measured equivalence or improvement claim.

## Security

Pi extensions have Pi's system access. Review this repository before installation. Raw stock-Pi `user` roles are a provenance convention, **not authentication against other extensions or an untrusted transcript editor**. Hashes bind the copied span to its source coordinates; they do not prove authorship, selection completeness or model obedience.

History, prior summaries, files and quotations are framed as untrusted data. Strict output validation and exact copying do not eliminate prompt injection or make the model a security boundary. The prompt asks the model not to select secrets, but that is not a secret detector: selected text is sent to the current provider and persisted in the summary. Do not include credentials or other sensitive material on the assumption that compaction will remove it.

## License

MIT
