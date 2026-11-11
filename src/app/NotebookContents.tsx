import { useEffect, useState } from "react";
import type { EditorSession } from "../features/editor/blocksuite/adapter";
import { ShellIcon } from "./ShellIcon";
import { LoadingRows } from "./LoadingRows";

export function NotebookContents({
  session,
  frozenNotes,
  busy,
  mode,
  focusedNote,
  onView,
  onNote,
  onShared,
}: {
  session: EditorSession | null;
  frozenNotes?: ReturnType<EditorSession["notebookNotes"]>;
  busy: boolean;
  mode: "page" | "edgeless";
  focusedNote: string | null;
  onView: (mode: "page" | "edgeless") => void;
  onNote: (id: string) => void;
  onShared: (id: string) => void;
}) {
  const [notes, setNotes] = useState<ReturnType<
    EditorSession["notebookNotes"]
  > | null>(null);
  useEffect(() => {
    if (!session) return;
    let frame = 0;
    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = session.notebookNotes();
        setNotes((previous) =>
          JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
        );
      });
    };
    // Let the placeholder paint before scanning a newly mounted notebook.
    frame = requestAnimationFrame(refresh);
    session.doc.spaceDoc.on("update", refresh);
    return () => {
      cancelAnimationFrame(frame);
      session.doc.spaceDoc.off("update", refresh);
    };
  }, [session]);
  const visibleNotes = frozenNotes ?? notes;
  if (!visibleNotes) return <LoadingRows label="Loading notebook notes" />;
  return (
    <div className="notebook-contents">
      <button
        disabled={busy}
        aria-pressed={mode === "edgeless"}
        onClick={() => onView("edgeless")}
      >
        <ShellIcon name="board" />
        <span>Whiteboard</span>
      </button>
      {visibleNotes.map((note) => (
        <button
          key={note.id}
          disabled={busy}
          data-tooltip={note.title}
          aria-pressed={mode === "page" && focusedNote === note.id}
          onClick={() =>
            note.target !== null ? onShared(note.target) : onNote(note.id)
          }
        >
          <ShellIcon name="note" />
          <span>{note.title}</span>
          {note.target !== null && <small>Linked</small>}
        </button>
      ))}
      {!visibleNotes.length && (
        <p className="empty">No notes in this notebook yet.</p>
      )}
    </div>
  );
}
