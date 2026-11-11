export interface McqDefinition {
  schemaVersion: 1;
  gradingRevision: string;
  question: string;
  options: { id: string; text: string }[];
  correctOptionId: string;
  explanation: string;
  sources: { notebookId: string; cardId?: string; excerpt?: string }[];
}

export interface McqProgress {
  cardId: string;
  revision: string;
  optionId: string | null;
  correct: boolean | null;
}

export interface McqMutation extends Omit<McqProgress, "correct"> {
  notebookId: string;
  attemptId: string | null;
}

export const mcqLimits = { question: 1000, option: 500, explanation: 4000 };

export function mcqError(value: McqDefinition): string | undefined {
  if (!value.question.trim()) return "Write a question.";
  if (
    value.question.length > mcqLimits.question ||
    value.explanation.length > mcqLimits.explanation
  )
    return "Shorten the question or explanation.";
  if (value.options.length < 2 || value.options.length > 4)
    return "Use two to four options.";
  if (
    value.options.some(
      ({ text }) => !text.trim() || text.length > mcqLimits.option,
    )
  )
    return "Fill in each option.";
  if (new Set(value.options.map(({ id }) => id)).size !== value.options.length)
    return "Option IDs must be unique.";
  if (!value.options.some(({ id }) => id === value.correctOptionId))
    return "Mark one option as correct.";
}

export function readMcqDraft(value: unknown): McqDefinition | undefined {
  if (!value || typeof value !== "object") return;
  const quiz = value as McqDefinition;
  if (
    quiz.schemaVersion !== 1 ||
    typeof quiz.gradingRevision !== "string" ||
    !quiz.gradingRevision ||
    typeof quiz.question !== "string" ||
    typeof quiz.correctOptionId !== "string" ||
    typeof quiz.explanation !== "string" ||
    !Array.isArray(quiz.options) ||
    !quiz.options.every(
      (option) =>
        option &&
        typeof option.id === "string" &&
        !!option.id &&
        typeof option.text === "string",
    ) ||
    !Array.isArray(quiz.sources) ||
    quiz.sources.length > 10 ||
    !quiz.sources.every(
      (source) =>
        source &&
        typeof source.notebookId === "string" &&
        (source.cardId === undefined || typeof source.cardId === "string") &&
        (source.excerpt === undefined ||
          (typeof source.excerpt === "string" &&
            source.excerpt.length <= 2000)),
    ) ||
    quiz.question.length > mcqLimits.question ||
    quiz.explanation.length > mcqLimits.explanation ||
    quiz.options.length < 2 ||
    quiz.options.length > 4 ||
    quiz.options.some(({ text }) => text.length > mcqLimits.option) ||
    new Set(quiz.options.map(({ id }) => id)).size !== quiz.options.length
  )
    return;
  return quiz;
}

export function readMcq(value: unknown): McqDefinition | undefined {
  const quiz = readMcqDraft(value);
  if (quiz && !mcqError(quiz)) return quiz;
}

export function newMcqOption() {
  return { id: crypto.randomUUID(), text: "" };
}

export function blankMcq(): McqDefinition {
  return {
    schemaVersion: 1,
    gradingRevision: crypto.randomUUID(),
    question: "",
    options: [newMcqOption(), newMcqOption()],
    correctOptionId: "",
    explanation: "",
    sources: [],
  };
}

export function publishMcq(
  draft: McqDefinition,
  previous?: McqDefinition,
): McqDefinition {
  const next = {
    ...draft,
    question: draft.question.trim(),
    options: draft.options.map(({ id, text }) => ({ id, text: text.trim() })),
    explanation: draft.explanation.trim(),
  };
  const grading = (quiz: McqDefinition) =>
    JSON.stringify([quiz.question, quiz.options, quiz.correctOptionId]);
  next.gradingRevision =
    previous && grading(previous) === grading(next)
      ? previous.gradingRevision
      : crypto.randomUUID();
  if (!readMcq(next))
    throw Error(mcqError(next) ?? "Invalid multiple-choice question.");
  return next;
}

export function mcqText(quiz: McqDefinition) {
  return [
    quiz.question,
    ...quiz.options.map(({ text }, index) => `${"ABCD"[index]}. ${text}`),
  ].join("\n");
}
