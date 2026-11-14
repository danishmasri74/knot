import type { VideoSource } from "./youtube-transcript";

// The last YouTube video and web page viewed in a workspace, so an empty
// Video or Browser panel can offer to pick up where the person left off.
// Stored per workspace on this device; nothing is synced or backed up.

export type LastVideo = { source: VideoSource; position: number };
export type LastPage = { url: string; title: string };

const videoKey = (workspace: string) => `knot.resume.video.${workspace}`;
const pageKey = (workspace: string) => `knot.resume.web.${workspace}`;

function read(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable: resuming is only a convenience.
  }
}

export function lastVideo(workspace: string | null): LastVideo | null {
  if (!workspace) return null;
  const saved = read(videoKey(workspace)) as LastVideo | null;
  const source = saved?.source;
  if (
    !source ||
    typeof source.videoId !== "string" ||
    !/^[\w-]{6,20}$/.test(source.videoId) ||
    typeof source.title !== "string" ||
    typeof source.url !== "string" ||
    typeof source.documentId !== "string" ||
    typeof source.blockId !== "string"
  )
    return null;
  const position =
    typeof saved.position === "number" && Number.isFinite(saved.position)
      ? Math.max(0, saved.position)
      : 0;
  return { source, position };
}

/** Remember an opened video. Reopening the same one keeps its position. */
export function rememberVideo(workspace: string, source: VideoSource) {
  const previous = lastVideo(workspace);
  write(videoKey(workspace), {
    source,
    position:
      previous?.source.videoId === source.videoId ? previous.position : 0,
  });
}

export function rememberVideoPosition(
  workspace: string,
  videoId: string,
  position: number,
) {
  const previous = lastVideo(workspace);
  if (previous?.source.videoId !== videoId) return;
  write(videoKey(workspace), { ...previous, position });
}

export function lastPage(workspace: string | null): LastPage | null {
  if (!workspace) return null;
  const saved = read(pageKey(workspace)) as LastPage | null;
  if (!saved || typeof saved.url !== "string" || !isWebPage(saved.url))
    return null;
  return {
    url: saved.url,
    title: typeof saved.title === "string" ? saved.title : "",
  };
}

export function rememberPage(workspace: string, page: LastPage) {
  if (isWebPage(page.url)) write(pageKey(workspace), page);
}

function isWebPage(url: string) {
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

export function pageHost(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}
