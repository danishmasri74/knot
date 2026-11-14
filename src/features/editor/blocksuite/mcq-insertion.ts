import type { NoteBlockModel, ParagraphBlockModel } from "@blocksuite/blocks";
import type { AffineEditorContainer } from "@blocksuite/presets";
import type { BlockModel } from "@blocksuite/store";
import * as Y from "yjs";
import { mcqReferenceFlavour } from "./card-deck";

export interface McqInsertionTarget {
  editor: AffineEditorContainer;
  root: Element;
  notebookId: string;
  noteId: string;
  anchorId: string;
  position: Y.RelativePosition;
  rect: DOMRect;
  /** Insert before the anchor paragraph (chains a question after the previous one). */
  before?: boolean;
}

export type McqDestination =
  | { kind: "deck" }
  | { kind: "standalone" }
  | { kind: "inline"; target: McqInsertionTarget };

export class PendingMcqSave extends Error {}
export class McqEditConflict extends Error {}

function editableParagraph(editor: AffineEditorContainer, model?: BlockModel) {
  if (model?.flavour !== "affine:paragraph" || editor.doc.readonly) return;
  const note = editor.doc.getParent(model) as NoteBlockModel | undefined;
  if (note?.flavour === "affine:note" && !note.isLocked())
    return { note, paragraph: model as ParagraphBlockModel };
}

function inlineEditor(editor: AffineEditorContainer, blockId: string) {
  return editor.querySelector<HTMLElementTagNameMap["rich-text"]>(
    `[data-block-id="${CSS.escape(blockId)}"] > rich-text, [data-block-id="${CSS.escape(blockId)}"] rich-text`,
  )?.inlineEditor;
}

export function captureMcqTarget(
  editor: AffineEditorContainer,
  model?: BlockModel,
  atEnd = false,
) {
  const selected = editor.std.selection.find("text");
  const paragraph = editableParagraph(
    editor,
    model ??
      (selected && !selected.to
        ? editor.doc.getBlock(selected.blockId)?.model
        : undefined),
  );
  if (!paragraph) return;
  const { note, paragraph: anchor } = paragraph;
  const inline = inlineEditor(editor, anchor.id);
  const range = atEnd
    ? { index: anchor.text.length }
    : inline?.getInlineRange();
  const selection = document.getSelection();
  const element = editor.querySelector(
    `[data-block-id="${CSS.escape(anchor.id)}"]`,
  );
  const root = element?.closest("affine-page-root, affine-edgeless-root");
  if (!range || !root || root.hasAttribute("data-outgoing-view")) return;
  const rect =
    !atEnd && selection?.rangeCount && element?.contains(selection.anchorNode)
      ? selection.getRangeAt(0).getBoundingClientRect()
      : element?.getBoundingClientRect();
  if (!rect || !element?.getClientRects().length) return;
  return {
    editor,
    root,
    notebookId: editor.doc.id,
    noteId: note.id,
    anchorId: anchor.id,
    position: Y.createRelativePositionFromTypeIndex(
      anchor.text.yText,
      range.index,
    ),
    rect,
  } satisfies McqInsertionTarget;
}

export function captureNoteMcqTarget(
  editor: AffineEditorContainer,
  noteId: string,
) {
  const selection = captureMcqTarget(editor);
  if (selection?.noteId === noteId) return selection;
  const note = editor.doc.getBlock(noteId)?.model;
  const last = note?.children
    .slice()
    .reverse()
    .find((child) => child.flavour === "affine:paragraph");
  if (last) return captureMcqTarget(editor, last, true);
}

export function requestMcqInsertion(target: McqInsertionTarget | undefined) {
  if (target)
    window.dispatchEvent(
      new CustomEvent<McqInsertionTarget>("knot-insert-mcq", {
        detail: target,
      }),
    );
}

function resolveTarget(target: McqInsertionTarget) {
  const { editor, notebookId, noteId, anchorId, position, root } = target;
  if (
    !editor.isConnected ||
    !root.isConnected ||
    !editor.contains(root) ||
    editor.closest("[hidden], [inert]") ||
    root.hasAttribute("data-outgoing-view") ||
    editor.doc.id !== notebookId
  )
    return;
  const doc = editor.doc;
  const current = editableParagraph(editor, doc.getBlock(anchorId)?.model);
  const resolved = Y.createAbsolutePositionFromRelativePosition(
    position,
    doc.spaceDoc,
  );
  if (
    !current ||
    current.note.id !== noteId ||
    resolved?.type !== current.paragraph.text.yText
  )
    return;
  return { doc, ...current, index: resolved.index };
}

function focusParagraph(
  target: McqInsertionTarget,
  blockId: string,
  index: number,
) {
  const inline = inlineEditor(target.editor, blockId);
  if (
    !inline ||
    !target.root.isConnected ||
    target.root.hasAttribute("data-outgoing-view")
  )
    return;
  inline.rootElement?.focus({ preventScroll: true });
  inline.focusIndex(index);
}

export function restoreMcqTarget(target: McqInsertionTarget) {
  const resolved = resolveTarget(target);
  if (resolved) focusParagraph(target, target.anchorId, resolved.index);
}

/** Resolve again immediately before mutation. Retain rich-text deltas across the split. */
export function prepareMcqInsertion(
  target: McqInsertionTarget,
  /** The block to insert for a card; a question reference by default. */
  block: (cardId: string) => { flavour: string; props: Record<string, unknown> } =
    (cardId) => ({ flavour: mcqReferenceFlavour, props: { cardId } }),
) {
  const resolved = resolveTarget(target);
  if (!resolved)
    throw Error(
      "The original insertion point is unavailable. Close and reopen Multiple choice at an editable paragraph in that note.",
    );
  const { doc, note, paragraph, index } = resolved;
  if (paragraph.text.toDelta().some(({ insert }) => typeof insert !== "string"))
    throw Error(
      "Choose an insertion point in a paragraph without inline embeds.",
    );
  return (cardId: string) => {
    let next = "";
    doc.captureSync();
    doc.transact(() => {
      const anchorIndex = note.children.findIndex(
        (child) => child.id === paragraph.id,
      );
      const { flavour, props } = block(cardId);
      if (index === 0 && (paragraph.text.length || target.before)) {
        doc.addBlock(flavour as never, props, note, anchorIndex);
        next = paragraph.id;
        return;
      }
      const after = anchorIndex + 1;
      const tail = paragraph.text.split(index);
      doc.addBlock(flavour as never, props, note, after);
      next = doc.addBlock("affine:paragraph", { text: tail }, note, after + 1);
    });
    doc.captureSync();
    const following = doc.getBlock(next)?.model as ParagraphBlockModel;
    return {
      focus: () => requestAnimationFrame(() => focusParagraph(target, next, 0)),
      // The next question goes directly after this one.
      next: {
        ...target,
        anchorId: next,
        position: Y.createRelativePositionFromTypeIndex(following.text.yText, 0),
        before: true,
      } satisfies McqInsertionTarget,
    };
  };
}
