import { attachments } from "../../../services/workspace";
import { getDocument, GlobalWorkerOptions, Util } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PdfLocation } from "./pdf-highlights";
GlobalWorkerOptions.workerSrc = workerUrl;

// Legacy rectangles can be wider than the text. Recover only glyphs whose
// centers fall in the selected range, retaining the PDF's reading order.
export async function readPdfExcerpt(location: PdfLocation): Promise<string> {
  const task = getDocument({
    data: new Uint8Array(await attachments.get(location.key)),
  });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(location.page);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d")!;
    const lines: string[] = [];
    for (const item of content.items) {
      if (!("str" in item) || !item.str) continue;
      const transform = Util.transform(viewport.transform, item.transform);
      const height = Math.hypot(transform[2], transform[3]);
      const x = transform[4] / viewport.width,
        y = (transform[5] - height / 2) / viewport.height;
      context.font =
        height +
        "px " +
        (content.styles[item.fontName]?.fontFamily || "sans-serif");
      const full = context.measureText(item.str).width;
      let selected = "";
      for (let i = 0; i < item.str.length; i++) {
        const before = context.measureText(item.str.slice(0, i)).width;
        const after = context.measureText(item.str.slice(0, i + 1)).width;
        const center =
          x +
          (((before + after) / 2 / Math.max(full, 1)) * item.width) /
            viewport.width;
        if (
          location.rects.some(
            ([rx, ry, rw, rh]) =>
              center >= rx - 0.002 &&
              center <= rx + rw + 0.002 &&
              y >= ry - 0.004 &&
              y <= ry + rh + 0.004,
          )
        )
          selected += item.str[i];
      }
      if (selected.trim()) lines.push(selected.trim());
    }
    if (!lines.length)
      throw new Error(
        "Text could not be recovered from this location. Open the PDF to review it.",
      );
    return lines.join("\n");
  } finally {
    await task.destroy();
  }
}
