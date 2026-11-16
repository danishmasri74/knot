import type { Doc } from "@blocksuite/store";
import type { SurfaceBlockModel } from "@blocksuite/blocks";
import {
  orphanDots,
  rejoinPlan,
  resolveRoutes,
  routeEnds,
  dotsAmong,
  type Route,
  type Segment,
} from "../../../services/reroute-routes";
import { openCardMenu } from "./card-menu";

/**
 * Reroute points (see reroute-routes.ts): small round shapes marked with
 * REROUTE_KEY on their element map, so the mark is saved, undone and
 * redone with the shape. Older Knot shows them as small circles.
 */
export const REROUTE_KEY = "knot:reroute";
export const REROUTE_SIZE = 14;

type End = { id?: string; position?: [number, number] };
type Element = {
  id: string;
  type: string;
  xywh: string;
  yMap?: { get(key: string): unknown; set(key: string, value: unknown): void };
};
type Connector = Element & {
  source: End;
  target: End;
  text?: { toString(): string };
  frontEndpointStyle?: string;
  rearEndpointStyle?: string;
  getNearestPoint?(point: [number, number]): number[];
};
type Canvas = HTMLElement & {
  gfx: {
    viewport: {
      zoom: number;
      toModelCoordFromClientCoord(point: [number, number]): [number, number];
      setCenter(x: number, y: number): void;
    };
    selection: {
      editing: boolean;
      selectedElements: { id: string }[];
      set(selection: { elements: string[]; editing: boolean }): void;
    };
    getElementByPoint(
      x: number,
      y: number,
      options: { all: true; hitThreshold: number },
    ): Element[];
  };
};

export function surfaceOf(doc: Doc) {
  return doc.getBlocksByFlavour("affine:surface")[0]?.model as SurfaceBlockModel | undefined;
}

export function isRerouteDot(element: unknown): boolean {
  const e = element as Element | null | undefined;
  return e?.type === "shape" && e.yMap?.get(REROUTE_KEY) === true;
}

const elements = (surface: SurfaceBlockModel) =>
  surface.elementModels as unknown as Element[];

const connectors = (surface: SurfaceBlockModel) =>
  elements(surface).filter((e): e is Connector => e.type === "connector");

export function rerouteDots(surface: SurfaceBlockModel) {
  return new Set(elements(surface).filter(isRerouteDot).map((e) => e.id));
}

function segment(c: Connector): Segment {
  return {
    id: c.id,
    from: c.source?.id || undefined,
    to: c.target?.id || undefined,
    label: String(c.text ?? "").replace(/\s+/g, " ").trim(),
    front: c.frontEndpointStyle ?? "None",
    rear: c.rearEndpointStyle ?? "Arrow",
  };
}

export function segments(surface: SurfaceBlockModel) {
  return connectors(surface).map(segment);
}

/** Links between real objects, looking through reroute points. */
export function canvasRoutes(surface: SurfaceBlockModel): Route[] {
  return resolveRoutes(segments(surface), rerouteDots(surface));
}

// Connector fields copied when an arrow is split or rejoined.
const STYLE = ["mode", "stroke", "strokeWidth", "strokeStyle", "rough", "roughness"];
const LABEL = ["labelXYWH", "labelDisplay", "labelStyle", "labelOffset", "labelConstraints"];

function pick(source: Connector, keys: string[]) {
  const raw = source as unknown as Record<string, unknown>;
  const props: Record<string, unknown> = {};
  for (const key of keys) {
    const value = raw[key];
    if (value !== undefined)
      props[key] = typeof value === "object" && value ? structuredClone(value) : value;
  }
  return props;
}

function labelProps(c: Connector): Record<string, unknown> {
  const text = String(c.text ?? "");
  return text.trim() ? { text, ...pick(c, LABEL) } : {};
}

const center = (xywh: string) => {
  const [x, y, w, h] = JSON.parse(xywh) as number[];
  return [x + w / 2, y + h / 2] as [number, number];
};

/**
 * Splits an arrow at `point` with a reroute point: A → B becomes A → • → B.
 * The label, colour and arrowhead move to the segment leaving the dot.
 * One undo step; returns the dot's ID.
 */
export function addReroutePoint(
  doc: Doc,
  surface: SurfaceBlockModel,
  connectorId: string,
  point: [number, number],
) {
  const c = surface.getElementById(connectorId) as unknown as Connector | null;
  if (!c || c.type !== "connector") return;
  const [x, y] = c.getNearestPoint?.(point) ?? point;
  const stroke = (c as unknown as { stroke?: unknown }).stroke;
  doc.captureSync();
  let dot = "";
  doc.transact(() => {
    dot = surface.addElement({
      type: "shape",
      shapeType: "ellipse",
      xywh: JSON.stringify([x - REROUTE_SIZE / 2, y - REROUTE_SIZE / 2, REROUTE_SIZE, REROUTE_SIZE]),
      filled: true,
      ...(stroke !== undefined && { fillColor: stroke, strokeColor: stroke }),
      strokeWidth: 2,
      shapeStyle: "General",
    } as never);
    markDot(surface, dot);
    surface.addElement({
      type: "connector",
      ...pick(c, STYLE),
      source: { id: dot },
      target: structuredClone(c.target),
      frontEndpointStyle: "None",
      rearEndpointStyle: c.rearEndpointStyle ?? "Arrow",
      ...labelProps(c),
    } as never);
    surface.updateElement(c.id, {
      target: { id: dot },
      rearEndpointStyle: "None",
      ...(String(c.text ?? "").trim() && { text: "", labelXYWH: undefined }),
    } as never);
  });
  return dot;
}

function markDot(surface: SurfaceBlockModel, id: string) {
  (surface.getElementById(id) as unknown as Element | null)?.yMap?.set(REROUTE_KEY, true);
}

/**
 * Removes reroute points and joins their arrows back (see rejoinPlan).
 * Call inside a transaction. Returns how many dots dropped their arrows
 * because rejoining would have made too many.
 */
function dissolve(surface: SurfaceBlockModel, dots: string[]) {
  let dropped = 0;
  for (const dot of dots) {
    if (!surface.getElementById(dot)) continue;
    const byId = new Map(connectors(surface).map((c) => [c.id, c]));
    const plan = rejoinPlan([...byId.values()].map(segment), dot);
    if (plan.dropped) dropped++;
    for (const { incoming, outgoing } of plan.joins) {
      const a = byId.get(incoming.id)!;
      const b = byId.get(outgoing.id)!;
      const label = labelProps(b);
      surface.addElement({
        type: "connector",
        ...pick(b, STYLE),
        source: structuredClone(a.source),
        target: structuredClone(b.target),
        frontEndpointStyle: a.frontEndpointStyle ?? "None",
        rearEndpointStyle: b.rearEndpointStyle ?? "Arrow",
        ...(Object.keys(label).length ? label : labelProps(a)),
      } as never);
    }
    for (const id of plan.remove) surface.deleteElement(id);
    surface.deleteElement(dot);
  }
  return dropped;
}

export function removeReroutePoints(doc: Doc, surface: SurfaceBlockModel, dots: string[]) {
  doc.captureSync();
  let dropped = 0;
  doc.transact(() => {
    dropped = dissolve(surface, dots);
  });
  return dropped;
}

/**
 * Before cards are rearranged: removes the dots that only route between
 * them (rejoining their arrows), since they would stay in the old layout.
 * Call inside the rearranging transaction.
 */
export function dissolveDotsAmong(surface: SurfaceBlockModel, ids: Set<string>) {
  const dots = rerouteDots(surface);
  if (dots.size) dissolve(surface, dotsAmong(segments(surface), dots, ids));
}

/** Removes dots left with arrows on one side or none, and those arrows. */
function cleanUp(doc: Doc, surface: SurfaceBlockModel) {
  if (doc.readonly) return;
  for (let pass = 0; pass < 20; pass++) {
    const orphans = orphanDots(segments(surface), rerouteDots(surface));
    if (!orphans.length) return;
    doc.transact(() => {
      for (const { dot, remove } of orphans) {
        for (const id of remove) surface.deleteElement(id);
        surface.deleteElement(dot);
      }
    });
  }
}

/** Arrowheads never point into a dot or out of one; dots keep their size. */
function normalize(surface: SurfaceBlockModel, id: string) {
  const element = surface.getElementById(id) as unknown as Element | null;
  if (!element) return;
  if (element.type === "connector") {
    const c = element as Connector;
    const dots = rerouteDots(surface);
    const props: Record<string, unknown> = {};
    if (c.target?.id && dots.has(c.target.id) && c.rearEndpointStyle !== "None")
      props.rearEndpointStyle = "None";
    if (c.source?.id && dots.has(c.source.id) && c.frontEndpointStyle !== "None")
      props.frontEndpointStyle = "None";
    if (Object.keys(props).length) surface.updateElement(id, props as never);
  } else if (isRerouteDot(element)) {
    const [, , w, h] = JSON.parse(element.xywh) as number[];
    if (w !== REROUTE_SIZE || h !== REROUTE_SIZE) {
      const [cx, cy] = center(element.xywh);
      surface.updateElement(id, {
        xywh: JSON.stringify([cx - REROUTE_SIZE / 2, cy - REROUTE_SIZE / 2, REROUTE_SIZE, REROUTE_SIZE]),
      } as never);
    }
  }
}

/** A short name for an object, for the "Go to" choice list. */
function objectTitle(doc: Doc, surface: SurfaceBlockModel, id: string) {
  const block = doc.getBlock(id)?.model as
    | (Record<string, unknown> & { flavour: string; children: unknown[] })
    | undefined;
  const line = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
  if (block) {
    if (block.flavour === "affine:frame") return line(block.title) || "Frame";
    const first = (model: Record<string, unknown> & { children?: unknown[] }): string => {
      const own = line(model.text);
      if (own) return own;
      for (const child of model.children ?? []) {
        const found = first(child as Record<string, unknown>);
        if (found) return found;
      }
      return "";
    };
    return (
      first(block).slice(0, 80) ||
      line(block.title) ||
      line(block.name) ||
      (block.flavour === "affine:note" ? "Untitled note" : "Card")
    );
  }
  const element = surface.getElementById(id) as unknown as Record<string, unknown> | null;
  return line(element?.text).slice(0, 80) || line(element?.title) || "Object";
}

/**
 * Wires reroute points into an editor: Alt+click an arrow (or right-click →
 * Add reroute point) to add one, Delete removes it and rejoins its arrows,
 * double-click (or Enter) goes to what its route points at, and right-click
 * goes to either end. Dots with nothing left on one side are removed.
 */
export function observeReroutes(
  editor: HTMLElement & { mode?: string },
  doc: Doc,
) {
  const canvas = () =>
    editor.mode === "edgeless"
      ? (editor.querySelector("affine-edgeless-root") as Canvas | null)
      : null;
  const swallow = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  /** The topmost dot or arrow under a client point, unless something covers it. */
  const hit = (root: Canvas, clientX: number, clientY: number) => {
    const [x, y] = root.gfx.viewport.toModelCoordFromClientCoord([clientX, clientY]);
    const picked = root.gfx.getElementByPoint(x, y, { all: true, hitThreshold: 10 });
    for (let i = picked.length - 1; i >= 0; i--) {
      const element = picked[i];
      const kind = (element as unknown as { flavour?: string }).flavour ?? element.type;
      if (kind === "affine:frame" || kind === "group") continue;
      if (isRerouteDot(element)) return { kind: "dot" as const, id: element.id, point: [x, y] as [number, number] };
      if (element.type === "connector")
        return { kind: "arrow" as const, id: element.id, point: [x, y] as [number, number] };
      return;
    }
  };

  const goTo = (root: Canvas, id: string) => {
    const surface = surfaceOf(doc);
    const element =
      (doc.getBlock(id)?.model as unknown as Element | undefined) ??
      (surface?.getElementById(id) as unknown as Element | null);
    if (!element?.xywh) return;
    const [x, y] = center(element.xywh);
    root.gfx.viewport.setCenter(x, y);
    root.gfx.selection.set({ elements: [id], editing: false });
  };

  let closeMenu = () => {};
  /** Goes to the end of a route; with several, asks which one. */
  const follow = (
    root: Canvas,
    start: string,
    direction: "target" | "source",
    at: { x: number; y: number },
  ) => {
    const surface = surfaceOf(doc);
    if (!surface) return;
    const ends = routeEnds(segments(surface), rerouteDots(surface), start, direction);
    if (ends.length === 1) goTo(root, ends[0]);
    else if (ends.length > 1) {
      closeMenu();
      closeMenu = openCardMenu(
        at.x,
        at.y,
        ends.slice(0, 20).map((id) => ({
          label: objectTitle(doc, surface, id),
          icon: doc.getBlock(id)?.flavour === "affine:note" ? "note" : "locate",
          run: () => goTo(root, id),
        })),
      );
    }
  };

  const hasEnds = (start: string, direction: "target" | "source") => {
    const surface = surfaceOf(doc);
    return !!surface && routeEnds(segments(surface), rerouteDots(surface), start, direction).length > 0;
  };

  let lastDotDown: { id: string; time: number; x: number; y: number } | undefined;
  let swallowUp: number | undefined;
  const pointerDown = (event: PointerEvent) => {
    const root = canvas();
    if (!root || event.button !== 0 || root.gfx.selection.editing || doc.readonly) return;
    const target = hit(root, event.clientX, event.clientY);
    if (!target) {
      lastDotDown = undefined;
      return;
    }
    if (event.altKey && target.kind === "arrow") {
      swallow(event);
      swallowUp = event.pointerId;
      const surface = surfaceOf(doc);
      const dot = surface && addReroutePoint(doc, surface, target.id, target.point);
      if (dot) root.gfx.selection.set({ elements: [dot], editing: false });
      return;
    }
    if (target.kind !== "dot") {
      lastDotDown = undefined;
      return;
    }
    const again =
      lastDotDown?.id === target.id &&
      event.timeStamp - lastDotDown.time < 500 &&
      Math.hypot(event.clientX - lastDotDown.x, event.clientY - lastDotDown.y) < 6;
    if (again) {
      // A double-click on a dot follows its route instead of editing text.
      swallow(event);
      swallowUp = event.pointerId;
      lastDotDown = undefined;
      follow(root, target.id, "target", { x: event.clientX, y: event.clientY });
      return;
    }
    lastDotDown = { id: target.id, time: event.timeStamp, x: event.clientX, y: event.clientY };
  };
  const pointerUp = (event: PointerEvent) => {
    if (swallowUp !== event.pointerId) return;
    swallowUp = undefined;
    swallow(event);
  };

  const keyDown = (event: KeyboardEvent) => {
    const root = canvas();
    if (!root || root.gfx.selection.editing || doc.readonly) return;
    const surface = surfaceOf(doc);
    if (!surface) return;
    const selected = root.gfx.selection.selectedElements;
    const dots = selected.filter(isRerouteDot).map((e) => e.id);
    if (!dots.length) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      removeReroutePoints(doc, surface, dots);
      const ids = selected
        .map((e) => e.id)
        .filter((id) => !dots.includes(id) && (surface.getElementById(id) || doc.getBlock(id)));
      root.gfx.selection.set({ elements: ids, editing: false });
      // Anything else selected is deleted as usual.
      if (!ids.length) swallow(event);
    } else if (event.key === "Enter" && dots.length === selected.length) {
      // Shapes start text editing on Enter; a dot goes where it points.
      swallow(event);
      const rect = root.getBoundingClientRect();
      follow(root, dots[0], "target", { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    }
  };

  const contextMenu = (event: MouseEvent) => {
    // A card under the pointer opens its own menu first and stops the event
    // (the app prevents the native menu everywhere, so defaultPrevented
    // says nothing here).
    const root = canvas();
    if (!root || doc.readonly) return;
    const target = hit(root, event.clientX, event.clientY);
    if (!target) return;
    swallow(event);
    const at = { x: event.clientX, y: event.clientY };
    const surface = surfaceOf(doc);
    if (!surface) return;
    type Item = Parameters<typeof openCardMenu>[2][number];
    const items: Item[] = [];
    if (target.kind === "arrow")
      items.push({
        label: "Add reroute point",
        icon: "circle",
        run: () => {
          const dot = addReroutePoint(doc, surface, target.id, target.point);
          if (dot) root.gfx.selection.set({ elements: [dot], editing: false });
        },
      });
    if (hasEnds(target.id, "target"))
      items.push({ label: "Go to target", icon: "forward", run: () => follow(root, target.id, "target", at) });
    if (hasEnds(target.id, "source"))
      items.push({ label: "Go to source", icon: "back", run: () => follow(root, target.id, "source", at) });
    if (target.kind === "dot")
      items.push({
        label: "Remove reroute point",
        icon: "close",
        run: () => removeReroutePoints(doc, surface, [target.id]),
      });
    closeMenu();
    closeMenu = openCardMenu(at.x, at.y, items);
  };

  // Keep the model tidy whatever changed it: the editor's own tools, undo
  // and redo, or deleting the object at a route's end.
  let pending = false;
  const scheduleCleanUp = () => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      const surface = surfaceOf(doc);
      if (surface) cleanUp(doc, surface);
    });
  };
  const subscriptions: { dispose(): void }[] = [];
  let watched: SurfaceBlockModel | undefined;
  const watch = () => {
    const surface = surfaceOf(doc);
    if (!surface || surface === watched) return;
    watched = surface;
    subscriptions.push(
      surface.elementAdded.on(({ id, local }) => {
        if (local && !doc.readonly) queueMicrotask(() => normalize(surface, id));
      }),
      surface.elementUpdated.on(({ id, props, local }) => {
        if (!local || doc.readonly) return;
        // Moving anything updates arrow paths; only ends and dot sizes matter.
        if ("source" in props || "target" in props) queueMicrotask(() => normalize(surface, id));
        else if ("xywh" in props && isRerouteDot(surface.getElementById(id)))
          queueMicrotask(() => normalize(surface, id));
      }),
      // Deleting a card removes its arrows, which can leave a dot routing
      // nothing; undo and redo can too.
      surface.elementRemoved.on(({ local }) => {
        if (local) scheduleCleanUp();
      }),
    );
  };
  watch();
  const blockAdded = doc.slots.blockUpdated.on(({ type, flavour }) => {
    if (type === "add" && flavour === "affine:surface") watch();
  });

  editor.addEventListener("pointerdown", pointerDown, true);
  editor.addEventListener("pointerup", pointerUp, true);
  editor.addEventListener("keydown", keyDown, true);
  editor.addEventListener("contextmenu", contextMenu, true);
  return () => {
    closeMenu();
    blockAdded.dispose();
    for (const s of subscriptions) s.dispose();
    editor.removeEventListener("pointerdown", pointerDown, true);
    editor.removeEventListener("pointerup", pointerUp, true);
    editor.removeEventListener("keydown", keyDown, true);
    editor.removeEventListener("contextmenu", contextMenu, true);
  };
}
