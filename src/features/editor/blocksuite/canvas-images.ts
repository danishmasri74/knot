import type { ImageBlockModel } from "@blocksuite/blocks";

export function observeCanvasImages(editor: HTMLElement) {
  const selector = ".affine-image-container";
  function refresh(container: HTMLElement) {
    if (!container.closest("affine-edgeless-root")) return;
    const block = container.closest<
      HTMLElement & {
        model: ImageBlockModel;
        loading: boolean;
        error: boolean;
      }
    >("affine-image, affine-edgeless-image");
    if (!block) return;
    const image =
      container.querySelector<HTMLImageElement>(".resizable-img img");
    const loading =
      !block.error && (block.loading || (!!image && !image.complete));
    container.toggleAttribute("data-knot-loading", loading);
    if (loading && block.model.width && block.model.height) {
      container.style.setProperty(
        "--knot-image-width",
        `${block.model.width}px`,
      );
      container.style.setProperty(
        "--knot-image-ratio",
        `${block.model.width} / ${block.model.height}`,
      );
    }
  }

  const observer = new MutationObserver((records) => {
    const changed = new Set<HTMLElement>();
    for (const record of records) {
      const parent = record.target.parentElement;
      const container = (
        record.target instanceof Element ? record.target : parent
      )?.closest<HTMLElement>(selector);
      if (container) changed.add(container);
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.matches(selector)) changed.add(node);
        node
          .querySelectorAll<HTMLElement>(selector)
          .forEach((item) => changed.add(item));
      }
    }
    changed.forEach(refresh);
  });
  const settled = (event: Event) => {
    if (!(event.target instanceof HTMLImageElement)) return;
    const container = event.target.closest<HTMLElement>(selector);
    if (container) refresh(container);
  };
  observer.observe(editor, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["src"],
  });
  editor.addEventListener("load", settled, true);
  editor.addEventListener("error", settled, true);
  return () => {
    observer.disconnect();
    editor.removeEventListener("load", settled, true);
    editor.removeEventListener("error", settled, true);
  };
}
