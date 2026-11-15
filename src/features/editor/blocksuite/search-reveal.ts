import type { AffineEditorContainer } from "@blocksuite/presets";

/** Reuse an already visible page instead of applying the default note-opening preference. */
export function isSearchResultOnPage(
  editor: AffineEditorContainer | undefined,
  documentId: string,
  noteId?: string,
) {
  if (!editor || editor.mode !== "page" || editor.doc.id !== documentId)
    return false;
  const root = editor.querySelector(
    "affine-page-root:not([data-outgoing-view])",
  );
  if (!root?.getClientRects().length) return false;
  return (
    !noteId ||
    [...root.querySelectorAll<HTMLElement>("affine-note")].some(
      (note) =>
        note.dataset.blockId === noteId && note.getClientRects().length > 0,
    )
  );
}

const frame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
type CanvasNote = HTMLElement & {
  _knotMount?: (force: boolean) => void;
  _knotForced?: boolean;
  requestUpdate?: () => void;
  updateComplete?: Promise<unknown>;
};

/** Match rendered text across inline formatting, without touching editor DOM or selection. */
export function searchTextRanges(root: Element, query: string): Range[] {
  const needle = query.toLowerCase();
  if (!needle) return [];
  const ranges: Range[] = [];
  for (const richText of root.querySelectorAll(
    'rich-text, knot-cited-excerpt blockquote[aria-label="Read-only cited excerpt"], knot-web-source details > p:first-of-type, .knot-mcq :is(.mcq-question, .mcq-choice-text)',
  )) {
    const nodes: { node: Text; start: number; end: number }[] = [];
    let text = "";
    const lines = richText.matches("rich-text")
      ? richText.querySelectorAll("v-line")
      : [richText];
    for (const line of lines) {
      if (text) text += "\n";
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        if (node.parentElement?.closest("style, script")) continue;
        nodes.push({
          node,
          start: text.length,
          end: text.length + node.length,
        });
        text += node.data;
      }
    }
    // Search uses the same case-insensitive literal matching as workspace search.
    const lower = text.toLowerCase();
    const starts: number[] = [];
    const ends: number[] = [];
    if (lower.length !== text.length) {
      // Some characters (for example İ) expand when lowercased. DOM ranges
      // still need offsets in the original UTF-16 text.
      let offset = 0;
      for (const char of text) {
        for (let i = 0; i < char.toLowerCase().length; i++) {
          starts.push(offset);
          ends.push(offset + char.length);
        }
        offset += char.length;
      }
    }
    for (
      let index = lower.indexOf(needle);
      index >= 0;
      index = lower.indexOf(needle, index + needle.length)
    ) {
      const startOffset = starts[index] ?? index;
      const endOffset =
        ends[index + needle.length - 1] ?? index + needle.length;
      const start = nodes.find((part) => part.end > startOffset);
      const end = nodes.find((part) => part.end >= endOffset);
      if (!start || !end) continue;
      const range = document.createRange();
      range.setStart(start.node, startOffset - start.start);
      range.setEnd(end.node, endOffset - end.start);
      ranges.push(range);
      if (ranges.length >= 100) return ranges;
    }
  }
  return ranges;
}

/** A short-lived view overlay follows scrolling/zooming and never enters saved content. */
export function createSearchReveal(editor: AffineEditorContainer) {
  let generation = 0;
  let clearHighlight = () => {};
  const clear = () => {
    generation++;
    clearHighlight();
    clearHighlight = () => {};
  };
  editor.addEventListener("beforeinput", clear, true);
  return {
    async reveal(query: string, noteId?: string) {
      clear();
      const needle = query.trim();
      if (!needle || !editor.isConnected) return;
      const run = generation;
      const mode = editor.mode;
      const root = editor.querySelector(
        mode === "page" ? "affine-page-root" : "affine-edgeless-root",
      );
      if (!root) return;
      const current = () =>
        generation === run &&
        editor.isConnected &&
        editor.mode === mode &&
        root.isConnected;
      let scope: Element = root;
      let restore = () => {};
      if (noteId) {
        const note = editor.std.view.getBlock(noteId) as CanvasNote | null;
        if (!note) return;
        scope = note;
        if (mode === "edgeless") {
          const forced = note._knotForced;
          let restored = false;
          note._knotMount?.(true);
          restore = () => {
            if (restored) return;
            restored = true;
            note._knotForced = forced;
            note.requestUpdate?.();
          };
          clearHighlight = restore;
          await note.updateComplete;
        }
      }
      for (const details of scope.querySelectorAll<HTMLDetailsElement>(
        "knot-web-source details",
      )) {
        if (
          details
            .querySelector("p")
            ?.textContent?.toLowerCase()
            .includes(needle.toLowerCase())
        )
          details.open = true;
      }
      await frame();
      if (!current()) {
        restore();
        return;
      }
      let ranges = searchTextRanges(scope, needle);
      // Code blocks and other nested scrollers must expose their own match before
      // measuring its location in the page or canvas.
      const range = ranges[0];
      for (
        let element = range?.startContainer.parentElement;
        element && element !== scope && element !== editor;
        element = element.parentElement
      ) {
        if (element.matches(".affine-page-viewport")) break;
        const rect = range.getClientRects()[0];
        if (!rect) break;
        const style = getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        if (
          /(auto|scroll)/.test(style.overflowX) &&
          element.scrollWidth > element.clientWidth
        ) {
          element.scrollLeft +=
            (rect.left - bounds.left) /
              (bounds.width / element.offsetWidth || 1) -
            element.clientWidth * 0.35;
        }
        if (
          /(auto|scroll)/.test(style.overflowY) &&
          element.scrollHeight > element.clientHeight
        ) {
          element.scrollTop +=
            (rect.top - bounds.top) /
              (bounds.height / element.offsetHeight || 1) -
            element.clientHeight * 0.35;
        }
      }
      const first = ranges[0]?.getClientRects()[0];
      if (!first) {
        restore();
        return;
      }
      if (mode === "edgeless") {
        const canvas = editor.querySelector("affine-edgeless-root")!;
        const viewport = canvas.service.viewport;
        const center = viewport.toModelCoordFromClientCoord([
          first.x + first.width / 2,
          first.y + first.height / 2,
        ]);
        // Reading zoom reveals the match inside a tall card rather than fitting the whole card.
        viewport.setViewport(Math.max(1, viewport.zoom), center);
      } else {
        const viewport = editor.querySelector<HTMLElement>(
          ".affine-page-viewport",
        );
        if (viewport)
          viewport.scrollTo({
            top:
              viewport.scrollTop +
              first.top -
              viewport.getBoundingClientRect().top -
              viewport.clientHeight * 0.35,
            behavior: "instant",
          });
      }
      await frame();
      if (!current()) {
        restore();
        return;
      }
      // A canvas promotion can replace its rich-text nodes during the viewport update.
      ranges = searchTextRanges(scope, needle);
      const overlay = document.createElement("div");
      overlay.className = "search-match-overlay";
      overlay.setAttribute("aria-hidden", "true");
      editor.append(overlay);
      let animation = 0;
      let finished = false;
      const started = performance.now();
      const cleanup = () => {
        if (finished) return;
        finished = true;
        cancelAnimationFrame(animation);
        overlay.remove();
        restore();
      };
      clearHighlight = cleanup;
      const paint = () => {
        const elapsed = performance.now() - started;
        if (
          !current() ||
          elapsed >= 4000 ||
          !ranges.some((range) => range.startContainer.isConnected)
        ) {
          cleanup();
          return;
        }
        const bounds = editor.getBoundingClientRect();
        const rects = ranges
          .flatMap((range) => [...range.getClientRects()])
          .filter(
            (rect) =>
              rect.width > 0 &&
              rect.height > 0 &&
              rect.bottom > bounds.top &&
              rect.top < bounds.bottom &&
              rect.right > bounds.left &&
              rect.left < bounds.right,
          );
        while (overlay.children.length > rects.length)
          overlay.lastElementChild?.remove();
        rects.forEach((rect, index) => {
          const mark =
            (overlay.children[index] as HTMLElement | undefined) ??
            overlay.appendChild(document.createElement("span"));
          mark.style.left = `${rect.left - bounds.left}px`;
          mark.style.top = `${rect.top - bounds.top}px`;
          mark.style.width = `${rect.width}px`;
          mark.style.height = `${rect.height}px`;
        });
        overlay.style.opacity = String(
          elapsed < 3000 ? 1 : 1 - (elapsed - 3000) / 1000,
        );
        animation = requestAnimationFrame(paint);
      };
      paint();
    },
    dispose() {
      clear();
      editor.removeEventListener("beforeinput", clear, true);
    },
  };
}

const reveals = new WeakMap<
  AffineEditorContainer,
  ReturnType<typeof createSearchReveal>
>();
/** Reveals a match in any editor, such as a note tab, reusing its reveal. */
export function revealSearchIn(
  editor: AffineEditorContainer,
  query: string,
  noteId?: string,
) {
  let reveal = reveals.get(editor);
  if (!reveal) {
    reveal = createSearchReveal(editor);
    reveals.set(editor, reveal);
  }
  return reveal.reveal(query, noteId);
}
