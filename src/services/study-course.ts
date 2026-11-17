import type * as Y from "yjs";
import { validQuizQuestions, type AiQuestion } from "./ai-quiz";

/**
 * Study courses (docs/STUDY-COURSE-PLAN.md): a plan of checkpoints over a
 * notebook's slide decks, each with a short lesson and MCQs, then a final
 * mixed exam. Courses live in the notebook's own document, so they save,
 * back up and share with it; grading happens here, never in the model.
 */
export type StudyGoal = "mcq" | "written" | "understanding";
export type StudyPace = "fast" | "balanced" | "thorough";
export type StudySource = { key: string; name: string; pages: number };
export type SlideRange = { source: number; from: number; to: number };
export type StudyQuestion = AiQuestion & {
  /** The deck slide it tests, and which source file (index). */
  slide: number;
  source: number;
  /** The checkpoint it mainly tests (final exam and drills). */
  area?: number;
  /** A memory hook shown when it's answered wrong. */
  shortcut?: string;
};
export type StudyLesson = {
  intro: string;
  points: { term: string; definition: string; example: string; slide: number }[];
  remember: { columns: string[]; rows: string[][] };
  traps: string[];
  questions: StudyQuestion[];
};
export type StudyAttempt = { picks: number[]; score: number; at: number };
export type StudyCheckpoint = {
  title: string;
  slides: SlideRange[];
  lesson?: StudyLesson;
  attempts: StudyAttempt[];
};
export type StudyCourse = {
  id: string;
  name: string;
  created: number;
  goal: StudyGoal;
  pace: StudyPace;
  options: { harder: boolean; finalExam: boolean };
  sources: StudySource[];
  checkpoints: StudyCheckpoint[];
  /** Checkpoints opened out of order with Skip ahead. */
  unlocked?: number[];
  final?: { questions: StudyQuestion[]; attempts: StudyAttempt[] };
  drill?: { questions: StudyQuestion[]; attempts: StudyAttempt[] };
  /** What its AI requests cost so far (USD, priced ones only). */
  spent?: number;
};

export const MAX_COURSE_SOURCES = 3;
export const FINAL_QUESTIONS = 15;
export const DRILL_QUESTIONS = 5;
/** Questions per checkpoint by pace. */
export const QUESTIONS_BY_PACE: Record<StudyPace, number> = {
  fast: 4,
  balanced: 5,
  thorough: 6,
};
/** Score the final exam aims for (ChatGPT's target: 13 of 15). */
export const FINAL_TARGET = 0.85;

// Storage -----------------------------------------------------------------

/** The notebook's courses: id → JSON, beside knot:card-links. */
export const STUDY_MAP = "knot:study-courses";
/** Course writes stay out of the editor's undo history. */
const STUDY_ORIGIN = { study: true };

export function courseMap(spaceDoc: Y.Doc) {
  return spaceDoc.getMap<string>(STUDY_MAP);
}
export function readCourses(spaceDoc: Y.Doc): StudyCourse[] {
  const courses: StudyCourse[] = [];
  courseMap(spaceDoc).forEach((value) => {
    try {
      const course = JSON.parse(value) as StudyCourse;
      if (course?.id && Array.isArray(course.checkpoints)) courses.push(course);
    } catch {
      /* A damaged course is skipped, not fatal. */
    }
  });
  return courses.sort((a, b) => b.created - a.created);
}
export function saveCourse(spaceDoc: Y.Doc, course: StudyCourse) {
  spaceDoc.transact(
    () => courseMap(spaceDoc).set(course.id, JSON.stringify(course)),
    STUDY_ORIGIN,
  );
}
export function deleteCourse(spaceDoc: Y.Doc, id: string) {
  spaceDoc.transact(() => courseMap(spaceDoc).delete(id), STUDY_ORIGIN);
}

// Progress ----------------------------------------------------------------

/** The best attempt's score, or undefined before any. */
export const bestScore = (attempts: StudyAttempt[]) =>
  attempts.length ? Math.max(...attempts.map((a) => a.score)) : undefined;

export type CheckpointState = "done" | "current" | "open" | "locked";
/** Done once attempted; the first undone one is current; later ones are
 * locked unless skipped ahead to. */
export function checkpointStates(course: StudyCourse): CheckpointState[] {
  let current = false;
  return course.checkpoints.map((checkpoint, i) => {
    if (checkpoint.attempts.length) return "done";
    if (!current) {
      current = true;
      return "current";
    }
    return course.unlocked?.includes(i) ? "open" : "locked";
  });
}
export const allCheckpointsDone = (course: StudyCourse) =>
  course.checkpoints.every((c) => c.attempts.length);

export function courseProgress(course: StudyCourse) {
  const steps = course.checkpoints.length + (course.options.finalExam ? 1 : 0);
  const done =
    course.checkpoints.filter((c) => c.attempts.length).length +
    (course.final?.attempts.length ? 1 : 0);
  let right = 0;
  let asked = 0;
  for (const checkpoint of course.checkpoints) {
    const last = checkpoint.attempts.at(-1);
    if (!last || !checkpoint.lesson) continue;
    right += last.score;
    asked += checkpoint.lesson.questions.length;
  }
  const finalLast = course.final?.attempts.at(-1);
  if (finalLast && course.final) {
    right += finalLast.score;
    asked += course.final.questions.length;
  }
  return { steps, done, right, asked };
}

// Grading -----------------------------------------------------------------

export function grade(questions: StudyQuestion[], picks: number[]): StudyAttempt {
  return {
    picks,
    score: questions.filter((q, i) => picks[i] === q.correct).length,
    at: Date.now(),
  };
}

export type Readiness = "Excellent" | "Good" | "Review";
/** Accuracy per checkpoint over its latest attempt and the final exam's
 * questions about it. */
export function readiness(course: StudyCourse) {
  return course.checkpoints.map((checkpoint, area) => {
    let right = 0;
    let asked = 0;
    const last = checkpoint.attempts.at(-1);
    if (last && checkpoint.lesson) {
      right += last.score;
      asked += checkpoint.lesson.questions.length;
    }
    const final = course.final;
    const finalLast = final?.attempts.at(-1);
    if (final && finalLast)
      final.questions.forEach((q, i) => {
        if (q.area !== area) return;
        asked++;
        if (finalLast.picks[i] === q.correct) right++;
      });
    const ratio = asked ? right / asked : 0;
    const level: Readiness = ratio >= 0.9 ? "Excellent" : ratio >= 0.7 ? "Good" : "Review";
    return { title: checkpoint.title, right, asked, level };
  });
}

/** Checkpoints whose questions were missed most recently (for a drill). */
export function weakAreas(course: StudyCourse): number[] {
  return readiness(course)
    .map((r, i) => ({ ...r, i }))
    .filter((r) => r.asked && r.level !== "Excellent")
    .map((r) => r.i);
}

/** The last-minute revision sheet, built from the lessons without AI. */
export function revisionSheet(course: StudyCourse) {
  return course.checkpoints.flatMap((checkpoint) =>
    checkpoint.lesson
      ? [
          {
            title: checkpoint.title,
            columns: checkpoint.lesson.remember.columns,
            rows: checkpoint.lesson.remember.rows,
            traps: checkpoint.lesson.traps,
          },
        ]
      : [],
  );
}

// Reading the model's output ---------------------------------------------

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
const int = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) ? value : NaN;

/** Slide ranges that fit the files, merged per checkpoint. */
export function readPlan(value: unknown, sources: StudySource[]): StudyCheckpoint[] {
  const raw = (value as { checkpoints?: unknown })?.checkpoints;
  if (!Array.isArray(raw)) throw new Error("The course plan was incomplete.");
  const checkpoints = raw.slice(0, 8).flatMap((item): StudyCheckpoint[] => {
    const title = text((item as { title?: unknown })?.title, 80);
    const slides = (((item as { slides?: unknown })?.slides ?? []) as unknown[])
      .flatMap((range): SlideRange[] => {
        const r = range as Record<string, unknown>;
        const source = int(r?.source);
        const from = int(r?.from);
        const to = int(r?.to);
        const pages = sources[source]?.pages ?? 0;
        if (!pages || !(from >= 1) || !(to >= from)) return [];
        return [{ source, from, to: Math.min(to, pages) }];
      })
      .filter((r) => r.from <= r.to);
    return title && slides.length ? [{ title, slides, attempts: [] }] : [];
  });
  if (checkpoints.length < 2) throw new Error("The course plan was too short. Try again.");
  return checkpoints;
}

function readQuestions(
  value: unknown,
  sources: StudySource[],
  limit: number,
  areas: number,
): StudyQuestion[] {
  if (!Array.isArray(value)) return [];
  const questions = value.slice(0, limit).flatMap((item): StudyQuestion[] => {
    const q = item as Record<string, unknown>;
    const base = {
      question: text(q?.question, 1000),
      options: Array.isArray(q?.options) ? q.options.map((o) => text(o, 500)) : [],
      correct: int(q?.correct),
      explanation: text(q?.explanation, 1000),
    };
    if (!validQuizQuestions([base])) return [];
    const source = int(q?.source);
    const area = int(q?.area);
    return [
      {
        ...base,
        source: source >= 0 && source < sources.length ? source : 0,
        slide: Math.max(0, int(q?.slide) || 0),
        ...(area >= 0 && area < areas && { area }),
        ...(text(q?.shortcut, 160) && { shortcut: text(q?.shortcut, 160) }),
      },
    ];
  });
  return questions;
}

export function readLesson(
  value: unknown,
  sources: StudySource[],
  limit: number,
): StudyLesson {
  const v = value as Record<string, unknown>;
  const points = (Array.isArray(v?.points) ? v.points : [])
    .slice(0, 8)
    .map((p) => {
      const point = p as Record<string, unknown>;
      return {
        term: text(point?.term, 120),
        definition: text(point?.definition, 400),
        example: text(point?.example, 300),
        slide: Math.max(0, int(point?.slide) || 0),
      };
    })
    .filter((p) => p.term && p.definition);
  const remember = v?.remember as Record<string, unknown> | undefined;
  const columns = (Array.isArray(remember?.columns) ? remember.columns : [])
    .slice(0, 3)
    .map((c) => text(c, 60));
  const rows = (Array.isArray(remember?.rows) ? remember.rows : [])
    .slice(0, 12)
    .map((row) =>
      columns.map((_, i) => text(Array.isArray(row) ? row[i] : "", 200)),
    )
    .filter((row) => row.some(Boolean));
  const questions = readQuestions(v?.questions, sources, limit, 0);
  if (!points.length || !questions.length)
    throw new Error("The lesson was incomplete. Try again.");
  return {
    intro: text(v?.intro, 400),
    points,
    remember: { columns, rows },
    traps: (Array.isArray(v?.traps) ? v.traps : [])
      .slice(0, 4)
      .map((t) => text(t, 300))
      .filter(Boolean),
    questions,
  };
}

export function readExam(
  value: unknown,
  sources: StudySource[],
  limit: number,
  areas: number,
): StudyQuestion[] {
  const questions = readQuestions(
    (value as { questions?: unknown })?.questions,
    sources,
    limit,
    areas,
  );
  if (!questions.length) throw new Error("The questions were incomplete. Try again.");
  return questions;
}

/** A message about getting ready for a test, where a study course helps. */
export function wantsStudyCourse(message: string) {
  return /\b(exam|test|quiz|mcq|revis\w*|revision|study|studying|prepare|prep|midterm|final)\b/i.test(
    message,
  );
}

/** "slide 4" or "slides 2–3". */
export function slideRange(from: number, to: number) {
  return to > from ? `slides ${from}–${to}` : `slide ${from}`;
}

/** A definition without the term repeated at its start ("Component
 * testing, also called…" under "Component testing"). */
export function withoutTerm(term: string, definition: string) {
  const t = term.trim().toLowerCase();
  const d = definition.trim();
  if (!t || !d.toLowerCase().startsWith(t)) return d;
  const rest = d.slice(t.length).replace(/^[\s,:;–—-]+/, "");
  if (!rest) return d;
  return /^(is|are|was|means|refers)\b/i.test(rest) || /^[a-z]/.test(rest)
    ? rest.charAt(0).toUpperCase() + rest.slice(1)
    : d;
}

