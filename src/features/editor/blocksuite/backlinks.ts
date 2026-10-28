import * as Y from "yjs";
import { referenceIds } from "./references";
import type { KnowledgeObject, Snapshot } from "../../../services/workspace";

export interface BacklinkReport {
  sources: KnowledgeObject[];
  unreadable: KnowledgeObject[];
}

/** Isolated decoding: never initialize an editor or write a source snapshot. */
export function savedReferences(id: string, snapshot: Snapshot): Set<string> {
  const envelope = new Y.Doc();
  const body = new Y.Doc();
  try {
    Y.applyUpdate(envelope, new Uint8Array(snapshot.collection));
    Y.applyUpdate(body, new Uint8Array(snapshot.document));
    if (
      envelope.store.pendingStructs ||
      envelope.store.pendingDs ||
      body.store.pendingStructs ||
      body.store.pendingDs
    )
      throw new Error("Incomplete saved update");
    const pages = envelope.getMap("meta").get("pages");
    const metadata: unknown = pages instanceof Y.Array ? pages.toJSON() : pages;
    if (!Array.isArray(metadata) || !metadata.some((entry) => entry?.id === id))
      throw new Error("Mismatched document identity");
    const blocks = body.getMap("blocks");
    if (
      [...blocks.values()].filter(
        (block) =>
          block instanceof Y.Map && block.get("sys:flavour") === "affine:page",
      ).length !== 1
    )
      throw new Error("Invalid page root");
    return referenceIds(blocks);
  } finally {
    envelope.destroy();
    body.destroy();
  }
}

export async function findBacklinks(
  target: string,
  catalog: KnowledgeObject[],
  load: (id: string) => Promise<Snapshot | null>,
): Promise<BacklinkReport> {
  const result: BacklinkReport = { sources: [], unreadable: [] };
  const unique = new Map(catalog.map((row) => [row.id, row]));
  for (const row of unique.values()) {
    if (row.id === target) continue;
    // Transport/storage failures abort the scan; malformed bodies yield partial results.
    const snapshot = await load(row.id);
    if (!snapshot) continue; // Never-opened documents cannot contain saved links.
    try {
      if (savedReferences(row.id, snapshot).has(target))
        result.sources.push(row);
    } catch {
      result.unreadable.push(row);
    }
  }
  const order = (a: KnowledgeObject, b: KnowledgeObject) =>
    a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  result.sources.sort(order);
  result.unreadable.sort(order);
  return result;
}
