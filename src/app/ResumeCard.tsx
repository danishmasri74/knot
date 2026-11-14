import { ShellIcon } from "./ShellIcon";
import { lastVideo, type LastVideo } from "../services/resume";
import { formatTimestamp } from "../services/youtube-transcript";

/** "Continue where you left off" in an empty Video or Browser panel. */
export function ResumeCard({
  icon,
  thumbnail,
  title,
  detail,
  label,
  onResume,
}: {
  icon: "video" | "globe";
  thumbnail?: string;
  title: string;
  detail: string;
  /** Accessible name; the visible text is the title and detail. */
  label: string;
  onResume: () => void;
}) {
  return (
    <button
      type="button"
      className="resume-card"
      aria-label={label}
      title={label}
      onClick={onResume}
    >
      {thumbnail ? (
        <img className="resume-card-thumb" src={thumbnail} alt="" />
      ) : (
        <span className="resume-card-icon" aria-hidden="true">
          <ShellIcon name={icon} />
        </span>
      )}
      <span className="resume-card-text">
        <span className="resume-card-eyebrow">Continue where you left off</span>
        <span className="resume-card-title">{title}</span>
        <span className="resume-card-detail">{detail}</span>
      </span>
    </button>
  );
}

/** The empty Video panel: the last video watched, ready to continue. */
export function VideoResume({
  workspace,
  onResume,
}: {
  workspace: string | null;
  onResume: (video: LastVideo) => void;
}) {
  const video = lastVideo(workspace);
  return (
    <div className="resume-empty">
      {video && (
        <ResumeCard
          icon="video"
          thumbnail={`https://img.youtube.com/vi/${video.source.videoId}/mqdefault.jpg`}
          title={video.source.title || "YouTube video"}
          detail={
            video.position > 0
              ? `Resume at ${formatTimestamp(video.position)}`
              : "Watch again"
          }
          label={`${video.position > 0 ? "Resume" : "Watch"} ${video.source.title || "YouTube video"}`}
          onResume={() => onResume(video)}
        />
      )}
      <p>Open a YouTube card's side panel from its toolbar.</p>
    </div>
  );
}
