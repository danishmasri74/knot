export interface TopicSource {
  id: string;
  title: string;
  revision: string;
}
export interface TopicCatalog {
  activation: string;
  workspace: string;
  sources: TopicSource[];
}
export interface TopicPassage {
  document: string;
  id: string;
  title: string;
  text: string;
  revision: string;
  vector: number[];
  pdf?: {
    key: string;
    name: string;
    documentId: string;
    blockId?: string;
    page: number;
    rects: [number, number, number, number][];
  };
  attribution?: string;
  /** Text Windows OCR read from an image (docs/WORKSPACE-OCR-PLAN.md). */
  image?: ImageLocation;
  /** Text Windows OCR read from a scanned PDF page (with `pdf`). */
  ocr?: true;
  /** A passage of a YouTube card's saved transcript. */
  video?: import("./youtube-transcript").VideoLocation;
}
/** An image block whose text was read by OCR. */
export interface ImageLocation {
  key: string;
  documentId: string;
  blockId: string;
  caption?: string;
  /** Boxes of the lines this passage came from, as image fractions. */
  rects?: [number, number, number, number][];
}
export interface TopicSearch {
  passages: TopicPassage[];
  indexed: number;
  total: number;
  failed: number;
}
export interface TopicEvidence {
  version: 1;
  sourceMode: "workspace";
  activation: string;
  coverage: {
    indexed: number;
    total: number;
    failed: number;
    semantic: boolean;
  };
  citationSources: (Omit<TopicPassage, "vector"> & { citation: string })[];
}
