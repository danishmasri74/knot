# Inline multiple-choice verification

11 November 2026

## Checks

- `pnpm check` passed. ESLint passed for `src` and the MCQ browser suite.
- `pnpm test` passed 109 tests in 28 files.
- The MCQ, Card Deck, Library Card Deck, Floating TOC, note-pane, dropdown, search reveal, and canvas export browser suites passed. The MCQ suite used the production composer, shared styles, and BlockSuite slash menu in Edge. It verified mid-paragraph insertion, save retry, undo and redo, repeat insertion, Card Deck sharing, notebook-specific attempts, search, Markdown export, question removal and restoration, and draft recovery after the source pane closes. Pasted slash text did not open the composer. The suite also verified malformed draft recovery, draft write retry, and flushing queued draft edits through the window close hook.
- Both native MCQ tests passed. An injected SQLite error during draft deletion rolled back the deck and document writes and preserved the draft across reopening. The retry committed all three changes.
- Follow-up cleanup: removed the five unused test imports/helpers, so `pnpm lint` passes. Refreshed the frozen AI payload baseline with the deliberate canvas-instruction and citation-marker prompt changes; `ai::tests::payloads_identical_to_baseline_with_measurement_on_and_off` and the full Rust library suite (88 passed, 4 ignored) pass. Fixed the `clippy::unused_io_amount` error in the streaming mock server; Clippy reports only existing warnings.

## Visual checks

Inspected the light composer, dark 320px picker, dark four-answer form with a wrapping answer and expanded explanation, and the floating composer at 75% and 125% canvas zoom. The composer stayed 520px wide at both canvas zoom levels. Edge exercised device scale factors 1 and 1.25 with Windows display settings left as configured. Native IME composition and a cross-workspace clipboard round trip remain unverified.

## Installed build

The initial `pnpm update:running` verified the executable replacement and relaunched Knot. In that installed build, opened the dark Card Deck composer, checked its layout, and confirmed that Escape dismissed it and restored focus to the creation button. This check used a blank composer and created no question.

The latest release and installer built successfully. On two intermediate installation attempts, Knot stayed open after a normal close request. The window displayed `runtime error: failed to send message to the webview`. The updater timed out before replacing the executable, and the installed file hash confirmed the earlier build remained installed at that point. The [latest update log](../test-results/mcq-inline-window-close-update.log) records the failure. A subsequent attempt at 08:39 closed Knot normally, replaced the executable and relaunched it; the installed hash matched the release build.

After the follow-up cleanup, `pnpm update:running` rebuilt the release and installer, closed Knot normally, replaced the executable, verified it and relaunched Knot ([log](../test-results/finish-update.log)).

## Faster question writing — 11 November 2026

- The composer is keyboard-first. Enter moves from the question to answer A and then through the answers. On the last answer, Enter adds another answer (up to four), or moves to the save button. Shift+Enter adds a line break. Backspace in an empty answer removes it. Alt+1–4 marks the correct answer. Ctrl+Enter saves.
- Each answer's letter badge is its correct-answer radio, so the separate Correct column is gone. The remove control appears on hover or focus. Pasting several lines into an empty answer fills the following answers, strips list markers, and treats `[x]` as the correct answer.
- **Add another** (Ctrl+Shift+Enter) saves the question, keeps the composer open, clears it, and counts the questions added. Inline insertion places each new question directly after the previous one. Editing an existing shared question does not offer it.
- `tests/mcq-composer-flow.browser.mjs` covers the keyboard flow, Alt+number key, list paste and two chained `/mcq` insertions in order. The MCQ, note-menu, dropdown, Card Deck and Library Card Deck browser suites, unit tests, lint and TypeScript pass. Light and dark composers were inspected in screenshots.
