import { ShellIcon } from "./ShellIcon";
import { useEffect, useRef, useState } from "react";

export function TrashConfirmation({
  title,
  kind = "permanent",
  count,
  description,
  onClose,
  onConfirm,
}: {
  title: string;
  kind?: "move" | "permanent";
  count: number;
  description?: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    cancel.current?.focus();
    return () => {
      element.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="trash-confirmation"
      aria-labelledby="trash-confirm-title"
      aria-describedby="trash-confirm-description"
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="confirmation-icon">
        <ShellIcon name="trash" />
      </div>
      <h2 id="trash-confirm-title">{title}</h2>
      <p id="trash-confirm-description">
        {description ??
          (kind === "move"
            ? "This notebook and all its notes will move to Trash. You can restore them for 30 days before they’re permanently deleted."
            : `${count === 1 ? "This notebook" : `These ${count} notebooks`} will be permanently deleted. This cannot be undone.`)}
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="trash-actions">
        <button ref={cancel} disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          className="danger-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onConfirm();
            } catch (cause) {
              setError(String(cause));
              setBusy(false);
            }
          }}
        >
          {busy
            ? kind === "move"
              ? "Moving…"
              : "Deleting…"
            : kind === "move"
              ? "Move to Trash"
              : "Delete permanently"}
        </button>
      </div>
    </dialog>
  );
}
