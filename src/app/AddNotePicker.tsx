import { useEffect, useState } from "react";
import { Popover } from "./Collections";
import { ShellIcon } from "./ShellIcon";
import { repository, type KnowledgeObject } from "../services/workspace";

type Props = {
  busy: boolean;
  onChoose: (notebook: KnowledgeObject) => Promise<void>;
  onCreate: (name: string) => Promise<void>;
};
export function AddNotePicker(props: Props) {
  return (
    <Popover
      label="Add note"
      className="primary"
      disabled={props.busy}
      trigger={
        <>
          <ShellIcon name="note" /> Add note
        </>
      }
    >
      {(close) => <Destinations {...props} close={close} />}
    </Popover>
  );
}
export function Destinations({
  busy,
  onChoose,
  onCreate,
  close,
  searchLabel = "Add a note to…",
}: Props & { close: () => void; searchLabel?: string }) {
  const [rows, setRows] = useState<KnowledgeObject[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    repository
      .catalog()
      .then((data) => {
        if (live) setRows(data);
      })
      .catch((e) => {
        if (live) setError(String(e));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [retry]);
  const submit = async (action: () => Promise<void>) => {
    if (busy || pending) return;
    setPending(true);
    setError("");
    try {
      await action();
      close();
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  };
  const matches = rows.filter((row) =>
    row.title.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <div className="note-destination-picker" aria-busy={loading || pending}>
      <form
        className="collection-name-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (creating && query.trim())
            void submit(() => onCreate(query.trim()));
          else if (!creating && matches.length === 1)
            void submit(() => onChoose(matches[0]));
        }}
      >
        <label htmlFor="note-destination-search">
          {creating ? "New notebook name" : searchLabel}
        </label>
        <input
          id="note-destination-search"
          value={query}
          maxLength={200}
          placeholder={creating ? "Untitled notebook" : "Find a notebook…"}
          disabled={busy || pending}
          onChange={(event) => setQuery(event.target.value)}
        />
        {creating && (
          <button
            type="submit"
            disabled={busy || pending || !query.trim()}
            className="collection-submit"
          >
            Create notebook <span aria-hidden="true">↵</span>
          </button>
        )}
      </form>
      {error && (
        <div role="alert" className="note-destination-status">
          {error}
          <button disabled={pending} onClick={() => setRetry((v) => v + 1)}>
            Retry
          </button>
        </div>
      )}
      {!creating && (
        <>
          <div className="collection-action-list note-destination-results">
            {loading ? (
              <p role="status">Loading notebooks…</p>
            ) : matches.length ? (
              matches.map((row) => (
                <button
                  key={row.id}
                  disabled={busy || pending}
                  onClick={() => void submit(() => onChoose(row))}
                >
                  <ShellIcon name="notebook" />
                  <span>{row.title || "Untitled notebook"}</span>
                </button>
              ))
            ) : (
              <p>
                {rows.length
                  ? "No matching notebooks."
                  : "Create a notebook for your first note."}
              </p>
            )}
          </div>
          <div className="collection-action-list note-destination-footer">
            <button
              disabled={busy || pending}
              onClick={() => {
                setCreating(true);
                setQuery("");
              }}
            >
              <ShellIcon name="plus" />
              New notebook…
            </button>
          </div>
        </>
      )}
      {creating && (
        <div className="collection-action-list">
          <button disabled={pending} onClick={() => setCreating(false)}>
            Back to notebooks
          </button>
        </div>
      )}
    </div>
  );
}
