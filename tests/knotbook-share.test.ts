import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  planShare,
  savedShareInfo,
  type SavedShareInfo,
} from "../src/services/knotbook-share";
import type { ReferenceKind } from "../src/features/editor/blocksuite/references";

const info = (
  refs: [string, ReferenceKind][],
  cards: string[] = [],
): SavedShareInfo => ({
  refs: new Map(refs),
  cards: new Set(cards),
});
const titles = new Map(
  [
    "physics",
    "waves",
    "equations",
    "timetable",
    "lab",
    "safety",
    "equipment",
    "loop",
  ].map((id) => [id, id[0].toUpperCase() + id.slice(1)]),
);
// Physics shows Waves on its canvas, which shows Equations; Physics links to
// Timetable and Lab; Lab shows Safety and links to Equipment.
const graph = new Map<string, SavedShareInfo>([
  [
    "physics",
    info(
      [
        ["waves", "canvas"],
        ["timetable", "link"],
        ["lab", "inline"],
      ],
      ["c1"],
    ),
  ],
  [
    "waves",
    info(
      [
        ["equations", "canvas"],
        ["physics", "link"],
      ],
      ["c2"],
    ),
  ],
  ["equations", info([])],
  ["timetable", info([])],
  [
    "lab",
    info(
      [
        ["safety", "canvas"],
        ["equipment", "link"],
      ],
      ["c3"],
    ),
  ],
  ["safety", info([])],
  ["equipment", info([])],
]);
const none = new Set<string>();

describe("planShare", () => {
  it("includes canvas notebooks at every depth and offers links unticked", () => {
    const plan = planShare("physics", titles, graph, none, none);
    expect(plan.rows.map((r) => [r.id, r.section, r.depth, r.checked])).toEqual(
      [
        ["physics", "included", 0, true],
        ["waves", "included", 1, true],
        ["equations", "included", 2, true],
        ["timetable", "linked", 0, false],
        ["lab", "linked", 0, false],
      ],
    );
    expect(plan.selected.map((s) => s.id)).toEqual([
      "physics",
      "waves",
      "equations",
    ]);
    expect(plan.unshared.map((u) => u.id).sort()).toEqual(["lab", "timetable"]);
    expect(plan.cards).toEqual(["c1", "c2"]);
  });

  it("ticking a linked notebook brings its canvas and offers its links beneath it", () => {
    const plan = planShare("physics", titles, graph, new Set(["lab"]), none);
    const lab = plan.rows.filter((r) => r.section === "linked");
    expect(lab.map((r) => [r.id, r.depth, r.checked])).toEqual([
      ["timetable", 0, false],
      ["lab", 0, true],
      ["safety", 1, true],
      ["equipment", 1, false],
    ]);
    expect(plan.selected.map((s) => [s.id, s.role])).toEqual([
      ["physics", "root"],
      ["waves", "canvas"],
      ["equations", "canvas"],
      ["lab", "linked"],
      ["safety", "canvas"],
    ]);
    expect(plan.cards).toEqual(["c1", "c2", "c3"]);
  });

  it("unticking a canvas notebook drops its subtree and marks it unshared", () => {
    const plan = planShare("physics", titles, graph, none, new Set(["waves"]));
    expect(plan.rows.map((r) => r.id)).toEqual([
      "physics",
      "waves",
      "timetable",
      "lab",
    ]);
    expect(plan.selected.map((s) => s.id)).toEqual(["physics"]);
    expect(plan.unshared.map((u) => u.id)).toContain("waves");
  });

  it("lists each notebook once through loops and diamonds", () => {
    const loops = new Map<string, SavedShareInfo>([
      [
        "physics",
        info([
          ["waves", "canvas"],
          ["lab", "canvas"],
        ]),
      ],
      ["waves", info([["loop", "canvas"]])],
      ["lab", info([["loop", "canvas"]])],
      ["loop", info([["physics", "canvas"]])],
    ]);
    const plan = planShare("physics", titles, loops, none, none);
    expect(plan.rows.map((r) => r.id)).toEqual([
      "physics",
      "waves",
      "loop",
      "lab",
    ]);
  });

  it("never offers notebooks that aren't in the live catalog", () => {
    const live = new Map(titles);
    live.delete("timetable"); // in Trash
    const plan = planShare("physics", live, graph, none, none);
    expect(plan.rows.some((r) => r.id === "timetable")).toBe(false);
    expect(plan.unshared.some((u) => u.id === "timetable")).toBe(false);
  });
});

describe("savedShareInfo", () => {
  it("reads placements, link cards, inline mentions and card links", () => {
    const envelope = new Y.Doc();
    const pages = new Y.Array();
    envelope.getMap("meta").set("pages", pages);
    pages.push([{ id: "physics" }]);
    const body = new Y.Doc();
    const blocks = body.getMap("blocks");
    const block = (fields: Record<string, unknown>) => {
      const map = new Y.Map();
      blocks.set(String(blocks.size), map);
      for (const [key, value] of Object.entries(fields)) map.set(key, value);
      return map;
    };
    block({ "sys:flavour": "affine:page" });
    block({ "sys:flavour": "affine:embed-synced-doc", "prop:pageId": "waves" });
    block({
      "sys:flavour": "affine:embed-linked-doc",
      "prop:pageId": "timetable",
    });
    const text = new Y.Text();
    block({ "sys:flavour": "affine:paragraph", "prop:text": text });
    text.insert(0, "See lab", {
      reference: { type: "LinkedPage", pageId: "lab" },
    });
    body.getMap("knot:card-links").set("instance-1", "card-9");

    const result = savedShareInfo("physics", {
      collection: [...Y.encodeStateAsUpdate(envelope)],
      document: [...Y.encodeStateAsUpdate(body)],
    });
    expect([...result.refs]).toEqual([
      ["waves", "canvas"],
      ["timetable", "link"],
      ["lab", "inline"],
    ]);
    expect([...result.cards]).toEqual(["card-9"]);
  });
});
