export interface PdfSource {
  key: string;
  name: string;
  documentId: string;
}
export type PdfRect = [number, number, number, number];
export interface PdfLocation extends PdfSource {
  blockId?: string;
  page: number;
  rects: PdfRect[];
}
export interface PdfHighlight extends PdfLocation {
  id: string;
  quote: string;
}
const origin = "https://knot.invalid";

export function validatePdfLocation(value: PdfLocation): void {
  if (
    !value ||
    typeof value.key !== "string" ||
    !value.key ||
    value.key.length > 512 ||
    typeof value.name !== "string" ||
    !value.name ||
    value.name.length > 1000 ||
    typeof value.documentId !== "string" ||
    !value.documentId ||
    value.documentId.length > 128 ||
    !Number.isSafeInteger(value.page) ||
    value.page < 1 ||
    value.page > 100000 ||
    !Array.isArray(value.rects) ||
    value.rects.length > 100 ||
    value.rects.some(
      (r) =>
        !Array.isArray(r) ||
        r.length !== 4 ||
        r.some(
          (n) => typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1,
        ) ||
        r[2] <= 0 ||
        r[3] <= 0 ||
        r[0] + r[2] > 1.001 ||
        r[1] + r[3] > 1.001,
    )
  )
    throw new Error("Invalid PDF source location");
}

export function pdfSourceUrl(value: PdfLocation): string {
  validatePdfLocation(value);
  const { key, name, documentId, page, rects } = value;
  const url = `${origin}/pdf#${encodeURIComponent(JSON.stringify({ key, name, documentId, page, rects }))}`;
  if (url.length > 20000)
    throw new Error("PDF source link is too large; select a shorter passage");
  return url;
}

export function parsePdfSourceUrl(href: string): PdfLocation | null {
  const url = new URL(href);
  if (url.origin !== origin || url.pathname !== "/pdf") return null;
  if (href.length > 20000) throw new Error("PDF source link is too large");
  const value = JSON.parse(
    decodeURIComponent(url.hash.slice(1)),
  ) as PdfLocation;
  validatePdfLocation(value);
  return value;
}

export function validatePdfHighlight(value: PdfHighlight): void {
  validatePdfLocation(value);
  pdfSourceUrl(value);
  if (
    !value.rects.length ||
    typeof value.id !== "string" ||
    !/^pdf-[a-f0-9-]{36}$/.test(value.id) ||
    typeof value.quote !== "string" ||
    !value.quote.trim() ||
    value.quote.length > 4000
  )
    throw new Error("Select 1–4,000 characters on one PDF page");
}

export function pdfSourceLabel(value: PdfLocation): string {
  return `PDF source: ${value.name} · page ${value.page}`;
}

export interface PdfCitation extends PdfLocation {
  noteId: string;
  label: string;
}

export function samePassage(a: PdfLocation, b: PdfLocation) {
  return (
    a.key === b.key &&
    a.page === b.page &&
    a.rects.length === b.rects.length &&
    a.rects.every((r, i) =>
      r.every(
        (n, j) => Math.abs(n - b.rects[i][j]) < (j === 2 ? 0.006 : 0.002),
      ),
    )
  );
}

// Split each text line at citation boundaries so a shared range has one fill.
export function passageSegments(citations: PdfCitation[]) {
  const lines: {
    y: number;
    h: number;
    spans: { start: number; end: number; index: number }[];
  }[] = [];
  citations.forEach((citation, index) =>
    citation.rects.forEach(([x, y, w, h]) => {
      let line = lines.find(
        (l) =>
          Math.min(l.y + l.h, y + h) - Math.max(l.y, y) >=
          Math.min(l.h, h) * 0.55,
      );
      if (!line) {
        line = { y, h, spans: [] };
        lines.push(line);
      }
      line.spans.push({ start: x, end: x + w, index });
    }),
  );
  return lines.flatMap((line) => {
    const edges = [
      ...new Set(line.spans.flatMap((s) => [s.start, s.end])),
    ].sort((a, b) => a - b);
    return edges.slice(1).flatMap((end, i) => {
      const start = edges[i];
      const refs = [
        ...new Set(
          line.spans
            .filter((s) => s.start < end && s.end > start)
            .map((s) => s.index),
        ),
      ];
      return refs.length
        ? [{ rect: [start, line.y, end - start, line.h] as PdfRect, refs }]
        : [];
    });
  });
}
