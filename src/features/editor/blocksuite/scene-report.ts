/**
 * What Knot measures on a scene's draft for the model's review (phase 2 of
 * docs/AI-CANVAS-ORCHESTRATION-PLAN.md): arrows over other objects, arrows
 * crossing each other, repairs the solver made, positions that contradict
 * the reading order, size against the screen, and source passages the scene
 * leaves out. Free of the editor so it can be unit tested.
 */
import { uncoveredPassages } from "../../../services/ai-atomize";
import { sceneTexts, type Scene, type SceneObject } from "./scene";
import type { Box } from "./scene-solver";

export type SceneReport = {
  /** Problems worth a review round; 0 means the draft is fine. */
  issues: number;
  crossings: string[];
  arrowCrossings: string[];
  order: string[];
  adjustments: string[];
  size: string;
  missing: string[];
};

type Point = [number, number];
const centre = (b: Box): Point => [b[0] + b[2] / 2, b[1] + b[3] / 2];

/** Where a segment enters and leaves a box (0-1 along it), or undefined. */
function clip(p: Point, q: Point, b: Box, inset = 4): [number, number] | undefined {
  const [x0, y0, x1, y1] = [b[0] + inset, b[1] + inset, b[0] + b[2] - inset, b[1] + b[3] - inset];
  if (x1 <= x0 || y1 <= y0) return undefined;
  let t0 = 0;
  let t1 = 1;
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  for (const [num, den] of [
    [x0 - p[0], -dx],
    [p[0] - x1, dx],
    [y0 - p[1], -dy],
    [p[1] - y1, dy],
  ] as const) {
    if (den === 0) {
      if (num > 0) return undefined;
    } else {
      const t = num / -den;
      if (den < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
    }
  }
  return t0 < t1 ? [t0, t1] : undefined;
}

/** Whether two segments properly cross. */
function cross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

export function sceneReport(
  scene: Scene,
  boxes: Map<string, Box>,
  solverReport: string[],
  options: { sources?: string[]; view?: Box; handles?: Map<string, Box> } = {},
): SceneReport {
  const objects = new Map(scene.objects.map((o) => [o.id, o]));
  const name = (id: string) => {
    const o = objects.get(id.split("#")[0]);
    const title = o ? (o.text || o.nodes[0]?.text || o.kind).split("\n")[0].slice(0, 60) : id;
    return `"${title}" (${id})`;
  };
  const ancestors = (id: string) => {
    const out = new Set<string>();
    let at = objects.get(id)?.in ?? "";
    while (at) {
      out.add(at);
      at = objects.get(at)?.in ?? "";
    }
    return out;
  };
  const endBox = (ref: string): Box | undefined =>
    boxes.get(ref) ?? boxes.get(ref.split("#")[0]) ?? options.handles?.get(ref);
  const solid = scene.objects.filter((o) => o.kind !== "frame" && boxes.has(o.id));

  const segments = scene.connectors.flatMap((c) => {
    const a = endBox(c.from);
    const b = endBox(c.to);
    if (!a || !b) return [];
    const p = centre(a);
    const q = centre(b);
    // Only the part between the two objects: from leaving one to entering the other.
    const leave = clip(p, q, a, 0)?.[1] ?? 0;
    const enter = clip(p, q, b, 0)?.[0] ?? 1;
    if (enter <= leave) return [];
    const at = (t: number): Point => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    return [{ c, p: at(leave), q: at(enter) }];
  });

  const crossings: string[] = [];
  for (const { c, p, q } of segments) {
    const ends = new Set([c.from.split("#")[0], c.to.split("#")[0]]);
    const containers = new Set([...ends].flatMap((e) => [...ancestors(e)]));
    for (const o of solid) {
      if (ends.has(o.id) || containers.has(o.id)) continue;
      if (clip(p, q, boxes.get(o.id)!))
        crossings.push(`The arrow from ${name(c.from)} to ${name(c.to)}${c.label ? ` ("${c.label}")` : ""} passes over ${name(o.id)}.`);
    }
  }
  const arrowCrossings: string[] = [];
  for (let i = 0; i < segments.length; i++)
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i];
      const b = segments[j];
      const shared = [a.c.from, a.c.to].some((e) => e === b.c.from || e === b.c.to);
      if (!shared && cross(a.p, a.q, b.p, b.q))
        arrowCrossings.push(`The arrows ${name(a.c.from)} → ${name(a.c.to)} and ${name(b.c.from)} → ${name(b.c.to)} cross.`);
    }

  // Reading order: later objects sit to the right on the same band, or below.
  const order: string[] = [];
  const ordered = scene.objects
    .filter((o) => o.order > 0 && boxes.has(o.id))
    .sort((a, b) => a.order - b.order);
  for (let i = 1; i < ordered.length; i++) {
    const a: SceneObject = ordered[i - 1];
    const b: SceneObject = ordered[i];
    if (a.in !== b.in) continue;
    const [ax, ay, aw, ah] = boxes.get(a.id)!;
    const [bx, by, , bh] = boxes.get(b.id)!;
    const above = by + bh <= ay;
    const leftOnBand = by < ay + ah && by + bh > ay && bx + 1 < ax && bx < ax + aw;
    if (above || leftOnBand)
      order.push(`${name(b.id)} is number ${b.order} in the reading order but sits ${above ? "above" : "left of"} number ${a.order}, ${name(a.id)}.`);
  }

  const adjustments = [
    ...scene.notes,
    ...solverReport.filter((r) => !r.includes("moved further out")),
  ];

  const placed = [...boxes.entries()].filter(([id]) => objects.has(id)).map(([, b]) => b);
  let size = "";
  if (placed.length && options.view) {
    const x = Math.min(...placed.map((b) => b[0]));
    const y = Math.min(...placed.map((b) => b[1]));
    const w = Math.max(...placed.map((b) => b[0] + b[2])) - x;
    const h = Math.max(...placed.map((b) => b[1] + b[3])) - y;
    size = `The scene is ${Math.round(w)} × ${Math.round(h)} px, about ${(w / options.view[2]).toFixed(1)} screens wide and ${(h / options.view[3]).toFixed(1)} screens tall at the user's current zoom.`;
  }

  const missing = options.sources?.length
    ? uncoveredPassages(options.sources, sceneTexts(scene)).map((p) => (p.length > 300 ? `${p.slice(0, 299)}…` : p))
    : [];

  return {
    issues: crossings.length + arrowCrossings.length + order.length + adjustments.length + missing.length,
    crossings: crossings.slice(0, 40),
    arrowCrossings: arrowCrossings.slice(0, 20),
    order: order.slice(0, 20),
    adjustments: adjustments.slice(0, 20),
    size,
    missing: missing.slice(0, 30),
  };
}
