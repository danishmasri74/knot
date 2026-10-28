import * as Y from "yjs";
import type { KnowledgeObject, Snapshot } from "../../../services/workspace";

export const SEARCH_DOCUMENTS = 200;
export const SEARCH_BYTES = 1024 * 1024;
export const SEARCH_TOTAL_BYTES = 16 * SEARCH_BYTES;
export interface SearchReport {
  results: { source: KnowledgeObject; excerpt: string }[];
  skipped: string[];
  limited: boolean;
  checkedAt: number;
}

/** Isolated, read-only decoding; never hydrate the editor's workspace collection. */
export function savedSearchText(id: string, snapshot: Snapshot): string {
  if (snapshot.collection.length + snapshot.document.length > SEARCH_BYTES)
    throw new Error("Snapshot exceeds 1 MiB");
  const envelope = new Y.Doc(),
    body = new Y.Doc();
  try {
    Y.applyUpdate(envelope, new Uint8Array(snapshot.collection));
    Y.applyUpdate(body, new Uint8Array(snapshot.document));
    if (
      envelope.store.pendingStructs ||
      envelope.store.pendingDs ||
      body.store.pendingStructs ||
      body.store.pendingDs
    )
      throw new Error("Incomplete update");
    const pages = envelope.getMap("meta").get("pages");
    const metadata = pages instanceof Y.Array ? pages.toJSON() : pages;
    if (!Array.isArray(metadata) || !metadata.some((entry) => entry?.id === id))
      throw new Error("Mismatched identity");
    const blocks = body.getMap("blocks");
    if (
      [...blocks.values()].filter(
        (block) =>
          block instanceof Y.Map && block.get("sys:flavour") === "affine:page",
      ).length !== 1
    )
      throw new Error("Invalid page root");
    const parts: string[] = [];
    let length = 0;
    for (const block of blocks.values()) {
      if (
        !(block instanceof Y.Map) ||
        !["affine:paragraph", "affine:list", "affine:code"].includes(
          String(block.get("sys:flavour")),
        )
      )
        continue;
      const value = block.get("prop:text");
      if (!(value instanceof Y.Text)) continue;
      const text = value.toString();
      length += text.length + 1;
      if (length > 100000) throw new Error("Body exceeds 100,000 characters");
      parts.push(text);
    }
    return parts.join("\n");
  } finally {
    envelope.destroy();
    body.destroy();
  }
}

export async function searchSavedDocuments(
  query: string,
  list: (offset: number) => Promise<KnowledgeObject[]>,
  load: (id: string) => Promise<Snapshot | null>,
  extract: (id: string, snapshot: Snapshot) => Promise<string>,
): Promise<SearchReport> {
  const needle = query.trim().toLowerCase();
  if (!needle || needle.length > 200)
    throw new Error("Enter 1–200 characters to search.");
  const catalog = new Map<string, KnowledgeObject>();
  let limited = false;
  for (let offset = 0; offset <= SEARCH_DOCUMENTS; offset += 100) {
    const page = await list(offset);
    if (offset === SEARCH_DOCUMENTS) {
      limited = page.length > 0;
      break;
    }
    for (const row of page) catalog.set(row.id, row);
    if (page.length < 100) break;
  }
  const report: SearchReport = {
    results: [],
    skipped: [],
    limited,
    checkedAt: Date.now(),
  };
  let total = 0;
  for (const source of [...catalog.values()].slice(0, SEARCH_DOCUMENTS)) {
    let text = "";
    // Storage failures abort the whole attempt; bad individual bodies are explicit omissions.
    const snapshot =
      total < SEARCH_TOTAL_BYTES ? await load(source.id) : undefined;
    const size = snapshot
      ? snapshot.collection.length + snapshot.document.length
      : 0;
    if (
      snapshot === undefined ||
      size > SEARCH_BYTES ||
      total + size > SEARCH_TOTAL_BYTES
    ) {
      report.skipped.push(source.title);
      total += size;
    } else if (snapshot) {
      total += size;
      try {
        text = await extract(source.id, snapshot);
      } catch {
        report.skipped.push(source.title);
      }
    }
    const position = text.toLowerCase().indexOf(needle);
    if (source.title.toLowerCase().includes(needle) || position >= 0) {
      const start = Math.max(0, position - 50);
      report.results.push({
        source,
        excerpt:
          position < 0
            ? "Title match"
            : `${start ? "…" : ""}${text.slice(start, start + 220)}${text.length > start + 220 ? "…" : ""}`,
      });
    }
  }
  report.results.sort(
    (a, b) =>
      a.source.title.localeCompare(b.source.title) ||
      a.source.id.localeCompare(b.source.id),
  );
  return report;
}
