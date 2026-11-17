/**
 * A canvas scene: what Ask Knot's create_on_canvas tool returns. The model
 * composes it (objects, where each goes, how they connect) and Knot only
 * measures, places and draws it. See docs/AI-CANVAS-ORCHESTRATION-PLAN.md.
 *
 * This module validates and normalizes a scene without the editor, so it can
 * be unit tested. Mistakes that can be repaired (an unknown reference, a
 * frame loop) are repaired and recorded as notes for the report; only a
 * response that isn't a scene at all is rejected.
 */
import type { AiBlock, AiContent } from "./ai-content";

export const SCENE_KINDS = ["card", "text", "shape", "frame", "mindmap"] as const;
export const SCENE_SHAPES = [
  "rect",
  "roundedRect",
  "ellipse",
  "diamond",
  "triangle",
] as const;
export const SCENE_RELATIONS = [
  "rightOf",
  "leftOf",
  "above",
  "below",
  "near",
] as const;
export const SCENE_ARRANGEMENTS = ["row", "column", "ring", "grid", "stack"] as const;
/** Theme-aware paints the canvas already has (affine palette tokens). */
export const SCENE_COLORS = [
  "yellow",
  "orange",
  "red",
  "magenta",
  "purple",
  "blue",
  "teal",
  "green",
  "grey",
] as const;

export type SceneColor = (typeof SCENE_COLORS)[number];
export type SceneAlign = "start" | "center" | "end";
export type ScenePlace = {
  rel: (typeof SCENE_RELATIONS)[number] | "";
  /** An object or arrangement id in this scene, or a canvas map handle. */
  of: string;
  align: SceneAlign | "";
  /** Space in px; 0 means a normal gap. */
  gap: number;
};
export type SceneObject = {
  id: string;
  kind: (typeof SCENE_KINDS)[number];
  /** Card title, frame title, text, shape label or mind map title. */
  text: string;
  /** A card's formatted body. */
  content: AiContent[];
  /** A mind map's nodes; the first is the root (parent -1). */
  nodes: { text: string; parent: number; sourceRefs?: string[] }[];
  shape: (typeof SCENE_SHAPES)[number] | "";
  /** The frame this object sits in, or "". */
  in: string;
  place: ScenePlace;
  /** [column, row] in the container's grid, or []. */
  cell: number[];
  /** Width in px; 0 lets Knot choose from the content. */
  width: number;
  color: SceneColor | "";
  /** Mind map direction. */
  direction: "right" | "left" | "balance" | "";
  /** Place in the reading sequence; 0 when unspecified. */
  order: number;
  role: string;
  sourceRefs?: string[];
};
export type SceneArrangement = {
  id: string;
  kind: (typeof SCENE_ARRANGEMENTS)[number];
  members: string[];
  /** ring: the object in the middle, or "". */
  center: string;
  /** grid: columns; 0 lets Knot choose. */
  columns: number;
  in: string;
  place: ScenePlace;
  gap: number;
  align: SceneAlign | "";
};
export type SceneConnector = {
  /** An object id, "mapId#n" for mind map node n, or a canvas map handle. */
  from: string;
  to: string;
  label: string;
  heads: "to" | "from" | "both" | "none";
  style: "solid" | "dashed" | "";
  color: SceneColor | "";
  sourceRefs?: string[];
};
export type Scene = {
  /** One sentence on the structure chosen, shown to the user. */
  plan: string;
  anchor: { near: string; side: "right" | "left" | "below" | "above" | "" };
  objects: SceneObject[];
  arrangements: SceneArrangement[];
  connectors: SceneConnector[];
  /** Repairs made while validating; part of the layout report. */
  notes: string[];
};

/** Handles the canvas map gives existing objects (K cards, F frames, T text, M mind maps). */
export const MAP_HANDLE = /^[KFTMG]\d{1,4}$/;
const ID = /^[\p{L}\p{N}_.:-]{1,60}$/u;
/** Payload safety, not a design limit. */
export const MAX_SCENE_OBJECTS = 400;
const CONTENT_TYPES = new Set([
  "paragraph",
  "h1",
  "h2",
  "h3",
  "bulleted",
  "numbered",
  "todo",
  "table",
  "kanban",
]);

const isString = (v: unknown): v is string => typeof v === "string";
const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T | "" = "") =>
  (list as readonly unknown[]).includes(v) ? (v as T) : fallback;

function content(value: unknown): AiContent | null {
  const c = value as AiContent;
  if (!c || !CONTENT_TYPES.has(c.type) || !isString(c.text)) return null;
  const strings = (a: unknown) => Array.isArray(a) && a.every(isString);
  if (c.columns !== undefined && !strings(c.columns)) return null;
  if (
    c.rows !== undefined &&
    !(Array.isArray(c.rows) && c.rows.every((r) => strings(r)))
  )
    return null;
  return {
    type: c.type,
    text: c.text,
    ...(c.columns?.length && { columns: c.columns }),
    ...(c.rows?.length && { rows: c.rows }),
    ...(Array.isArray(c.sourceRefs) && { sourceRefs: c.sourceRefs.filter(isString) }),
  };
}

function place(value: unknown): ScenePlace {
  const p = (value ?? {}) as Partial<ScenePlace>;
  return {
    rel: oneOf(SCENE_RELATIONS, p.rel),
    of: isString(p.of) ? p.of.trim() : "",
    align: oneOf(["start", "center", "end"] as const, p.align),
    gap: Number.isFinite(p.gap) ? Math.max(0, Math.min(2000, Number(p.gap))) : 0,
  };
}

/**
 * Checks and normalizes a scene from the model. Throws only when the value
 * isn't a usable scene; everything repairable is repaired and noted.
 */
export function validateScene(value: unknown, handles: Set<string> = new Set()): Scene {
  const raw = value as Partial<Scene> & Record<string, unknown>;
  if (!raw || !Array.isArray(raw.objects) || !raw.objects.length)
    throw new Error("The canvas response has nothing to create. Please try again.");
  if (raw.objects.length > MAX_SCENE_OBJECTS)
    throw new Error("The canvas response is too large. Ask for it in parts.");
  const notes: string[] = [];
  const objects: SceneObject[] = [];
  const ids = new Set<string>();
  for (const [i, value] of raw.objects.entries()) {
    const o = value as Partial<SceneObject>;
    const kind = oneOf(SCENE_KINDS, o?.kind);
    if (!o || !kind) {
      notes.push(`Skipped object ${i + 1}: unknown kind.`);
      continue;
    }
    let id = isString(o.id) && ID.test(o.id.trim()) ? o.id.trim() : `obj${i + 1}`;
    // A handle-shaped id would be read as an existing object.
    if (MAP_HANDLE.test(id) || ids.has(id)) {
      const fresh = `${id}_${i + 1}`;
      notes.push(`Renamed duplicate or reserved id "${id}" to "${fresh}".`);
      id = fresh;
    }
    ids.add(id);
    const body = Array.isArray(o.content)
      ? o.content.map(content).filter((c): c is AiContent => !!c)
      : [];
    const nodes = Array.isArray(o.nodes)
      ? o.nodes
          .filter((n) => n && isString(n.text) && n.text.trim())
          .map((n, k) => ({
            text: n.text.trim(),
            parent:
              k === 0
                ? -1
                : Number.isInteger(n.parent) && n.parent >= 0 && n.parent < k
                  ? n.parent
                  : 0,
            ...(Array.isArray(n.sourceRefs) && { sourceRefs: n.sourceRefs.filter(isString) }),
          }))
      : [];
    const text = isString(o.text) ? o.text.trim() : "";
    if (kind === "mindmap" && !nodes.length) {
      if (!text) {
        notes.push(`Skipped mind map "${id}": it has no nodes.`);
        continue;
      }
      nodes.push({ text, parent: -1 });
    }
    if (kind === "card" && !text && !body.length) {
      notes.push(`Skipped empty card "${id}".`);
      continue;
    }
    if (kind === "text" && !text) {
      notes.push(`Skipped empty text "${id}".`);
      continue;
    }
    const cell =
      Array.isArray(o.cell) &&
      o.cell.length === 2 &&
      o.cell.every((n) => Number.isInteger(n) && n >= 0 && n < 200)
        ? o.cell
        : [];
    objects.push({
      id,
      kind,
      text,
      content: kind === "card" ? body : [],
      nodes: kind === "mindmap" ? nodes : [],
      shape: kind === "shape" ? oneOf(SCENE_SHAPES, o.shape, "rect") : "",
      in: isString(o.in) ? o.in.trim() : "",
      place: place(o.place),
      cell,
      width:
        Number.isFinite(o.width) && Number(o.width) > 0
          ? Math.max(120, Math.min(1600, Number(o.width)))
          : 0,
      color: oneOf(SCENE_COLORS, o.color),
      direction: oneOf(["right", "left", "balance"] as const, o.direction),
      order: Number.isInteger(o.order) && Number(o.order) > 0 ? Number(o.order) : 0,
      role: isString(o.role) ? o.role.trim().slice(0, 60) : "",
      ...(Array.isArray(o.sourceRefs) && { sourceRefs: o.sourceRefs.filter(isString) }),
    });
  }
  if (!objects.length)
    throw new Error("The canvas response has nothing to create. Please try again.");
  const byId = new Map(objects.map((o) => [o.id, o]));
  const frames = new Set(objects.filter((o) => o.kind === "frame").map((o) => o.id));

  // Containers: only frames, and never a loop.
  for (const o of objects) {
    if (o.in && (!frames.has(o.in) || o.in === o.id)) {
      notes.push(`"${o.id}" was in "${o.in}", which isn't a frame here; it was placed outside.`);
      o.in = "";
    }
  }
  for (const o of objects) {
    const seen = new Set([o.id]);
    let at = o.in;
    while (at) {
      if (seen.has(at)) {
        notes.push(`Frames "${o.id}" and "${at}" contained each other; "${o.id}" was taken out.`);
        o.in = "";
        break;
      }
      seen.add(at);
      at = byId.get(at)?.in ?? "";
    }
  }

  // Arrangements: members are objects, each in at most one arrangement.
  const arranged = new Set<string>();
  const arrangements: SceneArrangement[] = [];
  for (const [i, value] of (Array.isArray(raw.arrangements) ? raw.arrangements : []).entries()) {
    const a = value as Partial<SceneArrangement>;
    const kind = oneOf(SCENE_ARRANGEMENTS, a?.kind);
    if (!a || !kind) continue;
    let id = isString(a.id) && ID.test(a.id.trim()) ? a.id.trim() : `arr${i + 1}`;
    if (ids.has(id) || MAP_HANDLE.test(id)) id = `${id}_arr${i + 1}`;
    ids.add(id);
    const members = (Array.isArray(a.members) ? a.members : [])
      .filter(isString)
      .map((m) => m.trim())
      .filter((m, k, list) => byId.has(m) && list.indexOf(m) === k);
    const taken = members.filter((m) => arranged.has(m));
    if (taken.length)
      notes.push(`${taken.map((m) => `"${m}"`).join(", ")} already belonged to another arrangement and stayed there.`);
    const free = members.filter((m) => !arranged.has(m));
    if (!free.length) continue;
    const container = isString(a.in) && frames.has(a.in.trim()) ? a.in.trim() : byId.get(free[0])!.in;
    for (const m of free) {
      arranged.add(m);
      const member = byId.get(m)!;
      if (member.in !== container && member.id !== container) {
        notes.push(`"${m}" moved into the same container as its arrangement "${id}".`);
        member.in = container;
      }
    }
    const center = isString(a.center) && free.includes(a.center.trim()) ? a.center.trim() : "";
    arrangements.push({
      id,
      kind,
      members: free,
      center: kind === "ring" ? center : "",
      columns: Number.isInteger(a.columns) && Number(a.columns) > 0 ? Math.min(50, Number(a.columns)) : 0,
      in: container,
      place: place(a.place),
      gap: Number.isFinite(a.gap) ? Math.max(0, Math.min(2000, Number(a.gap))) : 0,
      align: oneOf(["start", "center", "end"] as const, a.align),
    });
  }
  const known = (ref: string) => byId.has(ref) || arrangements.some((a) => a.id === ref);
  const reference = (owner: string, p: ScenePlace) => {
    if (!p.of) return;
    if (p.of === owner || !(known(p.of) || handles.has(p.of))) {
      notes.push(`"${owner}" was placed relative to "${p.of}", which doesn't exist; Knot placed it instead.`);
      p.of = "";
      p.rel = "";
    } else if (!p.rel) p.rel = "near";
  };
  for (const o of objects) reference(o.id, o.place);
  for (const a of arrangements) reference(a.id, a.place);

  // Connectors: both ends must exist; a mind map node is "map#n".
  const endpoint = (ref: unknown): string => {
    if (!isString(ref)) return "";
    const r = ref.trim();
    if (byId.has(r) || handles.has(r)) return r;
    const node = /^(.+)#(\d+)$/.exec(r);
    if (node && byId.get(node[1])?.kind === "mindmap") {
      const map = byId.get(node[1])!;
      return Number(node[2]) < map.nodes.length ? r : node[1];
    }
    return "";
  };
  const connectors: SceneConnector[] = [];
  for (const value of Array.isArray(raw.connectors) ? raw.connectors : []) {
    const c = value as Partial<SceneConnector>;
    const from = endpoint(c?.from);
    const to = endpoint(c?.to);
    if (!from || !to || from === to) {
      notes.push(`Left out an arrow from "${c?.from}" to "${c?.to}": an end doesn't exist.`);
      continue;
    }
    connectors.push({
      from,
      to,
      label: isString(c.label) ? c.label.trim().slice(0, 200) : "",
      heads: oneOf(["to", "from", "both", "none"] as const, c.heads, "to") as SceneConnector["heads"],
      style: oneOf(["solid", "dashed"] as const, c.style),
      color: oneOf(SCENE_COLORS, c.color),
      ...(Array.isArray(c.sourceRefs) && { sourceRefs: c.sourceRefs.filter(isString) }),
    });
  }
  const anchorRaw = (raw.anchor ?? {}) as Partial<Scene["anchor"]>;
  const near = isString(anchorRaw.near) ? anchorRaw.near.trim() : "";
  return {
    plan: isString(raw.plan) ? raw.plan.trim().slice(0, 400) : "",
    anchor: {
      near:
        near === "selection" || near === "view" || handles.has(near) ? near : "",
      side: oneOf(["right", "left", "below", "above"] as const, anchorRaw.side),
    },
    objects,
    arrangements,
    connectors,
    notes,
  };
}

/** A scene card as the block appendAiBlock writes: its title, then its body. */
export function sceneCardBlock(o: SceneObject): AiBlock {
  return o.content.length
    ? {
        type: "paragraph",
        text: o.text,
        children: o.content,
        ...(o.sourceRefs && { sourceRefs: o.sourceRefs }),
      }
    : { type: "paragraph", text: o.text, ...(o.sourceRefs && { sourceRefs: o.sourceRefs }) };
}

/** The scene's readable content, in reading order, as blocks (copy, add as card). */
export function sceneBlocks(scene: Scene | undefined): AiBlock[] {
  if (!scene) return [];
  return readingOrder(scene.objects).flatMap((o): AiBlock[] => {
    if (o.kind === "card") return [sceneCardBlock(o)];
    if (o.kind === "mindmap")
      return o.nodes.map((n) => ({
        type: "paragraph",
        text: n.parent < 0 ? n.text : `${o.nodes[n.parent].text} → ${n.text}`,
      }));
    return o.text ? [{ type: o.kind === "frame" ? "h2" : "paragraph", text: o.text }] : [];
  });
}

/** Objects by their order, unordered ones after, otherwise as written. */
export function readingOrder<T extends { order: number }>(objects: T[]): T[] {
  return objects
    .map((o, i) => ({ o, i }))
    .sort(
      (a, b) =>
        (a.o.order || Number.MAX_SAFE_INTEGER) - (b.o.order || Number.MAX_SAFE_INTEGER) ||
        a.i - b.i,
    )
    .map(({ o }) => o);
}

/** Every string a reviewer might check for coverage or markers. */
export function sceneTexts(scene: Scene): string[] {
  const block = (c: AiContent) => [c.text, ...(c.columns ?? []), ...(c.rows ?? []).flat()];
  return [
    ...scene.objects.flatMap((o) => [
      o.text,
      ...o.content.flatMap(block),
      ...o.nodes.map((n) => n.text),
    ]),
    ...scene.connectors.map((c) => c.label),
  ].filter(Boolean);
}

/** A short count for the preview, e.g. "12 cards, 3 frames and 14 arrows". */
export function sceneSummary(scene: Scene): string {
  const count = (n: number, one: string, many = `${one}s`) =>
    n ? `${n} ${n === 1 ? one : many}` : "";
  const kinds = (k: SceneObject["kind"]) => scene.objects.filter((o) => o.kind === k).length;
  const parts = [
    count(kinds("card"), "card"),
    count(kinds("frame"), "frame"),
    count(kinds("mindmap"), "mind map"),
    count(kinds("shape"), "shape"),
    count(kinds("text"), "text label"),
    count(scene.connectors.length, "arrow"),
  ].filter(Boolean);
  return parts.length > 1
    ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`
    : (parts[0] ?? "nothing");
}
