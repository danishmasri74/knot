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
