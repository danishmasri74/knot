import type { Doc, BlockModel } from "@blocksuite/store";
import type {
  FrameBlockModel,
  NoteBlockModel,
  SurfaceBlockModel,
} from "@blocksuite/blocks";
import type { CanvasMapData, MapBox } from "../../../services/canvas-map-format";
import { structuredAiBlocks } from "./ai";

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
    if (element.type === "connector") {
      const end = (value: unknown) => {
        const id = (value as { id?: unknown } | undefined)?.id;
        return typeof id === "string" && id ? id : undefined;
      };
      const head = (style: unknown) => !!style && style !== "None";
      const atTo = head(raw.rearEndpointStyle);
      const atFrom = head(raw.frontEndpointStyle);
      map.arrows.push({
        from: end(raw.source),
        to: end(raw.target),
        label: text(raw.text),
        heads: atTo && atFrom ? "both" : atTo ? "to" : atFrom ? "from" : "none",
      });
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
  return map;
}

type MindNode = {
  element?: { id: string; text?: unknown };
  children?: MindNode[];
};
