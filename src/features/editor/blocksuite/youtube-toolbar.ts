import type { BlockModel } from "@blocksuite/store";
import {
  youtubeVideoId,
  type VideoSource,
} from "../../../services/youtube-transcript";
import { observeToolbarMounts } from "./toolbar-observer";

// "Open in side panel" on YouTube cards (docs/YOUTUBE-TRANSCRIPT-PLAN.md).
// Page: BlockSuite's `affine-embed-card-toolbar` widget shows for a selected
// card and renders its buttons in its shadow root. Canvas: the element
// toolbar's `edgeless-change-embed-card-button`. Clicking the card itself is
// unchanged; only this button opens the panel.

type YoutubeModel = BlockModel & {
  url: string;
  videoId?: string | null;
  title?: string | null;
};
type PageToolbar = HTMLElement & { focusModel?: BlockModel };
type CanvasToolbar = HTMLElement & { model?: BlockModel };

const label = "Open in side panel";

export function videoSource(model?: BlockModel): VideoSource | null {
  if (model?.flavour !== "affine:embed-youtube") return null;
  const card = model as YoutubeModel;
  const videoId = card.videoId || youtubeVideoId(card.url);
  if (!videoId || !/^[\w-]{11}$/.test(videoId)) return null;
  return {
    videoId,
    title: card.title || "YouTube video",
    url: card.url,
    documentId: card.doc.id,
    blockId: card.id,
  };
}

function createButton(
  current: () => VideoSource | null,
  toggle: (source: VideoSource) => void,
) {
  const button = document.createElement("editor-icon-button") as HTMLElement & {
    tooltip: string;
    active: boolean;
  };
  button.className = "knot-video-panel-action";
  button.setAttribute("aria-label", label);
  button.tooltip = label;
  // Same 20px/currentColor split-view icon as the PDF reader button.
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("width", "20");
  icon.setAttribute("height", "20");
  icon.setAttribute("fill", "none");
  icon.setAttribute("aria-hidden", "true");
  const outline = document.createElementNS(icon.namespaceURI, "path");
  outline.setAttribute(
    "d",
    "M4 4.75h16a.75.75 0 0 1 .75.75v13a.75.75 0 0 1-.75.75H4a.75.75 0 0 1-.75-.75v-13A.75.75 0 0 1 4 4.75Zm10 0v14.5",
  );
  outline.setAttribute("stroke", "currentColor");
  outline.setAttribute("stroke-width", "1.5");
  icon.append(outline);
  button.append(icon);
  button.addEventListener("pointerdown", (event) => event.stopPropagation());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    // Read the card at click time: the toolbar is reused across cards.
    const source = current();
    if (source) toggle(source);
  });
  return button;
}

/**
 * Add the side-panel button to every YouTube card toolbar in the app.
 * `isOpen` marks the button pressed when the panel shows that video;
 * `toggle` opens it (or closes it when it's already open).
 */
export function installYoutubeToolbars(
  toggle: (source: VideoSource) => void,
  isOpen: (videoId: string) => boolean,
) {
  let stopped = false;
  let queued = false;
  const roots = new Set<ShadowRoot>();
  const buttons = new Set<HTMLElement & { active: boolean }>();
  const observer = new MutationObserver(() => schedule());
  const watch = (root: ShadowRoot | null) => {
    if (root && !roots.has(root)) {
      roots.add(root);
      observer.observe(root, { childList: true, subtree: true });
    }
  };

  function place(
    container: Element | ShadowRoot,
    source: VideoSource | null,
    current: () => VideoSource | null,
    withSeparator: boolean,
  ) {
    // Direct children only. Not `:scope >`: inside a ShadowRoot `:scope`
    // matches nothing, so the wrapper was never found and was re-added on
    // every mutation, freezing the canvas.
    let wrapper = [...container.children].find(
      (child): child is HTMLElement =>
        child instanceof HTMLElement &&
        child.classList.contains("knot-video-panel-wrapper"),
    );
    if (!source) {
      wrapper?.remove();
      return;
    }
    if (!wrapper) {
      wrapper = document.createElement("span");
      wrapper.className = "knot-video-panel-wrapper";
      wrapper.style.display = "contents";
      const button = createButton(current, toggle);
      buttons.add(button as HTMLElement & { active: boolean });
      wrapper.append(button);
      if (withSeparator)
        wrapper.append(document.createElement("editor-toolbar-separator"));
      container.prepend(wrapper);
    }
    const button = wrapper.querySelector<HTMLElement & { active: boolean }>(
      ".knot-video-panel-action",
    );
    if (button) {
      const open = isOpen(source.videoId);
      button.active = open;
      button.setAttribute("aria-pressed", String(open));
    }
  }

  function refresh() {
    queued = false;
    if (stopped) return;
    for (const root of roots) if (!root.host.isConnected) roots.delete(root);
    for (const button of buttons) if (!button.isConnected) buttons.delete(button);
    const scopes: (Document | ShadowRoot)[] = [document];
    for (const widget of document.querySelectorAll<HTMLElement>(
      "edgeless-element-toolbar-widget, .blocksuite-portal",
    ))
      watch(widget.shadowRoot);
    scopes.push(...roots);
    for (const scope of scopes) {
      for (const toolbar of scope.querySelectorAll<PageToolbar>(
        "affine-embed-card-toolbar",
      )) {
        watch(toolbar.shadowRoot);
        const bar = toolbar.shadowRoot?.querySelector<HTMLElement>(
          "editor-toolbar.embed-card-toolbar",
        );
        if (!bar) continue;
        place(
          bar,
          videoSource(toolbar.focusModel),
          () => videoSource(toolbar.focusModel),
          true,
        );
      }
      for (const toolbar of scope.querySelectorAll<CanvasToolbar>(
        "edgeless-change-embed-card-button",
      )) {
        watch(toolbar.shadowRoot);
        place(
          toolbar.shadowRoot ?? toolbar,
          videoSource(toolbar.model),
          () => videoSource(toolbar.model),
          true,
        );
      }
    }
  }
  function schedule() {
    // At most once per frame: a refresh that causes a mutation can never
    // become a microtask loop that blocks the page.
    if (!queued) {
      queued = true;
      requestAnimationFrame(refresh);
    }
  }
  const stopMounts = observeToolbarMounts(
    "affine-embed-card-toolbar, edgeless-element-toolbar-widget, edgeless-change-embed-card-button, .blocksuite-portal",
    schedule,
  );
  refresh();
  return {
    /** Update pressed states after the panel opens or closes. */
    refresh: schedule,
    dispose() {
      stopped = true;
      stopMounts();
      observer.disconnect();
      for (const root of roots)
        root
          .querySelectorAll(".knot-video-panel-wrapper")
          .forEach((node) => node.remove());
      document
        .querySelectorAll("affine-embed-card-toolbar")
        .forEach((toolbar) =>
          toolbar.shadowRoot
            ?.querySelectorAll(".knot-video-panel-wrapper")
            .forEach((node) => node.remove()),
        );
      roots.clear();
      buttons.clear();
    },
  };
}
