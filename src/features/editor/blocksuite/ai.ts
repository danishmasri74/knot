import * as Y from "yjs";
import {
  cleanAiBlock,
  cleanAiProposal,
  cleanScene,
} from "../../../services/ai-generated-content";
import { readOutline, validateScene, type Scene, type SceneOutline } from "./scene";
import { applyScene } from "./scene-apply";
import { ConnectorMode } from "@blocksuite/blocks";
import { getAiConnectorShape } from "../../../services/ai-preferences";
import {
  validateSourceRefs,
  webProvenance,
} from "../../../services/web-ai-evidence";
import { appendWebProvenance } from "./web-source";
import { mcqDecks } from "./mcq-block";
import { captureCanvasMap } from "./canvas-map";
import {
  canvasHandles,
  type CanvasMapData,
} from "../../../services/canvas-map-format";
import type { Box } from "../../../services/ai-atomize";
import { mcqReferenceFlavour } from "./card-deck";
import {
  quizCardPlacement,
  quizCardSize,
  quizCardTitle,
  quizDefinition,
  validQuizQuestions,
  type AiQuestion,
  type QuizBounds,
  type QuizTarget,
} from "../../../services/ai-quiz";
import { youtubeVideoId } from "../../../services/youtube-transcript";
import { isRerouteDot } from "./reroute";
/** How older Knot's arrange_cards arranged cards; kept to read saved chats. */
type LayoutKind = "flow" | "tree" | "hub" | "grid";
import { fitInViewport } from "./canvas-viewport";
import type { AiPdfFile, AiPdfSource } from "../../../services/pdf-input";
import type { BlockModel, Doc } from "@blocksuite/store";
import type { AffineEditorContainer } from "@blocksuite/presets";
import type {
  AttachmentBlockModel,
  ImageBlockModel,
  NoteBlockModel,
  SurfaceBlockModel,
} from "@blocksuite/blocks";

import {
  type AiBlock,
  validAiContent,
  aiBlockSize,
  appendAiBlock,
} from "./ai-content";
export type { AiBlock } from "./ai-content";
export type AiProposal = {
  replacements: string[];
  blocks: AiBlock[];
  connections?: {
    from: number;
    to: number;
    label: string;
    sourceRefs?: string[];
  }[];
  mindmap?: { text: string; parent: number; sourceRefs?: string[] }[];
  /** create_quiz: multiple-choice questions. */
  questions?: AiQuestion[];
  /** create_quiz: a new linked quiz card (default) or the current note. */
  target?: QuizTarget;
  /** create_quiz with a canvas map: the frame or card it covers (a handle). */
  about?: string;
  /** Canvas with a canvas map: arrows from new cards to existing objects. */
  links?: AiLink[];
  /** connect_cards: arrows to add between existing objects. */
  arrows?: AiArrow[];
  /** arrange_cards: the existing cards to move (K handles) and how. */
  cards?: string[];
  layout?: LayoutKind | "auto";
  /** create_on_canvas: a scene the model composed (scene.ts). */
  scene?: Scene;
  /** create_on_canvas, for a job too large for one reply: its sections,
   * built one at a time before there is a scene (scene-build.ts). */
  outline?: SceneOutline;
};
export type { AiQuestion } from "../../../services/ai-quiz";
export type AiLink = {
  /** Index of a new top-level card. */
  card: number;
  /** Handle of an existing card, frame or text from the canvas map. */
  existing: string;
  label: string;
  /** The arrow points from the new card to the existing object. */
  toExisting: boolean;
};
/** An arrow connect_cards suggests between two existing objects. */
export type AiArrow = {
  from: string;
  to: string;
  label: string;
  /** What in the cards' text supports it. */
  reason: string;
};
/** Links one canvas proposal may add; matches CANVAS_LINK_RULES in ai.rs. */
export const MAX_LINKS = 20;
const HANDLE = /^[KFT]\d{1,4}$/;
type Range = {
  id: string;
  start: number;
  length: number;
  text: string;
  attributes: Record<string, unknown>;
};
export type AiContext = {
  sourceIntent?: "ambient" | "selection" | "explicit";
  /** How the open canvas is arranged; sent with every canvas message. */
  canvasMap?: CanvasMapData;
  webContext?: string;
  canvas?: boolean;
  selectedImageKey?: string;
  selectionKey?: string;
  selectionLabel?: string;
  selectionKind?: "website" | "file";
  /** A selected website card's page, captured like a pasted URL on send. */
  websiteUrl?: string;
  /** Blocks selected as whole objects (cards, embeds, files), if any. */
  selectedBlocks?: string[];
  pdf?: boolean;
  pdfSource?: AiPdfSource;
  /** Two or more selected PDFs (or converted slide decks): all are sent,
   * by name. pdfSource is the first of them. */
  pdfFiles?: AiPdfFile[];
  workspace: string;
  document: string;
  instance: Doc;
  version: string;
  label: string;
  text: string;
  structure: ContextBlock[];
  surrounding: ContextBlock[];
  ranges: Range[];
  note: string | null;
};
export type ContextBlock = {
  webSource?: string;
  id: string;
  parent: string | null;
  note: string | null;
  type: string;
  checked?: boolean;
  text: string;
};
export function structuredAiBlocks(root: BlockModel): ContextBlock[] {
  const result: ContextBlock[] = [];
  const walk = (m: BlockModel, parent: string | null, note: string | null) => {
    if (m.flavour === "affine:note") note = m.id;
    if (m.text)
      result.push({
        id: m.id,
        parent,
        note,
        type: "type" in m ? String(m.type) : m.flavour,
        ...("type" in m && m.type === "todo"
          ? { checked: "checked" in m && m.checked === true }
          : {}),
        text: m.text.toString(),
        ...(m.flavour === "knot:web-source" && "evidence" in m
          ? { webSource: String(m.evidence) }
          : {}),
      });
    m.children.forEach((child) => walk(child, m.id, note));
  };
  walk(root, null, root.flavour === "affine:note" ? root.id : null);
  return result;
}
const revisions = new WeakMap<Doc, number>();
export const version = (doc: Doc) => {
  if (!revisions.has(doc)) {
    revisions.set(doc, 0);
    doc.spaceDoc.on("update", (_update, _origin, _doc, transaction) => {
      // BlockSuite measures rendered note heights outside user undo history.
      // Those local geometry updates must not invalidate an AI proposal or undo.
      const measuredNotes =
        transaction.local &&
        transaction.origin === null &&
        transaction.changed.size > 0 &&
        [...transaction.changed].every(
          ([type, keys]) =>
            type instanceof Y.Map &&
            type.get("sys:flavour") === "affine:note" &&
            keys.size === 1 &&
            keys.has("prop:xywh"),
        );
      // BlockSuite also re-centres a connector's label box whenever its
      // path changes (for example after a card is measured). Derived too.
      const labelBoxes =
        transaction.local &&
        transaction.changed.size > 0 &&
        [...transaction.changed].every(
          ([type, keys]) =>
            type instanceof Y.Map &&
            type.get("type") === "connector" &&
            [...keys].every((key) => key === "labelXYWH"),
        );
      if (!measuredNotes && !labelBoxes)
        revisions.set(doc, revisions.get(doc)! + 1);
    });
  }
  return String(revisions.get(doc));
};
/**
 * Undoes an applied proposal. Only derived layout updates, which leave the
 * version unchanged (re-centred arrow labels), may sit above it on the undo
 * stack; they are stepped back first. Anything else is a newer edit.
 */
export function undoApplied(doc: Doc, item: unknown, appliedVersion: string) {
  const newer = () =>
    new Error(
      "There are newer edits. Use the editor’s Undo to undo them in order.",
    );
  if (
    version(doc) !== appliedVersion ||
    !(doc.history.undoStack as unknown[]).includes(item)
  )
    throw newer();
  for (let i = 0; i < 50 && doc.history.undoStack.at(-1) !== item; i++)
    doc.undo();
  if (doc.history.undoStack.at(-1) !== item) throw newer();
  doc.undo();
}
const readable = (model: BlockModel): string =>
  [model.text?.toString() ?? "", ...model.children.map(readable)]
    .filter(Boolean)
    .join("\n");

export function captureCardContext(
  doc: Doc,
  workspace: string,
  card: BlockModel,
): AiContext {
  const structure = structuredAiBlocks(card);
  return {
    canvas: true,
    workspace,
    document: doc.id,
    instance: doc,
    version: version(doc),
    label: "Focused note",
    canvasMap: captureCanvasMap(doc, [card.id], card.id),
    note: card.id,
    text: structure.map((b) => b.text).join("\n"),
    structure,
    surrounding: [],
    ranges: [],
  };
}
/** Capture the live model before panel focus clears BlockSuite's selection. */
export function captureAiContext(
  editor: AffineEditorContainer,
  workspace: string,
  focused: string | null,
): AiContext {
  const doc = editor.doc;
  const ranges: Range[] = [];
  const selection = editor.std.selection.find("text");
  const ordered: BlockModel[] = [];
  const walk = (m: BlockModel) => {
    ordered.push(m);
    m.children.forEach(walk);
  };
  if (doc.root) walk(doc.root);
  if (selection) {
    const from = selection.from,
      to = selection.to ?? from;
    const first = ordered.findIndex((m) => m.id === from.blockId);
    const last = ordered.findIndex((m) => m.id === to.blockId);
    if (first >= 0 && last >= first)
      for (const m of ordered.slice(first, last + 1)) {
        if (!m.text) continue;
        const start = m.id === from.blockId ? from.index : 0;
        const end = m.id === to.blockId ? to.index + to.length : m.text.length;
        let offset = start;
        for (const delta of m.text.sliceToDelta(start, end)) {
          const text = delta.insert ?? "";
          if (text)
            ranges.push({
              id: m.id,
              start: offset,
              length: text.length,
              text,
              attributes: delta.attributes ?? {},
            });
          offset += text.length;
        }
      }
  }
  const selectedBlocks = editor.std.selection
    .filter("block")
    .map((s) => doc.getBlock(s.blockId)?.model)
    .filter((m): m is BlockModel => !!m);
  const canvas =
    editor.mode === "edgeless"
      ? editor.querySelector("affine-edgeless-root")
      : null;
  const canvasSelected = canvas?.gfx.selection.selectedElements ?? [];
  for (const element of canvasSelected) {
    const block = doc.getBlock(element.id)?.model;
    if (block && !selectedBlocks.some((m) => m.id === block.id))
      selectedBlocks.push(block);
  }
  const imageKeys = new Set<string>();
  for (const block of selectedBlocks) {
    if (block.flavour === "affine:image") {
      const key = (block as ImageBlockModel).sourceId;
      if (key) imageKeys.add(key);
    } else if (block.flavour === "affine:attachment") {
      const attachment = block as AttachmentBlockModel;
      if (attachment.type?.startsWith("image/") && attachment.sourceId)
        imageKeys.add(attachment.sourceId);
    }
  }
  const selectedPdfs = selectedBlocks.filter(
    (block) =>
      block.flavour === "affine:attachment" &&
      (block as AttachmentBlockModel).type === "application/pdf" &&
      !!(block as AttachmentBlockModel).sourceId,
  ) as AttachmentBlockModel[];
  const selectedPdf = selectedPdfs[0];
  const pdfFiles = selectedPdfs.map((block) => ({
    key: block.sourceId!,
    name: block.name || "Untitled PDF",
  }));
  const selected = selectedBlocks.length === 1 ? selectedBlocks[0] : undefined;
  const selectedFile =
    selected?.flavour === "affine:attachment"
      ? (selected as AttachmentBlockModel)
      : undefined;
  const selectedUrl =
    selected && "url" in selected && typeof selected.url === "string"
      ? selected.url
      : undefined;
  const selectedCard =
    selected?.flavour === "affine:note" ? selected : undefined;
  const websiteTitle =
    selected && "title" in selected && typeof selected.title === "string"
      ? selected.title.trim()
      : "";
  let websiteLabel: string | undefined;
  let websiteUrl: string | undefined;
  if (selectedUrl) {
    try {
      const url = new URL(selectedUrl);
      if (url.protocol === "http:" || url.protocol === "https:") {
        websiteLabel = websiteTitle || url.hostname;
        // YouTube cards bring their saved transcript instead; a YouTube
        // page itself has no readable text.
        if (
          selected?.flavour !== "affine:embed-youtube" &&
          !youtubeVideoId(url.href)
        )
          websiteUrl = url.href;
      }
    } catch {
      if (selected?.flavour === "affine:bookmark")
        websiteLabel = websiteTitle || selectedUrl;
    }
  }
  const selectionKey = JSON.stringify([
    selectedBlocks.map((block) => block.id).sort(),
    canvasSelected.map((element) => element.id).sort(),
    ranges.map((range) => [range.id, range.start, range.length]),
  ]);
  let note = focused ? doc.getBlock(focused)?.model : undefined;
  if (
    !note &&
    selectedBlocks.length === 1 &&
    selectedBlocks[0].flavour === "affine:note"
  )
    note = selectedBlocks[0];
  if (!note && ranges.length) {
    let parent = doc.getBlock(ranges[0].id)?.model;
    while (parent && parent.flavour !== "affine:note")
      parent = doc.getParent(parent) ?? undefined;
    note = parent;
  }
  const notes = doc.getBlocksByFlavour("affine:note").map((b) => b.model);
  const visible = notes.filter(
    (m) =>
      editor.mode === "edgeless" ||
      !("displayMode" in m) ||
      m.displayMode !== "edgeless",
  );
  const canvasText = (
    canvasSelected.length
      ? canvasSelected
      : ((
          doc.getBlocksByFlavour("affine:surface")[0]?.model as
            SurfaceBlockModel | undefined
        )?.elementModels ?? [])
  )
    .filter((element) => !("flavour" in element))
    .map((element) =>
      "text" in element && element.text ? String(element.text) : "",
    )
    .filter(Boolean)
    .join("\n");
  const text = ranges.length
    ? ranges
        .map((r, i) => `${i && ranges[i - 1].id !== r.id ? "\n" : ""}${r.text}`)
        .join("")
    : selectedBlocks.length || canvasSelected.length
      ? [selectedBlocks.map(readable).join("\n"), canvasText]
          .filter(Boolean)
          .join("\n")
      : note
        ? readable(note)
        : [visible.map(readable).join("\n\n"), ...(canvas ? [canvasText] : [])]
            .filter(Boolean)
            .join("\n\n");
  const all = doc.root ? structuredAiBlocks(doc.root) : [];
  const selectedIds = new Set(ranges.map((r) => r.id));
  const structure = ranges.length
    ? all
        .filter((b) => selectedIds.has(b.id))
        .map((b) => ({
          ...b,
          text: ranges
            .filter((r) => r.id === b.id)
            .map((r) => r.text)
            .join(""),
        }))
    : selectedBlocks.length || canvasSelected.length
      ? selectedBlocks.flatMap(structuredAiBlocks)
      : note
        ? structuredAiBlocks(note)
        : visible.flatMap(structuredAiBlocks);
  const surrounding: ContextBlock[] = [];
  if (ranges.length) {
    const first = all.findIndex((b) => b.id === ranges[0].id);
    const last = all.findIndex((b) => b.id === ranges[ranges.length - 1].id);
    const heading = all
      .slice(0, first)
      .reverse()
      .find((b) => b.note === all[first]?.note && /^h[1-6]$/.test(b.type));
    const candidates = [
      ...(heading ? [heading] : []),
      ...all.slice(Math.max(0, first - 1), last + 2),
    ];
    let budget = 4000;
    for (const b of candidates) {
      if (
        b.note !== all[first]?.note ||
        surrounding.some((x) => x.id === b.id) ||
        budget <= 0
      )
        continue;
      const text = b.text.slice(0, Math.min(1500, budget));
      budget -= text.length;
      surrounding.push({ ...b, text });
    }
  }
  return {
    sourceIntent:
      ranges.length || selectedBlocks.length || canvasSelected.length
        ? "selection"
        : "ambient",
    canvas: editor.mode === "edgeless",
    selectionKey,
    selectionKind: websiteLabel ? "website" : selectedFile ? "file" : undefined,
    ...(websiteUrl && { websiteUrl }),
    ...(selectedBlocks.length && {
      selectedBlocks: selectedBlocks.map((block) => block.id),
    }),
    selectionLabel:
      (pdfFiles.length > 1 ? `${pdfFiles.length} files` : undefined) ||
      selectedPdf?.name ||
      selectedFile?.name ||
      websiteLabel ||
      (selectedCard
        ? readable(selectedCard).split("\n")[0].slice(0, 60) || "Card"
        : undefined),
    ...(selectedPdf?.sourceId
      ? {
          pdf: true,
          pdfSource: {
            key: selectedPdf.sourceId,
          },
          ...(pdfFiles.length > 1 && { pdfFiles }),
        }
      : {}),
    selectedImageKey: imageKeys.size === 1 ? [...imageKeys][0] : undefined,
    workspace,
    document: doc.id,
    instance: doc,
    version: version(doc),
    label:
      ranges.length || selectedBlocks.length || canvasSelected.length
        ? "Selection"
        : note
          ? "Focused note"
          : editor.mode === "edgeless"
            ? "Canvas text"
            : "Page",
    text,
    structure,
    surrounding,
    ranges,
    note: note?.id ?? (visible.length === 1 ? visible[0].id : null),
    ...(canvas && {
      canvasMap: captureCanvasMap(
        doc,
        [
          ...new Set([
            ...selectedBlocks.map((m) => m.id),
            ...canvasSelected.map((e) => e.id),
          ]),
        ],
        note?.id,
        (() => {
          const v = (
            editor.querySelector("affine-edgeless-root") as unknown as {
              gfx?: { viewport: { viewportBounds: { x: number; y: number; w: number; h: number } } };
            } | null
          )?.gfx?.viewport.viewportBounds;
          return v ? ([v.x, v.y, v.w, v.h] as [number, number, number, number]) : undefined;
        })(),
      ),
    }),
  };
}

export function validateProposal(
  value: unknown,
  webContext?: string,
  /** Canvas map handles the request could refer to (K1, F2…). */
  handles: Set<string> = new Set(),
): AiProposal {
  // An outline: a job too large for one reply, built in sections.
  const saved = value as { outline?: unknown; scene?: unknown };
  const outline = readOutline(saved?.outline ?? value, handles);
  if (outline) {
    const built = saved?.scene ? validateProposal({ scene: saved.scene }, webContext, handles).scene : undefined;
    return { replacements: [], blocks: [], outline, ...(built && { scene: built }) };
  }
  // A scene: create_on_canvas's arguments, or one saved with a chat.
  const raw = value as { objects?: unknown; scene?: unknown };
  if (raw && (Array.isArray(raw.objects) || raw.scene)) {
    const source = raw.scene ?? raw;
    if (JSON.stringify(source).length > 2_000_000)
      throw new Error("The canvas response is too large. Ask for it in parts.");
    const scene = cleanScene(validateScene(source, handles));
    validateSourceRefs(
      {
        blocks: scene.objects.map((o) => ({
          ...(o.sourceRefs && { sourceRefs: o.sourceRefs }),
          children: o.content,
        })),
        connections: scene.connectors,
        mindmap: scene.objects.flatMap((o) => o.nodes),
      },
      webContext,
    );
    return { replacements: [], blocks: [], scene };
  }
  const p = value as AiProposal;
  if (
    !p ||
    !Array.isArray(p.replacements) ||
    !Array.isArray(p.blocks) ||
    p.replacements.some((t) => typeof t !== "string") ||
    p.blocks.some(
      (b) =>
        !validAiContent(b) ||
        (b.children !== undefined &&
          (!Array.isArray(b.children) ||
            b.children.length > 30 ||
            b.children.some((c) => !validAiContent(c) || "children" in c) ||
            (b.children.length > 0 && b.type !== "paragraph"))),
    ) ||
    p.blocks.reduce((n, b) => n + 1 + (b.children?.length ?? 0), 0) > 200 ||
    JSON.stringify(p).length > 60000 ||
    p.blocks.length > 100
  )
    throw new Error("The edit response is invalid. Please try again.");
  const connections = p.connections ?? [];
  if (
    p.mindmap !== undefined &&
    (!Array.isArray(p.mindmap) ||
      p.mindmap.length > 60 ||
      p.mindmap.some(
        (node, i) =>
          !node ||
          typeof node.text !== "string" ||
          !node.text.trim() ||
          node.text.length > 160 ||
          !Number.isInteger(node.parent) ||
          (i === 0 ? node.parent !== -1 : node.parent < 0 || node.parent >= i),
      ) ||
      (p.mindmap.length && p.replacements.length))
  )
    throw new Error("Invalid canvas mind map.");
  if (
    !Array.isArray(connections) ||
    connections.length > 40 ||
    connections.some(
      (c) =>
        !c ||
        !Number.isInteger(c.from) ||
        !Number.isInteger(c.to) ||
        c.from < 0 ||
        c.to < 0 ||
        c.from >= p.blocks.length ||
        c.to >= p.blocks.length ||
        c.from === c.to ||
        typeof c.label !== "string" ||
        c.label.length > 200,
    )
  )
    throw new Error("Invalid canvas connections.");
  if (
    (p.target !== undefined &&
      (p.questions === undefined ||
        (p.target !== "card" && p.target !== "note"))) ||
    (p.questions !== undefined &&
      (!validQuizQuestions(p.questions) ||
        p.blocks.length ||
        p.replacements.length ||
        p.mindmap?.length ||
        connections.length))
  )
    throw new Error("Invalid quiz questions.");
  if (
    (p.links !== undefined &&
      (!Array.isArray(p.links) ||
        p.links.length > MAX_LINKS ||
        p.links.some(
          (link) =>
            !link ||
            !Number.isInteger(link.card) ||
            link.card < 0 ||
            link.card >= p.blocks.length ||
            typeof link.existing !== "string" ||
            !HANDLE.test(link.existing) ||
            typeof link.label !== "string" ||
            link.label.length > 200 ||
            typeof link.toExisting !== "boolean",
        ))) ||
    (p.about !== undefined &&
      (typeof p.about !== "string" ||
        (p.about !== "" && !/^[KFT]\d{1,4}$/.test(p.about))))
  )
    throw new Error("Invalid links to existing cards.");
  if (
    (p.cards !== undefined &&
      (!Array.isArray(p.cards) ||
        p.cards.length < 2 ||
        p.cards.length > 40 ||
        p.cards.some((c) => typeof c !== "string" || !/^K\d{1,4}$/.test(c)) ||
        new Set(p.cards).size !== p.cards.length ||
        p.blocks.length ||
        p.replacements.length)) ||
    (p.layout !== undefined &&
      !["auto", "flow", "tree", "hub", "grid"].includes(p.layout))
  )
    throw new Error("Invalid card arrangement.");
  if (
    p.arrows !== undefined &&
    (!Array.isArray(p.arrows) ||
      !p.arrows.length ||
      p.arrows.length > MAX_LINKS ||
      p.blocks.length ||
      p.replacements.length ||
      p.arrows.some(
        (a) =>
          !a ||
          typeof a.from !== "string" ||
          typeof a.to !== "string" ||
          !HANDLE.test(a.from) ||
          !HANDLE.test(a.to) ||
          a.from === a.to ||
          typeof a.label !== "string" ||
          a.label.length > 200 ||
          typeof a.reason !== "string" ||
          a.reason.length > 4000,
      ) ||
      new Set(p.arrows.map((a) => `${a.from}>${a.to}`)).size !== p.arrows.length)
  )
    throw new Error("Invalid suggested connections.");
  validateSourceRefs(p, webContext);
  return cleanAiProposal(p);
}

export function aiConnectorStroke(index: number) {
  // A golden-angle step keeps successive arrows far apart on the color wheel.
  const hue = 210 + index * 137.5;
  const channels = [0, 120, 240].map(
    (offset) => (1 + Math.cos(((hue - offset) * Math.PI) / 180)) / 2,
  );
  // BlockSuite's custom color picker can round-trip hex values in both themes.
  const hex = (min: number, max: number) =>
    "#" +
    channels
      .map((c) =>
        Math.round(min + c * (max - min))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("");
  return { light: hex(20, 153), dark: hex(106, 247) };
}

/**
 * Applies a quiz proposal. Each question is written as a Card Deck question
 * (like the /mcq composer) and shown by a reference block: on a new quiz card
 * beside the source note with an arrow from it (target card, the default),
 * or at the end of the source note (target note). One undo step; Undo also
 * moves the questions to Trash.
 */
function applyQuiz(
  doc: Doc,
  workspace: string,
  context: AiContext,
  proposal: AiProposal,
): (() => void) & { noteId?: string } {
  const deck = mcqDecks.get(doc.spaceDoc);
  if (
    doc !== context.instance ||
    doc.id !== context.document ||
    workspace !== context.workspace ||
    version(doc) !== context.version ||
    doc.readonly
  )
    throw new Error("This edit is stale. Capture fresh context and try again.");
  const found = context.note ? doc.getBlock(context.note)?.model : undefined;
  const source =
    found?.flavour === "affine:note" ? (found as NoteBlockModel) : undefined;
  const card = proposal.target !== "note";
  if (!proposal.questions?.length || !deck || !doc.root)
    throw new Error("Open a notebook before adding questions.");
  if (!card && (!source || source.isLocked()))
    throw new Error("Open a note before adding questions.");
  // Check every question before anything is written.
  const definitions = proposal.questions.map((q) =>
    quizDefinition(q, doc.id),
  );
  const parse = (xywh: unknown): QuizBounds | undefined => {
    try {
      const b: unknown = JSON.parse(String(xywh));
      return Array.isArray(b) && b.length === 4 && b.every(Number.isFinite)
        ? (b as QuizBounds)
        : undefined;
    } catch {
      return undefined;
    }
  };
  const surface = doc.getBlocksByFlavour("affine:surface")[0]?.model as
    | SurfaceBlockModel
    | undefined;
  // A quiz about a frame or card named from the canvas map sits beside it,
  // with the arrow from it; otherwise beside the source note.
  const named =
    card && proposal.about && context.canvasMap
      ? canvasHandles(context.canvasMap).get(proposal.about)
      : undefined;
  const about =
    named?.box &&
    (doc.getBlock(named.id) || surface?.getElementById(named.id))
      ? named
      : undefined;
  const sourceBounds = about?.box ?? (source ? parse(source.xywh) : undefined);
  const anchorId = about?.id ?? source?.id;
  const bounds = card
    ? quizCardPlacement(
        sourceBounds,
        canvasObstacles(doc),
        quizCardSize(proposal.questions),
      )
    : undefined;
  const title = quizCardTitle(
    about?.title ||
      (source &&
        structuredAiBlocks(source).find((b) => b.text.trim())?.text) ||
      doc.meta?.title,
  );
  const ids = definitions.map((definition) => deck.writeMcq(definition));
  const top = doc.history.undoStack.at(-1);
  const added: string[] = [];
  let noteId: string | undefined;
  try {
    doc.captureSync();
    doc.transact(() => {
      if (card) {
        noteId = doc.addBlock(
          "affine:note",
          { xywh: `[${bounds!.join(",")}]` as `[${number},${number},${number},${number}]` },
          doc.root!.id,
        );
        appendAiBlock(doc, noteId, {
          type: "h1",
          text: title,
          columns: [],
          rows: [],
          children: [],
        });
      }
      const host = noteId ?? source!.id;
      for (const cardId of ids)
        added.push(
          doc.addBlock(mcqReferenceFlavour as never, { cardId }, host),
        );
      // The arrow shows which note the quiz tests.
      if (noteId && anchorId && sourceBounds && surface)
        surface.addElement({
          type: "connector",
          mode: {
            curve: ConnectorMode.Curve,
            elbowed: ConnectorMode.Orthogonal,
            straight: ConnectorMode.Straight,
          }[getAiConnectorShape()],
          stroke: aiConnectorStroke(0),
          source: { id: anchorId, position: [1, 0.5] },
          target: { id: noteId, position: [0, 0.5] },
        });
    });
    doc.captureSync();
  } catch {
    // Handled below: BlockSuite can also log a failed transaction and return.
  }
  if (
    added.length !== ids.length ||
    added.some((id) => !doc.getBlock(id)) ||
    (card && (!noteId || !doc.getBlock(noteId)))
  ) {
    if (doc.history.undoStack.at(-1) !== top) doc.undo();
    ids.forEach((id) => deck.delete(id));
    throw new Error(
      card
        ? "Could not add the quiz card."
        : "Could not add the questions to this note.",
    );
  }
  const item = doc.history.undoStack.at(-1);
  const appliedVersion = version(doc);
  const undo = () => {
    undoApplied(doc, item, appliedVersion);
    ids.forEach((id) => deck.delete(id));
  };
  return Object.assign(undo, { noteId });
}

/** Save one chat response as one editable card, including structured previews. */
export function addAiMessageCard(doc: Doc, blocks: AiBlock[]) {
  blocks = blocks.map(cleanAiBlock);
  if (doc.readonly || !doc.root)
    throw new Error("Open an editable notebook to add a card.");
  if (!blocks.length) throw new Error("This message has no content to add.");
  // Right of everything on the canvas, PDFs and images included.
  const right = Math.max(0, ...canvasObstacles(doc).map((b) => b[0] + b[2] + 80));
  const sizes = blocks.map(aiBlockSize);
  const width = Math.max(...sizes.map((size) => size.width));
  const height = sizes.reduce((sum, size) => sum + size.height, 0);
  let id = "";
  doc.captureSync();
  doc.transact(() => {
    id = doc.addBlock(
      "affine:note",
      { xywh: `[${right},0,${width},${height}]` },
      doc.root!,
    );
    for (const block of blocks) appendAiBlock(doc, id, block);
  });
  doc.captureSync();
  return id;
}

export function applyAiProposal(
  doc: Doc,
  workspace: string,
  context: AiContext,
  input: AiProposal,
  mode: "rewrite" | "insert" | "canvas" | "note" | "quiz" | "arrange" | "connect",
  options?: {
    /** Break this into ideas: the canvas card the new cards replace. */
    replaces?: string;
    /** The visible part of the canvas, for a scene anchored to the view. */
    view?: Box;
    /** A scene: brings new objects into view so the editor measures them. */
    reveal?: (ids: string[]) => void;
  },
): (() => void) & {
  noteId?: string;
  created?: string[];
  settled?: Promise<void>;
  report?: string[];
} {
  if (input.outline && !input.scene)
    throw new Error("Build the sections first, then apply them.");
  if (input.scene) {
    if (mode !== "canvas") throw new Error("This proposal belongs on the canvas.");
    const handles = context.canvasMap
      ? new Set(canvasHandles(context.canvasMap).keys())
      : new Set<string>();
    const { scene } = validateProposal(input, context.webContext, handles);
    if (
      doc !== context.instance ||
      doc.id !== context.document ||
      workspace !== context.workspace ||
      version(doc) !== context.version ||
      doc.readonly
    )
      throw new Error("This edit is stale. Capture fresh context and try again.");
    // Notes from the first check survive the second.
    scene!.notes = [...new Set([...(input.scene.notes ?? []), ...scene!.notes])];
    return applyScene(doc, context, scene!, {
      view: options?.view,
      reveal: options?.reveal,
      replaces: options?.replaces,
    });
  }
  const proposal = validateProposal(input, context.webContext);
  if (mode === "quiz") return applyQuiz(doc, workspace, context, proposal);
  // Canvas content is a scene now; cards, arrangements and connections from
  // an older Knot's proposals can't be applied.
  if (mode === "canvas" || mode === "arrange" || mode === "connect")
    throw new Error("This suggestion came from an older version of Knot. Ask again to get a new one.");
  const allRefs = [
    ...new Set(
      proposal.blocks.flatMap((b) => [
        ...(b.sourceRefs ?? []),
        ...(b.children ?? []).flatMap((c) => c.sourceRefs ?? []),
      ]),
    ),
  ];
  // Resolve and serialize every source before mutating the document.
  webProvenance(context.webContext, allRefs);
  if (
    doc !== context.instance ||
    doc.id !== context.document ||
    workspace !== context.workspace ||
    version(doc) !== context.version ||
    doc.readonly
  )
    throw new Error("This edit is stale. Capture fresh context and try again.");
  if (mode === "rewrite") {
    if (
      !context.ranges.length ||
      proposal.replacements.length !== context.ranges.length ||
      proposal.blocks.length
    )
      throw new Error("Select text to rewrite and try again.");
    for (const [i, range] of context.ranges.entries()) {
      const model = doc.getBlock(range.id)?.model;
      if (
        !model?.text ||
        !["affine:paragraph", "affine:list", "affine:code"].includes(
          model.flavour,
        ) ||
        model.text.toString().slice(range.start, range.start + range.length) !==
          range.text
      )
        throw new Error("The selected block is unavailable or unsupported.");
      if (
        (range.attributes.reference || range.attributes.link) &&
        proposal.replacements[i] !== range.text
      )
        throw new Error(
          "The proposal changed a reference or link. Please try again.",
        );
    }
  } else if (
    mode === "note" &&
    (!doc.root || !proposal.blocks.length || proposal.replacements.length)
  ) {
    throw new Error("Open a notebook to add the new note.");
  } else if (
    mode !== "note" &&
    (!context.note ||
      doc.getBlock(context.note)?.model.flavour !== "affine:note" ||
      !proposal.blocks.length ||
      proposal.replacements.length)
  )
    throw new Error("Open a note before inserting content.");
  let noteId: string | undefined;
  doc.captureSync();
  doc.transact(() => {
    if (mode === "note") {
      // After the last note, where "Add note" puts one from Page view.
      const right = Math.max(
        0,
        ...doc.getBlocksByFlavour("affine:note").map(({ model }) => {
          const b = JSON.parse(String((model as { xywh?: string }).xywh));
          return Array.isArray(b) && b.length === 4 && b.every(Number.isFinite)
            ? b[0] + b[2] + 40
            : 0;
        }),
      );
      noteId = doc.addBlock(
        "affine:note",
        { xywh: `[${right},0,448,200]` },
        doc.root!,
      );
      for (const block of proposal.blocks) {
        appendAiBlock(doc, noteId, block);
        appendWebProvenance(
          doc,
          noteId,
          context.webContext,
          block.sourceRefs ?? [],
          block.text,
        );
        for (const child of block.children ?? [])
          appendWebProvenance(
            doc,
            noteId,
            context.webContext,
            child.sourceRefs ?? [],
            child.text,
          );
      }
    } else if (mode === "rewrite") {
      for (let i = context.ranges.length - 1; i >= 0; i--) {
        const r = context.ranges[i],
          text = doc.getBlock(r.id)!.model.text!;
        text.delete(r.start, r.length);
        text.insert(proposal.replacements[i], r.start, r.attributes);
      }
    } else
      for (const block of proposal.blocks) {
        appendAiBlock(doc, context.note!, block);
        appendWebProvenance(
          doc,
          context.note!,
          context.webContext,
          block.sourceRefs ?? [],
          block.text,
        );
        for (const child of block.children ?? [])
          appendWebProvenance(
            doc,
            context.note!,
            context.webContext,
            child.sourceRefs ?? [],
            child.text,
          );
      }
  });
  doc.captureSync();
  const item = doc.history.undoStack.at(-1);
  const appliedVersion = version(doc);
  const undo = () => undoApplied(doc, item, appliedVersion);
  return Object.assign(undo, { noteId, created: [] as string[] });
}

/**
 * Brings objects on the open canvas into view (new AI cards are placed right
 * of everything, often off screen). False when none of them is there.
 */
export function revealCanvasObjects(
  editor: AffineEditorContainer,
  ids: string[],
): boolean {
  const canvas =
    editor.mode === "edgeless"
      ? editor.querySelector("affine-edgeless-root")
      : null;
  if (!canvas || !ids.length) return false;
  const surface = editor.doc.getBlocksByFlavour("affine:surface")[0]
    ?.model as SurfaceBlockModel | undefined;
  const boxes = ids.flatMap((id) => {
    const model =
      editor.doc.getBlock(id)?.model ?? surface?.getElementById(id) ?? undefined;
    const b = model && "xywh" in model ? parseBox(model.xywh) : undefined;
    return b ? [b] : [];
  });
  if (!boxes.length) return false;
  const x = Math.min(...boxes.map((b) => b[0]));
  const y = Math.min(...boxes.map((b) => b[1]));
  fitInViewport(canvas.gfx.viewport, {
    x,
    y,
    w: Math.max(...boxes.map((b) => b[0] + b[2])) - x,
    h: Math.max(...boxes.map((b) => b[1] + b[3])) - y,
  });
  return true;
}

/**
 * BlockSuite draws a connector label only once it has a label box, which its
 * label editor measures as you type. Programmatic labels get an estimated
 * box; BlockSuite re-centres it on the arrow whenever the path changes.
 */
export function connectorLabel(
  label: string,
  /** Where the label sits along the arrow, from its start (0-1). */
  distance?: number,
): Record<string, unknown> {
  const text = label.trim();
  if (!text) return {};
  const width = Math.min(320, Math.max(36, Array.from(text).length * 9 + 20));
  const lines = Math.ceil((Array.from(text).length * 9 + 20) / 320);
  return {
    labelXYWH: [0, 0, width, 26 * lines] as Box,
    labelDisplay: true,
    // BlockSuite's default label colour is a fixed black, invisible on a
    // dark canvas; labels typed in the editor use a theme colour instead.
    labelStyle: {
      color: ARROW_LABEL_COLOR,
      fontFamily: "blocksuite:surface:Inter",
      fontSize: 16,
      fontStyle: "normal",
      fontWeight: "400",
      textAlign: "center",
    },
    ...(distance !== undefined && {
      labelOffset: { distance, anchor: "center" },
    }),
  };
}

/** BlockSuite's default label colours, black in both themes. */
const DEFAULT_LABEL_BLACKS = new Set(["#000000", "--affine-palette-line-black"]);
/** Arrow label text: dark on a light canvas, light on a dark one. */
export const ARROW_LABEL_COLOR = { light: "#2b2b2b", dark: "#e3e3e3" };

/** Gives a connector with a default-black label colour the theme-aware one. */
function themeArrowLabel(surface: SurfaceBlockModel, element: unknown) {
  const connector = element as {
    id: string;
    type?: string;
    labelStyle?: Record<string, unknown>;
  };
  if (
    connector?.type !== "connector" ||
    !DEFAULT_LABEL_BLACKS.has(String(connector.labelStyle?.color))
  )
    return false;
  surface.updateElement(connector.id, {
    labelStyle: { ...connector.labelStyle, color: ARROW_LABEL_COLOR },
  });
  return true;
}

/**
 * Arrows kept BlockSuite's default label colour: "#000000" without the
 * editor's defaults, or the "--affine-palette-line-black" token the editor
 * fills in. Both stay black on a dark canvas, so a label shows only as the
 * gap cut into the line, and typing one writes black on black. Give every
 * connector with either default the theme-aware colour, labelled or not (an
 * unlabelled one gets it for the label typed later); any other chosen colour
 * is kept. Runs when a notebook loads; returns the count.
 */
export function repairArrowLabelColors(doc: Doc): number {
  const surface = doc.getBlocksByFlavour("affine:surface")[0]?.model as
    | SurfaceBlockModel
    | undefined;
  if (!surface) return 0;
  let repaired = 0;
  for (const element of surface.elementModels)
    if (themeArrowLabel(surface, element)) repaired++;
  return repaired;
}

/**
 * Arrows drawn in the editor start with the default black label colour
 * too; give them the theme-aware one as they are added, in the same undo
 * step (it lands within the history's capture window).
 */
export function observeArrowLabelColors(doc: Doc) {
  let stop: { dispose(): void } | undefined;
  const watch = () => {
    const surface = doc.getBlocksByFlavour("affine:surface")[0]?.model as
      | SurfaceBlockModel
      | undefined;
    if (!surface || stop) return;
    stop = surface.elementAdded.on(({ id, local }) => {
      if (local && !doc.readonly)
        queueMicrotask(() => themeArrowLabel(surface, surface.getElementById(id)));
    });
  };
  watch();
  const added = doc.slots.blockUpdated.on(({ type, flavour }) => {
    if (type === "add" && flavour === "affine:surface") watch();
  });
  return () => {
    added.dispose();
    stop?.dispose();
  };
}

/**
 * Everything on the canvas new cards must not cover: cards, the blocks kept
 * under the surface (PDFs and other attachments, images, embeds and, unless
 * left out, frames) and drawn elements other than arrows and groups.
 * Attachments live under the surface, not among its elements, so leaving
 * them out put AI cards on top of PDFs, hiding them.
 */
export function canvasObstacles(
  doc: Doc,
  skip: (id: string) => boolean = () => false,
  frames = true,
): Box[] {
  const surface = doc.getBlocksByFlavour("affine:surface")[0]?.model as
    | SurfaceBlockModel
    | undefined;
  const boxes: Box[] = [];
  const add = (id: string, xywh: unknown) => {
    if (skip(id)) return;
    const b = parseBox(xywh);
    if (b) boxes.push(b);
  };
  for (const { model } of doc.getBlocksByFlavour("affine:note")) {
    const note = model as NoteBlockModel;
    // Page-only notes aren't on the canvas.
    if (note.displayMode !== "doc") add(note.id, note.xywh);
  }
  for (const child of surface?.children ?? []) {
    if (!frames && child.flavour === "affine:frame") continue;
    add(child.id, (child as unknown as { xywh?: unknown }).xywh);
  }
  for (const element of surface?.elementModels ?? [])
    if (
      element.type !== "connector" &&
      element.type !== "group" &&
      !isRerouteDot(element)
    )
      add(element.id, element.xywh);
  return boxes;
}
export function parseBox(xywh: unknown): Box | undefined {
  try {
    const b: unknown = JSON.parse(String(xywh));
    return Array.isArray(b) && b.length === 4 && b.every(Number.isFinite)
      ? (b as Box)
      : undefined;
  } catch {
    return undefined;
  }
}
