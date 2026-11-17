import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  STUDY_MAP,
  checkpointStates,
  courseProgress,
  deleteCourse,
  grade,
  readCourses,
  readExam,
  readLesson,
  readPlan,
  readiness,
  revisionSheet,
  saveCourse,
  weakAreas,
  type StudyCourse,
  type StudyQuestion,
} from "../src/services/study-course";

const sources = [
  { key: "a", name: "11-SDLC.pptx", pages: 9 },
  { key: "b", name: "12-Levels.pptx", pages: 5 },
];
const q = (n: number, correct = 0, area?: number): StudyQuestion => ({
  question: `Question ${n}?`,
  options: ["Right", "Wrong", "Other"],
  correct,
  explanation: "Because.",
  slide: 3,
  source: 1,
  ...(area !== undefined && { area }),
});
const lessonOf = (questions: StudyQuestion[]) => ({
  intro: "",
  points: [{ term: "Term", definition: "Def", example: "", slide: 3 }],
  remember: { columns: ["Level", "Tests"], rows: [["Component", "One part"]] },
  traps: ["System is not system integration."],
  questions,
});
const course = (): StudyCourse => ({
  id: "c1",
  name: "Chapter 3",
  created: 1,
  goal: "mcq",
  pace: "fast",
  options: { harder: true, finalExam: true },
  sources,
  checkpoints: [
    { title: "SDLC", slides: [{ source: 0, from: 2, to: 5 }], attempts: [] },
    { title: "Levels", slides: [{ source: 1, from: 3, to: 3 }], attempts: [] },
    { title: "Types", slides: [{ source: 1, from: 4, to: 4 }], attempts: [] },
  ],
});

describe("reading the model's output", () => {
  it("keeps plan ranges that fit the files", () => {
    const plan = readPlan(
      {
        checkpoints: [
          { title: "SDLC", slides: [{ source: 0, from: 2, to: 5 }] },
          { title: "Levels", slides: [{ source: 1, from: 3, to: 99 }] },
          { title: "Nowhere", slides: [{ source: 7, from: 1, to: 2 }] },
          { title: "", slides: [{ source: 0, from: 1, to: 1 }] },
        ],
      },
      sources,
    );
    expect(plan.map((c) => c.title)).toEqual(["SDLC", "Levels"]);
    expect(plan[1].slides[0]).toEqual({ source: 1, from: 3, to: 5 });
    expect(() => readPlan({ checkpoints: [] }, sources)).toThrow();
  });

  it("keeps only valid questions and lesson parts", () => {
    const lesson = readLesson(
      {
        ...lessonOf([q(1), { ...q(2), correct: 9 }, { ...q(3), options: ["A", "a"] }]),
        intro: "Why it matters.",
      },
      sources,
      6,
    );
    expect(lesson.questions).toHaveLength(1);
    expect(lesson.remember.rows).toEqual([["Component", "One part"]]);
    expect(() => readLesson({ points: [], questions: [] }, sources, 6)).toThrow();
    const exam = readExam({ questions: [q(1, 0, 1), { ...q(2, 0, 9), source: 9 }] }, sources, 15, 3);
    expect(exam[0].area).toBe(1);
    expect(exam[1].area).toBeUndefined();
    expect(exam[1].source).toBe(0);
  });
});

describe("progress and grading", () => {
  it("unlocks checkpoints in order, with skip ahead", () => {
    const c = course();
    expect(checkpointStates(c)).toEqual(["current", "locked", "locked"]);
    c.checkpoints[0].attempts.push({ picks: [], score: 0, at: 1 });
    c.unlocked = [2];
    expect(checkpointStates(c)).toEqual(["done", "current", "open"]);
  });

  it("grades locally and adds up accuracy, readiness and the sheet", () => {
    const c = course();
    c.checkpoints[0].lesson = lessonOf([q(1), q(2)]);
    c.checkpoints[0].attempts.push(grade(c.checkpoints[0].lesson.questions, [0, 0]));
    c.checkpoints[1].lesson = lessonOf([q(3), q(4)]);
    c.checkpoints[1].attempts.push(grade(c.checkpoints[1].lesson.questions, [0, 1]));
    expect(c.checkpoints[1].attempts[0].score).toBe(1);
    c.final = { questions: [q(5, 0, 0), q(6, 0, 1)], attempts: [] };
    c.final.attempts.push(grade(c.final.questions, [0, 2]));
    const p = courseProgress(c);
    expect(p).toMatchObject({ steps: 4, done: 3, right: 4, asked: 6 });
    const r = readiness(c);
    expect(r[0].level).toBe("Excellent");
    expect(r[1]).toMatchObject({ right: 1, asked: 3, level: "Review" });
    expect(weakAreas(c)).toEqual([1]);
    expect(revisionSheet(c).map((s) => s.title)).toEqual(["SDLC", "Levels"]);
  });
});

it("stores courses in the notebook document", () => {
  const doc = new Y.Doc();
  const c = course();
  saveCourse(doc, c);
  expect(doc.getMap(STUDY_MAP).size).toBe(1);
  // A copy of the document (a backup, a .knotbook) brings the course along.
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  expect(readCourses(copy)[0].name).toBe("Chapter 3");
  doc.getMap<string>(STUDY_MAP).set("bad", "{not json");
  expect(readCourses(doc)).toHaveLength(1);
  deleteCourse(doc, "c1");
  expect(readCourses(doc)).toHaveLength(0);
});
