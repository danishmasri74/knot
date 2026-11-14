import * as Y from "yjs";
import type { Snapshot } from "./workspace";
import { standaloneMedia } from "../features/editor/blocksuite/card-deck";

/** Only root-owned, live placements count; dangling link records do not. */
export function liveCardPlacements(body: Y.Doc, shared?: string): string[] {
  const blocks = body.getMap<Y.Map<unknown>>("blocks");
  const roots = [...blocks.values()].filter(
    (block) =>
      block instanceof Y.Map && block.get("sys:flavour") === "affine:page",
  );
  if (roots.length !== 1) return [];
  const children = roots[0].get("sys:children");
  if (!(children instanceof Y.Array)) return [];
  const links = body.getMap<string>("knot:card-links");
  const linked = (id: unknown): id is string =>
    typeof id === "string" &&
    (shared === undefined ? links.has(id) : links.get(id) === shared);
  const notes = children.toArray().filter((id): id is string => {
    const block = blocks.get(id);
    return (
      linked(id) &&
      block instanceof Y.Map &&
      block.get("sys:flavour") === "affine:note"
    );
  });
  // Videos, links, files and images placed directly on the canvas.
  return [...notes, ...[...standaloneMedia(body)].filter(linked)];
}

export function savedCardPlacements(
  id: string,
  snapshot: Snapshot,
  shared?: string,
) {
  if (snapshot.collection.length + snapshot.document.length > 8 * 1024 * 1024)
    throw Error("oversized");
  const envelope = new Y.Doc(),
    body = new Y.Doc();
  try {
    Y.applyUpdate(envelope, new Uint8Array(snapshot.collection));
    Y.applyUpdate(body, new Uint8Array(snapshot.document));
    if (
      [envelope, body].some(
        (doc) => doc.store.pendingDs || doc.store.pendingStructs,
      )
    )
      throw Error("incomplete");
    const pages = envelope.getMap("meta").get("pages");
    const metadata = pages instanceof Y.Array ? pages.toJSON() : pages;
    if (!Array.isArray(metadata) || !metadata.some((page) => page?.id === id))
      throw Error("identity");
    const placements = liveCardPlacements(body, shared);
    return shared === undefined
      ? [
          ...new Set(
            placements.map((instance) =>
              body.getMap<string>("knot:card-links").get(instance)!,
            ),
          ),
        ]
      : placements;
  } finally {
    envelope.destroy();
    body.destroy();
  }
}

/** Catalog eligibility is supplied by native storage. Live edits supersede saved links. */
export async function findCardPlacement(
  shared: string,
  owners: string[],
  live: (id: string) => Y.Doc | undefined,
  load: (id: string) => Promise<Snapshot | null>,
  current: () => boolean,
) {
  for (const document of owners) {
    if (!current()) throw Error("Workspace changed while opening this source.");
    const body = live(document);
    let placements: string[];
    if (body) placements = liveCardPlacements(body, shared);
    else {
      const snapshot = await load(document);
      if (!current())
        throw Error("Workspace changed while opening this source.");
      if (!snapshot) continue;
      try {
        placements = savedCardPlacements(document, snapshot, shared);
      } catch {
        continue;
      } // A malformed owner cannot establish a destination.
    }
    if (placements.length) return { document, placement: placements[0] };
  }
  return undefined;
}
