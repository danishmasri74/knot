import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { attachments } from "./workspace";
GlobalWorkerOptions.workerSrc = workerUrl;

export type AiPdfSource = { key: string; page?: number };
export function openPdfBytes(bytes: Uint8Array) {
  const base = import.meta.env.DEV ? "/node_modules/pdfjs-dist/" : "/pdfjs/";
  return getDocument({
    data: bytes,
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`,
    wasmUrl: `${base}wasm/`,
    stopAtErrors: true,
  });
}

export async function preparePdfInput(source: AiPdfSource): Promise<string> {
  const bytes = new Uint8Array(await attachments.get(source.key));
  if (bytes.length > 10 * 1024 * 1024)
    throw new Error("PDF exceeds the reader’s 10 MiB limit.");
  if (source.page === undefined) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () =>
        reject(new Error("Could not read the PDF attachment."));
      reader.readAsDataURL(new Blob([bytes], { type: "application/pdf" }));
    });
  }
  const task = openPdfBytes(bytes);
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(source.page);
    const size = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({
      scale: Math.min(
        3200 / Math.max(size.width, size.height),
        Math.sqrt(6000000 / (size.width * size.height)),
      ),
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport, background: "white" }).promise;
    return canvas.toDataURL("image/jpeg", 0.94);
  } finally {
    await task.destroy();
  }
}
