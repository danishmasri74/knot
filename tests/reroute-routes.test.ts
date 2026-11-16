import { expect, it } from "vitest";
import {
  dotsAmong,
  orphanDots,
  rejoinPlan,
  resolveRoutes,
  routeEnds,
  type Segment,
} from "../src/services/reroute-routes";
import { formatCanvasMap, type CanvasMapData } from "../src/services/canvas-map-format";

const seg = (id: string, from?: string, to?: string, label = "", rear = "Arrow"): Segment => ({
  id,
  from,
  to,
  label,
  front: "None",
  rear: to?.startsWith("dot") ? "None" : rear,
});

// A and C bundled into one dot leading to B; D → E directly.
const bundle = [
  seg("a1", "A", "dot1"),
  seg("c1", "C", "dot1"),
  seg("b1", "dot1", "B", "requires"),
  seg("d1", "D", "E", "contrasts with"),
];
const dots = new Set(["dot1"]);

it("reads arrows through reroute points as direct links", () => {
  expect(
    resolveRoutes(bundle, dots).map(({ from, to, label, rear, via }) => ({ from, to, label, rear, via })),
  ).toEqual([
    { from: "A", to: "B", label: "requires", rear: "Arrow", via: ["dot1"] },
    { from: "C", to: "B", label: "requires", rear: "Arrow", via: ["dot1"] },
    { from: "D", to: "E", label: "contrasts with", rear: "Arrow", via: [] },
  ]);
});

it("follows chains, fans and loose ends", () => {
  const chain = [
    seg("1", "A", "dot1"),
    seg("2", "dot1", "dot2"),
    seg("3", "dot2", "B"),
    seg("4", "dot2", "C", "part of"),
    seg("5", "X", "dot3"),
  ];
  const all = new Set(["dot1", "dot2", "dot3"]);
  expect(resolveRoutes(chain, all).map((r) => [r.from, r.to, r.via.join(">"), r.label])).toEqual([
    ["A", "B", "dot1>dot2", ""],
    ["A", "C", "dot1>dot2", "part of"],
    ["X", undefined, "dot3", ""],
  ]);
  expect(routeEnds(chain, all, "dot1", "target").sort()).toEqual(["B", "C"]);
  expect(routeEnds(chain, all, "4", "source")).toEqual(["A"]);
  expect(routeEnds(chain, all, "1", "target").sort()).toEqual(["B", "C"]);
});

it("survives a cycle of dots", () => {
  const loop = [seg("1", "A", "dot1"), seg("2", "dot1", "dot2"), seg("3", "dot2", "dot1")];
  const routes = resolveRoutes(loop, new Set(["dot1", "dot2"]));
  expect(routes).toHaveLength(1);
  expect(routes[0].to).toBeUndefined();
});

it("rejoins every arrow into a dot with every arrow out of it", () => {
  const plan = rejoinPlan(bundle, "dot1");
  expect(plan.joins.map((j) => `${j.incoming.from}>${j.outgoing.to}`)).toEqual(["A>B", "C>B"]);
  expect(plan.remove.sort()).toEqual(["a1", "b1", "c1"]);
  expect(plan.dropped).toBe(false);
});

it("removes dots that route nothing, with their remaining arrows", () => {
  // B was deleted with the arrow to it.
  const left = bundle.filter((s) => s.id !== "b1");
  expect(orphanDots(left, dots)).toEqual([{ dot: "dot1", remove: ["a1", "c1"] }]);
  expect(orphanDots(bundle, dots)).toEqual([]);
  expect(orphanDots([], new Set(["dot9"]))).toEqual([{ dot: "dot9", remove: [] }]);
});

it("finds dots that only route between rearranged cards", () => {
  expect(dotsAmong(bundle, dots, new Set(["A", "B", "C"]))).toEqual(["dot1"]);
  expect(dotsAmong(bundle, dots, new Set(["A", "B"]))).toEqual([]);
});

it("names bundled reroute points in the canvas map", () => {
  const map: CanvasMapData = {
    cards: [
      { id: "A", title: "Unit tests", length: 10, box: [0, 0, 200, 100] },
      { id: "C", title: "Integration tests", length: 10, box: [0, 300, 200, 100] },
      { id: "B", title: "Testing", length: 10, box: [600, 600, 200, 100] },
    ],
    frames: [],
    groups: [],
    arrows: [
      { from: "A", to: "B", label: "part of", heads: "to", via: ["dot1"] },
      { from: "C", to: "B", label: "part of", heads: "to", via: ["dot1"] },
    ],
    mindmaps: [],
    texts: [],
    selected: [],
  };
  const lines = formatCanvasMap(map).split("\n");
  expect(lines).toContain("arrow K1 -part of-> K3 via R1");
  expect(lines).toContain("arrow K2 -part of-> K3 via R1");
});
