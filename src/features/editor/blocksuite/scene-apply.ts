/**
 * Draws a validated scene on the open canvas: cards, free text, shapes,
 * frames, mind maps and arrows, placed by scene-solver.ts.
 *
 * Sizes are estimated first, so everything appears at once. When the editor
 * has measured the new cards, the scene is solved again with the real sizes
 * and objects move to their final places. Both steps are one undo step.
 */
import * as Y from "yjs";
import { Text, type Doc } from "@blocksuite/store";
import { ConnectorMode, type NoteBlockModel, type SurfaceBlockModel } from "@blocksuite/blocks";
import { uncoveredPassages } from "../../../services/ai-atomize";
import { mcqDecks } from "./mcq-block";
import { dissolveDotsAmong } from "./reroute";
import { getAiConnectorShape } from "../../../services/ai-preferences";
import { canvasHandles } from "../../../services/canvas-map-format";
import { aiBlockSize, appendAiBlock, type AiCite } from "./ai-content";
import { resolvePdfCitation } from "../../../services/pdf-citations";
import { pdfSourceUrl } from "./pdf-highlights";
import { appendWebProvenance } from "./web-source";
import {
  ARROW_LABEL_COLOR,
  canvasObstacles,
  connectorLabel,
  parseBox,
  structuredAiBlocks,
  undoApplied,
  version,
  type AiContext,
} from "./ai";
import { sceneCardBlock, sceneTexts, wrapForReplacement, type Scene, type SceneObject } from "./scene";
import { FRAME_PAD, FRAME_TOP, solveScene, type Box, type Size } from "./scene-solver";
import { arrowRoute } from "./scene-report";

type SceneUndo = (() => void) & {
  noteId?: string;
  created: string[];
  /** Resolves once objects are in their final, measured places. */
  settled: Promise<void>;
  /** What Knot adjusted while placing the scene. */
  report: string[];
};

const LAYOUT = { right: 0, left: 1, balance: 2 } as const;
/** Shape fills stay light in both themes, so their labels stay dark. */
const SHAPE_LABEL_COLOR = { light: "#2b2b2b", dark: "#1f1f1f" };
/** Arrows without a chosen colour: readable on light and dark canvases. */
const NEUTRAL_ARROW = { light: "#7a7a76", dark: "#9b9b97" };
/** Frames the editor gets to measure new cards before final placement (about 3 s). */
const MEASURE_FRAMES = 180;
/** Frames to wait before trusting that sizes have stopped changing. */
const MIN_MEASURE_FRAMES = 8;
/** Unchanged frames, with every new card drawn, that count as settled. */
const STILL_FRAMES = 6;

type LazyNote = HTMLElement & { _knotRich?: boolean; _knotMount?: (force?: boolean) => void };
/**
 * Knot draws a canvas card's content only once it's on screen, one card per
 * frame and never while the view moves (see the BlockSuite patch). Until
 * then a card keeps its estimated size, so the second solve would place it
 * by a guess and it would grow over its neighbours later. This draws the new
 * cards now and returns how many of them the editor shows.
 */
function drawCards(ids: string[]): number {
  if (typeof document === "undefined") return 0;
  let shown = 0;
  for (const id of ids)
    for (const view of document.querySelectorAll<LazyNote>(
      `affine-edgeless-note[data-block-id="${CSS.escape(id)}"]`,
    )) {
      shown++;
      if (view._knotRich === false) view._knotMount?.(false);
    }
  return shown;
}
/**
 * A card's height from its text, calibrated against cards the editor
 * measured (360 px wide: title and padding about 206 px, a body line about
 * 20 px, 7 px between blocks). The editor's own measurement replaces it
 * whenever the card is on screen.
 */
export function cardHeight(o: SceneObject, width: number): number {
  const perLine = (px: number) => Math.max(8, Math.floor((width - 60) / px));
  const lines = (text: string, px: number) =>
    text
      .split("\n")
      .reduce((n, line) => n + Math.max(1, Math.ceil(Array.from(line).length / perLine(px))), 0);
  let height = 176 + lines(o.text || " ", 12.5) * 30;
  for (const c of o.content) {
    if (c.type === "table") {
      // Cells wrap: a row is as tall as its longest cell.
      const columns = Math.max(1, c.columns?.length ?? 0, ...(c.rows ?? []).map((r) => r.length));
      const perCell = Math.max(6, Math.floor((width - 84) / columns / 7.5));
      const rowHeight = (cells: string[]) =>
        16 + 22 * Math.max(1, ...cells.map((cell) => Math.ceil(Array.from(cell || " ").length / perCell)));
      height += 48 + rowHeight(c.columns ?? []) + (c.rows ?? []).reduce((h, r) => h + rowHeight(r), 0);
    }
    else if (c.type === "kanban") height += 120 + (c.rows?.length ?? 0) * 70;
    else if (c.type === "h1" || c.type === "h2" || c.type === "h3")
      height += lines(c.text, 10) * 28 + 10;
    else height += lines(c.text, c.type === "paragraph" ? 7 : 7.6) * 20 + 7;
  }
  return Math.round(height);
}

/** A rough size from text length; the editor's measurement replaces it. */
function estimate(o: SceneObject): Size {
  const chars = Array.from(o.text).length;
  if (o.kind === "card") {
    const width = o.width || aiBlockSize(sceneCardBlock(o)).width;
    return { width, height: cardHeight(o, width) };
  }
  if (o.kind === "text") {
    const width = o.width || Math.min(900, Math.max(160, chars * 13 + 24));
    return { width, height: Math.ceil((chars * 13 + 24) / width) * 34 + 10 };
  }
  if (o.kind === "shape") {
    const round = o.shape === "diamond" || o.shape === "ellipse" || o.shape === "triangle";
    const width = o.width || Math.min(420, Math.max(160, chars * 9 + 60)) * (round ? 1.3 : 1);
    const lines = Math.ceil((chars * 9 + 40) / (width * (round ? 0.6 : 0.85)));
    return { width, height: Math.max(round ? 120 : 90, lines * 26 + (round ? 70 : 40)) };
  }
  if (o.kind === "mindmap") {
    const depth = o.nodes.map((_, i) => {
      let d = 0;
      for (let at = i; o.nodes[at].parent >= 0; at = o.nodes[at].parent) d++;
      return d;
    });
    const leaves = o.nodes.filter((_, i) => !o.nodes.some((n) => n.parent === i)).length;
    return {
      width: (Math.max(...depth) + 1) * 240 * (o.direction === "balance" ? 1.1 : 1),
      height: Math.max(60, leaves * 56),
    };
  }
  return { width: 0, height: 0 };
}

/** Boxes of the selected objects, from the map captured with the request. */
function selectionBox(context: AiContext): Box | undefined {
  const map = context.canvasMap;
  if (!map?.selected.length) return undefined;
  const boxes = [...map.cards, ...map.frames, ...map.texts, ...map.mindmaps]
    .filter((o) => map.selected.includes(o.id))
    .map((o) => o.box as Box);
  if (!boxes.length) return undefined;
  const x = Math.min(...boxes.map((b) => b[0]));
  const y = Math.min(...boxes.map((b) => b[1]));
  return [
    x,
    y,
    Math.max(...boxes.map((b) => b[0] + b[2])) - x,
    Math.max(...boxes.map((b) => b[1] + b[3])) - y,
  ];
}

/** Everything the solver needs for a scene on this canvas, and its layout. */
export function planScene(
  doc: Doc,
  context: AiContext,
  scene: Scene,
  options: {
    view?: Box;
    /** Break this into ideas: the card the scene takes the place of. */
    replaces?: { id: string; box: Box };
  } = {},
) {
  const surface = doc.getBlocksByFlavour("affine:surface")[0]?.model as
    | SurfaceBlockModel
    | undefined;
  if (!context.canvas || !surface || !doc.root)
    throw new Error("Open the canvas to add this.");
  // Existing objects named by handle must still be there.
  const targets = context.canvasMap ? canvasHandles(context.canvasMap) : new Map();
  const handles = new Map<string, Box>();
  const handleIds = new Map<string, string>();
  const used = new Set<string>([
    ...scene.objects.map((o) => o.ref),
    ...scene.objects.map((o) => o.into ?? ""),
    ...scene.objects.map((o) => o.place.of),
    ...scene.arrangements.map((a) => a.place.of),
    ...scene.connectors.flatMap((c) => [c.from, c.to]),
    scene.anchor.near,
  ]);
  for (const [handle, target] of targets) {
    if (!used.has(handle)) continue;
    // A free area is a place; there is nothing to look up.
    if (target.area && target.box) {
      handles.set(handle, target.box as Box);
      continue;
    }
    if (!target.box || !(doc.getBlock(target.id) || surface.getElementById(target.id)))
      throw new Error("This refers to something that isn't on the canvas any more. Try again.");
    handles.set(handle, target.box as Box);
    handleIds.set(handle, target.id);
  }
  // What's already on the canvas: moved ones are placed like new objects but
  // keep their size; listed ones that don't move are pinned where they are.
  const existingIds = new Map<string, string>();
  const fixed = new Map<string, Box>();
  const moved = new Set<string>();
  const arranged = new Set(scene.arrangements.flatMap((a) => a.members));
  const frameOf = (id: string) => context.canvasMap?.frames.find((f) => f.members.includes(id))?.id;
  /** Existing objects that end up in another frame, so they leave theirs. */
  const switching = new Set<string>();
  for (const o of scene.objects) {
    if (o.kind !== "existing") continue;
    const id = handleIds.get(o.ref);
    const box = handles.get(o.ref);
    if (!id || !box) throw new Error("This refers to something that isn't on the canvas any more. Try again.");
    existingIds.set(o.id, id);
    // Joining an existing frame it isn't in: it moves beside that frame.
    const target = o.into ? handleIds.get(o.into) : undefined;
    if (target && target !== frameOf(id)) {
      switching.add(id);
      if (!o.place.rel && o.cell.length !== 2 && !arranged.has(o.id))
        o.place = { rel: "near", of: o.into!, align: "start", gap: 0 };
    }
    const moves =
      /^[KT]\d/.test(o.ref) && (!!o.place.rel || o.cell.length === 2 || !!o.in || arranged.has(o.id));
    if (moves) moved.add(id);
    else if (!o.in) fixed.set(o.id, box);
  }
  // A free area holds the scene: it starts at the area's corner.
  const area = /^A\d+$/.test(scene.anchor.near) ? handles.get(scene.anchor.near) : undefined;
  const replaces = options.replaces;
  const anchor = area || replaces
    ? undefined
    : scene.anchor.near === "selection"
      ? selectionBox(context)
      : handles.get(scene.anchor.near);
  // A replacement takes the original's place, which no longer blocks.
  const listed = new Set(existingIds.values());
  // Frames whose cards move, unless those cards go into a frame of the scene:
  // they stay their frame and fit around them, so they don't block them.
  const regrouped = new Set([
    ...scene.objects.filter((o) => o.kind === "existing" && o.in).map((o) => existingIds.get(o.id)!),
    ...switching,
  ]);
  const homeFrames = [
    ...new Set([
      ...(context.canvasMap?.frames ?? [])
        .filter((f) => f.members.some((id) => moved.has(id) && !regrouped.has(id)))
        .map((f) => f.id),
      // Existing frames that take objects in.
      ...scene.objects.flatMap((o) => (o.into && handleIds.get(o.into) ? [handleIds.get(o.into)!] : [])),
    ]),
  ];
  const obstacles = canvasObstacles(
    doc,
    (id) => id === replaces?.id || listed.has(id) || homeFrames.includes(id),
  );
  // Rearranging what's there keeps it roughly where it was.
  const movedBoxes = scene.objects
    .filter((o) => moved.has(existingIds.get(o.id) ?? ""))
    .map((o) => handles.get(o.ref)!);
  const rearranged: [number, number] | undefined =
    !scene.anchor.near && movedBoxes.length
      ? [Math.min(...movedBoxes.map((b) => b[0])), Math.min(...movedBoxes.map((b) => b[1]))]
      : undefined;
  const origin: [number, number] = replaces
    ? [replaces.box[0], replaces.box[1]]
    : rearranged
    ? rearranged
    : area
    ? [area[0], area[1]]
    : scene.anchor.near === "view" && options.view
      ? [options.view[0] + 60, options.view[1] + 60]
      : [Math.max(0, ...obstacles.map((b) => b[0] + b[2] + 80)), 0];
  const sizes = new Map(
    scene.objects.map((o) => {
      const box = o.kind === "existing" ? handles.get(o.ref) : undefined;
      return [o.id, box ? { width: box[2], height: box[3] } : estimate(o)];
    }),
  );
  const solve = () =>
    solveScene(scene, { sizes, handles, obstacles, anchor: rearranged ? undefined : anchor, origin, fixed });
  const { boxes, report } = solve();
  return { surface, handles, handleIds, existingIds, moved, regrouped, homeFrames, sizes, solve, boxes, report };
}

/**
 * Break this into ideas: the scene takes the card's place in a frame with
 * its title, and whatever it doesn't cover is kept on "Other details".
 */
export function prepareReplacement(doc: Doc, scene: Scene, noteId: string) {
  const found = doc.getBlock(noteId)?.model;
  const note = found?.flavour === "affine:note" ? (found as NoteBlockModel) : undefined;
  const box = note ? parseBox(note.xywh) : undefined;
  if (!note || !box || note.isLocked())
    throw new Error("The original card is unavailable. Select it again and retry.");
  const source = structuredAiBlocks(note).map((b) => b.text);
  const title = source.find((t) => t.trim())?.split("\n")[0].trim().slice(0, 120) || "Ideas";
  const uncovered = uncoveredPassages(source, sceneTexts(scene));
  const wrapped = wrapForReplacement(scene, title, uncovered);
  return {
    scene: wrapped.scene,
    replaced: { note, box: box as Box, frame: wrapped.frame },
    uncovered,
  };
}

/**
 * Links for the page and slide citations the model writes into cards, such
 * as "(12-Test+Levels.pptx, slide 3)": each becomes a readable link that
 * opens the PDF reader at that page, like citations in Ask Knot answers.
 */
export function sceneCitations(context: AiContext): AiCite | undefined {
  const pdfs = context.pdfFiles?.length
    ? context.pdfFiles
    : context.pdfSource
      ? [{ key: context.pdfSource.key, name: context.selectionLabel || context.label || "PDF" }]
      : [];
  if (!pdfs.length) return undefined;
  return (text) => {
    const cited = resolvePdfCitation(text, pdfs);
    if (!cited) return undefined;
    try {
      const url = pdfSourceUrl({ key: cited.pdf.key, name: cited.pdf.name, documentId: context.document, page: cited.page, rects: [] });
      return { label: cited.label, url };
    } catch {
      return undefined;
    }
  };
}

export function applyScene(
  doc: Doc,
  context: AiContext,
  input: Scene,
  options: {
    view?: Box;
    /** Brings objects into view, so the editor renders and measures them. */
    reveal?: (ids: string[]) => void;
    /** Break this into ideas: the card the scene replaces (it goes to Trash). */
    replaces?: string;
  } = {},
): SceneUndo {
  let scene = input;
  let replaced: { note: NoteBlockModel; box: Box; frame: string } | undefined;
  if (options.replaces) {
    const prepared = prepareReplacement(doc, scene, options.replaces);
    scene = prepared.scene;
    replaced = prepared.replaced;
  }
  const planned = planScene(doc, context, scene, {
    view: options.view,
    ...(replaced && { replaces: { id: replaced.note.id, box: replaced.box } }),
  });
  const { surface, handleIds, existingIds, moved, regrouped, homeFrames, sizes, solve } = planned;
  /** Fits frames whose cards moved around their members again. */
  const refit = () => {
    for (const frameId of homeFrames) {
      const frame = doc.getBlock(frameId)?.model as unknown as
        | { childElementIds?: Record<string, boolean> }
        | undefined;
      if (!frame) continue;
      const members = Object.keys(frame.childElementIds ?? {}).flatMap((id) => {
        const m = (doc.getBlock(id)?.model ?? surface.getElementById(id)) as unknown as { xywh?: unknown } | null;
        const b = parseBox(m?.xywh);
        return b ? [b as Box] : [];
      });
      if (!members.length) continue;
      const x = Math.min(...members.map((b) => b[0])) - FRAME_PAD;
      const y = Math.min(...members.map((b) => b[1])) - FRAME_TOP;
      const w = Math.max(...members.map((b) => b[0] + b[2])) + FRAME_PAD - x;
      const h = Math.max(...members.map((b) => b[1] + b[3])) + FRAME_PAD - y;
      doc.updateBlock(frame as never, { xywh: xywh([x, y, w, h]) } as never);
    }
  };
  /** Moves an object already on the canvas (a card or a canvas element). */
  const move = (id: string, box: Box) => {
    const model = doc.getBlock(id)?.model;
    if (model) doc.updateBlock(model, { xywh: xywh(box) } as never);
    else surface.updateElement(id, { xywh: xywh(box) } as never);
  };
  let { boxes } = planned;
  let report = [...scene.notes, ...planned.report];

  const ids = new Map<string, string>();
  const cite = sceneCitations(context);
  const mindmapNodes = new Map<string, string[]>();
  const shape = getAiConnectorShape();
  const connectorMode = {
    curve: ConnectorMode.Curve,
    elbowed: ConnectorMode.Orthogonal,
    straight: ConnectorMode.Straight,
  }[shape];
  /** Arrows made here, with the scene connector each one draws. */
  const arrows: { id: string; c: Scene["connectors"][number] }[] = [];
  /**
   * The sides an arrow attaches to, facing each other, so the editor draws
   * the path the layout check measured (see arrowRoute). Mind map branches
   * keep the editor's own choice.
   */
  const sides = (c: Scene["connectors"][number], at: Map<string, Box>) => {
    const box = (ref: string) => {
      if (ref.includes("#")) return undefined;
      if (replaced && handleIds.get(ref) === replaced.note.id) return at.get(replaced.frame);
      return at.get(ref) ?? planned.handles.get(ref);
    };
    const a = box(c.from);
    const b = box(c.to);
    return a && b ? arrowRoute(a, b, shape) : undefined;
  };
  const xywh = (b: Box) => `[${b.map((n) => Math.round(n)).join(",")}]`;

  const history = doc.history as unknown as { captureTimeout: number };
  const timeout = history.captureTimeout;
  doc.captureSync();
  // Creation, arrows and final placement are one undo step.
  history.captureTimeout = 60_000;
  doc.transact(() => {
    // Reroute points between moved cards belong to the old layout; their
    // arrows are joined back into direct ones.
    if (moved.size) dissolveDotsAmong(surface, moved);
    for (const o of scene.objects) {
      const box = boxes.get(o.id)!;
      if (o.kind === "existing") {
        const id = existingIds.get(o.id)!;
        ids.set(o.id, id);
        if (moved.has(id)) move(id, box);
        continue;
      }
      if (o.kind === "card") {
        const id = doc.addBlock(
          "affine:note",
          {
            xywh: xywh(box),
            ...(o.color && { background: `--affine-note-background-${o.color}` }),
          } as never,
          doc.root!,
        );
        appendAiBlock(doc, id, sceneCardBlock(o), cite);
        const refs = [
          ...(o.sourceRefs ?? []),
          ...o.content.flatMap((c) => c.sourceRefs ?? []),
        ];
        if (refs.length) appendWebProvenance(doc, id, context.webContext, refs, o.text);
        ids.set(o.id, id);
      } else if (o.kind === "text") {
        ids.set(
          o.id,
          surface.addElement({
            type: "text",
            xywh: xywh(box),
            text: new Y.Text(o.text),
            color: ARROW_LABEL_COLOR,
            fontSize: 24,
            fontFamily: "blocksuite:surface:Inter",
            textAlign: "left",
          } as never),
        );
      } else if (o.kind === "shape") {
        ids.set(
          o.id,
          surface.addElement({
            type: "shape",
            shapeType: o.shape === "roundedRect" ? "rect" : o.shape,
            radius: o.shape === "roundedRect" ? 0.1 : 0,
            xywh: xywh(box),
            filled: true,
            fillColor: `--affine-palette-shape-${o.color || "grey"}`,
            strokeColor: `--affine-palette-line-${o.color || "grey"}`,
            strokeWidth: 2,
            shapeStyle: "General",
            text: new Y.Text(o.text),
            color: SHAPE_LABEL_COLOR,
            fontSize: 18,
            fontFamily: "blocksuite:surface:Inter",
            textAlign: "center",
          } as never),
        );
      } else if (o.kind === "mindmap") {
        type Node = { text: string; children: Node[]; xywh?: string };
        const nodes: Node[] = o.nodes.map(({ text }) => ({ text, children: [] }));
        o.nodes.forEach(({ parent }, i) => {
          if (i) nodes[parent].children.push(nodes[i]);
        });
        nodes[0].xywh = JSON.stringify([box[0], box[1] + box[3] / 2 - 25, 180, 50]);
        ids.set(
          o.id,
          surface.addElement({
            type: "mindmap",
            children: nodes[0],
            ...(o.direction && { layoutType: LAYOUT[o.direction] }),
          } as never),
        );
        // A mind map's web evidence goes on a companion card under it.
        if (o.nodes.some((n) => n.sourceRefs?.length)) {
          const note = doc.addBlock(
            "affine:note",
            { xywh: xywh([box[0], box[1] + box[3] + 60, 420, 200]) } as never,
            doc.root!,
          );
          doc.addBlock("affine:paragraph", { text: new Text(`Sources for “${o.nodes[0].text}”`) } as never, note);
          for (const node of o.nodes)
            appendWebProvenance(doc, note, context.webContext, node.sourceRefs ?? [], `Mind map node: ${node.text}`);
        }
      }
    }
    // Objects put in a frame of the scene leave the frames they were in.
    for (const { model } of doc.getBlocksByFlavour("affine:frame")) {
      const held = (model as unknown as { childElementIds?: Record<string, boolean> }).childElementIds ?? {};
      if (Object.keys(held).some((id) => regrouped.has(id)))
        doc.updateBlock(model, {
          childElementIds: Object.fromEntries(Object.entries(held).filter(([id]) => !regrouped.has(id))),
        } as never);
    }
    // Objects joining an existing frame.
    for (const o of scene.objects) {
      const target = o.into ? handleIds.get(o.into) : undefined;
      const frame = target ? (doc.getBlock(target)?.model as unknown as { childElementIds?: Record<string, boolean> } | undefined) : undefined;
      const id = ids.get(o.id);
      if (frame && id && !frame.childElementIds?.[id])
        doc.updateBlock(frame as never, { childElementIds: { ...(frame.childElementIds ?? {}), [id]: true } } as never);
    }
    refit();
    // Frames last: they list what they hold, and sit behind it.
    const frames = scene.objects.filter((o) => o.kind === "frame");
    for (const f of [...frames].reverse()) {
      const members = scene.objects
        .filter((o) => o.in === f.id && ids.has(o.id))
        .map((o) => ids.get(o.id)!);
      ids.set(
        f.id,
        doc.addBlock(
          "affine:frame" as never,
          {
            title: new Text(f.text || "Section"),
            xywh: xywh(boxes.get(f.id)!),
            childElementIds: Object.fromEntries(members.map((id) => [id, true])),
          },
          surface.id,
        ),
      );
    }
    // Frames inside frames are members too, once both exist.
    for (const f of frames) {
      if (!f.in) continue;
      const parent = doc.getBlock(ids.get(f.in)!)?.model as unknown as {
        childElementIds?: Record<string, boolean>;
      };
      if (parent)
        doc.updateBlock(parent as never, {
          childElementIds: { ...(parent.childElementIds ?? {}), [ids.get(f.id)!]: true },
        } as never);
    }
  });
  // Arrows come second: a mind map's node tree exists once it's created.
  doc.transact(() => {
    // Mind map nodes in input order, for arrows to "map#n".
    for (const o of scene.objects) {
      if (o.kind !== "mindmap") continue;
      const element = surface.getElementById(ids.get(o.id)!) as unknown as {
        tree?: { id: string; children: unknown[] };
      } | null;
      const order: string[] = [];
      const walk = (node: { id: string; children: unknown[] } | undefined) => {
        if (!node) return;
        order.push(node.id);
        for (const child of node.children) walk(child as { id: string; children: unknown[] });
      };
      walk(element?.tree);
      // The tree is in depth-first order; map it back to input order.
      const inputOrder: number[] = [];
      const visit = (i: number) => {
        inputOrder.push(i);
        o.nodes.forEach((n, k) => {
          if (k && n.parent === i) visit(k);
        });
      };
      visit(0);
      const byInput: string[] = [];
      if (order.length === o.nodes.length)
        inputOrder.forEach((input, k) => (byInput[input] = order[k]));
      mindmapNodes.set(o.id, byInput);
    }
    const endpoint = (ref: string): string | undefined => {
      if (ids.has(ref)) return ids.get(ref);
      if (replaced && handleIds.get(ref) === replaced.note.id) return ids.get(replaced.frame);
      if (handleIds.has(ref)) return handleIds.get(ref);
      const node = /^(.+)#(\d+)$/.exec(ref);
      if (node) return mindmapNodes.get(node[1])?.[Number(node[2])] ?? ids.get(node[1]);
      return undefined;
    };
    for (const c of scene.connectors) {
      const from = endpoint(c.from);
      const to = endpoint(c.to);
      if (!from || !to) {
        report.push(`Left out the arrow from "${c.from}" to "${c.to}".`);
        continue;
      }
      const route = sides(c, boxes);
      const arrow = surface.addElement({
        type: "connector",
        mode: connectorMode,
        // One quiet colour unless the scene gives arrows meaning by colour.
        stroke: c.color ? `--affine-palette-line-${c.color}` : NEUTRAL_ARROW,
        strokeStyle: c.style === "dashed" ? "dash" : "solid",
        source: { id: from, ...(route && { position: route.from }) },
        target: { id: to, ...(route && { position: route.to }) },
        frontEndpointStyle: c.heads === "from" || c.heads === "both" ? "Arrow" : "None",
        rearEndpointStyle: c.heads === "to" || c.heads === "both" ? "Arrow" : "None",
        ...(c.label && { text: new Y.Text(c.label), ...connectorLabel(c.label) }),
      } as never) as unknown as string;
      arrows.push({ id: arrow, c });
      // An arrow's web evidence is kept on the new card it starts from.
      if (c.sourceRefs?.length && doc.getBlock(from)?.model.flavour === "affine:note")
        appendWebProvenance(doc, from, context.webContext, c.sourceRefs, `Connection: ${c.label}`);
    }
    if (replaced) {
      // Arrows that pointed at the original now point at its frame.
      const frame = ids.get(replaced.frame)!;
      const original = replaced.note.id;
      for (const element of surface.elementModels) {
        if (element.type !== "connector") continue;
        const edge = element as unknown as { id: string; source?: { id?: string }; target?: { id?: string } };
        if (edge.source?.id === original) surface.updateElement(edge.id, { source: { id: frame } } as never);
        if (edge.target?.id === original) surface.updateElement(edge.id, { target: { id: frame } } as never);
      }
      doc.deleteBlock(replaced.note);
    }
  });
  // The original's card goes to Trash with it unless it's shown elsewhere;
  // Undo brings it back.
  const deck = replaced ? mcqDecks.get(doc.spaceDoc) : undefined;
  const replacedCard = replaced
    ? doc.spaceDoc.getMap<string>("knot:card-links").get(replaced.note.id)
    : undefined;
  const trashed = !!replacedCard && !!deck?.trashUnplaced(replacedCard);

  let item = doc.history.undoStack.at(-1);
  let appliedVersion = version(doc);
  const created = scene.objects.map((o) => ids.get(o.id)!).filter(Boolean);
  const cards = scene.objects.filter((o) => o.kind === "card");

  /** Real sizes the editor has measured so far. */
  const measured = () => {
    const real = new Map(sizes);
    for (const o of scene.objects) {
      const id = ids.get(o.id);
      if (!id || o.kind === "frame") continue;
      const model = (doc.getBlock(id)?.model ?? surface.getElementById(id)) as unknown as {
        xywh?: unknown;
        elementBound?: { w: number; h: number };
      } | null;
      const bound =
        o.kind === "mindmap" && model?.elementBound
          ? { width: model.elementBound.w, height: model.elementBound.h }
          : (() => {
              const b = parseBox(model?.xywh);
              return b ? { width: b[2], height: b[3] } : undefined;
            })();
      if (bound && bound.width > 0 && bound.height > 0) real.set(o.id, bound);
    }
    return real;
  };
  const undo = () => {
    undoApplied(doc, item, appliedVersion);
    if (trashed) deck!.restore(replacedCard!);
  };
  const result: SceneUndo = Object.assign(undo, {
    noteId: cards.length ? ids.get(cards[0].id) : undefined,
    created,
    settled: Promise.resolve(),
    report,
  });
  options.reveal?.(created);
  result.settled = (async () => {
    try {
      // Undone before it settled: nothing left to place.
      const gone = () =>
        [...ids.values()].every((id) => !doc.getBlock(id) && !surface.getElementById(id));
      let last = "";
      let still = 0;
      const cardIds = cards.map((o) => ids.get(o.id)!).filter(Boolean);
      for (let frame = 0; frame < MEASURE_FRAMES; frame++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        // Cards come into view as the reveal moves the canvas; the count
        // keeps sizes from looking settled before they've been drawn.
        const shown = drawCards(cardIds);
        const key = JSON.stringify([shown, ...[...measured()].map(([, s]) => [Math.round(s.width), Math.round(s.height)])]);
        still = key === last ? still + 1 : 0;
        last = key;
        if (frame >= MIN_MEASURE_FRAMES && still >= STILL_FRAMES) break;
      }
      if (gone()) return;
      const real = measured();
      for (const [id, s] of real) sizes.set(id, s);
      const next = solve();
      const moves = scene.objects.filter((o) => {
        const a = boxes.get(o.id)!;
        const b = next.boxes.get(o.id)!;
        return a.some((n, i) => Math.abs(n - b[i]) > 1);
      });
      if (moves.length)
        doc.transact(() => {
          for (const o of moves) {
            const id = ids.get(o.id);
            const box = next.boxes.get(o.id)!;
            if (!id) continue;
            if (o.kind === "existing") {
              if (moved.has(id)) move(id, box);
            } else if (o.kind === "card" || o.kind === "frame") {
              const model = doc.getBlock(id)?.model;
              // A card keeps the height the editor measured.
              if (model) doc.updateBlock(model, { xywh: xywh(box) } as never);
            } else if (o.kind === "mindmap") {
              const element = surface.getElementById(id) as unknown as {
                moveTo?: (xywh: Box) => void;
              } | null;
              element?.moveTo?.(box);
            } else surface.updateElement(id, { xywh: xywh(box) } as never);
          }
          // Objects moved, so the sides that face each other may have changed.
          for (const { id, c } of arrows) {
            const route = sides(c, next.boxes);
            const arrow = surface.getElementById(id) as unknown as {
              source?: { id?: string; position?: number[] };
              target?: { id?: string; position?: number[] };
            } | null;
            if (!route || !arrow?.source?.id || !arrow.target?.id) continue;
            if (`${arrow.source.position}` === `${route.from}` && `${arrow.target.position}` === `${route.to}`) continue;
            surface.updateElement(id, {
              source: { id: arrow.source.id, position: route.from },
              target: { id: arrow.target.id, position: route.to },
            } as never);
          }
          refit();
        });
      boxes = next.boxes;
      report = [...scene.notes, ...next.report, ...report.filter((r) => r.startsWith("Left out"))];
      result.report = report;
    } finally {
      doc.captureSync();
      history.captureTimeout = timeout;
      item = doc.history.undoStack.at(-1);
      appliedVersion = version(doc);
    }
  })();
  return result;
}
