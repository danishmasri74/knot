import type { BacklinkReport } from "../features/editor/blocksuite/backlinks";
import type { KnowledgeObject } from "../services/workspace";

export function BacklinksPanel({
  report,
  busy,
  onRefresh,
  onOpen,
  onClose,
}: {
  report: BacklinkReport | null;
  busy: boolean;
  onRefresh: () => void;
  onOpen: (source: KnowledgeObject) => void;
  onClose: () => void;
}) {
  return (
    <section className="backlinks-panel" aria-label="Backlinks">
      <div className="actions">
        <strong>Backlinks</strong>
        <button disabled={busy} onClick={onRefresh}>
          Refresh backlinks
        </button>
        <button disabled={busy} onClick={onClose}>
          Close backlinks
        </button>
      </div>
      <p>
        Other live documents linking here. Results reflect the last scan;
        refresh after edits.
      </p>
      {!report ? (
        <p>
          {busy
            ? "Scanning saved documents…"
            : "Scan unavailable. Refresh to retry."}
        </p>
      ) : (
        <>
          {report.unreadable.length > 0 && (
            <p role="status">
              Partial results: could not read {report.unreadable.length} saved
              document(s):{" "}
              {report.unreadable.map((row) => row.title).join(", ")}. Use Check
              workspace for details.
            </p>
          )}
          {report.sources.length ? (
            <ul>
              {report.sources.map((row) => (
                <li key={row.id}>
                  <button
                    disabled={busy}
                    onClick={() => onOpen(row)}
                    title={row.id}
                  >
                    {row.title}
                  </button>{" "}
                  <small>
                    {row.kind === "whiteboard" ? "Whiteboard" : "Note"}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p>
              No backlinks found
              {report.unreadable.length ? " in readable documents" : ""}.
            </p>
          )}
        </>
      )}
    </section>
  );
}
