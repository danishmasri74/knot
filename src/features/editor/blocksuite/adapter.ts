import { effects as registerBlocks } from "@blocksuite/blocks/effects";
import { effects as registerEditors } from "@blocksuite/presets/effects";
import { DocCollection, Schema, Text } from "@blocksuite/store";
import { AffineSchemas } from "@blocksuite/blocks";
import { AffineEditorContainer } from "@blocksuite/presets";
import * as Y from "yjs";
import {
  attachments,
  repository,
  type KnowledgeObject,
} from "../../../services/workspace";
import {
  SaveCoordinator,
  type SaveStatus,
} from "../../../services/persistence";

registerBlocks();
registerEditors();

export async function openEditor(
  object: KnowledgeObject,
  onStatus: (status: SaveStatus, error?: unknown) => void,
  onTitle: (title: string) => void = () => {},
) {
  const saved = await repository.load(object.id);
  const pending = new Set<Promise<unknown>>();
  const source = {
    name: "knot-filesystem",
    readonly: false,
    async get(key: string) {
      try {
        return new Blob([new Uint8Array(await attachments.get(key))]);
      } catch (e) {
        onStatus("failed", e);
        throw e;
      }
    },
    set(key: string, value: Blob) {
      const job = (async () => {
        if (value.size > 100 * 1024 * 1024)
          throw new Error("Attachment exceeds 100 MiB");
        await attachments.put(
          object.id,
          key,
          Array.from(new Uint8Array(await value.arrayBuffer())),
          value instanceof File ? value.name : "attachment",
          value.type,
        );
        return key;
      })();
      pending.add(job);
      void job
        .finally(() => pending.delete(job))
        .catch((e) => onStatus("failed", e));
      return job;
    },
    async delete() {
      /* Retain assets until a future reference-aware garbage collector. */
    },
    list: () => attachments.list(object.id),
  };
  const collection = new DocCollection({
    id: object.id,
    schema: new Schema().register(AffineSchemas),
    blobSources: { main: source },
  });
  try {
    if (saved) Y.applyUpdate(collection.doc, new Uint8Array(saved.collection));
    else collection.meta.initialize();
    const doc = saved
      ? collection.getDoc(object.id)
      : collection.createDoc({ id: object.id });
    if (!doc)
      throw new Error(
        "Document metadata is missing. Restore a backup; this document has not been overwritten.",
      );
    if (saved) Y.applyUpdate(doc.spaceDoc, new Uint8Array(saved.document));
    doc.load();
    if (saved && !doc.root)
      throw new Error(
        "Document content is damaged or incompatible. Original stored state has been preserved.",
      );
    if (!saved) {
      const root = doc.addBlock("affine:page", {
        title: new Text(object.title),
      });
      doc.addBlock("affine:surface", {}, root);
      const note = doc.addBlock("affine:note", {}, root);
      doc.addBlock("affine:paragraph", {}, note);
      doc.resetHistory();
    }
    const persistence = new SaveCoordinator(async () => {
      await Promise.all([...pending]);
      const title = (
        (doc.root as { title?: Text } | null)?.title?.toString().trim() ||
        "Untitled"
      ).slice(0, 500);
      if (doc.meta?.title !== title) collection.setDocMeta(doc.id, { title });
      await repository.save(object.id, {
        title,
        collection: Array.from(Y.encodeStateAsUpdate(collection.doc)),
        document: Array.from(Y.encodeStateAsUpdate(doc.spaceDoc)),
      });
      onTitle(title);
    }, onStatus);
    collection.doc.on("update", persistence.changed);
    doc.spaceDoc.on("update", persistence.changed);
    const editor = new AffineEditorContainer();
    editor.doc = doc;
    editor.mode = object.kind === "whiteboard" ? "edgeless" : "page";
    if (!saved) {
      persistence.changed();
      await persistence.flush();
    } else onStatus("saved");
    return {
      editor,
      doc,
      collection,
      async flush() {
        // BlobSource writes can precede the editor's block update. Let upload
        // continuations finish before checking the dirty generation.
        while (pending.size) await Promise.all([...pending]);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        await persistence.flush();
      },
      async rename(title: string) {
        title = title.trim();
        if (!title || Array.from(title).length > 500)
          throw new Error("Title must contain 1–500 characters");
        if (doc.root) doc.updateBlock(doc.root, { title: new Text(title) });
        collection.setDocMeta(doc.id, { title });
        await persistence.flush();
      },
      async insert(file: File) {
        if (file.size > 100 * 1024 * 1024)
          throw new Error("Attachment exceeds 100 MiB");
        const note = doc.getBlocksByFlavour("affine:note")[0]?.model;
        if (!note)
          throw new Error("Add a note to the document before inserting a file");
        const key = await doc.blobSync.set(file);
        if (file.type.startsWith("image/"))
          doc.addBlock("affine:image", { sourceId: key }, note);
        else
          doc.addBlock(
            "affine:attachment",
            {
              sourceId: key,
              name: file.name,
              size: file.size,
              type: file.type,
              embed:
                file.type === "application/pdf" &&
                file.size <= 10 * 1024 * 1024,
            },
            note,
          );
        await persistence.flush();
      },
      destroy() {
        editor.remove();
        collection.doc.off("update", persistence.changed);
        doc.spaceDoc.off("update", persistence.changed);
        persistence.dispose();
        doc.dispose();
        collection.forceStop();
        collection.dispose();
        collection.doc.destroy();
      },
    };
  } catch (e) {
    collection.dispose();
    collection.doc.destroy();
    throw e;
  }
}
export type EditorSession = Awaited<ReturnType<typeof openEditor>>;
