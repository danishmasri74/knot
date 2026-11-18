import { describe, expect, it } from "vitest";
import { assembleSections, namespaceSection, readOutline } from "../src/features/editor/blocksuite/scene";
import { sectionMessage } from "../src/features/editor/blocksuite/scene-build";
import { validateProposal } from "../src/features/editor/blocksuite/ai";

const card = (id: string, extra: Record<string, unknown> = {}) => ({
  id, kind: "card", text: id, content: [], nodes: [], shape: "", in: "",
  place: { rel: "", of: "", align: "", gap: 0 }, cell: [], width: 0, color: "",
  direction: "", order: 0, role: "", ...extra,
});
const outlineReply = {
  plan: "One frame per deck.",
  anchor: { near: "", side: "" },
  sections: [
    { id: "d1", title: "Maintenance", covers: "Deck 1, slides 1-20" },
    { id: "d1", title: "Lifecycle", covers: "Deck 2" },
    { id: "", title: "", covers: "skipped: no title" },
  ],
  objects: [],
  arrangements: [],
  connectors: [],
};

describe("readOutline", () => {
  it("reads an outline sent instead of a scene, with unique ids", () => {
    const o = readOutline(outlineReply)!;
    expect(o.sections.map((s) => [s.id, s.title])).toEqual([
      ["d1", "Maintenance"],
      ["section2", "Lifecycle"],
    ]);
    expect(o.plan).toBe("One frame per deck.");
  });

  it("ignores sections when the reply also has objects", () => {
    expect(readOutline({ ...outlineReply, objects: [card("a")] })).toBeUndefined();
    expect(readOutline({ ...outlineReply, sections: [] })).toBeUndefined();
  });

  it("is what validateProposal returns for an outline, kept with a scene once built", () => {
    const p = validateProposal({ replacements: [], blocks: [], ...outlineReply });
    expect(p.outline?.sections).toHaveLength(2);
    expect(p.scene).toBeUndefined();
    const built = assembleSections(p.outline!, { d1: { objects: [card("a")] } });
    const saved = validateProposal({ replacements: [], blocks: [], outline: p.outline, scene: built });
    expect(saved.scene?.objects.map((x) => x.id)).toEqual(["d1", "d1.a"]);
  });
});

describe("sections", () => {
  const section = { id: "d2", title: "Lifecycle", covers: "Deck 2" };

  it("prefixes a section's ids and references, keeping handles and the section", () => {
    const part = namespaceSection(
      {
        objects: [
          card("a"),
          card("m", { kind: "mindmap", nodes: [{ text: "R", parent: -1 }, { text: "C", parent: 0 }] }),
          card("b", { place: { rel: "below", of: "a", align: "", gap: 0 } }),
          card("c", { place: { rel: "rightOf", of: "K1", align: "", gap: 0 } }),
        ],
        arrangements: [{ id: "row", kind: "row", members: ["a", "b"], center: "", columns: 0, in: "", place: { rel: "", of: "", align: "", gap: 0 }, gap: 0, align: "" }],
        connectors: [
          { from: "a", to: "b", label: "leads to", heads: "to", style: "", color: "" },
          { from: "m#1", to: "K1", label: "", heads: "to", style: "", color: "" },
        ],
      },
      section,
      new Set(["K1"]),
    );
    const objects = part.objects as { id: string; in: string; place: { of: string } }[];
    expect(objects.map((o) => o.id)).toEqual(["d2.a", "d2.m", "d2.b", "d2.c"]);
    expect(objects.every((o) => o.in === "d2")).toBe(true);
    expect(objects[2].place.of).toBe("d2.a");
    expect(objects[3].place.of).toBe("K1");
    expect((part.arrangements[0] as { members: string[]; in: string }).members).toEqual(["d2.a", "d2.b"]);
    expect(part.connectors.map((c) => [(c as { from: string }).from, (c as { to: string }).to])).toEqual([
      ["d2.a", "d2.b"],
      ["d2.m#1", "K1"],
    ]);
  });

  it("assembles built sections into frames in outline order, skipping unbuilt ones", () => {
    const outline = readOutline({
      ...outlineReply,
      sections: [
        { id: "s1", title: "One", covers: "" },
        { id: "s2", title: "Two", covers: "" },
        { id: "s3", title: "Three", covers: "" },
      ],
    })!;
    // Both sections used the id "a": prefixes keep them apart.
    const scene = assembleSections(outline, { s3: { objects: [card("a")] }, s1: { objects: [card("a")] } });
    expect(scene.objects.map((o) => `${o.kind}:${o.id}:${o.in}`)).toEqual([
      "frame:s1:",
      "card:s1.a:s1",
      "frame:s3:",
      "card:s3.a:s3",
    ]);
    expect(scene.objects.filter((o) => o.kind === "frame").map((o) => o.order)).toEqual([1, 3]);
  });

  it("tells the model which section to build within the whole outline", () => {
    const outline = readOutline(outlineReply)!;
    const text = sectionMessage(outline, outline.sections[1]);
    expect(text).toContain('Build section "Lifecycle" (id section2)');
    expect(text).toContain("1. Maintenance (id d1): Deck 1, slides 1-20");
  });
});

describe("phase 4", () => {
  it("wraps a replacement in a frame titled like the card, keeping uncovered passages", async () => {
    const { validateScene, wrapForReplacement } = await import("../src/features/editor/blocksuite/scene");
    const s = validateScene({
      plan: "", anchor: { near: "K1", side: "right" }, objects: [card("a"), card("b", { place: { rel: "below", of: "a", align: "", gap: 0 } })],
      arrangements: [], connectors: [],
    }, new Set(["K1"]));
    const { scene, frame } = wrapForReplacement(s, "Testing principles", ["A passage the cards missed."]);
    expect(frame).toBe("ideas");
    expect(scene.anchor.near).toBe("");
    expect(scene.objects[0]).toMatchObject({ id: "ideas", kind: "frame", text: "Testing principles" });
    expect(scene.objects.filter((o) => o.in === "ideas").map((o) => o.id)).toEqual(["a", "b", "other-details"]);
    expect(scene.objects.at(-1)?.content[0].text).toBe("A passage the cards missed.");
    // A scene that is already one frame keeps it.
    const framed = validateScene({ plan: "", anchor: { near: "", side: "" }, objects: [card("f", { kind: "frame", text: "Mine" }), card("x", { in: "f" })], arrangements: [], connectors: [] });
    expect(wrapForReplacement(framed, "T", []).frame).toBe("f");
  });

  it("never uses a free area as an arrow end, only as an anchor", async () => {
    const { validateScene } = await import("../src/features/editor/blocksuite/scene");
    const s = validateScene({
      plan: "", anchor: { near: "A2", side: "" }, objects: [card("a")], arrangements: [],
      connectors: [{ from: "a", to: "A2", label: "", heads: "to", style: "", color: "" }],
    }, new Set(["A2", "K1"]));
    expect(s.anchor.near).toBe("A2");
    expect(s.connectors).toEqual([]);
  });

  it("keeps the user's request in view for a canvas step", async () => {
    const { followUpMessage } = await import("../src/services/ai-followups");
    const step = { action: "cards" as const, label: "Make 9 atomic notes" };
    expect(followUpMessage(step, "Answer text", "Generate atomic notes")).toContain('The user originally asked: "Generate atomic notes"');
    expect(followUpMessage(step, "Answer text")).not.toContain("originally asked");
  });
});

describe("phase 5", () => {
  it("edits what's on the canvas: movable cards, fixed frames, joining an existing frame", async () => {
    const { validateScene } = await import("../src/features/editor/blocksuite/scene");
    const s = validateScene(
      {
        plan: "", anchor: { near: "", side: "" },
        objects: [
          card("k1", { kind: "existing", ref: "K1", text: "ignored", place: { rel: "below", of: "K2", align: "", gap: 0 } }),
          card("f1", { kind: "existing", ref: "F1", place: { rel: "rightOf", of: "K2", align: "", gap: 0 } }),
          card("dup", { kind: "existing", ref: "K1" }),
          card("gone", { kind: "existing", ref: "K9" }),
          card("new", { in: "F1" }),
        ],
        arrangements: [], connectors: [{ from: "k1", to: "K2", label: "part of", heads: "to", style: "", color: "", reason: "Reviews are static testing. And more." }],
      },
      new Set(["K1", "K2", "F1"]),
    );
    expect(s.objects.map((o) => o.id)).toEqual(["k1", "f1", "new"]);
    expect(s.objects[0]).toMatchObject({ ref: "K1", text: "", place: { rel: "below", of: "K2" } });
    expect(s.objects[1].place.rel).toBe("");
    expect(s.objects[2]).toMatchObject({ in: "", into: "F1", place: { rel: "near", of: "F1" } });
    expect(s.connectors[0].reason).toBe("Reviews are static testing.");
    expect(s.notes.join(" ")).toMatch(/F1 stays where it is.*listed twice.*K9 isn't on the canvas/);
  });

  it("accepts a scene that only connects what's there", async () => {
    const { validateScene } = await import("../src/features/editor/blocksuite/scene");
    const s = validateScene(
      { plan: "", anchor: { near: "", side: "" }, objects: [], arrangements: [],
        connectors: [{ from: "K1", to: "K2", label: "leads to", heads: "to", style: "", color: "", reason: "" }] },
      new Set(["K1", "K2"]),
    );
    expect(s.connectors).toHaveLength(1);
    expect(() => validateScene({ objects: [], connectors: [] })).toThrow();
  });
});

describe("build progress", () => {
  it("counts the objects a section reply has begun while it streams", async () => {
    const { objectsSoFar } = await import("../src/features/editor/blocksuite/scene-build");
    expect(objectsSoFar("")).toBe(0);
    expect(objectsSoFar('{"objects":[{"id":"a","kind":"card","content":[{"type":"paragraph"}]},{"id":"b","ki')).toBe(1);
    expect(objectsSoFar('{"objects":[{"id":"a","kind": "card"},{"id":"f","kind":"frame"}],"connectors":[')).toBe(2);
  });
});
