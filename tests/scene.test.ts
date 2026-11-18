import { describe, expect, it } from "vitest";
import {
  sceneBlocks,
  sceneSummary,
  validateScene,
  type Scene,
} from "../src/features/editor/blocksuite/scene";
import {
  FRAME_PAD,
  FRAME_TOP,
  sceneOverlaps,
  solveScene,
  type Box,
} from "../src/features/editor/blocksuite/scene-solver";

const card = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: "card",
  text: id,
  content: [{ type: "paragraph", text: `About ${id}` }],
  nodes: [],
  shape: "",
  in: "",
  place: { rel: "", of: "", align: "", gap: 0 },
  cell: [],
  width: 0,
  color: "",
  direction: "",
  order: 0,
  role: "",
  ...extra,
});
const scene = (objects: unknown[], extra: Record<string, unknown> = {}) =>
  validateScene({
    plan: "",
    anchor: { near: "", side: "" },
    objects,
    arrangements: [],
    connectors: [],
    ...extra,
  });
const sizes = (s: Scene, w = 300, h = 200) =>
  new Map(s.objects.map((o) => [o.id, { width: w, height: h }]));
const right = (b: Box) => b[0] + b[2];
const bottom = (b: Box) => b[1] + b[3];

describe("validateScene", () => {
  it("repairs bad references instead of rejecting the scene", () => {
    const s = scene(
      [
        card("a", { in: "nowhere", place: { rel: "rightOf", of: "ghost", align: "", gap: 0 } }),
        card("a"),
        card("K3"),
      ],
      { connectors: [{ from: "a", to: "missing", label: "x", heads: "to", style: "", color: "" }] },
    );
    expect(s.objects.map((o) => o.id)).toEqual(["a", "a_2", "K3_3"]);
    expect(s.objects[0].in).toBe("");
    expect(s.objects[0].place.of).toBe("");
    expect(s.connectors).toEqual([]);
    expect(s.notes.length).toBeGreaterThanOrEqual(4);
  });

  it("breaks frame loops and keeps mind map parents earlier", () => {
    const s = scene([
      card("f1", { kind: "frame", in: "f2" }),
      card("f2", { kind: "frame", in: "f1" }),
      card("m", {
        kind: "mindmap",
        nodes: [
          { text: "Root", parent: 5 },
          { text: "A", parent: 0 },
          { text: "B", parent: 7 },
        ],
      }),
    ]);
    expect(s.objects.filter((o) => o.in).length).toBeLessThan(2);
    expect(s.objects[2].nodes.map((n) => n.parent)).toEqual([-1, 0, 0]);
  });

  it("accepts mind map nodes and existing handles as arrow ends", () => {
    const s = validateScene(
      {
        plan: "Overview",
        anchor: { near: "K1", side: "below" },
        objects: [
          card("m", { kind: "mindmap", nodes: [{ text: "R", parent: -1 }, { text: "C", parent: 0 }] }),
          card("d"),
        ],
        arrangements: [],
        connectors: [
          { from: "m#1", to: "d", label: "explained in", heads: "to", style: "", color: "" },
          { from: "d", to: "K1", label: "", heads: "to", style: "dashed", color: "blue" },
          { from: "m#9", to: "d", label: "", heads: "to", style: "", color: "" },
        ],
      },
      new Set(["K1"]),
    );
    expect(s.anchor).toEqual({ near: "K1", side: "below" });
    expect(s.connectors.map((c) => [c.from, c.to])).toEqual([
      ["m#1", "d"],
      ["d", "K1"],
      ["m", "d"],
    ]);
  });

  it("gives an untitled table its card's title", () => {
    const s = scene([
      card("waterfall", {
        text: "Waterfall",
        content: [{ type: "table", text: "", columns: ["Aspect", "Value"], rows: [["Flow", "Sequential"]] }],
      }),
    ]);
    expect(s.objects[0].content[0].text).toBe("Waterfall");
  });

  it("rejects responses with nothing to create", () => {
    expect(() => validateScene({ objects: [] })).toThrow();
    expect(() => validateScene({ objects: [{ kind: "card", text: "", content: [] }] })).toThrow();
  });

  it("summarises and flattens in reading order", () => {
    const s = scene([card("b", { order: 2 }), card("a", { order: 1 }), card("f", { kind: "frame", text: "Section" })]);
    expect(sceneSummary(s)).toBe("2 cards and 1 frame");
    expect(sceneBlocks(s).map((b) => b.text)).toEqual(["a", "b", "Section"]);
  });
});

describe("solveScene", () => {
  it("places objects where the relations say, with room for labels", () => {
    const s = scene(
      [
        card("a"),
        card("b", { place: { rel: "rightOf", of: "a", align: "center", gap: 0 } }),
        card("c", { place: { rel: "below", of: "a", align: "start", gap: 60 } }),
      ],
      {
        connectors: [
          { from: "a", to: "b", label: "a fairly long relation label here", heads: "to", style: "", color: "" },
        ],
      },
    );
    const { boxes } = solveScene(s, { sizes: sizes(s) });
    const [a, b, c] = ["a", "b", "c"].map((id) => boxes.get(id)!);
    expect(b[0]).toBeGreaterThan(right(a) + 100);
    expect(b[1]).toBe(a[1]);
    expect(c[0]).toBe(a[0]);
    expect(c[1]).toBe(bottom(a) + 60);
  });

  it("fits frames around their contents and lays frames side by side", () => {
    const s = scene([
      card("deck1", { kind: "frame", text: "Deck 1" }),
      card("deck2", { kind: "frame", text: "Deck 2", place: { rel: "rightOf", of: "deck1", align: "start", gap: 0 } }),
      card("a", { in: "deck1" }),
      card("b", { in: "deck1", place: { rel: "below", of: "a", align: "", gap: 0 } }),
      card("c", { in: "deck2" }),
    ]);
    const { boxes } = solveScene(s, { sizes: sizes(s) });
    const f1 = boxes.get("deck1")!;
    const f2 = boxes.get("deck2")!;
    const a = boxes.get("a")!;
    const b = boxes.get("b")!;
    expect(a[0]).toBe(f1[0] + FRAME_PAD);
    expect(a[1]).toBe(f1[1] + FRAME_TOP);
    expect(bottom(b) + FRAME_PAD).toBe(bottom(f1));
    expect(f2[0]).toBeGreaterThan(right(f1));
    expect(sceneOverlaps(s, boxes)).toEqual([]);
  });

  it("arranges rows, grids and rings without overlaps", () => {
    const objects = ["c", "s1", "s2", "s3", "s4", "s5", "g1", "g2", "g3", "g4"].map((id) => card(id));
    const s = scene(objects, {
      arrangements: [
        { id: "cycle", kind: "ring", members: ["s1", "s2", "s3", "s4", "s5"], center: "", columns: 0, in: "", place: { rel: "", of: "", align: "", gap: 0 }, gap: 0, align: "" },
        { id: "grid", kind: "grid", members: ["g1", "g2", "g3", "g4"], center: "", columns: 2, in: "", place: { rel: "below", of: "cycle", align: "", gap: 0 }, gap: 0, align: "" },
      ],
    });
    const { boxes } = solveScene(s, { sizes: sizes(s) });
    expect(sceneOverlaps(s, boxes)).toEqual([]);
    const g = ["g1", "g2", "g3", "g4"].map((id) => boxes.get(id)!);
    expect(g[0][1]).toBe(g[1][1]);
    expect(g[2][1]).toBeGreaterThan(bottom(g[0]));
    const ring = ["s1", "s2", "s3", "s4", "s5"].map((id) => boxes.get(id)!);
    expect(Math.min(...g.map((b) => b[1]))).toBeGreaterThan(Math.max(...ring.map(bottom)));
  });

  it("leaves room for arrow labels between grid neighbours and grid cells", () => {
    const label = "supports early defect detection";
    const arrow = (from: string, to: string) => ({ from, to, label, heads: "to", style: "", color: "" });
    const s = scene(["g1", "g2", "g3", "g4"].map((id) => card(id)), {
      arrangements: [{ id: "grid", kind: "grid", members: ["g1", "g2", "g3", "g4"], center: "", columns: 2, in: "", place: { rel: "", of: "", align: "", gap: 0 }, gap: 0, align: "" }],
      connectors: [arrow("g1", "g2")],
    });
    const { boxes } = solveScene(s, { sizes: sizes(s) });
    const [g1, g2, g3, g4] = ["g1", "g2", "g3", "g4"].map((id) => boxes.get(id)!);
    expect(g2[0] - right(g1)).toBeGreaterThanOrEqual(label.length * 8.5);
    // The column gap holds for the whole column, so the grid stays a grid.
    expect(g4[0]).toBe(g2[0]);
    expect(g3[1] - bottom(g1)).toBeLessThan(100);

    const cells = scene([card("a", { cell: [0, 0] }), card("b", { cell: [1, 0] })], { connectors: [arrow("a", "b")] });
    const placed = solveScene(cells, { sizes: sizes(cells) }).boxes;
    expect(placed.get("b")![0] - right(placed.get("a")!)).toBeGreaterThanOrEqual(label.length * 8.5);
  });

  it("widens a card the model made too narrow for its table", () => {
    const table = { type: "table", text: "Maintenance categories", columns: ["Category", "Purpose"], rows: [["Corrective", "Fix defects"]] };
    const s = scene([card("t", { width: 400, content: [table] }), card("p", { width: 400 })]);
    expect(s.objects[0].width).toBe(600);
    expect(s.objects[1].width).toBe(400);
  });

  it("moves the scene clear of existing content beside its anchor", () => {
    const s = scene([card("a"), card("b", { place: { rel: "rightOf", of: "a", align: "", gap: 0 } })], {
      anchor: { near: "", side: "right" },
    });
    const anchor: Box = [0, 0, 400, 300];
    const blocker: Box = [560, 0, 400, 300];
    const { boxes, report } = solveScene(s, { sizes: sizes(s), anchor, obstacles: [anchor, blocker] });
    const a = boxes.get("a")!;
    expect(a[0]).toBeGreaterThan(right(blocker));
    expect(report.some((r) => r.includes("moved further out"))).toBe(true);
  });

  it("repairs overlaps the model asked for and says so", () => {
    const s = scene([
      card("a", { cell: [0, 0] }),
      card("b", { place: { rel: "below", of: "a", align: "", gap: -1 } }),
      card("c", { place: { rel: "below", of: "a", align: "", gap: 0 } }),
    ]);
    const { boxes, report } = solveScene(s, { sizes: sizes(s) });
    expect(sceneOverlaps(s, boxes)).toEqual([]);
    expect(report.some((r) => r.includes("doesn't cover"))).toBe(true);
  });

  it("places objects without a position beside what they connect to", () => {
    const s = scene([card("a"), card("b"), card("c")], {
      connectors: [{ from: "c", to: "a", label: "", heads: "to", style: "", color: "" }],
    });
    const { boxes, report } = solveScene(s, { sizes: sizes(s) });
    const a = boxes.get("a")!;
    const c = boxes.get("c")!;
    // Right next to "a" on a free side (b took the right).
    const gap = Math.max(c[0] - right(a), a[0] - right(c), c[1] - bottom(a), a[1] - bottom(c));
    expect(gap).toBeLessThanOrEqual(100);
    expect(sceneOverlaps(s, boxes)).toEqual([]);
    expect(report.some((r) => r.includes("no position"))).toBe(true);
  });

  it("ties objects to existing canvas content by handle", () => {
    const s = validateScene(
      {
        plan: "",
        anchor: { near: "", side: "" },
        objects: [card("a", { place: { rel: "below", of: "K2", align: "start", gap: 50 } })],
        arrangements: [],
        connectors: [],
      },
      new Set(["K2"]),
    );
    const k2: Box = [1000, 500, 360, 200];
    const { boxes } = solveScene(s, { sizes: sizes(s), handles: new Map([["K2", k2]]), obstacles: [k2] });
    expect(boxes.get("a")).toEqual([1000, 750, 300, 200]);
  });
});
