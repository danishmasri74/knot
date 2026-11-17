import { openPdfBytes } from "./pdf-input";
import { attachments } from "./workspace";
import { splitPassage, type TopicPdf } from "./topic-extract";
import type { TopicPassage, TopicSource } from "./topic-types";
import { pageLabel } from "./office";
/** Pages without a text layer listed per PDF for background OCR. */
export const MAX_SCANNED_PAGES = 200;
// Session cache is bounded; persistent text is held only in the disposable native index.
const pagesByHash = new Map<
  string,
  { pages: { page: number; text: string }[]; partial: boolean; scanned: number[] }
>();
export async function extractTopicPdf(
  source: TopicSource,
  ref: TopicPdf,
  signal?: AbortSignal,
): Promise<{ passages: TopicPassage[]; partial: boolean; scanned: number[] }> {
  if (signal?.aborted) throw Error("PDF indexing cancelled");
  const bytes = new Uint8Array(await attachments.get(ref.key));
  if (bytes.length > 10 * 1024 * 1024) throw Error("PDF size limit");
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  )
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
  if (signal?.aborted) throw Error("PDF indexing cancelled");
  let extracted = pagesByHash.get(hash);
  if (!extracted) {
    const task = openPdfBytes(bytes);
    const cancel = () => {
      void task.destroy();
    };
    signal?.addEventListener("abort", cancel, { once: true });
    extracted = { pages: [], partial: false, scanned: [] };
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 1000) extracted.partial = true;
      let size = 0;
      for (let n = 1; n <= Math.min(1000, pdf.numPages); n++) {
        if (signal?.aborted) throw Error("PDF indexing cancelled");
        try {
          const page = await pdf.getPage(n);
          const reader = page.streamTextContent().getReader();
          const content: {
            items: Awaited<ReturnType<typeof page.getTextContent>>["items"];
          } = { items: [] };
          const started = performance.now();
          try {
            for (;;) {
              if (signal?.aborted || performance.now() - started > 15000)
                throw Error("PDF page extraction stopped");
              const part = await reader.read();
              if (part.done) break;
              content.items.push(...part.value.items);
              if (content.items.length > 20000)
                throw Error("PDF page text item limit");
            }
          } finally {
            await reader.cancel().catch(() => {});
          }

          const items = content.items.filter(
            (
              i,
            ): i is Extract<(typeof content.items)[number], { str: string }> =>
              "str" in i,
          );
          // Preserve PDF.js stream order. Ambiguous side-by-side columns are omitted rather than interleaved.
          const width = page.getViewport({ scale: 1 }).width;
          const left = items.filter((i) => i.transform[4] < width * 0.45),
            right = items.filter((i) => i.transform[4] > width * 0.55);
          const ambiguous =
            left.length > 8 &&
            right.length > 8 &&
            left.some((l) =>
              right.some((r) => Math.abs(l.transform[5] - r.transform[5]) < 2),
            );
          if (ambiguous) {
            extracted.partial = true;
            continue;
          }
          const text = items
            .map((i) => i.str + (i.hasEOL ? "\n" : " "))
            .join("");
          size += text.length;
          if (size > 2000000) {
            extracted.partial = true;
            break;
          }
          if (!text.trim()) {
            // No text layer (a scan): background OCR reads it, up to a cap.
            if (extracted.scanned.length < MAX_SCANNED_PAGES)
              extracted.scanned.push(n);
            else extracted.partial = true;
            continue;
          }
          extracted.pages.push({ page: n, text });
          page.cleanup();
        } catch {
          extracted.partial = true;
        }
      }
    } finally {
      signal?.removeEventListener("abort", cancel);
      await task.destroy();
    }
    if (pagesByHash.size >= 4)
      pagesByHash.delete(pagesByHash.keys().next().value!);
    pagesByHash.set(hash, extracted);
  }
  return {
    partial: extracted.partial,
    scanned: extracted.scanned,
    passages: extracted.pages.flatMap((p) =>
      splitPassage(p.text)
        .filter((t) => t.trim())
        .map((text) => ({
          document: source.id,
          id: ref.blockId,
          title: `${ref.name} · ${pageLabel(ref.name, p.page)}`,
          text,
          revision: source.revision,
          vector: [],
          attribution: `PDF SHA-256 ${hash}`,
          pdf: {
            key: ref.key,
            name: ref.name,
            documentId: source.id,
            blockId: ref.blockId,
            page: p.page,
            rects: [],
          },
        })),
    ),
  };
}
