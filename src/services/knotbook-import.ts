// Prepares a .knotbook import: decides each notebook's ID and title, gives
// "Keep both" copies and conflicting cards new IDs, and rewrites references so
// everything inside the package still points at the right copy. Runs on
// isolated Yjs documents; nothing touches the live editor or the workspace.
// Plan: docs/NOTEBOOK-SHARING-PLAN.md ("Import").
import * as Y from "yjs";

export type ImportStatus = "new" | "library" | "current";
export interface ManifestNotebook {
  id: string;
  title: string;
  kind: "note" | "whiteboard";
  updatedAt: number;
  sha256: string;
  role: "root" | "canvas" | "linked";
  parent: string | null;
  attachments: string[];
}
export interface InspectedPackage {
  manifest: {
    sharedBy: string;
    exportedAt: number;
    root: string;
    notebooks: ManifestNotebook[];
    unshared: { id: string; title: string }[];
  };
  notebooks: {
    id: string;
    collection: number[];
    document: number[];
    status: ImportStatus;
    existing_title: string | null;
  }[];
  cards: Record<string, unknown>;
  size: number;
}
export interface ImportChoice {
  include: boolean;
  /** Only for notebooks already in the Library. */
  replace: boolean;
}
export interface ImportItem {
  sourceId: string;
  targetId: string;
  mode: "new" | "replace";
  title: string;
  collection: number[];
  document: number[];
}

/** "Waves" → "Waves 2", or the next number nobody uses. */
export function nextTitle(title: string, taken: Set<string>) {
  const base = title.trim() || "Untitled";
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

function decode(bytes: number[]) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(bytes));
  if (doc.store.pendingStructs || doc.store.pendingDs) {
    doc.destroy();
    throw new Error("A notebook in this file is incomplete.");
  }
  return doc;
}
const encode = (doc: Y.Doc) => [...Y.encodeStateAsUpdate(doc)];

/** Points every reference at its new ID: card props and inline text marks. */
function rewriteReferences(value: unknown, ids: Map<string, string>): boolean {
  let changed = false;
  if (value instanceof Y.Text) {
    let index = 0;
    for (const op of value.toDelta() as {
      insert: unknown;
      attributes?: Record<string, unknown>;
    }[]) {
      const length = typeof op.insert === "string" ? op.insert.length : 1;
      const reference = op.attributes?.reference as
        { pageId?: unknown } | undefined;
      if (
        reference &&
        typeof reference.pageId === "string" &&
        ids.has(reference.pageId)
      ) {
        value.format(index, length, {
          reference: { ...reference, pageId: ids.get(reference.pageId) },
        });
        changed = true;
      }
      index += length;
    }
  } else if (value instanceof Y.Map) {
    for (const [key, child] of [...value.entries()]) {
      if (
        (key === "prop:pageId" || key === "pageId") &&
        typeof child === "string"
      ) {
        if (ids.has(child)) {
          value.set(key, ids.get(child));
          changed = true;
        }
      } else if (rewriteReferences(child, ids)) changed = true;
    }
  } else if (value instanceof Y.Array) {
    for (const child of value.toArray())
      if (rewriteReferences(child, ids)) changed = true;
  }
  return changed;
}

/** Updates the envelope's page entry to the new ID and title. */
function rewriteEnvelope(doc: Y.Doc, from: string, to: string, title: string) {
  const pages = doc.getMap("meta").get("pages");
  if (!(pages instanceof Y.Array))
    throw new Error("A notebook in this file can't be read.");
  let found = false;
  pages.toArray().forEach((entry, index) => {
    if (entry instanceof Y.Map) {
      if (entry.get("id") !== from) return;
      found = true;
      entry.set("id", to);
      if (entry.has("title")) entry.set("title", title);
    } else if (
      entry &&
      typeof entry === "object" &&
      (entry as { id?: unknown }).id === from
    ) {
      found = true;
      const next = { ...(entry as Record<string, unknown>), id: to };
      if ("title" in next) next.title = title;
      pages.delete(index, 1);
      pages.insert(index, [next]);
    }
  });
  if (!found) throw new Error("A notebook in this file can't be read.");
}

function cardIds(document: number[]) {
  const doc = decode(document);
  try {
    return [...doc.getMap<string>("knot:card-links").values()].filter(
      (id): id is string => typeof id === "string" && !!id,
    );
  } finally {
    doc.destroy();
  }
}

/**
 * Builds the plan the native import commits. `deck` is the recipient's card
 * deck and `titles` the titles already in their Library (any case).
 */
export function buildImport(
  pkg: InspectedPackage,
  choices: Map<string, ImportChoice>,
  deck: Record<string, unknown>,
  titles: Set<string>,
  newId: () => string = () => crypto.randomUUID(),
): { items: ImportItem[]; cards: Record<string, unknown> } {
  const meta = new Map(pkg.manifest.notebooks.map((n) => [n.id, n]));
  const chosen = pkg.notebooks.filter((n) => choices.get(n.id)?.include);
  const taken = new Set([...titles].map((t) => t.toLowerCase()));
  const ids = new Map<string, string>();
  const plans = chosen.map((n) => {
    const keepBoth = n.status !== "new" && !choices.get(n.id)?.replace;
    const source = meta.get(n.id)!;
    const target = keepBoth ? newId() : n.id;
    const title = keepBoth ? nextTitle(source.title, taken) : source.title;
    taken.add(title.toLowerCase());
    if (target !== n.id) ids.set(n.id, target);
    return {
      n,
      keepBoth,
      target,
      title,
      mode: (keepBoth || n.status === "new"
        ? "new"
        : "replace") as ImportItem["mode"],
    };
  });

  // Cards: a "Keep both" copy never shares cards with the original, and a new
  // notebook never overwrites a different card of the recipient's.
  const cardMap = new Map<string, string>();
  const cards: Record<string, unknown> = {};
  for (const plan of plans)
    for (const card of cardIds(plan.n.document)) {
      if (cardMap.has(card) || !(card in pkg.cards)) continue;
      const theirs = deck[card];
      const conflict =
        theirs !== undefined &&
        JSON.stringify(theirs) !== JSON.stringify(pkg.cards[card]);
      const target =
        plan.keepBoth || (plan.mode === "new" && conflict) ? newId() : card;
      cardMap.set(card, target);
      const value = pkg.cards[card];
      cards[target] =
        target !== card && value && typeof value === "object" && "id" in value
          ? { ...(value as Record<string, unknown>), id: target }
          : value;
    }
  const changedCards = new Map(
    [...cardMap].filter(([from, to]) => from !== to),
  );

  const items = plans.map(({ n, target, title, mode }) => {
    const envelope = decode(n.collection);
    const body = decode(n.document);
    try {
      // Unchanged notebooks keep their exact bytes, so importing the same file
      // again is recognised as "Up to date".
      const renamed = target !== n.id || title !== meta.get(n.id)!.title;
      if (renamed) rewriteEnvelope(envelope, n.id, target, title);
      else {
        // Identity check only, on a throwaway copy.
        const check = decode(n.collection);
        try {
          rewriteEnvelope(check, n.id, n.id, title);
        } finally {
          check.destroy();
        }
      }
      let edited = rewriteReferences(body.getMap("blocks"), ids);
      if (changedCards.size) {
        const links = body.getMap<string>("knot:card-links");
        for (const [instance, card] of [...links.entries()])
          if (changedCards.has(card)) {
            links.set(instance, changedCards.get(card)!);
            edited = true;
          }
      }
      return {
        sourceId: n.id,
        targetId: target,
        mode,
        title,
        collection: renamed ? encode(envelope) : n.collection,
        document: edited ? encode(body) : n.document,
      };
    } finally {
      envelope.destroy();
      body.destroy();
    }
  });
  return { items, cards };
}
