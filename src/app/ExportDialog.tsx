import { useEffect, useRef, useState } from "react";
import { ShellIcon } from "./ShellIcon";
import type { ExportFormat } from "../services/workspace";

const formats: {
  value: ExportFormat;
  name: string;
  detail: string;
}[] = [
  {
    value: "markdown",
    name: "Markdown",
    detail:
      "The notebook's notes as text (.md), with attachments in a .zip when needed. Drawings are left out.",
  },
  {
    value: "png",
    name: "PNG image",
    detail: "A picture of the canvas as it looks now.",
  },
  {
    value: "pdf",
    name: "PDF snapshot",
    detail: "The canvas as a single-page PDF image. Its text can't be selected.",
  },
];

/** Export: pick a format, then choose where to save (always a new file). */
export function ExportDialog({
  title,
  format,
  onFormat,
  onExport,
  onClose,
}: {
  title: string;
  format: ExportFormat;
  onFormat: (format: ExportFormat) => void;
  /** Saves the export; resolves once the save dialog is done. */
  onExport: (format: ExportFormat) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const choice = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    choice.current?.focus();
    return () => {
      element.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="trash-confirmation export-dialog"
      aria-labelledby="export-title"
      aria-describedby="export-description"
      aria-busy={saving}
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
    >
      <div className="confirmation-icon">
        <ShellIcon name="export" />
      </div>
      <h2 id="export-title">Export “{title || "Untitled"}”</h2>
      <p id="export-description">
        For a copy Knot can open again with everything in it, use Share as
        file or a backup.
      </p>
      <fieldset className="export-formats" disabled={saving}>
        <legend className="sr-only">Format</legend>
        {formats.map((option) => (
          <label key={option.value} className="export-format">
            <input
              ref={option.value === format ? choice : undefined}
              type="radio"
              name="export-format"
              value={option.value}
              checked={format === option.value}
              onChange={() => onFormat(option.value)}
            />
            <span>
              <strong>{option.name}</strong>
              <span>{option.detail}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="trash-actions">
        <span className="export-note">Saves to a new file, up to 100 MB.</span>
        <button disabled={saving} onClick={onClose}>
          Cancel
        </button>
        <button
          className="primary"
          disabled={saving}
          onClick={() => {
            setSaving(true);
            void onExport(format).finally(() => setSaving(false));
          }}
        >
          {saving ? "Exporting…" : "Export…"}
        </button>
      </div>
    </dialog>
  );
}
