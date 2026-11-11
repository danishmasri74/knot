import { invoke } from "@tauri-apps/api/core";
export interface BrowserStatus {
  session: string;
  url: string;
  title: string;
  back: boolean;
  forward: boolean;
  loading: boolean;
  error: string | null;
  externalUrl: string | null;
}
export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface BrowserRequest {
  key: number;
  url: string;
}
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation);
  queue = result.catch(() => {});
  return result;
}
let handled = -1;
let placementRevision = 0;
export const browserApi = {
  status: () => serial(() => invoke<BrowserStatus | null>("browser_status")),
  ensure: (request: BrowserRequest | null, bounds: BrowserBounds) =>
    serial(async () => {
      let status = await invoke<BrowserStatus | null>("browser_status");
      if (request && request.key !== handled) {
        if (status) await invoke("browser_navigate", { url: request.url });
        else await invoke("browser_create", { url: request.url, bounds });
        handled = request.key;
        status = await invoke<BrowserStatus | null>("browser_status");
      }
      return status;
    }),
  bounds: (bounds: BrowserBounds, visible: boolean) => {
    const revision = ++placementRevision;
    return serial(() =>
      revision === placementRevision
        ? invoke<void>("browser_bounds", {
            bounds,
            visible:
              visible &&
              !document.documentElement.hasAttribute("data-pane-gesture"),
          })
        : Promise.resolve(),
    );
  },
  action: (action: "back" | "forward" | "reload" | "stop" | "focus") =>
    serial(() => invoke<void>("browser_action", { action })),
  external: (url: string) => invoke<void>("browser_open_external", { url }),
  dispose: () =>
    serial(async () => {
      await invoke("browser_dispose");
      handled = -1;
    }),
};
export function browserBounds(element: HTMLElement): BrowserBounds {
  const rect = element.getBoundingClientRect();
  const scale = window.devicePixelRatio;
  return {
    x: Math.max(0, Math.round(rect.x * scale)),
    y: Math.max(0, Math.round(rect.y * scale)),
    width: Math.max(1, Math.round(rect.width * scale)),
    height: Math.max(1, Math.round(rect.height * scale)),
  };
}
export function getBrowserWidth() {
  try {
    const width = Number(localStorage.getItem("knot.browser-width"));
    return width >= 320 && width <= 1000 ? width : 520;
  } catch {
    return 520;
  }
}
export function saveBrowserWidth(width: number) {
  try {
    localStorage.setItem("knot.browser-width", String(width));
  } catch {
    /* Session geometry. */
  }
}
