import type { BackupEntry } from "../services/workspace";

export function BackupManager({
  entries,
  busy,
  available,
  onAction,
}: {
  entries: BackupEntry[];
  busy: boolean;
  available: boolean;
  onAction: (
    action: "create" | "refresh" | "validate" | "restore" | "delete",
    id?: string,
  ) => void;
}) {
  return (
    <section
      className="settings-page recovery-panel backup-manager"
      aria-label="Backup management"
    >
      <div className="recovery-intro">
        <div>
          <h3>Local backups</h3>
          <p>Saved copies from all your workspaces, stored on this device.</p>
        </div>
        <button disabled={busy} onClick={() => onAction("refresh")}>
          Refresh backups
        </button>
      </div>
      <div className="settings-transfer-actions">
        <button
          disabled={busy || !available}
          onClick={() => onAction("create")}
        >
          Create backup
        </button>
      </div>
      <p className="recovery-notice">
        Restoring opens a separate workspace and keeps the original. To protect
        against disk loss, use Back up workspace to save a copy elsewhere.
      </p>
      {!entries.length && (
        <p className="recovery-empty">No managed backups yet.</p>
      )}
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
