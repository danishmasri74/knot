import { useEffect, useRef, useState } from "react";
import { attachments } from "../services/workspace";
import type {
  PdfHighlight,
  PdfLocation,
  PdfRect,
  PdfSource,
} from "../features/editor/blocksuite/pdf-highlights";
import { validatePdfHighlight } from "../features/editor/blocksuite/pdf-highlights";
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

export function PdfReader({
  sources,
  initial,
  busy,
  onCreate,
  onClose,
}: {
  sources: PdfSource[];
  initial?: PdfLocation;
  busy: boolean;
  onCreate: (highlight: PdfHighlight) => Promise<void>;
  onClose: () => void;
}) {
  const [key, setKey] = useState(initial?.key ?? sources[0]?.key ?? "");
  const [pageNumber, setPageNumber] = useState(initial?.page ?? 1);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [hasText, setHasText] = useState(false);
  const [draft, setDraft] = useState<PdfHighlight | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [rects, setRects] = useState<PdfRect[]>(initial?.rects ?? []);
  const layer = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const source = sources.find((entry) => entry.key === key);
  useEffect(() => {
    let cancelled = false;
    let passwordRequired = false;
    let task: ReturnType<typeof getDocument> | undefined;
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
        const base = import.meta.env.DEV
          ? "/node_modules/pdfjs-dist/"
          : "/pdfjs/";
        task = getDocument({
          data: new Uint8Array(bytes),
          cMapUrl: `${base}cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${base}standard_fonts/`,
          wasmUrl: `${base}wasm/`,
          stopAtErrors: true,
        });
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
    if (!pdf || !frame.current || !layer.current) return;
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
    setDraft(null);
    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const unscaled = page.getViewport({ scale: 1 });
        const scale = Math.min(1.5, 900 / unscaled.width);
        const viewport = page.getViewport({ scale });
        if (
          !Number.isFinite(viewport.width * viewport.height) ||
          viewport.width * viewport.height > 4_000_000 ||
          viewport.height > 8000
        )
          throw new Error("PDF page exceeds the reader rendering limit");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        frame.current!.style.width = `${viewport.width}px`;
        frame.current!.style.height = `${viewport.height}px`;
        container.style.setProperty("--total-scale-factor", String(scale));
        render = page.render({ canvas, viewport });
        await render.promise;
        const content = await page.getTextContent();
        if (cancelled) return;
        setHasText(
          content.items.some((item) => "str" in item && item.str.trim()),
        );
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
  }, [pdf, pageNumber]);

  useEffect(() => {
    if (ready && initial?.key === key && initial.page === pageNumber)
      frame.current
        ?.querySelector(".pdf-highlight")
        ?.scrollIntoView({ block: "center", inline: "nearest" });
  }, [ready, initial, key, pageNumber]);

  function captureSelection() {
    if (!ready || pending || busy || !source) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed || !layer.current)
      return;
    const range = selection.getRangeAt(0);
    if (
      !layer.current.contains(range.startContainer) ||
      !layer.current.contains(range.endContainer)
    )
      return;
    const bounds = layer.current.getBoundingClientRect();
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
      setDraft(value);
      setRects(selected);
      setNotice("");
      setError("");
    } catch (e) {
      setDraft(null);
      setError(String(e));
    }
  }

  return (
    <section className="pdf-reader" aria-label="PDF reader">
      <div className="actions">
        <strong>PDF reader</strong>
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
        <button
          disabled={busy || pending || !pdf || pageNumber <= 1}
          onClick={() => {
            setPageNumber(pageNumber - 1);
            setRects([]);
          }}
        >
          Previous PDF page
        </button>
        <span>
          Page {pageNumber}
          {pdf ? ` of ${pdf.numPages}` : ""}
        </span>
        <button
          disabled={busy || pending || !pdf || pageNumber >= pdf.numPages}
          onClick={() => {
            setPageNumber(pageNumber + 1);
            setRects([]);
          }}
        >
          Next PDF page
        </button>
        <button disabled={busy || pending} onClick={onClose}>
          Close PDF reader
        </button>
      </div>
      <p>
        Select text on this page, then create a highlight card in the current
        document.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {loading && <p>Loading local PDF…</p>}
      {ready && !hasText && (
        <p>This page has no selectable text. OCR is not supported.</p>
      )}
      <button
        disabled={!draft || !ready || busy || pending}
        onClick={() => {
          if (!draft) return;
          setPending(true);
          setError("");
          void onCreate(draft)
            .then(() => {
              setDraft(null);
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
        Create highlight card
      </button>
      {draft && <blockquote className="pdf-quote">{draft.quote}</blockquote>}
      <div className="pdf-scroll">
        <div
          ref={frame}
          className="pdf-page"
          onMouseUp={captureSelection}
          onKeyUp={captureSelection}
        >
          <div ref={layer} className="textLayer" />
          {rects.map((r, i) => (
            <span
              key={i}
              className="pdf-highlight"
              style={{
                left: `${r[0] * 100}%`,
                top: `${r[1] * 100}%`,
                width: `${r[2] * 100}%`,
                height: `${r[3] * 100}%`,
              }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
