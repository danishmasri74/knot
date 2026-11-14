import { readCitationSources } from "./ai-citations";
import type { AiPdfSource } from "./pdf-input";
import type { VideoLocation } from "./youtube-transcript";

/**
 * What a user deliberately sent with a message, shown as chips above it in
 * Ask Knot. Stored with the message so chips survive reopening; each entry
 * keeps only a label and where to open it, never the source content.
 */
export type SentAttachment = {
  kind:
    | "note"
    | "selection"
    | "canvas"
    | "excerpt"
    | "pdf"
    | "video"
    | "web"
    | "image"
    | "file";
  label: string;
  /** Short secondary text: "Selection", "p. 4", a website's host. */
  detail?: string;
  /** The note an excerpt came from, shown in the chip's tooltip. */
  from?: string;
  document?: string;
  block?: string;
  /** Start of the block's text, so Open source can verify it. */
  text?: string;
  pdf?: AiPdfSource;
  video?: VideoLocation;
  url?: string;
  image?: { key: string; name: string };
};

type Block = { id: string; text: string };
const MAX_TEXT = 160;
const short = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};
const anchor = (block?: Block) =>
  block?.text.trim()
    ? { block: block.id, text: block.text.trim().slice(0, MAX_TEXT) }
    : {};
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** The open note, selection, canvas text or PDF the message was sent with. */
export type SentContext = {
  label: string;
  title?: string;
  document?: string;
  first?: Block;
  pdf?: AiPdfSource;
  selectionKind?: "website" | "file";
  canvas?: boolean;
  /** Blocks selected as whole objects. */
  blocks?: string[];
};

export function sentAttachments(parts: {
  context?: SentContext;
  passages?: { document: string; title: string; block: Block }[];
  notes?: { document: string; title: string; first?: Block }[];
  image?: { key: string; name: string };
  web?: { url: string; title?: string }[];
  videos?: VideoLocation[];
}): SentAttachment[] {
  const result: SentAttachment[] = [];
  // A selected YouTube card is listed once, as its video.
  const context =
    parts.context?.blocks?.length &&
    parts.context.blocks.every((id) =>
      parts.videos?.some((video) => video.blockId === id),
    )
      ? undefined
      : parts.context;
  if (context) {
    const generic = ["Page", "Focused note", "Selection", "Canvas text"];
    const label =
      generic.includes(context.label) && context.title
        ? context.title
        : context.label;
    const kind: SentAttachment["kind"] = context.pdf
      ? "pdf"
      : context.selectionKind === "website"
        ? "web"
        : context.selectionKind === "file"
          ? "file"
          : context.label === "Selection"
            ? "selection"
            : context.canvas || context.label === "Canvas text"
              ? "canvas"
              : "note";
    result.push({
      kind,
      label: short(label || "Page", 80),
      ...(kind === "selection" && { detail: "Selection" }),
      ...(kind === "pdf" &&
        context.pdf?.page && { detail: `p. ${context.pdf.page}` }),
      ...(context.document && { document: context.document }),
      ...(context.pdf ? { pdf: context.pdf } : anchor(context.first)),
    });
  }
  for (const passage of parts.passages ?? [])
    result.push({
      kind: "excerpt",
      label: `“${short(passage.block.text, 40)}”`,
      from: short(passage.title || "Untitled", 80),
      document: passage.document,
      ...anchor(passage.block),
    });
  for (const note of parts.notes ?? [])
    result.push({
      kind: "note",
      label: short(note.title || "Untitled", 80),
      document: note.document,
      ...anchor(note.first),
    });
  if (parts.image)
    result.push({
      kind: "image",
      label: short(parts.image.name || "Image", 80),
      image: parts.image,
    });
  const seenVideos = new Set<string>();
  for (const video of parts.videos ?? []) {
    const key = `${video.documentId}:${video.blockId}`;
    if (seenVideos.has(key)) continue;
    seenVideos.add(key);
    result.push({
      kind: "video",
      label: short(video.title || "YouTube video", 80),
      video: { ...video, start: 0 },
    });
  }
  const seenUrls = new Set<string>();
  for (const page of parts.web ?? []) {
    if (seenUrls.has(page.url)) continue;
    seenUrls.add(page.url);
    result.push({
      kind: "web",
      label: short(page.title?.trim() || host(page.url), 80),
      ...(page.title?.trim() && { detail: host(page.url) }),
      url: page.url,
    });
  }
  return result;
}

/**
 * Chips for messages saved before attachments were recorded, read back from
 * the frozen request context. Best effort: anything unreadable is skipped.
 */
export function legacyAttachments(request: {
  context: string;
  sourceMode?: string;
  pdfSource?: AiPdfSource;
  image?: { key: string; name: string };
}): SentAttachment[] {
  if (request.sourceMode === "workspace") return [];
  let data: {
    scope?: string;
    title?: string;
    document?: string;
    sourceType?: string;
    structure?: Block[];
    addedNotes?: { document: string; title: string; structure?: Block[] }[];
  };
  try {
    data = JSON.parse(request.context);
  } catch {
    return [];
  }
  if (!data || typeof data !== "object") return [];
  const scope = typeof data.scope === "string" ? data.scope : "";
  const videos: VideoLocation[] = [];
  const web: { url: string; title?: string }[] = [];
  // Saved requests may keep each block only in the citation table.
  const firstBlock = new Map<string, Block>();
  for (const source of readCitationSources(request.context)) {
    if (source.kind === "video") videos.push(source.video);
    else if (source.kind === "web") {
      if (source.url) web.push({ url: source.url, title: source.title });
    } else if (source.kind !== "link" && !firstBlock.has(source.document))
      firstBlock.set(source.document, { id: source.id, text: source.text });
  }
  const first = (document?: string, structure?: Block[]) =>
    structure?.[0] ?? (document ? firstBlock.get(document) : undefined);
  const contextFirst = first(data.document, data.structure);
  const hasContext =
    !!scope &&
    !["Explicit attachments only", "Inherited selected sources"].includes(
      scope,
    ) &&
    (!!contextFirst || !!request.pdfSource);
  return sentAttachments({
    context: hasContext
      ? {
          label: scope,
          title: data.title,
          document: data.document,
          first: contextFirst,
          pdf: data.sourceType === "pdf" ? request.pdfSource : undefined,
        }
      : undefined,
    notes: (Array.isArray(data.addedNotes) ? data.addedNotes : []).map(
      (note) => ({
        document: note.document,
        title: note.title,
        first: first(note.document, note.structure),
      }),
    ),
    image: request.image,
    videos,
    web,
  });
}
