import type { SearchReport } from "../features/editor/blocksuite/search";
import type { KnowledgeObject } from "../services/workspace";

export function SearchPanel({
  report,
  busy,
  onRefresh,
  onOpen,
}: {
  report: SearchReport | null;
  busy: boolean;
  onRefresh: () => void;
  onOpen: (source: KnowledgeObject) => void;
}) {
  return (
    <section className="backlinks-panel" aria-label="Body search results">
      <div className="actions">
        <strong>Title & body search</strong>
        <button disabled={busy} onClick={onRefresh}>
          Refresh search
        </button>
      </div>
      <p>
        Uses the current collection filter. Searches titles,
        paragraphs/headings, lists and code. Excludes attachment contents,
        tables, canvas-only text and shared previews.
      </p>
      {!report ? (
        <p>
          {busy
            ? "Searching saved documents…"
            : "Search unavailable. Refresh to retry."}
        </p>
      ) : (
        <>
          <p>
            Saved content scanned at{" "}
            {new Date(report.checkedAt).toLocaleTimeString()}. Refresh after
            edits.
          </p>
          {(report.limited || report.skipped.length > 0) && (
            <p role="status">
              Partial results:{" "}
              {report.limited
                ? "Only the first 200 filtered documents were searched. "
                : ""}
              {report.skipped.length > 0
                ? `${report.skipped.length} bodies skipped (unreadable, timeout or size limit): ${report.skipped.join(", ")}. Their titles were still searched.`
                : ""}
            </p>
          )}
          {report.results.length ? (
            <ul>
              {report.results.map(({ source, excerpt }) => (
                <li key={source.id}>
                  <button
                    disabled={busy}
                    data-tooltip={source.id}
                    onClick={() => onOpen(source)}
                  >
                    {source.title}
                  </button>
                  <p>{excerpt}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p>No matches in searched content.</p>
          )}
        </>
      )}
    </section>
  );
}
