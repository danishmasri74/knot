import type { AffineEditorContainer } from "@blocksuite/presets";
import type { AttachmentBlockModel } from "@blocksuite/blocks";
import { html, type TemplateResult } from "lit";
import { shellIconPaths } from "../../../app/ShellIcon";
import { MAX_COURSE_SOURCES } from "../../../services/study-course";

interface Toolbar extends HTMLElement {
  registerEntry(entry: {
    when: (selection: readonly { id: string }[]) => boolean;
    render: () => TemplateResult;
  }): void;
  requestUpdate(): void;
}

/** The PDF attachments (PDFs and converted slide decks) among these ids. */
export function selectedPdfKeys(
  editor: AffineEditorContainer,
  ids: readonly string[],
): string[] {
  const keys: string[] = [];
  for (const id of ids) {
    const model = editor.doc.getBlock(id)?.model;
    if (model?.flavour !== "affine:attachment") return [];
    const attachment = model as AttachmentBlockModel;
    if (attachment.type !== "application/pdf" || !attachment.sourceId) return [];
    keys.push(attachment.sourceId);
  }
  return keys;
}

/**
 * "Make a study course" on the canvas toolbar when only PDFs or slide
 * decks are selected (1 to 3), opening the Study tab's setup with them.
 */
export function observeStudyToolbar(
  editor: AffineEditorContainer,
  start: (keys: string[]) => void,
) {
  let alive = true;
  const installed = new Set<Toolbar>();
  const refresh = () => {
    for (const bar of editor.querySelectorAll<Toolbar>(
      "edgeless-element-toolbar-widget",
    )) {
      if (installed.has(bar)) continue;
      installed.add(bar);
      let keys: string[] = [];
      // BlockSuite has no way to remove an entry; it hides once stopped.
      bar.registerEntry({
        when: (selection) => {
          keys =
            alive && selection.length <= MAX_COURSE_SOURCES
              ? selectedPdfKeys(
                  editor,
                  selection.map((item) => item.id),
                )
              : [];
          return keys.length > 0;
        },
        render: () =>
          html`<edgeless-tool-icon-button
            aria-label="Make a study course"
            .tooltip=${"Make a study course"}
            @pointerdown=${(e: PointerEvent) => e.preventDefault()}
            @click=${() => {
              if (alive && keys.length) start(keys);
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d=${shellIconPaths.study}></path>
            </svg>
          </edgeless-tool-icon-button>`,
      });
      bar.requestUpdate();
    }
  };
  const observer = new MutationObserver(refresh);
  observer.observe(editor, { childList: true, subtree: true });
  refresh();
  return () => {
    alive = false;
    observer.disconnect();
    for (const bar of installed) bar.requestUpdate();
  };
}
