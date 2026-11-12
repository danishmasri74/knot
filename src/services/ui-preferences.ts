// Knot keeps UI preferences (theme, editor settings, sidebar recents and pins,
// layouts) in the WebView's localStorage. WebView2 can reset that storage as a
// whole, so every change is mirrored to ui-preferences.json in Knot's data
// folder, and a reset storage is refilled from it at startup.
//
// Import nothing here that reads localStorage: this runs before the app loads.
import { invoke, isTauri } from "@tauri-apps/api/core";

/** Present while this localStorage has been mirrored; missing after a reset. */
const MARKER = "knot.ui-mirror.v1";
const MAX_VALUE = 64 * 1024;

/** Preferences only. Drafts (which can hold images) stay in the WebView. */
export function isDurablePreference(key: string) {
  return key.startsWith("knot.") && key !== MARKER && !key.startsWith("knot.ai.draft");
}

function snapshot() {
  const values: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !isDurablePreference(key)) continue;
    const value = localStorage.getItem(key);
    if (value !== null && value.length <= MAX_VALUE) values[key] = value;
  }
  return values;
}

/** Fill a reset storage from the saved copy. Keys already present win. */
export function refill(storage: Storage, stored: string | null) {
  if (!stored) return 0;
  let count = 0;
  for (const [key, value] of Object.entries(JSON.parse(stored) as Record<string, unknown>)) {
    if (!isDurablePreference(key) || typeof value !== "string") continue;
    if (storage.getItem(key) !== null) continue;
    storage.setItem(key, value);
    count++;
  }
  return count;
}

let timer: ReturnType<typeof setTimeout> | undefined;
let saved = "";
let chain: Promise<void> = Promise.resolve();
let started = false;

/** Write the mirror now (also called while closing Knot). */
export function flushUiPreferences(): Promise<void> {
  if (!started) return chain;
  clearTimeout(timer);
  timer = undefined;
  chain = chain.then(async () => {
    const json = JSON.stringify(snapshot());
    if (json === saved) return;
    try {
      await invoke("write_ui_preferences", { json });
      saved = json;
    } catch (e) {
      console.warn("Could not save the preferences copy", e);
    }
  });
  return chain;
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => void flushUiPreferences(), 300);
}

/** Run once, before the app's modules load. */
export async function startUiPreferences() {
  if (started || !isTauri()) return;
  try {
    if (localStorage.getItem(MARKER) === null) {
      const restored = refill(localStorage, await invoke<string | null>("read_ui_preferences"));
      if (restored) console.info(`Restored ${restored} preferences after a storage reset`);
      localStorage.setItem(MARKER, "1");
    }
  } catch (e) {
    console.warn("Could not restore preferences", e);
  }
  started = true;
  const proto = Storage.prototype;
  const { setItem, removeItem, clear } = proto;
  proto.setItem = function (this: Storage, key: string, value: string) {
    setItem.call(this, key, value);
    if (this === window.localStorage && isDurablePreference(key)) schedule();
  };
  proto.removeItem = function (this: Storage, key: string) {
    removeItem.call(this, key);
    if (this === window.localStorage && isDurablePreference(key)) schedule();
  };
  proto.clear = function (this: Storage) {
    clear.call(this);
    if (this === window.localStorage) schedule();
  };
  void flushUiPreferences();
}
