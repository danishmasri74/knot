import * as Y from "yjs";
import { referenceIds } from "./references";
import type { Snapshot } from "../../../services/workspace";

export interface AuditDocument {
  id: string;
  title: string;
  deleted: boolean;
  snapshot: Snapshot | null;
}
export interface DocumentAudit {
  checked: number;
  issues: { id: string; title: string; deleted: boolean; message: string }[];
}

/** Decode isolated copies only: no BlockSuite initialization, migrations or saves. */
export function auditDocuments(rows: AuditDocument[]): DocumentAudit {
  const result: DocumentAudit = { checked: rows.length, issues: [] };
  const catalog = new Map(rows.map((row) => [row.id, row]));
  const unreadable = new Set<string>();
  const references = new Map<string, Set<string>>();
  function issue(row: AuditDocument, message: string) {
    result.issues.push({
      id: row.id,
      title: row.title,
      deleted: row.deleted,
      message,
    });
    unreadable.add(row.id);
  }
  for (const row of rows) {
    if (!row.snapshot) {
      issue(
        row,
        "No saved snapshot (the document may never have been opened).",
      );
      continue;
    }
    const envelope = new Y.Doc();
    const body = new Y.Doc();
    try {
      Y.applyUpdate(envelope, new Uint8Array(row.snapshot.collection));
      if (envelope.store.pendingStructs || envelope.store.pendingDs)
        issue(
          row,
          "Collection update is incomplete; Yjs dependencies are missing.",
        );
      const pages = envelope.getMap("meta").get("pages");
      const metadata: unknown =
        pages instanceof Y.Array ? pages.toJSON() : pages;
      if (
        !Array.isArray(metadata) ||
        !metadata.some((entry) => entry?.id === row.id)
      )
        issue(row, "Collection metadata does not contain this document ID.");
    } catch {
      issue(row, "Collection snapshot cannot be decoded.");
    }
    try {
      Y.applyUpdate(body, new Uint8Array(row.snapshot.document));
      if (body.store.pendingStructs || body.store.pendingDs)
        issue(
          row,
          "Document update is incomplete; Yjs dependencies are missing.",
        );
      const blocks = body.getMap("blocks");
      const roots = [...blocks.values()].filter(
        (block) =>
          block instanceof Y.Map && block.get("sys:flavour") === "affine:page",
      );
      if (roots.length !== 1)
        issue(row, "Document does not contain exactly one page root.");
      references.set(row.id, referenceIds(blocks));
    } catch {
      issue(row, "Document snapshot cannot be decoded.");
    } finally {
      envelope.destroy();
      body.destroy();
    }
  }
  for (const row of rows) {
    for (const id of references.get(row.id) ?? []) {
      const target = catalog.get(id);
      const reason = !target
        ? "missing from the catalog"
        : target.deleted
          ? "in Trash; restore it to resolve this reference"
          : unreadable.has(id)
            ? "without a readable saved snapshot; inspect its document issues"
            : null;
      if (reason)
        result.issues.push({
          id: row.id,
          title: row.title,
          deleted: row.deleted,
          message: `Reference target ${id} is ${reason}.`,
        });
    }
  }
  return result;
}
