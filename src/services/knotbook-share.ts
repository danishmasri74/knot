// Chooses what a .knotbook share contains. Notebooks shown on a canvas come
// along by default, at every depth; linked notebooks are offered unticked.
// Each notebook appears once, so loops and diamonds terminate.
// Plan: docs/NOTEBOOK-SHARING-PLAN.md.
import * as Y from "yjs";
import {
  referenceKinds,
  type ReferenceKind,
} from "../features/editor/blocksuite/references";
import type { Snapshot } from "./workspace";

export interface SavedShareInfo {
  refs: Map<string, ReferenceKind>;
  cards: Set<string>;
}

/** Reads a saved notebook in isolation; never touches the live editor. */
export function savedShareInfo(id: string, snapshot: Snapshot): SavedShareInfo {
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
    const refs = new Map<string, ReferenceKind>();
    const rank = { canvas: 3, link: 2, inline: 1 } as const;
    for (const block of body.getMap("blocks").values())
      for (const [target, kind] of referenceKinds(block)) {
        if (target === id) continue;
        const previous = refs.get(target);
        if (!previous || rank[kind] > rank[previous]) refs.set(target, kind);
      }
    const cards = new Set<string>();
    for (const card of body.getMap<string>("knot:card-links").values())
      if (typeof card === "string" && card) cards.add(card);
    // Cards shown inside notes travel with the notebook too.
    for (const block of body.getMap("blocks").values()) {
      if (!(block instanceof Y.Map) || block.get("sys:flavour") !== "knot:card-embed")
        continue;
      const card = block.get("prop:cardId");
      if (typeof card === "string" && card) cards.add(card);
    }
    return { refs, cards };
  } finally {
    envelope.destroy();
    body.destroy();
  }
}

export interface ShareRow {
  id: string;
  title: string;
  section: "included" | "linked";
  depth: number;
  /** Why it is listed: the root, shown on a canvas, or linked. */
  reason: "root" | "canvas" | "link";
  checked: boolean;
  locked: boolean;
  parent: string | null;
}

export interface SharePlan {
  rows: ShareRow[];
  /** Notebooks that go into the file, root first. */
  selected: {
    id: string;
    role: "root" | "canvas" | "linked";
    parent: string | null;
  }[];
  /** Referenced by a selected notebook but not included. */
  unshared: { id: string; title: string }[];
  cards: string[];
}

/**
 * `ticked` holds linked notebooks the person chose; `unticked` holds canvas
 * notebooks they removed. Targets missing from `titles` (Trash, deleted) are
 * never offered and stay as they already render.
 */
export function planShare(
  root: string,
  titles: Map<string, string>,
  info: Map<string, SavedShareInfo>,
  ticked: ReadonlySet<string>,
  unticked: ReadonlySet<string>,
): SharePlan {
  const rows: ShareRow[] = [];
  const listed = new Set<string>();
  const pendingLinks: { id: string; parent: string }[] = [];

  const visit = (
    id: string,
    depth: number,
    section: ShareRow["section"],
    reason: ShareRow["reason"],
    parent: string | null,
  ) => {
    if (listed.has(id) || !titles.has(id)) return;
    listed.add(id);
    const checked =
      reason === "root" ||
      (reason === "canvas" ? !unticked.has(id) : ticked.has(id));
    rows.push({
      id,
      title: titles.get(id) ?? "Untitled",
      section,
      depth,
      reason,
      checked,
      locked: reason === "root",
      parent,
    });
    if (!checked) return;
    const refs = [...(info.get(id)?.refs ?? new Map<string, ReferenceKind>())];
    for (const [target, kind] of refs)
      if (kind === "canvas") visit(target, depth + 1, section, "canvas", id);
    for (const [target, kind] of refs)
      if (kind !== "canvas") {
        // Links from the included tree are offered at the top of "Linked";
        // links from a linked notebook nest beneath it.
        if (section === "included")
          pendingLinks.push({ id: target, parent: id });
        else visit(target, depth + 1, "linked", "link", id);
      }
  };

  visit(root, 0, "included", "root", null);
  for (const link of pendingLinks)
    visit(link.id, 0, "linked", "link", link.parent);

  const selected = rows
    .filter((row) => row.checked && isReachable(row, rows))
    .map((row) => ({
      id: row.id,
      role:
        row.reason === "root"
          ? ("root" as const)
          : row.reason === "canvas"
            ? ("canvas" as const)
            : ("linked" as const),
      parent: row.parent,
    }));
  const chosen = new Set(selected.map((entry) => entry.id));
  const unshared = new Map<string, string>();
  const cards = new Set<string>();
  for (const { id } of selected) {
    const entry = info.get(id);
    for (const card of entry?.cards ?? []) cards.add(card);
    for (const target of entry?.refs.keys() ?? [])
      if (!chosen.has(target) && titles.has(target))
        unshared.set(target, titles.get(target)!);
  }
  return {
    rows,
    selected,
    unshared: [...unshared].map(([id, title]) => ({ id, title })),
    cards: [...cards].sort(),
  };
}

/** A checked row only counts when every ancestor is checked too. */
function isReachable(row: ShareRow, rows: ShareRow[]) {
  let parent = row.parent;
  // Linked rows at depth 0 hang off the included tree, which is always reachable
  // from the root when its parent row is checked.
  while (parent) {
    const up = rows.find((candidate) => candidate.id === parent);
    if (!up || !up.checked) return false;
    parent = up.parent;
  }
  return true;
}
