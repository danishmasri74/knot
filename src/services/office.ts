import { invoke } from "@tauri-apps/api/core";

// Slide decks (.pptx) and Word documents (.docx) get a PDF copy made by the
// person's own PowerPoint or Word, or LibreOffice, then behave like PDFs.
// The copy keeps the original's name, so a PDF named "….pptx" is a slide
// deck and one named "….docx" is a Word document everywhere it is shown.

export type OfficeKind = "slides" | "document";

export const SLIDES_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
export const DOCUMENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const extensions: Record<OfficeKind, string> = {
  slides: "pptx",
  document: "docx",
};

/** What a file (or its PDF copy) is, by its file name. */
export function officeKind(name: unknown): OfficeKind | undefined {
  if (typeof name !== "string") return undefined;
  const match = /\.(pptx|docx)$/i.exec(name.trim());
  if (!match) return undefined;
  return match[1].toLowerCase() === "pptx" ? "slides" : "document";
}

/** A PDF made from a slide deck, or the deck itself, by its file name. */
export function isSlidesName(name: unknown): boolean {
  return officeKind(name) === "slides";
}

/** An Office attachment that hasn't been converted yet, and its kind. */
export function unconvertedOffice(
  type: unknown,
  name: unknown,
): OfficeKind | undefined {
  if (type === SLIDES_TYPE) return "slides";
  if (type === DOCUMENT_TYPE) return "document";
  return type === "application/pdf" ? undefined : officeKind(name);
}

/** "slide 3" for slide decks, "p. 3" for documents and other PDFs. */
export function pageLabel(name: unknown, page: number): string {
  return isSlidesName(name) ? `slide ${page}` : `p. ${page}`;
}

/** A file's display name, without its Office extension. */
export function officeTitle(name: string, kind: OfficeKind): string {
  const pattern = new RegExp(`\\.${extensions[kind]}$`, "i");
  return (
    name.trim().replace(pattern, "") ||
    (kind === "slides" ? "Slides" : "Document")
  );
}

/** The person's app for each kind, as shown in the reader. */
export const officeApp: Record<OfficeKind, string> = {
  slides: "PowerPoint",
  document: "Word",
};

export type OfficeConverter = "powerpoint" | "word" | "libreoffice";
export type OfficeOutcome =
  | { status: "converted"; pdf: number[]; converter: OfficeConverter }
  | { status: "missing" }
  | { status: "failed"; reason: string };

export const office = {
  convert: (key: string, kind: OfficeKind) =>
    invoke<OfficeOutcome>("convert_office", { key, kind }),
  openOriginal: (key: string, name: string, kind: OfficeKind) =>
    invoke<void>("open_office_original", { key, name, kind }),
};

/** Stored on a converted card's block: the original file and what converted
 * it. Decks keep their 0.6.3 names so older Knot still treats them as decks;
 * documents use their own, so older Knot shows them as plain PDFs. */
export const originalProps: Record<
  OfficeKind,
  { source: string; converter: string }
> = {
  slides: { source: "prop:slidesSourceId", converter: "prop:slidesConverter" },
  document: {
    source: "prop:officeSourceId",
    converter: "prop:officeConverter",
  },
};

/** What's happening to an unconverted file this session, by its file key. */
export type OfficeJob =
  | { state: "converting" }
  | { state: "missing" }
  | { state: "failed"; reason: string };

const jobs = new Map<string, OfficeJob>();
const listeners = new Set<() => void>();

export function officeJob(key: string): OfficeJob | undefined {
  return jobs.get(key);
}

export function setOfficeJob(key: string, job: OfficeJob | undefined) {
  if (job) jobs.set(key, job);
  else jobs.delete(key);
  for (const listener of listeners) listener();
}

export function subscribeOfficeJobs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
