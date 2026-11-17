import type { AttachmentBlockModel } from "@blocksuite/blocks";
import type { AffineEditorContainer } from "@blocksuite/presets";
import {
  office,
  officeApp,
  officeJob,
  subscribeOfficeJobs,
  unconvertedOffice,
  type OfficeKind,
} from "../../../services/office";

type AttachmentElement = HTMLElement & { model: AttachmentBlockModel };

const copy: Record<
  OfficeKind,
  { noun: string; preparing: string; idle: string; missing: string }
> = {
  slides: {
    noun: "deck",
    preparing: "Preparing slides…",
    idle: "Convert this deck to read its slides in Knot.",
    missing: "Install PowerPoint or LibreOffice to read slides in Knot.",
  },
  document: {
    noun: "document",
    preparing: "Preparing document…",
    idle: "Convert this document to read it in Knot.",
    missing: "Install Word or LibreOffice to read this document in Knot.",
  },
};

/** Shows what's happening to each unconverted .pptx or .docx card
 * (converting, no converter found, couldn't convert) with Try again and Open
 * file. A file Knot hasn't tried this session is converted as soon as it's
 * shown. */
export function observeOfficeCards(
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
      ":scope > .knot-office-status",
    );
    const kind = model.sourceId
      ? unconvertedOffice(model.type, model.name)
      : undefined;
    if (!model.sourceId || !kind) {
      status?.remove();
      return;
    }
    const key = model.sourceId;
    if (!officeJob(key) && !tried.has(key)) {
      tried.add(key);
      convert(model.id);
    }
    const job = officeJob(key);
    // "idle": tried this session but not converted, e.g. after Undo.
    const state = job?.state ?? "idle";
    if (!status) {
      status = document.createElement("div");
      status.className = "knot-office-status";
      // Keep presses on the panel from selecting or dragging the card.
      for (const type of ["pointerdown", "mousedown", "dblclick"])
        status.addEventListener(type, (event) => event.stopPropagation());
      element.append(status);
    }
    const signature = `${state}:${kind}:${key}`;
    if (status.dataset.signature === signature) return;
    status.dataset.signature = signature;
    status.dataset.state = state;
    const text = copy[kind];
    const message = document.createElement("p");
    const actions = document.createElement("div");
    actions.className = "knot-office-actions";
    const retry = button(state === "idle" ? "Convert" : "Try again", () => {
      tried.add(key);
      convert(model.id);
    });
    const open = button("Open file", () => {
      void office
        .openOriginal(key, model.name, kind)
        .catch((error: unknown) => {
          message.textContent = `Couldn't open this file: ${String(error)}`;
        });
    });
    open.title = `Open in ${officeApp[kind]} or your app for this file`;
    if (state === "converting") {
      message.textContent = text.preparing;
      status.setAttribute("aria-busy", "true");
      status.replaceChildren(message);
      return;
    }
    status.removeAttribute("aria-busy");
    message.textContent =
      state === "idle"
        ? text.idle
        : state === "missing"
          ? text.missing
          : job?.state === "failed" && /password/i.test(job.reason)
            ? `Couldn't convert this ${text.noun}. It's password-protected.`
            : job?.state === "failed" && /macros/i.test(job.reason)
              ? `Couldn't convert this ${text.noun}. Knot doesn't open files with macros.`
              : `Couldn't convert this ${text.noun}. It may be password-protected or damaged.`;
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
  const unsubscribe = subscribeOfficeJobs(schedule);
  schedule();
  return () => {
    stopped = true;
    observer.disconnect();
    unsubscribe();
  };
}
