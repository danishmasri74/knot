import { useEffect, useRef, useState } from "react";
import type { KnowledgeObject } from "../services/workspace";
import { validateJot, type JotCapture } from "../features/editor/jot";

export function JotPanel({
  sources,
  initial,
  busy,
  onClose,
  onCapture,
}: {
  sources: KnowledgeObject[];
  initial: string;
  busy: boolean;
  onClose: () => void;
  onCapture: (capture: JotCapture, started: () => void) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [destination, setDestination] = useState(initial);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<JotCapture | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="jot-dialog"
      aria-label="Jot capture"
      onCancel={(event) => event.preventDefault()}
    >
      <h2>Jot</h2>
      <p>
        Append plain text to an existing document. It opens after capture.
        Drafts are not saved until you submit.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const capture = pending ?? {
            id: crypto.randomUUID(),
            destination,
            text,
          };
          setError("");
          try {
            validateJot(capture);
            void onCapture(capture, () => setPending(capture)).catch((error) =>
              setError(String(error)),
            );
          } catch (error) {
            setError(String(error));
          }
        }}
      >
        <label>
          Destination document
          <select
            aria-label="Jot destination"
            value={destination}
            disabled={busy || !!pending}
            onChange={(event) => setDestination(event.target.value)}
          >
            <option value="">Choose a document…</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.title} · {source.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Capture text
          <textarea
            aria-label="Jot text"
            rows={8}
            maxLength={10000}
            value={text}
            disabled={busy || !!pending}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        <p>{text.length.toLocaleString()} / 10,000 characters</p>
        {pending && (
          <p>
            Submission retained. Retry saves this same capture without inserting
            it twice.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="actions">
          <button type="submit" disabled={busy || !destination || !text.trim()}>
            {pending ? "Retry capture" : "Save capture"}
          </button>
          <button type="button" disabled={busy || !!pending} onClick={onClose}>
            Discard draft & close
          </button>
        </div>
      </form>
    </dialog>
  );
}
