import { DocModeExtension, DocModeService } from "@blocksuite/affine-shared/services";

/**
 * BlockSuite asks this which mode an editor is in; its default answers
 * null. Paragraphs then treated the canvas root as their editing host and
 * made the whole canvas contenteditable, so editors floating on it (arrow
 * labels, shape text) never received typing. It also decides moving
 * between notes, image resizing at zoom and note hit-testing.
 */
class EditorMode extends DocModeService {
  constructor(private readonly mode: "page" | "edgeless") {
    super();
  }
  override getEditorMode() {
    return this.mode;
  }
}
export function editorModeExtension(mode: "page" | "edgeless") {
  return DocModeExtension(new EditorMode(mode));
}
