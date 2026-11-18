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

export type ArrowShape = "curve" | "elbowed" | "straight";
export type ArrowRoute = {
  /** Where the arrow leaves and enters its objects, relative to each box (0-1). */
  from: [number, number];
  to: [number, number];
  /** The drawn path on the canvas. */
  points: Point[];
};

/**
 * The path an arrow between two boxes takes. Knot attaches arrows to the
 * sides that face each other (left and right when the boxes sit side by
 * side, bottom and top when stacked), so the editor's route is predictable:
 * an elbowed arrow runs out to the middle of the gap, across, and in; a
 * straight or curved one goes from side to side. The layout check measures
 * this path, not a line between centres.
 */
export function arrowRoute(a: Box, b: Box, shape: ArrowShape = "elbowed"): ArrowRoute {
  const gapX = Math.max(b[0] - (a[0] + a[2]), a[0] - (b[0] + b[2]));
  const gapY = Math.max(b[1] - (a[1] + a[3]), a[1] - (b[1] + b[3]));
  const [ac, bc] = [centre(a), centre(b)];
  let from: [number, number];
  let to: [number, number];
  if (gapX >= gapY) {
    const forward = bc[0] >= ac[0];
    from = [forward ? 1 : 0, 0.5];
    to = [forward ? 0 : 1, 0.5];
  } else {
    const down = bc[1] >= ac[1];
    from = [0.5, down ? 1 : 0];
    to = [0.5, down ? 0 : 1];
  }
  const p: Point = [a[0] + a[2] * from[0], a[1] + a[3] * from[1]];
  const q: Point = [b[0] + b[2] * to[0], b[1] + b[3] * to[1]];
  if (shape !== "elbowed" || p[0] === q[0] || p[1] === q[1]) return { from, to, points: [p, q] };
  if (gapX >= gapY) {
    const mx = (p[0] + q[0]) / 2;
    return { from, to, points: [p, [mx, p[1]], [mx, q[1]], q] };
  }
  const my = (p[1] + q[1]) / 2;
  return { from, to, points: [p, [p[0], my], [q[0], my], q] };
}

/** The point halfway along a path, where the editor draws an arrow's label. */
export function routeMiddle(points: Point[]): Point {
  const lengths = points.slice(1).map((q, i) => Math.hypot(q[0] - points[i][0], q[1] - points[i][1]));
  let left = lengths.reduce((s, l) => s + l, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i] && lengths[i] > 0) {
      const t = left / lengths[i];
      return [points[i][0] + (points[i + 1][0] - points[i][0]) * t, points[i][1] + (points[i + 1][1] - points[i][1]) * t];
    }
    left -= lengths[i];
  }
  return points[points.length - 1];
}

/** The box of an arrow's label, drawn centred on the middle of its path. */
export function labelBox(label: string, points: Point[]): Box {
  const chars = Array.from(label.trim()).length;
  const width = Math.min(320, Math.max(36, chars * 9 + 20));
  const height = Math.ceil((chars * 9 + 20) / 320) * 26;
  const [mx, my] = routeMiddle(points);
  return [mx - width / 2, my - height / 2, width, height];
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
  options: { sources?: string[]; view?: Box; handles?: Map<string, Box>; shape?: ArrowShape } = {},
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

  // Each arrow as the path the editor draws, and its label's box.
  const routes = scene.connectors.flatMap((c) => {
    const a = endBox(c.from);
    const b = endBox(c.to);
    if (!a || !b) return [];
    const { points } = arrowRoute(a, b, options.shape);
    return [{ c, points, label: c.label ? labelBox(c.label, points) : undefined }];
  });
  const pieces = (points: Point[]) => points.slice(1).map((q, i) => [points[i], q] as const);
  const meets = (a: Box, b: Box) =>
    a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

  const crossings: string[] = [];
  for (const { c, points, label } of routes) {
    const ends = new Set([c.from.split("#")[0], c.to.split("#")[0]]);
    const containers = new Set([...ends].flatMap((e) => [...ancestors(e)]));
    const arrow = `the arrow from ${name(c.from)} to ${name(c.to)}${c.label ? ` ("${c.label}")` : ""}`;
    const under: string[] = [];
    for (const o of solid) {
      if (containers.has(o.id)) continue;
      const box = boxes.get(o.id)!;
      if (!ends.has(o.id) && pieces(points).some(([p, q]) => clip(p, q, box)))
        crossings.push(`${arrow[0].toUpperCase()}${arrow.slice(1)} passes over ${name(o.id)}.`);
      // A label is drawn on top of whatever is under it, its own ends included.
      else if (label && meets(label, [box[0] + 4, box[1] + 4, box[2] - 8, box[3] - 8])) under.push(name(o.id));
    }
    if (under.length)
      crossings.push(`The label of ${arrow} sits over ${under.join(" and ")}: leave more room between them or shorten the label.`);
  }
  const arrowCrossings: string[] = [];
  for (let i = 0; i < routes.length; i++)
    for (let j = i + 1; j < routes.length; j++) {
      const a = routes[i];
      const b = routes[j];
      const shared = [a.c.from, a.c.to].some((e) => e === b.c.from || e === b.c.to);
      if (!shared && pieces(a.points).some(([p, q]) => pieces(b.points).some(([r, s]) => cross(p, q, r, s))))
        arrowCrossings.push(`The arrows ${name(a.c.from)} → ${name(a.c.to)} and ${name(b.c.from)} → ${name(b.c.to)} cross.`);
    }

  // Reading order: later objects sit to the right on the same band, or below.
  // An object an arrow joins to something earlier in the order is read by
  // following that arrow (a flowchart's side branch, a loop back), so its
  // position doesn't count against the order.
  const order: string[] = [];
  const ordered = scene.objects
    .filter((o) => o.order > 0 && boxes.has(o.id))
    .sort((a, b) => a.order - b.order);
  const base = (ref: string) => ref.split("#")[0];
  const joinedEarlier = (o: SceneObject) =>
    scene.connectors.some((c) => {
      const other = base(c.from) === o.id ? base(c.to) : base(c.to) === o.id ? base(c.from) : "";
      const earlier = objects.get(other);
      return !!earlier && earlier.order > 0 && earlier.order < o.order;
    });
  for (let i = 1; i < ordered.length; i++) {
    const a: SceneObject = ordered[i - 1];
    const b: SceneObject = ordered[i];
    if (a.in !== b.in || joinedEarlier(b)) continue;
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
