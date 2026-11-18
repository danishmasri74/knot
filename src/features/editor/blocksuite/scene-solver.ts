/**
 * Turns a scene's spatial intent into canvas positions. The model decides
 * the composition (what sits right of, below or inside what; which objects
 * form a row, column, grid or ring); this only does the arithmetic and the
 * physics: measured sizes, no overlaps, frames fitted around their contents,
 * room for arrow labels. It never picks a structure of its own. Every
 * compromise is recorded as a plain sentence for the layout report.
 *
 * Free of the editor so it can be unit tested. See
 * docs/AI-CANVAS-ORCHESTRATION-PLAN.md §4.
 */
import {
  readingOrder,
  type Scene,
  type SceneAlign,
  type SceneArrangement,
  type ScenePlace,
} from "./scene";

export type Box = [x: number, y: number, w: number, h: number];
export type Size = { width: number; height: number };

export type SolveInput = {
  /** Measured or estimated size of every object except frames. */
  sizes: Map<string, Size>;
  /** Existing canvas objects by map handle (absolute boxes). */
  handles?: Map<string, Box>;
  /** Everything already on the canvas that new objects must not cover. */
  obstacles?: Box[];
  /** Resolved anchor: the box the scene is placed against. */
  anchor?: Box;
  /** Where the scene starts when there's no anchor. */
  origin?: [number, number];
  /** Existing objects the scene lists but doesn't move: where they are. */
  fixed?: Map<string, Box>;
};
export type SolveResult = {
  /** Absolute boxes for every object, frames included. */
  boxes: Map<string, Box>;
  report: string[];
};

/** Widest gap an arrow label may claim. */
const MAX_LABEL_GAP = 340;
/**
 * Gap that keeps an arrow's label (16 px, drawn at the arrow's middle) in
 * the space between two objects instead of over them.
 */
export function labelGap(labels: (string | undefined)[], base = 140) {
  const widest = Math.max(
    0,
    ...labels.map((label) =>
      Array.from(label?.trim() ?? "").reduce(
        (width, char) => width + (char.charCodeAt(0) > 255 ? 16 : 8.5),
        0,
      ),
    ),
  );
  return Math.min(MAX_LABEL_GAP, Math.max(base, Math.ceil(widest + 56)));
}
/** Space between neighbours when the model doesn't give one. */
export const NORMAL_GAP = 100;
/** Closest two objects may sit after collision repair. */
const MIN_GAP = 40;
export const FRAME_PAD = 40;
export const FRAME_TOP = 60;
const EMPTY_FRAME: Size = { width: 320, height: 200 };

type Unit = {
  id: string;
  /** Object ids in the unit, with offsets from the unit's top left. */
  members: Map<string, Box>;
  w: number;
  h: number;
  place: ScenePlace;
  cell: number[];
  order: number;
  /** Where the unit was put, once placed. */
  at?: [number, number];
  /** Direction collisions push it. */
  push: [number, number];
};

const right = (b: Box) => b[0] + b[2];
const bottom = (b: Box) => b[1] + b[3];
const overlaps = (a: Box, b: Box, gap = MIN_GAP) =>
  a[0] < right(b) + gap && right(a) + gap > b[0] && a[1] < bottom(b) + gap && bottom(a) + gap > b[1];
const bounds = (boxes: Box[]): Box => {
  const x = Math.min(...boxes.map((b) => b[0]));
  const y = Math.min(...boxes.map((b) => b[1]));
  return [x, y, Math.max(...boxes.map(right)) - x, Math.max(...boxes.map(bottom)) - y];
};
const along = (align: SceneAlign | "", start: number, span: number, size: number) =>
  align === "center" ? start + span / 2 - size / 2 : align === "end" ? start + span - size : start;

const PUSH: Record<string, [number, number]> = {
  rightOf: [1, 0],
  leftOf: [-1, 0],
  above: [0, -1],
  below: [0, 1],
};

/** Solves the scene. Sizes for frames come from their contents. */
export function solveScene(scene: Scene, input: SolveInput): SolveResult {
  const report: string[] = [];
  const objects = new Map(scene.objects.map((o) => [o.id, o]));
  const local = new Map<string, Box>(); // box within its container
  const frameSize = new Map<string, Size>();
  const handles = input.handles ?? new Map<string, Box>();

  /** Labelled arrows between two sets of ids: the gap their labels need. */
  const labelled = (a: Set<string>, b: Set<string>, horizontal: boolean, gap: number) => {
    const base = (ref: string) => ref.split("#")[0];
    const labels = scene.connectors
      .filter(
        (c) =>
          c.label &&
          ((a.has(base(c.from)) && b.has(base(c.to))) || (b.has(base(c.from)) && a.has(base(c.to)))),
      )
      .map((c) => c.label);
    if (!labels.length) return gap;
    return horizontal ? Math.max(gap, labelGap(labels, 0)) : Math.max(gap, 90);
  };
  /** Whether any arrow joins the two sets of ids. */
  const connected = (a: Set<string>, b: Set<string>) => {
    const base = (ref: string) => ref.split("#")[0];
    return scene.connectors.some(
      (c) =>
        (a.has(base(c.from)) && b.has(base(c.to))) || (b.has(base(c.from)) && a.has(base(c.to))),
    );
  };
  /** The earliest reading order among some objects; 0 when none has one. */
  const earliest = (ids: string[]) => {
    const orders = ids.map((m) => objects.get(m)?.order ?? 0).filter((n) => n > 0);
    return orders.length ? Math.min(...orders) : 0;
  };
  /** Ids of an object and everything inside it (frames contain objects). */
  const within = (id: string): Set<string> => {
    const ids = new Set([id]);
    for (const o of scene.objects) {
      let at = o.in;
      while (at) {
        if (at === id) ids.add(o.id);
        at = objects.get(at)?.in ?? "";
      }
    }
    return ids;
  };
  const sizeOf = (id: string): Size => {
    const o = objects.get(id)!;
    if (o.kind === "frame") return frameSize.get(id) ?? EMPTY_FRAME;
    const s = input.sizes.get(id) ?? { width: 360, height: 240 };
    return { width: o.width || s.width, height: s.height };
  };

  /** Lays out an arrangement's members relative to each other. */
  const arrange = (a: SceneArrangement): Unit => {
    const sizes = a.members.map(sizeOf);
    const ids = a.members.map((m) => within(m));
    const base = a.gap || (a.kind === "stack" ? 24 : NORMAL_GAP * 0.8);
    const members = new Map<string, Box>();
    if (a.kind === "row" || a.kind === "column" || a.kind === "stack") {
      const horizontal = a.kind === "row";
      const cross = Math.max(...sizes.map((s) => (horizontal ? s.height : s.width)));
      let at = 0;
      a.members.forEach((m, i) => {
        const s = sizes[i];
        if (i) at += labelled(ids[i - 1], ids[i], horizontal, base);
        const off = along(a.align, 0, cross, horizontal ? s.height : s.width);
        members.set(m, horizontal ? [at, off, s.width, s.height] : [off, at, s.width, s.height]);
        at += horizontal ? s.width : s.height;
      });
    } else if (a.kind === "grid") {
      const columns = a.columns || Math.ceil(Math.sqrt(a.members.length));
      const rows = Math.ceil(a.members.length / columns);
      const widths = Array.from({ length: columns }, (_, c) =>
        Math.max(0, ...sizes.filter((_, i) => i % columns === c).map((s) => s.width)),
      );
      const heights = Array.from({ length: rows }, (_, r) =>
        Math.max(0, ...sizes.filter((_, i) => Math.floor(i / columns) === r).map((s) => s.height)),
      );
      // Neighbours joined by a labelled arrow get the room the label needs.
      const at = (r: number, c: number) => ids[r * columns + c] ?? new Set<string>();
      const gapX = Array.from({ length: columns - 1 }, (_, c) =>
        Math.max(base, ...Array.from({ length: rows }, (_, r) => labelled(at(r, c), at(r, c + 1), true, base))),
      );
      const gapY = Array.from({ length: rows - 1 }, (_, r) =>
        Math.max(base, ...Array.from({ length: columns }, (_, c) => labelled(at(r, c), at(r + 1, c), false, base))),
      );
      a.members.forEach((m, i) => {
        const c = i % columns;
        const r = Math.floor(i / columns);
        const x = widths.slice(0, c).reduce((s, w, k) => s + w + gapX[k], 0);
        const y = heights.slice(0, r).reduce((s, h, k) => s + h + gapY[k], 0);
        members.set(m, [
          along(a.align, x, widths[c], sizes[i].width),
          y,
          sizes[i].width,
          sizes[i].height,
        ]);
      });
    } else {
      // ring: members around an ellipse, the centre (if any) in the middle.
      const center = a.center ? a.members.indexOf(a.center) : -1;
      const ring = a.members.map((_, i) => i).filter((i) => i !== center);
      const maxW = Math.max(...ring.map((i) => sizes[i].width));
      const maxH = Math.max(...ring.map((i) => sizes[i].height));
      const around = ring.reduce((s, i) => s + sizes[i].width + base, 0);
      const cw = center >= 0 ? sizes[center].width : 0;
      const ch = center >= 0 ? sizes[center].height : 0;
      const labelRoom = scene.connectors.some((c) => c.label) ? 80 : 0;
      const rx = Math.max(cw / 2 + maxW / 2 + base + labelRoom, around / (2 * Math.PI) + maxW / 4);
      const ry = Math.max(ch / 2 + maxH / 2 + base + labelRoom / 2, rx * 0.7);
      if (center >= 0) members.set(a.members[center], [-cw / 2, -ch / 2, cw, ch]);
      ring.forEach((i, k) => {
        const angle = -Math.PI / 2 + (2 * Math.PI * k) / ring.length;
        members.set(a.members[i], [
          Math.cos(angle) * rx - sizes[i].width / 2,
          Math.sin(angle) * ry - sizes[i].height / 2,
          sizes[i].width,
          sizes[i].height,
        ]);
      });
      separate([...members.values()]);
    }
    const all = bounds([...members.values()]);
    for (const [m, b] of members) members.set(m, [b[0] - all[0], b[1] - all[1], b[2], b[3]]);
    const first = a.members[0];
    return {
      id: a.id,
      members,
      w: all[2],
      h: all[3],
      place: a.place,
      cell: [],
      order: first === undefined ? 0 : earliest(a.members),
      push: PUSH[a.place.rel] ?? [0, 1],
    };
  };

  /** Solves one container (the scene itself, "", or a frame) in its own coordinates. */
  const solve = (container: string, root: boolean) => {
    const children = scene.objects.filter((o) => o.in === container);
    // Frames inside first: their size depends on what they hold.
    for (const f of children) if (f.kind === "frame") solve(f.id, false);
    const arrangements = scene.arrangements.filter((a) => a.in === container);
    const inArrangement = new Set(arrangements.flatMap((a) => a.members));
    const units: Unit[] = [
      ...readingOrder(children)
        .filter((o) => !inArrangement.has(o.id))
        .map((o): Unit => {
          const s = sizeOf(o.id);
          return {
            id: o.id,
            members: new Map([[o.id, [0, 0, s.width, s.height] as Box]]),
            w: s.width,
            h: s.height,
            place: o.place,
            cell: o.cell,
            order: o.order,
            push: PUSH[o.place.rel] ?? [0, 1],
          };
        }),
      ...arrangements.map(arrange),
    ];
    units.sort((a, b) => (a.order || Number.MAX_SAFE_INTEGER) - (b.order || Number.MAX_SAFE_INTEGER));
    /** The unit in this container holding an object (directly or in a frame). */
    const holder = (ref: string): Unit | undefined => {
      let id = ref;
      for (let i = 0; i < 100; i++) {
        const unit = units.find((u) => u.id === id || u.members.has(id));
        if (unit) return unit;
        const parent = objects.get(id)?.in;
        if (!parent) return undefined;
        id = parent;
      }
      return undefined;
    };
    const placed: Unit[] = [];
    const fixed: Box[] = root ? [...(input.obstacles ?? [])] : [];
    // Existing objects that don't move are already placed.
    const pinned = new Set(root ? units.filter((u) => input.fixed?.has(u.id)).map((u) => u.id) : []);
    for (const u of units)
      if (pinned.has(u.id)) {
        const b = input.fixed!.get(u.id)!;
        u.at = [b[0], b[1]];
        placed.push(u);
      }
    const boxOf = (u: Unit): Box => [u.at![0], u.at![1], u.w, u.h];
    /** Box of the referenced thing in this container's coordinates. */
    const refBox = (ref: string): Box | undefined => {
      if (root && handles.has(ref)) return handles.get(ref);
      const unit = holder(ref);
      if (!unit?.at) return undefined;
      const member = unit.members.get(ref) ?? unit.members.get(unit.id);
      return member && unit.members.has(ref)
        ? [unit.at[0] + member[0], unit.at[1] + member[1], member[2], member[3]]
        : boxOf(unit);
    };
    const collides = (b: Box) =>
      placed.some((u) => overlaps(b, boxOf(u))) || fixed.some((f) => overlaps(b, f));
    const position = (u: Unit, ref: Box, rel: string, align: SceneAlign | "", gap: number): [number, number] => {
      switch (rel) {
        case "leftOf":
          return [ref[0] - gap - u.w, along(align, ref[1], ref[3], u.h)];
        case "above":
          return [along(align, ref[0], ref[2], u.w), ref[1] - gap - u.h];
        case "below":
          return [along(align, ref[0], ref[2], u.w), bottom(ref) + gap];
        default:
          return [right(ref) + gap, along(align, ref[1], ref[3], u.h)];
      }
    };
    const relGap = (u: Unit, ref: string, rel: string) => {
      const mine = new Set([...u.members.keys()].flatMap((m) => [...within(m)]));
      const theirs = new Set(within(ref));
      return labelled(mine, theirs, rel === "rightOf" || rel === "leftOf" || rel === "near", u.place.gap || NORMAL_GAP);
    };

    // 1. Cells: a grid the model laid out, at the container's origin.
    const cells = units.filter((u) => u.cell.length === 2);
    if (cells.length) {
      const cols = Math.max(...cells.map((u) => u.cell[0])) + 1;
      const rows = Math.max(...cells.map((u) => u.cell[1])) + 1;
      const widths = Array.from({ length: cols }, (_, c) =>
        Math.max(0, ...cells.filter((u) => u.cell[0] === c).map((u) => u.w)),
      );
      const heights = Array.from({ length: rows }, (_, r) =>
        Math.max(0, ...cells.filter((u) => u.cell[1] === r).map((u) => u.h)),
      );
      // Neighbouring cells joined by a labelled arrow get the room the label needs.
      const idsAt = (c: number, r: number) =>
        new Set(
          cells
            .filter((u) => u.cell[0] === c && u.cell[1] === r)
            .flatMap((u) => [...u.members.keys()].flatMap((m) => [...within(m)])),
        );
      const gapX = Array.from({ length: cols }, (_, c) =>
        Math.max(NORMAL_GAP, ...Array.from({ length: rows }, (_, r) => labelled(idsAt(c, r), idsAt(c + 1, r), true, NORMAL_GAP))),
      );
      const gapY = Array.from({ length: rows }, (_, r) =>
        Math.max(NORMAL_GAP, ...Array.from({ length: cols }, (_, c) => labelled(idsAt(c, r), idsAt(c, r + 1), false, NORMAL_GAP))),
      );
      for (const u of cells) {
        u.at = [
          widths.slice(0, u.cell[0]).reduce((s, w, k) => s + w + (w ? gapX[k] : 0), 0),
          heights.slice(0, u.cell[1]).reduce((s, h, k) => s + h + (h ? gapY[k] : 0), 0),
        ];
        placed.push(u);
      }
    }

    // 2. Relations, in dependency order; what can't be resolved is placed by Knot.
    let pending = units.filter((u) => !u.at);
    let fallbacks = 0;
    while (pending.length) {
      const ready = pending.find((u) => !u.place.of || refBox(u.place.of));
      const unit =
        ready ??
        // A loop of references: break it at the first unit in reading order.
        pending[0];
      if (!ready) {
        report.push(`Placement references formed a loop around "${unit.id}"; Knot placed it next to the others.`);
        unit.place = { ...unit.place, of: "", rel: "" };
      }
      if (unit.place.of) {
        const ref = refBox(unit.place.of)!;
        const gap = relGap(unit, unit.place.of, unit.place.rel);
        if (unit.place.rel === "near") {
          const tries = ["rightOf", "below", "leftOf", "above"].map((rel) => ({
            rel,
            at: position(unit, ref, rel, unit.place.align, gap),
          }));
          const free = tries.find((t) => !collides([t.at[0], t.at[1], unit.w, unit.h])) ?? tries[0];
          unit.at = free.at;
          unit.push = PUSH[free.rel];
        } else unit.at = position(unit, ref, unit.place.rel, unit.place.align, gap);
      } else if (!placed.length) unit.at = [0, 0];
      else {
        // No position given: beside what it's connected to, else after the rest.
        const mine = new Set([...unit.members.keys()].flatMap((m) => [...within(m)]));
        const linked = placed.find((p) => {
          const theirs = new Set([...p.members.keys()].flatMap((m) => [...within(m)]));
          return connected(mine, theirs);
        });
        if (linked) {
          const ref = boxOf(linked);
          const gap = relGap(unit, linked.id, "rightOf");
          const tries = ["rightOf", "below", "leftOf", "above"].map((rel) => ({
            rel,
            at: position(unit, ref, rel, "start", gap),
          }));
          const open = tries.find((t) => !collides([t.at[0], t.at[1], unit.w, unit.h])) ?? tries[0];
          unit.at = open.at;
          unit.push = PUSH[open.rel];
        } else {
          const all = bounds(placed.map(boxOf));
          unit.at = [right(all) + NORMAL_GAP, all[1]];
          unit.push = [1, 0];
        }
        fallbacks++;
      }
      placed.push(unit);
      pending = pending.filter((u) => u !== unit);
    }
    if (fallbacks && placed.length > 1)
      report.push(
        `${fallbacks} ${fallbacks === 1 ? "object had" : "objects had"} no position${container ? ` in "${objects.get(container)?.text || container}"` : ""}; Knot put ${fallbacks === 1 ? "it" : "them"} beside related or neighbouring objects.`,
      );

    // 3. Physics: nothing overlaps; each unit moves the way it was placed.
    // Frames' contents only meet their siblings; the scene's units are
    // then moved clear of the canvas as a group below.
    const settled: Unit[] = [];
    for (const u of placed) {
      if (pinned.has(u.id)) {
        settled.push(u);
        continue;
      }
      const start = u.at!;
      for (let i = 0; i < 200; i++) {
        const b = boxOf(u);
        const hit = settled.find((s) => overlaps(b, boxOf(s)));
        if (!hit) break;
        const h = boxOf(hit);
        const [dx, dy] = u.push;
        u.at =
          dx > 0
            ? [right(h) + MIN_GAP, b[1]]
            : dx < 0
              ? [h[0] - MIN_GAP - u.w, b[1]]
              : dy < 0
                ? [b[0], h[1] - MIN_GAP - u.h]
                : [b[0], bottom(h) + MIN_GAP];
      }
      if (Math.hypot(u.at![0] - start[0], u.at![1] - start[1]) > 10) {
        const hit = settled.find((s) => overlaps([start[0], start[1], u.w, u.h], boxOf(s)));
        report.push(
          `"${label(u)}" moved so it doesn't cover "${hit ? label(hit) : "another object"}".`,
        );
      }
      settled.push(u);
    }
    function label(u: Unit) {
      const o = objects.get(u.id);
      return o?.text?.split("\n")[0].slice(0, 60) || u.id;
    }

    // Frames hold their contents with padding; a requested width is a minimum.
    if (!root) {
      const frame = objects.get(container)!;
      const boxes = settled.flatMap((u) =>
        [...u.members].map(([, m]): Box => [u.at![0] + m[0], u.at![1] + m[1], m[2], m[3]]),
      );
      if (!boxes.length) {
        frameSize.set(container, { width: frame.width || EMPTY_FRAME.width, height: EMPTY_FRAME.height });
        return;
      }
      const all = bounds(boxes);
      for (const u of settled)
        for (const [id, m] of u.members)
          local.set(id, [u.at![0] + m[0] - all[0] + FRAME_PAD, u.at![1] + m[1] - all[1] + FRAME_TOP, m[2], m[3]]);
      frameSize.set(container, {
        width: Math.max(frame.width, all[2] + FRAME_PAD * 2),
        height: all[3] + FRAME_TOP + FRAME_PAD,
      });
      return;
    }

    // The scene: units tied to existing objects keep their place; the rest
    // move together to the anchor and slide away from it until clear.
    const free = settled.filter((u) => !tiedToCanvas(u, settled));
    const tied = settled.filter((u) => tiedToCanvas(u, settled));
    if (free.length) {
      const group = bounds(free.map(boxOf));
      const side = scene.anchor.side || "right";
      const a = input.anchor;
      let [x, y] = a
        ? side === "left"
          ? [a[0] - NORMAL_GAP * 1.6 - group[2], a[1]]
          : side === "below"
            ? [a[0], bottom(a) + NORMAL_GAP * 1.6]
            : side === "above"
              ? [a[0], a[1] - NORMAL_GAP * 1.6 - group[3]]
              : [right(a) + NORMAL_GAP * 1.6, a[1]]
        : (input.origin ?? [0, 0]);
      const step: [number, number] =
        side === "left" ? [-1, 0] : side === "above" ? [0, -1] : side === "below" ? [0, 1] : a ? [1, 0] : [0, 1];
      const blockers = [...fixed, ...tied.map(boxOf)];
      const moved = { x, y };
      for (let i = 0; i < 400; i++) {
        const box: Box = [x, y, group[2], group[3]];
        const hits = blockers.filter((b) => overlaps(box, b, NORMAL_GAP / 2));
        if (!hits.length) break;
        x =
          step[0] > 0
            ? Math.max(...hits.map(right)) + NORMAL_GAP
            : step[0] < 0
              ? Math.min(...hits.map((b) => b[0])) - NORMAL_GAP - group[2]
              : x;
        y =
          step[1] > 0
            ? Math.max(...hits.map(bottom)) + NORMAL_GAP
            : step[1] < 0
              ? Math.min(...hits.map((b) => b[1])) - NORMAL_GAP - group[3]
              : y;
      }
      if (a && Math.hypot(x - moved.x, y - moved.y) > NORMAL_GAP)
        report.push("The space beside the anchor was taken, so the new content moved further out to stay clear.");
      for (const u of free) u.at = [u.at![0] - group[0] + x, u.at![1] - group[1] + y];
    }
    // Units tied to existing objects slide off anything they'd cover.
    for (const u of tied) {
      if (pinned.has(u.id)) continue;
      for (let i = 0; i < 200; i++) {
        const b = boxOf(u);
        const hit = [...fixed, ...settled.filter((s) => s !== u).map(boxOf)].find((f) => overlaps(b, f));
        if (!hit) break;
        const [dx, dy] = u.push;
        u.at =
          dx > 0 ? [right(hit) + MIN_GAP, b[1]] : dx < 0 ? [hit[0] - MIN_GAP - u.w, b[1]] : dy < 0 ? [b[0], hit[1] - MIN_GAP - u.h] : [b[0], bottom(hit) + MIN_GAP];
      }
    }
    for (const u of settled)
      for (const [id, m] of u.members) local.set(id, [u.at![0] + m[0], u.at![1] + m[1], m[2], m[3]]);
  };
  /** Placed relative to an existing canvas object, directly or through others. */
  function tiedToCanvas(u: Unit, all: Unit[], seen = new Set<string>()): boolean {
    if (input.fixed?.has(u.id)) return true;
    if (!u.place.of || seen.has(u.id)) return false;
    if (handles.has(u.place.of)) return true;
    seen.add(u.id);
    const ref = all.find((v) => v.id === u.place.of || v.members.has(u.place.of));
    return !!ref && tiedToCanvas(ref, all, seen);
  }

  solve("", true);

  // Absolute boxes: each container's offset added down the frame chain.
  const boxes = new Map<string, Box>();
  const absolute = (id: string): Box => {
    const known = boxes.get(id);
    if (known) return known;
    const o = objects.get(id)!;
    const l = local.get(id) ?? [0, 0, sizeOf(id).width, sizeOf(id).height];
    const size = o.kind === "frame" ? frameSize.get(id) ?? EMPTY_FRAME : { width: l[2], height: l[3] };
    const parent = o.in ? absolute(o.in) : ([0, 0, 0, 0] as Box);
    const box: Box = [parent[0] + l[0], parent[1] + l[1], size.width, size.height];
    boxes.set(id, box);
    return box;
  };
  for (const o of scene.objects) absolute(o.id);
  return { boxes, report };
}

/** Pushes boxes apart (in place) until none overlap; used inside a ring. */
function separate(boxes: Box[]) {
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (!overlaps(a, b)) continue;
        if (b[1] >= a[1]) b[1] = bottom(a) + MIN_GAP;
        else a[1] = bottom(b) + MIN_GAP;
        moved = true;
      }
    if (!moved) break;
  }
}

/** Pairs of overlapping boxes among siblings (a frame and its contents don't count). */
export function sceneOverlaps(scene: Scene, boxes: Map<string, Box>): [string, string][] {
  const parent = new Map(scene.objects.map((o) => [o.id, o.in]));
  const inside = (a: string, b: string) => {
    let at = parent.get(a);
    while (at) {
      if (at === b) return true;
      at = parent.get(at);
    }
    return false;
  };
  const ids = [...boxes.keys()];
  const pairs: [string, string][] = [];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++)
      if (
        !inside(ids[i], ids[j]) &&
        !inside(ids[j], ids[i]) &&
        overlaps(boxes.get(ids[i])!, boxes.get(ids[j])!, 0)
      )
        pairs.push([ids[i], ids[j]]);
  return pairs;
}
