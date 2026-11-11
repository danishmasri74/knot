import type { TopicPassage, TopicSearch, TopicEvidence } from "./topic-types";
export function localRelevance(
  query: string,
  p: TopicPassage,
  vector: number[],
) {
  const identifiers = query
    .split(/\s+/)
    .filter((word) => /[a-z]/i.test(word) && /[0-9]/.test(word))
    .map((word) =>
      word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").toLowerCase(),
    );
  if (
    identifiers.length &&
    !identifiers.some(
      (id) =>
        p.text.toLowerCase().includes(id) || p.title.toLowerCase().includes(id),
    )
  )
    return false;
  const boilerplate = new Set([
    "what",
    "how",
    "notes",
    "about",
    "the",
    "are",
    "and",
    "can",
    "does",
    "tell",
    "with",
    "from",
    "this",
    "that",
    "please",
    "explain",
    "describe",
    "for",
    "say",
    "you",
    "its",
    "could",
    "would",
    "should",
    "which",
    "where",
    "when",
    "why",
  ]);
  const lexical = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((word) => word.length > 2 && !boilerplate.has(word))
    .some((word) => p.text.toLowerCase().includes(word));
  return (
    lexical ||
    (vector.length === 384 &&
      p.vector.reduce((n, v, i) => n + v * vector[i], 0) >= 0.8)
  );
}
export function budgetEvidence(
  passages: TopicPassage[],
  activation: string,
  report: Omit<TopicSearch, "passages">,
  semantic: boolean,
  tokenLimit = 4000,
): TopicEvidence {
  const citationSources: TopicEvidence["citationSources"] = [];
  let bytes = 0;
  const seen = new Set<string>();
  const perSource = new Map<string, number>(),
    primary: TopicPassage[] = [],
    deferred: TopicPassage[] = [];
  for (const passage of passages) {
    const count = perSource.get(passage.document) ?? 0;
    if (count < 3) {
      primary.push(passage);
      perSource.set(passage.document, count + 1);
    } else deferred.push(passage);
  }
  for (const p of [...primary, ...deferred]) {
    // Exact text collapse only. Negation/numbers/conditions are never normalized away.
    const duplicateKey = `${p.text}\0${p.attribution ?? ""}`;
    if (seen.has(duplicateKey)) continue;
    const { vector, ...source } = p;
    void vector;
    const size = new TextEncoder().encode(JSON.stringify(source)).length;
    // UTF-8 bytes are a conservative token upper bound, also for non-Latin text.
    if (bytes + size > tokenLimit) continue;
    bytes += size;
    seen.add(duplicateKey);
    citationSources.push({
      ...source,
      citation: `[S${citationSources.length + 1}]`,
    });
  }
  return {
    version: 1,
    sourceMode: "workspace",
    activation,
    coverage: {
      indexed: report.indexed,
      total: report.total,
      failed: report.failed,
      semantic,
    },
    citationSources,
  };
}
