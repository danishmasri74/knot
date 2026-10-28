import { effects as registerBlocks } from "@blocksuite/blocks/effects";
import { effects as registerEditors } from "@blocksuite/presets/effects";
import {
  DocCollection,
  Schema,
  Text,
  Job,
  getAssetName,
} from "@blocksuite/store";
import {
  AffineSchemas,
  RefNodeSlotsProvider,
  RefNodeSlotsExtension,
  MarkdownAdapter,
  ExportManager,
} from "@blocksuite/blocks";
import { AffineEditorContainer } from "@blocksuite/presets";
import * as Y from "yjs";
import {
  attachments,
  repository,
  type KnowledgeObject,
  type ExportFormat,
  type ExportFile,
} from "../../../services/workspace";
import {
  SaveCoordinator,
  type SaveStatus,
} from "../../../services/persistence";

import { referenceIds } from "./references";

registerBlocks();
registerEditors();

export async function openEditor(
  object: KnowledgeObject,
  onStatus: (status: SaveStatus, error?: unknown) => void,
  onTitle: (title: string) => void = () => {},
  onNavigate: (id: string) => void = () => {},
  onCatalogChanged: () => void = () => {},
) {
  const catalog = await repository.catalog();
  const known = new Map(catalog.map((item) => [item.id, item]));
  if (!known.has(object.id)) throw new Error("Document no longer exists");
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
    id: "knot-workspace",
    idGenerator: () => crypto.randomUUID(),
    defaultFlags: { enable_synced_doc_block: true },
    schema: new Schema().register(AffineSchemas),
    blobSources: { main: source },
  });
  let cleanup = () => {};
  try {
    // SQL owns workspace identity/title metadata. Legacy collection envelopes are
    // retained for compatibility; only their document bodies enter this collection.
    collection.meta.initialize();
    collection.doc.transact(() => {
      for (const item of catalog)
        collection.meta.addDocMeta({
          id: item.id,
          title: item.title,
          createDate: item.updated_at,
          tags: [],
        });
    });
    const loaded = new Set<string>();
    const envelopes = new Map<string, number[]>();
    const loading = new Map<string, Promise<void>>();
    const dirty = new Set<string>();
    const listeners = new Map<string, () => void>();
    let disposed = false;
    function initialize(id: string, title: string) {
      const target = collection.getDoc(id)!;
      const root = target.addBlock("affine:page", { title: new Text(title) });
      target.addBlock("affine:surface", {}, root);
      const note = target.addBlock("affine:note", {}, root);
      target.addBlock("affine:paragraph", {}, note);
      target.resetHistory();
    }
    function envelope(id: string, title: string) {
      const single = new DocCollection({ id, schema: collection.schema });
      try {
        const previous = envelopes.get(id);
        if (previous) {
          Y.applyUpdate(single.doc, new Uint8Array(previous));
          if (!single.getDoc(id))
            throw new Error(
              "Document metadata is missing. Stored state has been preserved.",
            );
        } else {
          single.meta.initialize();
          single.createDoc({ id });
        }
        single.setDocMeta(id, { title });
        const bytes = Array.from(Y.encodeStateAsUpdate(single.doc));
        envelopes.set(id, bytes);
        return bytes;
      } finally {
        for (const entry of single.docs.values()) entry.dispose();
        single.dispose();
        single.doc.destroy();
      }
    }
    function watch(id: string) {
      const target = collection.getDoc(id)!;
      const changed = () => {
        dirty.add(id);
        persistence.changed();
        void hydrateReferences().catch((e) => onStatus("failed", e));
      };
      target.spaceDoc.on("update", changed);
      listeners.set(id, changed);
    }
    async function hydrate(id: string) {
      if (loaded.has(id) || !known.has(id)) return;
      if (loading.has(id)) return loading.get(id);
      const job = (async () => {
        const state = id === object.id ? saved : await repository.load(id);
        if (disposed) return;
        const target = collection.getDoc(id)!;
        if (state) {
          envelopes.set(id, state.collection);
          envelope(id, known.get(id)!.title);
          Y.applyUpdate(target.spaceDoc, new Uint8Array(state.document));
        }
        target.load();
        if (state && !target.root)
          throw new Error(
            "Document content is damaged or incompatible. Stored state has been preserved.",
          );
        if (!state) initialize(id, known.get(id)!.title);
        loaded.add(id);
        watch(id);
        if (!state) {
          dirty.add(id);
          persistence.changed();
        }
      })();
      loading.set(id, job);
      try {
        await job;
      } finally {
        loading.delete(id);
      }
    }
    async function hydrateReferences() {
      // Walk only reachable bodies; metadata for the rest of the library is cheap.
      // A visited set also handles reciprocal links and self references.
      const visited = new Set<string>();
      for (;;) {
        const ids = [...loaded].filter((id) => !visited.has(id));
        if (!ids.length) return;
        for (const id of ids) {
          visited.add(id);
          const body = collection.getDoc(id)!.spaceDoc.getMap("blocks");
          const targets = referenceIds(body);
          for (const target of targets) await hydrate(target);
        }
      }
    }
    const doc = collection.getDoc(object.id)!;
    const persistence = new SaveCoordinator(async () => {
      await Promise.all([...pending]);
      await hydrateReferences();
      const ids = [...dirty];
      const writes = ids.map((id) => {
        const target = collection.getDoc(id)!;
        if (!target.root)
          throw new Error(
            "A new linked document has not finished initializing. Retry saving.",
          );
        const title = (
          (target.root as { title?: Text } | null)?.title?.toString().trim() ||
          "Untitled"
        ).slice(0, 500);
        collection.setDocMeta(id, { title });
        return {
          id,
          create: !known.has(id),
          snapshot: {
            title,
            collection: envelope(id, title),
            document: Array.from(Y.encodeStateAsUpdate(target.spaceDoc)),
          },
        };
      });
      // Remove before awaiting: changes during the transaction belong to the next generation.
      ids.forEach((id) => dirty.delete(id));
      try {
        await repository.saveMany(writes);
      } catch (error) {
        ids.forEach((id) => dirty.add(id));
        throw error;
      }
      if (writes.some((entry) => entry.create || entry.id !== object.id))
        onCatalogChanged();
      for (const entry of writes) {
        if (!known.has(entry.id))
          known.set(entry.id, {
            id: entry.id,
            title: entry.snapshot.title,
            kind: "note",
            updated_at: Date.now(),
          });
        if (entry.id === object.id) onTitle(entry.snapshot.title);
      }
    }, onStatus);
    cleanup = () => {
      disposed = true;
      persistence.dispose();
      for (const [id, listener] of listeners)
        collection.getDoc(id)?.spaceDoc.off("update", listener);
      for (const entry of collection.docs.values()) entry.dispose();
      collection.forceStop();
    };
    await hydrate(object.id);
    await hydrateReferences();
    const created = collection.slots.docCreated.on((id) => {
      loaded.add(id);
      watch(id);
      dirty.add(id);
      persistence.changed();
    });
    const editor = new AffineEditorContainer();
    editor.doc = doc;
    const refExtension = RefNodeSlotsExtension();
    editor.pageSpecs = [...editor.pageSpecs, refExtension];
    editor.edgelessSpecs = [...editor.edgelessSpecs, refExtension];
    editor.mode = object.kind === "whiteboard" ? "edgeless" : "page";
    const navigation = () =>
      editor.std
        .get(RefNodeSlotsProvider)
        .docLinkClicked.on(({ pageId }) => onNavigate(pageId));
    let navigationSubscription = navigation();
    if (dirty.size) await persistence.flush();
    else onStatus("saved");
    return {
      editor,
      doc,
      collection,
      catalog,
      async exportFiles(format: ExportFormat): Promise<ExportFile[]> {
        if (format === "markdown") {
          const job = new Job({
            collection,
            middlewares: [
              ({ adapterConfigs }) => {
                adapterConfigs.set("docLinkBaseUrl", "knot://document");
                for (const meta of collection.meta.docMetas)
                  adapterConfigs.set(
                    `title:${meta.id}`,
                    meta.title || "Unavailable document",
                  );
              },
            ],
          });
          try {
            const snapshot = job.docToSnapshot(doc);
            if (!snapshot) throw new Error("Document could not be exported");
            const result = await new MarkdownAdapter(job).fromDocSnapshot({
              snapshot,
              assets: job.assetsManager,
            });
            const files: ExportFile[] = [
              {
                name: "index.md",
                bytes: Array.from(new TextEncoder().encode(result.file)),
              },
            ];
            let total = files[0].bytes.length;
            for (const id of new Set(result.assetsIds)) {
              const blob = job.assets.get(id);
              if (!blob) throw new Error("An export attachment is missing");
              total += blob.size;
              if (total > 100 * 1024 * 1024)
                throw new Error("Export exceeds 100 MiB");
              files.push({
                name: `assets/${getAssetName(job.assets, id)}`,
                bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
              });
            }
            return files;
          } finally {
            job.assetsManager.cleanup();
          }
        }
        await document.fonts.ready;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        const root = editor.querySelector("affine-edgeless-root");
        const page = editor.querySelector(".affine-page-root-block-container");
        const bounds =
          editor.mode === "edgeless" ? root?.gfx.elementsBound : null;
        const width = bounds ? bounds.w + 100 : page?.scrollWidth;
        const height = bounds ? bounds.h + 100 : page?.scrollHeight;
        const scale = window.devicePixelRatio || 1;
        if (
          !width ||
          !height ||
          !Number.isFinite(width * height) ||
          width * height * scale * scale > 16_000_000 ||
          Math.max(width, height) * scale > 16000
        )
          throw new Error(
            "View is empty or too large to export. Limit: 16 megapixels and 16,000 pixels per side.",
          );
        // BlockSuite 0.19.5 exposes only browser-download wrappers for page capture.
        // Keep this pinned internal bridge here; native acceptance covers both modes.
        const manager = new ExportManager(editor.std);
        const ready = manager as unknown as { _checkReady(): Promise<boolean> };
        if (root && bounds && !(await ready._checkReady()))
          throw new Error("Images are still loading; retry export.");
        const canvas =
          root && bounds
            ? await manager.edgelessToCanvas(
                root.surface.renderer,
                bounds,
                root,
                undefined,
                root.gfx.getElementsByBound(bounds, { type: "canvas" }),
              )
            : await (
                manager as unknown as {
                  _toCanvas(): Promise<HTMLCanvasElement | undefined>;
                }
              )._toCanvas();
        if (!canvas || !canvas.width || !canvas.height)
          throw new Error("Could not render this view for export");
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Could not prepare export image");
        context.save();
        context.resetTransform();
        context.globalCompositeOperation = "destination-over";
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.restore();
        const png = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (blob) =>
              blob ? resolve(blob) : reject(new Error("Image encoding failed")),
            "image/png",
          ),
        );
        let bytes = new Uint8Array(await png.arrayBuffer());
        if (format === "pdf") {
          const { PDFDocument } = await import("pdf-lib");
          const pdf = await PDFDocument.create();
          const image = await pdf.embedPng(bytes);
          const page = pdf.addPage([
            canvas.width / scale,
            canvas.height / scale,
          ]);
          page.drawImage(image, {
            x: 0,
            y: 0,
            width: page.getWidth(),
            height: page.getHeight(),
          });
          pdf.setTitle(doc.meta?.title || "Untitled");
          bytes = new Uint8Array(await pdf.save());
        }
        if (bytes.length > 100 * 1024 * 1024)
          throw new Error("Export exceeds 100 MiB");
        return [{ name: `document.${format}`, bytes: Array.from(bytes) }];
      },
      setMode(mode: "page" | "edgeless") {
        navigationSubscription.dispose();
        editor.mode = mode;
        navigationSubscription = navigation();
      },
      async reference(id: string, shared: boolean) {
        if (id === object.id || !known.has(id))
          throw new Error("Choose another document");
        if (shared && known.get(id)?.kind !== "note")
          throw new Error("Choose a note to share");
        await hydrate(id);
        await hydrateReferences();
        const parent =
          editor.mode === "edgeless"
            ? doc.getBlocksByFlavour("affine:surface")[0]?.model
            : doc.getBlocksByFlavour("affine:note")[0]?.model;
        if (!parent) throw new Error("Add a note before inserting a reference");
        doc.captureSync();
        const occupied = [
          "affine:note",
          "affine:embed-synced-doc",
          "affine:embed-linked-doc",
        ] as const;
        let y = 0;
        for (const flavour of occupied)
          for (const { model } of doc.getBlocksByFlavour(flavour)) {
            if ("xywh" in model && typeof model.xywh === "string") {
              const bounds: unknown = JSON.parse(model.xywh);
              if (
                Array.isArray(bounds) &&
                bounds.length === 4 &&
                bounds.every(Number.isFinite)
              )
                y = Math.max(y, bounds[1] + bounds[3] + 40);
            }
          }
        doc.addBlock(
          shared ? "affine:embed-synced-doc" : "affine:embed-linked-doc",
          {
            pageId: id,
            style: shared ? "syncedDoc" : "vertical",
            xywh: `[0,${y},364,390]`,
          },
          parent,
        );
        editor
          .querySelector("affine-edgeless-root")
          ?.service.viewport.setCenter(182, y + 195);
        await persistence.flush();
      },
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
        disposed = true;
        editor.remove();
        created.dispose();
        navigationSubscription.dispose();
        for (const [id, listener] of listeners)
          collection.getDoc(id)?.spaceDoc.off("update", listener);
        persistence.dispose();
        for (const entry of collection.docs.values()) entry.dispose();
        collection.forceStop();
        collection.dispose();
        collection.doc.destroy();
      },
    };
  } catch (e) {
    cleanup();
    collection.dispose();
    collection.doc.destroy();
    throw e;
  }
}
export type EditorSession = Awaited<ReturnType<typeof openEditor>>;
