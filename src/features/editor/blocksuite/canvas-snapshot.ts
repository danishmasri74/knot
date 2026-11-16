import { ExportManager } from "@blocksuite/blocks";
import type { AffineEditorContainer } from "@blocksuite/presets";

/** Longest side and area of the image sent, as for view_images pictures. */
const MAX_SIDE = 1600;
const MAX_AREA = 2_500_000;

type Box = { x: number; y: number; w: number; h: number };

/** The part of the canvas in view, or all of it when nothing is in view. */
export function visibleCanvasBound(viewport: Box, content: Box): Box {
  const x = Math.max(viewport.x, content.x);
  const y = Math.max(viewport.y, content.y);
  const right = Math.min(viewport.x + viewport.w, content.x + content.w);
  const bottom = Math.min(viewport.y + viewport.h, content.y + content.h);
  return right - x > 1 && bottom - y > 1
    ? { x, y, w: right - x, h: bottom - y }
    : content;
}

/** Output size that keeps the aspect ratio within the side and area limits. */
export function snapshotSize(width: number, height: number) {
  const scale = Math.min(
    1,
    MAX_SIDE / Math.max(width, height),
    Math.sqrt(MAX_AREA / (width * height)),
  );
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Renders what the user sees of the canvas to a JPEG data URL on this
 * device, with BlockSuite's export renderer (as canvas export does), for
 * view_canvas. Nothing leaves the device until Ask Knot sends the request.
 */
export async function renderVisibleCanvas(
  editor: AffineEditorContainer,
): Promise<string> {
  const root = editor.querySelector("affine-edgeless-root");
  if (editor.mode !== "edgeless" || !root)
    throw new Error("Open the canvas to let Ask Knot look at it.");
  const content = root.gfx.elementsBound;
  if (!content.w || !content.h) throw new Error("The canvas is empty.");
  const viewport = root.gfx.viewport.viewportBounds;
  const bound = visibleCanvasBound(viewport, content);
  const manager = new ExportManager(editor.std);
  // BlockSuite 0.19.5 keeps readiness internal; canvas export uses it too.
  const ready = manager as unknown as { _checkReady(): Promise<boolean> };
  if (!(await ready._checkReady()))
    throw new Error("Images on the canvas are still loading. Try again.");
  const rendered = await manager.edgelessToCanvas(
    root.surface.renderer,
    bound,
    root,
    undefined,
    root.gfx.getElementsByBound(bound, { type: "canvas" }),
  );
  if (!rendered?.width || !rendered.height)
    throw new Error("Could not render the canvas.");
  const size = snapshotSize(rendered.width, rendered.height);
  const out = document.createElement("canvas");
  out.width = size.width;
  out.height = size.height;
  const context = out.getContext("2d");
  if (!context) throw new Error("Could not prepare the canvas image.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, out.width, out.height);
  context.drawImage(rendered, 0, 0, out.width, out.height);
  return out.toDataURL("image/jpeg", 0.85);
}
