/**
 * "Break this into ideas": a long canvas card is replaced by one-idea cards
 * with typed arrows. These helpers stay free of the editor so they can be
 * unit tested.
 */

/** Arrow labels the atomize request may use, each with its own color. */
export const ATOMIZE_RELATIONS = {
  "leads to": { light: "#2f6fd6", dark: "#7aa8f5" },
  causes: { light: "#d2691e", dark: "#f0a060" },
  requires: { light: "#7b4fd0", dark: "#b49af2" },
  "part of": { light: "#2f8a4a", dark: "#78cf8f" },
  "example of": { light: "#13838a", dark: "#5fcbd1" },
  "contrasts with": { light: "#c23b4e", dark: "#f0828f" },
} as const;

/** The stroke for an arrow whose label is one of the relation types. */
export function relationStroke(label: string) {
  const key = label.trim().toLowerCase().replace(/\s+/g, " ");
  return key in ATOMIZE_RELATIONS
    ? ATOMIZE_RELATIONS[key as keyof typeof ATOMIZE_RELATIONS]
    : undefined;
}

const STOP = new Set(
  "about above after again against also among because been before being below between both but cannot could does doing down during each from further have having here into itself just more most must only other over same should some such than that their theirs them then there these they this those through under until very were what when where which while whom will with would your".split(
    " ",
  ),
);

/** Lowercase content words, crudely stemmed, for coverage matching. */
function words(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((w) => (w.length >= 4 || /\d/.test(w)) && !STOP.has(w))
    .map((w) => w.replace(/(ing|ed|es|s)$/u, "") || w);
}

/**
 * Source passages (sentences and list items) whose content the generated
 * cards don't carry: under half of a passage's distinctive words appear
 * anywhere in them. Very short passages are skipped. A heuristic: it finds
 * dropped details, it doesn't prove that kept ones are faithful.
 */
export function uncoveredPassages(
  source: string[],
  generated: string[],
): string[] {
  const kept = new Set(generated.flatMap(words));
  const seen = new Set<string>();
  return source
    .flatMap((text) =>
      text
        .split(/\n+|(?<=[.!?。！？])\s+/u)
        .map((part) => part.trim())
        .filter(Boolean),
    )
    .filter((passage) => {
      const unique = [...new Set(words(passage))];
      if (unique.length < 3 || seen.has(passage)) return false;
      seen.add(passage);
      return unique.filter((w) => kept.has(w)).length / unique.length < 0.5;
    });
}

export type Box = [x: number, y: number, w: number, h: number];

/** Bounds of size w×h at (x, y), moved down past anything in the way. */
export function clearPlacement(
  x: number,
  y: number,
  occupied: Box[],
  [w, h]: [number, number],
  gap = 40,
): Box {
  for (let tries = 0; tries < 100; tries++) {
    const hits = occupied.filter(
      (b) =>
        x < b[0] + b[2] + gap &&
        x + w + gap > b[0] &&
        y < b[1] + b[3] + gap &&
        y + h + gap > b[1],
    );
    if (!hits.length) return [x, y, w, h];
    y = Math.max(...hits.map((b) => b[1] + b[3])) + gap * 1.5;
  }
  return [Math.max(0, ...occupied.map((b) => b[0] + b[2] + 80)), y, w, h];
}
