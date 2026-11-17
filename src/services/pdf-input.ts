import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { attachments } from "./workspace";
GlobalWorkerOptions.workerSrc = workerUrl;

export type AiPdfSource = { key: string; page?: number };
/** One of several selected PDFs sent together (see PdfFile in ai.rs). */
export type AiPdfFile = { key: string; name: string };
/** Files one message may send together; matches MAX_PDF_FILES in ai.rs. */
export const MAX_PDF_FILES = 3;
/** Combined data URL size; matches MAX_PDF_FILES_BYTES in ai.rs. */
export const MAX_PDF_FILES_BYTES = 30_000_000;

/** Reads several selected PDFs whole, checking the combined limits. */
export async function preparePdfFiles(
  files: AiPdfFile[],
): Promise<{ name: string; data: string }[]> {
  if (files.length > MAX_PDF_FILES)
    throw new Error(
      `Select at most ${MAX_PDF_FILES} PDFs or slide decks to ask about together.`,
    );
  const prepared: { name: string; data: string }[] = [];
  let total = 0;
  for (const file of files) {
    const data = await preparePdfInput({ key: file.key });
    total += data.length;
    if (total > MAX_PDF_FILES_BYTES)
      throw new Error(
        "These files are too large to send together. Select fewer or smaller files.",
      );
    prepared.push({ name: file.name, data });
  }
  return prepared;
}
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
