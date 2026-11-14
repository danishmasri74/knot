import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  CardDeck,
  cardMedia,
  cardPreview,
  standaloneMedia,
} from "../src/features/editor/blocksuite/card-deck";
import {
  mediaIdentity,
  normalizePageUrl,
} from "../src/features/editor/blocksuite/media-cards";

type Props = Record<string, unknown>;
function canvas() {
  const doc = new Y.Doc();
  const blocks = doc.getMap<Y.Map<unknown>>("blocks");
  const make = (id: string, flavour: string, props: Props = {}) => {
    const block = new Y.Map<unknown>();
    block.set("sys:id", id);
    block.set("sys:flavour", flavour);
    block.set("sys:children", new Y.Array<string>());
    for (const [key, value] of Object.entries(props))
      block.set(`prop:${key}`, value);
    blocks.set(id, block);
    return block;
  };
  doc.transact(() => {
    const root = make("root", "affine:page");
    make("surface", "affine:surface");
    make("note", "affine:note");
    (root.get("sys:children") as Y.Array<string>).push(["surface", "note"]);
  });
  const children = (id: string) =>
    blocks.get(id)!.get("sys:children") as Y.Array<string>;
  return {
    doc,
    blocks,
    /** Add a standalone object to the canvas. */
    add(id: string, flavour: string, props: Props) {
      doc.transact(() => {
        make(id, flavour, { xywh: "[0,0,752,544]", index: "a0", ...props });
        children("surface").push([id]);
      });
    },
    /** Move a standalone object into the note, keeping its ID. */
    moveIntoNote(id: string) {
      doc.transact(() => {
        const list = children("surface");
        list.delete(list.toArray().indexOf(id), 1);
        children("note").push([id]);
      });
    },
    remove(id: string) {
      doc.transact(() => {
        const list = children("surface");
        list.delete(list.toArray().indexOf(id), 1);
        blocks.delete(id);
      });
    },
    card(id: string) {
      return doc.getMap<string>("knot:card-links").get(id);
    },
    prop(id: string, key: string) {
      return blocks.get(id)?.get(`prop:${key}`);
    },
    set(id: string, key: string, value: unknown) {
      blocks.get(id)!.set(`prop:${key}`, value);
    },
  };
}
const video = (title = "A talk") => ({
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  videoId: "dQw4w9WgXcQ",
  title,
  style: "video",
});
const mediaCards = (deck: CardDeck) =>
  Object.values(deck.data).filter((card) => card.media && !card.deleted);

describe("media identity", () => {
  it("treats the same video, page or file as one", () => {
    const get = (props: Props) => (key: string) =>
      props[key.replace("prop:", "")];
    const id = (flavour: string, props: Props) =>
      mediaIdentity(flavour, get(props));
    expect(id("affine:embed-youtube", video())).toBe("youtube:dQw4w9WgXcQ");
    expect(
      id("affine:bookmark", { url: "https://youtu.be/dQw4w9WgXcQ?t=42" }),
    ).toBe("youtube:dQw4w9WgXcQ");
    expect(
      id("affine:bookmark", {
        url: "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      }),
    ).toBe("youtube:dQw4w9WgXcQ");
    expect(id("affine:image", { sourceId: "abc=" })).toBe("file:abc=");
    expect(id("affine:attachment", { sourceId: "" })).toBeUndefined();
    expect(id("affine:embed-linked-doc", { pageId: "p1" })).toBe("page:p1");
    expect(id("affine:bookmark", { url: "" })).toBeUndefined();
    expect(id("affine:note", {})).toBeUndefined();
  });
  it("cleans addresses without merging different pages", () => {
    const same = [
      "https://Example.com/a/",
      "https://www.example.com/a#section",
      "https://example.com/a?utm_source=x&fbclid=y",
    ].map(normalizePageUrl);
    expect(new Set(same).size).toBe(1);
    expect(normalizePageUrl("https://example.com/b")).not.toBe(same[0]);
    expect(normalizePageUrl("https://example.com/a?b=2&a=1")).toBe(
      normalizePageUrl("https://example.com/a?a=1&b=2"),
    );
    expect(normalizePageUrl("javascript:alert(1)")).toBeUndefined();
  });
});

describe("media cards", () => {
  it("saves standalone objects to the deck, but not ones inside notes", () => {
    const deck = new CardDeck({}, () => {});
    const a = canvas();
    a.add("yt", "affine:embed-youtube", video());
    a.add("img", "affine:image", { sourceId: "img-key", caption: "Plan" });
    deck.attach(a.doc);
    expect(mediaCards(deck)).toHaveLength(2);
    const card = deck.data[a.card("yt")!];
    expect(cardMedia(card)?.kind).toBe("video");
    expect(cardPreview(card)).toContain("A talk");
    // Placement properties stay with the canvas.
    expect(card.nodes[0].props["prop:xywh"]).toBeUndefined();
    expect(card.nodes[0].props["prop:style"]).toBeUndefined();
    // Added later, while editing.
    a.add("link", "affine:bookmark", { url: "https://example.com/a" });
    expect(cardMedia(deck.data[a.card("link")!])?.kind).toBe("link");
    expect(standaloneMedia(a.doc).size).toBe(3);
    deck.dispose();
  });

  it("never saves the same video, page or file twice", () => {
    const deck = new CardDeck({}, () => {});
    const a = canvas(),
      b = canvas();
    a.add("one", "affine:embed-youtube", video());
    a.add("two", "affine:bookmark", { url: "https://youtu.be/dQw4w9WgXcQ" });
    b.add("three", "affine:embed-youtube", video("Renamed elsewhere"));
    b.add("page", "affine:bookmark", { url: "https://www.example.com/a/" });
    b.add("same-page", "affine:bookmark", {
      url: "https://example.com/a?utm_source=feed",
    });
    deck.attach(a.doc);
    deck.attach(b.doc);
    expect(a.card("one")).toBe(a.card("three") ?? b.card("three"));
    expect(b.card("three")).toBe(a.card("one"));
    expect(b.card("page")).toBe(b.card("same-page"));
    // The YouTube card and the link to the same video are separate objects
    // of different types, but one video: one card for each object type.
    const videos = mediaCards(deck).filter(
      (card) => cardMedia(card)?.identity === "youtube:dQw4w9WgXcQ",
    );
    expect(videos).toHaveLength(2);
    // The card is placed elsewhere, so its title wins.
    expect(b.prop("three", "title")).toBe("A talk");
    deck.dispose();
  });

  it("shares edits with every placement but keeps size and view per canvas", () => {
    const deck = new CardDeck({}, () => {});
    const a = canvas(),
      b = canvas();
    a.add("img", "affine:image", { sourceId: "k", caption: "Old" });
    b.add("img2", "affine:image", {
      sourceId: "k",
      caption: "Old",
      xywh: "[5,5,10,10]",
    });
    deck.attach(a.doc);
    deck.attach(b.doc);
    a.set("img", "caption", "New caption");
    expect(b.prop("img2", "caption")).toBe("New caption");
    a.set("img", "xywh", "[100,100,300,200]");
    expect(b.prop("img2", "xywh")).toBe("[5,5,10,10]");
    expect(deck.data[a.card("img")!].nodes[0].props["prop:caption"]).toEqual({
      type: "json",
      value: "New caption",
    });
    deck.dispose();
  });

  it("keeps the card when its video moves into a note and relinks it on the way out", () => {
    const deck = new CardDeck({}, () => {});
    const a = canvas();
    a.add("yt", "affine:embed-youtube", video());
    deck.attach(a.doc);
    const id = a.card("yt")!;
    a.moveIntoNote("yt");
    // Still in the deck, now unplaced; the note holds the video.
    expect(deck.data[id].deleted).toBeFalsy();
    expect(deck.usedCards(a.doc).has(id)).toBe(false);
    // Dragged back out as a new object: the same card again.
    a.add("yt-again", "affine:embed-youtube", video("Retitled in the note"));
    expect(a.card("yt-again")).toBe(id);
    expect(deck.usedCards(a.doc).has(id)).toBe(true);
    // It was the only copy, so the newest title is kept.
    expect(cardPreview(deck.data[id])).toContain("Retitled in the note");
    expect(mediaCards(deck)).toHaveLength(1);
    deck.dispose();
  });

  it("removes placements on delete, and a trashed card isn't reused", () => {
    const deck = new CardDeck({}, () => {});
    const a = canvas();
    a.add("yt", "affine:embed-youtube", video());
    deck.attach(a.doc);
    const id = a.card("yt")!;
    deck.delete(id);
    expect(a.blocks.has("yt")).toBe(false);
    expect(standaloneMedia(a.doc).size).toBe(0);
    a.add("yt2", "affine:embed-youtube", video());
    expect(a.card("yt2")).not.toBe(id);
    expect(deck.data[id].deleted).toBe(true);
    // Restored: the newer card stays separate; nothing disappears.
    deck.restore(id);
    expect(a.blocks.has("yt2")).toBe(true);
    deck.dispose();
  });

  it("places a media card as the same kind of object", () => {
    const deck = new CardDeck({}, () => {});
    const a = canvas(),
      b = canvas();
    a.add("pdf", "affine:attachment", {
      sourceId: "pdf-key",
      name: "Paper.pdf",
      type: "application/pdf",
      style: "pdf",
      embed: true,
    });
    deck.attach(a.doc);
    deck.attach(b.doc);
    const id = a.card("pdf")!;
    expect(cardMedia(deck.data[id])?.kind).toBe("pdf");
    expect(deck.placementStyle(id)).toEqual({ style: "pdf", embed: true });
    deck.place(b.doc, id, () => {
      b.add("placed", "affine:attachment", { style: "pdf", embed: true });
      return "placed";
    });
    expect(b.prop("placed", "sourceId")).toBe("pdf-key");
    expect(b.prop("placed", "name")).toBe("Paper.pdf");
    expect(b.card("placed")).toBe(id);
    expect(mediaCards(deck)).toHaveLength(1);
    // Removing one placement keeps the card.
    b.remove("placed");
    expect(deck.data[id].deleted).toBeFalsy();
    deck.dispose();
  });

  it("waits for an upload before saving, then merges by contents", () => {
    const deck = new CardDeck({}, () => {});
    const a = canvas();
    a.add("img", "affine:image", { sourceId: "" });
    deck.attach(a.doc);
    expect(a.card("img")).toBeUndefined();
    a.add("first", "affine:image", { sourceId: "same" });
    a.set("img", "sourceId", "same");
    expect(a.card("img")).toBe(a.card("first"));
    deck.dispose();
  });
});
