import { expect, it } from "vitest";
import {
  chooseLayout,
  layoutCards,
  type CardBounds,
} from "../src/features/editor/blocksuite/ai-layout";

const noOverlap = (bounds: CardBounds[]) => {
  for (let i = 0; i < bounds.length; i++)
    for (let j = i + 1; j < bounds.length; j++) {
      const [ax, ay, aw, ah] = bounds[i];
      const [bx, by, bw, bh] = bounds[j];
      expect(
        ax + aw <= bx || bx + bw <= ax || ay + ah <= by || by + bh <= ay,
        `cards ${i} and ${j} overlap`,
      ).toBe(true);
    }
};
const texts = (n: number) => Array.from({ length: n }, (_, i) => `Card ${i}`);
const cx = (b: CardBounds) => b[0] + b[2] / 2;
const cy = (b: CardBounds) => b[1] + b[3] / 2;

it("chooses the arrangement the arrows describe", () => {
  expect(chooseLayout(2, [{ from: 0, to: 1 }]).kind).toBe("grid");
  expect(chooseLayout(4, []).kind).toBe("grid");
  expect(
    chooseLayout(4, [
      { from: 0, to: 1, label: "leads to" },
      { from: 1, to: 2, label: "causes" },
      { from: 3, to: 2, label: "requires" },
    ]).kind,
  ).toBe("flow");
  expect(
    chooseLayout(4, [
      { from: 1, to: 0, label: "part of" },
      { from: 2, to: 0, label: "Part of" },
      { from: 3, to: 1, label: "example of" },
    ]).kind,
  ).toBe("tree");
  expect(
    chooseLayout(5, [
      { from: 0, to: 1, label: "contrasts with" },
      { from: 0, to: 2, label: "contrasts with" },
      { from: 0, to: 3, label: "contrasts with" },
      { from: 4, to: 0, label: "contrasts with" },
    ]),
  ).toEqual({ kind: "hub", center: 0 });
  // A cycle has no left-to-right order.
  expect(
    chooseLayout(3, [
      { from: 0, to: 1, label: "leads to" },
      { from: 1, to: 2, label: "leads to" },
      { from: 2, to: 0, label: "leads to" },
    ]).kind,
  ).toBe("grid");
});

it("flows left to right, prerequisites first", () => {
  const { bounds, kind } = layoutCards(
    texts(4),
    [
      { from: 0, to: 1, label: "leads to" },
      { from: 1, to: 2, label: "leads to" },
      // 2 requires 3, so 3 comes before 2.
      { from: 2, to: 3, label: "requires" },
    ],
    100,
    [],
    "auto",
    50,
  );
  expect(kind).toBe("flow");
  expect(bounds[0][0]).toBeLessThan(bounds[1][0]);
  expect(bounds[1][0]).toBeLessThan(bounds[2][0]);
  expect(bounds[3][0]).toBeLessThan(bounds[2][0]);
  expect(Math.min(...bounds.map((b) => b[0]))).toBe(100);
  expect(Math.min(...bounds.map((b) => b[1]))).toBe(50);
  noOverlap(bounds);
});

it("draws hierarchies top-down with parents centred over children", () => {
  const { bounds, kind } = layoutCards(texts(5), [
    { from: 1, to: 0, label: "part of" },
    { from: 2, to: 0, label: "part of" },
    { from: 3, to: 1, label: "example of" },
  ]);
  expect(kind).toBe("tree");
  expect(bounds[0][1]).toBeLessThan(bounds[1][1]);
  expect(bounds[1][1]).toBeLessThan(bounds[3][1]);
  expect(cx(bounds[0])).toBeGreaterThan(cx(bounds[1]));
  expect(cx(bounds[0])).toBeLessThan(cx(bounds[2]));
  // Card 4 has no place in the tree: it goes underneath.
  expect(bounds[4][1]).toBeGreaterThan(bounds[3][1]);
  noOverlap(bounds);
});

it("puts a hub in the middle with the rest around it", () => {
  const { bounds, kind } = layoutCards(
    texts(7),
    [1, 2, 3, 4, 5, 6].map((i) => ({ from: 0, to: i, label: "example of" })).map(
      (e, i) => (i % 2 ? e : { ...e, label: "contrasts with" }),
    ),
  );
  expect(kind).toBe("hub");
  const xs = bounds.map(cx);
  const ys = bounds.map(cy);
  expect(xs[0]).toBeGreaterThan(Math.min(...xs));
  expect(xs[0]).toBeLessThan(Math.max(...xs));
  expect(ys[0]).toBeGreaterThan(Math.min(...ys));
  expect(ys[0]).toBeLessThan(Math.max(...ys));
  noOverlap(bounds);
});

it("follows a requested kind, keeps real sizes for existing cards, falls back sensibly", () => {
  const sizes = [
    { width: 300, height: 120 },
    { width: 300, height: 120 },
    { width: 300, height: 120 },
  ];
  const edges = [
    { from: 0, to: 1, label: "leads to" },
    { from: 1, to: 2, label: "leads to" },
  ];
  const exact = layoutCards(texts(3), edges, 0, sizes, "flow", 0, false);
  expect(exact.bounds.map((b) => b[3])).toEqual([120, 120, 120]);
  // No hierarchy to draw: a requested tree becomes a flow.
  expect(layoutCards(texts(3), edges, 0, sizes, "tree", 0, false).kind).toBe("flow");
  expect(layoutCards(texts(3), [], 0, sizes, "flow", 0, false).kind).toBe("grid");
  const grid = layoutCards(texts(6), [], 0, [], "grid");
  expect(grid.kind).toBe("grid");
  noOverlap(grid.bounds);
});

it("prefers a sequence over a hub when the arrows form a chain", () => {
  // 2 is the busiest card, but 0 -> 1 -> 2 -> 3 is a process.
  expect(
    chooseLayout(5, [
      { from: 0, to: 1, label: "leads to" },
      { from: 1, to: 2, label: "leads to" },
      { from: 2, to: 3, label: "leads to" },
      { from: 2, to: 4, label: "requires" },
    ]).kind,
  ).toBe("flow");
});

it("joins the facing sides of cards that sit side by side at different heights", async () => {
  const { aiConnectorPorts } = await import("../src/features/editor/blocksuite/ai-layout");
  expect(aiConnectorPorts([0, 0, 300, 120], [420, 90, 300, 120])).toEqual({
    source: [1, 0.5],
    target: [0, 0.5],
  });
  expect(aiConnectorPorts([420, 90, 300, 120], [0, 0, 300, 120])).toEqual({
    source: [0, 0.5],
    target: [1, 0.5],
  });
  // Above and below still join top and bottom.
  expect(aiConnectorPorts([0, 0, 300, 120], [100, 400, 300, 120])).toEqual({
    source: [0.5, 1],
    target: [0.5, 0],
  });
});

it("keeps a long chain compact instead of a strip", () => {
  const chain = Array.from({ length: 19 }, (_, i) => ({ from: i, to: i + 1, label: "leads to" }));
  expect(chooseLayout(20, chain).kind).toBe("grid");
  expect(chooseLayout(6, chain.slice(0, 5)).kind).toBe("flow");
});

it("falls back to the grid when a hub, tree or flow column would sprawl", () => {
  const star = Array.from({ length: 19 }, (_, i) => ({ from: 0, to: i + 1, label: "includes" }));
  expect(chooseLayout(20, star).kind).toBe("grid");
  const wide = Array.from({ length: 9 }, (_, i) => ({ from: i + 1, to: 0, label: "part of" }));
  expect(chooseLayout(10, wide).kind).not.toBe("tree");
});
