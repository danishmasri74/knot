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
    rects: [];
  };
  attribution?: string;
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
