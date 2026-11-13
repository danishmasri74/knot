import { readCitationSources } from "./ai-citations";
import type { WebCitation, WebEvidence } from "./web-source-types";
import { normalizeWebUrl } from "./web-sources";

export type SourceRefs = { sourceRefs?: string[] };
export function validateSourceRefs(
  proposal: {
    blocks: (SourceRefs & { children?: SourceRefs[] })[];
    connections?: SourceRefs[];
    mindmap?: SourceRefs[];
  },
  context?: string,
) {
  const sources = readCitationSources(context);
  const known = new Set(
    sources.filter((s): s is WebCitation => s.kind === "web").map((s) => s.ref),
  );
  for (const content of [
    ...proposal.blocks.flatMap((b) => [b, ...(b.children ?? [])]),
    ...(proposal.connections ?? []),
    ...(proposal.mindmap ?? []),
  ]) {
    if (content.sourceRefs === undefined && !known.size) continue;
    if (
      !Array.isArray(content.sourceRefs) ||
      content.sourceRefs.length > 400 ||
      content.sourceRefs.some(
        (ref) => typeof ref !== "string" || !known.has(ref),
      )
    )
      throw new Error(
        "The proposal contains missing or unknown web evidence. Request a new proposal.",
      );
  }
}
export function webProvenance(context: string | undefined, refs: string[]) {
  if (!refs.length) return [];
  const data = JSON.parse(context ?? "{}");
  const sources = readCitationSources(context).filter(
    (s): s is WebCitation => s.kind === "web" && refs.includes(s.ref),
  );
  if (new Set(sources.map((s) => s.ref)).size !== new Set(refs).size)
    throw new Error("Source evidence is unavailable.");
  return (data.webEvidence as WebEvidence[]).flatMap((e) => {
    const sections = sources.filter((s) => s.captureId === e.captureId);
    if (!sections.length) return [];
    if (
      !normalizeWebUrl(e.finalUrl) ||
      !normalizeWebUrl(e.requestedUrl) ||
      e.version !== 1
    )
      throw new Error("Invalid source provenance.");
    const record = {
      ...e,
      omitted: [
        ...new Set([
          ...e.omitted,
          ...readCitationSources(context)
            .filter(
              (s): s is WebCitation =>
                s.kind === "web" &&
                s.captureId === e.captureId &&
                !refs.includes(s.ref),
            )
            .map((s) => s.sectionId),
        ]),
      ],
      sections: sections.map((s) => ({
        id: s.sectionId,
        text: s.text,
        citation: s.citation,
        headings: s.headings,
        kind: s.contentKind,
        ...(s.page && { page: s.page }),
      })),
    };
    if (
      record.omitted.length &&
      !record.warnings.includes(
        "Supporting excerpts only; other captured sections are not stored here.",
      )
    )
      record.warnings = [
        ...record.warnings,
        "Supporting excerpts only; other captured sections are not stored here.",
      ];
    if (new TextEncoder().encode(JSON.stringify(record)).length > 170_000)
      throw new Error("Source evidence exceeds the storage limit.");
    return [record];
  });
}
export type DurableWebSource = ReturnType<typeof webProvenance>[number];
export function readDurableWebSource(value: string): DurableWebSource | null {
  try {
    if (value.length > 170_000) return null;
    const source = JSON.parse(value) as DurableWebSource;
    if (
      source.version !== 1 ||
      !normalizeWebUrl(source.finalUrl) ||
      !normalizeWebUrl(source.requestedUrl) ||
      ![
        source.sourceId,
        source.captureId,
        source.title,
        source.fetchedAt,
        source.method,
        source.contentHash,
        source.contentType,
      ].every((value) => typeof value === "string") ||
      !Array.isArray(source.warnings) ||
      source.warnings.some((value) => typeof value !== "string") ||
      !Array.isArray(source.omitted) ||
      source.omitted.some((value) => typeof value !== "string") ||
      !Array.isArray(source.sections) ||
      source.sections.length > 400 ||
      source.sections.some(
        (s) => typeof s.text !== "string" || typeof s.id !== "string",
      )
    )
      return null;
    return source;
  } catch {
    return null;
  }
}
