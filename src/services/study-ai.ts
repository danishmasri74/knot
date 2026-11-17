import { Channel, invoke } from "@tauri-apps/api/core";
import { automaticAiModel, visibleAiModels } from "./ai-preferences";
import {
  DRILL_QUESTIONS,
  FINAL_QUESTIONS,
  QUESTIONS_BY_PACE,
  readExam,
  readLesson,
  readPlan,
  type SlideRange,
  type StudyCheckpoint,
  type StudyCourse,
  type StudyLesson,
  type StudyQuestion,
  type StudySource,
} from "./study-course";

/** What one request cost, as Rust prices it (diagnostics.rs). */
export type StudyCost = { usd: number | null };
type Files = { name: string; data: string }[];
const GOALS = {
  mcq: "a multiple-choice test",
  written: "a written exam",
  understanding: "understanding the material",
};

/**
 * One course request (COURSE_MODES in ai.rs). The writing model is used,
 * since lessons and questions are the product; the cost is reported.
 */
async function request(
  mode: "course_plan" | "course_lesson" | "course_final" | "course_drill",
  context: unknown,
  files: Files,
  onCost: (cost: StudyCost) => void,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!(await invoke<boolean>("ai_connected")))
    throw new Error("Connect an AI model in Settings → AI to build a course.");
  const models = visibleAiModels(await invoke<string[]>("ai_models"));
  if (!models.length) throw new Error("Turn on an AI model in Settings → AI.");
  const id = crypto.randomUUID();
  let output = "";
  const channel = new Channel<{ delta: string; cost?: StudyCost }>();
  channel.onmessage = ({ delta, cost }) => {
    if (cost) onCost(cost);
    else if (output.length < 400_000) output += delta;
  };
  const stop = () => void invoke("ai_cancel", { id }).catch(() => {});
  signal?.addEventListener("abort", stop, { once: true });
  try {
    await invoke("ai_respond", {
      id,
      model: automaticAiModel(models, "course", "", true, 0),
      mode,
      messages: [{ role: "user", content: "Build this part of the course." }],
      context: JSON.stringify(context),
      pdfFiles: files,
      onEvent: channel,
    });
  } finally {
    signal?.removeEventListener("abort", stop);
  }
  try {
    return JSON.parse(output);
  } catch {
    throw new Error("The reply was cut off. Try again.");
  }
}

async function wholeFiles(sources: StudySource[]): Promise<Files> {
  const { preparePdfFiles } = await import("./pdf-input");
  return preparePdfFiles(sources.map(({ key, name }) => ({ key, name })));
}

/** Only these slide ranges, one small PDF per range. */
async function slicedFiles(sources: StudySource[], ranges: SlideRange[]) {
  const { slicePdf } = await import("./pdf-input");
  const files: Files = [];
  const described = [];
  for (const range of ranges.slice(0, 3)) {
    const source = sources[range.source];
    if (!source) continue;
    files.push({
      name: `${source.name} (slides ${range.from}-${range.to})`,
      data: await slicePdf(source.key, range.from, range.to),
    });
    described.push({
      index: range.source,
      name: source.name,
      firstSlide: range.from,
      lastSlide: range.to,
    });
  }
  return { files, described };
}

/** Reads each deck's page count, then asks for the checkpoint plan. */
export async function planCourse(
  course: Pick<StudyCourse, "name" | "goal" | "pace" | "options"> & {
    sources: Omit<StudySource, "pages">[];
  },
  onCost: (cost: StudyCost) => void,
  signal?: AbortSignal,
): Promise<{ sources: StudySource[]; checkpoints: StudyCheckpoint[] }> {
  const { pdfPageCount } = await import("./pdf-input");
  const sources = await Promise.all(
    course.sources.map(async (s) => ({ ...s, pages: await pdfPageCount(s.key) })),
  );
  const plan = await request(
    "course_plan",
    {
      course: course.name,
      preparingFor: GOALS[course.goal],
      pace: course.pace,
      files: sources.map((s, index) => ({ index, name: s.name, pages: s.pages })),
    },
    await wholeFiles(sources),
    onCost,
    signal,
  );
  return { sources, checkpoints: readPlan(plan, sources) };
}

/** The lesson and questions for one checkpoint, from its slides only. */
export async function makeLesson(
  course: StudyCourse,
  index: number,
  onCost: (cost: StudyCost) => void,
  signal?: AbortSignal,
): Promise<StudyLesson> {
  const checkpoint = course.checkpoints[index];
  const { files, described } = await slicedFiles(course.sources, checkpoint.slides);
  const count = QUESTIONS_BY_PACE[course.pace];
  const lesson = await request(
    "course_lesson",
    {
      course: course.name,
      preparingFor: GOALS[course.goal],
      pace: course.pace,
      harder: course.options.harder,
      checkpoint: {
        number: index + 1,
        total: course.checkpoints.length,
        title: checkpoint.title,
      },
      earlierCheckpoints: course.checkpoints.slice(0, index).map((c) => c.title),
      files: described,
      questions: count,
    },
    files,
    onCost,
    signal,
  );
  return readLesson(lesson, course.sources, count + 2);
}

/** The final mixed exam over every checkpoint. */
export async function makeFinal(
  course: StudyCourse,
  onCost: (cost: StudyCost) => void,
  signal?: AbortSignal,
): Promise<StudyQuestion[]> {
  const exam = await request(
    "course_final",
    {
      course: course.name,
      preparingFor: GOALS[course.goal],
      checkpoints: course.checkpoints.map((c, area) => ({
        area,
        title: c.title,
        points: (c.lesson?.points ?? []).map((p) => `${p.term}: ${p.definition}`),
      })),
      files: course.sources.map((s, index) => ({ index, name: s.name, pages: s.pages })),
      questions: FINAL_QUESTIONS,
    },
    await wholeFiles(course.sources),
    onCost,
    signal,
  );
  return readExam(exam, course.sources, FINAL_QUESTIONS + 3, course.checkpoints.length);
}

/** A few new questions on the weak checkpoints. */
export async function makeDrill(
  course: StudyCourse,
  areas: number[],
  onCost: (cost: StudyCost) => void,
  signal?: AbortSignal,
): Promise<StudyQuestion[]> {
  const ranges = areas.flatMap((a) => course.checkpoints[a]?.slides ?? []);
  const { files, described } = await slicedFiles(course.sources, ranges);
  const final = course.final;
  const finalPicks = final?.attempts.at(-1)?.picks ?? [];
  const drill = await request(
    "course_drill",
    {
      course: course.name,
      weak: areas.map((area) => ({
        area,
        title: course.checkpoints[area].title,
        points: (course.checkpoints[area].lesson?.points ?? []).map(
          (p) => `${p.term}: ${p.definition}`,
        ),
        missed: (final?.questions ?? [])
          .filter((q, i) => q.area === area && finalPicks[i] !== q.correct)
          .map((q) => q.question),
      })),
      files: described,
      questions: DRILL_QUESTIONS,
    },
    files,
    onCost,
    signal,
  );
  return readExam(drill, course.sources, DRILL_QUESTIONS + 2, course.checkpoints.length);
}
