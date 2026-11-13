/**
 * Narrows a cited website passage to the sentence(s) that support a claim.
 * Runs on the device from text Knot already has (the answer and the captured
 * passage), so it costs nothing, needs no model changes and also works for
 * older saved chats and source blocks. When no sentence clearly matches, it
 * returns null and callers keep the whole passage.
 */
export type CitedSentence = { text: string; start: number; end: number };

const STOP = new Set(
  "the and for are but not you all any can had her was one our out has have this that with from they will would there their what about which when your them than then into more some such only also its it's were been being these those other over very just most much many each both does did doing because while where who whom why how should could after before between through during under again further once here same own off yet nor too can't won't don't isn't aren't".split(
    " ",
  ),
);

/** Lowercase content words, lightly stemmed, so "reefs" matches "reef". */
export function claimTokens(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu) ?? [])
    .map((word) => word.replace(/['’]s$/, ""))
    .filter((word) => /\p{N}/u.test(word) || (word.length > 2 && !STOP.has(word)))
    .map((word) =>
      word.length > 5
        ? word.replace(/(?:ing|ed|es|s)$/, "")
        : word.length > 3
          ? word.replace(/s$/, "")
          : word,
    );
}

/** Sentence spans, also breaking at lines (list items, table rows, code). */
export function sentenceSpans(text: string): CitedSentence[] {
  const spans: CitedSentence[] = [];
  const boundary = /[.!?…。！？]+["'”’)\]]*\s+|\n+/gu;
  let start = 0;
  const push = (end: number) => {
    const raw = text.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed)
      spans.push({
        text: trimmed,
        start: start + lead,
        end: start + lead + trimmed.length,
      });
  };
  for (const match of text.matchAll(boundary)) {
    const end = match.index + match[0].trimEnd().length;
    // "e.g. this" or "3.5 m" are not sentence ends.
    const next = text[match.index + match[0].length] ?? "";
    if (match[0].includes("\n") || !/[\p{Ll}]/u.test(next)) {
      push(end);
      start = match.index + match[0].length;
    }
  }
  push(text.length);
  return spans;
}

/** Shortest passage worth narrowing; shorter ones are already precise. */
const MIN_PASSAGE = 220;

export function citedSentence(
  claim: string,
  passage: string,
): CitedSentence | null {
  if (passage.length < MIN_PASSAGE) return null;
  const spans = sentenceSpans(passage);
  if (spans.length < 2) return null;
  const want = new Set(claimTokens(claim));
  if (!want.size) return null;
  const sets = spans.map((span) => new Set(claimTokens(span.text)));
  // Words that appear in fewer sentences say more about which one is meant.
  const df = new Map<string, number>();
  for (const set of sets)
    for (const token of set) df.set(token, (df.get(token) ?? 0) + 1);
  const weight = (token: string) =>
    Math.log(1 + spans.length / (df.get(token) ?? spans.length));
  const scores = sets.map((set) => {
    let score = 0,
      shared = 0;
    for (const token of want)
      if (set.has(token)) {
        score += weight(token);
        shared++;
      }
    return { score, shared };
  });
  let best = 0;
  for (let i = 1; i < scores.length; i++)
    if (scores[i].score > scores[best].score) best = i;
  const top = scores[best];
  const needed = Math.min(2, want.size);
  if (top.shared < needed || top.score <= 0) return null;
  // A tie means the claim doesn't single out one sentence.
  if (
    scores.some(
      (s, i) => i !== best && Math.abs(i - best) > 1 && s.score >= top.score,
    )
  )
    return null;
  let first = best,
    last = best;
  // Claims often draw on two neighbouring sentences.
  for (const i of [best - 1, best + 1]) {
    const s = scores[i];
    if (!s || s.shared < needed || s.score < top.score * 0.6) continue;
    const adds = [...sets[i]].some(
      (token) => want.has(token) && !sets[best].has(token),
    );
    if (!adds) continue;
    if (i < best) first = i;
    else last = i;
    break;
  }
  const start = spans[first].start,
    end = spans[last].end;
  return { text: passage.slice(start, end), start, end };
}

const MARKER = /\[S\d+\]/g;

/**
 * The answer sentences that cite `marker`, without any citation markers.
 * A marker usually follows the claim; at the start of a sentence it leads it.
 */
export function claimsFor(answer: string, marker: string): string {
  const claims: string[] = [];
  const spans = sentenceSpans(answer);
  spans.forEach((span, i) => {
    if (!span.text.includes(marker)) return;
    // "Claim. [S1] Next" puts the marker after the sentence it supports.
    if (span.text.startsWith(marker) && i > 0) claims.push(spans[i - 1].text);
    const rest = span.text.replace(/^(?:\[S\d+\]\s*)+/, "");
    if (rest.includes(marker) || !span.text.startsWith(marker) || i === 0)
      claims.push(span.text);
  });
  return claims.join(" ").replace(MARKER, " ");
}
