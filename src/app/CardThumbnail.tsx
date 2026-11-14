import { useEffect, useRef, useState } from "react";
import { attachments } from "../services/workspace";
import {
  cardMedia,
  isMcqCard,
  type DeckCard,
} from "../features/editor/blocksuite/card-deck";
import type { MediaKind } from "../features/editor/blocksuite/media-cards";
import { ShellIcon } from "./ShellIcon";

const kindIcons = {
  video: "video",
  link: "link",
  pdf: "pdf",
  file: "attach",
  image: "image",
  page: "note",
} as const satisfies Record<MediaKind, string>;

/** The shared object icon for a card: what it is, never how it's placed. */
export function cardIcon(card: DeckCard) {
  if (isMcqCard(card)) return "multipleChoice" as const;
  const media = cardMedia(card);
  return media ? kindIcons[media.kind] : ("note" as const);
}

// Image cards read their file from the workspace once, then keep a small
// downscaled copy for the session so lists stay quick.
const cache = new Map<string, Promise<string | null>>();
const maxCached = 200;
const maxBytes = 12 * 1024 * 1024;

function thumbnail(key: string, type: string): Promise<string | null> {
  let job = cache.get(key);
  if (job) return job;
  job = (async () => {
    const bytes = new Uint8Array(await attachments.get(key));
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

/** A media card's picture: the video's thumbnail or the image itself.
 * Other kinds (and images that can't be read) show the kind's icon. */
export function CardThumbnail({ card }: { card: DeckCard }) {
  const media = cardMedia(card);
  const host = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const key =
    media?.kind === "image" ? String(media.get("prop:sourceId") ?? "") : "";
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
    if (!visible || !key || size > maxBytes) return;
    let alive = true;
    void thumbnail(key, type).then((url) => {
      if (alive) setImage(url);
    });
    return () => {
      alive = false;
    };
  }, [visible, key, type, size]);
  if (!media) return null;
  const videoId = media.identity?.startsWith("youtube:")
    ? media.identity.slice("youtube:".length)
    : "";
  const src = videoId
    ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
    : image;
  return (
    <span ref={host} className="card-media-thumb" data-kind={media.kind}>
      {src ? (
        <img src={src} alt="" loading="lazy" draggable={false} />
      ) : (
        <ShellIcon name={kindIcons[media.kind]} />
      )}
    </span>
  );
}
