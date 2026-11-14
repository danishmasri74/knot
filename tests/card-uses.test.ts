import { describe, expect, it } from "vitest";
import { collectUses, type PlacementIndex } from "../src/app/CardPlacement";
import { describeUses } from "../src/app/CardUses";
import type { DeckData } from "../src/features/editor/blocksuite/card-deck";

const json = (value: unknown) => ({ type: "json" as const, value });
const deck: DeckData = {
  wave: {
    id: "wave",
    nodes: [
      {
        props: {
          "sys:flavour": json("affine:paragraph"),
          "prop:text": { type: "text", delta: [{ insert: "Wave speed" }] },
        },
        children: [],
      },
    ],
  },
  summary: {
    id: "summary",
    nodes: [
      {
        props: {
          "sys:flavour": json("affine:paragraph"),
          "prop:text": {
            type: "text",
            delta: [{ insert: "Summary of waves" }],
          },
        },
        children: [],
      },
      {
        props: {
          "sys:flavour": json("knot:card-embed"),
          "prop:cardId": json("wave"),
        },
        children: [],
      },
    ],
  },
};

describe("where a card is used", () => {
  it("counts copies per canvas and notes that show the card", () => {
    const uses = collectUses(
      [
        ["physics", ["wave", "summary"]],
        ["exam", ["wave", "wave"]],
      ],
      deck,
    );
    expect(uses.get("wave")).toEqual([
      { owner: "physics", kind: "canvas", count: 1 },
      { owner: "physics", kind: "note", count: 1, host: "summary" },
      { owner: "exam", kind: "canvas", count: 2 },
    ]);
    expect(uses.get("summary")).toEqual([
      { owner: "physics", kind: "canvas", count: 1 },
    ]);
  });

  it("lists this canvas first, then by name, with notes after", () => {
    const index: PlacementIndex = {
      owners: [
        { id: "physics", title: "Physics", kind: "whiteboard", updated_at: 0 },
        { id: "exam", title: "Exam prep", kind: "whiteboard", updated_at: 0 },
      ],
      cards: new Map(),
      uses: collectUses(
        [
          ["physics", ["wave", "summary"]],
          ["exam", ["wave", "wave"]],
        ],
        deck,
      ),
      trashed: new Set(),
      complete: true,
    };
    const { canvases, notes } = describeUses(index, "wave", deck, "physics");
    expect(canvases.map((entry) => [entry.title, entry.detail])).toEqual([
      ["Physics", "This canvas"],
      ["Exam prep", "2 copies"],
    ]);
    expect(notes.map((entry) => [entry.title, entry.detail])).toEqual([
      ["Summary of waves", "In Physics"],
    ]);
    const elsewhere = describeUses(index, "wave", deck);
    expect(elsewhere.canvases.map((entry) => entry.title)).toEqual([
      "Exam prep",
      "Physics",
    ]);
  });
});
