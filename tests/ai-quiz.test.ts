import { expect, it } from "vitest";
import {
  MAX_QUIZ_QUESTIONS,
  quizDefinition,
  quizLines,
  validQuizQuestions,
  type AiQuestion,
} from "../src/services/ai-quiz";
import { readMcq } from "../src/features/quiz/mcq";

const question: AiQuestion = {
  question: "What does spaced repetition schedule?",
  options: ["Reviews", "Lectures", "Exams", "Breaks"],
  correct: 0,
  explanation: "It spaces reviews out over time.",
};

it("accepts questions the MCQ composer would accept", () => {
  expect(validQuizQuestions([question])).toBe(true);
  expect(
    validQuizQuestions([{ ...question, options: ["Yes", "No"], correct: 1 }]),
  ).toBe(true);
  expect(validQuizQuestions([{ ...question, explanation: "" }])).toBe(true);
});

it("rejects malformed or out-of-range questions", () => {
  for (const bad of [
    [],
    "questions",
    Array(MAX_QUIZ_QUESTIONS + 1).fill(question),
    [{ ...question, question: "  " }],
    [{ ...question, question: "x".repeat(1001) }],
    [{ ...question, options: ["Only one"] }],
    [{ ...question, options: ["A", "B", "C", "D", "E"] }],
    [{ ...question, options: ["Reviews", " "] }],
    [{ ...question, options: ["Reviews", "reviews "] }],
    [{ ...question, options: ["Reviews", "x".repeat(501)] }],
    [{ ...question, options: ["Reviews", 3] }],
    [{ ...question, correct: 4 }],
    [{ ...question, correct: -1 }],
    [{ ...question, correct: 1.5 }],
    [{ ...question, explanation: "x".repeat(4001) }],
    [{ ...question, explanation: undefined }],
    [null],
  ])
    expect(validQuizQuestions(bad)).toBe(false);
});

it("saves the correct option and a link to the notebook", () => {
  const definition = quizDefinition(
    { ...question, options: ["Lectures", "Reviews"], correct: 1 },
    "notebook-1",
  );
  expect(readMcq(definition)).toEqual(definition);
  expect(
    definition.options.find(({ id }) => id === definition.correctOptionId)
      ?.text,
  ).toBe("Reviews");
  expect(definition.sources).toEqual([{ notebookId: "notebook-1" }]);
  expect(definition.gradingRevision).not.toBe("");
});

it("copies a quiz as numbered lines with the answer marked", () => {
  expect(quizLines([question])).toEqual([
    "1. What does spaced repetition schedule?",
    "A. Reviews (correct)",
    "B. Lectures",
    "C. Exams",
    "D. Breaks",
    "It spaces reviews out over time.",
  ]);
  expect(quizLines(undefined)).toEqual([]);
});
