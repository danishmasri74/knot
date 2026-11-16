import type { Doc, BlockModel } from "@blocksuite/store";
import type {
  FrameBlockModel,
  NoteBlockModel,
  SurfaceBlockModel,
} from "@blocksuite/blocks";
import type { CanvasMapData, MapBox } from "../../../services/canvas-map-format";
import { structuredAiBlocks } from "./ai";
import { canvasRoutes, isRerouteDot } from "./reroute";

function box(xywh: unknown): MapBox | undefined {
  try {
    const b: unknown = JSON.parse(String(xywh));
    return Array.isArray(b) && b.length === 4 && b.every(Number.isFinite)
      ? (b as MapBox)
      : undefined;
  } catch {
    return undefined;
  }
}

const text = (value: unknown) =>
  value == null ? "" : String(value).replace(/\s+/g, " ").trim();

/** What a media block on the canvas is, for the map. */
function media(block: BlockModel): { kind: string; title: string } | undefined {
  const props = block as unknown as Record<string, unknown>;
  const title = text(props.title) || text(props.name) || text(props.caption);
  const url = text(props.url);
  switch (block.flavour) {
    case "affine:image":
      return { kind: "image", title: title || "Image" };
    case "affine:attachment":
      return {
        kind: props.type === "application/pdf" ? "PDF" : "file",
        title: title || "File",
      };
    case "affine:embed-youtube":
      return { kind: "YouTube", title: title || url || "Video" };
    case "affine:bookmark":
    case "affine:embed-github":
    case "affine:embed-figma":
    case "affine:embed-loom":
      return { kind: "link", title: title || url || "Link" };
    default:
      return undefined;
  }
}

/**
 * Reads how the canvas is arranged: notes shown on it, media cards, frames,
 * groups, arrows, mind maps, and shapes or text boxes with text. Geometry
 * stays raw here; canvas-map-format.ts turns it into the description.
 */
export function captureCanvasMap(
  doc: Doc,
  selected: string[] = [],
  focus?: string | null,
): CanvasMapData | undefined {
  const surface = doc.getBlocksByFlavour("affine:surface")[0]?.model as
    | SurfaceBlockModel
    | undefined;
  if (!surface) return;
  const map: CanvasMapData = {
    cards: [],
    frames: [],
    groups: [],
    arrows: [],
    mindmaps: [],
    texts: [],
    selected,
    ...(focus ? { focus } : {}),
  };
  for (const { model } of doc.getBlocksByFlavour("affine:note")) {
    const note = model as NoteBlockModel;
    const b = box(note.xywh);
    // Page-only notes aren't on the canvas.
    if (!b || note.displayMode === "doc") continue;
    const blocks = structuredAiBlocks(note);
    map.cards.push({
      id: note.id,
      title: blocks.find((block) => block.text.trim())?.text.split("\n")[0] ?? "",
      length: blocks.reduce((n, block) => n + block.text.length, 0),
      box: b,
    });
  }
  for (const child of surface.children) {
    const b = box((child as unknown as { xywh?: unknown }).xywh);
    if (!b) continue;
    if (child.flavour === "affine:frame") {
      const frame = child as FrameBlockModel;
      map.frames.push({
        id: frame.id,
        title: text(frame.title),
        box: b,
        members: Object.keys(frame.childElementIds ?? {}),
      });
      continue;
    }
    const item = media(child);
    if (item) map.cards.push({ id: child.id, ...item, length: 0, box: b });
  }
  const inMindmap = new Set<string>();
  for (const element of surface.elementModels) {
    if (element.type !== "mindmap") continue;
    const tree = (element as unknown as { tree?: MindNode }).tree;
    const nodes: { text: string; depth: number }[] = [];
    const walk = (node: MindNode | undefined, depth: number) => {
      if (!node?.element) return;
      inMindmap.add(node.element.id);
      nodes.push({ text: text(node.element.text), depth });
      node.children?.forEach((c) => walk(c, depth + 1));
    };
    walk(tree, 0);
    const b = box(element.xywh);
    if (b && nodes.length) map.mindmaps.push({ id: element.id, box: b, nodes });
  }
  for (const element of surface.elementModels) {
    const raw = element as unknown as Record<string, unknown>;
    // Arrows are read from the routes below, through reroute points.
    if (element.type === "connector" || isRerouteDot(element)) {
      continue;
    } else if (element.type === "group") {
      map.groups.push({
        id: element.id,
        title: text(raw.title),
        members: (raw.childIds as string[] | undefined) ?? [],
      });
    } else if (
      (element.type === "shape" || element.type === "text") &&
      !inMindmap.has(element.id)
    ) {
      const label = text(raw.text);
      const b = box(element.xywh);
      if (label && b) map.texts.push({ id: element.id, text: label, box: b });
    }
  }
  // An arrow through reroute points (A → • → B) is the link A → B; the
  // dots it shares with other arrows show they are bundled.
  const head = (style: string) => !!style && style !== "None";
  for (const route of canvasRoutes(surface)) {
    const atTo = head(route.rear);
    const atFrom = head(route.front);
    map.arrows.push({
      from: route.from,
      to: route.to,
      label: text(route.label),
      heads: atTo && atFrom ? "both" : atTo ? "to" : atFrom ? "from" : "none",
      ...(route.via.length ? { via: route.via } : {}),
    });
  }
  return map;
}

type MindNode = {
  element?: { id: string; text?: unknown };
  children?: MindNode[];
};
