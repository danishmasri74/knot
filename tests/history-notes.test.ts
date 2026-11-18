import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { watchHistoryNotes } from "../src/features/editor/blocksuite/history-notes";

// A stand-in for a BlockSuite doc: blocks in a Y.Map, a note holding a card.
function fakeDoc() {
  const spaceDoc = new Y.Doc();
  const blocks = spaceDoc.getMap<Y.Map<unknown>>("blocks");
  const parents: Record<string, string> = { card: "note", note: "page" };
  const flavours: Record<string, string> = { page: "affine:page", note: "affine:note", card: "affine:paragraph", frame: "affine:frame" };
  for (const id of ["page", "note", "card", "frame"]) {
    const block = new Y.Map<unknown>();
    block.set("children", new Y.Array<string>());
    blocks.set(id, block);
  }
  const history = new Y.UndoManager(blocks, { captureTimeout: 0 });
  const model = (id: string) => ({ id, flavour: flavours[id] });
  const doc = {
    spaceDoc,
    history,
    getBlock: (id: string) => (blocks.has(id) ? { model: model(id) } : undefined),
    getParent: (m: { id: string }) => (parents[m.id] ? model(parents[m.id]) : null),
  };
  return { doc, blocks, history };
}

describe("watchHistoryNotes", () => {
  it("handles nested array changes next to added blocks without throwing", () => {
    const { doc, blocks, history } = fakeDoc();
    const seen: string[][] = [];
    const stop = watchHistoryNotes(doc as never, (_type, ids) => seen.push(ids));
    // One step: a new block, and a nested array change in the card and frame.
    doc.spaceDoc.transact(() => {
      blocks.set("extra", new Y.Map());
      (blocks.get("card")!.get("children") as Y.Array<string>).push(["x"]);
      (blocks.get("frame")!.get("children") as Y.Array<string>).push(["y"]);
    });
    expect(() => history.undo()).not.toThrow();
    expect(seen).toEqual([["note"]]);
    stop();
  });
});
