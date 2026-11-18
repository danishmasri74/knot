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
import { ConnectorMode, type SurfaceBlockModel } from "@blocksuite/blocks";
import { getAiConnectorShape } from "../../../services/ai-preferences";
import { canvasHandles } from "../../../services/canvas-map-format";
import { aiBlockSize, appendAiBlock } from "./ai-content";
import { appendWebProvenance } from "./web-source";
import {
  ARROW_LABEL_COLOR,
  canvasObstacles,
  connectorLabel,
  parseBox,
  undoApplied,
  version,
  type AiContext,
} from "./ai";
import { sceneCardBlock, type Scene, type SceneObject } from "./scene";
import { solveScene, type Box, type Size } from "./scene-solver";

type SceneUndo = (() => void) & {
  noteId?: string;
  created: string[];
  /** Resolves once objects are in their final, measured places. */
  settled: Promise<void>;
  /** What Knot adjusted while placing the scene. */
  report: string[];
};

const LAYOUT = { right: 0, left: 1, balance: 2 } as const;
/** Arrows without a chosen colour: readable on light and dark canvases. */
const NEUTRAL_ARROW = { light: "#7a7a76", dark: "#9b9b97" };
/** Frames the editor gets to measure new cards before final placement. */
const MEASURE_FRAMES = 40;
/** Frames to wait before trusting that sizes have stopped changing. */
const MIN_MEASURE_FRAMES = 8;

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
    if (c.type === "table") height += 48 + ((c.rows?.length ?? 0) + 1) * 38;
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

export function applyScene(
  doc: Doc,
  context: AiContext,
  scene: Scene,
  options: {
    view?: Box;
    /** Brings objects into view, so the editor renders and measures them. */
    reveal?: (ids: string[]) => void;
  } = {},
): SceneUndo {
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
    ...scene.objects.map((o) => o.place.of),
    ...scene.arrangements.map((a) => a.place.of),
    ...scene.connectors.flatMap((c) => [c.from, c.to]),
    scene.anchor.near,
  ]);
  for (const [handle, target] of targets) {
    if (!used.has(handle)) continue;
    if (!target.box || !(doc.getBlock(target.id) || surface.getElementById(target.id)))
      throw new Error("This refers to something that isn't on the canvas any more. Try again.");
    handles.set(handle, target.box as Box);
    handleIds.set(handle, target.id);
  }
  const anchor =
    scene.anchor.near === "selection"
      ? selectionBox(context)
      : handles.get(scene.anchor.near);
  const obstacles = canvasObstacles(doc);
  const origin: [number, number] =
    scene.anchor.near === "view" && options.view
      ? [options.view[0] + 60, options.view[1] + 60]
      : [Math.max(0, ...obstacles.map((b) => b[0] + b[2] + 80)), 0];
  const sizes = new Map(scene.objects.map((o) => [o.id, estimate(o)]));
  const solve = () =>
    solveScene(scene, { sizes, handles, obstacles, anchor, origin });
  let { boxes, report } = solve();
  report = [...scene.notes, ...report];

  const ids = new Map<string, string>();
  const mindmapNodes = new Map<string, string[]>();
  const connectorMode = {
    curve: ConnectorMode.Curve,
    elbowed: ConnectorMode.Orthogonal,
    straight: ConnectorMode.Straight,
  }[getAiConnectorShape()];
  const xywh = (b: Box) => `[${b.map((n) => Math.round(n)).join(",")}]`;

  const history = doc.history as unknown as { captureTimeout: number };
  const timeout = history.captureTimeout;
  doc.captureSync();
  // Creation, arrows and final placement are one undo step.
  history.captureTimeout = 60_000;
  doc.transact(() => {
    for (const o of scene.objects) {
      const box = boxes.get(o.id)!;
      if (o.kind === "card") {
        const id = doc.addBlock(
          "affine:note",
          {
            xywh: xywh(box),
            ...(o.color && { background: `--affine-note-background-${o.color}` }),
          } as never,
          doc.root!,
        );
        appendAiBlock(doc, id, sceneCardBlock(o));
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
            color: ARROW_LABEL_COLOR,
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
      }
    }
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
      surface.addElement({
        type: "connector",
        mode: connectorMode,
        // One quiet colour unless the scene gives arrows meaning by colour.
        stroke: c.color ? `--affine-palette-line-${c.color}` : NEUTRAL_ARROW,
        strokeStyle: c.style === "dashed" ? "dash" : "solid",
        source: { id: from },
        target: { id: to },
        frontEndpointStyle: c.heads === "from" || c.heads === "both" ? "Arrow" : "None",
        rearEndpointStyle: c.heads === "to" || c.heads === "both" ? "Arrow" : "None",
        ...(c.label && { text: new Y.Text(c.label), ...connectorLabel(c.label) }),
      } as never);
    }
  });

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
  const undo = () => undoApplied(doc, item, appliedVersion);
  const result: SceneUndo = Object.assign(undo, {
    noteId: cards.length ? ids.get(cards[0].id) : undefined,
    created,
    settled: Promise.resolve(),
    report,
  });
  options.reveal?.(created);
  result.settled = (async () => {
    try {
      let last = "";
      let still = 0;
      for (let frame = 0; frame < MEASURE_FRAMES; frame++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const key = JSON.stringify([...measured()].map(([, s]) => [Math.round(s.width), Math.round(s.height)]));
        still = key === last ? still + 1 : 0;
        last = key;
        if (frame >= MIN_MEASURE_FRAMES && still >= 3) break;
      }
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
            if (o.kind === "card" || o.kind === "frame") {
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
