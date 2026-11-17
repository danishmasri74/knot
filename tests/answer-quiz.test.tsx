import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  answerBlocks,
  parseAnswer,
  plainAnswer,
  readQuiz,
} from "../src/services/answer-markdown";
import { AnswerQuiz } from "../src/app/AnswerQuiz";

const q = (n: number) => ({
  question: `Question ${n}?`,
  options: ["Yes", "No"],
  correct: 0,
  explanation: "Because.",
});
const block = (body: string) => "Try these:\n\n```knot-quiz\n" + body + "\n```";

it("reads quiz blocks, capped at ten questions", () => {
  expect(readQuiz(JSON.stringify({ questions: [q(1), q(2)] }))).toHaveLength(2);
  expect(readQuiz(JSON.stringify([q(1)]))).toHaveLength(1);
  expect(readQuiz(JSON.stringify({ questions: Array.from({ length: 14 }, (_, i) => q(i)) }))).toHaveLength(10);
  // Incomplete while streaming, or invalid: nothing to draw yet.
  expect(readQuiz('{"questions":[{"question":"Q')).toBeUndefined();
  expect(readQuiz(JSON.stringify({ questions: [{ ...q(1), correct: 5 }] }))).toBeUndefined();
  expect(readQuiz(JSON.stringify({ questions: [{ ...q(1), options: ["A", "a"] }] }))).toBeUndefined();
});

it("copies and saves quizzes as readable questions", () => {
  const text = block(JSON.stringify({ questions: [q(1)] }));
  expect(plainAnswer(text)).toContain("1. Question 1?");
  expect(plainAnswer(text)).not.toContain("knot-quiz");
  expect(answerBlocks(parseAnswer(text)).map((b) => b.text)).toContain("1. Question 1?");
});

it("checks answers and offers Save", () => {
  const html = renderToStaticMarkup(
    <AnswerQuiz
      questions={[q(1), q(2)]}
      choices={[1, -1]}
      onChoose={() => {}}
      onReset={() => {}}
      saved={false}
      onSave={() => {}}
    />,
  );
  expect(html).toContain("1 of 2 answered");
  expect(html).toContain('data-state="right"');
  expect(html).toContain('data-state="wrong"');
  expect(html).toContain("Not quite.");
  expect(html).toContain("0 correct so far");
  expect(html).toContain("Save as quiz card");
});
