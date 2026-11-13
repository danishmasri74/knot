/** Version 1 capture contract. Captures are immutable; refresh creates a new ID. */
export const WEB_LIMITS = {
  urls: 8,
  concurrency: 3,
  sourceMs: 20_000,
  batchMs: 60_000,
  responseBytes: 4 * 1024 * 1024,
  batchBytes: 16 * 1024 * 1024,
  extractionMs: 3_000,
  sections: 400,
  nodes: 50_000,
  extractedChars: 400_000,
  contextBytes: 170_000,
  passageChars: 6_000,
} as const;
export type WebSection = {
  id: string;
  headings: string[];
  kind: "text" | "list" | "code" | "table";
  text: string;
  /** PDF page the passage is on (PDF sources only). */
  page?: number;
  /** Address of the passage's own document when it differs from the
   * source's (a landing page's full-text PDF). */
  url?: string;
};
export type WebCapture = {
  version: 1;
  sourceId: string;
  captureId: string;
  requestedUrl: string;
  finalUrl: string;
  title: string;
  author: string | null;
  published: string | null;
  fetchedAt: string;
  contentType: string;
  method: string;
  contentHash: string;
  warnings: string[];
  omitted?: string[];
  sections: WebSection[];
};
export type WebState =
  | "queued"
  | "fetching"
  | "extracting"
  | "ready"
  | "partial"
  | "failed"
  | "cancelled";
export type WebAttempt = {
  id: string;
  url: string;
  state: WebState;
  reason?: string;
  capture?: WebCapture;
};
export type WebEvidence = Omit<WebCapture, "sections"> & {
  sections: WebSection[];
  omitted: string[];
};
export type WebCitation = {
  kind: "web";
  document: string;
  id: string;
  text: string;
  title: string;
  captureId: string;
  sectionId: string;
  ref: string;
  citation?: string;
  headings?: string[];
  contentKind?: WebSection["kind"];
  page?: number;
  url?: string;
};
export type NoteCitation = {
  pdf?: import("../features/editor/blocksuite/pdf-highlights").PdfLocation;
  revision?: string;
  attribution?: string;
  webSource?: string;
  kind?: "note";
  document: string;
  id: string;
  text: string;
  title?: string;
  citation?: string;
};
/** A link OpenAI's web search cited in an answer. */
export type LinkCitation = {
  kind: "link";
  document: string;
  id: string;
  text: string;
  title: string;
  url: string;
  citation?: string;
};
export type CitationSource = NoteCitation | WebCitation | LinkCitation;
export type NativeWebResult = {
  url: string;
  finalUrl?: string;
  body?: string;
  contentType?: string;
  fetchedAt?: string;
  code?: string;
  message?: string;
};
