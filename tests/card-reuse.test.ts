import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  CardDeck,
  cardEmbedFlavour,
  cardEmbedReferences,
  cardInsertion,
  mcqReferenceFlavour,
  type CardNode,
  type DeckCard,
} from "../src/features/editor/blocksuite/card-deck";
import { savedSearchContent } from "../src/features/editor/blocksuite/search";
import {
  buildImport,
  type InspectedPackage,
} from "../src/services/knotbook-import";
import { savedShareInfo } from "../src/services/knotbook-share";

const json = (value: unknown) => ({ type: "json" as const, value });
const text = (insert: string) => ({
  type: "text" as const,
  delta: insert ? [{ insert }] : [],
});
const node = (props: CardNode["props"], children: CardNode[] = []) => ({
  props,
  children,
});

function block(
  blocks: Y.Map<Y.Map<unknown>>,
  id: string,
  flavour: string,
  children: string[] = [],
  props: Record<string, unknown> = {},
) {
  const map = new Y.Map<unknown>();
  map.set("sys:id", id);
  map.set("sys:flavour", flavour);
  const list = new Y.Array<string>();
  list.push(children);
  map.set("sys:children", list);
  for (const [key, value] of Object.entries(props))
    map.set(`prop:${key}`, value);
  blocks.set(id, map);
}

/** A saved notebook: a canvas note (card-1) and a note showing card-2. */
function notebook(id: string) {
  const envelope = new Y.Doc();
  const pages = new Y.Array<Y.Map<unknown>>();
  envelope.getMap("meta").set("pages", pages);
  const page = new Y.Map<unknown>();
  pages.push([page]);
  page.set("id", id);
  page.set("title", "Notebook");
  const body = new Y.Doc();
  const blocks = body.getMap<Y.Map<unknown>>("blocks");
  body.transact(() => {
    block(blocks, "root", "affine:page", ["note"]);
    block(blocks, "note", "affine:note", ["p", "embed"]);
    block(blocks, "p", "affine:paragraph", [], {
      text: new Y.Text("Wave speed"),
    });
    block(blocks, "embed", cardEmbedFlavour, [], { cardId: "card-2" });
    body.getMap<string>("knot:card-links").set("note", "card-1");
  });
  return {
    collection: [...Y.encodeStateAsUpdate(envelope)],
    document: [...Y.encodeStateAsUpdate(body)],
  };
}

describe("reusing cards", () => {
  it("inserts a note card as an embed, a question as a reference and media as a copy", () => {
    const note: DeckCard = {
      id: "n",
      nodes: [
        node({
          "sys:flavour": json("affine:paragraph"),
          "prop:text": text("Idea"),
        }),
      ],
    };
    expect(cardInsertion(note)).toEqual({
      flavour: cardEmbedFlavour,
      props: { cardId: "n" },
    });
    const quiz: DeckCard = {
      id: "q",
      nodes: [
        node({ "sys:flavour": json("knot:mcq"), "prop:definition": json({}) }),
      ],
    };
    expect(cardInsertion(quiz)?.flavour).toBe(mcqReferenceFlavour);
    const video: DeckCard = {
      id: "v",
      media: true,
      nodes: [
        node({
          "sys:flavour": json("affine:embed-youtube"),
          "prop:videoId": json("dQw4w9WgXcQ"),
          "prop:title": json("A talk"),
        }),
      ],
    };
    expect(cardInsertion(video)).toEqual({
      flavour: "affine:embed-youtube",
      props: { videoId: "dQw4w9WgXcQ", title: "A talk" },
    });
    expect(cardInsertion({ ...note, deleted: true })).toBeUndefined();
    expect(cardInsertion(undefined)).toBeUndefined();
  });

  it("counts a card shown inside a note as in use", () => {
    const deck = new CardDeck(
      {
        shown: {
          id: "shown",
          nodes: [
            node({
              "sys:flavour": json("affine:paragraph"),
              "prop:text": text("ok"),
            }),
          ],
        },
      },
      () => {},
    );
    const doc = new Y.Doc();
    const blocks = doc.getMap<Y.Map<unknown>>("blocks");
    doc.transact(() => {
      block(blocks, "root", "affine:page", ["note"]);
      block(blocks, "note", "affine:note", ["embed"]);
      block(blocks, "embed", cardEmbedFlavour, [], { cardId: "shown" });
    });
    deck.attach(doc);
    expect(deck.usedCards(doc).has("shown")).toBe(true);
    expect(deck.trashBlankUnplaced()).toBe(0);
    // The host note's card records the embed in its content.
    const host = deck.data[doc.getMap<string>("knot:card-links").get("note")!];
    expect([...cardEmbedReferences(host.nodes)]).toEqual(["shown"]);
    deck.dispose();
  });

  it("finds a matching note's card in search", () => {
    const saved = notebook("nb");
    const content = savedSearchContent("nb", saved);
    expect(content.notes).toEqual([
      expect.objectContaining({
        id: "note",
        cardId: "card-1",
        title: "Wave speed",
      }),
    ]);
  });

  it("shares and imports cards shown inside notes, renaming them together", () => {
    const saved = notebook("nb");
    expect(savedShareInfo("nb", { ...saved, title: null }).cards).toEqual(
      new Set(["card-1", "card-2"]),
    );
    const pkg: InspectedPackage = {
      manifest: {
        sharedBy: "A",
        exportedAt: 0,
        root: "nb",
        notebooks: [
          {
            id: "nb",
            title: "Notebook",
            kind: "whiteboard",
            updatedAt: 0,
            sha256: "",
            role: "root",
            parent: null,
            attachments: [],
          },
        ],
        unshared: [],
      },
      notebooks: [
        { id: "nb", ...saved, status: "library", existing_title: "Notebook" },
      ],
      cards: {
        "card-1": {
          id: "card-1",
          nodes: [
            {
              props: {
                "sys:flavour": json(cardEmbedFlavour),
                "prop:cardId": json("card-2"),
              },
              children: [],
            },
          ],
        },
        "card-2": { id: "card-2", nodes: [] },
      },
      size: 0,
    };
    let counter = 0;
    // Keep both: every card gets a new ID, and embeds follow.
    const plan = buildImport(
      pkg,
      new Map([["nb", { include: true, replace: false }]]),
      {},
      new Set(["notebook"]),
      () => `new-${++counter}`,
    );
    const renamed = Object.keys(plan.cards);
    expect(renamed).toHaveLength(2);
    const embedCard = renamed.find((id) => id !== "card-2" && id !== "card-1");
    expect(embedCard).toBeDefined();
    const body = new Y.Doc();
    Y.applyUpdate(body, new Uint8Array(plan.items[0].document));
    const embed = body.getMap<Y.Map<unknown>>("blocks").get("embed")!;
    const target = embed.get("prop:cardId") as string;
    expect(target).not.toBe("card-2");
    expect(plan.cards[target]).toBeDefined();
    const host = plan.cards[
      body.getMap<string>("knot:card-links").get("note")!
    ] as DeckCard;
    expect(host.nodes[0].props["prop:cardId"]).toEqual(json(target));
  });
});
