import { AffineEditorContainer } from "@blocksuite/presets";
import { RefNodeSlotsProvider } from "@blocksuite/blocks";
import { observeEditorPreferences } from "../../../services/editor-preferences";

/** A view only: the session retains ownership of the Doc, undo and saving. */
export async function createNotePageView(
  main: AffineEditorContainer,
  noteId: string,
  host: HTMLElement,
  navigate: (id: string) => void,
) {
  const editor = new AffineEditorContainer();
  editor.dataset.notePane = noteId;
  editor.pageSpecs = main.pageSpecs;
  editor.doc = main.doc;
  editor.mode = "page";
  host.append(editor);
  const stopPreferences = observeEditorPreferences(editor);
  try {
    await editor.updateComplete;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    const root = editor.querySelector("affine-page-root");
    if (!root) {
      stopPreferences();
      editor.remove();
      throw new Error("Page editor could not be opened.");
    }
    const renderChildren = root.renderChildren;
    Object.defineProperty(root, "renderChildren", {
      configurable: true,
      value: ((model, filter) =>
        renderChildren(model, (child) =>
          model.flavour === "affine:page"
            ? child.id === noteId
            : !filter || filter(child),
        )) as typeof renderChildren,
    });
    root.requestUpdate();
    await root.updateComplete;
    const link = editor.std
      .get(RefNodeSlotsProvider)
      .docLinkClicked.on(({ pageId }) => navigate(pageId));
    const keydown = (event: KeyboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest("input, textarea, select")
      )
        return;
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.isComposing
      )
        return;
      if (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.shiftKey || event.key.toLowerCase() === "y")
          editor.doc.redo();
        else editor.doc.undo();
      } else if (
        event.key.toLowerCase() === "a" &&
        (event.target as Element).closest("affine-page-root")
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const note = editor.doc.getBlock(noteId)?.model;
        editor.std.selection.setGroup(
          "note",
          (note?.children ?? []).map((child) =>
            editor.std.selection.create("block", { blockId: child.id }),
          ),
        );
      }
    };
    editor.addEventListener("keydown", keydown, true);
    let bookmark: Range | undefined;
    const remember = () => {
      const selection = document.getSelection();
      if (selection?.rangeCount && editor.contains(selection.anchorNode))
        bookmark = selection.getRangeAt(0).cloneRange();
    };
    editor.addEventListener("focusout", remember);
    let disposed = false;
    return {
      editor,
      focus() {
        if (disposed) return;
        editor.querySelector<HTMLElement>('[contenteditable="true"]')?.focus();
        if (
          bookmark?.startContainer.isConnected &&
          editor.contains(bookmark.startContainer)
        ) {
          const selection = document.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(bookmark);
        }
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        editor.removeEventListener("focusout", remember);
        bookmark = undefined;
        link.dispose();
        stopPreferences();
        editor.removeEventListener("keydown", keydown, true);
        editor.remove();
      },
    };
  } catch (error) {
    stopPreferences();
    editor.remove();
    throw error;
  }
}

