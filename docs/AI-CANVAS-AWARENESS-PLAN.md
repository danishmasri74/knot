# Ask Knot canvas awareness

Plan · 16 November 2026 · Phases 1–4 implemented 16 November 2026

## Phase 3 as built

- `connect_cards` (offered with `arrange_cards`, map only): arrows `{from, to, label, reason}` between existing K/F/T objects, at most 20. Validation refuses self-arrows and duplicate pairs; Apply skips arrows already on the canvas in the same direction.
- Preview: a checkbox per suggestion with its reason; the header counts the ticked ones; Apply uses only those. Saved chats can't apply, so their checkboxes are disabled.
- Check the map: no tool. The map rules (only sent with a map) say what to look for when asked; the map's `not connected:` line lists loose cards, computed locally. Empty frames already read "empty".
- Decided defaults kept (§8): suggestions only when asked, no ambient canvas suggestion.
- Verification: Rust test for the tool and review rules, unit tests for the loose-ends line and tool offering, `tests/ai-connect.browser.mjs` (arrow added with color and visible label, existing arrow skipped, stale and nothing-to-add refused, Undo; preview reasons, count and read-only saved choices in both themes). Toggling a live checkbox is covered only by the count logic, not a browser test. Live answer quality not measured.

## Phase 4 as built

- The model doesn't choose a layout for new cards: Knot infers it from the arrows' relation types (`chooseLayout`), so no schema changed for canvas proposals. Only `arrange_cards` takes an explicit layout, when the user asks for one.
- Engines: flow (longest-path columns, prerequisites pulled next to their dependents, columns centred, 140 px gaps so same-row arrows join sides), tree (top-down, parents centred over children, unrelated cards in a row underneath), hub (centre card with the rest on an ellipse), grid (the earlier compact layout). A final pass pushes any overlapping cards apart.
- Caps keep arrangements from sprawling (6 flow columns and 6 cards per column, 8 tree children, 10 hub cards); larger sets use the grid, as the 20-card summary test expects.
- `arrange_cards` is offered only with a canvas map and Create cards on canvas. It moves the named cards, fits their frames (which also covers the frame-fit polish item for arranged frames), and leaves other cards alone.
- Found while checking screenshots: connector labels created by code were never drawn, because BlockSuite needs a label box. Knot now sets an estimated one and BlockSuite re-centres it.
- Verification: unit tests for the choice, each engine, caps and arrow ends; Rust test for the tool; `tests/ai-arrange.browser.mjs` (a jumbled chain becomes a flow in place, frame fitted, other cards untouched, stale handle refused, Undo). Tree, hub and flow proposals were checked in screenshots. Live answer quality is not measured.

## Phase 2 as built

- Instead of changing `connections` endpoints to strings (which would change every canvas schema), proposals get a separate `links` list, only when a canvas map is present: `{card, existing, label, toExisting}`. Requests without a map are unchanged, so the frozen payload baseline did not change.
- Handles resolve at Apply from the map captured with the request (`canvasHandles`), never from IDs sent to the model. Unknown handles, objects no longer on the canvas, and the card being replaced are refused with a retry message.
- Placement: linked new cards go 160 px right of the objects they link to (`clearPlacement`); replacement keeps its own placement. Link arrows use the typed relation colors.
- Quizzes: `about` names the frame or card; the quiz card goes beside it with the arrow from it, titled after it. A stale `about` falls back to the source note.
- Preview: "Links to existing cards" lists each link by title; a quiz about something says so.
- Verification: Rust test for the conditional schemas and rules, unit test for handle resolution, `tests/ai-canvas-links.browser.mjs` (link, placement, color, stale handle, undo, quiz about a frame). Live answer quality not measured.

## Phase 1 as built

- `captureCanvasMap` (`src/features/editor/blocksuite/canvas-map.ts`) reads the canvas; `formatCanvasMap` (`src/services/canvas-map-format.ts`) orders, describes and budgets it. The composer formats the map after citation markers are assigned, so each card line names its markers.
- Everything is listed in reading order (frames followed by their cards), so handle numbers read like the canvas. Media cards share the K handles with a kind (`K4 YouTube "…"`); shapes and text boxes are T.
- Groups and arrows to objects that aren't cards (frames, shapes) are described; an arrow end that is a free point reads "a point".
- The map is sent only when sources are on: "No notes" sends none. The suggestion path (`cardRequestContext`) includes it too.
- The instructions keep the browsing and editing limits and add `CANVAS_MAP_RULES`; requests without a map are unchanged, so the frozen payload baseline did not change.
- Not done in phase 1: opening a card named in an answer except through its citations, and a map for Note tabs (§4.3 suggested the note's own arrows; deferred until asked for).
- Verification: unit tests for the format, ordering, regions, budget trimming and the composer's markers; a Rust test for the instructions; `tests/canvas-map.browser.mjs` reads a real canvas; `tests/card-suggestions.browser.mjs` checks that a sent request carries the map. Answer quality with a live model is not measured yet.

## 1. Goal

Ask Knot should understand the structure people build on a canvas, not only the words on it: which cards exist, how they are grouped, how arrows connect them, and roughly where things are. It should then be able to answer questions about that structure, build on it, suggest improvements to it, and rearrange it, always through a preview with Apply and Undo.

Not goals: pixel-perfect vision of the canvas, editing without a preview, or changing anything outside the open notebook.

## 2. Today

- `captureAiContext` (`src/features/editor/blocksuite/ai.ts`) sends note blocks in order with their note, parent, heading, list and checked state. In the compact format (`src-tauri/src/ai_context.rs`) canvas notes are separated by `--- note N ---` lines.
- Other canvas elements (shapes, text, arrow labels, mind map nodes) are flattened into plain lines of text (`canvasText`). An arrow arrives as its label only, with no ends or direction; a mind map arrives as a list of labels without branches.
- No positions, sizes, frames, groups or connections are sent. The instructions say so: "Canvas text does not describe spatial or connector relationships" (`BASE_LIMITS` in `ai.rs`).
- Canvas proposals can connect only the cards they create (`connections` use indices into the proposal's own `blocks`). Placement is decided by Knot's code (`layoutAiCards`, `quizCardPlacement`, `clearPlacement`).
- `view_images` shows images inside notes, not the canvas.

## 3. Principles

1. **Describe, don't render.** Send a compact text description of the canvas (the *canvas map*), not a screenshot. It is cheap, exact about connections, and works with every model.
2. **Relations first, geometry second.** Arrows, frames and groups carry most of the meaning. Positions are sent as coarse, relative information, never raw coordinates.
3. **Stable handles.** Each object gets a short handle for the request (`K1` card, `F1` frame, `G1` group, `M1` mind map, `A1` arrow). Handles are request-local, like `[S1]` citations, and map back to block IDs only inside Knot.
4. **The AI decides structure; Knot does geometry.** The model may say "arrange these as a flow" or "connect K2 to K5 with *requires*"; Knot computes positions, avoids overlaps and validates every handle.
5. **Same privacy, small cost.** No new kind of data leaves the device: it is the same canvas content, plus how it is arranged. The map is budgeted so a large canvas cannot crowd out note text.

## 4. The canvas map

### 4.1 What it contains

| Object | Sent |
| --- | --- |
| Card (note) | Handle, title (first line), the citation markers of its blocks, size class (short/medium/long), frame and group, region, reading-order index |
| Frame | Handle, title, member handles |
| Group | Handle, title if any, member handles |
| Arrow | Handle, from, to, label, whether it has an arrowhead at one end, both or neither; arrows to non-card objects name that object |
| Mind map | Handle, its tree as indented labels |
| Media card (YouTube, link, PDF, image, file) | Handle, kind and title |
| Shape / text box | Handle and text, region |
| Selection | Which handles are selected |

**Region** is a coarse 3×3 grid over the bounds of the described objects (top-left … bottom-right), plus each card's nearest neighbours (up to 3, with direction). **Reading order** sorts objects top-to-bottom, left-to-right within frames, then frames in the same order, so "walk me through it" has a natural default when there are no arrows.

### 4.2 Format

A `canvasMap` field next to `noteSources`, one line per object, for example:

```
canvasMap:
F1 "Testing principles" [top-left]: K1 K2 K3
K1 "Testing finds defects" [S4–S5] short, in F1, right of K2
K2 "Early testing is cheaper" [S6–S8] medium, in F1
K3 "Other details" [S9] short, in F1, below K1
K4 "Course plan" [S1–S3] long, [middle-left]
A1 K2 -requires-> K1
A2 K4 -> F1
M1 "Testing"
  Methods
    Unit
selected: K2
```

Cards carry their citation markers, so answers about structure can still cite the text that supports them.

### 4.3 Scope and budget

- **Whole canvas** when it fits the map budget (about 3,000 tokens, estimated from UTF-8 bytes like the workspace evidence budget).
- **Large canvases:** the selection or focused card, its frame, everything within two arrow-hops, then the nearest objects, then a one-line summary of the rest ("12 more cards in 3 frames not described"). Arrows between described cards are always kept; positions are dropped first.
- **Note tab:** the focused note's own arrows and frame only.
- **Workspace search excerpts** stay as they are (no map for other notebooks).
- The map follows the same per-request byte limits (`context.len() > 180000` in `ai_respond`) and is counted in diagnostics as its own composition field.

### 4.4 Instructions

`BASE_LIMITS` changes from "Canvas text does not describe spatial or connector relationships" to rules sent only when a map is present: arrows are directed relations, unlabelled arrows are unspecified relations, regions are approximate, objects not described may exist (say so when the summary line is present), and handles are never shown to the user, who sees card titles instead.

## 5. Phases

### Phase 1 — Read the canvas

What: build the map, send it with canvas requests, update the instructions.

Unlocks: "what depends on X?", "summarize this frame", "walk me through this in order", "which cards aren't connected?", "how do these two cards relate?", and answers that cite real arrows instead of inferring links from wording.

Work:
- `canvasMap(doc, focus)` in a new `src/features/editor/blocksuite/canvas-map.ts`: collect objects, assign handles, compute regions, neighbours and reading order, apply the budget. Pure parts (regions, ordering, budget trimming, text format) in `src/services/canvas-map-format.ts` for unit tests.
- Include it from `captureAiContext` / `captureCardContext` when the canvas is open; `ai_context::compact` passes it through; rules in `ai.rs` added only when present (the frozen payload baseline changes only for canvas requests, deliberately).
- Answers that mention cards show their titles; a mentioned card can be opened from the answer through the existing Open source path (handles resolve to the card's first block).

Size: medium. No schema or storage changes.

### Phase 2 — Build on what's there

What: proposals may refer to existing objects by handle.

Unlocks:
- **Break this into ideas** links new idea cards to existing cards elsewhere on the canvas ("Early testing is cheaper → requires → Static testing").
- **Create on canvas** extends a cluster: new cards can be connected to existing ones and placed beside the cards they connect to.
- **Quiz a frame or cluster** ("quiz me on the Testing principles frame"), and relationship questions ("What does early testing require?").

Work:
- `connections` endpoints become either a new-card index or an existing handle (schema: `from`/`to` as strings, `"new:2"` or `"K5"`; the app maps them). Invalid or stale handles invalidate the preview, as invented citations do today.
- Placement prefers space beside the existing cards a new card connects to (extends `clearPlacement`).
- Quiz context can be scoped to a frame's or group's cards.
- Preview lists links to existing cards separately ("Links to 2 existing cards: …") so they can be reviewed.

Size: medium.

### Phase 3 — Suggest and check

What: help improve the map without being asked for a specific edit.

Unlocks:
- **Suggest missing connections:** a new `connect_cards` tool proposes arrows between existing cards, each with a relation type and a one-line reason; Apply adds the chosen ones.
- **Check the map:** an answer listing arrows that contradict card text, duplicate clusters, and relations that look reversed (answer only; fixes go through proposals).
- **Loose ends:** unconnected cards and empty frames are found locally, with no AI request, and can be offered as a canvas suggestion like "Break this into ideas?".

Size: medium. The per-proposal checkbox list in the preview is new UI.

### Phase 4 — Arrange

What: layout that follows the content, used by every canvas proposal and by an explicit "tidy this up".

Unlocks: processes left to right, hierarchies as trees, a central idea with the rest around it, clusters kept together; "arrange this frame as a flow".

Work:
- Local layout engines in `ai-layout.ts`: flow (layered, left to right), tree (top-down), hub (radial), grid (fallback). Pure and unit tested.
- An `arrange_cards` tool: the model returns the structure kind and the order or hierarchy over handles; Knot computes positions, moves only the named objects, fits the frame, and previews before/after. One undo step.
- Break this into ideas and Create on canvas ask for a structure kind with their cards and use the same engines.

Size: large (layout quality needs iteration and visual checks).

### Phase 5 — Visual fallback (optional)

What: when a question is about what the canvas *looks like* (colours, drawings, handwriting, pictures placed on the canvas), render the visible area to an image and send it through the existing `view_images` path.

Size: small–medium; costs image tokens per use, so it stays a tool the model calls only when needed.

## 6. Cross-cutting

- **Cost:** a map of 50 cards and 40 arrows is roughly 1,500–2,500 tokens before caching, about $0.0005 per message on GPT-6 Luna at published prices. Measured with diagnostics in each phase.
- **Prompt caching:** the map sits in the context prefix with stable ordering (handles assigned by reading order), so unchanged canvases keep cache hits; any edit changes it, as note edits do today.
- **Staleness:** proposals stay bound to the document revision; handles are resolved at Apply and refused if the object changed or is gone.
- **Privacy:** same content as today plus arrangement; no positions in raw coordinates; nothing about other notebooks.
- **Accessibility:** answers name cards by title; new preview lists stay keyboard reachable and themed like existing proposals.
- **Diagnostics:** map bytes, objects described, objects summarized and trimming level are recorded with each attempt.

## 7. Verification

- Unit tests for map building, regions, reading order, budget trimming, handle resolution and each layout engine.
- Rust tests for the new instructions and schema; deliberate update of the frozen payload baseline for canvas requests only.
- Browser tests on real canvases: frames, groups, arrows to frames, mind maps, large-canvas trimming, stale handles refused, Undo.
- Paid quality runs (with an approved budget, as for earlier suites): a `canvas-v1` suite of structure questions with known answers, proposals linking existing cards, and arrangement cases checked visually.

## 8. Open questions

1. ~~Should the map be sent for every message while a canvas is open, or only when the message seems to be about the canvas?~~ **Decided 16 November 2026: every message while a canvas is open.** Simpler and more reliable than guessing intent; the budget in §4.3 bounds the cost.
2. Should Phase 3's connection suggestions also appear as an ambient canvas suggestion, or only when asked?
3. Is the 3,000-token map budget right for your largest canvases?
4. Phase 5: worth doing at all, given drawings and pictures on canvases?

## 9. Order

1 → 2 → 4 → 3 → 5. Phase 1 is the foundation; Phase 2 makes the features just built (quizzes, Break this into ideas) aware of each other; Phase 4 fixes the most visible weakness (generic layout); Phase 3 builds on both; Phase 5 only if needed.
