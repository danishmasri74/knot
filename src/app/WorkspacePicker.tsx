import type { WorkspaceCatalog } from "../services/workspace";

export function workspaceName(id: string) {
  return id === "Workspace"
    ? "Personal workspace"
    : `Restored workspace · ${id.replace(/^restored-/, "").slice(0, 8)}`;
}

export function WorkspacePicker({
  catalog,
  busy,
  onSwitch,
  onClose,
}: {
  catalog: WorkspaceCatalog;
  busy: boolean;
  onSwitch: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <section className="recovery-panel" aria-label="Workspace picker">
      <h2>Workspaces</h2>
      <p>
        Open your personal workspace or a restored backup. Changes are saved
        before switching.
      </p>
      {!catalog.active && (
        <p>
          No workspace is open. Choose an available workspace below or use
          Restore backup.
        </p>
      )}
      {catalog.entries.map((entry) => (
        <div className="trash-row" key={entry.id}>
          <span>
            <strong>{workspaceName(entry.id)}</strong>
            <small>{entry.path}</small>
          </span>
          {catalog.active === entry.id ? (
            <span>Current</span>
          ) : (
            <button
              disabled={busy}
              aria-label={`Open ${workspaceName(entry.id)}`}
              onClick={() => onSwitch(entry.id)}
            >
              Open
            </button>
          )}
        </div>
      ))}
      {!catalog.entries.length && <p>No managed workspaces found.</p>}
      <p>Restored backups remain separate from the original workspace.</p>
      <button disabled={busy} onClick={onClose}>
        Close workspaces
      </button>
    </section>
  );
}
