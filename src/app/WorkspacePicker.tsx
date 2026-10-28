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
  onClose,
  onOpenExternal,
  onRelocate,
}: {
  catalog: WorkspaceCatalog;
  busy: boolean;
  onSwitch: (id: string) => void;
  onClose: () => void;
  onOpenExternal: () => void;
  onRelocate: () => void;
}) {
  return (
    <section className="recovery-panel" aria-label="Workspace picker">
      <h2>Workspaces</h2>
      <p>
        Open a managed workspace or an existing Knot folder. Changes are saved
        before switching.
      </p>
      <button disabled={busy} onClick={onOpenExternal}>
        Open workspace folder
      </button>{" "}
      <button disabled={busy || !catalog.active} onClick={onRelocate}>
        Relocate workspace
      </button>
      <p>
        Relocation creates and opens a validated copy in a new folder. The
        source remains as a recovery copy; later edits are independent. Managed
        backups stay in application storage.
      </p>
      {catalog.warning && <p role="alert">{catalog.warning}</p>}
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
      {!catalog.entries.length && <p>No known workspaces found.</p>}
      <p>Restored backups remain separate from the original workspace.</p>
      <button disabled={busy} onClick={onClose}>
        Close workspaces
      </button>
    </section>
  );
}
