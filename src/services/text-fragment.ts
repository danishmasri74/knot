/**
 * Builds a scroll-to-text link (`#:~:text=`) that opens a website at a cited
 * passage. Browsers without support, or pages whose text no longer matches,
 * simply open the page, so the link is never worse than the plain address.
 *
 * Captured passages can join several page elements (table cells are joined
 * with " | ", list and code lines with newlines). A text directive term must
 * sit inside one element, so the start term comes from the first piece and the
 * end term from the last; the browser matches the range between them.
 */
const TERM_WORDS = 5;
const SHORT_WORDS = 10;
const TERM_CHARS = 80;

const encodeTerm = (term: string) =>
  encodeURIComponent(term).replace(/[-,&]/g, (c) =>
    c === "-" ? "%2D" : c === "," ? "%2C" : "%26",
  );

function capWords(words: string[]) {
  const kept: string[] = [];
  let length = 0;
  for (const word of words) {
    if (kept.length && length + word.length + 1 > TERM_CHARS) break;
    kept.push(word);
    length += word.length + 1;
  }
  return kept;
}

export function textDirective(passage: string): string | null {
  const pieces = passage
    .split(/\n| \| /)
    .map((piece) => piece.trim().split(/\s+/).filter(Boolean))
    .filter((words) => words.length);
  if (!pieces.length) return null;
  const first = pieces[0];
  const last = pieces[pieces.length - 1];
  if (
    pieces.length === 1 &&
    first.length <= SHORT_WORDS &&
    first.join(" ").length <= TERM_CHARS * 2
  )
    return encodeTerm(first.join(" "));
  const start = capWords(first.slice(0, TERM_WORDS));
  const end = capWords([...last.slice(-TERM_WORDS)].reverse()).reverse();
  if (!start.length || !end.length) return null;
  return `${encodeTerm(start.join(" "))},${encodeTerm(end.join(" "))}`;
}

/** Returns `url` with a text fragment for `passage`, or `url` unchanged. */
export function passageUrl(url: string, passage: string | undefined): string {
  const directive = passage ? textDirective(passage) : null;
  if (!url || !directive) return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return url;
    // Keep an existing element anchor; replace any earlier directive.
    const anchor = parsed.hash.replace(/^#/, "").split(":~:")[0];
    parsed.hash = "";
    return `${parsed.href}#${anchor}:~:text=${directive}`;
  } catch {
    return url;
  }
}
