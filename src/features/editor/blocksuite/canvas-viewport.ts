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
  let center = read(localStorage, key) ??
    read(sessionStorage, sessionKey) ?? [0, 0];
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
      viewport.setViewport(0.5, openingCenter);
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
    const resize = viewport.sizeUpdated.on(() => queueMicrotask(restore));
    stopViewport = () => {
      movement.dispose();
      resize.dispose();
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
