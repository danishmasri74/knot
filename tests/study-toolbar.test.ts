import { expect, it } from "vitest";
import type { AffineEditorContainer } from "@blocksuite/presets";
import { selectedPdfKeys } from "../src/features/editor/blocksuite/study-toolbar";

const editor = (blocks: Record<string, object>) =>
  ({
    doc: { getBlock: (id: string) => (blocks[id] ? { model: blocks[id] } : null) },
  }) as unknown as AffineEditorContainer;

it("offers a course only when every selected object is a PDF", () => {
  const e = editor({
    a: { flavour: "affine:attachment", type: "application/pdf", sourceId: "ka" },
    b: { flavour: "affine:attachment", type: "application/pdf", sourceId: "kb" },
    img: { flavour: "affine:attachment", type: "image/png", sourceId: "ki" },
    note: { flavour: "affine:note" },
  });
  expect(selectedPdfKeys(e, ["a", "b"])).toEqual(["ka", "kb"]);
  expect(selectedPdfKeys(e, ["a", "note"])).toEqual([]);
  expect(selectedPdfKeys(e, ["img"])).toEqual([]);
});
