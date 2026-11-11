import type { WorkspaceCatalog } from "../services/workspace";

export function workspaceName(id: string) {
  if (id.startsWith("external-"))
    return `External workspace · ${id.slice(9, 17)}`;
  return id === "Workspace"
    ? "Personal workspace"
    : `Restored workspace · ${id.replace(/^restored-/, "").slice(0, 8)}`;
}

export function WorkspacePicker({
  catalog,
  busy,
  onSwitch,
  onOpenExternal,
  onRelocate,
}: {
  catalog: WorkspaceCatalog;
  busy: boolean;
  onSwitch: (id: string) => void;
  onOpenExternal: () => void;
  onRelocate: () => void;
}) {
  return (
    <section className="recovery-panel" aria-label="Workspace picker">
      <p className="workspace-intro">Your spaces for notes and ideas.</p>
      {catalog.warning && <p role="alert">{catalog.warning}</p>}
      {!catalog.active && (
        <p>
          No workspace is open. Choose an available workspace below or use
          Restore backup.
        </p>
      )}
      {catalog.entries.map((entry) => (
        <div className="workspace-card" key={entry.id}>
          <span>
            <strong>{workspaceName(entry.id)}</strong>
            <small>
              {catalog.active === entry.id
                ? "You’re working here"
                : "Ready to open"}
            </small>
          </span>
          {catalog.active === entry.id ? (
            <span className="workspace-current">✓ Current</span>
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
      {!catalog.entries.length && <p>No known workspaces found.</p>}
      <button
        className="workspace-open"
        disabled={busy}
        onClick={onOpenExternal}
      >
        + Open workspace folder
      </button>
      <details className="workspace-storage">
        <summary>Storage & advanced</summary>
        {catalog.entries
          .filter((entry) => entry.id === catalog.active)
          .map((entry) => (
            <p key={entry.id}>
              <strong>Workspace location</strong>
              <br />
              {entry.path}
            </p>
          ))}
        <button disabled={busy || !catalog.active} onClick={onRelocate}>
          Relocate workspace
        </button>
        <p>
          Creates and opens a copy in a new folder. The original stays as a
          recovery copy; later edits are independent.
        </p>
        <p>
          Managed backups stay in application storage. Restored backups open as
          separate workspaces.
        </p>
      </details>
    </section>
  );
}
