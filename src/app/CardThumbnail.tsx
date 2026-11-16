import { useEffect, useRef, useState } from "react";
import { attachments } from "../services/workspace";
import {
  cardMedia,
  isMcqCard,
  type DeckCard,
} from "../features/editor/blocksuite/card-deck";
import type { MediaKind } from "../features/editor/blocksuite/media-cards";
import { ShellIcon } from "./ShellIcon";
import { isSlidesName } from "../services/slides";

const kindIcons = {
  video: "video",
  link: "link",
  pdf: "pdf",
  file: "attach",
  image: "image",
} as const satisfies Record<MediaKind, string>;

/** Slide decks, converted or not, show the slides icon. */
function mediaIcon(media: NonNullable<ReturnType<typeof cardMedia>>) {
  return (media.kind === "pdf" || media.kind === "file") &&
    isSlidesName(media.get("prop:name"))
    ? ("slides" as const)
    : kindIcons[media.kind];
}

/** The shared object icon for a card: what it is, never how it's placed. */
export function cardIcon(card: DeckCard) {
  if (isMcqCard(card)) return "multipleChoice" as const;
  const media = cardMedia(card);
  return media ? mediaIcon(media) : ("note" as const);
}

// Image cards read their file from the workspace once, then keep a small
// downscaled copy for the session so lists stay quick.
const cache = new Map<string, Promise<string | null>>();
const maxCached = 200;
const maxBytes = 12 * 1024 * 1024;
const maxPdfBytes = 50 * 1024 * 1024;

/** A PDF's first page, small enough for a card. */
async function pdfThumbnail(bytes: Uint8Array) {
  const { renderCanvasPdf } =
    await import("../features/editor/blocksuite/canvas-pdf");
  const canvas = document.createElement("canvas");
  await renderCanvasPdf(bytes, canvas, 480);
  return canvas.toDataURL("image/webp", 0.82);
}

function thumbnail(key: string, type: string): Promise<string | null> {
  let job = cache.get(key);
  if (job) return job;
  job = (async () => {
    const bytes = new Uint8Array(await attachments.get(key));
    if (type === "application/pdf") return pdfThumbnail(bytes);
    const url = URL.createObjectURL(
      new Blob([bytes], { type: type || undefined }),
    );
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const scale = Math.min(
        1,
        480 / image.naturalWidth,
        480 / image.naturalHeight,
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas
        .getContext("2d")!
        .drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/webp", 0.82);
    } finally {
      URL.revokeObjectURL(url);
    }
  })().catch(() => null);
  cache.set(key, job);
  if (cache.size > maxCached) cache.delete(cache.keys().next().value!);
  return job;
}

/** A media card's picture: the video's thumbnail, a link's saved preview,
 * the image itself or a PDF's first page. Missing pictures show the
 * kind's icon. */
export function CardThumbnail({ card }: { card: DeckCard }) {
  const media = cardMedia(card);
  const host = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const key =
    media?.kind === "image" || media?.kind === "pdf"
      ? String(media.get("prop:sourceId") ?? "")
      : "";
  const type = String(media?.get("prop:type") ?? "");
  const size = Number(media?.get("prop:size")) || 0;
  useEffect(() => {
    const node = host.current;
    if (!node || !key) return;
    // Read files only for cards scrolled into view.
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [key]);
  useEffect(() => {
    const limit = media?.kind === "pdf" ? maxPdfBytes : maxBytes;
    if (!visible || !key || size > limit) return;
    let alive = true;
    void thumbnail(key, type).then((url) => {
      if (alive) setImage(url);
    });
    return () => {
      alive = false;
    };
  }, [visible, key, type, size, media?.kind]);
  if (!media) return null;
  const videoId = media.identity?.startsWith("youtube:")
    ? media.identity.slice("youtube:".length)
    : "";
  const linkImage =
    media.kind === "link" ? String(media.get("prop:image") ?? "") : "";
  const src = videoId
    ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
    : media.kind === "link"
      ? /^https?:\/\//i.test(linkImage)
        ? linkImage
        : null
      : image;
  return (
    <span ref={host} className="card-media-thumb" data-kind={media.kind}>
      {src && src !== failedSource ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
          referrerPolicy="no-referrer"
          onError={() => setFailedSource(src)}
        />
      ) : (
        <ShellIcon name={mediaIcon(media)} />
      )}
    </span>
  );
}
