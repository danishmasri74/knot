import { ShellIcon } from "./ShellIcon";
import type { AiQuestion } from "../services/ai-quiz";

/**
 * An inline quiz in an Ask Knot answer (design proposal A): every question
 * stacked, checked as soon as an option is picked, with a score, Try again
 * and Save as quiz card. Choices live on the chat message, not Card Deck.
 */
export function AnswerQuiz({
  questions,
  choices,
  onChoose,
  onReset,
  saved,
  saveBlocked,
  onSave,
  onShow,
  onUndo,
}: {
  questions: AiQuestion[];
  /** The option picked per question, -1 while unanswered. */
  choices: number[];
  onChoose: (question: number, option: number) => void;
  onReset: () => void;
  saved: boolean;
  /** Why Save is unavailable (no editable notebook), if it is. */
  saveBlocked?: string;
  onSave: () => void;
  onShow?: () => void;
  onUndo?: () => void;
}) {
  const answered = choices.filter((c) => c >= 0).length;
  const right = questions.filter((q, i) => choices[i] === q.correct).length;
  const total = questions.length;
  return (
    <section className="ask-quiz" aria-label={`Quiz, ${total} questions`}>
      <header>
        <ShellIcon name="multipleChoice" />
        <strong>Quiz</strong>
        <span>
          · {total} {total === 1 ? "question" : "questions"}
        </span>
        <span className="ask-quiz-progress">
          {answered} of {total} answered
        </span>
      </header>
      {questions.map((q, qi) => {
        const chosen = choices[qi] ?? -1;
        const done = chosen >= 0;
        const good = done && chosen === q.correct;
        return (
          <div className="ask-quiz-question" key={qi}>
            <div className="ask-quiz-prompt" id={`quiz-q-${qi}`}>
              {qi + 1}. {q.question}
            </div>
            <div role="radiogroup" aria-labelledby={`quiz-q-${qi}`}>
              {q.options.map((option, oi) => {
                const state = !done
                  ? undefined
                  : oi === q.correct
                    ? "right"
                    : oi === chosen
                      ? "wrong"
                      : "other";
                return (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={chosen === oi}
                    aria-disabled={done}
                    data-state={state}
                    key={oi}
                    onClick={() => !done && onChoose(qi, oi)}
                  >
                    <span className="ask-quiz-mark" aria-hidden="true">
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
            {done && (
              <p className="ask-quiz-feedback" data-good={good} role="status">
                <strong>{good ? "Correct." : "Not quite."}</strong>{" "}
                {q.explanation}
              </p>
            )}
          </div>
        );
      })}
      <footer>
        <span className="ask-quiz-score">
          {answered === total
            ? `${right} of ${total} correct`
            : `${right} correct so far`}
        </span>
        {saved ? (
          <>
            <span className="ask-quiz-saved">Saved to Card Deck</span>
            {onShow && (
              <button type="button" onClick={onShow}>
                Show quiz
              </button>
            )}
            {onUndo && (
              <button type="button" onClick={onUndo}>
                Undo
              </button>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              className="ask-quiz-reset"
              disabled={!answered}
              onClick={onReset}
            >
              Try again
            </button>
            <button
              type="button"
              className="ask-quiz-save"
              disabled={!!saveBlocked}
              data-tooltip={saveBlocked}
              onClick={onSave}
            >
              <ShellIcon name="cardPlus" />
              Save as quiz card
            </button>
          </>
        )}
      </footer>
    </section>
  );
}
