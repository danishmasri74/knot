import { describe, it, expect, vi } from "vitest";
import * as Y from "yjs";
import {
  CardDeck,
  cardPreview,
} from "../src/features/editor/blocksuite/card-deck";
function fixture(text: string) {
  const doc = new Y.Doc();
  const blocks = doc.getMap<Y.Map<unknown>>("blocks");
  const add = (
    id: string,
    flavour: string,
    children: string[],
    content?: string,
  ) => {
    const block = new Y.Map<unknown>();
    block.set("sys:id", id);
    block.set("sys:flavour", flavour);
    const list = new Y.Array<string>();
    list.push(children);
    block.set("sys:children", list);
    if (content) block.set("prop:text", new Y.Text(content));
    blocks.set(id, block);
  };
  doc.transact(() => {
    add("root", "affine:page", ["note"]);
    add("note", "affine:note", ["paragraph"]);
    add("paragraph", "affine:paragraph", [], text);
    add("local", "affine:edgeless-text", [], "Local only");
  });
  return doc;
}
describe("Card Deck", () => {
  it("backfills dates once and restores the edit date on undo and redo", () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(100);
    try {
      const deck = new CardDeck(
        { legacy: { id: "legacy", nodes: [] } },
        () => {},
      );
      const doc = fixture("Original");
      deck.attach(doc);
      const id = doc.getMap<string>("knot:card-links").get("note")!;
      const blocks = doc.getMap<Y.Map<unknown>>("blocks");
      const undo = new Y.UndoManager(blocks);
      clock.mockReturnValue(200);
      (blocks.get("paragraph")!.get("prop:text") as Y.Text).insert(
        8,
        " edited",
      );
      expect(deck.data[id].updatedAt).toBe(200);
      clock.mockReturnValue(300);
      undo.undo();
      expect(deck.data[id].updatedAt).toBe(100);
      undo.redo();
      expect(deck.data[id].updatedAt).toBe(200);
      expect(deck.data[id].createdAt).toBe(100);
      const reload = new CardDeck(
        JSON.parse(JSON.stringify(deck.data)),
        () => {},
      );
      expect(reload.data.legacy).toMatchObject({
        createdAt: 100,
        updatedAt: 100,
      });
      deck.dispose();
      undo.destroy();
    } finally {
      clock.mockRestore();
    }
  });
  it("shares edits across repeated instances and documents, keeps local text out, and survives removal and reload", () => {
    const a = fixture("Original"),
      b = fixture("Other"),
      deck = new CardDeck({}, () => {});
    deck.attach(a);
    deck.attach(b);
    expect(Object.keys(deck.data)).toHaveLength(2);
    const id = a.getMap<string>("knot:card-links").get("note")!;
    deck.place(b, id, () => "note");
    (
      a
        .getMap<Y.Map<unknown>>("blocks")
        .get("paragraph")!
        .get("prop:text") as Y.Text
    ).insert(8, " edited");
    expect(cardPreview(deck.data[id])).toBe("Original edited");
    const child = (
      b
        .getMap<Y.Map<unknown>>("blocks")
        .get("note")!
        .get("sys:children") as Y.Array<string>
    ).get(0);
    expect(
      (
        b
          .getMap<Y.Map<unknown>>("blocks")
          .get(child)!
          .get("prop:text") as Y.Text
      ).toString(),
    ).toBe("Original edited");
    a.getMap("blocks").delete("note");
    b.getMap("blocks").delete("note");
    expect(deck.data[id].deleted).toBeUndefined();
    const reloaded = new CardDeck(
      JSON.parse(JSON.stringify(deck.data)),
      () => {},
    );
    expect(cardPreview(reloaded.data[id])).toBe("Original edited");
    expect(
      a
        .getMap<Y.Map<unknown>>("blocks")
        .get("local")!
        .get("prop:text")
        ?.toString(),
    ).toBe("Local only");
    deck.dispose();
    reloaded.dispose();
  });
  it("restores a removed placement with the latest shared content", () => {
    const a = fixture("Original"),
      b = fixture("Other");
    const deck = new CardDeck({}, () => {});
    deck.attach(a);
    deck.attach(b);
    const id = a.getMap<string>("knot:card-links").get("note")!;
    deck.place(b, id, () => "note");
    const blocks = a.getMap<Y.Map<unknown>>("blocks");
    const removed = blocks.get("note")!.clone();
    blocks.delete("note");
    const child = (
      b
        .getMap<Y.Map<unknown>>("blocks")
        .get("note")!
        .get("sys:children") as Y.Array<string>
    ).get(0);
    (
      b.getMap<Y.Map<unknown>>("blocks").get(child)!.get("prop:text") as Y.Text
    ).insert(8, " latest");
    blocks.set("note", removed);
    const restoredChild = (
      blocks.get("note")!.get("sys:children") as Y.Array<string>
    ).get(0);
    expect(
      (blocks.get(restoredChild)!.get("prop:text") as Y.Text).toString(),
    ).toBe("Original latest");
    expect(cardPreview(deck.data[id])).toBe("Original latest");
    deck.dispose();
  });
  it("reconciles a closed placement after edits and after trash and restore", () => {
    const source = fixture("Original");
    const other = fixture("Other");
    const deck = new CardDeck({}, () => {});
    deck.attach(source);
    const id = source.getMap<string>("knot:card-links").get("note")!;
    deck.place(other, id, () => "note");
    const saved = Y.encodeStateAsUpdate(other);
    const reopen = () => {
      const doc = new Y.Doc();
      Y.applyUpdate(doc, saved);
      const session = new CardDeck(
        JSON.parse(JSON.stringify(deck.data)),
        () => {},
      );
      session.attach(doc);
      session.dispose();
      return doc.getMap<Y.Map<unknown>>("blocks");
    };
    const paragraph = source.getMap<Y.Map<unknown>>("blocks").get("paragraph")!;
    (paragraph.get("prop:text") as Y.Text).insert(8, " edit");
    const reopened = reopen();
    const child = (
      reopened.get("note")!.get("sys:children") as Y.Array<string>
    ).get(0);
    expect(reopened.get(child)!.get("prop:text")?.toString()).toBe(
      "Original edit",
    );
    deck.delete(id);
    deck.restore(id);
    expect(reopen().has("note")).toBe(false);
    expect(deck.data[id].deleted).toBeUndefined();
    deck.dispose();
  });
  it("empties trashed cards to content-free tombstones that stale documents still drop", () => {
    const doc = fixture("Secret answer"),
      changed = vi.fn(),
      deck = new CardDeck({}, changed);
    deck.attach(doc);
    const stale = Y.encodeStateAsUpdate(doc),
      id = Object.keys(deck.data)[0];
    expect(deck.purge([id])).toBe(0); // only cards in Trash can be emptied
    deck.delete(id);
    expect(deck.trashed().map((card) => card.id)).toEqual([id]);
    expect(deck.purge([id])).toBe(1);
    expect(deck.trashed()).toEqual([]);
    expect(deck.data[id]).toMatchObject({ deleted: true, purged: true, nodes: [] });
    expect(JSON.stringify(deck.data)).not.toContain("Secret answer");
    deck.restore(id);
    expect(deck.data[id].purged).toBe(true);
    expect(changed).toHaveBeenCalled();
    const old = new Y.Doc();
    Y.applyUpdate(old, stale);
    const reload = new CardDeck(JSON.parse(JSON.stringify(deck.data)), () => {});
    expect(() => reload.attach(old)).not.toThrow();
    expect(old.getMap("blocks").has("note")).toBe(false);
    reload.dispose();
    deck.dispose();
  });
  it("keeps global deletion tombstones so stale documents cannot resurrect a deleted card", () => {
    const doc = fixture("Delete me"),
      deck = new CardDeck({}, () => {});
    deck.attach(doc);
    const stale = Y.encodeStateAsUpdate(doc),
      id = Object.keys(deck.data)[0];
    deck.delete(id);
    expect(doc.getMap("blocks").has("note")).toBe(false);
    const old = new Y.Doc();
    Y.applyUpdate(old, stale);
    const reload = new CardDeck(
      JSON.parse(JSON.stringify(deck.data)),
      () => {},
    );
    reload.attach(old);
    expect(old.getMap("blocks").has("note")).toBe(false);
    expect(reload.data[id].deleted).toBe(true);
    deck.dispose();
    reload.dispose();
  });
});

it("syncs temporary card editors with notebook placements and detaches cleanly", () => {
  const notebook = fixture("Original"),
    editor = fixture("Unused");
  const deck = new CardDeck({}, () => {});
  deck.attach(notebook);
  const id = Object.keys(deck.data)[0];
  deck.place(editor, id, () => "note");
  const detach = deck.attach(editor, true);
  expect(deck.placements(editor.guid).size).toBe(0);
  const text = editor
    .getMap<Y.Map<unknown>>("blocks")
    .get(
      (
        editor
          .getMap<Y.Map<unknown>>("blocks")
          .get("note")!
          .get("sys:children") as Y.Array<string>
      ).get(0),
    )!
    .get("prop:text") as Y.Text;
  text.insert(text.length, " edited");
  expect(cardPreview(deck.data[id])).toBe("Original edited");
  const paragraph = (
    notebook
      .getMap<Y.Map<unknown>>("blocks")
      .get("note")!
      .get("sys:children") as Y.Array<string>
  ).get(0);
  expect(
    (
      notebook
        .getMap<Y.Map<unknown>>("blocks")
        .get(paragraph)!
        .get("prop:text") as Y.Text
    ).toString(),
  ).toBe("Original edited");
  detach();
  text.insert(text.length, " detached");
  expect(cardPreview(deck.data[id])).toBe("Original edited");
  deck.dispose();
});
