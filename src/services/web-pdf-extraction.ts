/**
 * Text capture for PDF links. The native fetcher downloads the file; pdf.js
 * reads its text layer here (in its own worker, without running PDF scripts)
 * and each page becomes passages tagged with their page number. Figures,
 * images and scanned pages are not read: the capture says so.
 */
import { WEB_LIMITS, type WebSection } from "./web-source-types";

export const PDF_TEXT_ONLY =
  "PDF text only: figures, images and scanned pages were not read.";
const PDF_LIMITS = { pages: 500, ms: 20_000 } as const;

/** One text run from pdf.js getTextContent(). */
export type PdfTextItem = {
  str: string;
  hasEOL?: boolean;
  transform?: number[];
  height?: number;
};

/**
 * Lines from text runs, then paragraphs: a larger gap than normal line
 * spacing, a jump back up the page (next column) or an empty line starts a
 * new paragraph. Words hyphenated across lines are rejoined.
 */
export function pdfParagraphs(items: PdfTextItem[]): string[] {
  type Line = { text: string; y: number; height: number };
  const lines: Line[] = [];
  let text = "",
    y = NaN,
    height = 0;
  const end = () => {
    lines.push({ text: text.replace(/\s+/g, " ").trim(), y, height });
    text = "";
    y = NaN;
    height = 0;
  };
  for (const item of items) {
    if (Number.isNaN(y) && item.str.trim()) {
      y = item.transform?.[5] ?? NaN;
      height = item.height ?? 0;
    }
    text += item.str;
    if (item.hasEOL) end();
  }
  if (text.trim()) end();
  const heights = lines
    .map((l) => l.height)
    .filter((h) => h > 0)
    .sort((a, b) => a - b);
  const lineHeight = heights[Math.floor(heights.length / 2)] || 10;
  const paragraphs: string[] = [];
  let current = "";
  let previous: Line | undefined;
  const flush = () => {
    if (current.trim()) paragraphs.push(current.trim());
    current = "";
  };
  for (const line of lines) {
    if (!line.text) {
      flush();
      previous = undefined;
      continue;
    }
    const gap =
      previous && !Number.isNaN(previous.y) && !Number.isNaN(line.y)
        ? previous.y - line.y
        : lineHeight;
    if (previous && (gap > lineHeight * 1.8 || gap < -lineHeight)) flush();
    if (!current) current = line.text;
    else if (/[A-Za-zÀ-ɏ]-$/.test(current) && /^\p{Ll}/u.test(line.text))
      current = current.slice(0, -1) + line.text;
    else current += " " + line.text;
    previous = line;
  }
  flush();
  return paragraphs;
}

/**
 * The title printed on the first page: the largest text near the top (lines
 * in the same size are joined, for titles that wrap).
 */
export function pdfPrintedTitle(items: PdfTextItem[]): string | null {
  const lines: { text: string; height: number }[] = [];
  let text = "",
    height = 0;
  for (const item of items) {
    text += item.str;
    if (item.str.trim()) height = Math.max(height, item.height ?? 0);
    if (item.hasEOL) {
      lines.push({ text: text.replace(/\s+/g, " ").trim(), height });
      text = "";
      height = 0;
    }
  }
  if (text.trim()) lines.push({ text: text.replace(/\s+/g, " ").trim(), height });
  const top = lines.slice(0, 40).filter((l) => l.text);
  const largest = Math.max(0, ...top.map((l) => l.height));
  if (!largest) return null;
  const start = top.findIndex((l) => l.height === largest);
  const parts: string[] = [];
  for (let i = start; i < top.length && Math.abs(top[i].height - largest) < 0.5; i++)
    parts.push(top[i].text);
  const title = parts.join(" ").trim();
  return title.length >= 4 && title.length <= 300 ? title : null;
}

/** Metadata authors are often system codes ("SE:W:CAR:MP"); keep names. */
export function pdfAuthor(value: string | null): string | null {
  return value && /\p{L}{2}/u.test(value) && !/^[^\s]*[:\d_\\/][^\s]*$/.test(value)
    ? value.slice(0, 200)
    : null;
}

function fileName(url: string) {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    return name.replace(/\.pdf$/i, "") || null;
  } catch {
    return null;
  }
}

export async function extractPdfSource(
  base64: string,
  url: string,
  signal: AbortSignal,
) {
  const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist");
  const { default: workerUrl } = await import(
    "pdfjs-dist/build/pdf.worker.min.mjs?url"
  );
  GlobalWorkerOptions.workerSrc ||= workerUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const base = import.meta.env.DEV ? "/node_modules/pdfjs-dist/" : "/pdfjs/";
  const task = getDocument({
    data: bytes,
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`,
    wasmUrl: `${base}wasm/`,
    enableXfa: false,
  });
  const deadline = Date.now() + PDF_LIMITS.ms;
  const check = () => {
    if (signal.aborted) throw new Error("Capture stopped");
    if (Date.now() > deadline)
      throw new Error("Reading the PDF took longer than 20 seconds. Download it and attach it in Knot.");
  };
  const abort = () => void task.destroy();
  signal.addEventListener("abort", abort, { once: true });
  try {
    const pdf = await task.promise.catch((error: { name?: string }) => {
      throw new Error(
        error?.name === "PasswordException"
          ? "This PDF is password-protected. Open it externally."
          : "This PDF could not be read. Download it and open or attach it in Knot.",
      );
    });
    check();
    const warnings = [PDF_TEXT_ONLY];
    const sections: WebSection[] = [];
    let printed: string | null = null;
    let chars = 0,
      truncated = false;
    const pages = Math.min(pdf.numPages, PDF_LIMITS.pages);
    if (pdf.numPages > pages)
      warnings.push(`Only the first ${pages} of ${pdf.numPages} pages were read.`);
    pages: for (let n = 1; n <= pages; n++) {
      check();
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      if (n === 1) printed = pdfPrintedTitle(content.items as PdfTextItem[]);
      page.cleanup();
      for (const paragraph of pdfParagraphs(content.items as PdfTextItem[])) {
        // Long paragraphs split at a sentence end near the passage limit.
        for (let rest = paragraph; rest; ) {
          if (
            sections.length >= WEB_LIMITS.sections ||
            chars >= WEB_LIMITS.extractedChars
          ) {
            truncated = true;
            break pages;
          }
          let cut = rest.length;
          if (cut > WEB_LIMITS.passageChars) {
            const dot = rest.lastIndexOf(". ", WEB_LIMITS.passageChars);
            cut = dot > WEB_LIMITS.passageChars / 2 ? dot + 1 : WEB_LIMITS.passageChars;
          }
          const text = rest.slice(0, cut).trim();
          rest = rest.slice(cut).trim();
          sections.push({
            id: `section-${sections.length + 1}`,
            kind: "text",
            headings: [`Page ${n}`],
            text,
            page: n,
          });
          chars += text.length;
        }
      }
    }
    if (truncated) warnings.push("Extraction truncated at the content limit.");
    if (chars < 20)
      throw new Error(
        "This PDF has almost no readable text (it may be scanned). Download it and attach it in Knot so Ask Knot can look at the pages.",
      );
    const { info } = (await pdf.getMetadata().catch(() => ({ info: {} }))) as {
      info: Record<string, unknown>;
    };
    const meta = (key: string) =>
      typeof info?.[key] === "string" && (info[key] as string).trim()
        ? (info[key] as string).trim()
        : null;
    return {
      // Metadata titles are often left as a file name ("Microsoft Word - x.docx").
      title: (
        (meta("Title")?.match(/^(?:microsoft \w+ - |untitled)|\.(?:docx?|pdf|tex|indd)$/i)
          ? null
          : meta("Title")) ??
        printed ??
        fileName(url) ??
        "PDF"
      ).slice(0, 300),
      author: pdfAuthor(meta("Author")),
      // A PDF's creation date is when the file was made, often a re-export
      // years after publication, so it is not reported as published.
      published: null,
      method: "pdf-text-v1",
      sections,
      warnings,
    };
  } finally {
    signal.removeEventListener("abort", abort);
    void task.destroy();
  }
}
