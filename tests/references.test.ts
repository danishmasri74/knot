import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { referenceIds } from "../src/features/editor/blocksuite/references";

describe("persisted workspace references", () => {
  it("finds both card IDs and inline reference attributes after a Yjs round trip", () => {
    const doc = new Y.Doc();
    const blocks = doc.getMap("blocks");
    const card = new Y.Map();
    card.set("prop:pageId", "shared-note");
    blocks.set("card", card);
    const text = new Y.Text();
    blocks.set("paragraph", text);
    text.insert(0, " ", {
      reference: { pageId: "inline-target", type: "LinkedPage" },
    });
    const restored = new Y.Doc();
    Y.applyUpdate(restored, Y.encodeStateAsUpdate(doc));
    // toJSON loses rich-text attributes; the loader must traverse Y.Text deltas.
    expect(JSON.stringify(restored.getMap("blocks").toJSON())).not.toContain(
      "inline-target",
    );
    expect([...referenceIds(restored.getMap("blocks"))].sort()).toEqual([
      "inline-target",
      "shared-note",
    ]);
    doc.destroy();
    restored.destroy();
  });
  it("ignores note prose that happens to mention a document ID", () => {
    expect(
      referenceIds({ "prop:text": "pageId: example", "prop:pageId": "target" }),
    ).toEqual(new Set(["target"]));
  });
});
