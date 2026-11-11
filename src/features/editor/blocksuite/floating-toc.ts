import type { NoteBlockModel } from "@blocksuite/blocks";
import type { AffineEditorContainer } from "@blocksuite/presets";
import type { BlockModel, Doc } from "@blocksuite/store";
import { mcqDecks, resolveMcqBlock } from "./mcq-block";

function questionTitle(doc: Doc, model: BlockModel | undefined) {
  return resolveMcqBlock(doc, model)?.question.replace(/\s+/g, " ").trim();
}

/** View-local navigation: never writes heading IDs or selection to the document. */
export function observeFloatingToc(editor: AffineEditorContainer) {
  const nav = document.createElement("nav");
  nav.className = "floating-toc";
  nav.setAttribute("aria-label", "Table of contents");
  nav.tabIndex = -1;
  nav.hidden = true;
  editor.append(nav);
  let headings: {
    element?: HTMLElement;
    noteId?: string;
    bounds?: number[];
    id: string;
    title: string;
    level: number;
  }[] = [];
  let signature = "";
  let frame = 0;
  let rebuild = false;
  let disposed = false;
  let active = "";
  let mode = editor.mode;
  const expand = () => {
    nav.dataset.expanded = "true";
  };
  const collapse = () => {
    delete nav.dataset.expanded;
  };
  nav.addEventListener("pointerenter", expand);
  nav.addEventListener("pointerleave", () => {
    if (document.activeElement === nav || !nav.contains(document.activeElement))
      collapse();
  });
  nav.addEventListener("focusin", expand);
  // Mouse navigation keeps the editor's caret and allows immediate hover dismissal.
  nav.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse") event.preventDefault();
  });
  nav.addEventListener("focusout", (event) => {
    if (!nav.contains(event.relatedTarget as Node | null)) collapse();
  });
  nav.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      nav.focus({ preventScroll: true });
      collapse();
    }
    const buttons = [
      ...nav.querySelectorAll<HTMLButtonElement>("button[data-heading-id]"),
    ];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "ArrowDown"
        ? Math.min(index + 1, buttons.length - 1)
        : event.key === "ArrowUp"
          ? Math.max(index - 1, 0)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : -1;
    if (next >= 0) {
      event.preventDefault();
      expand();
      buttons[next]?.focus({ preventScroll: true });
    }
  });
  let navigation = 0;
  nav.addEventListener("click", async (event) => {
    const visit = ++navigation;
    const button = (event.target as Element).closest("button");
    const heading = headings.find(
      (item) => item.id === button?.dataset.headingId,
    );

    if (editor.mode === "edgeless") {
      const root = editor.querySelector("affine-edgeless-root");
      if (!heading?.bounds || !root) return;
      const viewport = root.gfx.viewport;
      const [x, y, w, h] = heading.bounds;
      const getCard = () => editor.querySelector<HTMLElement & {
        _knotMount?: (force: boolean) => void;
        _knotForced?: boolean;
        updateComplete?: Promise<unknown>;
      }>(`affine-edgeless-note[data-block-id="${CSS.escape(heading.noteId ?? heading.id)}"]`);
      const getQuestion = (card: HTMLElement | null) => heading.noteId ?
        card?.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(heading.id)}"]`) : undefined;
      const covered = nav.getBoundingClientRect().width + 24;
      const height = viewport.height / viewport.zoom;
      const center = x + w / 2 + covered / (2 * viewport.zoom);
      viewport.setViewport(viewport.zoom, [
        center,
        h > height - 64 / viewport.zoom ? y + height / 2 - 32 / viewport.zoom : y + h / 2,
      ]);
      let card = getCard();
      let question = getQuestion(card);
      if (heading.noteId && !question) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        card = getCard();
        const wasForced = card?._knotForced;
        card?._knotMount?.(true);
        await card?.updateComplete;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        question = getQuestion(card);
        if (!wasForced) card?._knotMount?.(false);
      }
      if (disposed || visit !== navigation || !root.isConnected) return;
      if (card && question) {
        const rect = question.getBoundingClientRect();
        const offset = (rect.top - card.getBoundingClientRect().top + rect.height / 2) / viewport.zoom;
        viewport.setViewport(viewport.zoom, [center, y + offset]);
      }
      active = heading.id;
      nav
        .querySelectorAll<HTMLElement>("button[data-heading-id]")
        .forEach((entry) => {
          if (entry.dataset.headingId === active)
            entry.setAttribute("aria-current", "location");
          else entry.removeAttribute("aria-current");
        });
      (question || card)?.animate(
        [
          { outline: "2px solid var(--shell-accent)", outlineOffset: "4px" },
          { outline: "2px solid transparent", outlineOffset: "4px" },
        ],
        {
          duration: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? 0
            : 900,
        },
      );
      return;
    }
    const viewport = editor.querySelector<HTMLElement>(".affine-page-viewport");
    if (!heading?.element || !viewport) return;
    viewport.scrollTo({
      top:
        viewport.scrollTop +
        heading.element.getBoundingClientRect().top -
        viewport.getBoundingClientRect().top -
        32,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  });
  const update = () => {
    frame = 0;
    if (disposed) return;
    if (mode !== editor.mode) {
      mode = editor.mode;
      collapse();
      active = "";
      signature = "";
      rebuild = true;
    }
    nav.dataset.mode = editor.mode;
    if (rebuild) {
      rebuild = false;
      headings =
        editor.mode === "page"
          ? [
              ...editor.querySelectorAll<HTMLElement>(
                "affine-page-root:not([data-outgoing-view]) :is(affine-paragraph, knot-mcq, knot-mcq-reference)[data-block-id]",
              ),
            ].flatMap((element) => {
              const id = element.dataset.blockId!;
              const model = editor.doc.getBlock(id)?.model;
              if (!element.getClientRects().length) return [];
              const question = questionTitle(editor.doc, model);
              if (question) return [{ element, id, title: question, level: 1 }];
              const paragraph = model as
                { type?: string; text?: { toString(): string } } | undefined;
              const match = paragraph?.type?.match(/^h([1-6])$/);
              if (!match) return [];
              return [
                {
                  element,
                  id,
                  title:
                    paragraph?.text?.toString().trim() || "Untitled heading",
                  level: Number(match[1]),
                },
              ];
            })
          : editor.doc
              .getBlocksByFlavour("affine:note")
              .flatMap(({ model }) => {
                const note = model as NoteBlockModel;
                if (String(note.displayMode) === "doc") return [];
                let bounds: number[];
                try {
                  bounds = JSON.parse(note.xywh);
                } catch {
                  return [];
                }
                if (bounds.length !== 4 || !bounds.every(Number.isFinite))
                  return [];
                const text = note.children[0]?.text?.toString() ?? "";
                return [
                  {
                    id: note.id,
                    title:
                      (note.children.length === 1 && note.children[0]?.flavour === "knot:mcq" ? questionTitle(editor.doc, note.children[0]) : undefined) ||
                      text.split(/\r?\n/)[0].trim() ||
                      "Untitled card",
                    level: 1,
                    bounds,
                  },
                  ...(note.children.length === 1 && note.children[0]?.flavour === "knot:mcq" ? [] :
                    note.children.flatMap((child) => {
                      const title = questionTitle(editor.doc, child);
                      return title ? [{ id: child.id, noteId: note.id, title, level: 2, bounds }] : [];
                    })),
                ];
              });
      if (editor.mode === "edgeless") {
        const questions = new Map<string, typeof headings>();
        for (const entry of headings) {
          if (!entry.noteId) continue;
          const list = questions.get(entry.noteId) ?? [];
          list.push(entry);
          questions.set(entry.noteId, list);
        }
        const sorted = headings.filter((entry) => !entry.noteId).sort(
          (a, b) =>
            a.bounds![1] - b.bounds![1] ||
            a.bounds![0] - b.bounds![0] ||
            a.id.localeCompare(b.id),
        );
        headings = [];
        while (sorted.length) {
          const top = sorted[0].bounds![1];
          const end = sorted.findIndex((entry) => entry.bounds![1] > top + 48);
          const row = sorted.splice(0, end < 0 ? sorted.length : end);
          row.sort(
            (a, b) => a.bounds![0] - b.bounds![0] || a.id.localeCompare(b.id),
          );
          headings.push(...row.flatMap((entry) => [entry, ...(questions.get(entry.id) ?? [])]));
        }
      }
      const nextSignature = JSON.stringify(
        headings.map(({ id, title, level }) => [id, title, level]),
      );
      if (signature !== nextSignature) {
        signature = nextSignature;
        const focusedId = (document.activeElement as HTMLElement | null)
          ?.dataset.headingId;
        const minLevel = Math.min(...headings.map((heading) => heading.level));
        nav.replaceChildren(
          ...headings.map((heading) => {
            const button = document.createElement("button");
            button.type = "button";
            button.dataset.headingId = heading.id;
            button.style.setProperty(
              "--toc-depth",
              String(heading.level - minLevel),
            );
            button.setAttribute("aria-label", heading.title);
            if (heading.id === active)
              button.setAttribute("aria-current", "location");
            const line = document.createElement("span");
            line.className = "floating-toc-line";
            line.setAttribute("aria-hidden", "true");
            const title = document.createElement("span");
            title.className = "floating-toc-title";
            title.textContent = heading.title;
            button.append(line, title);
            return button;
          }),
        );
        if (focusedId)
          nav.querySelectorAll("button").forEach((button) => {
            if (button.dataset.headingId === focusedId)
              button.focus({ preventScroll: true });
          });
      }
      nav.hidden = !headings.length;
      if (nav.hidden) collapse();
    }
    if (editor.mode === "edgeless") return;
    const viewport = editor.querySelector<HTMLElement>(".affine-page-viewport");
    if (!viewport || !headings.length) return;
    const bounds = viewport.getBoundingClientRect();
    let current = headings[0].id;
    const atBottom =
      viewport.scrollTop > 0 &&
      viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 2;
    for (const heading of headings) {
      const top = heading.element!.getBoundingClientRect().top;
      if (top <= bounds.top + 64 || (atBottom && top < bounds.bottom))
        current = heading.id;
    }
    for (const button of nav.querySelectorAll("button")) {
      if (button.dataset.headingId === current)
        button.setAttribute("aria-current", "location");
      else button.removeAttribute("aria-current");
    }
    if (current !== active) {
      active = current;
      const button = nav.querySelector<HTMLElement>(
        '[aria-current="location"]',
      );
      if (button && !nav.dataset.expanded)
        nav.scrollTop = button.offsetTop - nav.clientHeight / 2;
    }
  };
  const schedule = (refresh = false) => {
    rebuild ||= refresh;
    if (!frame) frame = requestAnimationFrame(update);
  };
  const refresh = () => schedule(true);
  const scroll = () => schedule();
  const observer = new MutationObserver((records) => {
    if (records.some((record) => !nav.contains(record.target))) refresh();
  });
  observer.observe(editor, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["data-outgoing-view"],
  });
  const resize = new ResizeObserver(refresh);
  resize.observe(editor);
  editor.doc.spaceDoc.on("update", refresh);
  const stopDeck = mcqDecks.get(editor.doc.spaceDoc)?.subscribe(refresh);
  editor.addEventListener("scroll", scroll, true);
  window.addEventListener("resize", refresh);
  refresh();
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    resize.disconnect();
    editor.doc.spaceDoc.off("update", refresh);
    stopDeck?.();
    editor.removeEventListener("scroll", scroll, true);
    window.removeEventListener("resize", refresh);
    nav.remove();
  };
}
