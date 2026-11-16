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

/** Where create_quiz puts its questions: a new linked card, or the note. */
export type QuizTarget = "card" | "note";

/** A quiz card's h1, named after the note it tests. */
export function quizCardTitle(source: string | undefined): string {
  const name = (source ?? "").split("\n")[0].replace(/\s+/g, " ").trim();
  if (!name) return "Quiz";
  return `Quiz: ${name.length > 60 ? `${name.slice(0, 59).trimEnd()}…` : name}`;
}

export type QuizBounds = [x: number, y: number, w: number, h: number];
const GAP = 40;

/** Rough rendered size of a quiz card, used only to keep it clear of others. */
export function quizCardSize(questions: AiQuestion[]): [number, number] {
  return [
    448,
    80 + questions.reduce((h, q) => h + 96 + q.options.length * 40, 0),
  ];
}

/**
 * Bounds for a new quiz card: right of its source note, moving down past
 * anything in the way; without a source, right of everything.
 */
export function quizCardPlacement(
  source: QuizBounds | undefined,
  occupied: QuizBounds[],
  [w, h]: [number, number],
): QuizBounds {
  const rightOfAll = Math.max(0, ...occupied.map((b) => b[0] + b[2] + 80));
  const x = source ? source[0] + source[2] + 120 : rightOfAll;
  let y = source ? source[1] : 0;
  for (let tries = 0; tries < 100; tries++) {
    const hits = occupied.filter(
      (b) =>
        x < b[0] + b[2] + GAP &&
        x + w + GAP > b[0] &&
        y < b[1] + b[3] + GAP &&
        y + h + GAP > b[1],
    );
    if (!hits.length) return [x, y, w, h];
    y = Math.max(...hits.map((b) => b[1] + b[3])) + GAP * 1.5;
  }
  return [rightOfAll, source ? source[1] : 0, w, h];
}
