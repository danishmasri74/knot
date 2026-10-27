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
