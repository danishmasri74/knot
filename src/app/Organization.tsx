import { useState } from "react";
import {
  organization,
  type Catalog,
  type Label,
  type LibraryFilter,
  type Organization,
} from "../services/workspace";

type Shared = { catalog: Catalog; busy: boolean };
export function LibraryFilters({
  catalog,
  busy,
  value,
  onChange,
}: Shared & {
  value: LibraryFilter;
  onChange: (value: LibraryFilter) => void;
}) {
  return (
    <div className="library-filters">
      <label>
        Folder
        <select
          aria-label="Filter by folder"
          disabled={busy}
          value={value.folder ?? "all"}
          onChange={(e) =>
            onChange({
              ...value,
              folder: e.target.value === "all" ? null : e.target.value,
            })
          }
        >
          <option value="all">All folders</option>
          <option value="">Unfiled</option>
          {catalog.folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Tag
        <select
          aria-label="Filter by tag"
          disabled={busy}
          value={value.tag ?? ""}
          onChange={(e) => onChange({ ...value, tag: e.target.value || null })}
        >
          <option value="">All tags</option>
          {catalog.tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export function DocumentOrganization({
  catalog,
  busy,
  value,
  onChange,
}: Shared & {
  value: Organization;
  onChange: (value: Organization) => void;
}) {
  return (
    <details className="document-organization">
      <summary>
        Organize ·{" "}
        {catalog.folders.find((f) => f.id === value.folder)?.name ?? "Unfiled"}{" "}
        · {value.tags.length} tags
      </summary>
      <div className="organization-fields">
        <label>
          Folder
          <select
            aria-label="Document folder"
            disabled={busy}
            value={value.folder ?? ""}
            onChange={(e) =>
              onChange({ ...value, folder: e.target.value || null })
            }
          >
            <option value="">Unfiled</option>
            {catalog.folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset disabled={busy}>
          <legend>Tags</legend>
          {catalog.tags.length ? (
            catalog.tags.map((t) => (
              <label className="tag-choice" key={t.id}>
                <input
                  type="checkbox"
                  checked={value.tags.includes(t.id)}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      tags: e.target.checked
                        ? [...value.tags, t.id]
                        : value.tags.filter((id) => id !== t.id),
                    })
                  }
                />
                {t.name}
              </label>
            ))
          ) : (
            <span className="muted">Create tags in Manage folders & tags.</span>
          )}
        </fieldset>
      </div>
    </details>
  );
}

export function OrganizationManager({
  catalog,
  busy,
  run,
  onChanged,
  onClose,
}: Shared & {
  run: (task: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<"folder" | "tag">("folder");
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<Label | null>(null);
  const labels = kind === "folder" ? catalog.folders : catalog.tags;
  return (
    <section
      className="organization-manager"
      aria-label="Manage folders and tags"
    >
      <div className="manager-heading">
        <h2>Folders & tags</h2>
        <button disabled={busy} onClick={onClose}>
          Close
        </button>
      </div>
      <p>Each document has one folder and can have several tags.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            if (editing) await organization.rename(kind, editing.id, name);
            else await organization.create(kind, name);
            setName("");
            setEditing(null);
            await onChanged();
          });
        }}
      >
        <select
          aria-label="Organization type"
          disabled={busy}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as "folder" | "tag");
            setEditing(null);
            setName("");
          }}
        >
          <option value="folder">Folder</option>
          <option value="tag">Tag</option>
        </select>
        <input
          aria-label="Folder or tag name"
          placeholder={kind === "folder" ? "Folder name" : "Tag name"}
          maxLength={100}
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
        <button disabled={busy || !name.trim()} type="submit">
          {editing ? "Save name" : "Create"}
        </button>
        {editing && (
          <button
            disabled={busy}
            type="button"
            onClick={() => {
              setEditing(null);
              setName("");
            }}
          >
            Cancel
          </button>
        )}
      </form>
      <ul>
        {labels.map((label) => (
          <li key={label.id}>
            <span>{label.name}</span>
            <button
              aria-label={`Rename ${label.name}`}
              disabled={busy}
              onClick={() => {
                setEditing(label);
                setName(label.name);
              }}
            >
              Rename
            </button>
            <button
              aria-label={`Delete ${label.name}`}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (
                    !confirm(
                      `Delete ${kind} “${label.name}”? ${kind === "folder" ? "Its documents become unfiled." : "This tag is removed from its documents."} No documents will be deleted.`,
                    )
                  )
                    return;
                  await organization.delete(kind, label.id);
                  if (editing?.id === label.id) {
                    setEditing(null);
                    setName("");
                  }
                  await onChanged();
                })
              }
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      {!labels.length && (
        <p>
          No {kind === "folder" ? "folders" : "tags"} yet. Create your first one
          above.
        </p>
      )}
    </section>
  );
}
