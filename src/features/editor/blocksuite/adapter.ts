import { observeMcqMenu } from "./mcq-menu";
import { BookmarkPreviewSpec } from "./bookmark";
import { McqEditConflict, PendingMcqSave, captureMcqTarget, captureNoteMcqTarget, prepareMcqInsertion, type McqDestination, type McqInsertionTarget } from "./mcq-insertion";
import { observeFloatingToc } from "./floating-toc";
import type { NoteView } from "../../../services/note-navigation";
import { createSearchReveal } from "./search-reveal";
import { createNotePageView } from "./note-page-view";
import { waitForEditorView } from "../../../app/view-readiness";
import { openCardMenu } from "./card-menu";
import { CardDeck, cardEmbedFlavour, cardInsertion, cardMcq, cardMedia, cardQuestionReferences, mcqReferenceFlavour, resolveDeckMcq, standaloneMedia, type DeckData } from "./card-deck";
import { mediaSize } from "./media-cards";
import { McqReferenceSchema, McqSchema, McqSpec, mcqContexts, mcqDecks } from "./mcq-block";
import { CardEmbedSchema, CardEmbedSpec } from "./card-embed";
import { NotebookQuizProgress } from "../../quiz/progress";
import { publishMcq, type McqDefinition, type McqMutation } from "../../quiz/mcq";
import { exportCitedExcerpts, exportDecks } from "./cited-excerpt-adapters";
import { WebSourceSchema, WebSourceSpec } from "./web-source";
import {
  CitedExcerptSchema,
  CitedExcerptSpec,
  migrateCitedExcerpts,
  unlinkExcerpt,
  type CitedExcerptModel,
} from "./cited-excerpt";
import { type PdfCitation } from "./pdf-highlights";
import { observeEditorPreferences } from "../../../services/editor-preferences";
import { observeCanvasImages } from "./canvas-images";
import { observeCanvasNotePreviews } from "./canvas-note-preview";
import {
  placeInView,
  rememberCanvasViewport,
  revealInViewport,
} from "./canvas-viewport";
import { observeCanvasAttachments } from "./canvas-attachments";
import { observePdfToolbars } from "./pdf-toolbar";
import { normalizeMediaFile, mediaImageSize } from "./media";
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
  focusTextModel,
  type AttachmentBlockModel,
  type ImageBlockModel,
  type NoteBlockModel,
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
import {
  NotebookLinkSpec,
  notebookLinkHeight,
  notebookLinkWidth,
  registerNotebookLinks,
} from "./notebook-link";
import { UnsharedSpec, registerUnsharedPlacements, unsharedTitle } from "./unshared";
import {
  parsePdfSourceUrl,
  pdfSourceUrl,
  validatePdfHighlight,
  type PdfHighlight,
  type PdfLocation,
  type PdfSource,
} from "./pdf-highlights";

registerBlocks();
registerEditors();
registerNotebookLinks();
registerUnsharedPlacements();

export type NotebookLinkPlacement =
  | { kind: "edgeless"; x: number; y: number }
  | { kind: "page"; parent: string; index: number };

export async function openEditor(
  object: KnowledgeObject,
  onStatus: (status: SaveStatus, error?: unknown) => void,
  onTitle: (title: string) => void = () => {},
  onNavigate: (id: string) => void = () => {},
  onCatalogChanged: () => void = () => {},
  onPdfNavigate: (location: PdfLocation) => void = () => {},
  deckOnly = false,
  workspace = "knot-workspace",
  initialView?: NoteView,
) {
  const catalog = await repository.catalog();
  if (deckOnly) catalog.push(object);
  const known = new Map(catalog.map((item) => [item.id, item]));
  if (!known.has(object.id)) throw new Error("Document no longer exists");
  const saved = deckOnly ? null : await repository.load(object.id);
  const deckData = JSON.parse(await repository.loadCardDeck()) as DeckData;
  const pending = new Set<Promise<unknown>>();
  const blobSource = (owner: string) => ({
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
          owner,
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
    list: () => attachments.list(owner),
  });
  const source = blobSource(object.id);
  const collection = new DocCollection({
    id: workspace,
    idGenerator: () => crypto.randomUUID(),
    defaultFlags: { enable_synced_doc_block: true },
    schema: new Schema().register([
      ...AffineSchemas.map((schema) =>
        schema.model.flavour === "affine:note"
          ? {
              ...schema,
              model: {
                ...schema.model,
                children: [
                  ...(schema.model.children ?? []),
                  "knot:cited-excerpt",
                  "knot:web-source",
                  "knot:mcq",
                  mcqReferenceFlavour,
                  cardEmbedFlavour,
                ],
              },
            }
          : schema,
      ),
      CitedExcerptSchema,
      WebSourceSchema,
      McqSchema,
      McqReferenceSchema,
      CardEmbedSchema,
    ]),
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
    const topicSaving = new Set<string>();
    let topicTextVersion = 0;
    const listeners = new Map<
      string,
      (
        update: Uint8Array,
        origin: unknown,
        doc: Y.Doc,
        transaction: Y.Transaction,
      ) => void
    >();
    let disposed = false;
    const cardDeck = new CardDeck(deckData, () => persistence.changed(), workspace);
    exportDecks.set(collection, cardDeck);
    let topicDeckSaved = JSON.parse(JSON.stringify(cardDeck.data)) as DeckData;
    function initialize(id: string, title: string) {
      const target = collection.getDoc(id)!;
      const root = target.addBlock("affine:page", { title: new Text(title) });
      target.addBlock("affine:surface", {}, root);
      if (!deckOnly || id !== object.id) {
        const note = target.addBlock("affine:note", {}, root);
        target.addBlock("affine:paragraph", {}, note);
      }
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
      const changed = (
        _update: Uint8Array,
        _origin: unknown,
        _doc: Y.Doc,
        transaction: Y.Transaction,
      ) => {
        const geometryOnly = [...transaction.changed].every(
          ([type, keys]) =>
            type instanceof Y.Map &&
            type.get("sys:flavour") === "affine:note" &&
            keys.size === 1 &&
            keys.has("prop:xywh"),
        );
        if (!geometryOnly) topicTextVersion++;
        if (!deckOnly || id !== object.id) dirty.add(id);
        persistence.changed();
        void hydrateReferences(id).catch((e) => onStatus("failed", e));
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
        migrateCitedExcerpts(target);
        mcqDecks.set(target.spaceDoc, cardDeck);
        cardDeck.attach(target.spaceDoc);
        target.resetHistory();
        if (!state && (!deckOnly || id !== object.id)) {
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
    async function hydrateReferences(start = object.id) {
      // Walk only reachable bodies; metadata for the rest of the library is cheap.
      // A visited set also handles reciprocal links and self references.
      const visited = new Set<string>();
      const queue = [start];
      while (queue.length) {
        const id = queue.pop()!;
        if (visited.has(id) || !loaded.has(id)) continue;
        visited.add(id);
        const body = collection.getDoc(id)!.spaceDoc.getMap("blocks");
        for (const target of referenceIds(body)) {
          await hydrate(target);
          queue.push(target);
        }
      }
    }
    const doc = collection.getDoc(object.id)!;
    const quizWrites = new Map<string, McqMutation>();
    let publishedDraft: string | undefined;
    type Publication = { id: string; placement?: string; focus?: () => void; next?: McqInsertionTarget };
    let pendingPublication: { key: string; value: Publication } | undefined;
    let publishing = false;
    async function publish(key: string, mutate: () => Publication, draftId?: string) {
      if (disposed) throw Error("The original editor is closed.");
      if (publishing) throw Error("A question is already saving.");
      publishing = true;
      try {
        if (pendingPublication && pendingPublication.key !== key)
          throw Error("Retry the previous question save first.");
        if (!pendingPublication) {
          await persistence.flush();
          if (disposed) throw Error("The original editor is closed.");
          pendingPublication = { key, value: mutate() };
          publishedDraft = draftId;
          persistence.changed();
        }
        try {
          await persistence.flush();
        } catch (cause) {
          throw new PendingMcqSave("Could not save the question. " + String(cause));
        }
        const value = pendingPublication.value;
        pendingPublication = undefined;
        return value;
      } finally {
        publishing = false;
      }
    }
    function inlineInsertion(target: McqInsertionTarget) {
      if (deckOnly || target.editor.doc !== doc ||
          (target.editor !== editor && ![...noteViews].some((view) => view.editor === target.editor)))
        throw Error("The original editor is unavailable.");
      return prepareMcqInsertion(target);
    }
    let savedDeckText = JSON.stringify(cardDeck.data);
    const quizProgress = deckOnly ? undefined : new NotebookQuizProgress(
      object.id,
      async (entry) => {
        const card = cardDeck.data[entry.cardId];
        const definition = card?.deleted ? undefined : cardMcq(card);
        if (definition?.gradingRevision !== entry.revision)
          throw Error("This question changed. Answer the current version.");
        // Finish retrying the same operation before accepting another one.
        if (!quizWrites.has(entry.cardId)) {
          quizWrites.set(entry.cardId, entry);
          persistence.changed();
        }
        await persistence.flush();
        const latest = cardDeck.data[entry.cardId];
        if (latest?.deleted || cardMcq(latest)?.gradingRevision !== entry.revision)
          throw Error("This question changed. Answer the current version.");
      },
      () => persistence.flush(),
    );
    if (quizProgress) mcqContexts.set(doc.spaceDoc, quizProgress);
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
      const savedDeck = JSON.stringify(cardDeck.data);
      const quiz = [...quizWrites.values()].filter((entry) => {
        const card = cardDeck.data[entry.cardId];
        if (!card?.deleted && cardMcq(card)?.gradingRevision === entry.revision) return true;
        quizWrites.delete(entry.cardId);
        return false;
      });
      const draft = publishedDraft;
      ids.forEach((id) => topicSaving.add(id));
      try {
        const answersOnly = !writes.length && quiz.length > 0 && savedDeck === savedDeckText && !draft;
        await repository.saveMany(writes, answersOnly ? undefined : savedDeck, quiz, draft);
        if (savedDeck !== savedDeckText) {
          savedDeckText = savedDeck;
          topicDeckSaved = JSON.parse(savedDeck) as DeckData;
        }
        for (const entry of quiz)
          if (quizWrites.get(entry.cardId) === entry) quizWrites.delete(entry.cardId);
        if (draft === publishedDraft) publishedDraft = undefined;
      } catch (error) {
        ids.forEach((id) => dirty.add(id));
        throw error;
      } finally {
        ids.forEach((id) => topicSaving.delete(id));
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
      cardDeck.dispose();
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
      const body = collection.getDoc(id)!.spaceDoc;
      mcqDecks.set(body, cardDeck);
      cardDeck.attach(body);
      dirty.add(id);
      persistence.changed();
    });
    const noteViews = new Set<Awaited<ReturnType<typeof createNotePageView>>>();
    const editor = new AffineEditorContainer();
    const placeCard = (id: string, point?: { x: number; y: number }) => {
      const canvas = editor.querySelector("affine-edgeless-root");
      if (!canvas) return;
      const viewport = canvas.gfx.viewport;
      const center = point
        ? viewport.toModelCoord(
            ...viewport.toViewCoordFromClientCoord([point.x, point.y]),
          )
        : [viewport.center.x, viewport.center.y];
      let placement: string | undefined;
      const media = cardMedia(cardDeck.data[id]);
      if (media) {
        // The same kind of object as the card, in the view it has elsewhere.
        const surface = doc.getBlocksByFlavour("affine:surface")[0]?.model;
        if (!surface) return;
        const shown = cardDeck.placementStyle(id);
        const [width, height] = mediaSize(media.flavour, media.get, shown?.style);
        const props: Record<string, unknown> = {
          xywh: `[${center[0] - width / 2},${center[1] - height / 2},${width},${height}]`,
        };
        if (typeof shown?.style === "string") props.style = shown.style;
        if (typeof shown?.embed === "boolean") props.embed = shown.embed;
        cardDeck.place(doc.spaceDoc, id, () => {
          placement = doc.addBlock(media.flavour, props, surface.id);
          return placement;
        });
        return placement;
      }
      cardDeck.place(doc.spaceDoc, id, () => {
        placement = doc.addBlock(
          "affine:note",
          { xywh: `[${center[0]},${center[1]},448,240]` },
          doc.root!.id,
        );
        return placement;
      });
      return placement;
    };
    /** Reuse a card inside a note: at a captured cursor, after a block, or
     * at the end of the note Page view shows. */
    const insertCard = (
      id: string,
      at?: McqInsertionTarget | { after: string },
    ) => {
      const card = cardDeck.data[id];
      const insertion = cardInsertion(card);
      if (!insertion) throw Error("This card is no longer available.");
      const links = doc.spaceDoc.getMap<string>("knot:card-links");
      const noteOf = (blockId: string) => doc.getParent(blockId)?.id;
      if (at && "after" in at) {
        const note = doc.getParent(at.after);
        if (!note || note.flavour !== "affine:note")
          throw Error("Drop the card inside a note.");
        if (insertion.flavour === cardEmbedFlavour && links.get(note.id) === id)
          throw Error("A card can't be shown inside itself.");
        const index = note.children.findIndex((child) => child.id === at.after);
        doc.captureSync();
        doc.addBlock(insertion.flavour as never, insertion.props, note, index + 1);
        doc.captureSync();
        return;
      }
      const target =
        at ??
        captureMcqTarget(editor) ??
        (revealedNoteId ? captureNoteMcqTarget(editor, revealedNoteId) : undefined);
      if (!target) throw Error("Put the cursor in a note's paragraph first.");
      if (
        insertion.flavour === cardEmbedFlavour &&
        links.get(noteOf(target.anchorId) ?? "") === id
      )
        throw Error("A card can't be shown inside itself.");
      const insert = prepareMcqInsertion(target, () => insertion);
      insert(id).focus();
    };
    const dragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("application/x-knot-card")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        event.dataTransfer.dropEffect = "copy";
      }
    };
    const dropCard = (event: DragEvent) => {
      const id = event.dataTransfer?.getData("application/x-knot-card");
      if (id) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (editor.mode === "page") {
          // Into the note, after the block it was dropped on.
          const element = event
            .composedPath()
            .find(
              (node): node is HTMLElement =>
                node instanceof HTMLElement &&
                !!node.dataset.blockId &&
                doc.getParent(node.dataset.blockId)?.flavour === "affine:note",
            );
          const model = element && doc.getBlock(element.dataset.blockId!)?.model;
          try {
            insertCard(id, model ? { after: model.id } : undefined);
          } catch (e) {
            onStatus("failed", e);
          }
          return;
        }
        placeCard(id, { x: event.clientX, y: event.clientY });
      }
    };
    let closeCardMenu = () => {};
    const cardContext = (event: MouseEvent) => {
      // The innermost card: a note, or a video, link, file or image placed
      // directly on the canvas (one inside a note belongs to the note).
      const links = doc.spaceDoc.getMap<string>("knot:card-links");
      const standalone = standaloneMedia(doc.spaceDoc);
      const element = event
        .composedPath()
        .find(
          (node): node is HTMLElement =>
            node instanceof HTMLElement &&
            (node.matches("affine-edgeless-note, affine-note") ||
              standalone.has(node.getAttribute("data-block-id") ?? "")),
        );
      const id = element?.getAttribute("data-block-id");
      const shared = id && links.get(id);
      if (!shared) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeCardMenu();
      closeCardMenu = openCardMenu(event.clientX, event.clientY, [
        {
          label: "Remove from this whiteboard",
          run: () => {
            const block = doc.getBlock(id!);
            if (block) doc.deleteBlock(block.model);
          },
        },
        {
          label: "Move to Trash",
          trash: true,
          run: () => cardDeck.delete(shared),
        },
      ]);
    };
    editor.addEventListener("dragover", dragOver, true);
    editor.addEventListener("drop", dropCard, true);
    editor.addEventListener("contextmenu", cardContext, true);
    const stopEditorPreferences = observeEditorPreferences(editor);
    editor.doc = doc;
    const stopFloatingToc = observeFloatingToc(editor);
    const stopMcqMenu = observeMcqMenu(editor, !deckOnly);
    const searchReveal = createSearchReveal(editor);
    const canvasViewport = rememberCanvasViewport(editor, doc.id);
    const stopCanvasNotePreviews = observeCanvasNotePreviews(editor);
    const stopCanvasImages = observeCanvasImages(editor);
    const stopCanvasAttachments = observeCanvasAttachments(editor);
    const stopPdfToolbars = observePdfToolbars(editor, onPdfNavigate);
    const pdfClick = (event: MouseEvent) => {
      const anchor = event
        .composedPath()
        .find(
          (node): node is HTMLAnchorElement =>
            node instanceof HTMLAnchorElement,
        );
      if (!anchor || !anchor.href.startsWith("https://knot.invalid/pdf"))
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      try {
        const location = parsePdfSourceUrl(anchor.href);
        if (location)
          onPdfNavigate({
            ...location,
            blockId:
              anchor
                .closest("knot-cited-excerpt")
                ?.getAttribute("data-block-id") ?? undefined,
          });
      } catch (e) {
        onStatus("failed", e);
      }
    };
    const refExtension = RefNodeSlotsExtension();
    editor.pageSpecs = [
      ...editor.pageSpecs,
      BookmarkPreviewSpec,
      NotebookLinkSpec,
      UnsharedSpec,
      ...CitedExcerptSpec,
      ...WebSourceSpec,
      ...McqSpec,
      ...CardEmbedSpec,
      refExtension,
    ];
    editor.edgelessSpecs = [
      ...editor.edgelessSpecs,
      BookmarkPreviewSpec,
      NotebookLinkSpec,
      UnsharedSpec,
      ...CitedExcerptSpec,
      ...WebSourceSpec,
      ...McqSpec,
      ...CardEmbedSpec,
      refExtension,
    ];
    // The notebook's main editor is its canvas. Notes open in their own
    // Note tabs (createNotePageView); the Card Deck still uses page mode.
    void initialView;
    editor.mode = deckOnly ? "page" : "edgeless";
    const navigation = () =>
      editor.std
        .get(RefNodeSlotsProvider)
        .docLinkClicked.on(({ pageId }) => onNavigate(pageId));
    let navigationSubscription = navigation();
    let revealedNoteId: string | null = null;
    const patchedRoots = new WeakSet<Element>();
    /** The paragraph of the note Page view shows, when that note has no text
     * yet: the revealed note, or a page whose only note is still empty. */
    const emptyRevealedParagraph = () => {
      if (editor.mode !== "page") return null;
      const notes = revealedNoteId
        ? [doc.getBlock(revealedNoteId)?.model as NoteBlockModel | undefined]
        : doc
            .getBlocksByFlavour("affine:note")
            .map(({ model }) => model as NoteBlockModel)
            .filter((note) => note.displayMode !== "edgeless");
      const note = notes.length === 1 ? notes[0] : undefined;
      const only = note?.children.length === 1 ? note.children[0] : null;
      const text = (only as { text?: Text } | null)?.text;
      return only?.flavour === "affine:paragraph" && text && text.length === 0 ? only.id : null;
    };
    // Page view shows one note. While it's empty, keep BlockSuite's own
    // "Type '/' for commands" hint visible so the page doesn't look blank.
    const syncEmptyNote = () =>
      editor.toggleAttribute("data-knot-empty-note", emptyRevealedParagraph() !== null);
    doc.spaceDoc.on("update", syncEmptyNote);
    /** Put the cursor in the revealed note if it's empty. */
    const focusEmptyNote = () => {
      const paragraph = emptyRevealedParagraph();
      if (paragraph) focusTextModel(editor.std, paragraph);
    };
    async function showView(
      mode: "page" | "edgeless",
      noteId: string | null = null,
    ) {
      const nextNoteId = mode === "page" ? noteId : null;
      if (editor.mode === mode && revealedNoteId === nextNoteId) return;
      revealedNoteId = nextNoteId;
      editor.std.selection.clear();
      if (editor.mode !== mode) {
        navigationSubscription.dispose();
        if (mode === "edgeless") canvasViewport.prepare();
        editor.mode = mode;
        navigationSubscription = navigation();
      }
      await editor.updateComplete;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      const root = editor.querySelector("affine-page-root");
      if (mode === "page" && root) {
        if (!patchedRoots.has(root)) {
          // Pinned BlockSuite 0.19.5 view bridge: focus only in this editor,
          // never change the persisted note displayMode or its undo history.
          const renderChildren = root.renderChildren;
          const render: typeof renderChildren = (model, filter) =>
            renderChildren(model, (child) =>
              revealedNoteId
                ? child.id === revealedNoteId
                : !filter || filter(child),
            );
          Object.defineProperty(root, "renderChildren", {
            configurable: true,
            value: render,
          });
          patchedRoots.add(root);
        }
        root.requestUpdate();
        await root.updateComplete;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        editor.querySelector("doc-title")?.scrollIntoView({ block: "start" });
      }
      syncEmptyNote();
    }
    // BlockSuite deletes selected Canvas objects through the document model.
    // WebView can then send a second, native deletion to the contenteditable
    // root using a stale DOM range. That edit bypasses Lit's rendering state.
    const preventCanvasDomDelete = (event: InputEvent) => {
      const root = event.target;
      if (
        root instanceof HTMLElement &&
        root.matches("affine-edgeless-root") &&
        !editor.querySelector("affine-edgeless-root")?.gfx.selection.editing &&
        (event.inputType === "deleteContentForward" ||
          event.inputType === "deleteContentBackward")
      )
        event.preventDefault();
    };
    editor.addEventListener("beforeinput", preventCanvasDomDelete, true);
    const selectVisibleNotes = (event: KeyboardEvent) => {
      if (
        !revealedNoteId ||
        editor.mode !== "page" ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== "a" ||
        event.altKey
      )
        return;
      // Select only the focused note's content, never its hidden siblings.
      if (
        !(event.target instanceof Element) ||
        event.target.closest("doc-title") ||
        !event.target.closest("affine-page-root")
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const blocks = doc
        .getBlocksByFlavour("affine:note")
        .map(({ model }) => model as NoteBlockModel)
        .filter((note) => note.id === revealedNoteId)
        .flatMap((note) =>
          note.children.map((child) =>
            editor.std.selection.create("block", { blockId: child.id }),
          ),
        );
      editor.std.selection.setGroup("note", blocks);
    };
    editor.addEventListener("keydown", selectVisibleNotes, true);
    if (dirty.size) await persistence.flush();
    else onStatus("saved");
    // Include BlockSuite's link popup, which may be mounted outside the editor.
    document.addEventListener("click", pdfClick, true);
    document.addEventListener("auxclick", pdfClick, true);
    return {
      editor,
      async createNotePageView(noteId: string, host: HTMLElement) {
        if (disposed) throw new Error("Document is unavailable.");
        const note = doc.getBlock(noteId)?.model as NoteBlockModel | undefined;
        if (note?.flavour !== "affine:note")
          throw new Error("This note is unavailable.");
        if (doc.readonly || note.isLocked())
          throw new Error("This note is locked.");
        const view = await createNotePageView(editor, noteId, host, onNavigate);
        if (disposed) {
          view.dispose();
          throw new Error("Document is unavailable.");
        }
        const stopPdf = observePdfToolbars(view.editor, onPdfNavigate);
        const stopMcq = observeMcqMenu(view.editor);
        const entry = {
          ...view,
          dispose() {
            stopMcq();
            stopPdf();
            view.dispose();
            noteViews.delete(entry);
          },
        };
        noteViews.add(entry);
        return entry;
      },
      async createCardPageView(cardId: string, host: HTMLElement) {
        if (disposed || !cardDeck.data[cardId] || cardDeck.data[cardId].deleted)
          throw new Error("This card is unavailable.");
        if (cardDeck.data[cardId].media)
          throw new Error("Open this card on its canvas to change it.");
        // A temporary editing document is never a notebook or a saved placement.
        const temporary = new DocCollection({
          id: workspace,
          schema: collection.schema,
          blobSources: { main: blobSource(`knot:card:${cardId}`) },
        });
        exportDecks.set(temporary, cardDeck);
        temporary.meta.initialize();
        for (const item of catalog) {
          if (deckOnly && item.id === object.id) continue;
          temporary.meta.addDocMeta({ id: item.id, title: item.title, createDate: item.updated_at, tags: [] });
        }
        const target = temporary.createDoc();
        target.load();
        const root = target.addBlock("affine:page", { title: new Text("") });
        target.addBlock("affine:surface", {}, root);
        let noteId = "";
        cardDeck.place(target.spaceDoc, cardId, () => {
          noteId = target.addBlock("affine:note", {}, root);
          return noteId;
        });
        mcqDecks.set(target.spaceDoc, cardDeck);
        const detach = cardDeck.attach(target.spaceDoc, true);
        target.resetHistory();
        const main = new AffineEditorContainer();
        main.pageSpecs = editor.pageSpecs;
        main.doc = target;
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          detach();
          target.dispose();
          temporary.forceStop();
          temporary.dispose();
          temporary.doc.destroy();
        };
        try {
          const view = await createNotePageView(main, noteId, host, onNavigate);
          const stopPdf = observePdfToolbars(view.editor, onPdfNavigate);
          const stopMcq = observeMcqMenu(view.editor, false);
          const stopToc = observeFloatingToc(view.editor);
          let closed = false;
          const entry = {
            ...view,
            dispose() {
              if (closed) return;
              closed = true;
              stopToc();
              stopMcq();
              stopPdf();
              view.dispose();
              release();
              noteViews.delete(entry);
            },
          };
          if (disposed) {
            entry.dispose();
            throw new Error("Document is unavailable.");
          }
          noteViews.add(entry);
          return entry;
        } catch (error) {
          release();
          throw error;
        }
      },
      cardDeck,
      publishQuestion(draft: McqDefinition, draftId: string, options: {
        cardId?: string;
        expected?: McqDefinition;
        destination: McqDestination;
      }) {
        return publish(draftId, () => {
          const previous = resolveDeckMcq(cardDeck.data, options.cardId);
          if (options.cardId && (!previous || JSON.stringify(previous) !== JSON.stringify(options.expected)))
            throw new McqEditConflict("This question changed while you were editing.");
          const definition = publishMcq(draft, previous);
          const insert = options.destination.kind === "inline" ?
            inlineInsertion(options.destination.target) : undefined;
          const id = cardDeck.writeMcq(definition, options.cardId);
          if (insert) return { id, ...insert(id) };
          let placement: string | undefined;
          if (options.destination.kind === "standalone" && !deckOnly) {
            doc.captureSync();
            placement = placeCard(id);
            if (!placement) cardDeck.place(doc.spaceDoc, id, () => {
              placement = doc.addBlock("affine:note", {}, doc.root!.id);
              return placement;
            });
            doc.captureSync();
          }
          return { id, placement };
        }, draftId);
      },
      insertQuestion(cardId: string, target: McqInsertionTarget, operationId: string) {
        return publish(operationId, () => {
          if (!resolveDeckMcq(cardDeck.data, cardId))
            throw Error("This question is unavailable.");
          return { id: cardId, ...inlineInsertion(target)(cardId) };
        });
      },
      quizProgress,
      topicVersion() {
        return `${doc.id}:${topicTextVersion}:${cardDeck.contentVersion}`;
      },
      topicOverlay() {
        const documents = [...new Set([...dirty, ...topicSaving])].map((id) => {
          const target = collection.getDoc(id);
          return {
            id,
            snapshot: target?.root
              ? {
                  collection: envelope(id, target.meta?.title || "Untitled"),
                  document: Array.from(Y.encodeStateAsUpdate(target.spaceDoc)),
                }
              : null,
          };
        });
        const cards = Object.entries(cardDeck.data)
          .filter(
            ([id, card]) =>
              JSON.stringify(card) !== JSON.stringify(topicDeckSaved[id]) ||
            [...cardQuestionReferences(card.nodes)].some((question) =>
              JSON.stringify(cardDeck.data[question]) !== JSON.stringify(topicDeckSaved[question])) ,
          )
          .map(([id, card]) => {
            const owner = [...loaded]
              .sort()
              .flatMap((owner) =>
                [
                  ...(collection
                    .getDoc(owner)
                    ?.spaceDoc.getMap<string>("knot:card-links") ?? []),
                ]
                  .filter(
                    ([placement, shared]) =>
                      shared === id &&
                      collection
                        .getDoc(owner)
                        ?.root?.children.some((note) => note.id === placement),
                  )
                  .map(([placement]) => ({ document: owner, placement })),
              )
              .at(0);
            return {
              id: `deck:${id}`,
              card: JSON.parse(JSON.stringify(card)) as DeckData[string],
              owner,
            };
          });
        return { documents, cards, deck: cardDeck.data };
      },
      async enrollWorkspaceCards() {
        for (const item of catalog) {
          if (disposed) return 0;
          await hydrate(item.id);
        }
        // Once per workspace: blank cards left over before the deck stopped
        // listing them go to Trash (restorable), if no canvas uses them.
        let cleaned = 0;
        const key = `knot.cleanup.blank-cards.${workspace}`;
        try {
          if (!localStorage.getItem(key)) {
            cleaned = cardDeck.trashBlankUnplaced();
            localStorage.setItem(key, "done");
          }
        } catch {
          // Without storage, skip the cleanup rather than repeat it.
        }
        await persistence.flush();
        return cleaned;
      },
      cardCanvas: doc.spaceDoc.guid,
      placeCard,
      insertCard,
      /** Where the cursor is in Page view, kept for inserting a card later. */
      captureInsertionTarget: () =>
        editor.mode === "page" ? captureMcqTarget(editor) : undefined,
      doc,
      collection,
      catalog,
      /** Cursor into the note Page view shows, if it's still empty. */
      focusEmptyNote,
      get revealedNoteId() {
        return revealedNoteId;
      },
      notebookNotes() {
        const notes = doc
          .getBlocksByFlavour("affine:note")
          .map(({ model }, index) => {
            const note = model as NoteBlockModel;
            let title: string | undefined;
            for (const child of note.children) {
              const text = child.text?.toString();
              if (text?.trim()) {
                title = text;
                break;
              }
            }
            return {
              id: note.id,
              title: title?.trim().slice(0, 80) || `Note ${index + 1}`,
              canvasOnly: note.displayMode === "edgeless",
              target: null as string | null,
            };
          });
        for (const { model } of doc.getBlocksByFlavour(
          "affine:embed-synced-doc",
        )) {
          const target = "pageId" in model ? String(model.pageId) : "";
          notes.push({
            id: model.id,
            title:
              known.get(target)?.title ||
              (unsharedTitle(target) ? `${unsharedTitle(target)} (not shared)` : "Unavailable shared note"),
            canvasOnly: false,
            target,
          });
        }
        return notes;
      },
      /** Adds a note and returns its id. */
      async addNotebookNote(): Promise<string> {
        if (!doc.root) throw new Error("Document is unavailable");
        await persistence.flush();
        const notes: { x: number; y: number; w: number; h: number }[] = [];
        for (const { model } of doc.getBlocksByFlavour("affine:note")) {
          const bounds: unknown = JSON.parse((model as NoteBlockModel).xywh);
          if (
            Array.isArray(bounds) &&
            bounds.length === 4 &&
            bounds.every(Number.isFinite)
          )
            notes.push({ x: bounds[0], y: bounds[1], w: bounds[2], h: bounds[3] });
        }
        const size = { w: 448, h: 200 };
        // On the canvas, the note goes where you're looking and you stay
        // there. From Page view it goes after the last note, as before.
        const canvas =
          editor.mode === "edgeless"
            ? editor.querySelector("affine-edgeless-root")
            : null;
        const { x, y } = canvas
          ? placeInView(canvas.gfx.viewport, size, notes)
          : { x: Math.max(0, ...notes.map((n) => n.x + n.w + 40)), y: 0 };
        let id = "";
        let paragraph = "";
        doc.captureSync();
        doc.transact(() => {
          id = doc.addBlock(
            "affine:note",
            { xywh: `[${x},${y},${size.w},${size.h}]` },
            doc.root,
          );
          paragraph = doc.addBlock("affine:paragraph", { text: new Text() }, id);
        });
        doc.captureSync();
        if (canvas?.isConnected) {
          canvas.gfx.selection.set({ elements: [id], editing: true });
          await canvas.updateComplete;
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          revealInViewport(canvas.gfx.viewport, { x, y, ...size });
          focusTextModel(canvas.std, paragraph);
        } else {
          await showView("page", id);
          focusEmptyNote();
        }
        await persistence.flush();
        return id;
      },
      async focusCanvasCard(id: string) {
        const note = doc.getBlock(id)?.model as NoteBlockModel | undefined;
        if (!note) throw new Error("This card is no longer available.");
        await showView("edgeless");
        const canvas = editor.querySelector("affine-edgeless-root");
        if (!canvas) throw new Error("Canvas is unavailable.");
        const center = () => {
          const [x, y, width, height] = JSON.parse(note.xywh) as number[];
          canvas.service.viewport.setCenter(x + width / 2, y + height / 2);
        };
        // Bring distant cards into the virtualized viewport, then use their
        // measured bounds once BlockSuite has mounted and sized their content.
        center();
        canvas.gfx.selection.set({ elements: [id], editing: false });
        await waitForEditorView(editor, "edgeless", {
          targetId: note.flavour === "affine:note" ? id : undefined,
        });
        if (editor.mode !== "edgeless" || !canvas.isConnected) return;
        center();
        canvas.gfx.selection.set({ elements: [id], editing: false });
        canvas.focus({ preventScroll: true });
      },
      revealSearchMatch(query: string, noteId?: string) {
        return searchReveal.reveal(query, noteId);
      },
      async focusNotebookNote(id: string) {
        const note = doc.getBlock(id)?.model as NoteBlockModel | undefined;
        if (!note) throw new Error("This note is no longer available.");
        await showView("page", id);
        focusEmptyNote();
      },
      watchPdfCitations(listener: (locations: PdfCitation[]) => void) {
        const refresh = () => {
          const citations = new Map<string, PdfCitation>();
          for (const { model } of doc.getBlocksByFlavour(
            "knot:cited-excerpt",
          )) {
            const excerpt = model as CitedExcerptModel;
            try {
              const location = parsePdfSourceUrl(excerpt.source);
              if (location?.rects.length && excerpt.parent)
                citations.set(excerpt.id, {
                  ...location,
                  noteId: excerpt.parent.id,
                  blockId: excerpt.id,
                  label: excerpt.text.toString(),
                });
            } catch {
              /* Retain other references if one source is damaged. */
            }
          }
          for (const { model } of doc.getBlocksByFlavour("affine:paragraph")) {
            const text = (model as unknown as { text?: Text }).text;
            for (const part of text?.toDelta() ?? []) {
              const href = part.attributes?.link;
              if (
                typeof href !== "string" ||
                !href.startsWith("https://knot.invalid/pdf#")
              )
                continue;
              try {
                const location = parsePdfSourceUrl(href);
                const note = doc.getParent(model);
                if (location?.rects.length && note) {
                  const quote = note.children.find(
                    (child) => (child as { type?: string }).type === "quote",
                  );
                  const label =
                    (quote as unknown as { text?: Text })?.text?.toString() ||
                    text?.toString() ||
                    "Cited passage";
                  citations.set(note.id + href, {
                    ...location,
                    noteId: note.id,
                    label,
                  });
                }
              } catch {
                // An invalid pasted link should not hide other citations.
              }
            }
          }
          listener([...citations.values()]);
        };
        refresh();
        doc.spaceDoc.on("update", refresh);
        return () => {
          doc.spaceDoc.off("update", refresh);
        };
      },
      imageSources() {
        const sources = new Map<string, string>();
        for (const { model } of doc.getBlocksByFlavour("affine:image")) {
          const image = model as ImageBlockModel;
          if (image.sourceId && !sources.has(image.sourceId))
            sources.set(
              image.sourceId,
              image.caption || `Image ${sources.size + 1}`,
            );
        }
        for (const { model } of doc.getBlocksByFlavour("affine:attachment")) {
          const attachment = model as AttachmentBlockModel;
          if (attachment.sourceId && attachment.type?.startsWith("image/"))
            sources.set(attachment.sourceId, attachment.name);
        }
        return Array.from(sources, ([key, name]) => ({ key, name }));
      },
      pdfSources(): PdfSource[] {
        const result = new Map<string, PdfSource>();
        for (const { model } of doc.getBlocksByFlavour("affine:attachment")) {
          const attachment = model as AttachmentBlockModel;
          if (attachment.type === "application/pdf" && attachment.sourceId)
            result.set(attachment.sourceId, {
              key: attachment.sourceId,
              name: attachment.name,
              documentId: doc.id,
            });
        }
        return [...result.values()];
      },
      async replacePdfExcerpt(id: string, value: PdfHighlight) {
        validatePdfHighlight(value);
        await persistence.flush();
        const model = doc.getBlock(id)?.model as CitedExcerptModel | undefined;
        if (model?.flavour !== "knot:cited-excerpt")
          throw new Error("This excerpt is no longer linked.");
        doc.captureSync();
        doc.updateBlock(model, {
          text: new Text(value.quote),
          source: pdfSourceUrl(value),
          reviewed: true,
        });
        doc.captureSync();
        await persistence.flush();
      },
      async detachPdfHighlight(citation: PdfCitation) {
        await persistence.flush();
        const excerpt = citation.blockId
          ? (doc.getBlock(citation.blockId)?.model as
              CitedExcerptModel | undefined)
          : undefined;
        if (!excerpt || excerpt.flavour !== "knot:cited-excerpt")
          throw new Error(
            "This older citation needs review in its note before it can be unlinked.",
          );
        const undo = unlinkExcerpt(doc, excerpt);
        try {
          await persistence.flush();
        } catch (error) {
          undo();
          throw error;
        }
        return async () => {
          undo();
          await persistence.flush();
        };
      },
      async removePdfHighlight(value: PdfLocation, id?: string) {
        await persistence.flush();
        const href = pdfSourceUrl(value);
        const note = doc.getBlocksByFlavour("affine:note").find(({ model }) =>
          id
            ? model.id === id
            : model.id.startsWith("pdf-") &&
              model.children.some((child) => {
                if (child.flavour === "knot:cited-excerpt")
                  return (child as CitedExcerptModel).source === href;
                const text = (child as unknown as { text?: Text }).text;
                return text
                  ?.toDelta()
                  .some((part) => part.attributes?.link === href);
              }),
        );
        if (note) {
          doc.captureSync();
          doc.deleteBlock(note.model);
          doc.captureSync();
        }
        await persistence.flush();
      },
      async pdfHighlight(value: PdfHighlight) {
        validatePdfHighlight(value);
        // Save earlier edits first. A rejected card save keeps the same block ID
        // for a retry, so the reader cannot accidentally insert a duplicate.
        await persistence.flush();
        if (!doc.getBlockById(value.id)) {
          if (!doc.root) throw new Error("Document is unavailable");
          let x = 0;
          for (const { model } of doc.getBlocksByFlavour("affine:note")) {
            const bounds: unknown = JSON.parse((model as NoteBlockModel).xywh);
            if (
              Array.isArray(bounds) &&
              bounds.length === 4 &&
              bounds.every(Number.isFinite)
            )
              x = Math.max(x, bounds[0] + bounds[2] + 40);
          }
          doc.captureSync();
          doc.transact(() => {
            const props = { id: value.id, xywh: `[${x},0,448,240]` as const };
            const note = doc.addBlock("affine:note", props, doc.root);
            doc.addBlock(
              "knot:cited-excerpt",
              {
                text: new Text(value.quote),
                source: pdfSourceUrl(value),
                reviewed: true,
              },
              note,
            );
          });
          doc.captureSync();
          editor
            .querySelector("affine-edgeless-root")
            ?.service.viewport.setCenter(x + 224, 120);
        }
        await persistence.flush();
      },
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
            exportCitedExcerpts(snapshot.blocks, cardDeck);
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
        quizProgress?.setExporting(true);
        try {
          if (editor.mode === "edgeless")
            await waitForEditorView(editor, "edgeless", { content: true });
          await document.fonts.ready;
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
          const root = editor.querySelector("affine-edgeless-root");
          const page = editor.querySelector(
            ".affine-page-root-block-container",
          );
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
          const ready = manager as unknown as {
            _checkReady(): Promise<boolean>;
          };
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
                blob
                  ? resolve(blob)
                  : reject(new Error("Image encoding failed")),
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
        } finally {
          quizProgress?.setExporting(false);
          // Full content is only forced for capture. Restore the current zoom's
          // detail level even when export fails or exceeds the size limit.
          for (const note of editor.querySelectorAll("affine-edgeless-note")) {
            const view = note as typeof note & {
              _knotForced?: boolean;
              requestUpdate(): void;
            };
            view._knotForced = false;
            view.requestUpdate();
          }
        }
      },
      selectedCanvasNoteId() {
        if (editor.mode !== "edgeless") return null;
        const selected = editor.querySelector("affine-edgeless-root")?.gfx
          .selection.selectedElements;
        const note = selected?.length === 1 ? selected[0] : null;
        return note && "flavour" in note && note.flavour === "affine:note"
          ? note.id
          : null;
      },
      async setMode(mode: "page" | "edgeless", openSelection = false) {
        const selected =
          openSelection && mode === "page" && editor.mode === "edgeless"
            ? editor
                .querySelector("affine-edgeless-root")
                ?.gfx.selection.selectedElements.filter(
                  (element) =>
                    "flavour" in element && element.flavour === "affine:note",
                )
            : [];
        await showView(mode, selected?.length === 1 ? selected[0].id : null);
      },
      findCanvasContent() {
        const canvas = editor.querySelector("affine-edgeless-root");
        if (!canvas || editor.mode !== "edgeless") return;
        // Leave room for the recovery button and the native bottom toolbar.
        // Use BlockSuite's bounds so notes, frames, media and drawings all count.
        const viewport = canvas.service.viewport;
        const bounds = canvas.gfx.elementsBound;
        if (!bounds) {
          viewport.setViewport(1, [0, 0]);
          return;
        }
        const zoom = Math.max(
          0.2,
          Math.min(
            1,
            Math.max(1, viewport.width - 96) / Math.max(1, bounds.w),
            Math.max(1, viewport.height - 208) / Math.max(1, bounds.h),
          ),
        );
        if (!Number.isFinite(zoom) || zoom <= 0) return;
        viewport.setViewport(zoom, [
          bounds.x + bounds.w / 2,
          bounds.y + bounds.h / 2 + 24 / zoom,
        ]);
      },
      referencePlacement(point: { x: number; y: number }) {
        const canvas = editor.querySelector("affine-edgeless-root");
        if (editor.mode === "edgeless" && canvas) {
          const viewport = canvas.gfx.viewport;
          const [x, y] = viewport.toModelCoordFromClientCoord([point.x, point.y]);
          return {
            kind: "edgeless" as const,
            x,
            y,
            preview: {
              left: point.x,
              top: point.y,
              width: notebookLinkWidth * viewport.zoom,
              height: notebookLinkHeight * viewport.zoom,
            },
          };
        }
        const hit = document.elementFromPoint(point.x, point.y);
        const hitNote = hit?.closest("affine-note[data-block-id]")?.getAttribute("data-block-id");
        const note = doc.getBlocksByFlavour("affine:note").find(
          ({ model }) => model.id === (hitNote ?? revealedNoteId),
        )?.model ?? doc.getBlocksByFlavour("affine:note")[0]?.model;
        if (!note) return;
        const view = editor.querySelector(`[data-block-id="${CSS.escape(note.id)}"]`);
        if (!view) return;
        const bounds = view.getBoundingClientRect();
        const children = note.children.map((child, index) => ({
          index,
          rect: view.querySelector(`[data-block-id="${CSS.escape(child.id)}"]`)?.getBoundingClientRect(),
        })).filter((child) => child.rect?.height);
        const before = children.find(({ rect }) => point.y < rect!.top + rect!.height / 2);
        return {
          kind: "page" as const,
          parent: note.id,
          index: before?.index ?? note.children.length,
          preview: {
            left: bounds.left,
            top: before?.rect?.top ?? children.at(-1)?.rect?.bottom ?? bounds.top,
            width: bounds.width,
            height: 2,
          },
        };
      },
      async placeNotebookLink(id: string, placement: NotebookLinkPlacement) {
        if (id === object.id || !known.has(id)) throw new Error("Choose another notebook.");
        const parent = placement.kind === "edgeless"
          ? doc.getBlocksByFlavour("affine:surface")[0]?.model
          : doc.getBlock(placement.parent)?.model;
        if (!parent || editor.mode !== placement.kind)
          throw new Error("Choose a position in the current view.");
        doc.captureSync();
        doc.addBlock("affine:embed-linked-doc", {
          pageId: id,
          style: "horizontalThin",
          ...(placement.kind === "edgeless" && {
            xywh: `[${placement.x},${placement.y},${notebookLinkWidth},${notebookLinkHeight}]`,
          }),
        }, parent, placement.kind === "page" ? placement.index : undefined);
        doc.captureSync();
        await persistence.flush();
      },
      async revealNotebookLink(id: string) {
        const block = doc.getBlock(id)?.model;
        if (!block) return;
        let parent = doc.getParent(block);
        if (parent?.flavour === "affine:surface") {
          await this.focusCanvasCard(id);
          return;
        }
        while (parent && parent.flavour !== "affine:note")
          parent = doc.getParent(parent);
        // Inside a note: show that note's card on the canvas.
        if (parent) await this.focusCanvasCard(parent.id);
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
          throw new Error("Title must contain 1â€“500 characters");
        if (doc.root) doc.updateBlock(doc.root, { title: new Text(title) });
        collection.setDocMeta(doc.id, { title });
        await persistence.flush();
      },
      async insert(
        file: File,
        point?: { x: number; y: number; afterId?: string },
      ) {
        if (file.size > 100 * 1024 * 1024)
          throw new Error(`${file.name} exceeds the 100 MiB limit`);
        file = normalizeMediaFile(file);
        const canvas =
          editor.mode === "edgeless"
            ? editor.querySelector("affine-edgeless-root")
            : null;
        let parent =
          doc
            .getBlocksByFlavour("affine:note")
            .find(({ model }) => model.id === revealedNoteId)?.model ??
          doc.getBlocksByFlavour("affine:note")[0]?.model;
        let index: number | undefined;
        if (!canvas && point) {
          const element = document
            .elementFromPoint(point.x, point.y)
            ?.closest("[data-block-id]");
          const targetId =
            point.afterId ?? element?.getAttribute("data-block-id");
          const target = targetId ? doc.getBlock(targetId)?.model : null;
          if (target) {
            const note = doc.getParent(target);
            if (note?.flavour === "affine:note") {
              parent = note as NoteBlockModel;
              index =
                note.children.findIndex((child) => child.id === target.id) + 1;
            } else if (target.flavour === "affine:note")
              parent = target as NoteBlockModel;
          }
        }
        const container = canvas
          ? doc.getBlocksByFlavour("affine:surface")[0]?.model
          : parent;
        if (!container) throw new Error("Add a note before inserting a file");
        const isImage = file.type.startsWith("image/");
        let width = 480,
          height = 320;
        if (isImage) {
          const size = await mediaImageSize(file);
          width = Math.min(size.width, 640);
          height = Math.max(1, (size.height * width) / size.width);
        }
        let xywh: `[${number},${number},${number},${number}]` = "[0,0,480,320]";
        if (canvas) {
          const viewport = canvas.gfx.viewport;
          const center = point
            ? viewport.toModelCoord(
                ...viewport.toViewCoordFromClientCoord([point.x, point.y]),
              )
            : [viewport.center.x, viewport.center.y];
          if (!isImage) {
            width = 320;
            height = 180;
          }
          xywh = `[${center[0] - width / 2},${center[1] - height / 2},${width},${height}]`;
        }
        const key = await doc.blobSync.set(file);
        doc.captureSync();
        let inserted: string;
        if (isImage)
          inserted = doc.addBlock(
            "affine:image",
            {
              sourceId: key,
              width,
              height,
              size: file.size,
              ...(canvas ? { xywh } : {}),
            },
            container,
            index,
          );
        else
          inserted = doc.addBlock(
            "affine:attachment",
            {
              sourceId: key,
              name: file.name,
              size: file.size,
              type: file.type,
              embed:
                !canvas &&
                file.type === "application/pdf" &&
                file.size <= 10 * 1024 * 1024,
              ...(canvas ? { xywh, style: "cubeThick" } : {}),
            },
            container,
            index,
          );
        await persistence.flush();
        return inserted;
      },
      destroy() {
        if (disposed) return;
        canvasViewport.dispose();
        for (const view of noteViews) view.dispose();
        noteViews.clear();
        cardDeck.dispose();
        closeCardMenu();
        editor.removeEventListener("dragover", dragOver, true);
        editor.removeEventListener("drop", dropCard, true);
        editor.removeEventListener("contextmenu", cardContext, true);
        stopEditorPreferences();
        stopMcqMenu();
        stopFloatingToc();
        searchReveal.dispose();
        editor.removeEventListener("beforeinput", preventCanvasDomDelete, true);
        stopCanvasImages();
        stopCanvasNotePreviews();
        doc.spaceDoc.off("update", syncEmptyNote);
        stopCanvasAttachments();
        stopPdfToolbars();
        disposed = true;
        editor.removeEventListener("keydown", selectVisibleNotes, true);
        document.removeEventListener("click", pdfClick, true);
        document.removeEventListener("auxclick", pdfClick, true);
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
