type Box = { x: number; y: number; w: number; h: number };
type Viewport = {
  centerX: number;
  centerY: number;
  zoom: number;
  viewportBounds: Box;
  setCenter(x: number, y: number): void;
};

/** Pan the least distance that brings `box` fully into view (with a margin).
 * A box larger than the view is aligned to its top-left corner. */
export function revealInViewport(viewport: Viewport, box: Box, margin = 32) {
  const view = viewport.viewportBounds;
  const pad = margin / viewport.zoom;
  const shift = (start: number, size: number, viewStart: number, viewSize: number) => {
    const min = viewStart + pad;
    const max = viewStart + viewSize - pad;
    if (size > max - min || start < min) return start - min;
    if (start + size > max) return start + size - max;
    return 0;
  };
  const dx = shift(box.x, box.w, view.x, view.w);
  const dy = shift(box.y, box.h, view.y, view.h);
  if (dx || dy) viewport.setCenter(viewport.centerX + dx, viewport.centerY + dy);
}

/** Where a new note goes: centered in view, moved down past notes it would cover. */
export function placeInView(viewport: Viewport, size: { w: number; h: number }, notes: Box[]) {
  const x = viewport.centerX - size.w / 2;
  let y = viewport.centerY - size.h / 2;
  for (let i = 0; i < 100; i++) {
    const covered = notes.filter(
      (n) => x < n.x + n.w && x + size.w > n.x && y < n.y + n.h && y + size.h > n.y,
    );
    if (!covered.length) break;
    y = Math.max(...covered.map((n) => n.y + n.h)) + 40;
  }
  return { x: Math.round(x), y: Math.round(y) };
}

// BlockSuite keeps its viewport in sessionStorage. Keep the notebook center
// across app sessions, and seed its normal initialization at reading zoom.
export function rememberCanvasViewport(
  editor: HTMLElement,
  notebookId: string,
) {
  const key = `knot:canvas-center:${notebookId}`;
  const sessionKey = `blocksuite:${notebookId}:edgelessViewport`;
  const read = (storage: Storage, name: string): [number, number] | null => {
    try {
      const value = JSON.parse(storage.getItem(name) ?? "null");
      return value &&
        Number.isFinite(value.centerX) &&
        Number.isFinite(value.centerY)
        ? [value.centerX, value.centerY]
        : null;
    } catch {
      return null;
    }
  };
  const saved = read(localStorage, key) ?? read(sessionStorage, sessionKey);
  let center = saved ?? [0, 0];
  // Without a saved position, the first opening centers on the notes.
  let centerOnContent = saved === null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  let root: HTMLElementTagNameMap["affine-edgeless-root"] | null = null;
  let stopViewport: (() => void) | undefined;
  const save = () => {
    clearTimeout(timer);
    if (!dirty) return;
    try {
      localStorage.setItem(
        key,
        JSON.stringify({ centerX: center[0], centerY: center[1] }),
      );
      dirty = false;
    } catch {
      /* An unavailable preference store must not block editing. */
    }
  };
  const prepare = () => {
    try {
      sessionStorage.setItem(
        sessionKey,
        JSON.stringify({ zoom: 0.5, centerX: center[0], centerY: center[1] }),
      );
    } catch {
      /* The connected-root restoration below also sets reading zoom. */
    }
  };
  prepare();
  const bind = () => {
    if (root?.isConnected) return;
    stopViewport?.();
    root = editor.querySelector("affine-edgeless-root");
    if (!root) return;
    const current = root;
    const viewport = current.gfx.viewport;
    const openingCenter = [...center] as [number, number];
    let restored = false;
    const restore = () => {
      if (
        restored ||
        !current.isConnected ||
        viewport.width <= 0 ||
        viewport.height <= 0
      )
        return;
      restored = true;
      if (!read(localStorage, key)) dirty = true;
      const content = centerOnContent ? current.gfx.elementsBound : null;
      centerOnContent = false;
      viewport.setViewport(
        0.5,
        content && content.w > 0
          ? [content.x + content.w / 2, content.y + content.h / 2]
          : openingCenter,
      );
    };
    // When the canvas gets narrower or shorter (a side panel opens, the window
    // shrinks), keep the selected note visible. BlockSuite keeps the left edge
    // fixed, which otherwise hides notes under the new panel.
    let frame = 0;
    const keepSelection = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const selection = current.gfx.selection;
        if (!restored || !current.isConnected || !selection.selectedElements.length) return;
        revealInViewport(viewport, selection.selectedBound);
      });
    };
    const movement = viewport.viewportUpdated.on(() => {
      if (!restored) {
        queueMicrotask(restore);
        return;
      }
      if (
        !Number.isFinite(viewport.centerX) ||
        !Number.isFinite(viewport.centerY)
      )
        return;
      if (center[0] === viewport.centerX && center[1] === viewport.centerY)
        return;
      center = [viewport.centerX, viewport.centerY];
      dirty = true;
      clearTimeout(timer);
      timer = setTimeout(save, 250);
    });
    // A direct-open editor can first mount behind Library with zero geometry.
    const resize = viewport.sizeUpdated.on(() => {
      queueMicrotask(restore);
      keepSelection();
    });
    stopViewport = () => {
      movement.dispose();
      resize.dispose();
      cancelAnimationFrame(frame);
    };
    restore();
  };
  const observer = new MutationObserver(bind);
  observer.observe(editor, { childList: true, subtree: true });
  window.addEventListener("pagehide", save);
  return {
    prepare,
    dispose() {
      save();
      observer.disconnect();
      stopViewport?.();
      window.removeEventListener("pagehide", save);
    },
  };
}
