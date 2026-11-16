import { budgetEvidence, localRelevance } from "./workspace-evidence";
export { budgetEvidence } from "./workspace-evidence";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  getAiEnabled,
  getOcrPreferences,
  getWorkspaceSearchEnabled,
} from "./ai-preferences";
import type {
  TopicCatalog,
  TopicSource,
  TopicPassage,
  TopicSearch,
  TopicEvidence,
} from "./topic-types";
import type { DeckCard, DeckData } from "../features/editor/blocksuite/card-deck";
import type { TopicImage, TopicPdf, TopicVideo } from "./topic-extract";
import { ocrPassages, type OcrLine } from "./ocr-passages";
import { MAX_SCANNED_PAGES } from "./topic-pdf";
import {
  loadTranscript,
  transcriptPassages,
  transcriptTitle,
} from "./youtube-transcript";
import { extractTopicContent, extractDeckPassages } from "./topic-extract";
import type { EditorSession } from "../features/editor/blocksuite/adapter";
import { extractTopicPdf } from "./topic-pdf";
import type { Snapshot } from "./workspace";
import { pageLabel } from "./slides";
let active: TopicIndexer | undefined;
export class TopicIndexer {
  private worker: Worker;
  private next = 0;
  private pending = new Map<
    number,
    {
      timer: ReturnType<typeof setTimeout>;
      resolve: (value: {
        result: unknown;
        semantic?: boolean;
        pdfs?: TopicPdf[];
        videos?: TopicVideo[];
        images?: TopicImage[];
      }) => void;
      reject: (error: Error) => void;
    }
  >();
  private stopped = false;
  private firstReconcile = true;
  private extractionAbort = new AbortController();
  private refreshQueued = false;
  private changed = () => {
    if (this.refreshQueued || this.stopped) return;
    this.refreshQueued = true;
    clearTimeout(this.timer);
    this.ready = this.ready.then(async () => {
      this.refreshQueued = false;
      if (!this.stopped) await this.reconcile();
    });
  };
  private timer?: ReturnType<typeof setTimeout>;
  catalog?: TopicCatalog;
  ready: Promise<void>;
  semantic = true;
  status = "Indexing workspace…";
  constructor() {
    this.worker = new Worker(new URL("./topic.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (e) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      clearTimeout(p.timer);
      if (e.data.error) p.reject(Error(e.data.error));
      else p.resolve(e.data);
    };
    this.worker.onerror = () => {
      for (const p of this.pending.values())
        p.reject(Error("Index worker failed"));
      this.pending.clear();
    };
    this.ready = this.reconcile();
    window.addEventListener("knot-topic-sources-changed", this.changed);
    // Background OCR read new images: re-index the sources holding them.
    void listen("ocr-read", this.changed).then((unlisten) => {
      if (this.stopped) unlisten();
      else this.unlisten = unlisten;
    });
  }
  private unlisten?: () => void;
  private call(type: string, data: object) {
    if (this.stopped) return Promise.reject(Error("Search cancelled"));
    const id = ++this.next;
    return new Promise<{
      result: unknown;
      semantic?: boolean;
      pdfs?: TopicPdf[];
      videos?: TopicVideo[];
      images?: TopicImage[];
    }>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error("Local indexing timed out"));
      }, 60000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, type, ...data });
    });
  }
  private async reconcile() {
    clearTimeout(this.timer);
    let held = false;
    try {
      this.catalog = await invoke<TopicCatalog>("topic_catalog");
      const activation = this.catalog.activation;
      const retryFailures = this.firstReconcile;
      this.firstReconcile = false;
      let after: string | undefined;
      let workspaceName: string | undefined;
      for (;;) {
        const sources = await invoke<TopicSource[]>("topic_pending", {
          activation,
          after,
          retryFailures,
        });
        if (!sources.length) break;
        if (!held) {
          // Background OCR waits while text is indexed.
          held = true;
          await invoke("ocr_hold", { hold: true }).catch(() => {});
        }
        for (const source of sources) {
          if (this.stopped || !getAiEnabled() || !getWorkspaceSearchEnabled())
            return;
          this.status = "Indexing workspace…";
          let passages: TopicPassage[] = [],
            failed = false;
          let failure: string | undefined;
          let units: { key: string; page: number }[] = [];
          let blocks: string[] = [];
          const read: { key: string; page: number }[] = [];
          // Pages of attached PDFs without a text layer, read by background OCR.
          const scans: { ref: TopicPdf; pages: number[] }[] = [];
          try {
            const snapshot = await invoke<Snapshot | { card: DeckCard; questions?: DeckData } | null>(
              "topic_load",
              { activation, id: source.id, revision: source.revision },
            );
            if (snapshot) {
              const extracted = await this.call("extract", {
                source,
                ...("card" in snapshot
                  ? { card: snapshot.card, questions: snapshot.questions }
                  : { snapshot }),
              });
              passages = extracted.result as TopicPassage[];
              this.semantic &&= extracted.semantic !== false;
              failed ||= extracted.semantic === false;
              if (extracted.semantic === false) failure = "model-unavailable";
              for (const ref of extracted.pdfs ?? []) {
                if (this.stopped) return;
                try {
                  const pdf = await extractTopicPdf(
                    source,
                    ref,
                    this.extractionAbort.signal,
                  );
                  failed ||= pdf.partial;
                  if (pdf.partial) failure = "partial-pdf";
                  if (pdf.scanned.length)
                    scans.push({ ref, pages: pdf.scanned.slice(0, MAX_SCANNED_PAGES) });
                  let selected = pdf.passages;
                  try {
                    selected = (
                      await this.call("passages", { passages: selected })
                    ).result as TopicPassage[];
                  } catch {
                    this.semantic = false;
                  }
                  passages.push(...selected);
                } catch {
                  failed = true;
                  failure = "partial-pdf";
                }
              }
              // Saved YouTube transcripts are indexed with the document that
              // holds the card (docs/YOUTUBE-TRANSCRIPT-PLAN.md).
              const seen = new Set<string>();
              for (const video of extracted.videos ?? []) {
                if (this.stopped) return;
                if (seen.has(video.videoId)) continue;
                seen.add(video.videoId);
                // Transcripts are read by workspace name; the catalog's
                // `workspace` is the index identity, not the name.
                workspaceName ??= await invoke<{ active: string | null }>(
                  "workspace_catalog",
                ).then((c) => c.active ?? "", () => "");
                const transcript = workspaceName
                  ? await loadTranscript(workspaceName, video.videoId).catch(
                      () => null,
                    )
                  : null;
                if (!transcript) continue;
                let selected: TopicPassage[] = transcriptPassages(
                  transcript,
                ).map((passage) => ({
                  document: source.id,
                  id: `video:${video.blockId}:${passage.start}`,
                  title: transcriptTitle(transcript.title || video.title),
                  text: passage.text,
                  revision: source.revision,
                  vector: [],
                  video: {
                    videoId: video.videoId,
                    documentId: source.id,
                    blockId: video.blockId,
                    start: passage.start,
                    title: transcript.title || video.title,
                  },
                }));
                try {
                  selected = (
                    await this.call("passages", { passages: selected })
                  ).result as TopicPassage[];
                } catch {
                  this.semantic = false;
                }
                passages.push(...selected);
              }
              // Text OCR already read from the source's images and scanned
              // PDF pages. Unread ones are left to the background reader,
              // which re-indexes this source once it has read them.
              const refs = extracted.images ?? [];
              units = [
                ...refs.map((image) => ({ key: image.key, page: 0 })),
                ...scans.flatMap(({ ref, pages }) =>
                  pages.map((page) => ({ key: ref.key, page })),
                ),
              ];
              blocks = [
                ...refs.map((image) => image.blockId),
                ...scans.flatMap(({ ref, pages }) => pages.map(() => ref.blockId)),
              ];
              const ocr = units.length > 0 && getOcrPreferences().enabled;
              const readings = ocr
                ? await invoke<(OcrLine[] | null)[]>("ocr_lookup", {
                    activation,
                    units,
                  }).catch(() => [])
                : [];
              const lookup = (key: string, page: number) =>
                readings[
                  units.findIndex((u) => u.key === key && u.page === page)
                ] ?? null;
              let selected: TopicPassage[] = refs.flatMap((image) => {
                const lines = lookup(image.key, 0);
                if (!lines?.length) return [];
                read.push({ key: image.key, page: 0 });
                return ocrPassages(lines).map(({ text, rects }) => ({
                  document: source.id,
                  id: image.blockId,
                  title: `${image.caption || "Image"} · text in image`,
                  text,
                  revision: source.revision,
                  vector: [],
                  image: {
                    key: image.key,
                    documentId: source.id,
                    blockId: image.blockId,
                    ...(image.caption ? { caption: image.caption } : {}),
                    rects,
                  },
                }));
              });
              for (const { ref, pages } of scans) {
                let unread = 0;
                for (const page of pages) {
                  const lines = lookup(ref.key, page);
                  if (!lines?.length) {
                    unread++;
                    continue;
                  }
                  read.push({ key: ref.key, page });
                  selected.push(
                    ...ocrPassages(lines).map(({ text, rects }) => ({
                      document: source.id,
                      id: ref.blockId,
                      title: `${ref.name} · ${pageLabel(ref.name, page)} · text in image`,
                      text,
                      revision: source.revision,
                      vector: [],
                      ocr: true as const,
                      pdf: {
                        key: ref.key,
                        name: ref.name,
                        documentId: source.id,
                        blockId: ref.blockId,
                        page,
                        rects,
                      },
                    })),
                  );
                }
                // A PDF is complete once its scanned pages have been read.
                if (unread) {
                  failed = true;
                  failure = "partial-pdf";
                }
              }
              if (selected.length)
                try {
                  selected = (
                    await this.call("passages", { passages: selected })
                  ).result as TopicPassage[];
                } catch {
                  this.semantic = false;
                }
              passages.push(...selected);
            }
          } catch {
            failed = true;
            failure = "unreadable-source";
          }
          if (this.stopped) return;
          await invoke("topic_replace", {
            activation,
            id: source.id,
            revision: source.revision,
            passages,
            failed,
            failure,
            images: units,
            read,
            blocks,
          });
          // Yield between bounded source batches; queries never run a document scan.
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        after = sources.at(-1)!.id;
      }
      this.status = this.semantic
        ? "Workspace"
        : "Workspace · keyword search only";
    } catch {
      this.status = "Workspace index incomplete";
    } finally {
      if (held) void invoke("ocr_hold", { hold: false }).catch(() => {});
      if (!this.stopped)
        this.timer = setTimeout(() => {
          this.ready = this.reconcile();
        }, 10000);
    }
  }
  stop() {
    this.stopped = true;
    this.extractionAbort.abort();
    window.removeEventListener("knot-topic-sources-changed", this.changed);
    this.unlisten?.();
    void invoke("ocr_hold", { hold: false }).catch(() => {});
    clearTimeout(this.timer);
    this.worker.terminate();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(Error("Search cancelled"));
    }
    this.pending.clear();
  }
  async search(
    query: string,
    signal: AbortSignal,
    live?: ReturnType<EditorSession["topicOverlay"]>,
  ): Promise<TopicEvidence> {
    await this.ready;
    if (signal.aborted || this.stopped || !this.catalog)
      throw Error("Search cancelled or index unavailable");
    const current = await invoke<TopicCatalog>("topic_catalog");
    if (current.activation !== this.catalog.activation)
      throw Error("Workspace changed");
    const activation = this.catalog.activation;
    const overlay: TopicPassage[] = [],
      omit: string[] = [];
    const resolvedOverlays = new Set<string>();
    if (live) {
      for (const entry of live.documents) {
        omit.push(entry.id);
        const source = current.sources.find((s) => s.id === entry.id);
        if (!source || !entry.snapshot) continue;
        try {
          overlay.push(...extractTopicContent(source, entry.snapshot).passages);
          resolvedOverlays.add(entry.id);
        } catch {
          /* stale saved content stays omitted */
        }
      }
      for (const entry of live.cards) {
        omit.push(entry.id);
        const source = current.sources.find((s) => s.id === entry.id);
        if (source) {
          overlay.push(...extractDeckPassages(source, entry.card, live.deck).passages);
          resolvedOverlays.add(entry.id);
        } else if (entry.owner) {
          const owner = current.sources.find(
            (source) => source.id === entry.owner!.document,
          );
          if (owner) {
            overlay.push(
              ...extractDeckPassages(
                { ...owner, id: entry.id },
                entry.card,
                live.deck,
              ).passages.map((p) => ({
                ...p,
                document: owner.id,
                id: `card:${entry.owner!.placement}:${entry.card.id}`,
              })),
            );
            resolvedOverlays.add(entry.id);
          }
        }
      }
    }
    let vector: number[] = [];
    try {
      vector = (await this.call("query", { query })).result as number[];
    } catch {
      this.semantic = false;
    }
    const report = await invoke<TopicSearch>("topic_search", {
      activation,
      query,
      vector,
      omit,
    });
    if (
      signal.aborted ||
      this.stopped ||
      !getWorkspaceSearchEnabled() ||
      !getAiEnabled()
    )
      throw Error("Search cancelled");
    // Dirty documents replace their saved representation, including new matching text.
    let fresh: TopicPassage[] = [];
    if (overlay.length) {
      try {
        fresh = (await this.call("passages", { passages: overlay }))
          .result as TopicPassage[];
      } catch {
        this.semantic = false;
      }
      fresh = fresh.filter((p) => localRelevance(query, p, vector));
    }
    const missing = omit.filter(
      (id) =>
        current.sources.some((source) => source.id === id) &&
        !resolvedOverlays.has(id),
    ).length;
    return budgetEvidence(
      [...fresh, ...report.passages],
      activation,
      { ...report, failed: report.failed + missing },
      this.semantic,
      /\b(compare|comparison|contrast)\b/i.test(query) ? 8000 : 4000,
    );
  }
}
/** Sends the OCR preferences to the background reader. */
export function configureOcr() {
  if (!isTauri()) return;
  const ocr = getOcrPreferences();
  void invoke("ocr_configure", {
    enabled: ocr.enabled && getAiEnabled() && getWorkspaceSearchEnabled(),
    battery: ocr.battery,
    paused: ocr.paused,
  }).catch(() => {});
}
export function startTopicIndex() {
  if (!isTauri()) return;
  configureOcr();
  void invoke("topic_enabled", {
    enabled: getAiEnabled() && getWorkspaceSearchEnabled(),
  });
  if (!getAiEnabled() || !getWorkspaceSearchEnabled()) return;
  active?.stop();
  active = new TopicIndexer();
  return () => {
    active?.stop();
    active = undefined;
  };
}
/** Re-index one document soon, for example after a transcript of one of its
 * YouTube cards was saved. The index is a disposable cache. */
export async function refreshTopicSource(documentId: string, cardId?: string) {
  const activation = active?.catalog?.activation;
  if (!activation || !isTauri()) return;
  for (const id of [documentId, ...(cardId ? [`deck:${cardId}`] : [])])
    await invoke("topic_stale", { activation, id }).catch(() => {});
  window.dispatchEvent(new Event("knot-topic-sources-changed"));
}
export function topicIndex() {
  if (!active && getAiEnabled() && getWorkspaceSearchEnabled())
    active = new TopicIndexer();
  if (!active) throw Error("Workspace search is disabled");
  return active;
}
