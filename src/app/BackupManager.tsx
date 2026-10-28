import type { BackupEntry } from "../services/workspace";

export function BackupManager({
  entries,
  busy,
  available,
  onAction,
  onClose,
}: {
  entries: BackupEntry[];
  busy: boolean;
  available: boolean;
  onAction: (
    action: "create" | "refresh" | "validate" | "restore" | "delete",
    id?: string,
  ) => void;
  onClose: () => void;
}) {
  return (
    <section className="recovery-panel" aria-label="Backup management">
      <h2>Backups</h2>
      <p>
        Managed archives from all your workspaces. Restoring opens a separate
        workspace and preserves the original. These local copies share this
        disk; use Back up workspace to save a copy elsewhere.
      </p>
      <button disabled={busy || !available} onClick={() => onAction("create")}>
        Create backup
      </button>{" "}
      <button disabled={busy} onClick={() => onAction("refresh")}>
        Refresh backups
      </button>{" "}
      <button disabled={busy} onClick={onClose}>
        Close backups
      </button>
      {!entries.length && <p>No managed backups yet.</p>}
      {entries.map((entry) => (
        <div className="trash-row backup-row" key={entry.id}>
          <span>
            <strong>{entry.id}</strong>
            <small>
              {new Date(entry.modified).toLocaleString()} ·{" "}
              {entry.size.toLocaleString()} bytes
            </small>
          </span>
          <div className="backup-actions">
            <button
              disabled={busy}
              onClick={() => onAction("validate", entry.id)}
            >
              Verify archive
            </button>
            <button
              disabled={busy}
              onClick={() => onAction("restore", entry.id)}
            >
              Restore archive
            </button>
            <button
              disabled={busy}
              onClick={() => onAction("delete", entry.id)}
            >
              Delete archive
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
