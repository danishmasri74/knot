import {
  loadPreviews,
  previewFingerprint,
  prunePreviews,
  savePreview,
} from "./canvas-preview-cache";

// Inert SVG snapshots retain the actual browser layout (including table shadow
// roots) without keeping an interactive editor visible at overview zoom.
type NoteView = HTMLElement & {
  _knotSetPreview(url: string, bitmap?: HTMLCanvasElement): void;
  _knotDetailed: boolean;
  _knotResumeMount(): void;
  model: { id: string };
};

const properties = [
  "display",
  "position",
  "box-sizing",
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "top",
  "right",
  "bottom",
  "left",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "white-space",
  "word-break",
  "overflow-wrap",
  "text-align",
  "text-indent",
  "text-decoration",
  "text-transform",
  "vertical-align",
  "color",
  "background-color",
  "border-top",
  "border-right",
  "border-bottom",
  "border-left",
  "border-radius",
  "border-collapse",
  "border-spacing",
  "table-layout",
  "overflow",
  "overflow-x",
  "overflow-y",
  "opacity",
  "visibility",
  "flex-direction",
  "flex-wrap",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "align-items",
  "align-self",
  "align-content",
  "justify-content",
  "gap",
  "grid-template-columns",
  "grid-template-rows",
  "grid-column",
  "grid-row",
  "grid-auto-flow",
  "grid-auto-rows",
  "order",
  "list-style-type",
  "list-style-position",
  "object-fit",
  "object-position",
  "transform",
  "transform-origin",
  "z-index",
  "fill",
  "stroke",
  "stroke-width",
] as const;

const frame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const xhtml = "http://www.w3.org/1999/xhtml";
const ignored =
  "script,style,link,iframe,object,embed,[data-knot-note-preview]";

const preparation = new WeakMap<
  HTMLElement,
  (check: () => void) => Promise<void>
>();

export async function prepareCanvasNotePreviews(
  editor: HTMLElement,
  check: () => void,
) {
  await preparation.get(editor)?.(check);
}

// setTimeout chains are clamped to >=4ms after a few nested calls, which made
// 3ms capture slices spend over half their time idle. A message-channel task
// still lets queued input run first, without that clamp.
const yieldTask = () =>
  new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });

async function snapshot(
  content: HTMLElement,
  cancelled: () => boolean,
  // The loading screen owns input during preparation, so large slices only
  // need to keep the window responsive; background rebuilds stay small.
  sliceBudget = 3,
) {
  const width = content.offsetWidth;
  const height = Math.max(content.offsetHeight, content.scrollHeight);
  if (!width || !height || width > 4000 || height > 40000) return;
  let count = 0;
  let sliceStarted = performance.now();
  // Rich text repeats the same computed style across many wrappers. Store each
  // exact declaration once: thousands of inline CSS setters and duplicated XML
  // otherwise dominate startup and the SVG decoder's work.
  const styles = new Map<string, string>();
  async function copy(node: Node): Promise<Node | null> {
    if (cancelled()) throw new DOMException("Preview deferred", "AbortError");
    // Microtask-only recursion never lets input run. Yield between small chunks
    // so a wheel/drag can interrupt even one very large note's capture.
    if (performance.now() - sliceStarted > sliceBudget) {
      await yieldTask();
      sliceStarted = performance.now();
      if (cancelled()) throw new DOMException("Preview deferred", "AbortError");
    }
    if (node.nodeType === Node.TEXT_NODE)
      return document.createTextNode(node.textContent ?? "");
    if (!(node instanceof Element)) return null;
    if (++count > 8000) throw new Error("Preview is too complex");
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return null;
    if (node.matches("iframe,video,object,embed"))
      throw new Error("Media needs its live view");
    if (node.matches(ignored)) return null;
    if (node instanceof HTMLSlotElement) {
      const fragment = document.createDocumentFragment();
      for (const child of node.assignedNodes({ flatten: true })) {
        const cloned = await copy(child);
        if (cloned) fragment.append(cloned);
      }
      return fragment;
    }
    const svg = node.namespaceURI === "http://www.w3.org/2000/svg";
    const tag = node.localName.includes("-") ? "div" : node.localName;
    const clone = document.createElementNS(
      svg ? node.namespaceURI : xhtml,
      tag,
    ) as HTMLElement;
    if (svg) {
      for (const attr of node.attributes) {
        if (
          !attr.name.startsWith("on") &&
          !["href", "xlink:href", "style", "class"].includes(attr.name)
        )
          clone.setAttribute(attr.name, attr.value);
        if (
          ["href", "xlink:href"].includes(attr.name) &&
          attr.value.startsWith("#")
        )
          clone.setAttribute("href", attr.value);
      }
    }
    const declarations = properties
      .map((property) => `${property}:${style.getPropertyValue(property)};`)
      .join("");
    // The captured subtree starts inside the live layer, so its parent opacity
    // and canvas transform never enter the snapshot.
    let className = styles.get(declarations);
    if (!className) {
      className = `knot-preview-${styles.size}`;
      styles.set(declarations, className);
    }
    clone.setAttribute("class", className);
    if (node instanceof HTMLImageElement || node instanceof HTMLCanvasElement) {
      const image = document.createElementNS(xhtml, "img");
      image.setAttribute("class", className);
      if (node instanceof HTMLCanvasElement)
        image.setAttribute("src", node.toDataURL());
      else {
        if (!node.complete || !node.naturalWidth)
          throw new Error("Image is still loading");
        const canvas = document.createElement("canvas");
        canvas.width = node.naturalWidth;
        canvas.height = node.naturalHeight;
        if (canvas.width * canvas.height > 16_000_000)
          throw new Error("Image is too large");
        canvas.getContext("2d")!.drawImage(node, 0, 0);
        image.setAttribute("src", canvas.toDataURL());
      }
      return image;
    }
    if (
      node instanceof HTMLInputElement ||
      node instanceof HTMLTextAreaElement
    ) {
      clone.textContent = node.value;
      return clone;
    }
    const children = node.shadowRoot?.childNodes ?? node.childNodes;
    for (const child of children) {
      const cloned = await copy(child);
      if (cloned) clone.append(cloned);
    }
    return clone;
  }
  const cloned = await copy(content);
  if (!cloned) return;
  const sheet = document.createElementNS("http://www.w3.org/2000/svg", "style");
  sheet.textContent = [...styles]
    .map(
      ([declarations, className]) =>
        `.${className}{${declarations}animation:none;transition:none;caret-color:transparent;scrollbar-width:none;}`,
    )
    .join("");
  const serializer = new XMLSerializer();
  const markup = serializer.serializeToString(cloned);
  return new Blob(
    [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${serializer.serializeToString(sheet)}<foreignObject width="100%" height="100%">${markup}</foreignObject></svg>`,
    ],
    { type: "image/svg+xml" },
  );
}

type PreviewState = {
  version: number;
  url: string;
  bytes: number;
  hash: string;
  bitmap?: HTMLCanvasElement;
  fingerprint?: string;
  // Fingerprint computed by a cache lookup, reused by the capture that follows
  // a miss while the card is unchanged.
  described?: { version: number; fingerprint: string };
};

export function observeCanvasNotePreviews(editor: HTMLElement) {
  const states = new Map<NoteView, PreviewState>();
  const pending = new Set<NoteView>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let disposed = false;
  let quietUntil = 0;
  let preparing = false;
  let checkPreparation: (() => void) | undefined;
  const navigationHost = editor as HTMLElement & {
    _knotCanvasMovingUntil?: number;
  };
  let observedRoot: HTMLElementTagNameMap["affine-edgeless-root"] | null = null;
  let viewportSubscription: { dispose(): void } | undefined;
  const release = (note: NoteView) => {
    const state = states.get(note);
    if (state?.url) URL.revokeObjectURL(state.url);
    if (state) note._knotSetPreview("");
    states.delete(note);
    pending.delete(note);
  };
  const visible = (note: NoteView) => {
    const rect = note.getBoundingClientRect();
    const viewport = editor.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.right > viewport.left &&
      rect.left < viewport.right &&
      rect.bottom > viewport.top &&
      rect.top < viewport.bottom
    );
  };
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(
      () => {
        if (disposed) return;
        if (performance.now() < quietUntil) {
          schedule();
          return;
        }
        navigationHost._knotCanvasMovingUntil = 0;
        editor
          .querySelector<NoteView>("affine-edgeless-note")
          ?._knotResumeMount();
        void drain();
      },
      Math.max(160, quietUntil - performance.now()),
    );
  }
  const moving = () => {
    quietUntil = performance.now() + 250;
    navigationHost._knotCanvasMovingUntil = quietUntil;
    schedule();
  };
  const bindViewport = () => {
    const root = editor.querySelector("affine-edgeless-root");
    if (root === observedRoot) return;
    viewportSubscription?.dispose();
    viewportSubscription = undefined;
    observedRoot = null;
    if (!root?.isConnected) return;
    // The element may be inserted one mutation before its Gfx context exists.
    try {
      viewportSubscription = root.gfx.viewport.viewportUpdated.on(moving);
      observedRoot = root;
    } catch {
      /* Its next connected render will retry. */
    }
  };
  const failed = (note: NoteView, error: unknown, url: string) => {
    if (url) URL.revokeObjectURL(url);
    checkPreparation?.();
    if (error instanceof DOMException && error.name === "AbortError") {
      if (!disposed && states.has(note)) pending.add(note);
      schedule();
      return;
    }
    // Unsupported/loading media keeps its real DOM; never substitute a
    // flattened text approximation or hide a card because capture failed.
    note._knotSetPreview("");
  };
  async function capturePreview(
    note: NoteView,
    state: PreviewState,
    version: number,
    content: HTMLElement,
    deferred: () => boolean,
    defer: () => void,
  ): Promise<{ done: Promise<boolean> } | undefined> {
    let url = "";
    try {
      await document.fonts.ready;
      if (!preparing) await frame();
      if (deferred()) {
        defer();
        return;
      }
      // Describe the card before capturing it: an edit during capture bumps
      // its version, so a stale description is never saved with new pixels.
      const fingerprint =
        state.described?.version === version
          ? state.described.fingerprint
          : await previewFingerprint(editor, note.model, content);
      if (deferred()) {
        defer();
        return;
      }
      performance.mark("knot:canvas-preview-build", {
        detail: note.model.id,
      });
      const blob = await snapshot(content, deferred, preparing ? 40 : 3);
      if (!blob || blob.size > 4 * 1024 * 1024) {
        note._knotSetPreview("");
        return;
      }
      // The hash only detects an unchanged rebuild of an existing preview.
      // A first capture has nothing to compare, so skip reading the blob.
      let hash = "";
      if (state.url) {
        const digest = new Uint8Array(
          await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
        );
        hash = [...digest]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
      }
      if (
        disposed ||
        !note.isConnected ||
        states.get(note) !== state ||
        state.version !== version
      )
        return;
      if (deferred()) {
        defer();
        return;
      }
      if (hash && hash === state.hash && state.url) {
        note._knotSetPreview(state.url, state.bitmap);
        return;
      }
      url = URL.createObjectURL(blob);
      const image = new Image();
      image.src = url;
      return {
        done: finish(
          note,
          state,
          version,
          blob,
          hash,
          image,
          url,
          deferred,
          defer,
          fingerprint,
          true,
        ),
      };
    } catch (error) {
      failed(note, error, url);
    }
  }
  async function finish(
    note: NoteView,
    state: PreviewState,
    version: number,
    blob: Blob,
    hash: string,
    image: HTMLImageElement,
    url: string,
    deferred: () => boolean,
    defer: () => void,
    fingerprint: string,
    save: boolean,
  ): Promise<boolean> {
    try {
      await image.decode();
      // Input can resume while decoding. Do not rasterize or replace a
      // preview in the middle of that gesture.
      if (deferred()) {
        URL.revokeObjectURL(url);
        defer();
        return false;
      }
      // foreignObject SVGs can be painted onto a canvas even when browser
      // readback is restricted. We only display these pixels; exports use
      // the live editor and explicitly ignore this decorative layer.
      const scale = Math.min(
        1,
        (window.devicePixelRatio || 1) * 0.5,
        2048 / image.naturalHeight,
        1024 / image.naturalWidth,
      );
      const bitmap = document.createElement("canvas");
      bitmap.width = Math.max(1, Math.round(image.naturalWidth * scale));
      bitmap.height = Math.max(1, Math.round(image.naturalHeight * scale));
      bitmap.style.cssText =
        "display:block;width:100%;height:auto;pointer-events:none";
      bitmap
        .getContext("2d")!
        .drawImage(image, 0, 0, bitmap.width, bitmap.height);
      if (
        disposed ||
        !note.isConnected ||
        states.get(note) !== state ||
        state.version !== version
      ) {
        URL.revokeObjectURL(url);
        return false;
      }
      const previous = state.url;
      state.url = url;
      state.bytes = blob.size + bitmap.width * bitmap.height * 4;
      state.hash = hash;
      state.bitmap = bitmap;
      state.fingerprint = fingerprint;
      note._knotSetPreview(url, bitmap);
      if (save && fingerprint)
        savePreview(documentId(), note.model.id, fingerprint, blob);
      // Keep the old image alive until Lit has committed the replacement.
      if (previous) requestAnimationFrame(() => URL.revokeObjectURL(previous));
      let bytes = [...states.values()].reduce(
        (sum, item) => sum + item.bytes,
        0,
      );
      const evictionOrder =
        bytes > 64 * 1024 * 1024
          ? [...states].sort(
              ([a], [b]) => Number(visible(a)) - Number(visible(b)),
            )
          : [];
      for (const [cached, entry] of evictionOrder) {
        if (bytes <= 64 * 1024 * 1024) break;
        if (cached === note) continue;
        bytes -= entry.bytes;
        cached._knotSetPreview("");
        release(cached);
      }
      return true;
    } catch (error) {
      failed(note, error, url);
      return false;
    }
  }
  const documentId = () =>
    (editor as HTMLElementTagNameMap["affine-editor-container"]).doc.id;
  const guards = (note: NoteView) => {
    const state = states.get(note)!;
    const version = state.version;
    const deferred = () => {
      checkPreparation?.();
      return (
        disposed ||
        state.version !== version ||
        (!preparing && (note._knotDetailed || performance.now() < quietUntil))
      );
    };
    const defer = () => {
      if (!disposed && states.get(note) === state) pending.add(note);
      if (!disposed) schedule();
    };
    return { state, version, deferred, defer };
  };
  // Reuse previews saved by an earlier session for cards whose fingerprint is
  // unchanged. All cached SVGs decode concurrently; misses and failures stay
  // queued for a normal capture.
  async function restore(check: () => void) {
    const candidates: { note: NoteView; content: HTMLElement }[] = [];
    for (const note of pending) {
      const content = note.querySelector<HTMLElement>(
        ".affine-note-block-container",
      );
      if (content && note.isConnected && !states.get(note)?.url)
        candidates.push({ note, content });
    }
    if (!candidates.length) return;
    const fingerprints = await Promise.all(
      candidates.map(({ note, content }) =>
        previewFingerprint(editor, note.model, content),
      ),
    );
    check();
    candidates.forEach(({ note }, i) => {
      const state = states.get(note);
      if (state)
        state.described = {
          version: state.version,
          fingerprint: fingerprints[i],
        };
    });
    const keys = candidates
      .map(
        ({ note }, i) => [note.model.id, fingerprints[i]] as [string, string],
      )
      .filter(([, fingerprint]) => fingerprint);
    const blobs = await loadPreviews(documentId(), keys);
    check();
    const found = new Map(keys.map(([id], i) => [id, blobs[i]]));
    await Promise.all(
      candidates.map(async ({ note }, i) => {
        const blob = found.get(note.model.id);
        if (!blob) return;
        pending.delete(note);
        const { state, version, deferred, defer } = guards(note);
        const url = URL.createObjectURL(blob);
        const image = new Image();
        image.src = url;
        performance.mark("knot:canvas-preview-cache-hit", {
          detail: note.model.id,
        });
        const restored = await finish(
          note,
          state,
          version,
          blob,
          "",
          image,
          url,
          deferred,
          defer,
          fingerprints[i],
          false,
        );
        // A corrupt or unreadable cached SVG falls back to a fresh capture.
        if (!restored && !disposed && states.get(note) === state)
          pending.add(note);
      }),
    );
  }
  async function drain() {
    if (running || disposed) return;
    if (!preparing && performance.now() < quietUntil) {
      schedule();
      return;
    }
    running = true;
    const decoding = new Set<Promise<boolean>>();
    try {
      for (const note of [...pending]) {
        checkPreparation?.();
        if (disposed) break;
        if (!preparing && performance.now() < quietUntil) {
          schedule();
          break;
        }
        if (!note.isConnected || !editor.contains(note)) {
          release(note);
          continue;
        }
        // Keep dirty entries queued while live content is displayed. Building
        // invisible thumbnails between gestures competes with normal panning.
        // The next viewport change wakes this queue when overview needs them.
        if (!preparing && (note._knotDetailed || !visible(note))) continue;
        pending.delete(note);
        const { state, version, deferred, defer } = guards(note);
        const content = note.querySelector<HTMLElement>(
          ".affine-note-block-container",
        );
        if (!content) continue;
        // Decoding a foreignObject SVG mostly waits on the renderer. While the
        // loading screen owns input, snapshot the next card meanwhile.
        const tail = await capturePreview(
          note,
          state,
          version,
          content,
          deferred,
          defer,
        );
        if (!tail) continue;
        if (!preparing) {
          await tail.done;
          continue;
        }
        const done = tail.done;
        decoding.add(done);
        const settle = () => decoding.delete(done);
        done.then(settle, settle);
        if (decoding.size >= 4) await Promise.race(decoding);
      }
      await Promise.all(decoding);
    } finally {
      await Promise.allSettled(decoding);
      running = false;
      if (
        !disposed &&
        [...pending].some(
          (note) => note.isConnected && !note._knotDetailed && visible(note),
        )
      )
        schedule();
    }
  }
  const request = (note: NoteView) => {
    if (!states.has(note))
      states.set(note, { version: 0, url: "", bytes: 0, hash: "" });
    states.get(note)!.version++;
    pending.add(note);
    schedule();
  };
  preparation.set(editor, async (check) => {
    // The loading screen owns interaction while this runs. Capture every card
    // once, without viewport filtering or a separate animation frame per card.
    while (running || preparing) {
      await frame();
      check();
    }
    preparing = true;
    checkPreparation = check;
    try {
      for (const note of editor.querySelectorAll<NoteView>(
        "affine-edgeless-note",
      ))
        if (!states.has(note)) request(note);
      clearTimeout(timer);
      // Hold the drain lock so a timer-started capture cannot race a restore.
      running = true;
      try {
        await restore(check);
      } finally {
        running = false;
      }
      while (pending.size) {
        check();
        clearTimeout(timer);
        await drain();
        check();
      }
      const doc = (editor as HTMLElementTagNameMap["affine-editor-container"])
        .doc;
      prunePreviews(
        doc.id,
        doc.getBlocksByFlavour("affine:note").map((block) => block.id),
      );
    } finally {
      preparing = false;
      checkPreparation = undefined;
    }
  });
  const capture = (event: Event) => {
    const note = event.target as NoteView;
    if (typeof note._knotSetPreview === "function") request(note);
  };
  // Shadow-root table edits must invalidate only their owning card. Canvas
  // metadata, shape moves and height measurements don't change note pixels.
  const doc = (editor as HTMLElementTagNameMap["affine-editor-container"]).doc;
  const blockSubscription = doc.slots.blockUpdated.on((event) => {
    if (event.type === "update" && ["xywh", "index"].includes(event.props.key))
      return;
    let model = doc.getBlock(
      event.type === "delete" ? event.parent : event.id,
    )?.model;
    while (model && model.flavour !== "affine:note")
      model = model.parent ?? undefined;
    if (!model) return;
    for (const note of states.keys())
      if (note.model.id === model.id) {
        if (!visible(note)) note._knotSetPreview("");
        request(note);
        break;
      }
  });
  const theme = new MutationObserver(() => {
    for (const note of states.keys()) {
      note._knotSetPreview("");
      request(note);
    }
  });
  theme.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  theme.observe(editor, {
    attributes: true,
    attributeFilter: ["style", "data-theme"],
  });
  const removed = new MutationObserver((records) => {
    bindViewport();
    if (records.some((record) => record.removedNodes.length))
      for (const note of states.keys())
        if (!editor.contains(note)) release(note);
  });
  removed.observe(editor, { subtree: true, childList: true });
  editor.addEventListener("knot-note-preview", capture);
  editor.addEventListener("wheel", moving, { passive: true, capture: true });
  const dragging = (event: PointerEvent) => {
    if (event.buttons) moving();
  };
  editor.addEventListener("pointermove", dragging, {
    passive: true,
    capture: true,
  });
  bindViewport();
  return () => {
    disposed = true;
    preparation.delete(editor);
    clearTimeout(timer);
    editor.removeEventListener("knot-note-preview", capture);
    blockSubscription.dispose();
    viewportSubscription?.dispose();
    editor.removeEventListener("wheel", moving, true);
    editor.removeEventListener("pointermove", dragging, true);
    delete navigationHost._knotCanvasMovingUntil;
    theme.disconnect();
    removed.disconnect();
    for (const note of states.keys()) release(note);
  };
}
