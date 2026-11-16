import { mcqLimits, publishMcq, type McqDefinition } from "../features/quiz/mcq";

/** One multiple-choice question proposed by create_quiz. */
export type AiQuestion = {
  question: string;
  options: string[];
  /** Zero-based index of the correct option. */
  correct: number;
  explanation: string;
};

/** Questions one quiz proposal may add; matches QUIZ_RULES in ai.rs. */
export const MAX_QUIZ_QUESTIONS = 20;

/** Whether create_quiz arguments fit what the MCQ composer accepts. */
export function validQuizQuestions(value: unknown): value is AiQuestion[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_QUIZ_QUESTIONS &&
    value.every((q: AiQuestion) => {
      if (
        !q ||
        typeof q.question !== "string" ||
        !q.question.trim() ||
        q.question.length > mcqLimits.question ||
        typeof q.explanation !== "string" ||
        q.explanation.length > mcqLimits.explanation ||
        !Array.isArray(q.options) ||
        q.options.length < 2 ||
        q.options.length > 4 ||
        !Number.isInteger(q.correct) ||
        q.correct < 0 ||
        q.correct >= q.options.length
      )
        return false;
      const options = q.options.map((o) =>
        typeof o === "string" ? o.trim().toLowerCase() : "",
      );
      return (
        options.every(
          (o, i) => o && (q.options[i] as string).length <= mcqLimits.option,
        ) && new Set(options).size === options.length
      );
    })
  );
}

/** A proposed question as the definition the /mcq composer would save. */
export function quizDefinition(
  q: AiQuestion,
  notebookId: string,
): McqDefinition {
  const options = q.options.map((text) => ({ id: crypto.randomUUID(), text }));
  return publishMcq({
    schemaVersion: 1,
    gradingRevision: "",
    question: q.question,
    options,
    correctOptionId: options[q.correct].id,
    explanation: q.explanation,
    sources: [{ notebookId }],
  });
}

/** A quiz proposal as plain lines, for copying or saving as a card. */
export function quizLines(questions: AiQuestion[] | undefined): string[] {
  return (questions ?? []).flatMap((q, n) => [
    `${n + 1}. ${q.question}`,
    ...q.options.map(
      (option, o) =>
        `${"ABCD"[o]}. ${option}${o === q.correct ? " (correct)" : ""}`,
    ),
    ...(q.explanation ? [q.explanation] : []),
  ]);
}
