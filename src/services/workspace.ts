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
export interface TrashedObject extends KnowledgeObject {
  deleted_at: number;
}
export interface IntegrityReport {
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
export interface Label {
  id: string;
  name: string;
}
export interface Catalog {
  folders: Label[];
  tags: Label[];
}
export interface Organization {
  folder: string | null;
  tags: string[];
}
export interface LibraryFilter {
  folder: string | null;
  tag: string | null;
}
export const organization = {
  catalog: () => invoke<Catalog>("organization_catalog"),
  get: (id: string) => invoke<Organization>("get_organization", { id }),
  save: (id: string, value: Organization) =>
    invoke<void>("organize_object", { id, value }),
  create: (kind: "folder" | "tag", name: string) =>
    invoke<string>("create_label", { kind, name }),
  rename: (kind: "folder" | "tag", id: string, name: string) =>
    invoke<void>("rename_label", { kind, id, name }),
  delete: (kind: "folder" | "tag", id: string) =>
    invoke<void>("delete_label", { kind, id }),
};
export const repository = {
  trash: (search = "", offset = 0) =>
    invoke<TrashedObject[]>("list_trash", { search, offset }),
  restore: (id: string) => invoke<void>("restore_object", { id }),
  saveMany: (
    documents: { id: string; snapshot: Snapshot; create: boolean }[],
  ) => invoke<void>("save_documents", { documents }),
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
    filter: LibraryFilter = { folder: null, tag: null },
  ) =>
    invoke<KnowledgeObject[]>("filter_objects", { search, offset, ...filter }),
  create: (kind: KnowledgeObject["kind"]) =>
    invoke<string>("create_object", { kind }),
  rename: (id: string, title: string) =>
    invoke<void>("rename_object", { id, title }),
  delete: (id: string) => invoke<void>("delete_object", { id }),
  load: (id: string) => invoke<Snapshot | null>("load_document", { id }),
  save: (id: string, snapshot: Snapshot) =>
    invoke<void>("save_document", { id, snapshot }),
};
export const attachments = {
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
};
