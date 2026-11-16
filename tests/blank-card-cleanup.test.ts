import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { CardDeck, type CardNode } from "../src/features/editor/blocksuite/card-deck";
import {
  blankCardCleanupCutoff,
  normalizeEditorPreferences,
} from "../src/services/editor-preferences";

const DAY = 86_400_000;
const paragraph = (text: string): CardNode => ({
  props: {
    "sys:flavour": { type: "json", value: "affine:paragraph" },
    "prop:text": { type: "text", delta: text ? [{ insert: text }] : [] },
  },
  children: [],
});

describe("deleting unused blank cards", () => {
  it("is off by default and keeps the slider on its stops", () => {
    const defaults = normalizeEditorPreferences({});
    expect(defaults.blankCardCleanup).toBe(false);
    expect(defaults.blankCardCleanupDays).toBe(7);
    expect(normalizeEditorPreferences({ blankCardCleanupDays: 5 }).blankCardCleanupDays).toBe(7);
    expect(normalizeEditorPreferences({ blankCardCleanupDays: 30 }).blankCardCleanupDays).toBe(30);
  });

  it("runs once per interval, for cards unchanged that long", () => {
    const now = 100 * DAY;
    const on = { blankCardCleanup: true, blankCardCleanupDays: 3 };
    expect(blankCardCleanupCutoff({ ...on, blankCardCleanup: false }, null, now)).toBeNull();
    expect(blankCardCleanupCutoff(on, null, now)).toBe(now - 3 * DAY);
    expect(blankCardCleanupCutoff(on, now - 2 * DAY, now)).toBeNull();
    expect(blankCardCleanupCutoff(on, now - 3 * DAY, now)).toBe(now - 3 * DAY);
  });

  it("deletes old unplaced blank cards permanently and keeps the rest", () => {
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
    const old = 10 * DAY;
    const deck = new CardDeck(
      {
        stale: { id: "stale", nodes: [paragraph("")], updatedAt: old },
        fresh: { id: "fresh", nodes: [paragraph("")], updatedAt: 99 * DAY },
        written: { id: "written", nodes: [paragraph("Keep me")], updatedAt: old },
        trashed: { id: "trashed", nodes: [paragraph("")], updatedAt: old, deleted: true },
      },
      () => {},
    );
    deck.attach(doc);
    // The empty note on the canvas is a blank card in use.
    const placed = doc.getMap<string>("knot:card-links").get("note")!;
    deck.data[placed].updatedAt = old;

    expect(deck.deleteBlankUnplaced(98 * DAY)).toBe(1);
    // Deleted, not in Trash: a content-free tombstone.
    expect(deck.data.stale).toMatchObject({ deleted: true, purged: true, nodes: [] });
    expect(deck.trashed().map((c) => c.id)).toEqual(["trashed"]);
    expect(deck.data.fresh.deleted).toBeFalsy();
    expect(deck.data.written.deleted).toBeFalsy();
    expect(deck.data[placed].deleted).toBeFalsy();
    expect(blocks.has("note")).toBe(true);
    deck.dispose();
  });
});
