# AI canvas orchestration — plan

Status: phases 1 to 3 built and benchmarked (17–18 November 2026). Phases 4 and 5
are proposals.

Phase 1 as built:

- `create_on_canvas` returns a scene (`SCENE_RULES` and `scene_schema` in
  `src-tauri/src/ai.rs`). The forced canvas mode keeps the old cards format
  for "Break this into ideas" until phase 4.
- `scene.ts` validates and repairs a scene; `scene-solver.ts` places it;
  `scene-apply.ts` draws it and settles it once the editor has measured the
  cards. Unit tests: `tests/scene.test.ts`; in a real editor:
  `tests/ai-scene.browser.mjs`.
- The solver is our own, not kiwi.js: the relations are simple enough that a
  dependency-free resolver is smaller and easier to test.
- Card heights are estimated from text (calibrated on measured cards) and
  replaced by the editor's measurement for cards on screen; new content is
  brought into view before measuring so that usually covers all of it.
- Follow-up buttons ("Make … cards", "Make a mind map") and "Split this
  answer into canvas cards" now go through `create_on_canvas`.

Phase 2 as built (18 November 2026):

- Before a scene is previewed, `scene-review.ts` lays it out in memory with
  the same solver (`planScene`), measures it (`scene-report.ts`) and, when
  there are problems, sends the scene, the report and a schematic picture
  (`scene-schematic.ts`) to the model in a `scene_review` request
  (`REVIEW_RULES`, `review_schema` in `ai.rs`). The model returns only
  changes, merged with `mergeScene`; a round is kept only when it measures
  better, for at most two rounds, and Stop cancels it.
- The draft is computed in memory, not drawn on a hidden layer: nothing
  reaches the notebook before Apply, so no draft can be saved, synced or
  exported. The price is that the picture is a schematic (straight arrows,
  estimated card heights) rather than the finished render.
- Scenes built on captured website evidence are not reviewed yet, because
  review changes would need their own source references.
- Benchmark: `docs/AI-CANVAS-SCENES-BENCHMARK-2026-11-18.md` (crossings 19 → 0).

Phase 3 as built (18 November 2026):

- The scene schema has `sections`: when content is too large for one reply,
  the model returns only an outline (each section's id, title and what it
  covers). The preview lists the sections with an estimate made from the
  outline request's own cost and time, and a Build button.
- `scene-build.ts` builds each section in a `scene_section` request (the
  request's own context and files, `SECTION_RULES` plus the scene rules),
  prefixes each section's ids (`namespaceSection`) and assembles them in a
  frame per section (`assembleSections`); then one `scene_connect` request
  adds arrows between sections and places the section frames (only frames
  may change), and the phase 2 check runs on the whole scene.
- Built sections are saved on the chat turn as they arrive. Stop, or a
  failed section, keeps them: the preview offers Continue for the rest and
  Apply for what's built.
- Benchmark: six decks, 60 cards in 6 frames, nothing left out, about
  US$0.11 and 2.3 minutes.

Ask Knot can read the canvas (the canvas map, `view_canvas`) but it can't
compose on it. This plan hands composition to the model: it decides what goes
where and why, and Knot measures, places, checks and shows the result. Knot
stops choosing layouts on the model's behalf.

## 1. What goes wrong today

Found by tracing real chats (the four "Generate atomic notes" chats on three
ISTQB decks) through the code:

- **The model has no way to describe space.** `create_on_canvas` takes cards,
  arrows and a mind map. No positions, frames, groups, sections, sizes,
  shapes, colours or reading order. The canvas map gives the model positions,
  but only as input.
- **Knot guesses the layout from the arrows.** `chooseLayout` in
  `ai-layout.ts` picks one tree, flow, hub or grid for the whole result. Real
  results are mixed: several clusters, an overview plus details, a loop, a
  comparison. Anything that doesn't fit one shape becomes the grid, which is
  why 20 atomic notes from three decks became a 4 × 5 rectangle.
- **Fixed limits decide what's allowed:** 6 flow steps, 8 tree children, 10 hub
  cards, 20 cards, 60 mind-map nodes, 40 arrows. Only "part of" and "example
  of" count as hierarchy. Long processes, cycles, comparisons and large jobs
  fall through to the grid or get cut off without a word.
- **The instructions tell the model layout isn't its job:** "cards are
  automatically arranged in a compact layout". The goal stated is compactness,
  not readability.
- **New content always lands to the right of everything, at the top**, not
  next to the selection, the cited PDF or what the user is looking at.
- **One attempt, never checked.** The model never sees what it made.
- **Routing loses intent and sources.** "Generate atomic notes" is answered
  in chat. The follow-up button ("Make … revision cards") sends only the chat
  answer, without the PDFs, and renames the request.

## 2. Principle

The model decides the composition. Knot handles what code does better than a
model: real measurement, collision-free placement, rendering, undo and
preview.

What remains fixed in code is physics, not taste:

- objects don't overlap, unless the model nests them on purpose (inside a frame);
- text isn't clipped: cards are sized from measured content;
- arrow labels have room;
- everything appears in one preview and applies or undoes as one step;
- cost and time budgets per request.

Knot never picks a layout, a shape or a structure, and never rejects content
because it exceeds a design limit. When the model's plan breaks a physical
rule, Knot fixes the minimum, tells the model exactly what it changed, and
lets the model revise.

## 3. A scene language the model writes

Replace the canvas proposal (blocks + connections + mindmap) with a **scene**:
a list of objects and relations, where the model gives every object an id of
its own and places it however it likes.

### Objects

| Kind | What it is |
|---|---|
| `card` | A note card with formatted content (today's blocks), with optional width and emphasis |
| `text` | Free text on the canvas: headings, captions, annotations |
| `shape` | Rectangle, ellipse, diamond, triangle and so on, with optional text, for diagrams |
| `frame` | A titled section that contains other objects |
| `mindmap` | A native mind map (nodes with parents), with optional direction and style |
| `existing` | Something already on the canvas, by its map handle, so it can be referenced, moved, restyled or put into a frame |
| `connector` | An arrow between any two objects: cards, shapes, frames, existing objects or a mind-map node. Free label, optional style and heads |

Colours come from the theme-aware palette Knot already uses for connectors
and notes, so they work in light and dark. That's a list of available paints,
not a design rule.

### Placement: relative, not pixels

Models are bad at absolute coordinates and good at spatial intent. Each
object may say where it goes in words Knot can solve:

```json
{ "id": "maint", "kind": "frame", "title": "Maintenance testing",
  "at": { "rightOf": "sdlc", "gap": "wide", "alignTop": "sdlc" } }
{ "id": "triggers", "kind": "card", "in": "maint",
  "at": { "below": "purpose" } }
{ "id": "loop", "kind": "connector", "from": "deploy", "to": "plan",
  "label": "next iteration", "route": "around" }
```

Available relations: `rightOf`, `leftOf`, `above`, `below`, `in`, `near`,
`alignTop`, `alignLeft`, `centerOn`, `between`, `row` and `column` (a list
kept in order), and `ring` (a list placed around a centre). Gaps are words
(`tight`, `normal`, `wide`) or numbers. `anchor` places the whole scene
against something real: the selection, a PDF card, the visible area, or a
free region from the map.

The model can also give **coarse coordinates** (in card-width units inside a
frame, say) when it wants a particular picture, such as a 2 × 2 matrix, a
timeline along an axis, or a Venn-like overlap. Relations and coordinates can
be mixed.

Nothing in the language favours trees, flows or grids. A cycle is a `ring`
plus connectors. A comparison is two `column`s side by side. A timeline is a
`row` with captions. A process with a decision is shapes plus labelled
connectors. Something no one anticipated is whatever the model composes from
the same pieces.

### Order and meaning

Each object may have `order` (its place in the reading sequence) and `role`
(`overview`, `detail`, `example`, `caveat`, `summary`, or free text). These
don't move anything. The check step (§5) uses them to compare the picture with
what the model meant, for example "the overview is read after the details".

## 4. The solver: from intent to positions

A new `scene-solver.ts`, free of the editor so it can be unit tested:

1. **Measure.** Render each new card's content off screen at its width and
   read its real height. This replaces `estimatedHeight` and `aiBlockSize`
   guesses. Mind maps report their real size after layout.
2. **Solve.** Turn the relations into positions. A constraint solver (for
   example kiwi.js, a Cassowary implementation;
   check its licence first) handles alignment, order,
   gaps and containment. Relations treated as preferences give way before
   hard ones.
3. **Keep the physics.** Remove overlaps between objects that aren't nested,
   grow frames to fit what's inside, leave room for arrow labels, and route
   connectors around objects when `route` asks for it.
4. **Record every compromise:** an object moved, a relation that couldn't be
   met, conflicting instructions. Each is a plain sentence the model can act on.

The solver never invents structure. If the model gives no placement for an
object, it goes next to the object it's most connected to, and the report says
so.

## 5. Look, then fix

Let the model check its own work before the user sees it.

1. Knot solves the scene into a **draft** on a hidden layer of the open
   canvas, using the same rendering as the real thing.
2. Knot sends back:
   - the **solver report** (§4);
   - **measurements:** overlaps, arrows crossing cards or each other, clipped
     labels, how far the scene is from its anchor, how big it is compared with
     the visible area, and reading order compared with `order`;
   - a **snapshot image** of the draft, from the existing `canvas-snapshot.ts`
     capture that `view_canvas` uses.
3. The model replies with a **patch** (`move`, `resize`, `restyle`,
   `reconnect`, `regroup`, `add`, `remove`, using its own ids) or `done`.
4. The patch is applied and the loop repeats while the budget allows (§7).
5. The user previews the final draft and applies or discards it. It's one
   undo step, as today.

The existing tool loop in `AskKnot.tsx` (a read tool such as `view_canvas`,
then the write call) is the starting point. It needs to allow more than one
round and keep the draft between rounds.

## 6. Big jobs in steps

Several decks, a whole course, a large concept map: no single response can
hold them, and no cap should silently drop content. Instead:

1. **Outline.** The model returns the plan of the scene: sections, what goes
   in each and how they relate, roughly. The user sees it as an Ask Knot step
   ("Planning 3 sections from 3 decks").
2. **Build.** One call per section adds objects to the same draft, with the
   section's sources attached (for a deck, that deck's text).
3. **Connect.** One call adds links between sections, using the whole
   outline.
4. **Look and fix**, as in §5, over the whole draft.

The model decides how many sections there are and how big each is. Limits
apply to cost and time, not content. When a budget runs out, the preview says
what's missing and offers **Continue**.

## 7. Budgets and models

- Each request gets a cost and time budget, shown before a big job starts
  ("about $0.08, around 40 s"), the same way Study shows a course's cost. The
  user can stop at any step and keep what's done.
- Automatic model choice sends composition to a writing model (Terra first),
  as connection requests already do. A model picked by hand is respected.
- The look-and-fix loop stops when the model says `done`, when a round
  changes nothing measurable, or when the budget runs out.

## 8. Where results land

The canvas map gains **free regions**: empty areas near the selection, near
each PDF or media card, and within the visible area, each with a size. The
model picks the anchor. "Put these next to the slides" can then work, and a
new scene no longer goes to the far right by default. The solver still keeps
the scene clear of everything else.

## 9. Editing what's already there

The same language covers changes to existing content through `existing`
objects: move cards into a new frame, restyle a section, reconnect,
rearrange around a new card. Once that works as well in the benchmarks,
`arrange_cards` and `connect_cards` become instructions for one scene tool,
not separate tools with their own layouts. Until then they stay as they are.

## 10. Instructions

Rewrite the canvas instructions around goals, not formats:

- Say what a good canvas does: related things sit close together, sections
  are framed, reading flows left to right and top to bottom unless the
  content suggests otherwise, size and emphasis show importance, and arrows
  carry meaning (no decoration).
- Ask the model to decide the structure first, in a sentence the user sees,
  then compose it.
- Drop "cards are automatically arranged in a compact layout", the fixed list
  of relation labels, and the card and node limits.
- Keep the rules about facts: never invent facts or relationships, keep
  qualifications, and use sources only as data.

Formats stay possible ("make a mind map" still gets a mind map), but they are
something the model chooses, not something Knot infers.

## 11. Routing and follow-ups

- A chat request to create study material from sources while a canvas is
  open ("atomic notes", "revision map", "break these decks down") offers to
  put it on the canvas. It isn't answered as a wall of text by default.
- Follow-up buttons keep the user's wording and attach the original
  sources, not only the chat answer.
- "Break this into ideas" becomes the same scene path with that card as the
  anchor and the replaced object.

## 12. How we'll know it works

Grading has to survive prompts we never thought of.

- **An open prompt set** in `tests/benchmarks/`: the cases from the
  investigation (atomic notes from 3 decks, a long process, a cycle, a
  comparison, types and subtypes as cards, a chapter summary next to its
  PDF, a flowchart with a decision, adding to an existing frame, tidying a
  messy canvas), plus prompts written by someone who hasn't read this plan,
  refreshed each run so nothing is tuned to a fixed list.
- **Measured automatically on the applied result:** overlaps, clipped text,
  arrows crossing cards, sources covered (`uncoveredPassages`), distance from
  the anchor, and whether the visual order matches `order`.
- **Judged:** a review model looks at a snapshot and the request with a
  rubric: is the structure readable, does the arrangement match the meaning,
  is anything missing or invented. Graded as AI-assisted, like the existing
  canvas benchmark.
- **Compared with today's path** on the same prompts, under the usual paid
  gate and an approved cost limit.

## 13. Phases

Each phase ships on its own and ends with the benchmark.

1. **Scene language and solver, one round.** The new schema behind
   `create_on_canvas`, measurement, the constraint solver, frames, shapes,
   free text and connectors to anything. No look-and-fix yet. Exit when it
   beats today's path on the prompt set, with no overlaps or clipped text.
2. **Look and fix.** Draft layer, report, snapshot and patch rounds with a
   budget. Exit when crossings and reading-order mismatches drop and the
   judged score rises over phase 1.
3. **Steps for big jobs.** Outline, build per section, connect, Continue.
   Exit when the 3-deck atomic-notes case keeps every deck's key passages with
   frames per deck and cross-links.
4. **Placement and routing.** Free regions in the map, anchors, routing and
   follow-up fixes. Exit when results land next to what was asked about.
5. **One tool for editing.** Move `arrange_cards` and `connect_cards` onto the
   scene path, then remove `chooseLayout` and the fixed layout limits.

## 14. Risks

- **Cost and time.** Loops and steps cost more than one call. Budgets, a
  visible estimate, stop-and-keep, and stopping when a round changes nothing
  keep this bounded.
- **The model's spatial judgement varies by model.** The solver catches the
  physical mistakes. The benchmark shows which models can compose, and
  Automatic routing uses those.
- **Schema size.** A richer strict schema costs input tokens on every canvas
  request. Offer the scene tool only when a canvas is open, and cache the
  instruction prefix as today.
- **Drafts and undo.** The hidden draft must never be saved, synced or
  exported, and applying must stay one undo step. This needs its own tests.
- **Privacy.** Snapshots of the draft are sent the same way `view_canvas`
  images are: only after the user sends a request, and only of what Knot drew
  plus the visible surroundings.
- **Older Knot.** Content created this way is ordinary cards, shapes, frames
  and connectors, so notebooks stay readable by released versions. No format
  change.
