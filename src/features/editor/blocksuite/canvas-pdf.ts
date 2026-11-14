import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
GlobalWorkerOptions.workerSrc = workerUrl;
export async function renderCanvasPdf(
  bytes: Uint8Array,
  canvas: HTMLCanvasElement,
  /** Longest side of the rendered page, in pixels. */
  size = 1400,
) {
  const task = getDocument({ data: bytes });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const original = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({
      scale: Math.min(2, size / Math.max(original.width, original.height)),
    });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    return original.height / original.width;
  } finally {
    await task.destroy();
  }
}
