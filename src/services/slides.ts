import { invoke } from "@tauri-apps/api/core";

// Slide decks (.pptx) get a PDF copy made by the person's own PowerPoint or
// LibreOffice, then behave like PDFs. The copy keeps the deck's name, so a
// PDF named "….pptx" is a slide deck everywhere it is shown.

export const SLIDES_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** A PDF made from a slide deck, or the deck itself, by its file name. */
export function isSlidesName(name: unknown): boolean {
  return typeof name === "string" && /\.pptx$/i.test(name.trim());
}

/** A .pptx attachment that hasn't been converted yet. */
export function isUnconvertedSlides(type: unknown, name: unknown): boolean {
  return (
    type === SLIDES_TYPE || (type !== "application/pdf" && isSlidesName(name))
  );
}

/** "slide 3" for slide decks, "p. 3" for other PDFs. */
export function pageLabel(name: unknown, page: number): string {
  return isSlidesName(name) ? `slide ${page}` : `p. ${page}`;
}

/** A deck's display name, without the .pptx extension. */
export function slidesTitle(name: string): string {
  return name.trim().replace(/\.pptx$/i, "") || "Slides";
}

export type SlidesConverter = "powerpoint" | "libreoffice";
export type SlidesOutcome =
  | { status: "converted"; pdf: number[]; converter: SlidesConverter }
  | { status: "missing" }
  | { status: "failed"; reason: string };

export const slides = {
  convert: (key: string) => invoke<SlidesOutcome>("convert_slides", { key }),
  openOriginal: (key: string, name: string) =>
    invoke<void>("open_slides_original", { key, name }),
};

/** What's happening to an unconverted deck this session, by its file key. */
export type SlideJob =
  | { state: "converting" }
  | { state: "missing" }
  | { state: "failed"; reason: string };

const jobs = new Map<string, SlideJob>();
const listeners = new Set<() => void>();

export function slideJob(key: string): SlideJob | undefined {
  return jobs.get(key);
}

export function setSlideJob(key: string, job: SlideJob | undefined) {
  if (job) jobs.set(key, job);
  else jobs.delete(key);
  for (const listener of listeners) listener();
}

export function subscribeSlideJobs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
