import { describe, expect, it } from "vitest";
import { mergeScene, revisionChanges, validateScene, type SceneRevision } from "../src/features/editor/blocksuite/scene";
import { sceneReport } from "../src/features/editor/blocksuite/scene-report";
import type { Box } from "../src/features/editor/blocksuite/scene-solver";

const card = (id: string, extra: Record<string, unknown> = {}) => ({
  id, kind: "card", text: id, content: [], nodes: [], shape: "", in: "",
  place: { rel: "", of: "", align: "", gap: 0 }, cell: [], width: 0, color: "",
  direction: "", order: 0, role: "", ...extra,
});
const arrow = (from: string, to: string, label = "") => ({ from, to, label, heads: "to", style: "", color: "" });
const scene = (objects: unknown[], connectors: unknown[] = []) =>
  validateScene({ plan: "", anchor: { near: "", side: "" }, objects, arrangements: [], connectors });
const revision = (r: Partial<SceneRevision>): SceneRevision => ({
  done: false, summary: "", objects: [], remove: [], arrangements: [], removeArrangements: [],
  connectors: [], removeConnectors: [], ...r,
});

describe("sceneReport", () => {
  it("finds an arrow passing over a card and arrows that cross", () => {
    const s = scene(
      [card("a"), card("b"), card("c"), card("d"), card("e")],
      [arrow("a", "c", "leads to"), arrow("d", "e")],
    );
    const boxes = new Map<string, Box>([
      ["a", [0, 0, 100, 100]],
      ["b", [200, 0, 100, 100]],
      ["c", [400, 0, 100, 100]],
      ["d", [150, -200, 50, 50]],
      ["e", [150, 200, 50, 50]],
    ]);
    const r = sceneReport(s, boxes, []);
    expect(r.crossings).toHaveLength(1);
    expect(r.crossings[0]).toContain('"b" (b)');
    expect(r.crossings[0]).toContain('"leads to"');
    expect(r.arrowCrossings).toHaveLength(1);
    expect(r.issues).toBe(2);
  });

  it("measures an elbowed arrow along its drawn path, not a line between centres", () => {
    // "a" top left, "c" lower right: the straight line passes clear of "b",
    // but the elbow turns down through the middle of the gap, right over it.
    const s = scene([card("a"), card("b"), card("c")], [arrow("a", "c")]);
    const boxes = new Map<string, Box>([
      ["a", [0, 0, 100, 100]],
      ["b", [230, 60, 40, 40]],
      ["c", [400, 200, 100, 100]],
    ]);
    expect(sceneReport(s, boxes, [], { shape: "straight" }).crossings).toEqual([]);
    const elbowed = sceneReport(s, boxes, [], { shape: "elbowed" });
    expect(elbowed.crossings).toHaveLength(1);
    expect(elbowed.crossings[0]).toContain('passes over "b"');
  });

  it("flags a label too long for the gap it sits in", () => {
    const s = scene([card("a"), card("b")], [arrow("a", "b", "supports early defect detection")]);
    const close = new Map<string, Box>([
      ["a", [0, 0, 360, 200]],
      ["b", [410, 0, 360, 200]],
    ]);
    const r = sceneReport(s, close, []);
    expect(r.crossings).toHaveLength(1);
    expect(r.crossings[0]).toContain("label");
    expect(r.crossings[0]).toContain('"a" (a) and "b" (b)');
    const roomy = new Map<string, Box>([
      ["a", [0, 0, 360, 200]],
      ["b", [720, 0, 360, 200]],
    ]);
    expect(sceneReport(s, roomy, []).issues).toBe(0);
  });

  it("ignores the frame an arrow's ends sit in", () => {
    const s = scene(
      [card("f", { kind: "frame", text: "Section" }), card("a", { in: "f" }), card("b", { in: "f" })],
      [arrow("a", "b")],
    );
    const boxes = new Map<string, Box>([
      ["f", [-40, -60, 400, 300]],
      ["a", [0, 0, 100, 100]],
      ["b", [200, 0, 100, 100]],
    ]);
    expect(sceneReport(s, boxes, []).issues).toBe(0);
  });

  it("flags positions that contradict the reading order", () => {
    const s = scene([card("first", { order: 1 }), card("second", { order: 2 })]);
    const boxes = new Map<string, Box>([
      ["first", [0, 300, 100, 100]],
      ["second", [0, 0, 100, 100]],
    ]);
    const r = sceneReport(s, boxes, []);
    expect(r.order).toHaveLength(1);
    expect(r.order[0]).toContain("above");
  });

  it("reads a side branch by its arrow, not its position", () => {
    const s = scene(
      [card("decide", { order: 1 }), card("branch", { order: 2 }), card("next", { order: 3 })],
      [arrow("decide", "branch", "no"), arrow("decide", "next", "yes")],
    );
    const boxes = new Map<string, Box>([
      ["decide", [400, 0, 100, 100]],
      ["branch", [0, 0, 100, 100]],
      ["next", [400, 300, 100, 100]],
    ]);
    expect(sceneReport(s, boxes, []).order).toEqual([]);
    // Without the arrow the same position is out of order.
    const loose = scene([card("decide", { order: 1 }), card("branch", { order: 2 })]);
    expect(sceneReport(loose, boxes, []).order).toHaveLength(1);
  });

  it("lists source passages the scene leaves out, and the size against the screen", () => {
    const s = scene([card("risk", { content: [{ type: "paragraph", text: "Risk combines likelihood and impact of problems." }] })]);
    const boxes = new Map<string, Box>([["risk", [0, 0, 3200, 500]]]);
    const r = sceneReport(s, boxes, [], {
      sources: [
        "Risk combines likelihood and impact of problems.",
        "Some risks are accepted, transferred, or handled with contingency plans.",
      ],
      view: [0, 0, 1600, 1000],
    });
    expect(r.missing).toEqual(["Some risks are accepted, transferred, or handled with contingency plans."]);
    expect(r.size).toContain("2.0 screens wide");
  });
});

describe("mergeScene", () => {
  it("replaces, adds and removes objects, arrows and arrangement members", () => {
    const s = validateScene({
      plan: "p",
      anchor: { near: "", side: "" },
      objects: [card("a"), card("b"), card("c")],
      arrangements: [{ id: "row", kind: "row", members: ["a", "b", "c"], center: "", columns: 0, in: "", place: { rel: "", of: "", align: "", gap: 0 }, gap: 0, align: "" }],
      connectors: [arrow("a", "b"), arrow("b", "c")],
    });
    const r = revision({
      objects: [card("a", { text: "A, renamed" }), card("d", { place: { rel: "below", of: "a", align: "", gap: 0 } })],
      remove: ["c"],
      connectors: [arrow("d", "a", "explains")],
      removeConnectors: [{ from: "a", to: "b" }],
    });
    expect(revisionChanges(r)).toBe(true);
    const m = mergeScene(s, r);
    expect(m.objects.map((o) => o.id)).toEqual(["a", "b", "d"]);
    expect(m.objects[0].text).toBe("A, renamed");
    expect(m.arrangements[0].members).toEqual(["a", "b"]);
    expect(m.connectors.map((c) => `${c.from}>${c.to}`)).toEqual(["d>a"]);
    expect(m.plan).toBe("p");
  });

  it("treats an empty revision as no change", () => {
    expect(revisionChanges(revision({ done: true }))).toBe(false);
  });
});

describe("web evidence through a review", () => {
  it("keeps source references on changed objects and marks new ones, so validation passes", async () => {
    const { inheritSourceRefs } = await import("../src/features/editor/blocksuite/scene-review");
    const { validateProposal } = await import("../src/features/editor/blocksuite/ai");
    const web = JSON.stringify({ webOutcomes: [{ state: "ready" }], citationSources: [{ kind: "web", ref: "c/s1", text: "A fact.", document: "web", id: "w1", captureId: "c", sectionId: "s1" }] });
    const cited = (id: string, extra: Record<string, unknown> = {}) =>
      card(id, { sourceRefs: ["c/s1"], content: [{ type: "paragraph", text: `About ${id}`, sourceRefs: ["c/s1"] }], ...extra });
    const before = validateProposal(
      { plan: "", anchor: { near: "", side: "" }, objects: [cited("a"), cited("b")], arrangements: [],
        connectors: [{ ...arrow("a", "b"), reason: "", sourceRefs: ["c/s1"] }] },
      web,
    ).scene!;
    // The review moved "b" (no refs in its reply), added "c" and an arrow.
    const merged = mergeScene(before, revision({
      objects: [card("b", { content: [{ type: "paragraph", text: "About b" }], place: { rel: "below", of: "a", align: "", gap: 0 } }), card("c")],
      connectors: [arrow("c", "a", "explains")],
    }));
    const kept = inheritSourceRefs(before, merged);
    const b = kept.objects.find((o) => o.id === "b")!;
    expect(b.sourceRefs).toEqual(["c/s1"]);
    expect(b.content[0].sourceRefs).toEqual(["c/s1"]);
    expect(kept.objects.find((o) => o.id === "c")!.sourceRefs).toEqual([]);
    expect(kept.connectors.map((c) => c.sourceRefs)).toEqual([["c/s1"], []]);
    expect(() => validateProposal({ scene: kept }, web)).not.toThrow();
    expect(() => validateProposal({ scene: merged }, web)).toThrow();
    // Loading the editor modules the first time is slow.
  }, 60_000);
});
