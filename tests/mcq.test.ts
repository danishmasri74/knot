import { describe, expect, it } from "vitest";
import { blankMcq, publishMcq, readMcq } from "../src/features/quiz/mcq";

describe("multiple-choice definitions", () => {
  const definition = () => {
    const quiz = blankMcq();
    quiz.question = "What is two plus two?";
    quiz.options[0].text = "Four";
    quiz.options[1].text = "Five";
    quiz.correctOptionId = quiz.options[0].id;
    return publishMcq(quiz);
  };

  it("retains grading identity for explanation edits and changes it for answer-key edits", () => {
    const quiz = definition();
    const explained = publishMcq(
      { ...quiz, explanation: "Two pairs make four." },
      quiz,
    );
    expect(explained.gradingRevision).toBe(quiz.gradingRevision);
    const edited = publishMcq(
      { ...explained, correctOptionId: quiz.options[1].id },
      explained,
    );
    expect(edited.gradingRevision).not.toBe(quiz.gradingRevision);
  });

  it("rejects unsupported definitions and choices without a valid answer key", () => {
    const quiz = definition();
    expect(readMcq({ ...quiz, schemaVersion: 2 })).toBeUndefined();
    expect(readMcq({ ...quiz, correctOptionId: "missing" })).toBeUndefined();
    expect(() => publishMcq({ ...quiz, options: [quiz.options[0]] })).toThrow();
  });
});
