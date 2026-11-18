/**
 * The canvas map: a compact text description of how a canvas is arranged
 * (cards, frames, groups, arrows, mind maps), sent with every Ask Knot
 * message while a canvas is open. Handles (K1, F1…) are request-local; the
 * model refers to cards by title. See docs/AI-CANVAS-AWARENESS-PLAN.md.
 *
 * Raw data is captured from the editor (canvas-map.ts); this module only
 * orders, describes and budgets it, so it can be unit tested.
 */

export type MapBox = [x: number, y: number, w: number, h: number];

export type CanvasMapData = {
  cards: {
    id: string;
    title: string;
    /** Characters of text, for the size class. */
    length: number;
    box: MapBox;
    /** Media cards (YouTube, link, PDF, image, file) name their kind. */
    kind?: string;
  }[];
  frames: { id: string; title: string; box: MapBox; members: string[] }[];
  groups: { id: string; title: string; members: string[] }[];
  arrows: {
    from?: string;
    to?: string;
    label: string;
    /** Arrowheads: at the "to" end, the "from" end, both, or none. */
    heads: "to" | "from" | "both" | "none";
    /** Reroute points the arrow passes through, in order. */
    via?: string[];
  }[];
  mindmaps: {
    id: string;
    box: MapBox;
    /** Node labels with their depth, root first, in tree order. */
    nodes: { text: string; depth: number }[];
  }[];
  /** Shapes and text boxes with text. */
  texts: { id: string; text: string; box: MapBox }[];
  selected: string[];
  /** The note being asked about, if any; trimming keeps its surroundings. */
  focus?: string;
  /** The part of the canvas on screen when the map was captured. */
  view?: MapBox;
};

/** Empty space new content could go in (phase 4 of the orchestration plan). */
export type FreeArea = { box: MapBox; where: string };
const AREA_GAP = 80;
const AREA_MIN: [number, number] = [360, 240];
const AREA_MAX = 2400;

/**
 * Free areas beside the selection, beside PDF and media cards, and inside
 * the visible part of the canvas, each as large as the space allows, so the
 * model can put new content next to what the user is working with. Same
 * map, same areas: Apply resolves an area handle the same way.
 */
export function freeAreas(map: CanvasMapData, named: (id: string) => string = () => ""): FreeArea[] {
  const obstacles: MapBox[] = [
    ...map.cards.map((c) => c.box),
    ...map.frames.map((f) => f.box),
    ...map.mindmaps.map((m) => m.box),
    ...map.texts.map((t) => t.box),
  ];
  const clear = (b: MapBox) =>
    !obstacles.some(
      (o) => b[0] < o[0] + o[2] && b[0] + b[2] > o[0] && b[1] < o[1] + o[3] && b[1] + b[3] > o[1],
    );
  /** Grows a box right and down from its corner until it meets something. */
  const grow = (x: number, y: number, band: number): MapBox | undefined => {
    const right = obstacles
      .filter((o) => o[1] < y + band && o[1] + o[3] > y && o[0] + o[2] > x)
      .map((o) => o[0] - AREA_GAP);
    const w = Math.min(AREA_MAX, ...right.map((r) => r - x).filter((d) => d > -AREA_GAP));
    if (w < AREA_MIN[0]) return undefined;
    const below = obstacles
      .filter((o) => o[0] < x + w && o[0] + o[2] > x && o[1] + o[3] > y)
      .map((o) => o[1] - AREA_GAP);
    const h = Math.min(AREA_MAX, ...below.map((b) => b - y).filter((d) => d > -AREA_GAP));
    if (h < AREA_MIN[1]) return undefined;
    const box: MapBox = [x, y, w, h];
    return clear(box) ? box : undefined;
  };
  const areas: FreeArea[] = [];
  const add = (box: MapBox | undefined, where: string) => {
    if (!box) return;
    // One area per stretch of space: drop one the other almost contains.
    const overlap = areas.some((a) => {
      const ix = Math.max(0, Math.min(a.box[0] + a.box[2], box[0] + box[2]) - Math.max(a.box[0], box[0]));
      const iy = Math.max(0, Math.min(a.box[1] + a.box[3], box[1] + box[3]) - Math.max(a.box[1], box[1]));
      return ix * iy > 0.9 * Math.min(a.box[2] * a.box[3], box[2] * box[3]);
    });
    if (!overlap) areas.push({ box: box.map(Math.round) as MapBox, where });
  };
  const beside = (t: MapBox, label: string) => {
    const band = Math.max(t[3], 600);
    add(grow(t[0] + t[2] + AREA_GAP, t[1], band), `right of ${label}`);
    add(grow(t[0], t[1] + t[3] + AREA_GAP, band), `below ${label}`);
  };
  const boxes = [...map.cards, ...map.frames, ...map.texts, ...map.mindmaps];
  const picked = boxes.filter((o) => map.selected.includes(o.id)).map((o) => o.box);
  if (picked.length) {
    const x = Math.min(...picked.map((b) => b[0]));
    const y = Math.min(...picked.map((b) => b[1]));
    beside([x, y, Math.max(...picked.map((b) => b[0] + b[2])) - x, Math.max(...picked.map((b) => b[1] + b[3])) - y], "the selection");
  }
  // Media cards nearest the focus first: PDFs, images, videos, links, files.
  const focus = boxes.find((o) => o.id === map.focus)?.box ?? map.view;
  const centre = (b: MapBox) => [b[0] + b[2] / 2, b[1] + b[3] / 2];
  const media = map.cards
    .filter((c) => c.kind)
    .sort((a, b) => {
      if (!focus) return 0;
      const [fx, fy] = centre(focus);
      const [ax, ay] = centre(a.box);
      const [bx, by] = centre(b.box);
      return Math.hypot(ax - fx, ay - fy) - Math.hypot(bx - fx, by - fy);
    })
    .slice(0, 4);
  for (const card of media) beside(card.box, `${named(card.id)} (${card.kind} ${JSON.stringify(card.title.slice(0, 40))})`.trim());
  // The largest empty rectangle on screen, on a coarse grid.
  if (map.view) {
    const [vx, vy, vw, vh] = map.view;
    const cols = 16;
    const rows = 10;
    const cw = vw / cols;
    const ch = vh / rows;
    const free = Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => clear([vx + c * cw, vy + r * ch, cw, ch])),
    );
    const heights = Array(cols).fill(0);
    let best: [number, number, number, number] = [0, 0, 0, 0];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) heights[c] = free[r][c] ? heights[c] + 1 : 0;
      for (let c = 0; c < cols; c++) {
        let h = Infinity;
        for (let e = c; e < cols && heights[e]; e++) {
          h = Math.min(h, heights[e]);
          const area = (e - c + 1) * cw * h * ch;
          if (area > best[2] * best[3]) best = [c, r - h + 1, (e - c + 1) * cw, h * ch];
        }
      }
    }
    const [c0, r0, w, h] = best;
    if (w - AREA_GAP >= AREA_MIN[0] && h - AREA_GAP >= AREA_MIN[1])
      add([vx + c0 * cw + AREA_GAP / 2, vy + r0 * ch + AREA_GAP / 2, w - AREA_GAP, h - AREA_GAP], "on screen");
  }
  return areas.slice(0, 6);
}

/** About 3,000 tokens, estimated from UTF-8 bytes as for workspace evidence. */
export const CANVAS_MAP_BUDGET = 12_000;

const REGIONS = [
  ["top-left", "top", "top-right"],
  ["left", "middle", "right"],
  ["bottom-left", "bottom", "bottom-right"],
];

const bytes = (text: string) => new TextEncoder().encode(text).length;
const center = (b: MapBox) => [b[0] + b[2] / 2, b[1] + b[3] / 2];
const quote = (text: string, max = 80) => {
  const line = text.replace(/\s+/g, " ").trim();
  return JSON.stringify(
    line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line || "Untitled",
  );
};
const size = (length: number) =>
  length < 200 ? "short" : length < 800 ? "medium" : "long";

/** Contiguous citation numbers as "[S4–S6]", others comma separated. */
export function citationRange(numbers: number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  if (!sorted.length) return "";
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(
      j > i ? `S${sorted[i]}–S${sorted[j]}` : `S${sorted[i]}`,
    );
    i = j + 1;
  }
  return `[${parts.slice(0, 4).join(", ")}${parts.length > 4 ? ", …" : ""}]`;
}

/** Top-to-bottom in bands, then left to right. */
function readingOrder<T extends { box: MapBox }>(items: T[]): T[] {
  const band = 240;
  return [...items].sort(
    (a, b) =>
      Math.floor(a.box[1] / band) - Math.floor(b.box[1] / band) ||
      a.box[0] - b.box[0] ||
      a.box[1] - b.box[1],
  );
}

/**
 * Handles in reading order: frames, then free objects, members following
 * their frame. Deterministic for the same captured map, so Apply can resolve
 * a handle the model used without sending block IDs.
 */
function arrange(map: CanvasMapData) {
  // Frames, then free objects, each in reading order; members follow their
  // frame so handles read like the canvas.
  const inFrame = new Map<string, string>();
  for (const frame of map.frames)
    for (const id of frame.members) if (!inFrame.has(id)) inFrame.set(id, frame.id);
  const cardsById = new Map(map.cards.map((c) => [c.id, c]));
  const units = readingOrder([
    ...map.frames.map((f) => ({ box: f.box, frame: f })),
    ...map.cards
      .filter((c) => !inFrame.has(c.id))
      .map((c) => ({ box: c.box, card: c })),
  ]);
  const orderedCards: CanvasMapData["cards"] = [];
  const frameOrder: CanvasMapData["frames"] = [];
  for (const unit of units) {
    if ("frame" in unit && unit.frame) {
      frameOrder.push(unit.frame);
      orderedCards.push(
        ...readingOrder(
          unit.frame.members.flatMap((id) => {
            const card = cardsById.get(id);
            return card && inFrame.get(id) === unit.frame.id ? [card] : [];
          }),
        ),
      );
    } else if ("card" in unit && unit.card) orderedCards.push(unit.card);
  }
  const handle = new Map<string, string>();
  orderedCards.forEach((c, i) => handle.set(c.id, `K${i + 1}`));
  frameOrder.forEach((f, i) => handle.set(f.id, `F${i + 1}`));
  map.groups.forEach((g, i) => handle.set(g.id, `G${i + 1}`));
  const mindmaps = readingOrder(map.mindmaps);
  mindmaps.forEach((m, i) => handle.set(m.id, `M${i + 1}`));
  const texts = readingOrder(map.texts);
  texts.forEach((t, i) => handle.set(t.id, `T${i + 1}`));
  // Reroute points, in the order arrows first pass through them.
  let dots = 0;
  for (const arrow of map.arrows)
    for (const id of arrow.via ?? []) if (!handle.has(id)) handle.set(id, `R${++dots}`);
  return { inFrame, cardsById, units, orderedCards, frameOrder, handle, mindmaps, texts };
}

/** What a request-local handle (K3, F1, T2, M1, G1) points at. */
export type CanvasHandleTarget = {
  id: string;
  title: string;
  box?: MapBox;
  /** A free area (A handle), not an object. */
  area?: boolean;
};

/** Handle → canvas object for a captured map, as formatCanvasMap named them. */
export function canvasHandles(map: CanvasMapData): Map<string, CanvasHandleTarget> {
  const { handle } = arrange(map);
  const objects = new Map<string, CanvasHandleTarget>();
  for (const c of map.cards) objects.set(c.id, { id: c.id, title: c.title, box: c.box });
  for (const f of map.frames) objects.set(f.id, { id: f.id, title: f.title, box: f.box });
  for (const g of map.groups) objects.set(g.id, { id: g.id, title: g.title });
  for (const m of map.mindmaps)
    objects.set(m.id, { id: m.id, title: m.nodes[0]?.text ?? "", box: m.box });
  for (const t of map.texts) objects.set(t.id, { id: t.id, title: t.text, box: t.box });
  const result = new Map<string, CanvasHandleTarget>();
  for (const [id, name] of handle) {
    const target = objects.get(id);
    if (target) result.set(name, target);
  }
  // Free areas: A1, A2… (nothing on the canvas has their id).
  freeAreas(map, (id) => handle.get(id) ?? "").forEach((area, i) =>
    result.set(`A${i + 1}`, { id: `area:${i + 1}`, title: `free area ${area.where}`, box: area.box, area: true }),
  );
  return result;
}

/**
 * Describes the canvas for the model. `citations` maps a card's note ID to
 * the citation numbers of its blocks in this request. Over budget, positions
 * go first, then the objects furthest from the focus or selection, which are
 * summarised in one line.
 */
export function formatCanvasMap(
  map: CanvasMapData,
  citations: Map<string, number[]> = new Map(),
  budget = CANVAS_MAP_BUDGET,
): string {
  if (!map.cards.length && !map.frames.length && !map.mindmaps.length && !map.texts.length)
    return "";
  const { inFrame, cardsById, units, orderedCards, handle, mindmaps, texts } =
    arrange(map);
  const groupOf = new Map<string, string>();
  for (const group of map.groups)
    for (const id of group.members) if (!groupOf.has(id)) groupOf.set(id, group.id);

  // Regions over everything described.
  const boxes = [
    ...map.cards.map((c) => c.box),
    ...map.frames.map((f) => f.box),
    ...map.mindmaps.map((m) => m.box),
    ...map.texts.map((t) => t.box),
  ];
  const minX = Math.min(...boxes.map((b) => b[0]));
  const minY = Math.min(...boxes.map((b) => b[1]));
  const spanX = Math.max(1, Math.max(...boxes.map((b) => b[0] + b[2])) - minX);
  const spanY = Math.max(1, Math.max(...boxes.map((b) => b[1] + b[3])) - minY);
  const region = (b: MapBox) => {
    const [cx, cy] = center(b);
    const col = Math.min(2, Math.floor(((cx - minX) / spanX) * 3));
    const row = Math.min(2, Math.floor(((cy - minY) / spanY) * 3));
    return REGIONS[row][col];
  };
  // Up to two nearby cards, with where this card is relative to them.
  const near = (card: CanvasMapData["cards"][number]) => {
    const [cx, cy] = center(card.box);
    return orderedCards
      .filter((o) => o.id !== card.id)
      .map((o) => {
        const [ox, oy] = center(o.box);
        const gapX = Math.max(0, Math.abs(cx - ox) - (card.box[2] + o.box[2]) / 2);
        const gapY = Math.max(0, Math.abs(cy - oy) - (card.box[3] + o.box[3]) / 2);
        return { o, gap: Math.hypot(gapX, gapY), dx: cx - ox, dy: cy - oy };
      })
      .filter((n) => n.gap <= 400)
      .sort((a, b) => a.gap - b.gap)
      .slice(0, 2)
      .map(({ o, dx, dy }) =>
        `${Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "right of" : "left of") : dy > 0 ? "below" : "above"} ${handle.get(o.id)}`,
      );
  };

  // Which cards to keep when trimming: the focus and selection, what is in
  // their frames, two arrow-hops out, then by distance.
  const seeds = new Set([...map.selected, ...(map.focus ? [map.focus] : [])]);
  for (const id of [...seeds]) {
    const frame = inFrame.get(id) ?? (map.frames.some((f) => f.id === id) ? id : undefined);
    for (const member of map.frames.find((f) => f.id === frame)?.members ?? []) seeds.add(member);
  }
  const hops = new Map<string, number>([...seeds].map((id) => [id, 0]));
  for (let depth = 1; depth <= 2; depth++)
    for (const arrow of map.arrows) {
      const ends = [arrow.from, arrow.to];
      for (const [a, b] of [ends, [...ends].reverse()])
        if (a && b && hops.get(a) === depth - 1 && !hops.has(b)) hops.set(b, depth);
    }
  const anchor = (() => {
    const known = orderedCards.filter((c) => seeds.has(c.id));
    if (!known.length) return [minX + spanX / 2, minY + spanY / 2];
    const centers = known.map((c) => center(c.box));
    return [
      centers.reduce((s, c) => s + c[0], 0) / centers.length,
      centers.reduce((s, c) => s + c[1], 0) / centers.length,
    ];
  })();
  const priority = [...orderedCards].sort((a, b) => {
    const ha = hops.get(a.id) ?? 9;
    const hb = hops.get(b.id) ?? 9;
    if (ha !== hb) return ha - hb;
    const [ax, ay] = center(a.box);
    const [bx, by] = center(b.box);
    return (
      Math.hypot(ax - anchor[0], ay - anchor[1]) -
      Math.hypot(bx - anchor[0], by - anchor[1])
    );
  });

  const render = (keep: Set<string>, detail: boolean) => {
    const lines: string[] = [];
    const cardLine = (card: CanvasMapData["cards"][number]) => {
      const parts = [
        `${handle.get(card.id)} ${card.kind ? `${card.kind} ` : ""}${quote(card.title)}`,
      ];
      const cited = citationRange(citations.get(card.id) ?? []);
      if (cited) parts.push(cited);
      const facts = [card.kind ? "" : size(card.length)];
      const frame = inFrame.get(card.id);
      if (frame) facts.push(`in ${handle.get(frame)}`);
      const group = groupOf.get(card.id);
      if (group) facts.push(`in ${handle.get(group)}`);
      if (detail) {
        if (!frame) facts.push(region(card.box));
        facts.push(...near(card));
      }
      return `${parts.join(" ")} ${facts.filter(Boolean).join(", ")}`.trimEnd();
    };
    // In reading order, each frame followed by its cards.
    for (const unit of units) {
      if ("card" in unit && unit.card) {
        if (keep.has(unit.card.id)) lines.push(cardLine(unit.card));
        continue;
      }
      const frame = (unit as { frame: CanvasMapData["frames"][number] }).frame;
      const members = frame.members.filter((id) => keep.has(id) && handle.has(id));
      const all = frame.members.filter((id) => handle.has(id)).length;
      if (!members.length && !seeds.has(frame.id) && all) continue;
      lines.push(
        `${handle.get(frame.id)} frame ${quote(frame.title)}${detail ? ` [${region(frame.box)}]` : ""}: ${members.map((id) => handle.get(id)).join(" ") || "empty"}${members.length < all ? ` (+${all - members.length} not described)` : ""}`,
      );
      for (const card of orderedCards)
        if (inFrame.get(card.id) === frame.id && keep.has(card.id))
          lines.push(cardLine(card));
    }
    for (const group of map.groups) {
      const members = group.members.filter((id) => keep.has(id) || !cardsById.has(id));
      if (members.length)
        lines.push(
          `${handle.get(group.id)} group${group.title ? ` ${quote(group.title)}` : ""}: ${members.map((id) => handle.get(id) ?? "an object").join(" ")}`,
        );
    }
    const described = (id?: string) =>
      !!id && handle.has(id) && (!cardsById.has(id) || keep.has(id));
    for (const arrow of map.arrows) {
      if (!described(arrow.from) && !described(arrow.to)) continue;
      const end = (id?: string) =>
        described(id) ? handle.get(id!)! : id ? "an object not described" : "a point";
      const arrowhead =
        arrow.heads === "to"
          ? `-${arrow.label ? `${arrow.label}-` : ""}>`
          : arrow.heads === "from"
            ? `<-${arrow.label ? `${arrow.label}-` : ""}`
            : arrow.heads === "both"
              ? `<-${arrow.label ? `${arrow.label}-` : ""}>`
              : `-${arrow.label ? `${arrow.label}-` : ""}-`;
      const via = arrow.via?.length
        ? ` via ${arrow.via.map((id) => handle.get(id)).join(" ")}`
        : "";
      lines.push(`arrow ${end(arrow.from)} ${arrowhead} ${end(arrow.to)}${via}`);
    }
    for (const mindmap of mindmaps) {
      lines.push(
        `${handle.get(mindmap.id)} mind map${detail ? ` [${region(mindmap.box)}]` : ""}:`,
      );
      for (const node of mindmap.nodes.slice(0, 60))
        lines.push(`${"  ".repeat(node.depth + 1)}${quote(node.text, 60).slice(1, -1)}`);
    }
    for (const text of texts)
      lines.push(
        `${handle.get(text.id)} text ${quote(text.text)}${detail ? ` [${region(text.box)}]` : ""}`,
      );
    // Loose ends, found here rather than left to the model.
    const touched = new Set(map.arrows.flatMap((a) => [a.from, a.to]));
    const loose = orderedCards
      .filter((c) => keep.has(c.id) && !touched.has(c.id))
      .map((c) => handle.get(c.id));
    if (loose.length && map.arrows.length)
      lines.push(
        `not connected: ${loose.slice(0, 30).join(" ")}${loose.length > 30 ? " …" : ""}`,
      );
    const selected = map.selected.filter(described).map((id) => handle.get(id));
    if (selected.length) lines.push(`selected: ${selected.join(" ")}`);
    freeAreas(map, (id) => handle.get(id) ?? "").forEach((area, i) =>
      lines.push(`A${i + 1} free area ${area.where}, about ${area.box[2]} × ${area.box[3]}`),
    );
    const hidden = orderedCards.filter((c) => !keep.has(c.id)).length;
    if (hidden)
      lines.push(
        `${hidden} more ${hidden === 1 ? "card is" : "cards are"} on the canvas but not described.`,
      );
    return lines.join("\n");
  };

  const all = new Set(orderedCards.map((c) => c.id));
  for (const detail of [true, false]) {
    const text = render(all, detail);
    if (bytes(text) <= budget) return text;
  }
  // Keep the most relevant cards that fit, without positions.
  let low = 0;
  let high = priority.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const text = render(new Set(priority.slice(0, mid).map((c) => c.id)), false);
    if (bytes(text) <= budget) low = mid;
    else high = mid - 1;
  }
  return render(new Set(priority.slice(0, low).map((c) => c.id)), false);
}
