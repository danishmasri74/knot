import { describe, expect, it } from "vitest";
import { cardPlacement } from "../src/app/CardPlacement";
import * as Y from "yjs";
import {
  CardDeck,
  isBlankCard,
  isShortCard,
  type CardNode,
  type DeckCard,
} from "../src/features/editor/blocksuite/card-deck";

const node = (
  flavour: string,
  text?: string,
  children: CardNode[] = [],
): CardNode => ({
  props: {
    "sys:flavour": { type: "json", value: flavour },
    ...(text !== undefined
      ? { "prop:text": { type: "text", delta: text ? [{ insert: text }] : [] } }
      : {}),
  },
  children,
});
const card = (
  id: string,
  nodes: CardNode[],
  extra: Partial<DeckCard> = {},
) => ({
  id,
  nodes,
  ...extra,
});

describe("blank cards", () => {
  it("counts only cards with nothing to reuse as blank", () => {
    expect(isBlankCard(card("a", []))).toBe(true);
    expect(isBlankCard(card("b", [node("affine:paragraph", "")]))).toBe(true);
    expect(
      isBlankCard(
        card("c", [
          node("affine:paragraph", "   \n "),
          node("affine:list", "", [node("affine:paragraph", "")]),
          node("affine:divider"),
        ]),
      ),
    ).toBe(true);
    expect(isBlankCard(card("d", [node("affine:paragraph", "Idea")]))).toBe(
      false,
    );
    expect(
      isBlankCard(
        card("e", [node("affine:list", "", [node("affine:paragraph", "x")])]),
      ),
    ).toBe(false);
    // Media and questions are content even without text.
    expect(isBlankCard(card("f", [node("affine:image")]))).toBe(false);
    expect(isBlankCard(card("g", [node("knot:mcq-reference")]))).toBe(false);
    expect(
      isBlankCard(card("h", [node("affine:embed-youtube")], { media: true })),
    ).toBe(false);
  });

  it("moves blank cards no canvas uses to Trash, and keeps placed ones", () => {
    const doc = new Y.Doc();
    const blocks = doc.getMap<Y.Map<unknown>>("blocks");
    const make = (id: string, flavour: string, children: string[] = []) => {
      const block = new Y.Map<unknown>();
      block.set("sys:id", id);
      block.set("sys:flavour", flavour);
      const list = new Y.Array<string>();
      list.push(children);
      block.set("sys:children", list);
      blocks.set(id, block);
    };
    doc.transact(() => {
      make("root", "affine:page", ["note"]);
      make("note", "affine:note", []);
    });
    const deck = new CardDeck(
      {
        leftover: card("leftover", [node("affine:paragraph", "")]),
        kept: card("kept", [node("affine:paragraph", "Keep me")]),
      },
      () => {},
    );
    deck.attach(doc);
    const placed = doc.getMap<string>("knot:card-links").get("note")!;
    expect(isBlankCard(deck.data[placed])).toBe(true);
    expect(deck.trashBlankUnplaced()).toBe(1);
    expect(deck.data.leftover.deleted).toBe(true);
    expect(deck.data.kept.deleted).toBeFalsy();
    // The empty note on the canvas is in use: it stays.
    expect(deck.data[placed].deleted).toBeFalsy();
    expect(blocks.has("note")).toBe(true);
    // Restorable from Trash like any card.
    deck.restore("leftover");
    expect(deck.data.leftover.deleted).toBeFalsy();
    deck.dispose();
  });

  it("trashes a short card with its last note, and Undo brings it back", () => {
    const doc = new Y.Doc();
    const blocks = doc.getMap<Y.Map<unknown>>("blocks");
    const make = (
      id: string,
      flavour: string,
      children: string[] = [],
      text?: string,
    ) => {
      const block = new Y.Map<unknown>();
      block.set("sys:id", id);
      block.set("sys:flavour", flavour);
      const list = new Y.Array<string>();
      list.push(children);
      block.set("sys:children", list);
      if (text !== undefined) block.set("prop:text", new Y.Text(text));
      blocks.set(id, block);
    };
    doc.transact(() => {
      make("root", "affine:page", ["short", "long"]);
      make("short", "affine:note", ["p1"]);
      make("p1", "affine:paragraph", [], "ok");
      make("long", "affine:note", ["p2"]);
      make(
        "p2",
        "affine:paragraph",
        [],
        "A longer note that is worth keeping around",
      );
    });
    const deck = new CardDeck({}, () => {});
    deck.attach(doc);
    const links = doc.getMap<string>("knot:card-links");
    const short = links.get("short")!;
    const long = links.get("long")!;
    expect(isShortCard(deck.data[short])).toBe(true);
    expect(isShortCard(deck.data[long])).toBe(false);
    const undo = new Y.UndoManager(blocks);
    const remove = (id: string, child: string) =>
      doc.transact(() => {
        const root = blocks.get("root")!.get("sys:children") as Y.Array<string>;
        root.delete(root.toArray().indexOf(id), 1);
        blocks.delete(child);
        blocks.delete(id);
      });
    remove("short", "p1");
    expect(deck.data[short].deleted).toBe(true);
    undo.stopCapturing();
    remove("long", "p2");
    // Longer cards become unplaced, as before.
    expect(deck.data[long].deleted).toBeFalsy();
    undo.undo();
    undo.undo();
    expect(blocks.has("short")).toBe(true);
    expect(deck.data[short].deleted).toBeFalsy();
    expect(deck.data[short].autoTrashed).toBeUndefined();
    deck.dispose();
    undo.destroy();
  });

  it("keeps a short card that's still placed on another canvas", () => {
    const deck = new CardDeck({}, () => {});
    const canvas = () => {
      const doc = new Y.Doc();
      const blocks = doc.getMap<Y.Map<unknown>>("blocks");
      doc.transact(() => {
        for (const [id, flavour, children] of [
          ["root", "affine:page", ["note"]],
          ["note", "affine:note", []],
        ] as const) {
          const block = new Y.Map<unknown>();
          block.set("sys:id", id);
          block.set("sys:flavour", flavour);
          const list = new Y.Array<string>();
          list.push([...children]);
          block.set("sys:children", list);
          blocks.set(id, block);
        }
      });
      return doc;
    };
    const a = canvas(),
      b = canvas();
    deck.attach(a);
    deck.attach(b);
    const id = a.getMap<string>("knot:card-links").get("note")!;
    deck.place(b, id, () => {
      const block = new Y.Map<unknown>();
      block.set("sys:id", "copy");
      block.set("sys:flavour", "affine:note");
      block.set("sys:children", new Y.Array<string>());
      b.getMap<Y.Map<unknown>>("blocks").set("copy", block);
      return "copy";
    });
    a.transact(() => a.getMap("blocks").delete("note"));
    expect(deck.data[id].deleted).toBeFalsy();
    deck.dispose();
  });

  it("leaves cards from notebooks in Trash out until restored", () => {
    const index = {
      owners: [],
      cards: new Map([["placed", new Set(["nb"])]]),
      trashed: new Set(["placed", "hidden"]),
      complete: true,
    };
    expect(cardPlacement(index, "hidden").state).toBe("trashed");
    expect(cardPlacement(index, "placed").state).toBe("linked");
    expect(cardPlacement(index, "other").state).toBe("unplaced");
  });
});
