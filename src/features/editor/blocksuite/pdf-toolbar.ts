import type { AttachmentBlockModel } from "@blocksuite/blocks";
import type { AffineEditorContainer } from "@blocksuite/presets";
import type { PdfLocation } from "./pdf-highlights";
import { observeToolbarMounts } from "./toolbar-observer";

let hoveredEditor: AffineEditorContainer | undefined;
const toolbarOwners = new WeakMap<HTMLElement, AffineEditorContainer>();

type AttachmentElement = HTMLElement & { model?: AttachmentBlockModel };

/** Bridge the pinned BlockSuite attachment toolbars to Knot's local reader.
 * Page hover toolbars are portals; canvas toolbars render in a shadow root.
 */
export function observePdfToolbars(
  editor: AffineEditorContainer,
  open: (location: PdfLocation) => void,
) {
  let hovered: AttachmentBlockModel | undefined;
  let stopped = false;
  let queued = false;
  const roots = new Set<ShadowRoot>();
  const actions = new Map<HTMLElement, { button: HTMLElement; key: string }>();
  const isPdf = (model?: AttachmentBlockModel) =>
    model?.flavour === "affine:attachment" &&
    model.type === "application/pdf" &&
    !!model.sourceId;

  function install(toolbar: HTMLElement, model?: AttachmentBlockModel) {
    const previous = actions.get(toolbar);
    if (!isPdf(model)) {
      previous?.button.remove();
      actions.delete(toolbar);
      return;
    }
    if (
      previous?.key === model!.id &&
      previous.button.parentElement === toolbar
    )
      return;
    previous?.button.remove();
    const source = model!;
    const button = document.createElement("editor-icon-button");
    button.className = "knot-pdf-split-action";
    button.setAttribute("aria-label", "Open PDF reader");
    button.tooltip = "Open PDF reader";
    // Use the same native control and 20px/currentColor icon conventions as
    // Rename, Download and Caption, including their hover and tooltip behavior.
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
      if (!source.sourceId || !editor.isConnected) return;
      open({
        key: source.sourceId,
        name: source.name,
        documentId: source.doc.id,
        page: 1,
        rects: [],
      });
    });
    toolbar.prepend(button);
    actions.set(toolbar, { button, key: source.id });
  }

  function refresh() {
    queued = false;
    if (stopped) return;
    for (const root of roots) if (!root.host.isConnected) roots.delete(root);
    for (const [toolbar] of actions)
      if (!toolbar.isConnected) actions.delete(toolbar);
    for (const portal of [
      ...document.querySelectorAll<HTMLElement>(".blocksuite-portal"),
      ...editor.querySelectorAll<HTMLElement>(
        "edgeless-element-toolbar-widget",
      ),
    ]) {
      if (portal.shadowRoot && !roots.has(portal.shadowRoot)) {
        roots.add(portal.shadowRoot);
        observer.observe(portal.shadowRoot, { childList: true, subtree: true });
      }
    }
    for (const root of [document, ...roots]) {
      for (const toolbar of root.querySelectorAll<HTMLElement>(
        ".affine-attachment-toolbar",
      )) {
        // A portal retains its original attachment while the pointer crosses it.
        if (
          !actions.has(toolbar) &&
          hoveredEditor === editor &&
          !toolbarOwners.has(toolbar)
        ) {
          install(toolbar, hovered);
          if (actions.has(toolbar)) toolbarOwners.set(toolbar, editor);
        }
      }
    }
    const canvasToolbars = new Set(
      [editor, ...roots].flatMap((root) => [
        ...root.querySelectorAll<AttachmentElement>(
          "edgeless-change-attachment-button",
        ),
      ]),
    );
    for (const toolbar of canvasToolbars) {
      if (toolbar.shadowRoot && !roots.has(toolbar.shadowRoot)) {
        roots.add(toolbar.shadowRoot);
        observer.observe(toolbar.shadowRoot, {
          childList: true,
          subtree: true,
        });
      }
      const container = toolbar.shadowRoot ?? toolbar;
      // Use a real wrapper so both light and shadow DOM have the same lifecycle.
      let wrapper = container.querySelector<HTMLElement>(
        ".knot-pdf-toolbar-action",
      );
      if (!wrapper && isPdf(toolbar.model)) {
        wrapper = document.createElement("span");
        wrapper.className = "knot-pdf-toolbar-action";
        wrapper.style.display = "contents";
        container.prepend(wrapper);
      }
      if (wrapper) install(wrapper, toolbar.model);
    }
  }
  const observer = new MutationObserver(() => {
    if (!queued) {
      queued = true;
      queueMicrotask(refresh);
    }
  });
  const track = (event: PointerEvent) => {
    const block = event
      .composedPath()
      .find(
        (node): node is AttachmentElement =>
          node instanceof HTMLElement &&
          editor.contains(node) &&
          (node as AttachmentElement).model?.flavour === "affine:attachment",
      );
    if (block) {
      hovered = block.model;
      hoveredEditor = editor;
      // A portal can already exist when ownership changes between editors.
      if (!queued) {
        queued = true;
        queueMicrotask(refresh);
      }
    }
  };
  editor.addEventListener("pointerover", track, true);
  const stopMounts = observeToolbarMounts(
    ".blocksuite-portal, .affine-attachment-toolbar, edgeless-element-toolbar-widget, edgeless-change-attachment-button",
    refresh,
  );
  refresh();
  return () => {
    stopped = true;
    stopMounts();
    if (hoveredEditor === editor) hoveredEditor = undefined;
    observer.disconnect();
    editor.removeEventListener("pointerover", track, true);
    for (const [toolbar, { button }] of actions) {
      button.remove();
      toolbarOwners.delete(toolbar);
    }
    actions.clear();
    roots.clear();
  };
}
