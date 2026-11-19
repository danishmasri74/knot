import { useEffect, useState } from "react";
import { ShellIcon } from "./ShellIcon";
import type { StudyAttempt, StudyQuestion } from "../services/study-course";

/**
 * A batch of study questions: pick an answer for each, nothing is revealed
 * until Submit, then right answers show in blue with a tick, wrong picks in
 * orange with a cross, and mistakes get their explanation (and memory hook).
 */
export function StudyQuiz({
  title,
  questions,
  graded,
  onSubmit,
  renderSlide,
  footer,
  onProgress,
}: {
  title: string;
  questions: StudyQuestion[];
  /** The attempt to show, once submitted. */
  graded?: StudyAttempt;
  onSubmit: (picks: number[]) => void;
  renderSlide: (question: StudyQuestion) => React.ReactNode;
  /** Actions after grading (Next, Retry). */
  footer?: React.ReactNode;
  /** Called as answers change, and with the score once graded. */
  onProgress?: (progress: {
    answered: number;
    total: number;
    score?: number;
  }) => void;
}) {
  const [picks, setPicks] = useState<number[]>(() => questions.map(() => -1));
  const shown = graded?.picks ?? picks;
  const answered = shown.filter((p) => p >= 0).length;
  const total = questions.length;
  const score = graded?.score;
  useEffect(() => {
    onProgress?.({ answered, total, score });
  }, [onProgress, answered, total, score]);
  return (
    <section className="study-quiz" aria-label={title}>
      <header>
        <strong>{title}</strong>
        <span>
          · {total} {total === 1 ? "question" : "questions"}
        </span>
        <span className="study-quiz-count">
          {graded ? "Graded" : `${answered} of ${total} answered`}
        </span>
      </header>
      {graded && (
        <div
          className="study-quiz-score"
          data-perfect={graded.score === total}
          role="status"
        >
          <strong>
            {graded.score}/{total}
          </strong>
          <span>
            {graded.score === total
              ? "Perfect score."
              : "The explanations below show what to look at again."}
          </span>
        </div>
      )}
      {questions.map((q, qi) => {
        const chosen = shown[qi] ?? -1;
        const wrong = graded && chosen !== q.correct;
        return (
          <div className="study-quiz-question" key={qi}>
            <div className="study-quiz-prompt" id={`study-q-${title}-${qi}`}>
              {qi + 1}. {q.question}
            </div>
            <div role="radiogroup" aria-labelledby={`study-q-${title}-${qi}`}>
              {q.options.map((option, oi) => {
                const state = graded
                  ? oi === q.correct
                    ? "right"
                    : oi === chosen
                      ? "wrong"
                      : "other"
                  : chosen === oi
                    ? "picked"
                    : undefined;
                return (
                  <button
                    type="button"
                    role="radio"
                    key={oi}
                    aria-checked={chosen === oi}
                    aria-disabled={!!graded}
                    data-state={state}
                    onClick={() =>
                      !graded &&
                      setPicks(picks.map((p, i) => (i === qi ? oi : p)))
                    }
                  >
                    <span className="study-quiz-mark" aria-hidden="true">
                      {state === "right"
                        ? "✓"
                        : state === "wrong"
                          ? "✕"
                          : String.fromCharCode(65 + oi)}
                    </span>
                    <span>{option}</span>
                  </button>
                );
              })}
            </div>
            {wrong && (
              <div className="study-quiz-why">
                <p>
                  <strong>Why:</strong> {q.explanation}
                </p>
                {q.shortcut && (
                  <p>
                    <strong>Remember:</strong> {q.shortcut}
                  </p>
                )}
                {renderSlide(q)}
              </div>
            )}
          </div>
        );
      })}
      <footer>
        {graded ? (
          footer
        ) : (
          <>
            <span>Answer every question, then submit. Answers show after.</span>
            <button
              type="button"
              className="study-primary"
              disabled={answered < total}
              onClick={() => onSubmit(picks)}
            >
              <ShellIcon name="check" />
              Submit
            </button>
          </>
        )}
      </footer>
    </section>
  );
}
