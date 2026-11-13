# Ask Knot automatic actions (tool calling)

Design · 13 November 2026 · Approved · Phases 1 and 2 implemented 13 November 2026

## Phase 2 as built

Chosen 13 November 2026: the model decides when to search, accepting about 1–2 seconds and some tokens more on workspace questions in exchange for model-written queries and no search on questions about the open note.

- **The loop runs in the app**, because the query embedding is computed in the browser worker. Knot streams a `search_workspace` call with its `call_id`; the app runs `topicIndex().search(query)` and sends the next request with `searches` (call ID, query, evidence). `ai_respond` checks each evidence's sources against the workspace (`topic::validate`) and appends a `function_call` / `function_call_output` pair; the model receives only citation, title, text, attribution and coverage. At most two searches per message (`MAX_SEARCHES`); after the second the tool is no longer offered. Each round is its own request ID (`inflight` in `AskKnot.tsx`, so Stop cancels the round in flight); the message's cost is the sum of its rounds.
- **Citations continue the message's numbers**: excerpts are renumbered after the note's `[Sn]` before they are sent, and stored on the message (`request.searches`). The answer shows "Searched workspace for “…”", partial-coverage and keyword-only notes, and the excerpts in its sources.
- **Automatic messages always read what is open** (`resolveSourceMode` for `auto`): the open note, or nothing without one, plus attachments. The Source scope dropdown and the Workspace chip are gone; removing the note chip still sends no note context, and "Search my workspace" in the sparkles popover turns search off for one chat (Settings stays the master switch, which also controls indexing). `editIntent` now only steers automatic model choice.
- **Follow-ups**: automatic messages carry the chat's last three exchanges as the user's own messages, each reply reduced to "(Answered in chat…)" or "(Proposed …)" (`exchangeHistory`), so the model can write "drawbacks of spaced repetition" for "what are its drawbacks?". Answers, proposals and excerpts are never replayed.
- **Without an open note** an automatic message goes through the same loop with no note context (`sendWorkspace` with `auto`). Older chats' Ask messages and "Ask"-mode retries keep the search-first path.
- **"Just answer instead"** is now an automatic message with the edit tools removed, so it can still search.
- **Verification:** Rust tests for the search tool, result input and privacy of evidence fields; unit tests for resolution, history and tool selection; `tests/ask-auto-actions.browser.mjs` drives a search round trip; `chat-composer.browser.mjs` now covers the Abilities popover instead of the dropdown; routing cases 21–26 cover search.

## Phase 1 as built

Where the build differs from the design below:

- **Forced actions keep their response-format path.** Card suggestions, "Insert into note" and "Make canvas cards" send `mode: "insert"` / `"canvas"` with the existing `knot_edit` format rather than a forced `tool_choice`. The schema and rules are shared (`edit_schema`, `FORMATTING`, `CANVAS_RULES` in `ai.rs`), so both paths propose the same thing; the forced path stays covered by the existing benchmark and payload tests.
- **An automatic request with no possible tool is sent as Ask.** `ai_respond` accepts `mode: "auto"` only with 1–3 distinct known tools, and refuses tools with workspace-sourced context.
- **The Source scope dropdown stays until phase 2.** It now applies to every message. To keep edit requests on the open note instead of workspace search, `editIntent` in `ai-source-scope.ts` (an imperative edit verb, or "mind map", "as cards", "into the note") resolves automatic requests to the current note.
- **Model choice** uses edit intent: with tools offered and an edit-like message, automatic model choice prefers writing models, otherwise the Ask order.
- **Per-chat abilities** are stored with the chat only when they differ from Settings; otherwise the chat follows Settings live.
- **"Insert into note" / "Make canvas cards"** show the short label in the chat and send the answer as the message (`request.message`), because history isn't replayed for scoped requests.
- **Verification:** Rust tests for tool payloads and function-call streams, unit tests for abilities, tool selection, edit intent and proposal history, `tests/ask-auto-actions.browser.mjs` (mocked backend), and 20 routing cases in `tests/benchmarks/routing.v1.json`.
- **Routing runs on GPT-6 Luna (13 November 2026, US$0.50 approved limit, about US$0.0024 per run).** First run: 19/20 routes correct. Case 13 ("Rewrite this to sound more formal" with only the canvas tool offered) created a canvas card instead of answering, and case 19 routed correctly but its rewrite also returned `blocks`, which Apply refuses. Fixes: each tool's parameters now hold only its own fields (`tool_schema`; a rewrite can't return blocks, and the app restores the missing field before validating), and the routing rule says to answer when the tool for the requested change isn't offered. Second run: 20/20, no rewrite with blocks; case 13 answers with a formal version and says it can't edit here. Output quality is ungraded.

## 1. Problem

Before sending, the user has to pick a mode from the composer's **Writing actions** menu: Ask, Rewrite selection, Insert content, or Create on canvas. People forget, send in the wrong mode, then have to change it and resend. The menu is one of four controls that overlap:

| Control                                 | Where                                                   | What it decides                                                    |
| --------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------ |
| Writing actions menu + `rewrite ×` chip | Composer (`AskKnot.tsx`, `ShellMenu` "Writing actions") | What Knot does: answer, rewrite, insert, or create on canvas       |
| Source scope dropdown                   | Composer, Ask mode only                                 | What Knot sees: Automatic sources / Current note / No note sources |
| Search workspace automatically          | Settings → AI                                           | What "Automatic sources" means                                     |
| Note context chip                       | Composer                                                | Also switches scope between `current` and `none`                   |

So the user has to decide _what Knot should do_ and _what it may see_ before each message, using controls in two places. This redesign removes the mode choice and merges the overlapping controls into one model.

## 2. Product contract

- **The user types; Knot decides the action.** Knot infers the intent from the message and the context (selection, open note, open canvas, attachments).
- **Settings say what Knot may do.** A set of ability switches decides which actions Knot is _allowed_ to take.
- **Every write is still a preview.** A change to a note or canvas always arrives as today's preview, with Apply and Undo. Abilities control what Knot may _propose_, never what it applies without review.
- **Explicit actions stay explicit.** Entry points that already state an action, such as "Ask Knot about this card" or card suggestions, keep forcing that action.
- **When unsure, answer.** An ambiguous request gets a chat answer that the user can turn into an edit with one click.

Out of scope: applying changes without a preview, editing several documents at once, diagram editing, and changes to model selection or pricing beyond what routing needs.

## 3. Current implementation

Each mode builds a different request in `compose_body` (`src-tauri/src/ai.rs`):

| Mode      | Output                                                       | Mode-specific rules                                                                       |
| --------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `ask`     | Free text with `[S1]`-style citations                        | `BASE_CITATIONS`, `BASE_EVIDENCE`                                                         |
| `rewrite` | Strict `knot_edit` format (`replacements[]`, `blocks` empty) | `BASE_REWRITE`, `BASE_REWRITE_BLOCKS`, `BASE_EDIT`, formatting rules, no citation markers |
| `insert`  | `knot_edit` (`blocks[]`)                                     | `BASE_INSERT`, `BASE_EDIT`, formatting rules, no citation markers                         |
| `canvas`  | `knot_edit` + `connections[]` + `mindmap[]`                  | Separate long canvas instruction block (mind map vs. cards)                               |

Other things that depend on the mode:

- `BASE_LIMITS` tells the model "No browsing, tools, …", and web evidence rewrites that sentence with `str::replace`.
- Web evidence adds `sourceRefs` to every format field that holds text.
- `resolveSourceMode` / `usesNoteSources` (`src/services/ai-source-scope.ts`) branch on mode. Every mode except `ask` resolves to `legacy`.
- `automaticAiModel` (`src/services/ai-preferences.ts`) puts writing models first for every mode except `ask`.
- `ai_respond` accepts only `ask | rewrite | insert | canvas | suggestions`, and diagnostics record the mode.
- `outgoingSourceHistory` leaves proposal turns out of the history, so a follow-up can't refer to the last proposal.
- The menu is disabled whenever the context is a PDF (`disabled={!!context?.pdf}`).

Each mode's output format maps cleanly onto a tool's parameters, and each mode's instructions onto that tool's description. The citation split also maps cleanly: chat text uses `[S1]` markers, tool arguments use `sourceRefs`.

## 4. Design

### 4.1 Tools

One Responses API request per turn. Write actions are function tools with `strict: true`, `tool_choice: "auto"` and `parallel_tool_calls: false`, so there's at most one preview per answer.

| Tool                         | Offered when                                                    | Parameters                               | Replaces                               |
| ---------------------------- | --------------------------------------------------------------- | ---------------------------------------- | -------------------------------------- |
| `rewrite_selection`          | The selection has editable runs **and** Edit current note is on | `replacements[]` (one per supplied run)  | Rewrite mode                           |
| `insert_blocks`              | An editable note is open **and** Edit current note is on        | `blocks[]`                               | Insert mode                            |
| `create_on_canvas`           | A canvas target is available **and** Create cards is on         | `blocks[]`, `connections[]`, `mindmap[]` | Canvas mode                            |
| `search_workspace` (phase 2) | Search my workspace is on                                       | `query`                                  | Retrieval that runs before the request |
| `web_search` (phase 3)       | Search the web is on                                            | OpenAI's built-in tool                   | —                                      |
| `create_note` (phase 4)      | Create new notes is on                                          | title, `blocks[]`                        | —                                      |

Rules:

- **A tool that isn't allowed is never sent.** A disabled ability, a read-only context (PDF, website, image), or a missing target (no selection, no note) removes the tool from the request. The model can't call a tool it can't see. This replaces the PDF check on the menu.
- **Tool parameters reuse today's formats.** `rewrite_selection` gets `replacements` only; `insert_blocks` gets `blocks` only. With web evidence, `sourceRefs` is added to the tool's parameters the same way it's added to the format today.
- **Tool descriptions hold the mode rules.** The canvas instruction block, the formatting rules and the citation-marker ban move into the descriptions of the tools they apply to, as fixed constants, with no runtime `format!` (see `AI-PROMPT-CACHING-PLAN.md` §2).
- **Validation is unchanged.** The arguments of the tool call go through `validateProposal` exactly as the `knot_edit` output does today. Invalid arguments fail the turn the same way an invalid proposal does.

### 4.2 Routing instructions

A fixed routing section replaces `Current operation: {mode}` and the "No … tools" sentence in `BASE_LIMITS`:

> Answer in chat by default. Call a write tool only when the user asks to change, add to, or create something in their note or canvas ("rewrite", "shorten this", "add a section", "turn this into cards", "make a mind map"). Questions, explanations and summaries the user hasn't asked to put in the note get a chat answer. If it's unclear whether the user wants the note changed, answer in chat. When you call a tool, you may write one short sentence before it; never repeat the proposal's content in chat. Do not claim anything was applied: the user reviews every proposal.

### 4.3 Forced actions

`ai_respond`'s `mode` parameter becomes `auto` or the name of a tool to force.

| Entry point                                                  | Request                                                     |
| ------------------------------------------------------------ | ----------------------------------------------------------- |
| Ordinary composer message                                    | `mode: "auto"`, `tool_choice: "auto"`                       |
| "Ask Knot about this card", canvas card suggestions          | `tool_choice: {type: "function", name: "create_on_canvas"}` |
| "Insert into note" / "Make cards" button on an answer (§5.3) | Force that tool, with the answer as source material         |
| "Just answer instead" button on a preview (§5.3)             | `tool_choice: "none"`                                       |
| AI suggestions                                               | Unchanged: `mode: "suggestions"`, no tools                  |

A forced request behaves like the matching mode today.

### 4.4 History and follow-ups

A proposal turn is recorded in the history as a short summary (for example "Proposed a rewrite of 3 runs: applied" or "Proposed 6 canvas cards: dismissed"), not as its full content. "Make it shorter" after a rewrite then calls `rewrite_selection` again on the same runs.

- `outgoingSourceHistory` keeps proposal turns as summaries instead of dropping them.
- A re-proposal uses the runs and blocks captured on the latest turn, so a stale selection never gets edited. If the selection has changed, the new capture wins and the preview says so.
- Workspace and source-less requests keep sending only the latest message (today's `one_shot` behavior).

### 4.5 Model selection

`automaticAiModel` can't use the mode any more. Its inputs become: context size, attachments, whether write tools are offered, and the existing reasoning keywords.

- Write tools offered and a selection or canvas involved → writing models first (today's non-`ask` order).
- Otherwise → today's `ask` order.

If benchmarking shows Luna proposes noticeably worse than Terra, an option is a second request: when a quick model calls a write tool, the arguments are regenerated on a writing model with that tool forced. That costs one extra request only for write turns. Decide after measuring.

### 4.6 Streaming

- Text deltas stream as they do today.
- When a function call starts (`response.output_item.added` with type `function_call`), the turn shows "Preparing preview" as forced modes do today.
- The arguments are collected and parsed when the call completes, as `JSON.parse(output)` does today.
- Cancelling works the same way.

### 4.7 Caching and cost

The tool definitions are the same for every request with the same abilities and context type, so they should be part of the cached prefix:

- Order the request as: core instructions → routing section → tools → context → history → message. Re-verify where the API places `tools` in the cached prefix before implementing.
- The canvas tool description is the largest addition (≈1–1.5k tokens across all tools). It is sent on every request where it is offered, even a plain question. Cache reads make this cheap after the first request in a chat. Measure on the first request.
- `one_shot` currently disables cache writes for single-turn Rewrite/Insert/Canvas requests. With a stable prefix shared across every request, writes become worth paying. Revisit the table in `AI-PROMPT-CACHING-PLAN.md` §4 with this change.
- Diagnostics record `auto:<tool>` / `auto:answer` / `forced:<tool>` instead of the mode, so cost and success can be compared per action.

## 5. UI

### 5.1 Composer

- **Removed:** the Writing actions menu, the `{mode} ×` chip, the mode-dependent placeholders, and the Source scope dropdown.
- **Placeholder:** one text, "Ask, write, or edit…", except the existing image placeholder.
- **The sparkles button becomes an Abilities popover** (`ChoicePopover` styling per `AGENTS.md`), listing the switches from §6 for this chat. The button shows a dot when this chat differs from the Settings defaults.
- **Context chips** show what will be used. Removing the note chip excludes the note (today's `none`). A "Workspace" chip appears only when workspace search will actually run.

### 5.2 Previews

The preview card is labelled by what Knot did ("Suggested rewrite", "Suggested addition", "Suggested canvas"), with the model's one-sentence note above it. Apply/Undo is unchanged.

### 5.3 Ways to correct a wrong choice

- **"Just answer instead"** on every preview reruns the same message with `tool_choice: "none"` and replaces the preview.
- **"Insert into note" / "Make cards"** on every chat answer force the matching tool, using that answer as the source. They show only when the tool would be offered (§4.1).

## 6. Settings

Settings → AI gets an **Abilities** group:

| Switch                     | Default             | Notes                                                                         |
| -------------------------- | ------------------- | ----------------------------------------------------------------------------- |
| Search my workspace        | on (existing value) | Migrated from "Search workspace automatically", keeping the stored value      |
| Search the web             | off                 | Phase 3. Explains that queries go to the AI provider's search                 |
| Look at images in my notes | on                  | Phase 3. Only images Knot pulls in by itself; attached images are always read |
| Edit the current note      | on                  | Rewrite and insert                                                            |
| Create cards on canvas     | on                  |                                                                               |
| Create new notes           | off                 | Phase 4                                                                       |

Unchanged: **AI features** (master switch, takes precedence), **AI suggestions**, **Default connector shape**, **Model list**.

No ability switch for attached PDFs or images: attaching a file means the user wants it read.

Per-chat overrides from the composer popover are stored with the chat. They never change the Settings defaults.

## 7. Phases

### Phase 1: automatic routing

- `ai.rs`: `mode: "auto"`, tools `rewrite_selection` / `insert_blocks` / `create_on_canvas`, routing section, forced `tool_choice`, function-call streaming.
- `AskKnot.tsx`: remove the menu, chip and mode placeholders. Capture runs and the note on every send where the tools may be offered. Build the tool list from the abilities and context. Add the "Just answer instead" and "Insert into note" / "Make cards" buttons.
- Abilities: Edit the current note and Create cards on canvas, in Settings and the composer popover.
- History summaries for proposal turns (§4.4).
- `automaticAiModel` and diagnostics updated (§4.5, §4.7).
- Benchmark: routing cases added to the suite in `tests/benchmarks/`.

### Phase 2: workspace search as a tool

- `search_workspace(query)` runs the existing device-local retrieval and returns the excerpts as a tool result. The request loops until the model answers or proposes.
- Replaces searching before every request; the model decides when to search and what to search for.
- The Source scope dropdown is fully gone; follow-up inheritance (`inherited` in `resolveSourceMode`) is replaced by the model's own queries.
- Limit: at most 2 searches per turn.

### Phase 3: web search and images

- OpenAI's built-in `web_search` tool. Its link citations are mapped into `WebSourceList` and the existing web citation rules. The web evidence instructions are reworded for search results instead of captured pages.
- Look at images in my notes.

### Phase 4: create new notes

- `create_note` with the same preview-then-apply flow.

## 8. Verification

- **Routing benchmark** (phase 1 must pass before shipping). Cases include:
  - "What does this paragraph mean?" with a selection → answer
  - "Summarise this" → answer; "Summarise this into the note" → `insert_blocks`
  - "Make this shorter" with a selection → `rewrite_selection`; without one → answer
  - "Turn this into a mind map" on a canvas → `create_on_canvas`
  - "Rewrite this" with Edit current note off → answer saying editing is turned off
  - PDF context, "rewrite this page" → answer, no tool offered
  - Follow-up "shorter" after a rewrite → `rewrite_selection` on the same runs
- **Regression:** existing proposal validation, citations, web evidence `sourceRefs`, Apply/Undo, card suggestions and forced canvas.
- **UI:** the Abilities popover in light and dark themes, keyboard selection and dismissal, and staying inside the window, per the dropdown rules in `AGENTS.md`.
- **Cost:** compare diagnostics for a week before and after: input tokens, cached tokens, and cost per turn.

## 9. Risks and open questions

- **Wrong routing.** The model edits when the user wanted an answer, or the reverse. Mitigations: previews, "Just answer instead", answer-side buttons, and the benchmark. Track how often "Just answer instead" is used after release.
- **Quick models writing weaker proposals** (§4.5). Measure before adding a second request.
- **Larger requests for plain questions** (§4.7). If caching doesn't cover it, offer `create_on_canvas` only when a canvas is open or the message mentions cards/maps.
- **Selections that change** between a proposal and a follow-up (§4.4).
- **Old chats** saved with a `mode` keep rendering as they do today; new turns in them use `auto`.
- **API details** (function-call streaming events, `tool_choice` shapes, the built-in web search tool, caching with tools) must be re-verified against OpenAI's documentation before implementing.
