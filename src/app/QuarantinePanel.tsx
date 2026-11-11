import { useState } from "react";
import type { OrphanCandidate, QuarantineCatalog } from "../services/workspace";

function formatSize(bytes: number) {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1048576
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1048576).toFixed(1)} MB`;
}

export function QuarantinePanel({
  candidates,
  catalog,
  busy,
  onMove,
  onRestore,
  onDispose,
  onRefresh,
}: {
  candidates: OrphanCandidate[] | null;
  catalog: QuarantineCatalog;
  busy: boolean;
  onMove: (selected: OrphanCandidate[]) => void;
  onRestore: (id: string) => void;
  onDispose: (entry: QuarantineCatalog["entries"][number]) => void;
  onRefresh: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const chosen = candidates?.filter((c) => selected.has(c.id)) ?? [];
  return (
    <section
      className="settings-page recovery-panel integrity-panel"
      aria-label="Orphan quarantine"
    >
      <div className="recovery-intro">
        <div>
          <h3>Unlinked files</h3>
          <p>
            Files not linked to your workspace. Keep them, or set them aside.
          </p>
        </div>
        <button
          disabled={busy}
          onClick={onRefresh}
          aria-label="Refresh quarantine"
        >
          Refresh
        </button>
      </div>
      {candidates === null ? (
        <p>
          Preview unavailable. Refresh to retry; recovery copies below remain
          available.
        </p>
      ) : (
        <>
          {!candidates.length && (
            <p className="recovery-empty">No unlinked files.</p>
          )}
          <div className="quarantine-files">
            {candidates.map((c) => (
              <label key={c.id}>
                <input
                  type="checkbox"
                  aria-label={`Select ${c.path}`}
                  checked={selected.has(c.id)}
                  disabled={
                    busy || (!selected.has(c.id) && selected.size >= 100)
                  }
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(c.id);
                    else next.delete(c.id);
                    setSelected(next);
                  }}
                />
                <span>
                  <code data-tooltip={c.path}>{c.path.split(/[\\/]/).pop()}</code>
                  <small>{formatSize(c.size)}</small>
                </span>
              </label>
            ))}
          </div>
          {!!candidates.length && (
            <div className="recovery-selection">
              <span>{chosen.length} selected</span>
              <button
                aria-label="Quarantine selected files"
                disabled={busy || !chosen.length}
                onClick={() => onMove(chosen)}
              >
                Set aside
              </button>
            </div>
          )}
        </>
      )}
      <div className="recovery-intro recovery-copies-heading">
        <div>
          <h3>Set-aside files</h3>
          <p>Restore a file or permanently delete its saved copy.</p>
        </div>
      </div>
      <p className="recovery-notice">
        These files stay on this device and aren’t included in backups.
      </p>
      {catalog.warnings.map((w) => (
        <p role="alert" key={w}>
          {w}
        </p>
      ))}
      {!catalog.entries.length && (
        <p className="recovery-empty">No files set aside.</p>
      )}
      {catalog.entries.map((entry) => (
        <div className="trash-row" key={entry.id}>
          <span>
            <strong className="recovery-filename" data-tooltip={entry.original}>
              {entry.original.split(/[\\/]/).pop()}
            </strong>
            <small>
              {formatSize(entry.size)} ·{" "}
              {new Date(entry.created_at).toLocaleString()}
            </small>
            <details>
              <summary>File details</summary>
              <code>{entry.original}</code>
              <small>Recovery ID: {entry.id}</small>
            </details>
          </span>
          <button
            disabled={busy}
            aria-label={`Restore file ${entry.original}`}
            onClick={() => onRestore(entry.id)}
          >
            Restore file
          </button>
          <button
            disabled={busy}
            aria-label={`Permanently delete copy ${entry.original}`}
            onClick={() => onDispose(entry)}
          >
            Permanently delete
          </button>
        </div>
      ))}
      <details className="recovery-explainer">
        <summary>How file recovery works</summary>
        <p>
          Setting files aside moves them into recovery storage on this disk. It
          does not free space. Files used by documents, including Trash, are
          protected and rechecked before moving.
        </p>
        <p>
          Restore keeps the recovery copy and never replaces an existing file.
          Permanent deletion cannot be undone. Backups and workspace moves
          exclude these files.
        </p>
        <p>
          Up to 100 files per action. Scans cover the attachment folder and one
          subfolder level; links and deeper folders are excluded.
        </p>
      </details>
    </section>
  );
}
