# Canvas awareness — live test, 16 November 2026

Suite: `knot-canvas-v1` (`tests/benchmarks/canvas.v1.json`, 16 synthetic cases on an
ISTQB-style canvas: 8 cards, a 4-card frame, a mind map, a shape, 4 arrows including one
planted wrong arrow, two unconnected cards). Contexts were generated with Knot's own
composer and canvas map formatter. Approved limit: **US$0.50**. Spent: **about US$0.020**
(Luna US$0.0055, Terra US$0.0144). Grading is AI-assisted (Claude) against each case's
rubric, not independent human grading. Proposals were replayed in a real editor with
`node tests/benchmarks/replay-canvas.mjs <run>` (no paid calls): validated, applied and
undone, after checking that the replayed canvas gives the same handles the model saw.

Run: `KNOT_BENCHMARK_SUITE=canvas` with the usual paid gate (see `tests/benchmarks/README.md`).

## Results

| Case | Ask | GPT-6 Luna (first run) | After fixes |
|---|---|---|---|
| 01 | What depends on static testing? | Correct, cited | |
| 02 | Walk me through the frame | Correct order, cited | |
| 03 | Which cards aren't connected? | Correct, by title | |
| 04 | How does early testing relate to static testing? | Correct (requires), cited | |
| 05 | What's on the top right? | Correct region and cards | |
| 06 | Check my map | Caught the planted arrow and loose cards | Terra: also flagged "requires" as too strong |
| 07 | Summarize the canvas | Correct, no edit proposed | |
| 08 | Missing connections | **Weak**: a card linked to its own frame; one reason "thinking aloud" (413 chars) made validation reject the whole proposal | Luna 3/3: clean one-sentence reasons, no frame links, relations still mediocre; Terra: one correct, cautious suggestion |
| 09 | Tidy up the frame | Exactly the 4 frame cards | |
| 10 | Lay out all cards as a flow | 8 cards, flow | |
| 11 | Quiz me on the frame | `about` = the frame, questions from its cards | |
| 12 | Add a reviews card linked to static testing | Correct link and direction | |
| 13 | What colour is the circle? | **Fail**: "I can't tell" instead of view_canvas | Luna 3/3 and Terra: view_canvas |
| 14 | What does the Course plan card say? | Correct, no canvas look | |
| 15 | (canvas image returned) colour and text | Red, "Risk", correct | |
| 16 | Break this into ideas | 8 claim-title cards, every principle kept, valid vocabulary | Terra: 9 cards, only one arrow |

No answer showed a handle (K3, F1) to the user. All 16 requests succeeded.

## Found and fixed

1. **Undo edit failed for AI arrows with labels** (introduced with visible labels in phase 4,
   installed but unreleased). BlockSuite re-centres a label box shortly after creating the
   arrow; that update counted as a newer edit and added an undo step, so the panel refused
   to undo. The version tracker now ignores label-box-only connector updates (like measured
   note heights), and a shared `undoApplied` steps back over them before undoing the edit.
   The browser tests now wait before undoing.
2. **One long reason rejected all suggested connections.** Reasons are now accepted up to
   4,000 characters and trimmed to their first sentence (240 characters at most).
3. **Prompt fixes:** `connect_cards` reasons must be one finished sentence, uncertain
   relations are left out, and a card is never linked to its own frame; `view_canvas` is
   called first for questions about how something looks.

## Still open

- Connection suggestions on Luna are often unsupported (for example "Defects cluster
  together → part of → Dynamic testing"). Terra is more cautious and correct. **Done the same
  day:** with Automatic model choice, connection and map-check requests on a canvas now go
  to a writing model (Terra first); choosing Luna by hand still uses Luna.
- Break this into ideas can produce few arrows (Terra drew one), which leaves the flow,
  tree or hub layout little to work with.
- Luna "requires" and similar labels are chosen loosely; the map check on Terra notices this.
