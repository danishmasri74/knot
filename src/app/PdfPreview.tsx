import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ShellIcon } from "./ShellIcon";
import {
  shortPdfName,
  type CitedPdf,
  type PdfCitation,
} from "../services/pdf-citations";

/** One page drawn small, or why it can't be. */
function useThumbnail(pdf: CitedPdf, page: number, active: boolean) {
  const [state, setState] = useState<
    { url: string } | { missing: number } | { failed: true } | undefined
  >();
  useEffect(() => {
    if (!active) return;
    let live = true;
    void import("../services/pdf-input").then(
      ({ renderPdfThumbnail, PdfPageMissing }) =>
        renderPdfThumbnail(pdf.key, page).then(
          (url) => live && setState({ url }),
          (error: unknown) =>
            live &&
            setState(
              error instanceof PdfPageMissing
                ? { missing: error.pages }
                : { failed: true },
            ),
        ),
    );
    return () => {
      live = false;
    };
  }, [pdf.key, page, active]);
  return state;
}

function unitOf(label: string) {
  return label.includes("slide") ? "slide" : "page";
}

/**
 * A "(slide 3)" citation: opens the file at that page, and on hover or
 * focus shows a small preview of the page rendered from the user's file.
 */
export function PdfRef({
  cited,
  onOpen,
}: {
  cited: PdfCitation;
  onOpen: (pdf: CitedPdf, page: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ left: number; top: number; above: boolean }>();
  const button = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const id = useId();
  const thumb = useThumbnail(cited.pdf, cited.page, open);
  const show = (delay: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const rect = button.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 312;
      const above = window.innerHeight - rect.bottom < 260 && rect.top > 260;
      setPlace({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: above ? rect.top - 6 : rect.bottom + 6,
        above,
      });
      setOpen(true);
    }, delay);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const unit = unitOf(cited.label);
  return (
    <>
      <button
        ref={button}
        type="button"
        className="ask-pdf-ref"
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => show(300)}
        onMouseLeave={hide}
        onFocus={() => show(0)}
        onBlur={hide}
        onKeyDown={(event) => event.key === "Escape" && hide()}
        onClick={() => {
          hide();
          onOpen(cited.pdf, cited.page);
        }}
      >
        <ShellIcon name="pdf" />
        {cited.label}
      </button>
      {open &&
        place &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            className="ask-pdf-preview"
            style={{
              left: place.left,
              top: place.top,
              transform: place.above ? "translateY(-100%)" : undefined,
            }}
          >
            <div className="ask-pdf-preview-page">
              {thumb && "url" in thumb ? (
                <img src={thumb.url} alt={`${unit} ${cited.page} of ${cited.pdf.name}`} />
              ) : thumb && "missing" in thumb ? (
                <span>
                  This file has no {unit} {cited.page} ({thumb.missing} in all).
                </span>
              ) : thumb ? (
                <span>Preview unavailable</span>
              ) : (
                <span className="ask-thinking">
                  Loading<span>…</span>
                </span>
              )}
            </div>
            <div className="ask-pdf-preview-name">
              <ShellIcon name="pdf" />
              <span>{shortPdfName(cited.pdf.name)}</span>
              <span>
                · {unit} {cited.page}
              </span>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/** Up to six cited pages under an answer, in citation order. */
export function SlidesCited({
  cited,
  onOpen,
}: {
  cited: PdfCitation[];
  onOpen: (pdf: CitedPdf, page: number) => void;
}) {
  if (!cited.length) return null;
  const several = new Set(cited.map((c) => c.pdf.key)).size > 1;
  const slides = cited.some((c) => c.label.includes("slide"));
  return (
    <div className="ask-slides-cited">
      <div className="ask-slides-cited-title">
        {slides ? "Slides cited" : "Pages cited"}
      </div>
      <div className="ask-slides-cited-list">
        {cited.map((c) => (
          <SlideThumb
            key={`${c.pdf.key}:${c.page}`}
            cited={c}
            several={several}
            onOpen={onOpen}
          />
        ))}
      </div>
    </div>
  );
}

function SlideThumb({
  cited,
  several,
  onOpen,
}: {
  cited: PdfCitation;
  several: boolean;
  onOpen: (pdf: CitedPdf, page: number) => void;
}) {
  const thumb = useThumbnail(cited.pdf, cited.page, true);
  if (thumb && "missing" in thumb) return null;
  const unit = unitOf(cited.label);
  const caption = `${several ? `${shortPdfName(cited.pdf.name)} · ` : ""}${unit} ${cited.page}`;
  return (
    <button
      type="button"
      className="ask-slide-thumb"
      aria-label={`Open ${cited.pdf.name} at ${unit} ${cited.page}`}
      onClick={() => onOpen(cited.pdf, cited.page)}
    >
      <span className="ask-slide-thumb-page">
        {thumb && "url" in thumb ? <img src={thumb.url} alt="" /> : null}
      </span>
      <span className="ask-slide-thumb-caption">{caption}</span>
    </button>
  );
}
