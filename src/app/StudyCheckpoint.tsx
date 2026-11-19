import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type CheckpointShow = "notes" | "quiz" | "both";
export type QuizProgress = { answered: number; total: number; score?: number };

const VIEW_KEY = "knot.study.checkpointView";
/** Notes and quiz side by side need about this much panel width. */
const BOTH_MIN_WIDTH = 680;

function readView(): CheckpointShow {
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    if (saved === "notes" || saved === "quiz" || saved === "both") return saved;
  } catch {
    // Storage blocked: use the default.
  }
  return "both";
}

/**
 * A checkpoint's layout (design option C): a pinned header with the course
 * tracker and a Notes · Quiz · Both switch, then the notes and the quiz.
 * "Both" puts them side by side when the panel is wide enough; otherwise one
 * shows at a time and each keeps its scroll position.
 */
export function StudyCheckpoint({
  back,
  tracker,
  doneLabel,
  position,
  title,
  notes,
  quiz,
  status,
}: {
  back: React.ReactNode;
  /** The course tracker, with this checkpoint's segment filled by `fraction`. */
  tracker: (fraction: number) => React.ReactNode;
  doneLabel: string;
  /** "1 of 6". */
  position: string;
  title: string;
  notes: React.ReactNode;
  /** The quiz, once the lesson is ready; it reports answers as they change. */
  quiz?: (onProgress: (progress: QuizProgress) => void) => React.ReactNode;
  status?: React.ReactNode;
}) {
  const [chosen, setChosen] = useState<CheckpointShow>(readView);
  const [progress, setProgress] = useState<QuizProgress>();
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const [wide, setWide] = useState(true);
  useEffect(() => {
    if (!panel) return;
    const observer = new ResizeObserver(([entry]) =>
      setWide(entry.contentRect.width >= BOTH_MIN_WIDTH),
    );
    observer.observe(panel);
    return () => observer.disconnect();
  }, [panel]);

  const choose = (next: CheckpointShow) => {
    setChosen(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Storage blocked: the choice lasts for this session only.
    }
  };
  // "Both" in a narrow panel reads the notes first; the quiz is one tap away.
  const show: CheckpointShow = !quiz
    ? "notes"
    : chosen === "both" && !wide
      ? "notes"
      : chosen;

  // A hidden column loses its scroll offset, so keep and restore it.
  const notesRef = useRef<HTMLDivElement>(null);
  const quizRef = useRef<HTMLDivElement>(null);
  const offsets = useRef({ notes: 0, quiz: 0 });
  useLayoutEffect(() => {
    if (notesRef.current) notesRef.current.scrollTop = offsets.current.notes;
    if (quizRef.current) quizRef.current.scrollTop = offsets.current.quiz;
  }, [show]);

  const total = progress?.total ?? 0;
  const answered = progress?.answered ?? 0;
  const graded = progress?.score !== undefined;
  const option = (value: CheckpointShow, label: string) => {
    const unavailable = value === "both" && !wide;
    return (
      <button
        type="button"
        className="tool-switch-option"
        aria-pressed={show === value}
        aria-disabled={unavailable || undefined}
        data-tooltip={
          unavailable
            ? "Widen the panel to see notes and quiz side by side"
            : undefined
        }
        onClick={() => !unavailable && choose(value)}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="study-panel study-checkpoint" ref={setPanel}>
      <header className="study-sticky">
        <div className="study-bar-row">
          {back}
          {tracker(total && !graded ? answered / total : 0)}
          <span className="study-muted">{doneLabel}</span>
        </div>
        <div className="study-sticky-line">
          <span className="study-muted">{position}</span>
          <span className="study-muted" aria-hidden="true">
            ·
          </span>
          <strong title={`${position}: ${title}`}>{title}</strong>
          {quiz && (
            <div
              className="tool-switch"
              role="group"
              aria-label="Show the notes, the quiz or both"
            >
              {option("notes", "Notes")}
              {option("quiz", "Quiz")}
              {option("both", "Both")}
            </div>
          )}
          {progress && total > 0 && (
            <span
              className="study-answered"
              data-full={graded || answered === total}
            >
              {graded
                ? `${progress.score}/${total} correct`
                : `${answered}/${total} answered`}
            </span>
          )}
        </div>
      </header>
      <div className="study-columns" data-show={show}>
        <div
          className="study-col study-col-notes"
          ref={notesRef}
          onScroll={(e) => (offsets.current.notes = e.currentTarget.scrollTop)}
        >
          {notes}
        </div>
        {quiz && (
          <div
            className="study-col study-col-quiz"
            ref={quizRef}
            onScroll={(e) => (offsets.current.quiz = e.currentTarget.scrollTop)}
          >
            {quiz(setProgress)}
          </div>
        )}
      </div>
      {status && <div className="study-checkpoint-status">{status}</div>}
    </div>
  );
}
