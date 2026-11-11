# Inline MCQ creation and composer redesign

Status: implementation handoff, 11 November 2026. No application changes are made by this plan.

## User intent and agreed direction

Let users create or insert a reusable multiple-choice question while editing an ordinary Note card. Typing `/mcq` and pressing Enter opens a compact floating composer with **Create new** and **Insert existing** tabs. Creating saves the question in Card Deck and inserts it at the captured position in one action. Notes can contain prose, images, and multiple questions together.

The current composer has poorly defined input boundaries, detached correct-answer controls, excessive empty space, and too many footer actions. Redesign the actual composer, including existing Card Deck and edit entry points. Keep Knot's styling, existing question-first player, and question titles in the TOC. Do not add a Quick check label or Continue learning button.

Question definitions are shared. Learner selections, grading, and attempts stay scoped to `(notebookId, questionCardId)`. Two appearances of the same question in one notebook share progress; different notebooks do not. Preview never writes progress.

Design reference from the planning chat:

`C:/Users/Acer/.codex/visualizations/2026/11/10/01a1c536-026b-7332-9c95-ed8080061a24/mcq-composer-plan.html`

This is an interactive mockup, not production source. Its preview, answer editing, insertion, and 320px width were exercised in headless Edge. Implement focus management, durable drafts, menus, styling, and error handling using Knot's real components rather than copying the mockup wholesale.

## Constraints for the next chat

- Read `AGENTS.md` and inspect current status before editing. The working tree already contains extensive unrelated modified and untracked work. Preserve it; do not reset, clean, mass-format, or overwrite unrelated files.
- Follow the shared ShellIcon semantics and dropdown rules. Use ShellMenu for action menus, ChoicePopover for choices, and `knot-dropdown` plus shared theme tokens for other floating popovers. Complex forms can have their own internal spacing. No new raw-color menu skin.
- After implementation and appropriate checks, run `pnpm update:running`. It must close normally, preserve user data, replace and verify the installed executable, and relaunch. Never force-kill the app. Report failures honestly.
- This plan alone does not require a rebuild. Implementation belongs in the new chat.
- Do not add AI generation in this change. Make manual creation and insertion reusable by future AI proposals.

## Verified current architecture

| Area | Existing implementation and consequence |
| --- | --- |
| Definition | `src/features/quiz/mcq.ts`: versioned definitions, stable option IDs, 2–4 answers, question/option/explanation limits, validation and grading revisions. Reuse these. |
| Shared content | `src/features/editor/blocksuite/card-deck.ts`: CardDeck shares the complete children of each `affine:note`; `knot:card-links` maps note instance IDs to shared card IDs. `writeMcq` writes a dedicated deck entry containing exactly one `knot:mcq` node. |
| Existing player | `mcq-block.ts`: `knot:mcq` holds a definition and derives the quiz card ID from its parent note's card link. This only identifies the correct quiz when the note is a dedicated quiz card. |
| Publication | `adapter.ts` session `publishQuestion` handles conflict checks, publication retry tracking, deck writes, optional standalone placement, and persistence flush. |
| UI | `src/app/McqComposer.tsx`: native modal dialog, queued draft writes, preview, creation and shared editing. `App.tsx` owns routing and composer state. Current draft IDs are broad `new:<notebook>` / `edit:<card>` keys. |
| Persistence | `src/services/mcq.ts`, `src-tauri/src/mcq.rs`, migration `010_mcq.sql`. Progress and attempts already use notebook + card identity. Rust grades against the canonical dedicated MCQ deck entry. |
| Text/navigation | `floating-toc.ts` and `cited-excerpt-adapters.ts` recognize direct `knot:mcq` definitions. They need reference resolution for embedded questions. Search/topic extraction and previews also require auditing. |
| Slash integration | Installed BlockSuite 0.19.5 exposes `AffineSlashMenuWidget.config`, item aliases, predicates, and action callbacks in both page and edgeless roots. Use this extension point; inspect command-removal/selection behavior before coding. |
| Tests | `tests/mcq.test.ts`, `tests/mcq.browser.mjs`, `tests/card-deck.test.ts`, deck/browser and floating-TOC suites already exist. Browser suites use Playwright with installed Edge and a Vite test origin. |

## Architecture decision: explicit embedded question references

Keep existing standalone `knot:mcq` cards and canonical deck format compatible. Add a distinct `knot:mcq-reference` content block under `affine:note`, with a stable `cardId` referencing a dedicated MCQ deck entry. Register it in the collection schema and all applicable page, canvas, note-pane, and preview specs.

Do not put mixed-note quiz identity in the parent note's `knot:card-links` entry. That entry identifies the whole shared note, not an individual embedded question. Do not mirror canonical definitions into every reference as independently editable data.

Introduce a shared resolver/player layer:

- Legacy direct block resolves its definition and parent quiz card ID as today.
- Reference block resolves the canonical definition by its own card ID through the originating session's CardDeck.
- Both use the same rendering, grading, retry, revision, and feedback behavior. Extract a shared Lit template/controller or helper; React composer preview may use the same pure presentation/state helpers without mounting a live persisted quiz.
- Subscribe to deck changes and notebook progress changes; clean up subscriptions when a block/view disconnects. An edit should refresh question text, TOC, and results without rewriting parent note content or firing synchronization loops.
- Question updates retain existing gradingRevision rules: grading-relevant edits invalidate current answers; explanation-only edits do not.
- Removing an embedded reference removes only that occurrence. It never deletes the deck question or resets notebook history. Undo restores the reference.
- Deleting the canonical question leaves an unavailable-question placeholder for embedded references, with removal and an appropriate restore affordance. It must preserve surrounding note text and never silently revive or clone deleted content. Existing standalone deletion behavior remains compatible. Restore resolves surviving references again.
- Copying a note/reference within the workspace retains question identity. Moving between notebooks uses destination progress. Cross-workspace paste must not resolve an unrelated ID: remap/import a definition when supported, otherwise paste readable question/answers or a clear unavailable state. Never transfer learner progress through clipboard/export.
- Audit CardDeck placement/usage accounting: a question embedded in a note counts as used in that notebook, including when the containing shared note is placed elsewhere. Keep standalone instance operations separate from reference traversal; do not treat an embedded reference as an `affine:note` placement.

No SQL migration is expected: canonical deck cards remain compatible with the current Rust validator, and progress keys remain unchanged. Add storage changes only if a concrete requirement emerges during implementation.

## UI specification

### Entry and positioning

- Slash item: **Multiple choice**, searchable with `mcq` and `quiz`. `/mcq` then Enter activates it using the editor's existing slash handling.
- Add a discoverable Multiple choice action to the appropriate note insert toolbar/menu. Capture that editor's selection before toolbar interaction changes focus.
- Only offer insertion in supported editable note content. Disable for read-only/locked notes and unsupported contexts. V1 inserts direct children of a note; do not attempt arbitrary nested quiz blocks.
- Floating surface approximately 520px wide; clamp to viewport with a safe margin and flip above/below the insertion point as needed. Use a portal/top-layer outside canvas transforms so zoom never scales the form. On small windows use a centered, viewport-bounded dialog; scroll the form body while keeping actions reachable.
- Use the shared floating surface tokens (including 6px outer radius where applicable). Form content spacing is approximately 16–18px, with 6–8px label/field spacing. Use existing Knot font and color tokens.
- Keep one composer per application window. Route requests with explicit session, notebook, note, pane/editor, and insertion identity; never infer the destination later from whichever view is globally active.

### Create new

- Header: Multiple choice, quiet Preview action, close icon. Tabs below: Create new / Insert existing. Edit mode does not need insertion tabs.
- Question: visible label and bordered, padded textarea. Start at two lines, grow within a bound, and avoid manual resize handles.
- Answers: two rows initially, maximum four. Each row contains an A–D prefix, visibly editable wrapping answer field, compact labelled correct-answer radio, and remove action when more than two answers exist. Reserve columns so removing/adding answers does not misalign the correct-answer heading.
- Correct answer is not preselected for a blank draft. Remove the selected answer and clear the key, then request a new selection. Keep option IDs stable when changing labels/order.
- Add answer disappears or clearly disables at four. Show duplicate-answer text as an advisory rather than inventing a new hard validation rule.
- Explanation: optional disclosure, collapsed when empty, expanded when populated/restored. Start with a small textarea and grow sensibly. Preserve source selection metadata in a secondary disclosure if supplied.
- Preview replaces the form body and has Back to editing. It uses local practice state only. Returning to editing preserves all fields; changing the draft clears stale preview results.
- Footer: truthful Saving draft… / Draft saved / Couldn't save status and one primary **Insert question** action. Library-only creation uses **Create card**; existing edits use **Save changes**. Move Discard draft and Save as new card into a quiet secondary action menu where relevant.
- Shared edit mode visibly explains that saving updates every appearance. Preserve current optimistic conflict checks; conflict recovery must offer reload-current and save-as-copy without silently discarding the draft.

### Insert existing

- Same surface, search focused when the tab opens. Filter active dedicated MCQ deck entries, not every mixed note containing a quiz.
- Search primarily question text; show question and a short answer preview without the correct indicator or explanation. Results include a clear insertion affordance and may indicate Already in this notebook; repeated insertion is allowed.
- Provide loading, no-questions, no-matches, and failure/retry states. Keep Create new available and preserve its draft across tab switches.
- Keyboard arrows/Enter select a result using the chosen accessible list pattern. Selection inserts directly at the captured location with no additional confirmation.

### Inserted player and TOC

- Question first, answer choices below, then Check answer and feedback/optional explanation. Keep Edit question quiet. No Quick check heading and no Continue learning action.
- In a mixed note use restrained spacing/dividers, without another oversized card shell inside the Note card.
- TOC lists each question using its question text in document order and navigates to that block. In canvas mode reveal the containing note and target question; preserve existing note headings and standalone quiz labels without duplicate entries.
- Use context-aware lock/read-only/export behavior. Solving an embedded quiz must not start canvas dragging or interfere with editing adjacent paragraphs. Audit the existing broad `:has(knot-mcq)` drag-mask override for mixed notes and the new flavour.

## Insertion, drafts, and failure semantics

1. Capture an insertion target before opening: originating session/notebook, parent note ID, anchor block, stable relative text position when required, command range, and screen rectangle. Do not hold only a DOM node or numeric offset.
2. Inspect BlockSuite slash action behavior and remove only the invoked command text. Keep surrounding text intact; never interpret a pasted `/mcq` as automatic insertion. Respect IME composition.
3. While the composer is open, retain the target but validate it again before saving. A deleted, locked, replaced, or closed target must leave the draft intact with a clear recovery path. Never silently place into another notebook or arbitrary canvas location.
4. Extend `publishQuestion` to accept an explicit destination union (deck-only, legacy standalone, inline note target) rather than another ambiguous boolean. Add an equivalent existing-question insertion operation that does not republish/clone the definition.
5. Validate before mutation. For new questions, create the canonical MCQ entry and insert the reference; split the paragraph at the captured boundary if required and create/focus an editable paragraph below. Use an appropriate Yjs transaction/undo boundary for document insertion.
6. Preserve the existing save_documents transaction path for deck + document + published-draft deletion. Prevent double-submit and duplicate entries on retry. Track publication identity and outcome so a failed flush can retry the same mutation, including existing-question insertion. In-memory and persisted failure recovery must be tested.
7. Close only after successful durable save. On failure, keep content and target recoverable; never claim Inserted/Draft saved early. If a completed insertion is undone, remove the occurrence while retaining the reusable deck question; redo restores it without duplication.
8. Version draft payloads and use stable scoped IDs so separate notebook/note creation contexts do not overwrite one another. Preserve/recover existing broad draft keys deliberately. Validate restored JSON rather than assuming it is well formed. Do not persist DOM/selection objects as draft content.
9. Serialize/debounce draft writes, flush on close and submit, and ensure stale queued writes cannot recreate a draft after publication/discard. Provide retry when persistence fails. On reopening a draft after restart, obtain a fresh insertion target and retain the question content.
10. Escape and close preserve the draft and restore focus. Use a real accessible dialog with focus containment; tab controls and radio groups work from the keyboard. Ctrl/Cmd+Enter may submit; normal Enter in textareas adds a line. Close must not silently abandon unsaved data after a write failure.

## Implementation sequence and files

### 1. Establish reference identity and compatibility

Work in `features/quiz/mcq.ts`, `features/editor/blocksuite/mcq-block.ts`, `card-deck.ts`, and `adapter.ts`; add a focused reference/resolver module if needed. Register the new schema/spec, share renderer behavior, support subscription cleanup, and cover legacy + mixed-note + multiple-reference identity before wiring UI.

### 2. Implement targeted insertion and publication

Add a focused editor insertion module (suggested `mcq-insertion.ts`). Extend the session API and publication bookkeeping; ensure inline insertions do not call the legacy standalone `placeCard` path. Implement selection restoration, validation, transaction boundaries, retries, and existing-question insertion. Audit editor-only/deck-only sessions and pane routing.

### 3. Rebuild the composer and picker

Refactor `src/app/McqComposer.tsx`; extract form/picker components if this keeps state manageable. Update `src/styles/mcq.css` with scoped form layout and explicit radio sizing, checking inherited global input styles. Reuse `quizRepository` and improve draft lifecycle. Add the picker over the live CardDeck subscription. Keep existing entry points functional.

### 4. Wire editor commands and discoverability

Add a lifecycle-managed slash integration (suggested `mcq-menu.ts`) using BlockSuite config rather than a document-wide key listener. Preserve default slash items and prevent duplicate registration after mode/pane changes. Wire the note insert toolbar and typed composer requests through `App.tsx`. Register/clean up in the appropriate adapter/pane lifecycle. Retain the current sidebar/library routes for this change; removing sidebar navigation is a separate product decision.

### 5. Complete all readers and presentation paths

Update `floating-toc.ts`, `cited-excerpt-adapters.ts`, Card Deck previews/usage, search and topic extraction, and relevant clipboard/export paths to resolve reference definitions. Trace snapshot-based consumers explicitly: they may need a deck/resolver argument rather than access to a live editor. Export question/options without learner state or answer keys, matching existing policy. Ensure deck edits invalidate dependent indexes/caches for unopened notes, not just visible blocks.

### 6. Verify and update the installed application

Run focused checks first, then the full required checks. Record actual results and any pre-existing unrelated failures in a short verification document. Run the authorized installed-app update after code validation, and verify the resulting UI in the installed app.

## Acceptance checks

- A note with text before and after the cursor accepts `/mcq` → Create → Insert; content order is preserved and no extra standalone canvas card is created.
- Insert existing creates a link to the original question, not a duplicate; multiple different questions in one note have independent identity and grading.
- Two copies of one question in notebook A reflect the same progress; notebook B remains independent. Reload/restart retains both content and appropriate progress.
- Existing standalone quizzes still solve/edit/place normally; shared edits refresh embedded and standalone versions. Stale grading revisions require another answer; explanation-only updates preserve results.
- Source notes shared through CardDeck keep reference identity. Deletion/restoration, copy/paste, removal, undo/redo, and save-as-copy preserve surrounding note content and never transfer attempts.
- Removing a selected correct option forces reselection. Empty question/answer errors appear by the affected field, associate with it accessibly, and focus the first invalid field. Blank A/B labels cannot be mistaken for answer text.
- Draft restore, tab switches, preview/back, Escape/close, save failure, malformed stored draft, rapid edits, double-submit, retry, and app restart do not lose content or duplicate cards. Preview creates zero attempts.
- Pane switches, canvas/page mode changes, deleted/locked insertion targets, multiple editor instances, and composer cleanup never insert into the wrong location.
- `/mcq`, menu activation, IME, keyboard navigation, focus return, and cancellation work in page mode, canvas note editing, and note panes.
- Inspect real composer/player screenshots in light and dark themes, narrow windows, 100%/125% OS scale, and several canvas zoom levels. Test two/four options, long wrapping text, expanded explanation, error/loading states, and viewport edges. No hidden fields, detached radios, clipped actions, or horizontally overflowing popovers.
- TOC uses question text, resolves all embedded questions, updates after edits, and navigates correctly. Search/export/clipboard/preview handle references and unavailable questions deliberately.

Suggested commands (confirm current scripts and test setup in the implementation chat):

```powershell
pnpm check
pnpm exec vitest run tests/mcq.test.ts tests/card-deck.test.ts
pnpm test
pnpm lint
# Start/reuse the project's Vite test server before browser scripts.
node tests/mcq.browser.mjs
node tests/card-deck.browser.mjs
node tests/floating-toc.browser.mjs
# Add focused inline-insertion/composer browser coverage; run affected pane/export suites.
# If Rust changes, run focused MCQ/storage tests and appropriate broader native checks.
pnpm update:running
```

Browser checks must exercise the production composer with Knot's real global styles and actual editor commands, not only a detached mockup. Keep tests centered on meaningful behavior and failure recovery.

## New-chat starting instruction

Implement `docs/MCQ-INLINE-IMPLEMENTATION-PLAN.md` in this repository. Read AGENTS.md, preserve the existing dirty working tree, and inspect the current code before applying the plan. Complete the linked inline MCQ architecture, compact composer/picker, slash and toolbar insertion, integration readers, and verification. Then run `pnpm update:running` and verify the installed application. The previous chat produced only this plan and the design mockup; it did not implement these changes.
