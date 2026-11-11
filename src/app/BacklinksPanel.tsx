import type { BacklinkReport } from "../features/editor/blocksuite/backlinks";
import type { KnowledgeObject } from "../services/workspace";
import { ShellIcon } from "./ShellIcon";

export function BacklinksPanel({
  report,
  busy,
  onRefresh,
  onOpen,
}: {
  report: BacklinkReport | null;
  busy: boolean;
  onRefresh: () => void;
  onOpen: (source: KnowledgeObject) => void;
}) {
  return (
    <section className="backlinks-panel" aria-label="Backlinks">
      <header className="backlinks-header">
        <div>
          <p>Notebooks that link here</p>
        </div>
        <button
          type="button"
          className="backlinks-refresh"
          aria-label="Refresh backlinks"
          data-tooltip="Refresh backlinks"
          disabled={busy}
          onClick={onRefresh}
        >
          <ShellIcon name="refresh" size={16} />
        </button>
      </header>
      {!report ? (
        <p className="backlinks-state" role="status">
          {busy
            ? "Scanning saved documents…"
            : "Scan unavailable. Refresh to retry."}
        </p>
      ) : (
        <>
          {report.unreadable.length > 0 && (
            <p className="backlinks-warning" role="status">
              Partial results: could not read {report.unreadable.length} saved
              document(s):{" "}
              {report.unreadable.map((row) => row.title).join(", ")}. Use Check
              workspace for details.
            </p>
          )}
          {report.sources.length ? (
            <ul className="backlinks-list">
              {report.sources.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    aria-label={row.title}
                    disabled={busy}
                    onClick={() => onOpen(row)}
                    data-tooltip={row.title}
                  >
                    <span className="backlinks-object-icon">
                      <ShellIcon name="notebook" size={18} />
                    </span>
                    <span className="backlinks-source">
                      <span>{row.title}</span>
                    </span>
                    <ShellIcon name="external" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="backlinks-state" role="status">
              <ShellIcon name="backlinks" size={22} />
              <p>
                No backlinks found
                {report.unreadable.length ? " in readable documents" : ""}.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
