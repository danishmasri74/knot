import { prepareCanvasNotePreviews } from "../features/editor/blocksuite/canvas-note-preview";

const frame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const runs = new WeakMap<HTMLElement, symbol>();
const preparedRoots = new WeakSet<Element>();

export async function waitForEditorView(
  editor: HTMLElement,
  mode: "page" | "edgeless",
  options: { content?: boolean; targetId?: string; signal?: AbortSignal } = {},
) {
  const container = editor as HTMLElementTagNameMap["affine-editor-container"];
  const doc = container.doc;
  const run = Symbol();
  runs.set(editor, run);
  const active = () =>
    runs.get(editor) === run &&
    editor.isConnected &&
    container.doc === doc &&
    container.mode === mode &&
    !options.signal?.aborted;
  const root = () =>
    editor.querySelector(
      mode === "page" ? "affine-page-root" : "affine-edgeless-root",
    );
  const deadline = performance.now() + 120000;
  const promotedImages = new Set<HTMLImageElement>();
  let activeRoot: Element | null = null;
  const ensureActive = () => {
    if (!active() || (activeRoot && root() !== activeRoot))
      throw new DOMException("View changed", "AbortError");
    if (performance.now() >= deadline)
      throw new Error(
        "The notebook view is still loading. Reopen it to try again.",
      );
  };
  // A disconnected BlockSuite render queue may never resolve its promise.
  // Check cancellation every frame instead of retaining the old input lock.
  const until = async (promise: PromiseLike<unknown>) => {
    let done = false;
    let failure: unknown;
    Promise.resolve(promise).then(
      () => {
        done = true;
      },
      (error) => {
        failure = error;
        done = true;
      },
    );
    while (!done) {
      await frame();
      ensureActive();
    }
    ensureActive();
    if (failure) throw failure;
  };
  let changed = performance.now();
  // Preview layers are absolutely positioned decorations added by this gate's
  // own preparation. They never move content, so they must not restart the
  // quiet period that waits for real layout to settle.
  const previewOnly = (record: MutationRecord) => {
    const target =
      record.target instanceof Element
        ? record.target
        : record.target.parentElement;
    if (target?.closest("[data-knot-note-preview]")) return true;
    if (record.type !== "childList") return false;
    const nodes = [...record.addedNodes, ...record.removedNodes];
    return (
      nodes.length > 0 &&
      nodes.every((node) =>
        node instanceof Element
          ? node.matches("[data-knot-note-preview]")
          : node.nodeType === Node.COMMENT_NODE || !node.textContent?.trim(),
      )
    );
  };
  const observer = new MutationObserver((records) => {
    if (records.some((record) => !previewOnly(record)))
      changed = performance.now();
  });
  observer.observe(editor, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "data-knot-loading", "aria-busy"],
  });
  try {
    let drainedViewport: HTMLElement | undefined;
    let previewsPrepared = false;
    if (mode === "edgeless")
      editor.setAttribute("data-knot-canvas-preparing", "");
    while (active() && performance.now() < deadline) {
      await frame();
      ensureActive();
      const view = root();
      if (view) activeRoot = view;
      if (!active()) throw new DOMException("View changed", "AbortError");
      if (!view) continue;
      if (mode === "edgeless") {
        await until(view.updateComplete);
        if (!active() || root() !== view) continue;
        const canvas = view as HTMLElementTagNameMap["affine-edgeless-root"];
        const viewport = canvas.service.viewport;
        const bounds = canvas.host.getBoundingClientRect();
        if (!(bounds.width > 0 && bounds.height > 0)) continue;
        const cached = viewport.boundingClientRect;
        if (
          Math.abs(viewport.left - bounds.left) > 0.5 ||
          Math.abs(viewport.top - bounds.top) > 0.5 ||
          Math.abs(cached.left - bounds.left) > 0.5 ||
          Math.abs(cached.top - bounds.top) > 0.5 ||
          Math.abs(viewport.width - bounds.width) > 0.5 ||
          Math.abs(viewport.height - bounds.height) > 0.5
        ) {
          // The host can mount while Library is visible, then move without
          // resizing. Correct hit-test offsets without changing the saved center.
          const center: [number, number] = [viewport.centerX, viewport.centerY];
          viewport.onResize();
          viewport.setCenter(...center);
        }

        if (
          !canvas.querySelector("gfx-viewport") ||
          !(viewport.width > 0 && viewport.height > 0) ||
          ![viewport.center.x, viewport.center.y, viewport.zoom].every(
            Number.isFinite,
          )
        )
          continue;
        if (options.targetId) {
          const block = canvas.std.view.getBlock(options.targetId);
          if (!block?.isConnected) continue;
          await until(block.updateComplete);
          if (!block.querySelector(".affine-note-block-container")) continue;
          if (preparedRoots.has(view)) return;
        }
      }
      await until(view.updateComplete);
      if (view !== root()) continue;
      if (mode === "edgeless") {
        const viewport =
          view.querySelector<
            HTMLElementTagNameMap["affine-edgeless-root"]["gfxViewportElm"]
          >("gfx-viewport");
        if (!viewport) continue;
        if (viewport !== drainedViewport) {
          // BlockSuite mounts canvas blocks in batches of six per frame.
          // Join the same FIFO as the blocks, then await their Lit updates.
          await until(viewport.scheduleUpdateChildren("knot-view-transition"));
          // Prepare offscreen notes too: crossing a viewport edge must not
          // mount a rich editor after the loading screen has disappeared.
          for (const note of view.querySelectorAll("affine-edgeless-note")) {
            (
              note as HTMLElement & { _knotMount?: (force: boolean) => void }
            )._knotMount?.(!!options.content);
          }
          await until(
            Promise.all(
              Array.from(
                view.querySelectorAll("affine-edgeless-note"),
                (note) => note.updateComplete,
              ),
            ),
          );
          await until(document.fonts.ready);
          drainedViewport = viewport;
          continue;
        }
      }
      // Full canvas preparation includes offscreen media. A lazy image outside
      // the viewport otherwise never starts loading, while its marker keeps
      // this gate locked. Restore the normal policy after preparation/cancel.
      if (mode === "edgeless")
        for (const image of view.querySelectorAll<HTMLImageElement>(
          'img[loading="lazy"]',
        )) {
          promotedImages.add(image);
          image.loading = "eager";
        }
      if (performance.now() - changed < 180) continue;
      const area = editor.getBoundingClientRect();
      const pending = Array.from(
        view.querySelectorAll(
          "img, affine-image, affine-edgeless-image, [data-knot-loading], .knot-canvas-pdf[aria-busy=true]",
        ),
      ).some((el) => {
        if (el instanceof HTMLImageElement && el.complete) return false;
        if (
          el.matches("affine-image, affine-edgeless-image") &&
          !("loading" in el && el.loading)
        )
          return false;
        if (mode === "edgeless") return true;
        const box = el.getBoundingClientRect();
        return (
          box.width > 0 &&
          box.height > 0 &&
          box.right > area.left &&
          box.left < area.right &&
          box.bottom > area.top &&
          box.top < area.bottom
        );
      });
      if (pending) {
        await new Promise((resolve) => setTimeout(resolve, 80));
        continue;
      }
      if (mode === "edgeless" && !options.content && !previewsPrepared) {
        await until(prepareCanvasNotePreviews(editor, ensureActive));
        previewsPrepared = true;
        continue;
      }
      if (mode === "edgeless") {
        preparedRoots.add(view);
        performance.mark("knot:canvas-viewport-ready");
      }
      return;
    }
    if (!active()) throw new DOMException("View changed", "AbortError");
    throw new Error(
      editor.isConnected
        ? "The notebook view is still loading. Reopen it to try again."
        : "The notebook view was closed before it finished loading.",
    );
  } finally {
    for (const image of promotedImages)
      if (image.loading === "eager") image.loading = "lazy";
    observer.disconnect();
    if (runs.get(editor) === run) {
      // The editor only hides blocks that have left its previous visible set.
      // Explicitly cull the newly prepared, never-visible offscreen notes too.
      const canvas = editor.querySelector("affine-edgeless-root");
      const viewport =
        canvas?.querySelector<
          HTMLElementTagNameMap["affine-edgeless-root"]["gfxViewportElm"]
        >("gfx-viewport");
      const visible = viewport?.getModelsInViewport?.();
      if (visible && !options.content)
        for (const note of canvas!.querySelectorAll("affine-edgeless-note"))
          note.style.display = visible.has(note.model) ? "" : "none";
      editor.removeAttribute("data-knot-canvas-preparing");
    }
  }
}
