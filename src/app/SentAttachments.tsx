import { memo, useMemo, useState } from "react";

import { ShellIcon } from "./ShellIcon";
import type { AiPdfSource } from "../services/pdf-input";
import {
  legacyAttachments,
  type SentAttachment,
} from "../services/sent-attachments";

/** Chips beyond this collapse behind "+N more" until expanded. */
const VISIBLE = 4;

const kindName: Record<SentAttachment["kind"], string> = {
  note: "Note",
  selection: "Selection",
  canvas: "Canvas",
  excerpt: "Excerpt",
  pdf: "PDF",
  video: "YouTube video",
  web: "Website",
  image: "Image",
  file: "File",
};

function icon(item: SentAttachment) {
  if (item.document?.startsWith("deck:")) return "cardDeck" as const;
  switch (item.kind) {
    case "canvas":
      return "board" as const;
    case "excerpt":
      return "highlight" as const;
    case "pdf":
      return /\.pptx(\s|$)/i.test(item.label)
        ? ("slides" as const)
        : /\.docx(\s|$)/i.test(item.label)
          ? ("wordDocument" as const)
          : ("pdf" as const);
    case "video":
      return "video" as const;
    case "web":
      return "link" as const;
    case "file":
      return "attach" as const;
    default:
      return "note" as const;
  }
}

/** Whether a chip has somewhere to go when clicked. */
export const canOpen = (item: SentAttachment) =>
  !!item.video ||
  !!item.url ||
  (!!item.document && (!!item.pdf || !!item.block));

/**
 * What was sent with a user message, as chips above its bubble. The image
 * keeps its own thumbnail, so it is not repeated here.
 */
export const SentAttachments = memo(function SentAttachments({
  request,
  onOpen,
}: {
  request: {
    context: string;
    sourceMode?: string;
    pdfSource?: AiPdfSource;
    image?: { key: string; name: string };
    attachments?: SentAttachment[];
  };
  onOpen: (item: SentAttachment) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const items = useMemo(
    () =>
      (request.attachments ?? legacyAttachments(request)).filter(
        (item) => item.kind !== "image",
      ),
    [request],
  );
  if (!items.length) return null;
  const collapsed = !expanded && items.length > VISIBLE;
  const shown = collapsed ? items.slice(0, VISIBLE - 1) : items;
  return (
    <ul className="ask-sent-attachments" aria-label="Sent with this message">
      {shown.map((item, index) => {
        const tip = `${kindName[item.kind]}: ${item.label}${item.from ? ` from ${item.from}` : ""}${item.detail ? ` · ${item.detail}` : ""}`;
        const body = (
          <>
            <ShellIcon name={icon(item)} />
            <span className="ask-chip-label">{item.label}</span>
            {item.detail && (
              <span className="ask-sent-detail">{item.detail}</span>
            )}
          </>
        );
        return (
          <li key={index}>
            {canOpen(item) ? (
              <button
                type="button"
                className="ask-chip"
                data-tooltip={tip}
                aria-label={`Open ${tip}`}
                onClick={() => onOpen(item)}
              >
                {body}
              </button>
            ) : (
              <span className="ask-chip" data-tooltip={tip} aria-label={tip}>
                {body}
              </span>
            )}
          </li>
        );
      })}
      {collapsed && (
        <li>
          <button
            type="button"
            className="ask-chip ask-sent-more"
            aria-label={`Show ${items.length - shown.length} more attachments`}
            onClick={() => setExpanded(true)}
          >
            +{items.length - shown.length} more
          </button>
        </li>
      )}
    </ul>
  );
});
