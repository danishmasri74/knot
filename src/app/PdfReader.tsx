import {
  editorFontFamily,
  getEditorPreferences,
} from "../services/editor-preferences";
import { ShellIcon } from "./ShellIcon";
import {
  useCallback,
  useLayoutEffect,
  useEffect,
  useRef,
  useState,
} from "react";
import { attachments } from "../services/workspace";
import type {
  PdfHighlight,
  PdfLocation,
  PdfRect,
  PdfSource,
} from "../features/editor/blocksuite/pdf-highlights";
import {
  type PdfCitation,
  passageSegments,
  samePassage,
  pdfSourceLabel,
  validatePdfHighlight,
} from "../features/editor/blocksuite/pdf-highlights";
import { TextLayer, type PDFDocumentProxy } from "pdfjs-dist";
import { lookupOcr } from "../services/note-image-text";
import {
  getOcrPreferences,
  getWorkspaceSearchEnabled,
} from "../services/ai-preferences";
import type { OcrLine } from "../services/ocr-passages";
import { isSlidesName, slides } from "../services/slides";
import { openPdfBytes } from "../services/pdf-input";
import type { AiPdfSource } from "../services/pdf-input";

/** Which PDF, zoom and scroll position each notebook's reader was left at,
 * kept on this device so switching notebooks or restarting comes back to it. */
type PdfView = { key: string; zoom: number; ratio: number };
const viewKey = "knot.pdf-view.v1";
function savedViews(): Record<string, PdfView> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(viewKey) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, PdfView>)
      : {};
  } catch {
    return {};
  }
}
function savedView(notebook: string): PdfView | undefined {
  const view = savedViews()[notebook];
  return view &&
    typeof view.key === "string" &&
    Number.isFinite(view.zoom) &&
    Number.isFinite(view.ratio)
    ? view
    : undefined;
}
let viewTimer = 0;
function saveView(notebook: string, view: PdfView) {
  clearTimeout(viewTimer);
  viewTimer = window.setTimeout(() => {
    const views = savedViews();
    delete views[notebook];
    views[notebook] = view;
    // Keep the most recent notebooks only.
    const names = Object.keys(views);
    for (const name of names.slice(0, Math.max(0, names.length - 100)))
      delete views[name];
    try {
      localStorage.setItem(viewKey, JSON.stringify(views));
    } catch {
      /* The view stays for this session. */
    }
  }, 400);
}
export function PdfReader({
  sources,
  rememberAs,
  watchCitations,
  onJump,
  onDetach,
  onAsk,
  onReplace,
  initial,
  busy,
  onCreate,
  onRemove,
}: {
  sources: PdfSource[];
  /** The notebook whose reader this is; its last view is restored. */
  rememberAs?: string;
  onAsk?: (label: string, text: string, source: AiPdfSource) => void;
  onReplace: (id: string, value: PdfHighlight) => Promise<void>;
  onDetach: (citation: PdfCitation) => Promise<() => Promise<void>>;
  onJump: (id: string) => void;
  watchCitations?: (listener: (locations: PdfCitation[]) => void) => () => void;
  initial?: PdfLocation;
  busy: boolean;
  onCreate: (highlight: PdfHighlight) => Promise<void>;
  onRemove: (location: PdfLocation, id?: string) => Promise<void>;
}) {
  const [remembered] = useState(() => {
    const view = !initial && rememberAs ? savedView(rememberAs) : undefined;
    return view && sources.some((s) => s.key === view.key) ? view : undefined;
  });
  const [key, setKey] = useState(
    initial?.key ?? remembered?.key ?? sources[0]?.key ?? "",
  );
  const [pageNumber, setPageNumber] = useState(initial?.page ?? 1);
  const source = sources.find((entry) => entry.key === key);
  const original = source?.slides;
  const deck = !!original || isSlidesName(source?.name);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [hasText, setHasText] = useState(false);
  // A scanned page: "read" when its text layer came from saved OCR lines.
  const [scanned, setScanned] = useState<"read" | "unread" | undefined>();
  const root = useRef<HTMLElement>(null);
  const floating = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 90 });
  const [draft, setDraft] = useState<PdfHighlight | null>(null);
  const [saved, setSaved] = useState<(PdfLocation & { id?: string }) | null>(
    initial?.rects.length ? initial : null,
  );
  useEffect(() => {
    if (!initial) return;
    setKey(initial.key);
    setPageNumber(initial.page);
    setSaved(initial.rects.length ? initial : null);
  }, [initial]);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [rects, setRects] = useState<PdfRect[]>([]);
  const [citations, setCitations] = useState<PdfCitation[]>([]);
  useEffect(() => watchCitations?.(setCitations), [watchCitations]);
  const pageMarks = citations.filter(
    (entry) => entry.key === key && entry.page === pageNumber,
  );
  const [referenceIds, setReferenceIds] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<PdfRect | null>(null);
  const popover = useRef<HTMLElement>(null);
  const undoDetach = useRef<() => Promise<void>>();
  const [pinned, setPinned] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>();
  const hoverTarget = useRef("");
  function cancelHover() {
    clearTimeout(hoverTimer.current);
    hoverTarget.current = "";
  }
  useEffect(() => cancelHover, []);
  const closeRefs = () => {
    cancelHover();
    setReferenceIds([]);
    setPinned(false);
  };
  useEffect(closeRefs, [key, pageNumber]);
  const duplicate = draft && pageMarks.find((c) => samePassage(c, draft));
  const destinations = [
    ...new Map(
      pageMarks
        .filter((c) =>
          referenceIds.includes(JSON.stringify([c.noteId, c.rects])),
        )
        .map((c) => [c.noteId, c]),
    ).values(),
  ];
  const citationColor = (index: number) =>
    `hsl(${(45 + index * 137.508) % 360} 88% 58% / 60%)`;
  const marks = passageSegments(pageMarks).map(({ rect, refs }) => ({
    rects: [rect],
    refs,
    active:
      !draft && !!saved && refs.some((i) => samePassage(pageMarks[i], saved)),
    color: `hsl(${(45 + refs[0] * 137.508) % 360} 88% 58% / 36%)`,
  }));
  if (rects.length)
    marks.push({ rects, refs: [], active: true, color: "#ffd54f66" });
  // A cited passage that isn't a saved highlight card, such as lines OCR read
  // from a scanned page, is marked while it is shown.
  else if (
    !draft &&
    saved &&
    !saved.id &&
    saved.key === key &&
    saved.page === pageNumber &&
    saved.rects.length &&
    !pageMarks.some((c) => samePassage(c, saved))
  )
    marks.push({
      rects: saved.rects,
      refs: [],
      active: true,
      color: "#ffd54f66",
    });
  function hitPassage(page: HTMLElement, clientX: number, clientY: number) {
    const bounds = page.getBoundingClientRect();
    const x = (clientX - bounds.left) / bounds.width,
      y = (clientY - bounds.top) / bounds.height;
    return marks.findIndex((m) =>
      m.rects.some(
        ([a, b, w, h]) => x >= a && x <= a + w && y >= b && y <= b + h,
      ),
    );
  }
  function showRefs(index: number, pin: boolean) {
    const mark = marks[index];
    if (!mark || !mark.refs.length) return;
    cancelHover();
    setAnchor(mark.rects[0]);
    setReferenceIds(
      mark.refs.map((i) =>
        JSON.stringify([pageMarks[i].noteId, pageMarks[i].rects]),
      ),
    );
    setPinned(pin);
  }
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageFrame = scrollRef.current?.querySelector<HTMLDivElement>(
    `[data-page="${pageNumber}"]`,
  );
  const textLayer = pageFrame?.querySelector<HTMLDivElement>(".textLayer");
  const pageStatus = useCallback(
    (ready: boolean, text: boolean, scan?: "read" | "unread") => {
      setReady(ready);
      setHasText(text);
      setScanned(scan);
    },
    [],
  );
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const target = scroller?.querySelector<HTMLElement>(
      `[data-page="${initial?.key === key ? initial.page : 1}"]`,
    );
    if (target && scroller)
      scroller.scrollTop +=
        target.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top;
  }, [pdf, key, initial]);
  useLayoutEffect(() => {
    const box = popover.current,
      reader = root.current,
      page = pageFrame,
      scroll = page?.parentElement;
    if (!box || !reader || !page || !scroll || !anchor) return;
    const place = () => {
      const bounds = reader.getBoundingClientRect(),
        sheet = page.getBoundingClientRect(),
        view = scroll.getBoundingClientRect();
      const x = sheet.left + anchor[0] * sheet.width - bounds.left;
      const y = sheet.top + anchor[1] * sheet.height - bounds.top;
      const bottom = y + anchor[3] * sheet.height;
      box.style.left =
        Math.max(6, Math.min(x, bounds.width - box.offsetWidth - 8)) + "px";
      const top = view.top - bounds.top,
        limit = view.bottom - bounds.top;
      box.style.visibility = bottom < top || y > limit ? "hidden" : "visible";
      box.style.top =
        Math.max(
          top + 4,
          bottom + 8 + box.offsetHeight <= limit
            ? bottom + 8
            : y - box.offsetHeight - 8,
        ) + "px";
    };
    place();
    const observer = new ResizeObserver(place);
    [box, reader, page].forEach((el) => observer.observe(el));
    scroll.addEventListener("scroll", place);
    return () => {
      observer.disconnect();
      scroll.removeEventListener("scroll", place);
    };
  }, [anchor, destinations.length, draft]);
  const locatedInitial = useRef(false);
  const [readerWidth, setReaderWidth] = useState(320);
  const [zoom, setZoom] = useState(remembered?.zoom ?? 1);
  const restoredView = useRef(!remembered);
  // Come back to the remembered scroll position once the pages are laid out.
  useEffect(() => {
    if (restoredView.current || !remembered || key !== remembered.key || loading)
      return;
    // Pages grow as they render, so keep applying the position until the
    // height settles, unless the reader scrolls it themself first.
    let frame = 0;
    let tries = 0;
    let stable = 0;
    let height = -1;
    const scroller = scrollRef.current;
    const stop = () => {
      restoredView.current = true;
      cancelAnimationFrame(frame);
    };
    scroller?.addEventListener("wheel", stop, { once: true });
    scroller?.addEventListener("pointerdown", stop, { once: true });
    const restore = () => {
      if (!scroller || restoredView.current) return;
      scroller.scrollTop = remembered.ratio * scroller.scrollHeight;
      stable = scroller.scrollHeight === height ? stable + 1 : 0;
      height = scroller.scrollHeight;
      if (stable < 10 && ++tries < 180) frame = requestAnimationFrame(restore);
      else restoredView.current = true;
    };
    frame = requestAnimationFrame(restore);
    return () => {
      cancelAnimationFrame(frame);
      scroller?.removeEventListener("wheel", stop);
      scroller?.removeEventListener("pointerdown", stop);
    };
  }, [remembered, key, loading]);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (rememberAs && key && restoredView.current && scroller)
      saveView(rememberAs, {
        key,
        zoom,
        ratio: scroller.scrollHeight ? scroller.scrollTop / scroller.scrollHeight : 0,
      });
  }, [rememberAs, key, zoom]);
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      if (!container.clientWidth) return;
      clearTimeout(timer);
      timer = setTimeout(
        () => setReaderWidth(Math.max(240, Math.floor(container.clientWidth))),
        100,
      );
    });
    observer.observe(container);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, []);
  useEffect(() => {
    setDraft(null);
    setRects([]);
  }, [key, pageNumber]);
  const [askScope, setAskScope] = useState("document");
  const [readingForAi, setReadingForAi] = useState(false);
  const aiRead = useRef(0);
  useEffect(() => {
    setReadingForAi(false);
    return () => {
      aiRead.current++;
    };
  }, [pdf, key, pageNumber]);
  async function askAboutPdf() {
    if (!pdf || !source || !onAsk) return;
    const ticket = ++aiRead.current;
    setReadingForAi(true);
    try {
      const number = askScope === "page" ? pageNumber : undefined;
      const unit = deck ? "Slide" : "Page";
      let text = deck
        ? `Attached slide deck converted to PDF, with ${pdf.numPages} slides. Use the slide text and visual layout. Each PDF page is one slide.`
        : `Attached PDF with ${pdf.numPages} pages. Use the page text and visual layout.`;
      if (number) {
        const page = await pdf.getPage(number);
        const content = await page.getTextContent();
        text =
          unit +
          " " +
          number +
          "\n" +
          content.items
            .map((item) =>
              "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
            )
            .join("")
            .slice(0, 24000);
      }
      if (ticket !== aiRead.current) return;
      onAsk(
        source.name +
          (number ? ` · ${unit} ${number}` : deck ? " · Slides" : " · PDF"),
        text,
        {
        key,
        page: number,
      });
    } catch (e) {
      if (ticket === aiRead.current)
        setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      if (ticket === aiRead.current) setReadingForAi(false);
    }
  }
  useEffect(() => {
    let cancelled = false;
    let passwordRequired = false;
    let task: ReturnType<typeof openPdfBytes> | undefined;
    setPdf(null);
    setError("");
    setLoading(true);
    setReady(false);
    setDraft(null);
    void (async () => {
      try {
        const bytes = await attachments.get(key);
        if (cancelled) return;
        if (bytes.length > 10 * 1024 * 1024)
          throw new Error(
            "PDF reader limit is 10 MiB. The original attachment is retained.",
          );
        task = openPdfBytes(new Uint8Array(bytes));
        task.onPassword = () => {
          passwordRequired = true;
          setError("Password-protected PDFs are not supported in this reader.");
          setLoading(false);
          void task?.destroy();
        };
        const document = await task.promise;
        if (!cancelled) {
          setPdf(document);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(
            passwordRequired
              ? "Password-protected PDFs are not supported in this reader."
              : `Unable to open PDF: ${String(e)}`,
          );
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [key]);

  useEffect(() => {
    if (
      ready &&
      !locatedInitial.current &&
      initial?.key === key &&
      initial.page === pageNumber
    ) {
      const highlight = pageFrame?.querySelector<HTMLElement>(
        ".pdf-highlight.active",
      );
      const scroller = pageFrame?.parentElement;
      if (highlight && scroller) {
        // Only move the PDF viewport, never the surrounding panel or editor.
        scroller.scrollTop =
          scroller.scrollTop +
          highlight.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top -
          scroller.clientHeight / 2;
        locatedInitial.current = true;
      }
    }
  }, [ready, initial, key, pageNumber]);

  useEffect(() => {
    setPreview(false);
  }, [draft?.id]);
  const clearDraft = useCallback(() => {
    setDraft(null);
    setRects([]);
    setError("");
  }, []);
  useEffect(() => {
    if (!draft || pending || busy) return;
    const dismiss = (event: PointerEvent) => {
      const panel = floating.current;
      if (!panel || event.button !== 0 || event.composedPath().includes(panel))
        return;
      clearDraft();
    };
    // Dismiss before a new selection starts, even if the editor stops bubbling.
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [draft, pending, busy, clearDraft]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!draft) return;
    const update = () => {
      const bounds = root.current?.getBoundingClientRect();
      const mark = pageFrame
        ?.querySelector(".pdf-highlight.active")
        ?.getBoundingClientRect();
      const viewport = pageFrame?.parentElement?.getBoundingClientRect();
      if (!bounds || !mark || !viewport) return;
      const height = floating.current?.offsetHeight ?? 40;
      const width = floating.current?.offsetWidth ?? 240;
      const above = mark.top - bounds.top - height - 8;
      setPosition({
        left: Math.max(
          8,
          Math.min(mark.left - bounds.left, bounds.width - width - 8),
        ),
        top: Math.max(
          viewport.top - bounds.top + 8,
          Math.min(
            above >= viewport.top - bounds.top
              ? above
              : mark.bottom - bounds.top + 8,
            bounds.height - height - 8,
          ),
        ),
      });
    };
    update();
    const observer = new ResizeObserver(update);
    if (root.current) observer.observe(root.current);
    if (floating.current) observer.observe(floating.current);
    const scroller = pageFrame?.parentElement;
    scroller?.addEventListener("scroll", update);
    return () => {
      observer.disconnect();
      scroller?.removeEventListener("scroll", update);
    };
  }, [draft, preview, ready, zoom]);

  function captureSelection() {
    if (!ready || pending || busy || !source) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed || !textLayer) return;
    const range = selection.getRangeAt(0);
    if (
      !textLayer.contains(range.startContainer) ||
      !textLayer.contains(range.endContainer)
    )
      return;
    const bounds = textLayer.getBoundingClientRect();
    const selected: PdfRect[] = [...range.getClientRects()]
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => {
        const x = Math.max(
          0,
          Math.min(1, (r.left - bounds.left) / bounds.width),
        );
        const y = Math.max(
          0,
          Math.min(1, (r.top - bounds.top) / bounds.height),
        );
        return [
          x,
          y,
          Math.min(1 - x, r.width / bounds.width),
          Math.min(1 - y, r.height / bounds.height),
        ];
      });
    const value: PdfHighlight = {
      ...source,
      page: pageNumber,
      rects: selected,
      quote: selection.toString().trim(),
      id: `pdf-${crypto.randomUUID()}`,
    };
    try {
      validatePdfHighlight(value);
      closeRefs();
      setDraft(value);
      setRects(selected);
      setNotice("");
      setError("");
      selection.removeAllRanges();
      pageFrame
        ?.closest<HTMLElement>(".pdf-reader")
        ?.focus({ preventScroll: true });
    } catch (e) {
      setDraft(null);
      setError(String(e));
    }
  }

  return (
    <section
      ref={root}
      className="pdf-reader"
      aria-label="PDF reader"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (
          draft &&
          (event.key === "Escape" ||
            ((event.ctrlKey || event.metaKey) &&
              event.key.toLowerCase() === "z" &&
              !event.shiftKey))
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (preview && event.key === "Escape") {
            setPreview(false);
            return;
          }
          clearDraft();
          window.getSelection()?.removeAllRanges();
        }
      }}
    >
      <div className="pdf-reader-toolbar">
        <div className="pdf-toolbar">
          <select
            aria-label="PDF attachment"
            value={key}
            disabled={busy || pending}
            onChange={(e) => {
              setKey(e.target.value);
              setPageNumber(1);
              setRects([]);
              setNotice("");
            }}
          >
            {sources.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.name}
              </option>
            ))}
          </select>
          {onAsk && (
            <div className="pdf-ai-controls">
              <select
                aria-label="PDF context for Ask Knot"
                title="Send the full PDF or a visual of only the current page with your question"
                value={askScope}
                disabled={readingForAi}
                onChange={(e) => setAskScope(e.target.value)}
              >
                <option value="document">
                  {deck ? "Entire deck" : "Entire PDF"}
                </option>
                <option value="page">
                  {deck ? "Current slide" : "Current page"}
                </option>
              </select>
              <button
                disabled={!pdf || loading || busy || pending || readingForAi}
                onClick={() => void askAboutPdf()}
              >
                <ShellIcon name="sparkles" size={15} />
                {readingForAi ? "Reading PDF…" : "Ask Knot"}
              </button>
            </div>
          )}
        </div>
        <div className="pdf-controls">
          <div className="pdf-pagination" role="group" aria-label="PDF pages">
            <span>
              {deck ? "Slide" : "Page"} {pageNumber} of {pdf?.numPages ?? "–"}
            </span>
          </div>
          <div className="pdf-view-tools" role="group" aria-label="PDF zoom">
            <button
              aria-label="Zoom out PDF"
              title="Zoom out"
              disabled={zoom <= 0.5}
              onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
            >
              −
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button
              aria-label="Zoom in PDF"
              title="Zoom in"
              disabled={zoom >= 1.5}
              onClick={() => setZoom((value) => Math.min(1.5, value + 0.25))}
            >
              +
            </button>
            <button
              aria-label="Fit width"
              title="Fit width"
              onClick={() => setZoom(1)}
            >
              ↔
            </button>
          </div>
          {original && (
            <button
              className="pdf-open-original"
              title="Open the original deck in your app for .pptx files"
              onClick={() => {
                setError("");
                void slides
                  .openOriginal(original.original, source?.name ?? "")
                  .catch((e: unknown) =>
                    setError(`Couldn't open the original deck: ${String(e)}`),
                  );
              }}
            >
              <ShellIcon name="external" size={14} />
              Open in PowerPoint
            </button>
          )}
        </div>
      </div>
      {original?.converter === "libreoffice" && (
        <p className="pdf-ocr-note">
          Converted with LibreOffice. Some layouts may look different from
          PowerPoint.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && (
        <p className="pdf-toast" role="status">
          {notice}
          {notice === "Excerpt unlinked" && undoDetach.current && (
            <button
              disabled={pending}
              onClick={async () => {
                setPending(true);
                try {
                  await undoDetach.current?.();
                  undoDetach.current = undefined;
                  setNotice("Excerpt restored");
                } catch (e) {
                  setError(String(e));
                } finally {
                  setPending(false);
                }
              }}
            >
              Undo
            </button>
          )}
        </p>
      )}
      {loading && <p>Loading local PDF…</p>}
      {ready && !hasText && (
        <p>
          {getOcrPreferences().enabled && getWorkspaceSearchEnabled()
            ? "Knot hasn't read the text on this scanned page yet. It reads scanned pages in the background while you're away."
            : "This page has no selectable text. To read scanned pages, turn on Search my workspace and Read text in images and scans in Settings → AI."}
        </p>
      )}
      {ready && scanned === "read" && (
        <p className="pdf-ocr-note">
          Text on this page was read from the scan and may contain errors.
        </p>
      )}
      {draft && (
        <div ref={floating} className="pdf-selection-panel" style={position}>
          {preview && (
            <>
              <div className="pdf-selection-label">
                Card preview · not saved
              </div>
              <div
                className="pdf-card-preview"
                aria-label="Highlight card preview"
                style={{
                  fontFamily: editorFontFamily(getEditorPreferences()),
                  fontSize: getEditorPreferences().fontSize,
                }}
              >
                <blockquote className="pdf-quote">{draft.quote}</blockquote>
                <button
                  className="pdf-card-source"
                  onClick={() => {
                    const highlight = pageFrame?.querySelector<HTMLElement>(
                      ".pdf-highlight.active",
                    );
                    const scroller = pageFrame?.parentElement;
                    if (highlight && scroller)
                      scroller.scrollTop =
                        scroller.scrollTop +
                        highlight.getBoundingClientRect().top -
                        scroller.getBoundingClientRect().top -
                        scroller.clientHeight / 2;
                  }}
                >
                  {pdfSourceLabel(draft)}
                </button>
              </div>
            </>
          )}
          <div
            className="pdf-selection-actions"
            role="group"
            aria-label="Selected passage actions"
          >
            {saved?.blockId &&
              citations.some((c) => c.blockId === saved.blockId) && (
                <button
                  disabled={busy || pending}
                  onClick={async () => {
                    if (!saved.blockId) return;
                    setPending(true);
                    try {
                      await onReplace(saved.blockId, draft);
                      setSaved({
                        ...draft,
                        id: undefined,
                        blockId: saved.blockId,
                      });
                      setDraft(null);
                      setRects([]);
                      setNotice("Excerpt replaced");
                    } catch (e) {
                      setError(String(e));
                    } finally {
                      setPending(false);
                    }
                  }}
                >
                  Replace excerpt
                </button>
              )}
            {duplicate && (
              <button onClick={() => onJump(duplicate.noteId)}>
                View existing card
              </button>
            )}
            <button
              className="pdf-save-highlight"
              aria-label="Create highlight card"
              disabled={!draft || !ready || busy || pending}
              onClick={() => {
                if (!draft) return;
                setPending(true);
                setError("");
                void onCreate(draft)
                  .then(() => {
                    setSaved(draft);
                    setDraft(null);
                    setRects([]);
                    setNotice("Highlight card saved.");
                  })
                  .catch((e) =>
                    setError(
                      `Card not saved: ${String(e)}. Retry Create highlight card to save the same card.`,
                    ),
                  )
                  .finally(() => setPending(false));
              }}
            >
              {pending
                ? "Saving…"
                : duplicate
                  ? "Create another card"
                  : "Highlight"}
            </button>
            <button
              aria-label="Preview highlight card"
              aria-expanded={preview}
              disabled={pending}
              onClick={() => setPreview(!preview)}
            >
              Preview
            </button>
            <button
              aria-label="Clear selection"
              title="Clear selection"
              disabled={!draft || pending || busy}
              onClick={() => {
                clearDraft();
                window.getSelection()?.removeAllRanges();
              }}
            >
              ×
            </button>
          </div>
        </div>
      )}
      {saved?.id &&
        saved.key === key &&
        saved.page === pageNumber &&
        marks.some((mark) => mark.active) &&
        !draft && (
          <button
            className="pdf-undo-highlight"
            disabled={busy || pending}
            onClick={() => {
              setPending(true);
              setError("");
              void onRemove(saved, saved.id)
                .then(() => {
                  setSaved(null);
                  setRects([]);
                  setDraft(null);
                  setNotice(
                    "Highlight card removed. Document Undo restores it.",
                  );
                })
                .catch((e) =>
                  setError(`Could not remove highlight: ${String(e)}`),
                )
                .finally(() => setPending(false));
            }}
          >
            {saved.id ? "Undo saved highlight" : "Remove this highlight card"}
          </button>
        )}
      {!!destinations.length && !draft && (
        <aside
          ref={popover}
          className="pdf-reference-list"
          onKeyDown={(e) => {
            if (e.key === "Escape") closeRefs();
          }}
        >
          <header>
            <span>References</span>
            <button aria-label="Dismiss references" onClick={closeRefs}>
              <ShellIcon name="close" size={14} />
            </button>
          </header>
          {destinations.map((c) => (
            <div className="pdf-reference-row" key={c.noteId}>
              <button
                className="pdf-reference-jump"
                title={c.label}
                onClick={() => {
                  onJump(c.noteId);
                  closeRefs();
                }}
              >
                <i
                  style={{ background: citationColor(pageMarks.indexOf(c)) }}
                />
                <span>
                  <small>
                    {c.noteId.startsWith("pdf-")
                      ? "Highlight card"
                      : "Notebook note"}
                  </small>
                  {c.label}
                </span>
              </button>
              <button
                className="pdf-reference-clear"
                aria-label="Unlink excerpt and clear highlight"
                title="Unlink excerpt and clear highlight"
                disabled={pending || busy}
                onClick={async () => {
                  setPending(true);
                  try {
                    undoDetach.current = await onDetach(c);
                    setSaved(null);
                    closeRefs();
                    setNotice("Excerpt unlinked");
                  } catch (e) {
                    setError(String(e));
                  } finally {
                    setPending(false);
                  }
                }}
              >
                <ShellIcon name="eraser" size={16} />
              </button>
            </div>
          ))}
        </aside>
      )}
      <div
        className="pdf-scroll"
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          if (rememberAs && key && restoredView.current && el.scrollHeight)
            saveView(rememberAs, {
              key,
              zoom,
              ratio: el.scrollTop / el.scrollHeight,
            });
          const pages = el.children;
          if (!pages.length) return;
          const target = el.getBoundingClientRect().top + el.clientHeight / 2;
          let low = 0,
            high = pages.length - 1;
          while (low < high) {
            const mid = Math.floor((low + high) / 2);
            if (pages[mid].getBoundingClientRect().bottom < target)
              low = mid + 1;
            else high = mid;
          }
          setPageNumber(
            el.scrollTop <= 1
              ? 1
              : el.scrollTop + el.clientHeight >= el.scrollHeight - 1
                ? pages.length
                : low + 1,
          );
        }}
      >
        {pdf &&
          Array.from({ length: pdf.numPages }, (_, index) => {
            const number = index + 1;
            const activePage = number === pageNumber;
            return (
              <ReaderPage
                key={key + ":" + number}
                pdf={pdf}
                pageNumber={number}
                readerWidth={readerWidth}
                zoom={zoom}
                active={activePage}
                ocrKey={key}
                onStatus={pageStatus}
                onPointerDownCapture={() => setPageNumber(number)}
                onPointerLeave={cancelHover}
                onPointerMove={(e) => {
                  if (!activePage || pinned || draft || e.buttons) return;
                  const index = hitPassage(
                    e.currentTarget,
                    e.clientX,
                    e.clientY,
                  );
                  const ids =
                    marks[index]?.refs.map((i) =>
                      JSON.stringify([pageMarks[i].noteId, pageMarks[i].rects]),
                    ) ?? [];
                  const target = JSON.stringify(ids);
                  if (!ids.length || target === JSON.stringify(referenceIds)) {
                    cancelHover();
                  } else if (target !== hoverTarget.current) {
                    cancelHover();
                    hoverTarget.current = target;
                    hoverTimer.current = setTimeout(
                      () => showRefs(index, false),
                      150,
                    );
                  }
                }}
                onClick={(e) => {
                  if (draft || !window.getSelection()?.isCollapsed) return;
                  const i = hitPassage(e.currentTarget, e.clientX, e.clientY);
                  if (i >= 0) showRefs(i, true);
                  else closeRefs();
                }}
                onMouseUp={captureSelection}
                onKeyUp={captureSelection}
              >
                {!activePage &&
                  citations
                    .filter((c) => c.key === key && c.page === number)
                    .flatMap((c) =>
                      c.rects.map((r, i) => (
                        <span
                          key={JSON.stringify([c.noteId, r, i])}
                          className="pdf-highlight"
                          style={{
                            left: `${r[0] * 100}%`,
                            top: `${r[1] * 100}%`,
                            width: `${r[2] * 100}%`,
                            height: `${r[3] * 100}%`,
                          }}
                        />
                      )),
                    )}
                {activePage &&
                  marks.flatMap((mark, group) =>
                    mark.rects.map((r, i) => (
                      <span
                        key={`${group}-${i}`}
                        data-count={
                          new Set(mark.refs.map((i) => pageMarks[i].noteId))
                            .size > 1
                            ? new Set(mark.refs.map((i) => pageMarks[i].noteId))
                                .size
                            : undefined
                        }
                        tabIndex={mark.refs.length ? 0 : undefined}
                        role={mark.refs.length ? "button" : undefined}
                        aria-label={
                          mark.refs.length
                            ? "Show passage references"
                            : undefined
                        }
                        onFocus={() => showRefs(group, false)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            showRefs(group, true);
                            root.current
                              ?.querySelector<HTMLButtonElement>(
                                ".pdf-reference-jump",
                              )
                              ?.focus();
                          }
                        }}
                        className={`pdf-highlight${mark.active ? " active" : ""}`}
                        style={{
                          background: mark.color,
                          borderBottom:
                            new Set(mark.refs.map((i) => pageMarks[i].noteId))
                              .size > 1
                              ? "2px dotted #555"
                              : undefined,
                          outline:
                            mark.active && !draft
                              ? "1px solid #474747"
                              : undefined,
                          left: `${r[0] * 100}%`,
                          top: `${r[1] * 100}%`,
                          width: `${r[2] * 100}%`,
                          height: `${r[3] * 100}%`,
                        }}
                      />
                    )),
                  )}
              </ReaderPage>
            );
          })}
      </div>
    </section>
  );
}

function ReaderPage({
  pdf,
  pageNumber,
  readerWidth,
  zoom,
  active,
  ocrKey,
  onStatus,
  children,
  ...events
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  readerWidth: number;
  zoom: number;
  active: boolean;
  /** The PDF's attachment key, to find text OCR read from a scanned page. */
  ocrKey?: string;
  onStatus: (
    ready: boolean,
    hasText: boolean,
    scanned?: "read" | "unread",
  ) => void;
} & React.HTMLAttributes<HTMLDivElement>) {
  const frame = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [ready, setReady] = useState(false);
  const [hasText, setHasText] = useState(false);
  const [scanned, setScanned] = useState<"read" | "unread" | undefined>();
  const [error, setError] = useState("");
  useEffect(() => {
    const el = frame.current!;
    const observer = new IntersectionObserver(
      ([entry]) => setNear(entry.isIntersecting),
      { root: el.parentElement, rootMargin: "100% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (active) onStatus(near && ready, hasText, scanned);
  }, [active, near, ready, hasText, scanned, onStatus]);
  useEffect(() => {
    if (!near || !frame.current || !layer.current) return;
    let cancelled = false;
    let render:
      | ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>
      | undefined;
    let text: TextLayer | undefined;
    const canvas = document.createElement("canvas");
    const container = layer.current;
    frame.current.prepend(canvas);
    container.replaceChildren();
    setReady(false);
    setError("");
    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const unscaled = page.getViewport({ scale: 1 });
        const scale = (readerWidth / unscaled.width) * zoom;
        const viewport = page.getViewport({ scale });
        if (
          !Number.isFinite(viewport.width * viewport.height) ||
          viewport.width * viewport.height > 4_000_000 ||
          viewport.height > 8000
        )
          throw new Error("PDF page exceeds the reader rendering limit");
        const pixelRatio = Math.min(
          window.devicePixelRatio || 1,
          Math.sqrt(3_900_000 / (viewport.width * viewport.height)),
        );
        canvas.width = Math.ceil(viewport.width * pixelRatio);
        canvas.height = Math.ceil(viewport.height * pixelRatio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        frame.current!.style.aspectRatio = String(
          unscaled.width / unscaled.height,
        );
        container.style.setProperty("--total-scale-factor", String(scale));
        render = page.render({
          canvas,
          viewport,
          transform: [pixelRatio, 0, 0, pixelRatio, 0, 0],
        });
        await render.promise;
        const content = await page.getTextContent();
        if (cancelled) return;
        const layered = content.items.some(
          (item) => "str" in item && item.str.trim(),
        );
        if (!layered && ocrKey) {
          // A scan: build the text layer from lines OCR already read.
          const [lines] = await lookupOcr([{ key: ocrKey, page: pageNumber }]);
          if (cancelled) return;
          setScanned(lines?.length ? "read" : "unread");
          if (lines?.length) {
            ocrTextLayer(container, lines, unscaled, viewport);
            setHasText(true);
            setReady(true);
            return;
          }
        } else setScanned(undefined);
        setHasText(layered);
        text = new TextLayer({
          textContentSource: content,
          container,
          viewport,
        });
        await text.render();
        if (!cancelled) setReady(true);
      } catch (e) {
        if (!cancelled) setError(`Unable to render page: ${String(e)}`);
      }
    })();
    return () => {
      cancelled = true;
      render?.cancel();
      text?.cancel();
      canvas.remove();
      container.replaceChildren();
    };
  }, [near, pdf, pageNumber, readerWidth, zoom, ocrKey]);

  return (
    <div
      {...events}
      className="pdf-page"
      ref={frame}
      data-page={pageNumber}
      style={{ width: readerWidth * zoom }}
    >
      <div ref={layer} className="textLayer" />
      {error && <p role="alert">{error}</p>}
      {children}
    </div>
  );
}

/**
 * An invisible, selectable text layer from OCR lines (boxes in page
 * fractions), laid out like pdf.js's so selection, copy and highlight cards
 * work as on text PDFs. Each line is stretched to its box.
 */
function ocrTextLayer(
  container: HTMLDivElement,
  lines: OcrLine[],
  unscaled: { width: number; height: number },
  viewport: { width: number; height: number },
) {
  const measure = document.createElement("canvas").getContext("2d");
  const family = "sans-serif";
  container.replaceChildren();
  for (const line of lines) {
    const height = line.h * unscaled.height;
    const fontPx = line.h * viewport.height;
    const span = document.createElement("span");
    span.textContent = line.text;
    span.setAttribute("role", "presentation");
    span.style.left = `${line.x * 100}%`;
    span.style.top = `${line.y * 100}%`;
    span.style.fontFamily = family;
    span.style.setProperty("--font-height", `${height}px`);
    if (measure) {
      measure.font = `${fontPx}px ${family}`;
      const natural = measure.measureText(line.text).width;
      if (natural > 0)
        span.style.setProperty(
          "--scale-x",
          String((line.w * viewport.width) / natural),
        );
    }
    container.append(span, document.createElement("br"));
  }
}
