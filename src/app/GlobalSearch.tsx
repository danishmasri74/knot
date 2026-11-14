import { useEffect, useRef, useState } from "react";
import type { SearchReport } from "../features/editor/blocksuite/search";
import type { KnowledgeObject } from "../services/workspace";
import { ShellIcon } from "./ShellIcon";
import { Mascot } from "./Mascot";
import { LoadingRows } from "./LoadingRows";
import type { NoteView } from "../services/note-navigation";

type Result = SearchReport["results"][number];
export function GlobalSearch({
  search,
  recent,
  onClose,
  onOpen,
  onOpenOcr,
  preferredView,
  isResultOnCurrentPage,
}: {
  search: (query: string, signal: AbortSignal) => Promise<SearchReport>;
  recent: () => Promise<KnowledgeObject[]>;
  onClose: () => void;
  onOpen: (source: KnowledgeObject, noteId?: string, view?: NoteView, query?: string) => Promise<void>;
  /** Opens a match in text read from an image or a scanned page. */
  onOpenOcr?: (result: Result) => Promise<void>;
  preferredView: NoteView;
  isResultOnCurrentPage?: (result: Result) => boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const callbacks = useRef({ search, recent, onClose, onOpen, onOpenOcr });
  callbacks.current = { search, recent, onClose, onOpen, onOpenOcr };
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const [partial, setPartial] = useState(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    input.current?.focus();
    return () => {
      element.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setResults([]);
    setSelected(0);
    setError("");
    setPartial(false);
    const timer = setTimeout(
      async () => {
        try {
          const report = query.trim()
            ? await callbacks.current.search(query.trim(), controller.signal)
            : {
                results: (await callbacks.current.recent()).map((source) => ({
                  source,
                  excerpt: "",
                })),
                limited: false,
                skipped: [],
              };
          if (!cancelled) {
            setResults(report.results);
            setPartial(report.limited || report.skipped.length > 0);
          }
        } catch (cause) {
          if (!cancelled)
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          if (!cancelled) setLoading(false);
        }
      },
      query.trim() ? 250 : 0,
    );
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);
  useEffect(() => {
    dialog.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const open = async (result: Result, view?: NoteView) => {
    if (opening) return;
    setOpening(true);
    try {
      if (result.image || result.pdf) await callbacks.current.onOpenOcr?.(result);
      else
        await callbacks.current.onOpen(result.source, result.noteId,
          view ?? (isResultOnCurrentPage?.(result) ? "page" : undefined), query.trim());
    } catch (cause) {
      setError(String(cause));
    } finally {
      setOpening(false);
    }
  };
  const selectedView = results[selected] && isResultOnCurrentPage?.(results[selected])
    ? "page" : preferredView;
  return (
    <dialog
      ref={dialog}
      className="global-search"
      aria-label="Search workspace"
      onCancel={(event) => {
        event.preventDefault();
        if (!opening) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !opening) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <div className="global-search-input">
        <ShellIcon name="search" />
        <input
          ref={input}
          role="combobox"
          aria-label="Search workspace"
          aria-controls="global-search-results"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-activedescendant={
            results[selected] ? `search-result-${selected}` : undefined
          }
          placeholder="Search your workspace…"
          value={query}
          maxLength={200}
          disabled={opening}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setSelected((index) =>
                results.length
                  ? (index +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      results.length) %
                    results.length
                  : 0,
              );
            } else if (event.key === "Enter" && results[selected] && !loading) {
              event.preventDefault();
              void open(results[selected]);
            }
          }}
        />
        <button aria-label="Close search" disabled={opening} onClick={onClose}>
          <kbd>Esc</kbd>
        </button>
      </div>
      <div className="global-search-results">
        <div className="global-search-caption" role="status">
          {loading
            ? "Searching…"
            : query.trim()
              ? `${results.length} results`
              : "Recently updated"}
        </div>
        {error && <p role="alert">{error}</p>}
        {loading && <LoadingRows label="Loading search results" />}
        {!loading && !error && !results.length && (
          <div className="mascot-empty-state search-empty-state">
            <Mascot mood={query.trim() ? "search" : "library"} />
            <p>{query.trim() ? "No results found." : "No recent notebooks yet."}</p>
          </div>
        )}
        {partial && (
          <p role="status">
            Some saved content could not be searched. Results may be incomplete.
          </p>
        )}
        <div
          id="global-search-results"
          role="listbox"
          aria-label="Search results"
          aria-busy={loading}
        >
          {results.map((result, index) => (
            <button
              key={`${result.source.id}:${result.noteId ?? ""}:${result.image?.blockId ?? ""}:${result.pdf ? `${result.pdf.key}#${result.pdf.page}` : ""}`}
              id={`search-result-${index}`}
              role="option"
              aria-label={
                result.noteTitle
                  ? `${result.noteTitle} — ${result.source.title}`
                  : result.source.title
              }
              aria-selected={selected === index}
              tabIndex={-1}
              disabled={opening}
              onMouseMove={() => setSelected(index)}
              onClick={() => void open(result)}
            >
              <ShellIcon
                name={
                  result.image
                    ? "image"
                    : result.pdf
                      ? "pdf"
                      : result.noteId
                        ? "note"
                        : "notebook"
                }
              />
              <span>
                <strong>{result.noteTitle || result.source.title}</strong>
                {(result.noteId || result.image || result.pdf) && (
                  <small>{result.source.title}</small>
                )}
                {result.excerpt && <small>{result.excerpt}</small>}
              </span>
              {selected === index && (
                <span className="search-enter" aria-hidden="true">
                  ↵
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      <footer>
        {results[selected]?.noteId && !loading && (
          <button
            disabled={opening}
            onClick={() => void open(results[selected], selectedView === "page" ? "edgeless" : "page")}
          >
            {selectedView === "page" ? "Show on canvas" : "Open in page"}
          </button>
        )}
        <span>
          <kbd>↑</kbd> <kbd>↓</kbd> Navigate
        </span>
        <span>
          <kbd>Enter</kbd> Open
        </span>
      </footer>
    </dialog>
  );
}
