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
  return a[1] < b[1]
    ? { source: [0.5, 1], target: [0.5, 0] }
    : { source: [0.5, 0], target: [0.5, 1] };
}
