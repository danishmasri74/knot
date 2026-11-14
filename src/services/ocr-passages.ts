import { splitPassage } from "./topic-extract";
import type { PdfRect } from "../features/editor/blocksuite/pdf-highlights";

/** A line Windows OCR read; the box is in fractions of the image or page. */
export interface OcrLine {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const round = (n: number) => Math.round(n * 10000) / 10000;

/**
 * Splits OCR text into search passages, each with the boxes of the lines it
 * holds, so a citation can highlight exactly where the text was read.
 */
export function ocrPassages(
  lines: OcrLine[],
): { text: string; rects: PdfRect[] }[] {
  const text = lines.map((line) => line.text).join("\n");
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.text.length + 1;
  }
  const result: { text: string; rects: PdfRect[] }[] = [];
  let at = 0;
  for (const part of splitPassage(text)) {
    const start = at,
      end = at + part.length;
    at = end;
    if (!part.trim()) continue;
    const rects: PdfRect[] = [];
    lines.forEach((line, index) => {
      const lineStart = starts[index],
        lineEnd = lineStart + line.text.length;
      if (lineStart >= end || lineEnd <= start || rects.length >= 100) return;
      const x = Math.min(Math.max(line.x, 0), 1),
        y = Math.min(Math.max(line.y, 0), 1);
      const w = Math.min(line.w, 1 - x),
        h = Math.min(line.h, 1 - y);
      if (w > 0 && h > 0) rects.push([round(x), round(y), round(w), round(h)]);
    });
    result.push({ text: part, rects });
  }
  return result;
}
