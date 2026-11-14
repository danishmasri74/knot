import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  CardDeck,
  isBlankCard,
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
});
