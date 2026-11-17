# Rich Ask Knot answers

Status: implemented 17 November 2026 (releases A, B and C). Designs chosen from the canvas at https://claude.ai/artifact/Br2YK5afwPh9ggQr4DZatA: progress proposal A (step list), quiz proposal A (stacked), sections proposal A (fold in place with Cover answers).

## Goal

Ask Knot answers today are a thin Markdown subset drawn by a hand-written renderer. Make answers as readable and usable as current chat apps, and use what only Knot has: every rich piece of an answer can become real notebook content (a table block, to-do list, quiz card), and citations can show the user's own slides.

Five parts, shipped in three releases:

| Release | Parts | Why together |
| --- | --- | --- |
| A | 1 Full Markdown, 5 Progress steps | Every answer improves; low risk; no new answer formats |
| B | 3 Inline quiz | The headline feature; builds on part 1's parser |
| C | 2 Slide thumbnails, 4 Collapsible sections | Polish on top of the new renderer |

## Current state (verified)

| Area | Today | Consequence |
| --- | --- | --- |
| Answer rendering | `ChatText` in `src/app/AskKnot.tsx` splits lines itself: `#`–`###` headings, flat `-`/`1.` lists, ``` code, `**bold**`, `` `code` ``, `[S1]` markers, PDF page links | Tables, nested lists, `- [ ]`, italics, links, quotes and images show as raw text or lose structure |
| Markdown library | None in `package.json` | Part 1 adds one |
| Add reply as one card | `addTurnAsCard` saves the whole answer as one paragraph block | Headings, lists and tables are lost when saved |
| Copy | `copyTurn` copies the raw text | Fine as Markdown; no rich clipboard |
| Progress | One `activity` string on the draft turn ("Searching the web", "Looking at the canvas"), else "Thinking…" or "Preparing preview…" | No sense of multi-step work such as reading three files |
| Quizzes | `create_quiz` tool → previewed proposal → `applyAiProposal(…, "quiz")` writes MCQs to Card Deck (`AiQuestion`, `validQuizQuestions`, `quizDefinition` in `src/services/ai-quiz.ts`) | Part 3 reuses validation and saving; only the chat player is new |
| PDF pages | `preparePdfInput` renders a page to a large JPEG for the model; `pdf-citations.ts` resolves "(slide 3)" to a file and page | Part 2 adds a small cached thumbnail renderer |
| Instructions | `BASE_CORE` and friends in `src-tauri/src/ai.rs`; no Markdown guidance for chat answers | Parts 1 and 3 add short rules; tests in `ai.rs` assert where rules apply |

## Part 1: Full Markdown

### What renders

| Markdown | In the answer |
| --- | --- |
| `#`–`####` | Headings, scaled for the panel (largest is the current `h4` size) |
| `*italic*`, `**bold**`, `~~strike~~`, `` `code` `` | Inline styles; bold may contain citations and slide links |
| Nested `-` / `1.` lists | Real nesting, any depth (indent capped visually at 4 levels) |
| `- [ ]` / `- [x]` | Checkbox list. Display only in chat; Add to note makes real to-dos |
| Tables (GFM, with alignment) | Bordered table, horizontal scroll inside the answer when wide, header row sticky within the table |
| `> quote` | Quote with a left rule |
| ``` fenced code | Code block with a small Copy button; no syntax colouring |
| `---` | Divider |
| `[text](https://…)` | Link; opens with the existing `openWebLink`. Only `http`, `https` and `mailto`; anything else shows as text |
| `![alt](…)` | Not loaded (remote images are blocked by CSP and untrusted). Shown as the alt text with an image icon. Part 2 covers images that matter (the user's slides) |
| Raw HTML | Shown as text, never interpreted |

Citations (`[S1]`, video moments) and PDF page links keep working anywhere text appears: in table cells, list items, quotes, bold.

### How

- Parse with `mdast-util-from-markdown` plus `micromark-extension-gfm` / `mdast-util-gfm` (tables, task lists, strikethrough). It yields a syntax tree with no HTML step, about 50 KB. Pin exact versions.
- New `src/services/answer-markdown.ts`: `parseAnswer(text) → tree` and `answerBlocks(tree) → AiBlock[]` (headings, paragraphs, bulleted/numbered/todo, table; nested lists flattened into children where `AiBlock` allows).
- New `src/app/AnswerMarkdown.tsx`: walks the tree into React elements. Text nodes go through the existing citation and PDF-link splitter (moved out of `ChatText` into a shared `renderInline`). No `dangerouslySetInnerHTML` anywhere.
- `ChatText` becomes a thin wrapper around `AnswerMarkdown`, keeping its props (`context`, `pdfs`, `onPdf`).
- Streaming: re-parse the whole answer on each existing 80 ms update. An unclosed code fence shows as a code block in progress; a table appears once its header and divider rows have arrived. Measured target: under 2 ms for a 20 KB answer.
- Styles in `src/styles/app.css` under `.ask-prose`, theme-aware, checked in light and dark.

### Saving

- **Add reply as one card** uses `answerBlocks`, so headings, lists, to-dos and tables arrive as native blocks instead of one paragraph of Markdown.
- **Copy** keeps plain Markdown, and also puts simple HTML on the clipboard so pasting into Word or email keeps tables and lists.

### Instructions

One sentence added to chat-answer rules in `ai.rs` (not to edit modes, which already use native blocks): use GitHub Markdown when it helps (tables for comparisons, `- [ ]` for checklists, `>` for quoting a source); never HTML; don't force formatting onto short answers. Update the rule-placement tests. This changes the instruction prefix once, so the first request after the update misses the prompt cache.

## Part 5: Progress steps

### What the user sees

While Knot works, a short step list above the answer replaces "Thinking…":

```
✓ Read 3 files
✓ Searched your notes
● Writing…
```

When the answer finishes, the list folds into one quiet line under the author row, for example "Read 3 files · Searched your notes · 14 s", which expands on click. No percentage bar: Knot can't know how far the model has got. Counts appear only where they are real ("Reading files · 2 of 3").

### Steps and where they come from

| Step | Started / finished at |
| --- | --- |
| Reading websites (n) | `captureWebSources` |
| Reading files (n) / Reading the PDF | `preparePdfFiles` / `preparePdfInput` |
| Preparing the image | `prepareAiImage` |
| Reading added notes | loading `added` notes in `send` |
| Searching your notes | `search_workspace` call and its results |
| Searching the web | web search status events |
| Looking at images / at the canvas | `view_images` / `view_canvas` calls |
| Thinking | request sent → first text or tool delta |
| Writing | first text delta → done |
| Preparing preview | tool-call arguments streaming → proposal ready |
| Finding excerpts | the existing post-answer excerpt capture |

### How

- Replace `Turn.activity` with `steps: { id; label; state: "active" | "done" | "failed"; detail? }[]`, updated through one small reducer (`startStep`, `finishStep`, `failStep`) in a new `src/services/ask-steps.ts`.
- Persist only the finished labels (a few strings) so reopened chats keep the summary line; failures mark the step and leave the error message where it is today.
- A step that finishes in under 300 ms isn't drawn on its own, so quick answers show only "Writing".

## Part 3: Inline quiz

### What the user sees

When you ask to be tested ("quiz me on this", "give me 5 practice questions"), the answer contains real multiple-choice questions:

- Questions stacked in a compact card using the existing MCQ styles (`src/styles/mcq.css`), not the editor's `knot-mcq` element (it needs a BlockSuite document).
- Choose an option to see right or wrong at once, with the explanation. Answers can't be changed after choosing (like the note player); **Try again** resets the whole quiz.
- A footer shows the score ("3 of 5 correct") and **Save as quiz card**. Saving creates a quiz card next to the source, like an applied `create_quiz` proposal, with Undo and Show quiz. Without an open notebook the button is disabled with a reason.
- Your choices are stored on the chat message, so reopening the chat keeps them. They don't touch Card Deck progress until saved.

### Format

The model writes a fenced block inside its normal answer:

````
```knot-quiz
{"questions":[{"question":"…","options":["…","…"],"correct":1,"explanation":"…"}]}
```
````

- Validated with `validQuizQuestions`, capped at 10 questions in chat.
- While streaming: a "Preparing quiz…" placeholder until the fence closes.
- Invalid or truncated JSON: a small "This quiz couldn't be shown" note and the questions as plain text, never broken output.
- Copy and Add reply as one card turn the quiz into `quizLines` text.

### Instructions and routing

- Chat-answer rules: use `knot-quiz` only when the user asks to be quizzed or tested or for practice questions; otherwise never. Questions come from the supplied sources; options unique; one correct answer.
- `AUTO_ROUTING` / `create_quiz` rules: "quiz me" answers inline; "make / add a quiz card" or "add questions to my note" uses `create_quiz` as today.
- Next-step chip "Quiz me on this" (follow-ups) switches to the inline quiz, since it's lighter than a card proposal; the card is one click away through Save.

### How

- `src/services/answer-markdown.ts`: code nodes with language `knot-quiz` become a `quiz` node.
- New `src/app/AnswerQuiz.tsx` (player, score, Save).
- Saving calls `applyAiProposal(doc, workspace, turn.context, { questions, target: "card", … }, "quiz")`, reusing placement, linking, Undo and Trash behaviour.

## Part 2: Slide thumbnails in citations

### What the user sees

- Hovering (300 ms) or focusing a PDF citation link shows a small preview: the page image (about 320 px wide), the file name and "slide 3". Clicking the link still opens the reader at that page.
- At the end of an answer about PDFs, an optional "Slides cited" row shows up to 6 small thumbnails in citation order; clicking one opens it.
- A page number past the end of the file shows "This file has no slide 12" instead of an image.

### How

- New `renderPdfThumbnail(key, page, width)` in `src/services/pdf-input.ts`: renders with pdf.js at thumbnail scale to a JPEG object URL.
- An in-memory cache of 24 thumbnails and 2 open PDF documents (opening a file is the slow part), released when the chat closes.
- The preview popover uses shared theme tokens, stays inside the viewport, closes on Escape and when the pointer leaves.

## Part 4: Collapsible sections

### What the user sees

- An answer with 4 or more sections at the same heading level and more than about 1,500 characters gets a chevron on each heading; click to fold or unfold that section.
- A small toolbar above such answers: **Collapse all / Expand all** and **Cover answers**. Cover answers folds every section so only the headings show, for recall practice ("What does component testing test?"), then expand to check. This directly supports the revision method Ask Knot itself suggests.
- Everything starts expanded; nothing jumps while streaming.

### How

- Renderer only, no model change: `AnswerMarkdown` groups nodes under headings when the rule above holds.
- Fold state lives in memory per message; buttons have `aria-expanded` and work with the keyboard.

## Testing

| Part | Automated | By hand |
| --- | --- | --- |
| 1 | Parser and `answerBlocks` unit tests; render tests with `react-dom/server` for tables, nested lists, task lists, links (safe schemes only), raw HTML as text, citations inside tables and bold | Light/dark, narrow panel, a streamed table, Add reply as one card |
| 5 | Step reducer tests; under-300 ms steps hidden | A 3-file question; a web search; a canvas proposal |
| 3 | Quiz fence parsing (valid, invalid, truncated, over 10); player state; Save calls the quiz apply path | Quiz me → answer → Save → Show quiz → Undo |
| 2 | Thumbnail cache limits; out-of-range page | Hover and keyboard focus; 3-deck answer |
| 4 | Section detection threshold | Cover answers on the atomic-notes answer |

Rust: rule-placement tests for the new Markdown and quiz rules; `pnpm checks` before each commit; `pnpm update:running` after each part.

## Risks

- **The model overusing formats** (tables for two items, unwanted quizzes). Instructions say "when it helps" and "only when asked"; check with a handful of real questions after release A.
- **Dependency weight.** About 50 KB; parsing stays on the main thread but is fast. Revisit only if long answers stutter.
- **Unsafe content.** No HTML rendering, link schemes allow-listed, remote images never loaded.
- **Prompt cache.** Each instruction change misses the cache once; keep the added rules short.

## Decisions

1. Inline quiz: all questions stacked (proposal A).
2. Collapsible sections: start expanded, with Collapse all, Expand all and Cover answers (proposal A).
3. Markdown: `mdast-util-from-markdown` 2.0.2 with GFM (`micromark-extension-gfm` 3.0.0, `mdast-util-gfm` 3.1.0), pinned.
