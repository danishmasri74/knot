import { youtubeVideoId } from "../../../services/youtube-transcript";

// Standalone canvas objects that are Card Deck cards (videos, links, files,
// images and linked pages). The deck owns their content; each canvas owns
// where and how big they are and which view (card or embed) they use.

export type MediaKind = "video" | "link" | "pdf" | "file" | "image" | "page";

const mediaFlavours = {
  "affine:embed-youtube": "video",
  "affine:bookmark": "link",
  "affine:embed-github": "link",
  "affine:embed-figma": "link",
  "affine:embed-loom": "link",
  "affine:attachment": "file",
  "affine:image": "image",
  "affine:embed-linked-doc": "page",
  "affine:embed-synced-doc": "page",
} as const satisfies Record<string, MediaKind>;

export type MediaFlavour = keyof typeof mediaFlavours;

export function isMediaFlavour(flavour: unknown): flavour is MediaFlavour {
  return typeof flavour === "string" && Object.hasOwn(mediaFlavours, flavour);
}

/** Per-placement properties: geometry, stacking and display style. */
const placementProps = new Set([
  "prop:xywh",
  "prop:index",
  "prop:rotate",
  "prop:lockedBySelf",
  "prop:style",
  "prop:embed",
  "prop:scale",
]);

/** Whether a block property is shared card content (not placement). */
export function isContentProp(key: string) {
  return (
    (key === "sys:flavour" ||
      key === "sys:version" ||
      key.startsWith("prop:")) &&
    !placementProps.has(key)
  );
}

/** A card's kind: what the deck shows it as and opens it with. */
export function mediaKind(
  flavour: unknown,
  get: (key: string) => unknown,
): MediaKind | undefined {
  if (!isMediaFlavour(flavour)) return;
  const kind: MediaKind = mediaFlavours[flavour];
  if (kind === "file") {
    const type = String(get("prop:type") ?? "");
    if (type === "application/pdf") return "pdf";
    if (type.startsWith("image/")) return "image";
  }
  if (kind === "link" && youtubeVideoId(String(get("prop:url") ?? "")))
    return "video";
  return kind;
}

const trackingParams =
  /^(utm_.+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|yclid|_hsenc|_hsmi|ref_src)$/i;

/** The same page after removing what doesn't change it: case of the host,
 * `www.`, default ports, fragments, trailing slashes and tracking tags. */
export function normalizePageUrl(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const port = parsed.port ? `:${parsed.port}` : "";
  const path = parsed.pathname.replace(/\/+$/, "");
  const query = [...parsed.searchParams]
    .filter(([key]) => !trackingParams.test(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return `${host}${port}${path}${query ? `?${query}` : ""}`;
}

/** What makes two cards the same: one video, page, file or note. Cards
 * without one (empty links, files still uploading) are never merged. */
export function mediaIdentity(
  flavour: unknown,
  get: (key: string) => unknown,
): string | undefined {
  if (!isMediaFlavour(flavour)) return;
  const text = (key: string) => {
    const value = get(key);
    return typeof value === "string" ? value.trim() : "";
  };
  const kind = mediaFlavours[flavour];
  if (kind === "video" || kind === "link") {
    const video =
      (flavour === "affine:embed-youtube" &&
        /^[\w-]{11}$/.test(text("prop:videoId")) &&
        text("prop:videoId")) ||
      youtubeVideoId(text("prop:url"));
    if (video) return `youtube:${video}`;
    const page = normalizePageUrl(text("prop:url"));
    return page && `url:${page}`;
  }
  if (kind === "file" || kind === "image") {
    const key = text("prop:sourceId");
    return key ? `file:${key}` : undefined;
  }
  const page = text("prop:pageId");
  return page ? `page:${page}` : undefined;
}

// BlockSuite's card sizes for each display style (EMBED_CARD_WIDTH/HEIGHT).
const styleSizes: Record<string, [number, number]> = {
  horizontal: [752, 116],
  horizontalThin: [752, 80],
  list: [752, 46],
  vertical: [364, 390],
  cube: [170, 114],
  cubeThick: [170, 132],
  video: [752, 544],
  figma: [752, 544],
  syncedDoc: [752, 455],
  pdf: [563, 831],
};
const defaultStyles: Record<MediaFlavour, string> = {
  "affine:embed-youtube": "video",
  "affine:bookmark": "horizontal",
  "affine:embed-github": "horizontal",
  "affine:embed-figma": "figma",
  "affine:embed-loom": "video",
  "affine:attachment": "horizontalThin",
  "affine:image": "",
  "affine:embed-linked-doc": "horizontal",
  "affine:embed-synced-doc": "syncedDoc",
};

/** Canvas size for a card placed from the deck, in the given display style. */
export function mediaSize(
  flavour: MediaFlavour,
  get: (key: string) => unknown,
  style?: unknown,
): [number, number] {
  if (flavour === "affine:image") {
    const width = Number(get("prop:width")) || 0;
    const height = Number(get("prop:height")) || 0;
    if (width > 0 && height > 0) {
      const scale = Math.min(1, 640 / width, 640 / height);
      return [Math.round(width * scale), Math.round(height * scale)];
    }
    return [480, 320];
  }
  const chosen =
    flavour === "affine:embed-synced-doc"
      ? "syncedDoc"
      : typeof style === "string" && styleSizes[style]
        ? style
        : defaultStyles[flavour];
  return styleSizes[chosen] ?? [752, 116];
}
