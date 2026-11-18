# Canvas scenes vs the old canvas path — live test, 17–18 November 2026

Suite: `knot-scenes-v1` (`tests/benchmarks/scenes.v1.json`): 8 canvas creation prompts on
synthetic ISTQB-style sources, each run on the old path (forced canvas mode: cards, arrows
and a mind map, Knot picks the layout) and on the new one (`create_on_canvas` composing a
scene, [phase 1](AI-CANVAS-ORCHESTRATION-PLAN.md)). Model GPT-6.1 Terra. Approved limit
**US$1.20**; conservative reservation US$1.12 (scene requests capped at 12,000 output tokens
for this run); **spent about US$0.091** (old US$0.036, new US$0.055).
Run `9bee7278-fd6b-4ed4-a0fb-929b5419558f`, source `aba689e`.

Replayed in a real editor with `node tests/benchmarks/replay-scenes.mjs <run>` (no paid
calls), which applies each result, measures it and saves a screenshot. Grading below is
AI-assisted (Claude, from the screenshots and measurements), not independent human grading.
The prompts were written by the plan's author, not by someone unfamiliar with it, so they
may favour the new path.

## Results

| # | Prompt | Old path | New path | Better |
|---|---|---|---|---|
| 1 | Atomic notes for three decks | 19 cards, 9 arrows, flow of 11 plus a row of 8 leftovers; no grouping | 23 claim-titled cards in 3 frames (one per deck), **no arrows**, long narrow columns | Mixed: grouping and titles new, connections old |
| 2 | Defect lifecycle as a flowchart | 11 cards in a grid, 13 arrows, 5 arrows crossing cards, overlapping labels | 15 shapes: start/end ovals, decision diamonds, labelled branches, loops back; 1 crossing, two labels overlap | New |
| 3 | Improvement cycle | 4 cards in a grid with arrows | 4 cards as a ring, Act feeding back to Plan, example kept | New |
| 4 | Compare lifecycle models | One card with one table | 3 coloured cards side by side in a frame plus a "choosing" card; tables titled "Untitled" and listing different aspects per model | Mixed: layout new, comparability old |
| 5 | Test levels and types with explanations | Mind map plus 5 detail cards apart from it | 11 cards in 3 framed sections (levels, types, confirmation vs regression), no arrows | New |
| 6 | Summarise a chapter next to it | 5 cards in a grid beside it, 3 arrows crossing cards | 6 claim-titled cards beside the chapter card (anchored to it), no arrows | New |
| 7 | Exam tomorrow, revise quickly | A mind map only | 5 numbered, coloured cards in reading order | New |
| 8 | How risk drives testing decisions | Hub of 5 cards | Left-to-right flow of shapes and cards with a dashed monitoring loop; 3 source passages left out (accept, transfer, contingency) | New on structure, old on coverage |

Across all 16: no overlaps on either path, every proposal valid, every new-path request
called the scene tool. The old path chose the grid in 5 of 8 cases.

| | Old | New |
|---|---|---|
| Arrows drawn | 36 in 6 cases | 26 in 3 cases (none in 1, 4, 5, 6, 7) |
| Arrows crossing other objects | 8 | 1 |
| Source passages left out | 0 | 3 (case 8) |
| Frames | 0 | 7 |
| Median time | 6.9 s | 11.0 s |
| Output tokens | 4,525 | 8,946 |

## Verdict

The new path wins on what phase 1 set out to fix (structure, grouping, placement, reading
order, diagrams): better in 6 cases, mixed in 2, worse in none on layout. It does **not** yet
meet the phase 1 exit criterion, because it often drops connections, including on the
atomic-notes case that started this work, and once dropped content.

## Found

1. **Connections are dropped.** The scene instructions say to connect only what the source
   relates and never invent relationships; together with a heavy layout schema, Terra
   connects nothing unless the content is visibly a sequence or cycle.
2. **Table titles show "Untitled"** when a card's table has an empty title.
3. **Every arrow gets a different colour** unless the model picks one, which is noisy in a
   flowchart.
4. **Long sections become one tall column** (case 1). The model chose stacks; nothing tells
   it about wrapping a long section.
5. **One coverage loss** (case 8): mitigation options other than testing were left out.
6. The replay framed one screenshot badly (case 3); its measurements are unaffected.

## Next

Fix 1–4 (instructions for connections and coverage, a default table title, one neutral
arrow colour unless chosen, guidance on wrapping long sections) and rerun these 16 cases
(about US$0.10). Phase 2 (look and fix) would catch overlapping labels and crossings.
