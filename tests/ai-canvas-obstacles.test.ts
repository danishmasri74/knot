import { expect, it } from "vitest";
import type { Doc } from "@blocksuite/store";
import { canvasObstacles } from "../src/features/editor/blocksuite/ai";

// A canvas with a card, a page-only note, a PDF attachment and a frame under
// the surface, and a shape and an arrow among its drawn elements.
function canvas() {
  const surface = {
    children: [
      { id: "pdf", flavour: "affine:attachment", xywh: "[500,0,480,679]" },
      { id: "frame", flavour: "affine:frame", xywh: "[-900,0,400,300]" },
    ],
    elementModels: [
      { id: "shape", type: "shape", xywh: "[0,900,100,100]" },
      { id: "arrow", type: "connector", xywh: "[0,0,9999,9999]" },
    ],
  };
  const blocks: Record<string, { model: unknown }[]> = {
    "affine:surface": [{ model: surface }],
    "affine:note": [
      { model: { id: "card", displayMode: "both", xywh: "[0,0,360,240]" } },
      { model: { id: "page", displayMode: "doc", xywh: "[5000,0,10,10]" } },
    ],
  };
  return {
    getBlocksByFlavour: (flavour: string) => blocks[flavour] ?? [],
  } as unknown as Doc;
}

it("counts PDFs and other attachments as taken space", () => {
  const boxes = canvasObstacles(canvas());
  expect(boxes).toContainEqual([500, 0, 480, 679]);
  expect(boxes).toContainEqual([0, 0, 360, 240]);
  expect(boxes).toContainEqual([0, 900, 100, 100]);
  expect(boxes).toContainEqual([-900, 0, 400, 300]);
  // Arrows and page-only notes don't block.
  expect(boxes).toHaveLength(4);
  // New canvas cards start right of the PDF, not on top of it.
  expect(Math.max(...boxes.map((b) => b[0] + b[2]))).toBe(980);
});

it("can leave out frames and named objects", () => {
  const boxes = canvasObstacles(canvas(), (id) => id === "card", false);
  expect(boxes).toEqual([
    [500, 0, 480, 679],
    [0, 900, 100, 100],
  ]);
});
