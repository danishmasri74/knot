import type { AffineEditorContainer } from "@blocksuite/presets";

import { html, type TemplateResult } from "lit";
import { observeToolbarMounts } from "./toolbar-observer";

/** Same filled sparkle and --ai-accent blue as ShellIcon "sparkles". */
function askIcon() {
  const span = document.createElement("span");
  span.style.display = "flex";
  span.innerHTML =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color: var(--ai-accent)"><path d="M10 3l2.4 6.6L19 12l-6.6 2.4L10 21l-2.4-6.6L1 12l6.6-2.4L10 3z M20 2v6 M17 5h6"/></svg>';
  span.addEventListener("pointerdown", (event) => event.preventDefault());
  return span;
}

interface CanvasToolbar extends HTMLElement {
  registerEntry(entry: {
    when: (selection: readonly unknown[]) => boolean;
    render: () => TemplateResult;
  }): void;
  requestUpdate(): void;
}

// BlockSuite accepts new entries but has no unregister API.
const canvasActions = new WeakMap<CanvasToolbar, { ask?: () => void }>();

/** Extend the pinned editor's native format-bar configuration. */
export function observeAiToolbar(
  getEditor: () => AffineEditorContainer | undefined,
  ask: () => void,
) {
  const installed = new Set<
    HTMLElementTagNameMap["affine-format-bar-widget"]
  >();
  const canvasBars = new Set<CanvasToolbar>();
  const refresh = () => {
    const editor = getEditor();
    if (!editor) return;
    for (const bar of editor.querySelectorAll<CanvasToolbar>(
      "edgeless-element-toolbar-widget",
    )) {
      if (canvasBars.has(bar)) continue;
      canvasBars.add(bar);
      let action = canvasActions.get(bar);
      if (!action) {
        const state: { ask?: () => void } = {};
        canvasActions.set(bar, state);
        bar.registerEntry({
          when: (selection) => !!state.ask && selection.length > 0,
          render: () =>
            html`<edgeless-tool-icon-button
              aria-label="Ask AI"
              .tooltip=${"Ask AI"}
              @pointerdown=${(event: PointerEvent) => event.preventDefault()}
              @click=${() => state.ask?.()}
              >${askIcon()}</edgeless-tool-icon-button
            >`,
        });
        action = state;
      }
      action.ask = ask;
      bar.requestUpdate();
    }
    for (const bar of editor.querySelectorAll("affine-format-bar-widget")) {
      if (installed.has(bar)) continue;
      installed.add(bar);
      bar.addInlineAction({
        id: "knot-ask-ai",
        name: "Ask AI",
        isActive: () => false,
        showWhen: () => true,
        action: () => ask(),
        icon: askIcon,
      });
      bar.requestUpdate();
    }
  };
  const stop = observeToolbarMounts(
    "edgeless-element-toolbar-widget, affine-format-bar-widget",
    refresh,
  );
  refresh();
  return () => {
    stop();
    for (const bar of canvasBars) {
      const action = canvasActions.get(bar);
      if (action?.ask === ask) delete action.ask;
      bar.requestUpdate();
    }
    for (const bar of installed) {
      bar.configItems = bar.configItems.filter(
        (item) => !("id" in item && item.id === "knot-ask-ai"),
      );
      bar.requestUpdate();
    }
  };
}
