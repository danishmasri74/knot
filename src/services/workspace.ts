import { invoke } from "@tauri-apps/api/core";
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
export const repository = {
  integrity: () =>
    invoke<{
      checked: number;
      missing: string[];
      corrupt: string[];
      orphan_files: string[];
    }>("check_workspace"),
  list: (search = "", offset = 0) =>
    invoke<KnowledgeObject[]>("list_objects", { search, offset }),
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
export const backups = {
  export: () => invoke<string | null>("export_backup"),
  restore: () => invoke<string | null>("restore_backup"),
};
