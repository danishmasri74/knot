import { useEffect, useState } from "react";
import type { EditorSession } from "../features/editor/blocksuite/adapter";
import { ShellIcon } from "./ShellIcon";

/** "/ Note name" after the notebook title while Page view shows one note.
 * Uses the same name as the sidebar's note list, kept current as you type. */
export function NoteCrumb({
  session,
  noteId,
}: {
  session: EditorSession;
  noteId: string;
}) {
  const [title, setTitle] = useState<string | null>(null);
  useEffect(() => {
    let frame = 0;
    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setTitle(
          session.notebookNotes().find((note) => note.id === noteId)?.title ??
            null,
        ),
      );
    };
    refresh();
    session.doc.spaceDoc.on("update", refresh);
    return () => {
      cancelAnimationFrame(frame);
      session.doc.spaceDoc.off("update", refresh);
    };
  }, [session, noteId]);
  if (!title) return null;
  return (
    <span className="note-crumb" aria-label={`Note: ${title}`}>
      <span className="card-page-separator" aria-hidden="true">
        /
      </span>
      <ShellIcon name="note" />
      <span data-tooltip={title}>{title}</span>
    </span>
  );
}
