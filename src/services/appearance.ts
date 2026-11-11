import { getThemeObserver } from "@blocksuite/affine-shared/services";

export type Appearance = "light" | "dark" | "system";
const storageKey = "knot.appearance";
let preference: Appearance = "system";
let system: MediaQueryList;
let themeTransition: ViewTransition | undefined;

export function getAppearance(): Appearance {
  return preference;
}

function applyAppearance() {
  const theme =
    preference === "system" ? (system.matches ? "dark" : "light") : preference;
  // Initialize BlockSuite's lazy observer before its first editor render.
  // Its default is light even when the root already has data-theme="dark".
  const apply = () => {
    const observer = getThemeObserver();
    observer.theme$.value = theme as typeof observer.theme$.value;
    document.documentElement.dataset.theme = theme;
  };
  themeTransition?.skipTransition();
  const previous = document.documentElement.dataset.theme;
  if (
    previous &&
    previous !== theme &&
    document.startViewTransition &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    themeTransition = document.startViewTransition(apply);
  } else {
    apply();
  }
}

export function setAppearance(next: Appearance) {
  preference = next;
  try {
    localStorage.setItem(storageKey, next);
  } catch {
    // The theme still works for this session if storage is unavailable.
  }
  applyAppearance();
}

export function initializeAppearance() {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === "light" || saved === "dark" || saved === "system")
      preference = saved;
  } catch {
    // Default to the device preference when storage is unavailable.
  }
  system = window.matchMedia("(prefers-color-scheme: dark)");
  system.addEventListener("change", applyAppearance);
  applyAppearance();
}
