import { expect, it } from "vitest";
import {
  parsePdfSourceUrl,
  pdfSourceUrl,
  validatePdfHighlight,
  validatePdfLocation,
  type PdfHighlight,
} from "../src/features/editor/blocksuite/pdf-highlights";
const value: PdfHighlight = {
  id: "pdf-12345678-1234-1234-1234-123456789abc",
  key: "retained/asset key",
  name: "研究 & notes.pdf",
  documentId: "original-id",
  page: 2,
  rects: [[0.1, 0.2, 0.3, 0.04]],
  quote: "An exact selected quote.",
};
it("round-trips source identity and location without copying quote text into the link", () => {
  const url = pdfSourceUrl(value);
  expect(parsePdfSourceUrl(url)).toEqual({
    key: value.key,
    name: value.name,
    documentId: value.documentId,
    page: 2,
    rects: value.rects,
  });
  expect(url).not.toContain("quote");
  expect(parsePdfSourceUrl("https://example.com/pdf")).toBeNull();
  expect(parsePdfSourceUrl("https://knot.invalid/other")).toBeNull();
});
it("rejects invalid pages, dimensions, excessive rectangles and missing identities", () => {
  for (const change of [
    { page: 0 },
    { page: 1.5 },
    { page: Infinity },
    { key: "" },
    { documentId: "" },
    { rects: [[0, 0, -1, 1]] },
    { rects: [[0.9, 0, 0.2, 1]] },
    { rects: [[0, 0, NaN, 1]] },
    { rects: Array(101).fill([0, 0, 1, 1]) },
  ]) {
    expect(() =>
      validatePdfLocation({ ...value, ...change } as PdfHighlight),
    ).toThrow();
  }
  expect(() => parsePdfSourceUrl("https://knot.invalid/pdf#%FF")).toThrow();
  expect(() => parsePdfSourceUrl("https://knot.invalid/pdf#null")).toThrow();
});
it("bounds selected text and requires a stable retry ID and visible selection", () => {
  expect(() => validatePdfHighlight(value)).not.toThrow();
  for (const change of [
    { quote: " " },
    { quote: "a".repeat(4001) },
    { id: "other" },
    { rects: [] },
  ])
    expect(() => validatePdfHighlight({ ...value, ...change })).toThrow();
});
