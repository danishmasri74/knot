import type { CitationSource, LinkCitation } from "./web-source-types";

export function readCitationSources(context?: string): CitationSource[] {
  try {
    const data = JSON.parse(context ?? "{}");
    if (Array.isArray(data.citationSources))
      return data.citationSources.filter(
        (source: CitationSource) =>
          source &&
          typeof source.document === "string" &&
          typeof source.id === "string" &&
          typeof source.text === "string" &&
          (source.kind === undefined ||
            source.kind === "note" ||
            (source.kind === "link" &&
              typeof source.url === "string" &&
              /^https?:\/\//.test(source.url)) ||
            (source.kind === "web" &&
              typeof source.captureId === "string" &&
              typeof source.sectionId === "string" &&
              typeof source.ref === "string") ||
            (source.kind === "video" &&
              typeof source.video?.videoId === "string" &&
              typeof source.video.start === "number") ||
            (source.kind === "image" &&
              typeof source.image?.blockId === "string" &&
              typeof source.image.key === "string")),
      );
    return [data, ...(data.addedNotes ?? [])].flatMap((source) =>
      (source.structure ?? []).map((block: { id: string; text: string }) => ({
        ...block,
        document: source.document,
        title: source.title,
      })),
    );
  } catch {
    return [];
  }
}

/** Freeze an explicit source table; the model must never count nested blocks. */
export function withCitationSources(context: string): string {
  const data = JSON.parse(context);
  const sources = readCitationSources(context);
  return JSON.stringify({
    ...data,
    citationSources: sources.map((source, index) => ({
      ...source,
      citation: `[S${index + 1}]`,
    })),
  });
}

/** Drops OpenAI's tracking parameter from a cited link. */
function cleanUrl(url: string) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("utm_source");
    return parsed.toString();
  } catch {
    return url;
  }
}
function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
/**
 * Turns the links OpenAI's web search put in an answer into [Sn] markers,
 * numbered after the message's other sources, and returns the cited links.
 * Annotation offsets are used when they point at the link; otherwise the
 * Markdown link to the same URL is found. A link with neither is listed at
 * the end so it is still shown as a source.
 */
export function linkCitations(
  text: string,
  annotations: { url: string; title?: string; start?: number; end?: number }[],
  after: number,
): { text: string; links: LinkCitation[] } {
  const links: LinkCitation[] = [];
  const cite = (url: string, title?: string) => {
    const clean = cleanUrl(url);
    let link = links.find((item) => item.url === clean);
    if (!link) {
      const label = title?.trim() || hostOf(clean);
      link = {
        kind: "link",
        document: "",
        id: clean,
        url: clean,
        title: label,
        text: label,
        citation: `[S${after + links.length + 1}]`,
      };
      links.push(link);
    }
    return link.citation!;
  };
  const spans: { start: number; end: number; citation: string }[] = [];
  const unplaced: string[] = [];
  for (const annotation of annotations) {
    const citation = cite(annotation.url, annotation.title);
    let { start, end } = annotation;
    const slice =
      Number.isInteger(start) &&
      Number.isInteger(end) &&
      start! >= 0 &&
      end! <= text.length &&
      start! < end!
        ? text.slice(start, end)
        : "";
    if (
      !slice.includes(annotation.url) &&
      !slice.includes(hostOf(annotation.url))
    ) {
      // The first Markdown link to this URL not already replaced.
      const marker = `](${annotation.url})`;
      let found: { start: number; end: number } | undefined;
      for (
        let at = text.indexOf(marker);
        at >= 0;
        at = text.indexOf(marker, at + 1)
      ) {
        const open = text.lastIndexOf("[", at);
        const candidate = { start: open, end: at + marker.length };
        if (
          open >= 0 &&
          !spans.some(
            (span) => candidate.start < span.end && candidate.end > span.start,
          )
        ) {
          found = candidate;
          break;
        }
      }
      if (!found) {
        if (!unplaced.includes(citation)) unplaced.push(citation);
        continue;
      }
      ({ start, end } = found);
    }
    if (spans.some((span) => start! < span.end && end! > span.start)) continue;
    spans.push({ start: start!, end: end!, citation });
  }
  let result = text;
  for (const span of spans.sort((a, b) => b.start - a.start)) {
    const before = result.slice(0, span.start).replace(/\s+$/, "");
    result = `${before} ${span.citation}${result.slice(span.end)}`;
  }
  // "([site](url))" leaves "( [S3])" once its link is replaced.
  result = result.replace(/\(\s*(\[S\d+\])\s*\)/g, "$1");
  const placed = new Set(spans.map((span) => span.citation));
  const rest = unplaced.filter((citation) => !placed.has(citation));
  if (rest.length) result = `${result.trimEnd()} ${rest.join(" ")}`;
  return { text: result, links };
}
