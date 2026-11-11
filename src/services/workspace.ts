import { invoke } from "@tauri-apps/api/core";
import {
  auditDocuments,
  type AuditDocument,
  type DocumentAudit,
} from "../features/editor/blocksuite/integrity";
export type ExportFormat = "markdown" | "png" | "pdf";
export interface ExportFile {
  name: string;
  bytes: number[];
}
export const exportDocument = (
  title: string,
  format: ExportFormat,
  files: ExportFile[],
) => invoke<string | null>("export_document", { title, format, files });
export interface WorkspaceCatalog {
  active: string | null;
  entries: { id: string; path: string }[];
  warning?: string | null;
}
export const workspaces = {
  catalog: () => invoke<WorkspaceCatalog>("workspace_catalog"),
  switch: (id: string) => invoke<void>("switch_workspace", { id }),
  openExternal: () => invoke<boolean>("open_external_workspace"),
  relocate: () => invoke<string | null>("relocate_workspace"),
};
export interface KnowledgeObject {
  id: string;
  title: string;
  kind: "note" | "whiteboard";
  updated_at: number;
}
export interface Snapshot {
  title?: string;
  collection: number[];
  document: number[];
}
export interface TrashedObject extends Omit<KnowledgeObject, "kind"> {
  kind: KnowledgeObject["kind"] | "collection";
  deleted_at: number;
}
export interface IntegrityReport {
  database_version: number;
  migration_backups: string[];
  documents: DocumentAudit;
  checked_at: number;
  checked: number;
  missing: string[];
  corrupt: string[];
  orphan_files: string[];
  database_issues: string[];
  affected_attachments: {
    hash: string;
    key: string;
    name: string;
    documents: { id: string; title: string; deleted: boolean }[];
  }[];
}
export interface Collection {
  id: string;
  name: string;
  notebooks: string[];
}
export interface Catalog {
  collections: Collection[];
  favorites: string[];
}
export interface Membership {
  collections: string[];
}
export interface LibraryFilter {
  collection: string | null;
}
export const collections = {
  reorder: (ids: string[]) => invoke<void>("reorder_collections", { ids }),
  favorite: (id: string, favorite: boolean) =>
    invoke<void>("set_favorite", { id, favorite }),
  catalog: () => invoke<Catalog>("collection_catalog"),
  get: (id: string) => invoke<Membership>("get_membership", { id }),
  save: (id: string, value: Membership) =>
    invoke<void>("set_membership", { id, value }),
  create: (name: string, object: string | null = null) =>
    invoke<string>("create_collection", { name, object }),
  rename: (id: string, name: string) =>
    invoke<void>("rename_collection", { id, name }),
  delete: (id: string) => invoke<void>("delete_collection", { id }),
};
function changedTopicSources<T>(result: Promise<T>):Promise<T> {
  return result.then(value=>{window.dispatchEvent(new Event("knot-topic-sources-changed"));return value;});
}
export const repository = {
  loadCardDeck: () => invoke<string>("load_card_deck"),
  clearExpiredTrash: () => invoke<number>("clear_expired_trash"),
  purgeTrash: (ids: string[]) => invoke<number>("purge_trash", { ids }),
  trash: (search = "", offset = 0) =>
    invoke<TrashedObject[]>("list_trash", { search, offset }),
  restore: (id: string) => changedTopicSources(invoke<void>("restore_object", { id })),
  saveMany: (
    documents: { id: string; snapshot: Snapshot; create: boolean }[],
    deck?: string,
    quiz?: import("../features/quiz/mcq").McqMutation[],
    publishedDraft?: string,
  ) => {
    const save = invoke<void>("save_documents", { documents, deck, quiz, publishedDraft });
    return documents.length || deck !== undefined ? changedTopicSources(save) : save;
  },
  async catalog() {
    const rows: KnowledgeObject[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = await repository.list("", offset);
      rows.push(...page);
      if (page.length < 100) return rows;
    }
  },
  async integrity(): Promise<IntegrityReport> {
    const { document_snapshots, ...report } = await invoke<
      Omit<IntegrityReport, "documents"> & {
        document_snapshots: AuditDocument[];
      }
    >("check_workspace");
    return { ...report, documents: auditDocuments(document_snapshots) };
  },
  list: (
    search = "",
    offset = 0,
    filter: LibraryFilter = { collection: null },
  ) =>
    invoke<KnowledgeObject[]>("filter_objects", { search, offset, ...filter }),
  create: (kind: KnowledgeObject["kind"]) =>
    invoke<string>("create_object", { kind }),
  rename: (id: string, title: string) =>
    changedTopicSources(invoke<void>("rename_object", { id, title })),
  delete: (id: string) => changedTopicSources(invoke<void>("delete_object", { id })),
  load: (id: string) => invoke<Snapshot | null>("load_document", { id }),
  save: (id: string, snapshot: Snapshot) =>
    changedTopicSources(invoke<void>("save_document", { id, snapshot })),
};
export const attachments = {
  recoverMissing: (hash: string) =>
    invoke<string>("recover_missing_attachment", { hash }),
  put: (
    object: string,
    key: string,
    bytes: number[],
    name: string,
    mime: string,
  ) => invoke<string>("put_blob", { object, key, bytes, name, mime }),
  get: (key: string) => invoke<number[]>("get_blob", { key }),
  list: (object: string) => invoke<string[]>("list_blobs", { object }),
};
export interface BackupEntry {
  id: string;
  size: number;
  modified: number;
}
export const backups = {
  list: () => invoke<BackupEntry[]>("list_backups"),
  create: () => invoke<string>("create_backup"),
  validate: (id: string) => invoke<void>("validate_backup", { id }),
  delete: (id: string) => invoke<void>("delete_backup", { id }),
  open: (id: string) => invoke<string>("restore_managed_backup", { id }),
  export: () => invoke<string | null>("export_backup"),
  restore: () => invoke<string | null>("restore_backup"),
};
export interface OrphanCandidate {
  id: string;
  path: string;
  size: number;
  digest: string;
}
export interface QuarantineCatalog {
  entries: {
    id: string;
    original: string;
    size: number;
    digest: string;
    created_at: number;
  }[];
  warnings: string[];
}
export const quarantine = {
  preview: () => invoke<OrphanCandidate[]>("preview_orphans"),
  catalog: () => invoke<QuarantineCatalog>("quarantine_catalog"),
  move: (selected: Pick<OrphanCandidate, "id" | "size" | "digest">[]) =>
    invoke<{ id: string; error: string | null }[]>("quarantine_orphans", {
      selected,
    }),
  restore: (id: string) => invoke<void>("restore_quarantined", { id }),
  dispose: (entry: QuarantineCatalog["entries"][number]) =>
    invoke<string | null>("dispose_quarantined", { entry }),
};

export interface LibraryRow extends KnowledgeObject {
  created_at: number | null;
}
export const libraryPage = (
  search: string,
  collection: string | null,
  created: boolean,
  offset: number,
) =>
  invoke<{ rows: LibraryRow[]; total: number }>("library_page", {
    search,
    collection,
    created,
    offset,
  });
