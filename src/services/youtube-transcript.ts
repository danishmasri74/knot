import { invoke } from "@tauri-apps/api/core";

// YouTube transcripts for the video side panel (docs/YOUTUBE-TRANSCRIPT-PLAN.md).
// Rust (`youtube.rs`) fetches and saves them in the workspace by video ID;
// this module reads them and shapes them for the panel.

export type TranscriptTrack = {
  id: string;
  language: string;
  name: string;
  kind: "manual" | "asr";
};
export type TranscriptSegment = { start: number; duration: number; text: string };
export type TranscriptChapter = { start: number; title: string };
export type Transcript = {
  version: 1;
  videoId: string;
  title: string;
  channel: string;
  /** Seconds. */
  duration: number;
  track: TranscriptTrack;
  tracks: TranscriptTrack[];
  chapters: TranscriptChapter[];
  /** Milliseconds; sorted by start. */
  segments: TranscriptSegment[];
  fetchedAt: number;
};
export type TranscriptLine = { start: number; text: string };
export type TranscriptRow =
  | { type: "chapter"; start: number; title: string }
  | { type: "line"; start: number; text: string; index: number };

/** The video a side panel shows; identifies the card it was opened from. */
export type VideoSource = {
  videoId: string;
  title: string;
  url: string;
  documentId: string;
  blockId: string;
};

const isTrack = (v: unknown): v is TranscriptTrack => {
  const t = v as TranscriptTrack | null;
  return (
    !!t &&
    typeof t.id === "string" &&
    typeof t.language === "string" &&
    typeof t.name === "string" &&
    (t.kind === "manual" || t.kind === "asr")
  );
};

/** Validate saved transcript JSON; anything unexpected reads as missing. */
export function parseTranscript(json: string | null): Transcript | null {
  if (!json) return null;
  try {
    const t = JSON.parse(json) as Transcript;
    if (
      t?.version !== 1 ||
      typeof t.videoId !== "string" ||
      typeof t.title !== "string" ||
      typeof t.channel !== "string" ||
      typeof t.duration !== "number" ||
      !isTrack(t.track) ||
      !Array.isArray(t.tracks) ||
      !t.tracks.every(isTrack) ||
      !Array.isArray(t.chapters) ||
      !Array.isArray(t.segments) ||
      typeof t.fetchedAt !== "number"
    )
      return null;
    const segments = t.segments.filter(
      (s) =>
        typeof s?.start === "number" &&
        typeof s.duration === "number" &&
        typeof s.text === "string",
    );
    const chapters = t.chapters.filter(
      (c) => typeof c?.start === "number" && typeof c.title === "string",
    );
    return { ...t, segments, chapters };
  } catch {
    return null;
  }
}

export async function loadTranscript(workspace: string, videoId: string) {
  return parseTranscript(
    await invoke<string | null>("video_transcript_get", { workspace, videoId }),
  );
}

/** Ask YouTube for the transcript and save it; `track` picks a listed track. */
export async function fetchTranscript(
  workspace: string,
  videoId: string,
  track?: string,
) {
  const json = await invoke<string>("video_transcript_fetch", {
    workspace,
    videoId,
    track: track ?? null,
    preferred: (navigator.language || "en").slice(0, 35),
  });
  const transcript = parseTranscript(json);
  if (!transcript) throw new Error("Couldn't read captions. Knot may need an update");
  return transcript;
}

/** `m:ss` under an hour, `h:mm:ss` after. */
export function formatTimestamp(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

const sentenceEnd = /[.!?…]["'”’)\]]?$/;
/** Merge caption segments into readable lines of about 5–10 seconds that end
 * at sentence breaks where possible. Uses start times only: auto-generated
 * segments overlap. A chapter start always begins a new line. */
export function transcriptLines(
  segments: TranscriptSegment[],
  chapters: TranscriptChapter[] = [],
): TranscriptLine[] {
  const breaks = new Set(chapters.map((c) => c.start));
  const lines: TranscriptLine[] = [];
  let current: TranscriptLine | null = null;
  let nextChapter = 0;
  const sortedChapters = [...breaks].sort((a, b) => a - b);
  for (const segment of segments) {
    let chapterBreak = false;
    while (
      nextChapter < sortedChapters.length &&
      sortedChapters[nextChapter] <= segment.start
    ) {
      nextChapter++;
      chapterBreak = true;
    }
    if (current) {
      const length = segment.start - current.start;
      const full =
        chapterBreak ||
        length >= 10_000 ||
        current.text.length >= 220 ||
        (length >= 5_000 && sentenceEnd.test(current.text));
      if (!full) {
        current.text += " " + segment.text;
        continue;
      }
      lines.push(current);
    }
    current = { start: segment.start, text: segment.text };
  }
  if (current) lines.push(current);
  return lines;
}

/** Lines with chapter headings placed before the first line they contain. */
export function transcriptRows(
  lines: TranscriptLine[],
  chapters: TranscriptChapter[],
): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  let c = 0;
  lines.forEach((line, index) => {
    while (c < chapters.length && chapters[c].start <= line.start) {
      // Only the last chapter starting before this line heads it.
      if (c + 1 < chapters.length && chapters[c + 1].start <= line.start) {
        c++;
        continue;
      }
      rows.push({ type: "chapter", start: chapters[c].start, title: chapters[c].title });
      c++;
    }
    rows.push({ type: "line", start: line.start, text: line.text, index });
  });
  return rows;
}

/** Index of the line playing at `ms`, or -1 before the first line. */
export function activeLine(lines: TranscriptLine[], ms: number) {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].start <= ms) {
      found = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  return found;
}

/** The chapter playing at `ms`. */
export function activeChapter(chapters: TranscriptChapter[], ms: number) {
  let found: TranscriptChapter | undefined;
  for (const chapter of chapters) {
    if (chapter.start <= ms) found = chapter;
    else break;
  }
  return found;
}

/** Case- and accent-insensitive find. */
export function lineMatches(text: string, query: string) {
  const fold = (s: string) =>
    s.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
  const q = fold(query.trim());
  return !q || fold(text).includes(q);
}

/** The video ID of a YouTube address, as BlockSuite's card reads it. */
export function youtubeVideoId(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^(www|m)\./, "");
    let id: string | null = null;
    if (host === "youtu.be") id = parsed.pathname.slice(1).split("/")[0];
    else if (host === "youtube.com" || host === "youtube-nocookie.com") {
      id =
        parsed.searchParams.get("v") ??
        parsed.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/]+)/)?.[1] ??
        null;
    }
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Where a cited transcript passage is: which card, which video, which moment. */
export type VideoLocation = {
  videoId: string;
  documentId: string;
  blockId: string;
  /** Milliseconds. */
  start: number;
  title: string;
};
export type TranscriptPassage = { start: number; text: string };

/** Transcript passages for Ask Knot and workspace search: about 45 seconds
 * each (at most `maxChars`), never spanning a chapter start, each led by its
 * timestamp so the model and a reader see the moment. */
export function transcriptPassages(
  transcript: Pick<Transcript, "segments" | "chapters">,
  windowMs = 45_000,
  maxChars = 900,
): TranscriptPassage[] {
  const lines = transcriptLines(transcript.segments, transcript.chapters);
  const chapterStarts = transcript.chapters.map((c) => c.start);
  const passages: TranscriptPassage[] = [];
  let current: { start: number; parts: string[]; length: number } | null = null;
  const flush = () => {
    if (current)
      passages.push({
        start: current.start,
        text: `[${formatTimestamp(current.start)}] ${current.parts.join(" ")}`,
      });
    current = null;
  };
  for (const line of lines) {
    const chapterBreak =
      !!current &&
      chapterStarts.some((s) => s > current!.start && s <= line.start);
    if (
      current &&
      (chapterBreak ||
        line.start - current.start >= windowMs ||
        current.length + line.text.length + 1 > maxChars)
    )
      flush();
    if (!current) current = { start: line.start, parts: [], length: 0 };
    current.parts.push(line.text);
    current.length += line.text.length + 1;
  }
  flush();
  return passages;
}

/** Label for a transcript source in Ask Knot and search results. */
export const transcriptTitle = (title: string) => `${title} · YouTube transcript`;

/** Saved transcripts for these cards (one per video, at most `limit`).
 * Cards without a saved transcript are skipped; nothing is fetched. */
export async function savedTranscripts(
  workspace: string,
  cards: VideoSource[],
  limit = 6,
) {
  const unique = [...new Map(cards.map((c) => [c.videoId, c])).values()].slice(
    0,
    limit,
  );
  const loaded = await Promise.all(
    unique.map(async (card) => {
      try {
        const transcript = await loadTranscript(workspace, card.videoId);
        return transcript && { card, transcript };
      } catch {
        return null;
      }
    }),
  );
  return loaded.filter(
    (entry): entry is { card: VideoSource; transcript: Transcript } => !!entry,
  );
}
