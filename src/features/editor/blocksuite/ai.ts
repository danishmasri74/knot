import * as Y from "yjs";
import {
  cleanAiBlock,
  cleanAiProposal,
} from "../../../services/ai-generated-content";
import { ConnectorMode } from "@blocksuite/blocks";
import { getAiConnectorShape } from "../../../services/ai-preferences";
import {
  validateSourceRefs,
  webProvenance,
} from "../../../services/web-ai-evidence";
import { appendWebProvenance } from "./web-source";
import { mcqDecks } from "./mcq-block";
import { captureCanvasMap } from "./canvas-map";
import type { CanvasMapData } from "../../../services/canvas-map-format";
import { Text } from "@blocksuite/store";
import {
  clearPlacement,
  relationStroke,
  uncoveredPassages,
  type Box,
} from "../../../services/ai-atomize";
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
import { aiConnectorPorts, layoutAiCards } from "./ai-layout";
import type { AiPdfSource } from "../../../services/pdf-input";
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
  aiBlockText,
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
};
export type { AiQuestion } from "../../../services/ai-quiz";
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
const version = (doc: Doc) => {
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
      if (!measuredNotes) revisions.set(doc, revisions.get(doc)! + 1);
    });
  }
  return String(revisions.get(doc));
};
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
  const selectedPdf = selectedBlocks.find(
    (block) =>
      block.flavour === "affine:attachment" &&
      (block as AttachmentBlockModel).type === "application/pdf",
  ) as AttachmentBlockModel | undefined;
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
      ),
    }),
  };
}

export function validateProposal(
  value: unknown,
  webContext?: string,
): AiProposal {
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
  validateSourceRefs(p, webContext);
  return cleanAiProposal(p);
}

function aiConnectorStroke(index: number) {
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
  const sourceBounds = source ? parse(source.xywh) : undefined;
  const bounds = card
    ? quizCardPlacement(
        sourceBounds,
        [
          ...doc.getBlocksByFlavour("affine:note").map((b) => b.model),
          ...(surface?.elementModels ?? []),
        ].flatMap((element) => {
          const b = "xywh" in element ? parse(element.xywh) : undefined;
          return b ? [b] : [];
        }),
        quizCardSize(proposal.questions),
      )
    : undefined;
  const title = quizCardTitle(
    (source && structuredAiBlocks(source).find((b) => b.text.trim())?.text) ||
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
      if (noteId && source && sourceBounds && surface)
        surface.addElement({
          type: "connector",
          mode: {
            curve: ConnectorMode.Curve,
            elbowed: ConnectorMode.Orthogonal,
            straight: ConnectorMode.Straight,
          }[getAiConnectorShape()],
          stroke: aiConnectorStroke(0),
          source: { id: source.id, position: [1, 0.5] },
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
    if (
      version(doc) !== appliedVersion ||
      doc.history.undoStack.at(-1) !== item
    )
      throw new Error(
        "There are newer edits. Use the editor’s Undo to undo them in order.",
      );
    doc.undo();
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
  let right = 0;
  for (const { model } of doc.getBlocksByFlavour("affine:note")) {
    const bounds: unknown = JSON.parse((model as NoteBlockModel).xywh);
    if (
      Array.isArray(bounds) &&
      bounds.length === 4 &&
      bounds.every(Number.isFinite)
    )
      right = Math.max(right, bounds[0] + bounds[2] + 80);
  }
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
  mode: "rewrite" | "insert" | "canvas" | "note" | "quiz",
  options?: {
    /** Break this into ideas: the canvas card the new cards replace. */
    replaces?: string;
  },
): (() => void) & { noteId?: string } {
  const proposal = validateProposal(input, context.webContext);
  if (mode === "quiz") return applyQuiz(doc, workspace, context, proposal);
  const allRefs = [
    ...new Set([
      ...proposal.blocks.flatMap((b) => [
        ...(b.sourceRefs ?? []),
        ...(b.children ?? []).flatMap((c) => c.sourceRefs ?? []),
      ]),
      ...(proposal.connections ?? []).flatMap((c) => c.sourceRefs ?? []),
      ...(proposal.mindmap ?? []).flatMap((n) => n.sourceRefs ?? []),
    ]),
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
    mode !== "canvas" &&
    mode !== "note" &&
    (!context.note ||
      doc.getBlock(context.note)?.model.flavour !== "affine:note" ||
      !proposal.blocks.length ||
      proposal.replacements.length)
  )
    throw new Error("Open a note before inserting content.");
  const surface = doc.getBlocksByFlavour("affine:surface")[0]?.model as
    SurfaceBlockModel | undefined;
  if (
    mode === "canvas" &&
    (!context.canvas ||
      !surface ||
      !doc.root ||
      !(proposal.blocks.length || proposal.mindmap?.length) ||
      proposal.blocks.length > 20 ||
      proposal.replacements.length)
  )
    throw new Error("Open a canvas to create up to 20 cards.");
  const connections = proposal.connections ?? [];
  // Break this into ideas: the cards take the original's place, in a frame
  // with its title, and the original goes to Trash. Passages the cards don't
  // cover are kept word for word on an "Other details" card.
  let replaced:
    | { note: NoteBlockModel; title: string; region: Box; shift: [number, number] }
    | undefined;
  if (mode === "canvas" && options?.replaces) {
    const found = doc.getBlock(options.replaces)?.model;
    const note =
      found?.flavour === "affine:note" ? (found as NoteBlockModel) : undefined;
    const box = note ? parseBox(note.xywh) : undefined;
    if (!note || !box || note.isLocked())
      throw new Error(
        "The original card is unavailable. Select it again and retry.",
      );
    if (!proposal.blocks.length)
      throw new Error("This suggestion has no cards to replace the card with.");
    const source = structuredAiBlocks(note).map((b) => b.text);
    const uncovered = uncoveredPassages(source, [
      ...proposal.blocks.map(aiBlockText),
      ...connections.map((c) => c.label),
      ...(proposal.mindmap ?? []).map((n) => n.text),
    ]);
    if (uncovered.length)
      proposal.blocks.push({
        type: "paragraph",
        text: "Other details",
        columns: [],
        rows: [],
        children: [
          ...uncovered.slice(0, 29),
          ...(uncovered.length > 29 ? [uncovered.slice(29).join(" ")] : []),
        ].map((text) => ({ type: "bulleted" as const, text, columns: [], rows: [] })),
      });
    // Lay the cards out, then move the whole group where the original was,
    // or down past anything in the way.
    const laid = layoutAiCards(
      proposal.blocks.map(aiBlockText),
      connections,
      0,
      proposal.blocks.map(aiBlockSize),
    );
    const minX = Math.min(...laid.map((b) => b[0]));
    const minY = Math.min(...laid.map((b) => b[1]));
    const width = Math.max(...laid.map((b) => b[0] + b[2])) - minX + 2 * FRAME_PAD;
    const height =
      Math.max(...laid.map((b) => b[1] + b[3])) - minY + FRAME_PAD + FRAME_TOP;
    const occupied = [
      ...doc
        .getBlocksByFlavour("affine:note")
        .map((b) => b.model as NoteBlockModel)
        .filter((m) => m.id !== note.id),
      // Arrows and groups don't block; the arrows to the original move.
      ...(surface?.elementModels ?? []).filter(
        (e) => e.type !== "connector" && e.type !== "group",
      ),
    ].flatMap((e) => {
      const b = "xywh" in e ? parseBox(e.xywh) : undefined;
      return b ? [b] : [];
    });
    const region = clearPlacement(box[0], box[1], occupied, [width, height]);
    replaced = {
      note,
      title:
        source.find((t) => t.trim())?.split("\n")[0].trim().slice(0, 120) ||
        "Ideas",
      region,
      shift: [region[0] + FRAME_PAD - minX, region[1] + FRAME_TOP - minY],
    };
  }
  const connectorMode = {
    curve: ConnectorMode.Curve,
    elbowed: ConnectorMode.Orthogonal,
    straight: ConnectorMode.Straight,
  }[getAiConnectorShape()];
  let right = 0;
  if (mode === "canvas")
    for (const element of [
      ...doc.getBlocksByFlavour("affine:note").map((b) => b.model),
      ...(surface?.elementModels ?? []),
    ]) {
      if ("xywh" in element) {
        const b = JSON.parse(String(element.xywh));
        if (Array.isArray(b) && b.length === 4 && b.every(Number.isFinite))
          right = Math.max(right, b[0] + b[2] + 80);
      }
    }
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
    } else if (mode === "canvas") {
      const bounds = layoutAiCards(
        proposal.blocks.map(aiBlockText),
        connections,
        replaced ? 0 : right,
        proposal.blocks.map(aiBlockSize),
      ).map(([x, y, w, h]): [number, number, number, number] =>
        replaced
          ? [x + replaced.shift[0], y + replaced.shift[1], w, h]
          : [x, y, w, h],
      );
      if (proposal.mindmap?.length) {
        type Node = { text: string; children: Node[]; xywh?: string };
        const nodes: Node[] = proposal.mindmap.map(({ text }) => ({
          text,
          children: [],
        }));
        const mapLeft = bounds.length
          ? Math.max(...bounds.map(([x, , width]) => x + width)) + 160
          : right;
        nodes[0].xywh = JSON.stringify([
          mapLeft,
          replaced ? replaced.region[1] : 0,
          180,
          50,
        ]);
        proposal.mindmap.forEach(({ parent }, i) => {
          if (i) nodes[parent].children.push(nodes[i]);
        });
        surface!.addElement({ type: "mindmap", children: nodes[0] });
      }
      const ids = proposal.blocks.map((block, i) => {
        const [x, y, w, h] = bounds[i];
        const id = doc.addBlock(
          "affine:note",
          { xywh: `[${x},${y},${w},${h}]` },
          doc.root!,
        );
        appendAiBlock(doc, id, block);
        appendWebProvenance(
          doc,
          id,
          context.webContext,
          [...(block.sourceRefs ?? [])],
          block.text,
        );
        for (const child of block.children ?? [])
          appendWebProvenance(
            doc,
            id,
            context.webContext,
            child.sourceRefs ?? [],
            child.text,
          );
        for (const edge of connections.filter((c) => c.from === i))
          appendWebProvenance(
            doc,
            id,
            context.webContext,
            edge.sourceRefs ?? [],
            `Connection: ${edge.label}`,
          );
        return id;
      });
      // The first new card, for Open cards.
      noteId = ids[0];
      if (proposal.mindmap?.some((n) => n.sourceRefs?.length)) {
        const id =
          ids[0] ??
          doc.addBlock(
            "affine:note",
            {
              xywh: `[${right},${Math.max(0, ...bounds.map((b) => b[1] + b[3])) + 100},420,320]`,
            },
            doc.root!,
          );
        for (const node of proposal.mindmap)
          appendWebProvenance(
            doc,
            id,
            context.webContext,
            node.sourceRefs ?? [],
            `Mind map node: ${node.text}`,
          );
      }
      for (const [index, c] of connections.entries()) {
        const ports = aiConnectorPorts(bounds[c.from], bounds[c.to]);
        surface!.addElement({
          type: "connector",
          mode: connectorMode,
          // Typed arrows from Break this into ideas share a color per type.
          stroke: (replaced && relationStroke(c.label)) || aiConnectorStroke(index),
          source: { id: ids[c.from], position: ports.source },
          target: { id: ids[c.to], position: ports.target },
          text: new Y.Text(c.label),
        });
      }
      if (replaced) {
        const original = replaced.note.id;
        const frame = doc.addBlock(
          "affine:frame" as never,
          {
            title: new Text(replaced.title),
            xywh: `[${replaced.region.join(",")}]`,
            childElementIds: Object.fromEntries(ids.map((id) => [id, true])),
          },
          surface!.id,
        );
        // Arrows that pointed at the original now point at its frame.
        for (const element of surface!.elementModels) {
          if (element.type !== "connector") continue;
          const edge = element as unknown as {
            id: string;
            source?: { id?: string };
            target?: { id?: string };
          };
          if (edge.source?.id === original)
            surface!.updateElement(edge.id, { source: { id: frame } });
          if (edge.target?.id === original)
            surface!.updateElement(edge.id, { target: { id: frame } });
        }
        doc.deleteBlock(replaced.note);
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
  // The original's card goes to Trash with it unless it is shown elsewhere;
  // Undo bringing the note back reclaims it.
  const deck = replaced ? mcqDecks.get(doc.spaceDoc) : undefined;
  const replacedCard = replaced
    ? doc.spaceDoc.getMap<string>("knot:card-links").get(replaced.note.id)
    : undefined;
  const trashed =
    !!replacedCard && !!deck?.trashUnplaced(replacedCard);
  let item = doc.history.undoStack.at(-1);
  let appliedVersion = version(doc);
  const finishCapture = () => {
    doc.captureSync();
    item = doc.history.undoStack.at(-1);
    appliedVersion = version(doc);
  };
  // BlockSuite lays out newly created mind maps in a microtask.
  if (proposal.mindmap?.length) queueMicrotask(finishCapture);
  else finishCapture();
  const undo = () => {
    if (
      version(doc) !== appliedVersion ||
      doc.history.undoStack.at(-1) !== item
    )
      throw new Error(
        "There are newer edits. Use the editor’s Undo to undo them in order.",
      );
    doc.undo();
    if (trashed) deck!.restore(replacedCard!);
  };
  return Object.assign(undo, { noteId });
}

const FRAME_PAD = 40;
const FRAME_TOP = 60;
function parseBox(xywh: unknown): Box | undefined {
  try {
    const b: unknown = JSON.parse(String(xywh));
    return Array.isArray(b) && b.length === 4 && b.every(Number.isFinite)
      ? (b as Box)
      : undefined;
  } catch {
    return undefined;
  }
}
