import { useState } from "react";
import type { OrphanCandidate, QuarantineCatalog } from "../services/workspace";

export function QuarantinePanel({
  candidates,
  catalog,
  busy,
  onMove,
  onRestore,
  onDispose,
  onRefresh,
  onClose,
}: {
  candidates: OrphanCandidate[] | null;
  catalog: QuarantineCatalog;
  busy: boolean;
  onMove: (selected: OrphanCandidate[]) => void;
  onRestore: (id: string) => void;
  onDispose: (entry: QuarantineCatalog["entries"][number]) => void;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const chosen = candidates?.filter((c) => selected.has(c.id)) ?? [];
  return (
    <section
      className="recovery-panel integrity-panel"
      aria-label="Orphan quarantine"
    >
      <h2>Orphan quarantine</h2>
      <p>
        Move selected unindexed files out of the asset folder into this
        workspace’s quarantine. Every file is rechecked before moving. Files
        matching any indexed attachment name or content hash are protected,
        including Trash assets.
      </p>
      <p>
        Quarantine keeps the bytes on this disk; it does not free disk space.
        Backups and workspace relocation do not include quarantine. Restore
        copies to their original locations without replacing existing files and
        retains the quarantine copies.
      </p>
      <button disabled={busy} onClick={onRefresh}>
        Refresh quarantine
      </button>{" "}
      <button disabled={busy} onClick={onClose}>
        Close quarantine
      </button>
      <h3>Eligible unindexed files</h3>
      {candidates === null ? (
        <p>
          Preview unavailable. Refresh to retry; recovery copies below remain
          available.
        </p>
      ) : (
        <>
          <p>
            {candidates.length} eligible files ·{" "}
            {candidates.reduce((sum, c) => sum + c.size, 0).toLocaleString()}{" "}
            bytes total
          </p>
          <p>
            The scan covers ordinary files directly in assets and one subfolder
            deep. Links, deeper folders, unsupported names and indexed
            duplicates are excluded.
          </p>
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
                  <code>{c.path}</code> · {c.size.toLocaleString()} bytes
                </span>
              </label>
            ))}
          </div>
          <p>
            {chosen.length} selected ·{" "}
            {chosen.reduce((sum, c) => sum + c.size, 0).toLocaleString()} bytes
            (maximum 100 files per operation)
          </p>
          <button
            disabled={busy || !chosen.length}
            onClick={() => onMove(chosen)}
          >
            Quarantine selected files
          </button>
        </>
      )}
      <h3>Recovery copies</h3>
      <p>
        Permanently delete removes one recovery copy from disk and cannot be
        undone. Any restored original stays in place. Copies matching the
        current attachment index are protected; damaged or incomplete copies are
        retained.
      </p>
      {catalog.warnings.map((w) => (
        <p role="alert" key={w}>
          {w}
        </p>
      ))}
      {!catalog.entries.length && <p>No complete recovery copies.</p>}
      {catalog.entries.map((entry) => (
        <div className="trash-row" key={entry.id}>
          <span>
            <strong>{entry.original}</strong>
            <small>
              {entry.size.toLocaleString()} bytes ·{" "}
              {new Date(entry.created_at).toLocaleString()}
            </small>
            <small>Recovery ID: {entry.id}</small>
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
    </section>
  );
}
