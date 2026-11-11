import { attachments } from "../../../services/workspace";
import { pdfSourceUrl } from "./pdf-highlights";
import type { AttachmentBlockModel } from "@blocksuite/blocks";
import type { AffineEditorContainer } from "@blocksuite/presets";

/** BlockSuite 0.19 scales embeds using card dimensions. Keep the viewer at
 * actual canvas dimensions instead, and give card-to-embed transitions room. */
export function observeCanvasAttachments(editor: AffineEditorContainer) {
  const states = new Map<string, { embed: boolean; card: string }>();
  let pending = false;
  let stopped = false;
  const previews = new WeakSet<HTMLElement>();
  const refresh = () => {
    pending = false;
    if (stopped) return;
    for (const element of editor.querySelectorAll<
      HTMLElement & { model: AttachmentBlockModel }
    >("affine-edgeless-attachment")) {
      const model = element.model;
      const previous = states.get(model.id);
      const embed = !!model.embed;
      const bounds = JSON.parse(model.xywh) as number[];
      if (bounds.length !== 4 || !bounds.every(Number.isFinite)) continue;
      states.set(model.id, { embed, card: previous?.card ?? model.xywh });
      if (
        embed &&
        ((previous && !previous.embed) ||
          (!previous && bounds[3] < bounds[2] * 0.8))
      ) {
        const width = Math.max(480, bounds[2]);
        // PDF viewers preserve page proportions internally; never scale their pixels.
        const height =
          model.type === "application/pdf"
            ? width * Math.SQRT2
            : (width * 9) / 16;
        model.doc.updateBlock(model, {
          xywh: `[${bounds[0]},${bounds[1]},${width},${height}]`,
        });
      } else if (!embed && previous?.embed) {
        const card = JSON.parse(previous.card) as number[];
        model.doc.updateBlock(model, {
          xywh: `[${bounds[0]},${bounds[1]},${card[2]},${card[3]}]`,
        });
      } else if (!embed) {
        states.set(model.id, { embed, card: model.xywh });
      }
      element.classList.toggle("knot-attachment-embed", embed);
      const container = element.querySelector<HTMLElement>(
        ".affine-attachment-embed-container",
      );
      if (
        embed &&
        model.type === "application/pdf" &&
        model.sourceId &&
        container &&
        !previews.has(container)
      ) {
        previews.add(container);
        const preview = document.createElement("div");
        preview.className = "knot-canvas-pdf";
        preview.textContent = "Loading PDF…";
        preview.setAttribute("aria-busy", "true");
        container.append(preview);
        const canvas = document.createElement("canvas");
        const sourceId = model.sourceId;
        void (async () => {
          const { renderCanvasPdf } = await import("./canvas-pdf");
          const ratio = await renderCanvasPdf(
            new Uint8Array(await attachments.get(sourceId)),
            canvas,
          );
          if (stopped || !preview.isConnected || !model.embed) return;
          preview.removeAttribute("aria-busy");
          preview.replaceChildren(canvas);
          const link = document.createElement("a");
          link.href = pdfSourceUrl({
            key: sourceId,
            name: model.name,
            documentId: model.doc.id,
            page: 1,
            rects: [],
          });
          link.textContent = "Open PDF reader";
          preview.append(link);
          const current = JSON.parse(model.xywh) as number[];
          if (Math.abs(current[3] - current[2] * Math.SQRT2) < 1)
            model.doc.updateBlock(model, {
              xywh: `[${current[0]},${current[1]},${current[2]},${current[2] * ratio + 36}]`,
            });
        })().catch(() => {
          preview.removeAttribute("aria-busy");
          if (preview.isConnected)
            preview.textContent =
              "PDF preview unavailable. Open PDF reader from Document actions.";
        });
      }

      const current = JSON.parse(model.xywh) as number[];
      for (const [name, value] of [
        ["--knot-embed-width", `${current[2]}px`],
        ["--knot-embed-height", `${current[3]}px`],
      ]) {
        if (element.style.getPropertyValue(name) !== value)
          element.style.setProperty(name, value);
      }
    }
  };
  const observer = new MutationObserver(() => {
    if (!pending) {
      pending = true;
      queueMicrotask(refresh);
    }
  });
  observer.observe(editor, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style"],
  });
  return () => {
    stopped = true;
    observer.disconnect();
  };
}
