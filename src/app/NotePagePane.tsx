import { captureNoteMcqTarget, requestMcqInsertion, type McqInsertionTarget } from "../features/editor/blocksuite/mcq-insertion";
import { observeAiToolbar } from "../features/editor/blocksuite/ai-toolbar";
import type { AffineEditorContainer } from "@blocksuite/presets";
import { useEffect, useRef, useState } from "react";
import type { EditorSession } from "../features/editor/blocksuite/adapter";
export function NotePagePane({
  session,
  noteId,
  aiEnabled,
  onAsk,
}: {
  session: EditorSession;
  noteId: string;
  aiEnabled: boolean;
  onAsk: (editor: AffineEditorContainer) => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const insertTarget = useRef<McqInsertionTarget>();
  const ask = useRef(onAsk);
  ask.current = onAsk;
  const [editor, setEditor] = useState<AffineEditorContainer | null>(null);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState("");
  const [available, setAvailable] = useState(!!session.doc.getBlock(noteId));
  useEffect(() => {
    let alive = true;
    let view:
      Awaited<ReturnType<EditorSession["createNotePageView"]>> | undefined;
    const focus = () => view?.focus();
    const element = host.current!;
    element.addEventListener("knot-focus-note", focus);
    const refresh = () => {
      const model = session.doc.getBlock(noteId)?.model;
      setAvailable(!!model);
      setLocked(
        !!(model as { isLocked?: () => boolean } | undefined)?.isLocked?.(),
      );
    };
    refresh();
    session.doc.spaceDoc.on("update", refresh);
    void session
      .createNotePageView(noteId, host.current!)
      .then((next) => {
        if (!alive) next.dispose();
        else {
          view = next;
          setEditor(next.editor);
          if (
            element.getClientRects().length &&
            !element.closest("[hidden], [inert]")
          )
            next.focus();
        }
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
      element.removeEventListener("knot-focus-note", focus);
      setEditor(null);
      session.doc.spaceDoc.off("update", refresh);
      view?.dispose();
    };
  }, [session, noteId]);
  useEffect(() => {
    if (!editor || !aiEnabled) return;
    return observeAiToolbar(
      () => (editor.isConnected ? editor : undefined),
      () => ask.current(editor),
    );
  }, [editor, aiEnabled]);
  return (
    <section className="note-page-pane" aria-label="Note Page editor">
      {(!available || error) && (
        <p role="status">
          {error ||
            "This note is unavailable. Undo its deletion to continue, or close this tab."}
        </p>
      )}
      {locked && <p role="status">This note is locked on the canvas.</p>}
      {editor && available && !locked && !error && !editor.doc.readonly && (
        <div className="note-page-insert" role="toolbar" aria-label="Insert into note">
          <button type="button"
            disabled={!editor.doc.getBlock(noteId)?.model.children.some((child) => child.flavour === "affine:paragraph")}
            onPointerDown={(event) => {
              insertTarget.current = captureNoteMcqTarget(editor, noteId);
              if (insertTarget.current) event.preventDefault();
            }}
            onClick={() => {
              requestMcqInsertion(insertTarget.current ?? captureNoteMcqTarget(editor, noteId));
              insertTarget.current = undefined;
            }}>
            Multiple choice
          </button>
        </div>
      )}
      <div
        ref={(node) => {
          host.current = node;
          if (node) node.inert = locked || !available;
        }}
        className="note-page-host"
        hidden={!available || !!error}
      />
    </section>
  );
}
