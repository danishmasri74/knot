import type { CitationSource } from "./web-source-types";

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
            (source.kind === "web" &&
              typeof source.captureId === "string" &&
              typeof source.sectionId === "string" &&
              typeof source.ref === "string")),
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
