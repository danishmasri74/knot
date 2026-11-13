import { readCitationSources } from "./ai-citations";
import { readDurableWebSource } from "./web-ai-evidence";
import {
  WEB_LIMITS,
  type WebAttempt,
  type WebEvidence,
  type WebCitation,
  type CitationSource,
} from "./web-source-types";

const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length;
export const evidenceRef = (captureId: string, sectionId: string) =>
  `${captureId}/${sectionId}`;

/** Shared by ordinary requests and card suggestions. Never repeats web passage text. */
export function composeAiContext(
  context: string,
  attempts: WebAttempt[] = [],
  prompt = "",
) {
  const data = JSON.parse(context);
  // Native source children remain evidence when a saved card is reused or improved.
  const stored: WebAttempt[] = [];
  const stripStored = (block: { webSource?: string; text: string }) => {
    if (!block.webSource) return;
    const source = readDurableWebSource(block.webSource);
    if (!source)
      throw new Error(
        "A saved website source is invalid. Repair or remove it before generating.",
      );
    stored.push({
      id: source.sourceId,
      url: source.requestedUrl,
      state: source.warnings.length ? "partial" : "ready",
      capture: {
        ...source,
        sections: source.sections.map((section) => ({
          id: section.id,
          text: section.text,
          headings: section.headings ?? [],
          kind: section.kind ?? "text",
        })),
      },
    });
    // Remove duplicated source text from the ordinary note/context tables.
    if (typeof data.text === "string")
      data.text = data.text.replace(block.text, "Retained website evidence");
    block.text = "Retained website evidence";
    delete block.webSource;
  };
  for (const block of [
    ...(data.structure ?? []),
    ...(data.addedNotes ?? []).flatMap(
      (note: { structure?: unknown[] }) => note.structure ?? [],
    ),
    ...(data.citationSources ?? []),
  ])
    stripStored(block);
  const combined = new Map<string, WebAttempt>();
  for (const attempt of [
    ...attempts,
    ...retainedWebAttempts(context),
    ...stored,
  ]) {
    const key = attempt.id;
    const previous = combined.get(key);
    if (
      previous?.capture &&
      attempt.capture &&
      previous.capture.captureId === attempt.capture.captureId
    ) {
      const sections = new Map(previous.capture.sections.map((s) => [s.id, s]));
      for (const section of attempt.capture.sections)
        sections.set(section.id, section);
      combined.set(key, {
        ...previous,
        capture: { ...previous.capture, sections: [...sections.values()] },
      });
    } else if (!previous) combined.set(key, attempt);
  }
  attempts = [...combined.values()];
  const citationSources: CitationSource[] = readCitationSources(context).filter(
    (s) => (s.kind === undefined || s.kind === "note") && !s.webSource,
  );
  for (const source of [
    ...(data.structure ?? []),
    ...(data.addedNotes ?? []).flatMap(
      (note: { structure?: unknown[] }) => note.structure ?? [],
    ),
  ])
    if (source.text === "Retained website evidence")
      source.text = "Website excerpts are in citationSources.";
  const webEvidence: WebEvidence[] = [];
  const seen = new Set<string>();
  for (const attempt of attempts) {
    const capture = attempt.capture;
    if (
      !capture ||
      !["ready", "partial"].includes(attempt.state) ||
      seen.has(capture.contentHash)
    )
      continue;
    seen.add(capture.contentHash);
    webEvidence.push({
      ...capture,
      sections: [],
      omitted: [
        ...new Set([
          ...(capture.omitted ?? []),
          ...capture.sections.map((s) => s.id),
        ]),
      ],
    });
  }
  const webOutcomes = attempts.map((a) => ({
    sourceId: a.id,
    url: a.url,
    state: a.state,
    reason: a.reason,
    captureId: a.capture?.captureId,
  }));
  const result = { ...data, citationSources, webEvidence, webOutcomes };
  const readable = attempts.filter(
    (a) => a.capture && ["ready", "partial"].includes(a.state),
  );
  if (attempts.length && !readable.length)
    throw new Error(
      "None of the websites could be read. Retry a source, open it externally, or remove the URLs to ask a general question.",
    );
  const terms = new Set(
    prompt.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [],
  );
  const queues = webEvidence.map((e) => {
    const capture = readable.find(
      (a) => a.capture?.captureId === e.captureId,
    )!.capture!;
    return capture.sections
      .map((section, index) => ({
        section,
        index,
        score: [...terms].filter((t) =>
          `${section.headings.join(" ")} ${section.text}`
            .toLocaleLowerCase()
            .includes(t),
        ).length,
      }))
      .sort((a, b) => b.score - a.score || a.index - b.index);
  });
  // Round-robin guarantees minimum coverage of every distinct readable source.
  for (let round = 0; queues.some((q) => q.length); round++) {
    for (let index = 0; index < queues.length; index++) {
      const item = queues[index].shift();
      if (!item) continue;
      const evidence = webEvidence[index];
      const citation: WebCitation = {
        kind: "web",
        document: evidence.sourceId,
        id: item.section.id,
        text: item.section.text,
        title: evidence.title,
        captureId: evidence.captureId,
        sectionId: item.section.id,
        headings: item.section.headings,
        contentKind: item.section.kind,
        ...(item.section.page && { page: item.section.page }),
        ref: evidenceRef(evidence.captureId, item.section.id),
      };
      // Keep passage text only in citationSources; evidence sections record inclusion IDs below.
      citationSources.push(citation);
      evidence.omitted = evidence.omitted.filter(
        (id) => id !== item.section.id,
      );
      if (bytes(result) > WEB_LIMITS.contextBytes) {
        citationSources.pop();
        evidence.omitted.push(item.section.id);
        queues[index] = [];
        if (round === 0)
          throw new Error(
            "There is not enough context space for every website. Choose fewer URLs or No notes.",
          );
      }
    }
  }
  for (const evidence of webEvidence) {
    if (
      evidence.omitted.length &&
      !evidence.warnings.includes(
        "Selected sections only; narrow your request for fuller coverage.",
      )
    )
      evidence.warnings = [
        ...evidence.warnings,
        "Selected sections only; narrow your request for fuller coverage.",
      ];
  }
  result.citationSources = citationSources.map((source, index) => ({
    ...source,
    citation: `[S${index + 1}]`,
  }));
  dropCoveredCopies(result);
  if (bytes(result) > 180_000)
    throw new Error(
      "The selected sources exceed the request limit. Choose fewer sources or No notes.",
    );
  return JSON.stringify(result);
}

/**
 * The frozen citation table already holds every note block. Drop the
 * duplicate `structure` lists and plain `text` it fully covers, so saved
 * chats and the request limit only count each block once. Text that no block
 * contains (for example unstructured canvas text) is kept.
 */
export function dropCoveredCopies(data: {
  document?: unknown;
  text?: unknown;
  structure?: unknown;
  addedNotes?: unknown;
  citationSources: CitationSource[];
}) {
  const notes = data.citationSources.filter((s) => s.kind !== "web");
  if (!notes.length) return;
  // Block IDs are only unique within a document.
  const key = (document: unknown, id: unknown) => `${document}\u0000${id}`;
  const keys = new Set(notes.map((s) => key(s.document, s.id)));
  const covered = (blocks: unknown, document: unknown) =>
    Array.isArray(blocks) &&
    blocks.length > 0 &&
    blocks.every(
      (b: { id?: unknown }) =>
        typeof b?.id === "string" && keys.has(key(document, b.id)),
    );
  if (covered(data.structure, data.document)) delete data.structure;
  if (Array.isArray(data.addedNotes))
    for (const note of data.addedNotes as {
      document?: unknown;
      structure?: unknown;
    }[])
      if (covered(note.structure, note.document)) delete note.structure;
  const lines = new Set(
    notes.flatMap((s) => s.text.split("\n").map((l) => l.trim())),
  );
  if (
    typeof data.text === "string" &&
    data.text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .every((l) => lines.has(l))
  )
    delete data.text;
}

/** Restore bounded selected passages without refetching on chat reopen/continuation. */
export function retainedWebAttempts(context?: string): WebAttempt[] {
  try {
    const data = JSON.parse(context ?? "{}");
    return (data.webEvidence ?? []).map((e: WebEvidence) => ({
      id: e.sourceId,
      url: e.requestedUrl,
      state: e.warnings.length ? "partial" : "ready",
      capture: {
        ...e,
        sections: readCitationSources(context)
          .filter(
            (s): s is WebCitation =>
              s.kind === "web" && s.captureId === e.captureId,
          )
          .map((s) => ({
            id: s.sectionId,
            text: s.text,
            kind: s.contentKind ?? "text",
            headings: s.headings ?? [],
          })),
      },
    }));
  } catch {
    return [];
  }
}
