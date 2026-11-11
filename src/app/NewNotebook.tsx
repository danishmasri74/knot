import { useId, useState } from "react";
import { Popover } from "./Collections";
import { ShellIcon } from "./ShellIcon";

export function NewNotebook({
  busy,
  run,
  onCreate,
}: {
  busy: boolean;
  run: (task: () => Promise<void>) => Promise<void>;
  onCreate: (name: string) => Promise<void>;
}) {
  const inputId = useId();
  const [name, setName] = useState("");
  return (
    <Popover
      disabled={busy}
      label="New notebook…"
      className="secondary"
      trigger={
        <>
          <ShellIcon name="notebook" /> New notebook…
        </>
      }
    >
      {(close) => (
        <form
          className="collection-name-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || !name.trim()) return;
            void run(async () => {
              await onCreate(name.trim());
              setName("");
              close();
            });
          }}
        >
          <label htmlFor={inputId}>Notebook name</label>
          <input
            id={inputId}
            placeholder="Untitled notebook"
            value={name}
            disabled={busy}
            maxLength={200}
            onChange={(event) => setName(event.target.value)}
          />
          <button
            className="collection-submit"
            type="submit"
            disabled={busy || !name.trim()}
          >
            Create notebook <span aria-hidden="true">↵</span>
          </button>
        </form>
      )}
    </Popover>
  );
}
