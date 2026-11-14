import { useEffect, useMemo, useRef, useState } from "react";
import { ShellIcon } from "./ShellIcon";
import {
  activeChapter,
  activeLine,
  fetchTranscript,
  formatTimestamp,
  lineMatches,
  loadTranscript,
  transcriptLines,
  transcriptRows,
  type Transcript,
  type VideoSource,
} from "../services/youtube-transcript";

// The YouTube side panel (docs/YOUTUBE-TRANSCRIPT-PLAN.md): the player on top
// and the saved transcript underneath. Clicking a line seeks the player; the
// line being spoken is highlighted. The player is controlled with YouTube's
// postMessage protocol (`enablejsapi=1`), so no YouTube script runs in Knot.

const youtubeOrigin = "https://www.youtube.com";
/** After the person scrolls the transcript, leave it alone this long. */
const manualScrollMs = 4000;

function message(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  return text || "Couldn't read captions. Knot may need an update";
}

export function VideoReader({
  source,
  workspace,
}: {
  source: VideoSource;
  workspace: string;
}) {
  const player = useRef<HTMLIFrameElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const request = useRef(0);
  const lastManualScroll = useRef(0);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(0);

  useEffect(() => {
    const token = ++request.current;
    setTranscript(null);
    setLoaded(false);
    setError(null);
    setFetching(false);
    setQuery("");
    setNow(0);
    loadTranscript(workspace, source.videoId)
      .then((saved) => {
        if (token === request.current) setTranscript(saved);
      })
      .catch((e) => {
        if (token === request.current) setError(message(e));
      })
      .finally(() => {
        if (token === request.current) setLoaded(true);
      });
  }, [workspace, source.videoId]);

  async function getTranscript(track?: string) {
    const token = ++request.current;
    setFetching(true);
    setError(null);
    try {
      const next = await fetchTranscript(workspace, source.videoId, track);
      if (token === request.current) setTranscript(next);
    } catch (e) {
      if (token === request.current) setError(message(e));
    } finally {
      if (token === request.current) setFetching(false);
    }
  }
  function cancel() {
    // The request finishes in the background; its result is ignored here.
    request.current++;
    setFetching(false);
  }

  const post = (func: string, args: unknown[] = []) =>
    player.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func, args, id: "knot", channel: "widget" }),
      youtubeOrigin,
    );
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== youtubeOrigin ||
        event.source !== player.current?.contentWindow ||
        typeof event.data !== "string"
      )
        return;
      try {
        const data = JSON.parse(event.data) as {
          event?: string;
          info?: { currentTime?: unknown };
        };
        const time = data.info?.currentTime;
        if (
          (data.event === "infoDelivery" || data.event === "initialDelivery") &&
          typeof time === "number" &&
          Number.isFinite(time)
        )
          setNow(Math.round(time * 1000));
      } catch {
        // Not a player message.
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  function listen() {
    player.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "listening", id: "knot", channel: "widget" }),
      youtubeOrigin,
    );
  }
  function seek(ms: number) {
    setNow(ms);
    post("seekTo", [ms / 1000, true]);
    post("playVideo");
  }

  const lines = useMemo(
    () => (transcript ? transcriptLines(transcript.segments, transcript.chapters) : []),
    [transcript],
  );
  const rows = useMemo(
    () => (transcript ? transcriptRows(lines, transcript.chapters) : []),
    [lines, transcript],
  );
  const searching = query.trim().length > 0;
  const visible = searching
    ? rows.filter((row) => row.type === "line" && lineMatches(row.text, query))
    : rows;
  const current = activeLine(lines, now);
  const chapter = transcript ? activeChapter(transcript.chapters, now) : undefined;

  useEffect(() => {
    if (current < 0 || searching) return;
    if (Date.now() - lastManualScroll.current < manualScrollMs) return;
    const row = list.current?.querySelector<HTMLElement>(`[data-line="${current}"]`);
    const box = list.current;
    if (!row || !box) return;
    const top = row.offsetTop - box.offsetTop;
    if (top < box.scrollTop || top + row.offsetHeight > box.scrollTop + box.clientHeight)
      box.scrollTo({ top: Math.max(0, top - box.clientHeight / 3), behavior: "smooth" });
  }, [current, searching]);
  const manual = () => {
    lastManualScroll.current = Date.now();
  };

  const embed = `${youtubeOrigin}/embed/${source.videoId}?enablejsapi=1&rel=0&origin=${encodeURIComponent(location.origin)}`;
  const title = transcript?.title || source.title;
  const details = [
    transcript?.channel,
    transcript?.duration ? formatTimestamp(transcript.duration * 1000) : "",
  ].filter(Boolean);

  return (
    <div className="video-reader">
      <div className="video-reader-player">
        <iframe
          ref={player}
          src={embed}
          title={`YouTube video: ${source.title}`}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={listen}
        />
      </div>
      <div className="video-reader-meta">
        <h2>{title}</h2>
        {(details.length > 0 || chapter) && (
          <p>
            {details.join(" · ")}
            {chapter && (
              <span className="video-reader-chapter">
                {details.length > 0 && " · "}
                {chapter.title}
              </span>
            )}
          </p>
        )}
        {transcript && (
          <div className="video-reader-tools">
            <input
              type="search"
              aria-label="Find in transcript"
              placeholder="Find in transcript"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && query) {
                  event.stopPropagation();
                  setQuery("");
                }
              }}
            />
            {transcript.tracks.length > 1 && (
              <select
                aria-label="Caption language"
                value={transcript.track.id}
                disabled={fetching}
                onChange={(event) => void getTranscript(event.target.value)}
              >
                {transcript.tracks.map((track) => (
                  <option key={track.id} value={track.id}>
                    {track.name}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              className="video-reader-icon"
              aria-label="Refresh transcript"
              title="Refresh transcript"
              disabled={fetching}
              onClick={() => void getTranscript(transcript.track.id)}
            >
              <ShellIcon name="refresh" />
            </button>
          </div>
        )}
      </div>

      {transcript ? (
        <>
          {(fetching || error) && (
            <p className="video-reader-status" role="status">
              {fetching ? "Getting transcript…" : error}
              {error && !fetching && (
                <button type="button" onClick={() => void getTranscript(transcript.track.id)}>
                  Try again
                </button>
              )}
            </p>
          )}
          <div
            ref={list}
            className="video-reader-lines"
            role="list"
            aria-label="Transcript"
            onWheel={manual}
            onTouchMove={manual}
            onKeyDown={manual}
          >
            {visible.map((row) =>
              row.type === "chapter" ? (
                <h3 key={`c${row.start}`} role="listitem">
                  {row.title}
                </h3>
              ) : (
                <div role="listitem" key={row.index}>
                  <button
                    type="button"
                    data-line={row.index}
                    aria-current={row.index === current ? "true" : undefined}
                    onClick={() => seek(row.start)}
                  >
                    <span className="video-reader-time">{formatTimestamp(row.start)}</span>
                    <span>{row.text}</span>
                  </button>
                </div>
              ),
            )}
            {searching && visible.length === 0 && (
              <p className="video-reader-empty">No matching lines</p>
            )}
          </div>
          <p className="video-reader-footer">
            <span>
              {transcript.track.kind === "asr" ? "Auto-generated captions" : "Creator captions"} ·{" "}
              {transcript.track.name}
            </span>
            <span>Saved {new Date(transcript.fetchedAt).toLocaleDateString()}</span>
          </p>
        </>
      ) : fetching ? (
        <div className="video-reader-state" role="status">
          <p>Getting transcript…</p>
          <div className="video-reader-skeleton" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
          <button type="button" onClick={cancel}>
            Cancel
          </button>
        </div>
      ) : error ? (
        <div className="video-reader-state">
          <p className="video-reader-error">{error}</p>
          <button type="button" onClick={() => void getTranscript()}>
            Try again
          </button>
        </div>
      ) : loaded ? (
        <div className="video-reader-state">
          <h3>Read along with the video</h3>
          <p>
            Knot asks YouTube for this video's captions and saves them in this workspace, so
            they're here offline.
          </p>
          <button type="button" className="video-reader-primary" onClick={() => void getTranscript()}>
            Get transcript
          </button>
        </div>
      ) : null}
    </div>
  );
}
