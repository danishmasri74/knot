import { captureNoteMcqTarget, requestMcqInsertion, type McqInsertionTarget } from "../features/editor/blocksuite/mcq-insertion";
import { observeAiToolbar } from "../features/editor/blocksuite/ai-toolbar";
import type { AffineEditorContainer } from "@blocksuite/presets";
import { useEffect, useRef, useState } from "react";
import type { EditorSession } from "../features/editor/blocksuite/adapter";
/** Where each note tab was scrolled, so a tab that slept comes back in place. */
const scrollPositions = new Map<string, number>();
export function NotePagePane({
  session,
  noteId,
  aiEnabled,
  onAsk,
  asleep = false,
}: {
  session: EditorSession;
  noteId: string;
  aiEnabled: boolean;
  onAsk: (editor: AffineEditorContainer) => void;
  /** A hidden tab that hasn't been looked at for a while: drop the editor. */
  asleep?: boolean;
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
    if (asleep) return;
    let alive = true;
    const key = JSON.stringify([session.doc.id, noteId]);
    let view:
      Awaited<ReturnType<EditorSession["createNotePageView"]>> | undefined;
    const focus = () => view?.focus();
    const element = host.current!;
    element.addEventListener("knot-focus-note", focus);
    // Hiding a tab resets its scroll, so remember the position as it changes.
    const remember = (event: Event) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.matches(".affine-page-viewport") &&
        !element.closest("[hidden]")
      )
        scrollPositions.set(key, target.scrollTop);
    };
    element.addEventListener("scroll", remember, true);
    const refresh = () => {
      const model = session.doc.getBlock(noteId)?.model;
      setAvailable(!!model);
      // An empty note keeps BlockSuite's "Type '/'" hint visible.
      const only = model?.children.length === 1 ? model.children[0] : null;
      const text = (only as { text?: { length: number } } | null)?.text;
      element.toggleAttribute(
        "data-knot-empty-note",
        only?.flavour === "affine:paragraph" && !!text && text.length === 0,
      );
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
          const top = scrollPositions.get(key);
          // The page lays out over a few frames; wait until it is tall enough.
          let tries = 0;
          const restore = () => {
            const viewport = element.querySelector(".affine-page-viewport");
            if (!alive || !top || !viewport) return;
            viewport.scrollTop = top;
            if (Math.abs(viewport.scrollTop - top) > 1 && ++tries < 30)
              requestAnimationFrame(restore);
          };
          requestAnimationFrame(restore);
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
      element.removeEventListener("scroll", remember, true);
      element.removeEventListener("knot-focus-note", focus);
      setEditor(null);
      session.doc.spaceDoc.off("update", refresh);
      view?.dispose();
    };
  }, [session, noteId, asleep]);
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
      {!editor && available && !error && (
        <div className="note-page-loading" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      )}
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
