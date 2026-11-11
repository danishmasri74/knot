import * as Y from "yjs";

/** BlockSuite card props and inline reference attributes both use pageId. */
export function referenceIds(value: unknown): Set<string> {
  const result = new Set<string>();
  function visit(node: unknown) {
    if (!node || typeof node !== "object") return;
    if (node instanceof Y.Text) {
      visit(node.toDelta());
      return;
    }
    if (node instanceof Y.Array) {
      node.forEach(visit);
      return;
    }
    const entries =
      node instanceof Y.Map ? node.entries() : Object.entries(node);
    for (const [key, child] of entries) {
      if (
        (key === "pageId" || key === "prop:pageId") &&
        typeof child === "string"
      )
        result.add(child);
      else visit(child);
    }
  }
  visit(value);
  return result;
}

/**
 * How a block points at another notebook. A canvas placement shows the target
 * inside this notebook, so sharing includes it by default; link cards and
 * inline mentions only point at it (docs/NOTEBOOK-SHARING-PLAN.md).
 */
export type ReferenceKind = "canvas" | "link" | "inline";
const KIND_RANK: Record<ReferenceKind, number> = { canvas: 3, link: 2, inline: 1 };

export function referenceKinds(block: unknown): Map<string, ReferenceKind> {
  const result = new Map<string, ReferenceKind>();
  const add = (id: string, kind: ReferenceKind) => {
    const previous = result.get(id);
    if (!previous || KIND_RANK[kind] > KIND_RANK[previous]) result.set(id, kind);
  };
  const flavour = block instanceof Y.Map ? block.get("sys:flavour") : undefined;
  const own = block instanceof Y.Map ? block.get("prop:pageId") : undefined;
  if (typeof own === "string")
    add(own, flavour === "affine:embed-synced-doc" ? "canvas" : "link");
  // Anything else that carries a pageId (text deltas) is an inline mention.
  if (block instanceof Y.Map)
    for (const [key, child] of block.entries())
      if (key !== "prop:pageId")
        for (const id of referenceIds(child)) add(id, "inline");
  return result;
}
