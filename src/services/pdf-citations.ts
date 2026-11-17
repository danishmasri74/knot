/**
 * Page and slide citations in answers about PDFs and slide decks, such as
 * "(slide 3)", "(p. 4)" or, with several files, "(12-Test+Levels.pptx,
 * slide 3)". The model writes them as text (see BASE_VISUAL and
 * PDF_FILES_RULES in ai.rs); the app turns them into links to that page.
 */
export type CitedPdf = { key: string; name: string; document?: string };
export type PdfCitation = { pdf: CitedPdf; page: number; label: string };

/** Splits text on these citations; use with String.split (no captures). */
export const PDF_CITATION =
  /\((?:[^()\n]{1,200}?,\s*)?(?:slides?|pp?\.|pages?)\s*\d+(?:\s*[-–]\s*\d+)?\)/
    .source;
const parts =
  /^\((?:([^()\n]{1,200}?),\s*)?(slides?|pp?\.|pages?)\s*(\d+)(?:\s*[-–]\s*(\d+))?\)$/;

const plain = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/\.pdf$/, "")
    .replace(/[+_]+/g, " ")
    .replace(/\s+/g, " ");
const stem = (name: string) => plain(name).replace(/\.(pptx?|docx?|key|odp)$/, "");

/** A readable file name: no extension, spaces instead of + and _. */
export function shortPdfName(name: string) {
  return name
    .replace(/\.pdf$/i, "")
    .replace(/\.(pptx?|docx?|key|odp)$/i, "")
    .replace(/[+_]+/g, " ")
    .trim();
}

/**
 * The file and page a citation points to, or undefined when it can't be
 * told apart (no file named while several were sent, or an unknown name).
 */
export function resolvePdfCitation(
  text: string,
  pdfs: CitedPdf[],
): PdfCitation | undefined {
  const match = parts.exec(text);
  if (!match || !pdfs.length) return;
  const [, named, kind, first, last] = match;
  const page = Number(first);
  if (!Number.isSafeInteger(page) || page < 1) return;
  let pdf: CitedPdf | undefined;
  if (named) {
    const wanted = plain(named);
    pdf =
      pdfs.find((p) => plain(p.name) === wanted) ??
      pdfs.find((p) => stem(p.name) === stem(named)) ??
      pdfs.find(
        (p) => stem(p.name).includes(stem(named)) || stem(named).includes(stem(p.name)),
      );
  } else if (pdfs.length === 1) pdf = pdfs[0];
  if (!pdf) return;
  const unit = kind.startsWith("s") ? "slide" : "p.";
  const pages = last ? `${page}–${last}` : `${page}`;
  return {
    pdf,
    page,
    label:
      pdfs.length > 1
        ? `${shortPdfName(pdf.name)}, ${unit} ${pages}`
        : `${unit} ${pages}`,
  };
}

/** The distinct pages an answer cites, in order, at most `limit`. */
export function citedPages(
  text: string,
  pdfs: CitedPdf[],
  limit = 6,
): PdfCitation[] {
  const seen = new Set<string>();
  const result: PdfCitation[] = [];
  for (const match of text.matchAll(new RegExp(PDF_CITATION, "g"))) {
    const cited = resolvePdfCitation(match[0], pdfs);
    const id = cited && `${cited.pdf.key}:${cited.page}`;
    if (!cited || !id || seen.has(id)) continue;
    seen.add(id);
    result.push(cited);
    if (result.length === limit) break;
  }
  return result;
}
