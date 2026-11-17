import { expect, it } from "vitest";
import {
  followUpActions,
  followUpMessage,
  parseFollowUps,
  ruleFollowUps,
} from "../src/services/ai-followups";
import type { AiAbilities } from "../src/services/ai-preferences";

const all = {
  editNote: true,
  canvasCards: true,
  quizzes: true,
  createNotes: true,
} as AiAbilities;

const revision = `## Test levels

1. **Component testing:** individual components in isolation.
2. **Integration testing:** interfaces between components.
3. **System testing:** the behaviour of the whole system.

## Test types

- **Functional testing:** what the system does.
- **Non-functional testing:** performance, usability and security.`;

it("offers only what is open and allowed", () => {
  expect(
    followUpActions(all, { canvas: true, note: true, editable: true }),
  ).toEqual(["cards", "mindmap", "quiz", "note"]);
  expect(
    followUpActions(all, { canvas: false, note: true, editable: true }),
  ).toEqual(["quiz", "note", "insert"]);
  expect(
    followUpActions(
      { ...all, canvasCards: false, createNotes: false },
      { canvas: true, note: true, editable: true },
    ),
  ).toEqual(["quiz"]);
  expect(
    followUpActions(all, { canvas: true, note: true, editable: false }),
  ).toEqual([]);
});

it("suggests steps only for structured answers", () => {
  const available = followUpActions(all, {
    canvas: true,
    note: true,
    editable: true,
  });
  expect(ruleFollowUps(revision, available).map((f) => f.action)).toEqual([
    "cards",
    "mindmap",
    "quiz",
  ]);
  // Plain conversation, however long, gets no buttons.
  const chat =
    "Sure! Component testing is usually done by developers, and it checks each part on its own before anything is combined. ".repeat(
      6,
    );
  expect(ruleFollowUps(chat, available)).toEqual([]);
  expect(ruleFollowUps("1. A\n2. B\n3. C", available)).toEqual([]);
});

it("keeps only possible, distinct model suggestions", () => {
  const output = JSON.stringify({
    items: [
      { action: "cards", label: "Make 9 revision cards", focus: "" },
      { action: "cards", label: "Duplicate", focus: "" },
      { action: "insert", label: "Not offered", focus: "" },
      { action: "quiz", label: "Quiz me", focus: "One question per level." },
      { action: "mindmap", label: "See https://example.com", focus: "" },
    ],
  });
  expect(parseFollowUps(output, ["cards", "mindmap", "quiz"])).toEqual([
    { action: "cards", label: "Make 9 revision cards" },
    { action: "quiz", label: "Quiz me", focus: "One question per level." },
  ]);
  expect(parseFollowUps('{"items":[]}', ["cards"])).toEqual([]);
  expect(() => parseFollowUps('"nope"', ["cards"])).toThrow();
});

it("sends the answer as the only source", () => {
  const message = followUpMessage(
    { action: "mindmap", label: "Mind map", focus: "Group by level." },
    "Answer text",
  );
  expect(message).toContain("mind map");
  expect(message).toContain("Group by level.");
  expect(message).toContain("do not add new ones");
  expect(message.endsWith("\n\nAnswer text")).toBe(true);
});
