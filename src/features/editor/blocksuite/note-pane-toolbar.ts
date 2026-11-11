import type { AffineEditorContainer } from "@blocksuite/presets";
import { html, type TemplateResult } from "lit";
import { shellIconPaths } from "../../../app/ShellIcon";
interface Toolbar extends HTMLElement {
  registerEntry(entry: {
    when: (
      selection: readonly { id: string; flavour?: string; locked?: boolean }[],
    ) => boolean;
    render: () => TemplateResult;
  }): void;
  requestUpdate(): void;
}
export function observeNotePaneToolbar(
  editor: AffineEditorContainer,
  open: (id: string) => void,
) {
  let alive = true;
  const installed = new Set<Toolbar>();
  const refresh = () => {
    for (const bar of editor.querySelectorAll<Toolbar>(
      "edgeless-element-toolbar-widget",
    )) {
      if (installed.has(bar)) continue;
      installed.add(bar);
      let selected: string | undefined;
      bar.registerEntry({
        when: (selection) => {
          const model =
            selection.length === 1
              ? editor.doc.getBlock(selection[0].id)?.model
              : undefined;
          selected =
            alive &&
            model?.flavour === "affine:note" &&
            !(model as { isLocked?: () => boolean }).isLocked?.() &&
            !editor.doc.readonly
              ? model.id
              : undefined;
          return !!selected;
        },
        render: () =>
          html`<edgeless-tool-icon-button
            aria-label="Open in side panel"
            .tooltip=${"Open in side panel"}
            @pointerdown=${(e: PointerEvent) => e.preventDefault()}
            @click=${() => {
              if (alive && selected) open(selected);
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
              <path d=${shellIconPaths.note}></path>
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
