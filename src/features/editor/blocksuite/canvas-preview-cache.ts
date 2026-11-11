import { invoke } from "@tauri-apps/api/core";

// Disk cache for canvas card preview SVGs in the workspace's regenerable
// `cache/previews/` folder. A fingerprint covers everything that affects a
// card's pixels, so a hit is the exact SVG a fresh capture would produce. Every
// failure degrades to a normal capture: this cache never blocks loading.

const FORMAT = "knot-canvas-preview-v1";
const MAX_BYTES = 8 * 1024 * 1024;

type Model = {
  flavour: string;
  keys?: string[];
  children: Model[];
  [key: string]: unknown;
};

let build: string | undefined;
// Hashed production stylesheet and entry-script URLs change whenever the
// rendering code or styles do, so app updates never reuse stale pixels.
function buildIdentity() {
  build ??= Array.from(
    document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>(
      'script[type="module"][src], link[rel="stylesheet"][href]',
    ),
    (element) => ("src" in element ? element.src : element.href),
  ).join("|");
  return build;
}

function modelShape(model: Model): unknown {
  const props: Record<string, unknown> = {};
  // Position and stacking never change a card's own pixels.
  for (const key of model.keys ?? [])
    if (key !== "xywh" && key !== "index") props[key] = model[key];
  return [model.flavour, props, model.children.map(modelShape)];
}

async function sha256(text: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/** Fingerprint of a mounted card, or "" when it cannot be described safely. */
export async function previewFingerprint(
  editor: HTMLElement,
  model: unknown,
  content: HTMLElement,
) {
  try {
    const root = document.documentElement;
    const style = getComputedStyle(content);
    const description = JSON.stringify(
      [
        FORMAT,
        buildIdentity(),
        window.devicePixelRatio || 1,
        root.dataset.theme ?? "",
        root.getAttribute("style") ?? "",
        editor.dataset.theme ?? "",
        // Editor preferences (font family/size) live in the inline style.
        editor.getAttribute("style") ?? "",
        content.offsetWidth,
        Math.max(content.offsetHeight, content.scrollHeight),
        style.font,
        style.color,
        style.backgroundColor,
        // Rendered text covers values outside the card's own model, such as
        // linked notebook titles.
        content.textContent ?? "",
        modelShape(model as Model),
      ],
      (_key, value) =>
        value && typeof value.toDelta === "function" ? value.toDelta() : value,
    );
    return await sha256(description);
  } catch {
    return "";
  }
}

/** Cached SVGs in request order; misses and failures are null. */
export async function loadPreviews(
  document: string,
  keys: [note: string, fingerprint: string][],
): Promise<(Blob | null)[]> {
  const misses = keys.map(() => null);
  if (!keys.length) return misses;
  try {
    const data = await invoke<ArrayBuffer>("canvas_preview_load", {
      document,
      keys,
    });
    const view = new DataView(data);
    const result: (Blob | null)[] = [];
    let offset = 0;
    for (let i = 0; i < keys.length; i++) {
      if (offset + 4 > data.byteLength) return misses;
      const length = view.getUint32(offset, true);
      offset += 4;
      if (offset + length > data.byteLength) return misses;
      result.push(
        length
          ? new Blob([data.slice(offset, offset + length)], {
              type: "image/svg+xml",
            })
          : null,
      );
      offset += length;
    }
    return result;
  } catch {
    return misses;
  }
}

const queue = new Map<
  string,
  { document: string; note: string; fingerprint: string; blob: Blob }
>();
let flushing: Promise<void> | undefined;
let wake: (() => void) | undefined;

const idle = () =>
  new Promise<void>((resolve) => {
    wake = resolve;
    if ("requestIdleCallback" in window)
      requestIdleCallback(() => resolve(), { timeout: 2000 });
    else setTimeout(resolve, 200);
  });

/** Write a freshly captured SVG when the app is idle. Latest capture wins. */
export function savePreview(
  document: string,
  note: string,
  fingerprint: string,
  blob: Blob,
) {
  if (!fingerprint || blob.size > MAX_BYTES) return;
  queue.set(`${document}:${note}`, { document, note, fingerprint, blob });
  flushing ??= (async () => {
    try {
      while (queue.size) {
        await idle();
        const [key, entry] = queue.entries().next().value!;
        queue.delete(key);
        try {
          await invoke(
            "canvas_preview_save",
            new Uint8Array(await entry.blob.arrayBuffer()),
            {
              headers: {
                "knot-document": entry.document,
                "knot-note": entry.note,
                "knot-fingerprint": entry.fingerprint,
              },
            },
          );
        } catch {
          /* The next capture of this card retries. */
        }
      }
    } finally {
      flushing = undefined;
    }
  })();
}

/** Resolves once queued writes are on disk (used before closing and in tests). */
export async function flushPreviewCache() {
  while (flushing) {
    wake?.();
    await flushing;
  }
}

/** Drop cached cards that no longer exist in this document. */
export function prunePreviews(document: string, keep: string[]) {
  void invoke("canvas_preview_prune", { document, keep }).catch(() => {});
}
