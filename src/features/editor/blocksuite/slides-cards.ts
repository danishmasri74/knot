import type { AttachmentBlockModel } from "@blocksuite/blocks";
import type { AffineEditorContainer } from "@blocksuite/presets";
import {
  isUnconvertedSlides,
  slideJob,
  slides,
  subscribeSlideJobs,
} from "../../../services/slides";

type AttachmentElement = HTMLElement & { model: AttachmentBlockModel };

/** Shows what's happening to each unconverted .pptx card (converting, no
 * converter found, couldn't convert) with Try again and Open file. A deck
 * Knot hasn't tried this session is converted as soon as it's shown. */
export function observeSlideCards(
  editor: AffineEditorContainer,
  convert: (blockId: string) => void,
) {
  const tried = new Set<string>();
  let pending = false;
  let stopped = false;

  const button = (label: string, action: () => void) => {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      action();
    });
    return element;
  };

  const render = (element: AttachmentElement) => {
    const model = element.model;
    let status = element.querySelector<HTMLElement>(
      ":scope > .knot-slides-status",
    );
    if (!model.sourceId || !isUnconvertedSlides(model.type, model.name)) {
      status?.remove();
      return;
    }
    const key = model.sourceId;
    if (!slideJob(key) && !tried.has(key)) {
      tried.add(key);
      convert(model.id);
    }
    const job = slideJob(key);
    // "idle": tried this session but not converted, e.g. after Undo.
    const state = job?.state ?? "idle";
    if (!status) {
      status = document.createElement("div");
      status.className = "knot-slides-status";
      // Keep presses on the panel from selecting or dragging the card.
      for (const type of ["pointerdown", "mousedown", "dblclick"])
        status.addEventListener(type, (event) => event.stopPropagation());
      element.append(status);
    }
    const signature = `${state}:${key}`;
    if (status.dataset.signature === signature) return;
    status.dataset.signature = signature;
    status.dataset.state = state;
    const message = document.createElement("p");
    const actions = document.createElement("div");
    actions.className = "knot-slides-actions";
    const retry = button(state === "idle" ? "Convert" : "Try again", () => {
      tried.add(key);
      convert(model.id);
    });
    const open = button("Open file", () => {
      void slides.openOriginal(key, model.name).catch((error: unknown) => {
        message.textContent = `Couldn't open this file: ${String(error)}`;
      });
    });
    if (state === "converting") {
      message.textContent = "Preparing slides…";
      status.setAttribute("aria-busy", "true");
      status.replaceChildren(message);
      return;
    }
    status.removeAttribute("aria-busy");
    message.textContent =
      state === "idle"
        ? "Convert this deck to read its slides in Knot."
        : state === "missing"
          ? "Install PowerPoint or LibreOffice to read slides in Knot."
          : job?.state === "failed" && /password/i.test(job.reason)
            ? "Couldn't convert this deck. It's password-protected."
            : "Couldn't convert this deck. It may be password-protected or damaged.";
    if (job?.state === "failed") status.title = job.reason;
    actions.append(retry, open);
    status.replaceChildren(message, actions);
  };

  const refresh = () => {
    pending = false;
    if (stopped) return;
    for (const element of editor.querySelectorAll<AttachmentElement>(
      "affine-attachment, affine-edgeless-attachment",
    ))
      if (element.model) render(element);
  };
  const schedule = () => {
    if (!pending) {
      pending = true;
      queueMicrotask(refresh);
    }
  };
  const observer = new MutationObserver(schedule);
  observer.observe(editor, { childList: true, subtree: true });
  const unsubscribe = subscribeSlideJobs(schedule);
  schedule();
  return () => {
    stopped = true;
    observer.disconnect();
    unsubscribe();
  };
}
