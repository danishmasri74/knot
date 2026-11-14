import { useEffect, useRef, useState } from "react";
import { CardEditor, type CreateCardEditor } from "./LibraryCardDeck";
import { ShellIcon } from "./ShellIcon";

/** Edit a Card Deck card shown inside a note. Changes reach every note and
 * canvas that shows it as you type. */
export function CardEditDialog({
  cardId,
  title,
  create,
  onClose,
}: {
  cardId: string;
  title: string;
  create: CreateCardEditor;
  /** Saves, then closes. */
  onClose: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    return () => {
      element.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const close = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onClose();
    } catch (cause) {
      setError(String(cause));
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="card-edit-dialog"
      aria-label={`Edit card: ${title}`}
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        void close();
      }}
    >
      <header>
        <ShellIcon name="cardDeck" />
        <h2>{title}</h2>
        <button
          type="button"
          aria-label="Close card editor"
          disabled={busy}
          onClick={() => void close()}
        >
          <ShellIcon name="close" />
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      <CardEditor cardId={cardId} create={create} />
    </dialog>
  );
}
