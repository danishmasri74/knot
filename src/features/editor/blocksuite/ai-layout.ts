type Connection = { from: number; to: number };
export type CardBounds = [number, number, number, number];

/** Keep connected topics together without allowing a large proposal to become a strip. */
export function layoutAiCards(
  texts: string[],
  connections: Connection[],
  left = 0,
  sizes: { width: number; height: number }[] = [],
): CardBounds[] {
  const neighbors = texts.map(() => new Set<number>());
  for (const { from, to } of connections) {
    neighbors[from].add(to);
    neighbors[to].add(from);
  }
  const order: number[] = [];
  const seen = new Set<number>();
  for (let seed = 0; seed < texts.length; seed++) {
    if (seen.has(seed)) continue;
    const queue = [seed];
    seen.add(seed);
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i];
      order.push(current);
      for (const next of neighbors[current]) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
  }
  const columns = Math.min(4, Math.ceil(Math.sqrt(texts.length)));
  // Conservative wrapping allowance includes explicit newlines and wide glyphs.
  const heights = texts.map((text) =>
    Math.max(
      240,
      80 +
        text
          .split("\n")
          .reduce(
            (lines, line) =>
              lines +
              Math.max(
                1,
                Math.ceil(
                  Array.from(line).reduce(
                    (width, char) => width + (char.charCodeAt(0) > 255 ? 2 : 1),
                    0,
                  ) / 32,
                ),
              ),
            0,
          ) *
          26,
    ),
  );
  const columnWidths = Array.from({ length: columns }, (_, column) =>
    Math.max(
      360,
      ...order
        .filter((_, i) => i % columns === column)
        .map((id) => sizes[id]?.width ?? 360),
    ),
  );
  const bounds: CardBounds[] = [];
  let y = 0;
  for (let start = 0; start < order.length; start += columns) {
    const row = order.slice(start, start + columns);
    row.forEach((id, column) => {
      bounds[id] = [
        left +
          columnWidths
            .slice(0, column)
            .reduce((sum, width) => sum + width + 160, 0),
        y,
        sizes[id]?.width ?? 360,
        Math.max(heights[id], sizes[id]?.height ?? 0),
      ];
    });
    y += Math.max(...row.map((id) => bounds[id][3])) + 160;
  }
  return bounds;
}

export function aiConnectorPorts(a: CardBounds, b: CardBounds) {
  if (a[1] === b[1]) {
    // Skip-over links leave via the top instead of cutting through intervening cards.
    if (Math.abs(a[0] - b[0]) > (a[0] < b[0] ? a[2] : b[2]) + 160)
      return { source: [0.5, 0], target: [0.5, 0] };
    return a[0] < b[0]
      ? { source: [1, 0.5], target: [0, 0.5] }
      : { source: [0, 0.5], target: [1, 0.5] };
  }
  if (a[0] === b[0] && Math.abs(a[1] - b[1]) > Math.min(a[3], b[3]) + 160)
    return { source: [1, 0.5], target: [1, 0.5] };
  // Mostly side by side (a flow's columns): join the facing sides.
  const gapX = Math.max(b[0] - (a[0] + a[2]), a[0] - (b[0] + b[2]));
  const gapY = Math.max(b[1] - (a[1] + a[3]), a[1] - (b[1] + b[3]));
  if (gapX > 0 && gapX >= gapY)
    return a[0] < b[0]
      ? { source: [1, 0.5], target: [0, 0.5] }
      : { source: [0, 0.5], target: [1, 0.5] };
  return a[1] < b[1]
    ? { source: [0.5, 1], target: [0.5, 0] }
    : { source: [0.5, 0], target: [0.5, 1] };
}

/** How a set of cards is arranged; see docs/AI-CANVAS-AWARENESS-PLAN.md §5. */
export type LayoutKind = "flow" | "tree" | "hub" | "grid";
export type LayoutEdge = { from: number; to: number; label?: string };
type Size = { width: number; height: number };

const relation = (label = "") => label.trim().toLowerCase().replace(/\s+/g, " ");
/** "A part of B" and "A example of B" make B the parent of A in a tree. */
const hierarchical = (e: LayoutEdge) =>
  ["part of", "example of"].includes(relation(e.label));
/** The order an edge implies: prerequisites and causes come first. */
function ordered(e: LayoutEdge): [number, number] | undefined {
  const r = relation(e.label);
  if (r === "contrasts with") return undefined;
  if (r === "requires") return [e.to, e.from];
  if (hierarchical(e)) return [e.to, e.from];
  return [e.from, e.to];
}

function acyclic(n: number, edges: [number, number][]) {
  const indegree = Array(n).fill(0);
  for (const [, b] of edges) indegree[b]++;
  const queue = indegree.flatMap((d, i) => (d ? [] : [i]));
  let seen = 0;
  while (queue.length) {
    const node = queue.shift()!;
    seen++;
    for (const [a, b] of edges) if (a === node && --indegree[b] === 0) queue.push(b);
  }
  return seen === n;
}

/** Columns a flow may have before it reads as a strip. */
const MAX_FLOW_STEPS = 6;
/** Cards per flow column, children per tree card and cards around a hub
 * before the arrangement sprawls; larger sets use the compact grid. */
const MAX_FLOW_COLUMN = 6;
const MAX_TREE_CHILDREN = 8;
const MAX_HUB_RING = 10;

/** Whether no flow column would hold more than MAX_FLOW_COLUMN cards. */
function columnsFit(n: number, order: [number, number][]) {
  const layer: number[] = Array(n).fill(0);
  for (let pass = 0; pass < n; pass++)
    for (const [a, b] of order) layer[b] = Math.max(layer[b], layer[a] + 1);
  const linked = new Set(order.flat());
  const counts = new Map<number, number>();
  for (const i of linked) counts.set(layer[i], (counts.get(layer[i]) ?? 0) + 1);
  return Math.max(...counts.values()) <= MAX_FLOW_COLUMN;
}
/** Cards on the longest path of an acyclic order. */
function steps(n: number, order: [number, number][]) {
  const layer: number[] = Array(n).fill(0);
  for (let pass = 0; pass < n; pass++)
    for (const [a, b] of order) layer[b] = Math.max(layer[b], layer[a] + 1);
  return Math.max(...layer) + 1;
}

/**
 * Picks the arrangement the arrows describe: a tree when most of them say
 * "part of" or "example of" and each card has one parent, a hub when one
 * card holds most connections, a left-to-right flow when the order they
 * imply has no cycles, otherwise the compact grid.
 */
export function chooseLayout(
  n: number,
  edges: LayoutEdge[],
): { kind: LayoutKind; center?: number } {
  const valid = edges.filter(
    (e) => e.from !== e.to && e.from >= 0 && e.to >= 0 && e.from < n && e.to < n,
  );
  if (n <= 2 || !valid.length) return { kind: "grid" };
  const tree = valid.filter(hierarchical);
  const parents = new Map<number, Set<number>>();
  for (const e of tree)
    parents.set(e.from, new Set([...(parents.get(e.from) ?? []), e.to]));
  const children = new Map<number, number>();
  for (const e of tree) children.set(e.to, (children.get(e.to) ?? 0) + 1);
  if (
    tree.length >= 2 &&
    tree.length >= valid.length * 0.6 &&
    [...parents.values()].every((p) => p.size === 1) &&
    Math.max(...children.values()) <= MAX_TREE_CHILDREN &&
    acyclic(n, tree.map((e): [number, number] => [e.to, e.from]))
  )
    return { kind: "tree" };
  const order = valid.flatMap((e) => {
    const o = ordered(e);
    return o ? [o] : [];
  });
  // Longer chains would become a strip; the compact grid wraps them.
  const sequence =
    order.length >= 2 && acyclic(n, order) && steps(n, order) <= MAX_FLOW_STEPS;
  // A real sequence (three or more steps in a row) wins over a hub.
  if (sequence && steps(n, order) >= 3 && columnsFit(n, order))
    return { kind: "flow" };
  const degree: number[] = Array(n).fill(0);
  for (const e of valid) {
    degree[e.from]++;
    degree[e.to]++;
  }
  const center = degree.indexOf(Math.max(...degree));
  if (
    degree[center] >= 3 &&
    degree[center] >= valid.length * 0.6 &&
    n - 1 <= MAX_HUB_RING
  )
    return { kind: "hub", center };
  if (sequence && columnsFit(n, order)) return { kind: "flow" };
  return { kind: "grid" };
}

const GAP = 120;

/** Moves bounds so the group starts at (left, top). */
function normalize(bounds: CardBounds[], left: number, top: number) {
  const minX = Math.min(...bounds.map((b) => b[0]));
  const minY = Math.min(...bounds.map((b) => b[1]));
  return bounds.map(
    ([x, y, w, h]): CardBounds => [x - minX + left, y - minY + top, w, h],
  );
}

/** Cards outside the structure go in a row under it. */
function rowBelow(bounds: CardBounds[], sizes: Size[], rest: number[]) {
  if (!rest.length) return;
  const placed = bounds.filter(Boolean);
  let x = placed.length ? Math.min(...placed.map((b) => b[0])) : 0;
  const y = placed.length
    ? Math.max(...placed.map((b) => b[1] + b[3])) + GAP * 1.5
    : 0;
  for (const i of rest) {
    bounds[i] = [x, y, sizes[i].width, sizes[i].height];
    x += sizes[i].width + GAP;
  }
}

function flowLayout(sizes: Size[], edges: LayoutEdge[]): CardBounds[] {
  const order = edges.flatMap((e) => {
    const o = ordered(e);
    return o ? [o] : [];
  });
  const linked = new Set(order.flat());
  const layer = sizes.map(() => 0);
  // Longest path from the sources (the order is acyclic here).
  for (let pass = 0; pass < sizes.length; pass++)
    for (const [a, b] of order) layer[b] = Math.max(layer[b], layer[a] + 1);
  // A card with nothing before it sits just before its first dependent,
  // so a prerequisite stays next to the step that needs it.
  for (const i of linked) {
    if (order.some(([, b]) => b === i)) continue;
    const next = order.filter(([a]) => a === i).map(([, b]) => layer[b]);
    if (next.length) layer[i] = Math.max(0, Math.min(...next) - 1);
  }
  const layers: number[][] = [];
  sizes.forEach((_, i) => {
    if (linked.has(i)) (layers[layer[i]] ??= []).push(i);
  });
  const columns = layers.filter(Boolean);
  const bounds: CardBounds[] = [];
  const rank = new Map<number, number>();
  const heights = columns.map(
    (ids) =>
      ids.reduce((h, i) => h + sizes[i].height, 0) +
      GAP * 0.6 * (ids.length - 1),
  );
  const tallest = Math.max(...heights);
  let x = 0;
  columns.forEach((ids, l) => {
    // Order each column by where its predecessors sit, to reduce crossings.
    const weight = (i: number) => {
      const before = order
        .filter(([, b]) => b === i)
        .map(([a]) => rank.get(a) ?? 0);
      return before.length
        ? before.reduce((s, r) => s + r, 0) / before.length
        : 0;
    };
    ids.sort((a, b) => weight(a) - weight(b));
    let y = (tallest - heights[l]) / 2;
    ids.forEach((i, r) => {
      rank.set(i, r);
      bounds[i] = [x, y, sizes[i].width, sizes[i].height];
      y += sizes[i].height + GAP * 0.6;
    });
    // Under the 160 px a same-row arrow treats as skipping over a card.
    x += Math.max(...ids.map((i) => sizes[i].width)) + 140;
  });
  rowBelow(
    bounds,
    sizes,
    sizes.flatMap((_, i) => (linked.has(i) ? [] : [i])),
  );
  return bounds;
}

function treeLayout(sizes: Size[], edges: LayoutEdge[]): CardBounds[] {
  const children = sizes.map(() => [] as number[]);
  const hasParent = new Set<number>();
  for (const e of edges.filter(hierarchical)) {
    if (hasParent.has(e.from) || e.from === e.to) continue;
    hasParent.add(e.from);
    children[e.to].push(e.from);
  }
  const inTree = new Set([
    ...hasParent,
    ...edges.filter(hierarchical).map((e) => e.to),
  ]);
  const roots = sizes.flatMap((_, i) =>
    inTree.has(i) && !hasParent.has(i) ? [i] : [],
  );
  const depthHeight: number[] = [];
  const span = new Map<number, number>();
  const measure = (i: number, depth: number): number => {
    depthHeight[depth] = Math.max(depthHeight[depth] ?? 0, sizes[i].height);
    const kids = children[i].reduce(
      (w, c, k) => w + measure(c, depth + 1) + (k ? GAP * 0.6 : 0),
      0,
    );
    const width = Math.max(sizes[i].width, kids);
    span.set(i, width);
    return width;
  };
  roots.forEach((r) => measure(r, 0));
  const top = (depth: number) =>
    depthHeight.slice(0, depth).reduce((s, h) => s + h + GAP, 0);
  const bounds: CardBounds[] = [];
  const place = (i: number, left: number, depth: number) => {
    const width = span.get(i) ?? sizes[i].width;
    bounds[i] = [
      left + (width - sizes[i].width) / 2,
      top(depth),
      sizes[i].width,
      sizes[i].height,
    ];
    const kids = children[i].reduce(
      (w, c, k) => w + (span.get(c) ?? 0) + (k ? GAP * 0.6 : 0),
      0,
    );
    let x = left + (width - kids) / 2;
    for (const c of children[i]) {
      place(c, x, depth + 1);
      x += (span.get(c) ?? 0) + GAP * 0.6;
    }
  };
  let x = 0;
  for (const r of roots) {
    place(r, x, 0);
    x += (span.get(r) ?? 0) + GAP * 1.4;
  }
  rowBelow(
    bounds,
    sizes,
    sizes.flatMap((_, i) => (bounds[i] ? [] : [i])),
  );
  return bounds;
}

function hubLayout(
  sizes: Size[],
  edges: LayoutEdge[],
  center: number,
): CardBounds[] {
  // Cards linked to the centre first, in the order of their arrows.
  const ring = [
    ...new Set([
      ...edges.flatMap((e) =>
        e.from === center ? [e.to] : e.to === center ? [e.from] : [],
      ),
      ...sizes.map((_, i) => i),
    ]),
  ].filter((i) => i !== center);
  const maxW = Math.max(...ring.map((i) => sizes[i].width));
  const maxH = Math.max(...ring.map((i) => sizes[i].height));
  const around = ring.reduce((s, i) => s + sizes[i].width + GAP, 0);
  const rx =
    Math.max(
      sizes[center].width / 2 + maxW / 2 + GAP,
      around / (2 * Math.PI),
    ) +
    maxW / 4;
  const ry = Math.max(sizes[center].height / 2 + maxH / 2 + GAP, rx * 0.6);
  const bounds: CardBounds[] = [];
  bounds[center] = [
    -sizes[center].width / 2,
    -sizes[center].height / 2,
    sizes[center].width,
    sizes[center].height,
  ];
  ring.forEach((i, k) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * k) / ring.length;
    bounds[i] = [
      Math.cos(angle) * rx - sizes[i].width / 2,
      Math.sin(angle) * ry - sizes[i].height / 2,
      sizes[i].width,
      sizes[i].height,
    ];
  });
  return bounds;
}

/** Rough height of a new card from its text, as the grid layout estimates. */
function estimatedHeight(text: string) {
  return Math.max(
    240,
    80 +
      text
        .split("\n")
        .reduce(
          (lines, line) =>
            lines +
            Math.max(
              1,
              Math.ceil(
                Array.from(line).reduce(
                  (width, char) => width + (char.charCodeAt(0) > 255 ? 2 : 1),
                  0,
                ) / 32,
              ),
            ),
          0,
        ) *
        26,
  );
}

/** Pushes cards down until none overlap (a safety net for every layout). */
function separate(bounds: CardBounds[]) {
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (let i = 0; i < bounds.length; i++)
      for (let j = i + 1; j < bounds.length; j++) {
        const [ax, ay, aw, ah] = bounds[i];
        const [bx, by, bw, bh] = bounds[j];
        if (
          ax + aw + 40 <= bx ||
          bx + bw + 40 <= ax ||
          ay + ah + 40 <= by ||
          by + bh + 40 <= ay
        )
          continue;
        if (by >= ay) bounds[j] = [bx, ay + ah + 40, bw, bh];
        else bounds[i] = [ax, by + bh + 40, aw, ah];
        moved = true;
      }
    if (!moved) break;
  }
  return bounds;
}

/**
 * Lays out cards by the structure their arrows describe (or the given kind),
 * starting at (left, top). Sizes are exact for existing cards; new cards'
 * heights are also estimated from their text.
 */
export function layoutCards(
  texts: string[],
  edges: LayoutEdge[],
  left = 0,
  sizes: Size[] = [],
  kind: LayoutKind | "auto" = "auto",
  top = 0,
  estimate = true,
): { bounds: CardBounds[]; kind: LayoutKind } {
  const auto = chooseLayout(texts.length, edges);
  let chosen = kind === "auto" ? auto.kind : kind;
  // A requested hub needs a centre; a requested tree needs hierarchy.
  if (chosen === "tree" && !edges.some(hierarchical)) chosen = "flow";
  if (chosen === "flow" && !edges.some((e) => ordered(e))) chosen = "grid";
  if (!texts.length) return { bounds: [], kind: chosen };
  const exact = texts.map((text, i) => ({
    width: sizes[i]?.width ?? 360,
    height: estimate
      ? Math.max(sizes[i]?.height ?? 0, estimatedHeight(text))
      : (sizes[i]?.height ?? estimatedHeight(text)),
  }));
  if (chosen === "grid") {
    // The compact grid; existing cards keep their real heights.
    const grid = layoutAiCards(texts, edges, 0, exact).map(
      ([x, y, w, h], i): CardBounds => [x, y, w, estimate ? h : exact[i].height],
    );
    return { bounds: normalize(separate(grid), left, top), kind: "grid" };
  }
  const degree: number[] = texts.map(() => 0);
  for (const e of edges) {
    if (degree[e.from] !== undefined) degree[e.from]++;
    if (degree[e.to] !== undefined) degree[e.to]++;
  }
  const bounds =
    chosen === "flow"
      ? flowLayout(exact, edges)
      : chosen === "tree"
        ? treeLayout(exact, edges)
        : hubLayout(exact, edges, auto.center ?? degree.indexOf(Math.max(...degree)));
  return { bounds: normalize(separate(bounds), left, top), kind: chosen };
}
