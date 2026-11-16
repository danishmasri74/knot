# Ask Knot prompt caching plan (draft, 11 November 2026)

**Decision, 16 November 2026: steps 2–4 are on hold; step 5 is implemented.** Local
diagnostics from after compaction (11–15 November, real usage) showed caching cost more
than it saved: US$0.060 in write surcharges against US$0.038 in read savings, out of
US$0.81 spent. Most note questions were never followed up within the 30-minute cache
lifetime (about 2 in 11, below the roughly 26–28% break-even). When a quick follow-up did
come on an unchanged note, implicit caching already hit (18,031 of 18,061 input tokens
read). No chat had a note edit between turns, which is the only case snapshots and deltas
(steps 3–4) improve. Settings → AI → Usage & diagnostics now shows the cache's net effect,
the write extra and savings per operation, and follow-up counts. Next decision, once real
usage has accumulated: keep writing on first questions, or write only from the second
turn. Either is a small change in `one_shot`/`request_body`, not the delta machinery.
Note also that automatic-mode instructions plus tool schemas are now about 2,000 tokens,
above the 1,024-token minimum, so that shared prefix can be read across chats within
30 minutes (seen once: 2,024 cached tokens on a new chat). The step 2 finding that L0 is
too short no longer holds for automatic requests.

Status: step 1 implemented on 11 November 2026 (`one_shot` and
`EXPLICIT_CACHE_MODELS` in `src-tauri/src/ai.rs`, covered by
`one_shot_requests_skip_cache_writes_on_explicit_models_only`). Live check in the
installed app, 11 November 2026: a workspace question on GPT-6 Luna returned HTTP 200
with 1,335 input tokens, 0 cached and 0 cache writes (est. US$0.000177).
Instructions were 3,514 of 6,505 payload bytes, so they are about half the input
of a workspace question. Steps 2–5 remain proposals. Pricing and API behavior verified against
[OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
on 11 November 2026; re-verify before implementation.

## Why

GPT-5.6 and later models (all four GPT-6 models Knot offers) cache **implicitly by
default**: every request writes a cache entry ending at its latest message. Writes are
billed at **1.25× input** (30-minute TTL) or 2.5× (12-hour TTL). Reads are 0.1× input
(0.05× for Terra and Sol). A write pays off only if a later request reuses it.

Knot does not control caching today (`src-tauri/src/ai.rs`, `request_body`):

- **Unreused writes cost extra.** Workspace questions send only the latest message
  with freshly retrieved evidence, suggestions are one-shot, and Rewrite/Insert/
  Canvas requests are usually single turns. Their implicit writes are rarely read, so
  these requests pay up to 25% more than uncached input. The 5 November benchmark saw
  positive `cache_write_tokens` on 10 of 60 calls.
- **The instructions change from request to request.** The base instructions get
  formatting, canvas, workspace, web and citation-marker rules spliced in, and end
  with `Current operation: {mode}`. Switching mode within a chat, or adding a website
  source, changes the prefix from the first token on.
- **Live note context comes first.** `input[0]` is the full document context, before
  history. When the note is unchanged between turns, the prefix matches and caching
  works. Any edit to the note (an autosaved keystroke, or applying an AI proposal)
  rewrites `input[0]`. The next turn then misses the cache and pays a full new write.
- **No accounting key.** There is no `prompt_cache_key`.

GPT-5.4 and GPT-5.4 mini cache automatically, have no write surcharge, and use the
older `prompt_cache_retention` / routing-key semantics. They need no layout changes
and must not receive GPT-5.6+ parameters.

## Goals

1. Never pay for a write that is unlikely to be read.
2. Make note-scoped follow-up turns read the instructions, the context and most of the
   history from cache, including after small note edits.
3. Keep answers, citations, proposal validation and Apply/Undo behavior unchanged.
4. Measure the effect with existing diagnostics before and after.

Non-goals: changing models or reasoning effort, compressing context
([separate idea](#later-related-work)), and caching across chats or workspaces.

## Design

### 1. Explicit cache mode, gated by model

Add a per-model capability (`cache_api: Explicit | Legacy`) beside the curated model
list. For `Explicit` models send `"prompt_cache_options": {"mode": "explicit", "ttl": "30m"}`,
so writes happen only at the breakpoints Knot marks. `Legacy` models get no cache
parameters. Unknown models default to `Legacy`, so an unrecognized parameter can
never cause a 400.

Default TTL stays 30m. A 12-hour TTL costs 2× as much to write and is only worth it
for shared prefixes reused across sessions. Nothing in Knot qualifies yet.

### 2. A layered prefix with stable bytes

Move instructions out of the top-level `instructions` field, which cannot carry a
breakpoint, into developer messages. Order everything from most stable to least stable:

| # | Item | Changes when | Breakpoint |
|---|------|--------------|------------|
| L0 | **Core developer block**: identity, untrusted-context rule, citation contract. Byte-identical for every mode and request. | App version | ✔ when the request is reusable |
| L1 | **Operation block**: mode rules (formatting, canvas, web, workspace, citation markers) as fixed constants. The `text.format` schema is chosen per mode. | Mode / source type | — |
| L2 | **Context snapshot**: document context captured at the chat's *base revision*. | Rebase (see 3) | ✔ |
| L3 | **History**: earlier turns, verbatim. | Each turn appends | ✔ on the latest assistant turn |
| L4 | **Context update** (only if the note changed since L2) + the new user message, with any image/PDF. | Every turn | — |

Rules:

- Every L0/L1 string is a `const`. Remove `str::replace` patching and runtime
  `format!` interpolation. `Current operation` moves into L1 as fixed text per mode.
- At most 3 explicit breakpoints per request (the API allows 4 writes).
- L0 alone (~700–900 tokens) is below the 1,024-token minimum. It becomes cacheable
  together with L1/L2, so placing its breakpoint costs nothing when the prefix is too
  short to write.

### 3. Context snapshots with deltas instead of rewrites

For note-scoped (explicit-source) chats only:

- The first turn sends the full context as L2 and records its base revision and
  serialized byte length in the chat's frozen request.
- On later turns, if the live context equals the base snapshot, send no L4 context.
- If it differs, append an L4 **context update** that lists the changed, added and
  removed blocks by citation ID, and says that it supersedes L2 for those blocks.
  L2 and L3 stay byte-identical, so the cache prefix survives the edit.
- **Rebase** to a fresh full L2 (accepting one new write) when the delta exceeds
  ~30% of the snapshot size, block order changed substantially, the source set
  changed (another document was added or removed), or the last request was more than
  30 minutes ago (the cache has expired anyway).
- Citation IDs must stay stable across a snapshot and its deltas. New blocks get
  new IDs and are never reused. Citation resolution still verifies the source
  against the frozen request, so stale IDs keep today's "changed paragraph" error.

Workspace, web-only and no-note requests keep sending only the latest message with
freshly retrieved evidence. They mark **no breakpoints**, so no write is paid.

### 4. When to write

| Request | Breakpoints |
|---------|-------------|
| Note-scoped Ask, first turn | L0, L2 (a follow-up is likely) |
| Note-scoped Ask, follow-up | L0, L2, latest L3 |
| Rewrite / Insert / Canvas, first turn | none (usually one turn) |
| Rewrite / Insert / Canvas after an Ask turn in the same chat | L0, L2 (reads the Ask entries) |
| Workspace / web-only / no-note Ask | none |
| AI suggestions | none |
| Edit-and-resend, Regenerate | same as the turn they replace (the shared prefix up to the edited message is read) |

Revisit this table with real hit-rate data from diagnostics (step 6) instead of
guessing further.

### 5. `prompt_cache_key`

Send a stable, non-identifying key per chat (`sha256(chat UUID)` truncated) only for
per-key cache accounting on Explicit models. It must not contain workspace, document
or user identifiers. Legacy models also get it, because it improves their routing.

### 6. Measurement

Diagnostics already capture `cached_tokens`, `cache_write_tokens` and the TTL
breakdown. Add, without content:

- `cache_mode` (`explicit` / `legacy` / `none`), breakpoint count, and whether L4
  carried a delta, a rebase or nothing.
- Settings → Usage & diagnostics: cache read %, write %, and estimated saving vs.
  uncached, filterable by operation.

## Verification

- **Rust unit tests** (offline):
  - L0 is byte-identical across all modes.
  - L0–L3 bytes of turn *n* equal the matching prefix of turn *n+1* when the note is
    unchanged, and after a small edit (delta path).
  - Rebase triggers at its thresholds.
  - Legacy models receive no `prompt_cache_options`.
  - Workspace and suggestion payloads contain no breakpoints.
  - Strict schemas are unchanged.
  - The existing `payloads_identical_to_baseline_*` test is updated deliberately,
    with the new baseline reviewed.
- **Browser/native tests**: the existing `tests/ai.browser.mjs` and
  `tests/native/ai.mjs` mocked flows pass unchanged: citations, stale proposals,
  Apply/Undo, edit/regenerate, and saved-chat reopen with delta-era requests.
- **Quality**: rerun `knot-quality-v1` on GPT-6 Luna with mocked transport to confirm
  identical payload semantics. A live paid rerun (the follow-up and rewrite cases
  matter most) requires explicit user authorization and a budget, as on 5 November.
- **Cost check**: a scripted 5-turn note chat with one edit between turns 3 and 4.
  Expect turns 2–5 to read most input from cache, and workspace questions to show
  zero `cache_write_tokens`.
- Installed-app update via `pnpm update:running`.

## Rollout

1. Capability table + explicit mode with **no breakpoints** for workspace,
   suggestions and single-turn edits. Low risk; removes unreused writes.
   Note: per the docs, explicit mode without breakpoints also skips cache *reads*.
   That is acceptable for these requests, which rarely share a written prefix.
   Done.
2. Stable const L0/L1 in developer messages, plus `prompt_cache_key`.
   **Finding (11 November 2026):** this step alone saves almost nothing. The shared
   core instructions are ~2.9 KB (~600 tokens), below the 1,024-token minimum, so
   L0 can never be cached by itself. Mode rules and the `text.format` schema differ
   per mode, so switching modes still breaks the prefix right after L0. Within one
   mode the instructions are already byte-stable today. Canvas uses separate
   instructions entirely, and web requests patch one sentence of the core text.
   The restructure is only worth doing together with step 3.
3. Context snapshot + breakpoints for note-scoped chats (no deltas yet: any change
   rebases).
4. Context deltas and rebase thresholds.
5. Diagnostics cache columns and Settings view (can ship with step 1 to get a
   baseline). **Done 16 November 2026:** each attempt's write extra and read saving
   (`cache_effect` in `src-tauri/src/diagnostics.rs`, at current rates) and a
   "Prompt caching" summary with a per-operation breakdown in Settings.

Each step is independently shippable and measurable. Stop after step 3 if deltas do
not pay for their complexity in the measured data.

## Risks and open questions

- **Instruction placement.** Moving instructions from `instructions` into developer
  messages could change model behavior slightly. Compare benchmark outputs before
  step 2 ships.
- **Delta comprehension.** The model must apply "supersedes" correctly. Benchmark
  follow-up cases with an edit in between before shipping step 4.
- **Prefix ordering.** The docs do not say where `text.format` sits in the rendered
  prefix. Keep the schema fixed per mode and verify reads empirically.
- **Minimum length.** Short notes may never reach 1,024 tokens. That is acceptable:
  small requests are cheap anyway.
- **Cancelled requests** may still incur writes. Accept this.

## Measured usage (local diagnostics, 5–11 November 2026)

34 recorded attempts; sizes and token counts only.

- **Implicit caching already works for unchanged note follow-ups.** A GPT-6.1 Sol
  note chat wrote 67,902 tokens, and its follow-up read 67,902 and wrote 950.
  Steps 3–4 can only improve the edited-note and mode-switch cases.
- **Large unreused writes dominate.** Single-turn requests wrote 20k–62k tokens each
  at 1.25× (Terra canvas, Sol ask). Step 1 now skips the canvas/edit ones. One
  canvas retry did read 24,553 cached tokens, so regenerating a one-shot proposal
  now pays full input instead of a cache read. The break-even retry rate is ~26%.
- **Context duplication is the largest cost, larger than any caching gain.**
  Current-note requests send the note three times: `text`, `structure` (blocks
  with IDs, types and parents), and `citationSources` (each block again, with
  document ID and note title repeated per entry). Example: 15.6 KB of note text
  became 164.7 KB of context (text 15.6 + structure 61.0 + citation table 87.9 KB)
  and 67,905 input tokens. A compact form (one copy of each block, with an `[S#]`
  marker, heading level, list/checkbox marker and indentation; titles once per
  note; IDs mapped back locally) could plausibly cut such requests by ~80%.
  It also avoids hitting the 180 KB request ceiling.
  **Implemented 11 November 2026** in `src-tauri/src/ai_context.rs` (−71% context
  bytes on synthetic benchmark contexts; real-note effect to be read from
  `payload_bytes` in diagnostics). Follow-up the same day: the renderer no longer
  stores covered `structure`/`text` copies, so the unchanged 180 KB limit counts
  each block once. Simply raising the limit was rejected, because chats store
  frozen contexts in device storage. Revisit caching steps 2–4 once post-compaction data exists.

## Later related work

- Compact context serialization (plain text with `[S#]` markers instead of JSON)
  reduces both cached and uncached tokens. Do it after caching, so the two savings
  can be measured separately.
- History compaction for long note chats (older turns summarized). Do this after
  deltas, since compaction itself rewrites the prefix.
