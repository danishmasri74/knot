import { expect, it } from "vitest";
import {
  citationRange,
  formatCanvasMap,
  type CanvasMapData,
} from "../src/services/canvas-map-format";
import { cardRequestContext } from "../src/features/editor/blocksuite/card-suggestions";

const empty: CanvasMapData = {
  cards: [],
  frames: [],
  groups: [],
  arrows: [],
  mindmaps: [],
  texts: [],
  selected: [],
};

const map: CanvasMapData = {
  ...empty,
  cards: [
    { id: "plan", title: "Course plan", length: 900, box: [0, 600, 300, 200] },
    { id: "defects", title: "Testing finds defects", length: 120, box: [1040, 560, 300, 150] },
    { id: "early", title: "Early testing is cheaper", length: 300, box: [1400, 560, 300, 150] },
    { id: "video", title: "ISTQB intro", length: 0, box: [0, 1400, 300, 200], kind: "YouTube" },
  ],
  frames: [
    { id: "frame", title: "Testing principles", box: [1000, 500, 760, 400], members: ["defects", "early"] },
  ],
  groups: [{ id: "group", title: "", members: ["plan", "video"] }],
  arrows: [
    { from: "early", to: "defects", label: "requires", heads: "to" },
    { from: "plan", to: "frame", label: "", heads: "to" },
    { from: "video", to: undefined, label: "", heads: "none" },
  ],
  mindmaps: [
    {
      id: "mm",
      box: [0, 0, 400, 300],
      nodes: [
        { text: "Testing", depth: 0 },
        { text: "Methods", depth: 1 },
        { text: "Unit", depth: 2 },
      ],
    },
  ],
  texts: [{ id: "t", text: "Exam in May", box: [1500, 1400, 200, 50] }],
  selected: ["early"],
};

it("describes cards, frames, groups, arrows and mind maps", () => {
  const text = formatCanvasMap(
    map,
    new Map([
      ["defects", [4, 5]],
      ["early", [6, 7, 8]],
    ]),
  );
  expect(text.split("\n")).toEqual([
    'K1 "Course plan" long, in G1, left',
    'F1 frame "Testing principles" [right]: K2 K3',
    'K2 "Testing finds defects" [S4–S5] short, in F1, left of K3',
    'K3 "Early testing is cheaper" [S6–S8] medium, in F1, right of K2',
    'K4 YouTube "ISTQB intro" in G1, bottom-left',
    "G1 group: K1 K4",
    "arrow K3 -requires-> K2",
    "arrow K1 -> F1",
    "arrow K4 -- a point",
    "M1 mind map [top-left]:",
    "  Testing",
    "    Methods",
    "      Unit",
    'T1 text "Exam in May" [bottom-right]',
    "selected: K3",
  ]);
});

it("drops positions, then the furthest cards, to stay in budget", () => {
  const many: CanvasMapData = {
    ...empty,
    cards: Array.from({ length: 200 }, (_, i) => ({
      id: `c${i}`,
      title: `Card number ${i} with a reasonably long title`,
      length: 100,
      box: [i * 400, 0, 300, 200],
    })),
    arrows: [{ from: "c150", to: "c151", label: "causes", heads: "to" }],
    selected: ["c150"],
  };
  const text = formatCanvasMap(many, new Map(), 3000);
  expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(3000);
  expect(text).toContain('"Card number 150');
  expect(text).toContain('"Card number 151');
  expect(text).not.toContain("right of");
  expect(text).toMatch(/\d+ more cards are on the canvas but not described\.$/);
  expect(text).toMatch(/arrow K\d+ -causes-> K\d+/);
});

it("formats citation ranges and skips an empty canvas", () => {
  expect(citationRange([3, 1, 2, 7])).toBe("[S1–S3, S7]");
  expect(citationRange([])).toBe("");
  expect(formatCanvasMap(empty)).toBe("");
});

it("the composer names each card's citation markers", () => {
  const structure = [
    { id: "b1", parent: null, note: "defects", type: "h2", text: "Testing finds defects" },
    { id: "b2", parent: null, note: "defects", type: "text", text: "Not their absence." },
  ];
  const sent = JSON.parse(cardRequestContext("doc", structure, map));
  expect(sent.canvasMap).toContain('"Testing finds defects" [S1–S2]');
  expect(JSON.parse(cardRequestContext("doc", structure)).canvasMap).toBeUndefined();
});

it("resolves the handles the description used", async () => {
  const { canvasHandles } = await import("../src/services/canvas-map-format");
  const handles = canvasHandles(map);
  expect(handles.get("K1")?.title).toBe("Course plan");
  expect(handles.get("K3")?.id).toBe("early");
  expect(handles.get("F1")?.title).toBe("Testing principles");
  expect(handles.get("T1")?.id).toBe("t");
  expect(handles.get("K9")).toBeUndefined();
});
