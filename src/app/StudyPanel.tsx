import "../styles/study.css";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type * as Y from "yjs";
import { ShellIcon } from "./ShellIcon";
import { StudyQuiz } from "./StudyQuiz";
import { PdfRef } from "./PdfPreview";
import { shortPdfName } from "../services/pdf-citations";
import type { AiQuestion } from "../services/ai-quiz";
import type { AiBlock } from "../features/editor/blocksuite/ai-content";
import {
  FINAL_TARGET,
  MAX_COURSE_SOURCES,
  allCheckpointsDone,
  bestScore,
  checkpointStates,
  courseMap,
  courseProgress,
  deleteCourse,
  grade,
  readCourses,
  readiness,
  revisionSheet,
  saveCourse,
  weakAreas,
  currentAttempt,
  rememberAddsTerms,
  slideRange,
  withoutTerm,
  type StudyCourse,
  type StudyLesson,
  type StudyGoal,
  type StudyPace,
  type StudyQuestion,
} from "../services/study-course";
import {
  makeDrill,
  makeFinal,
  makeLesson,
  planCourse,
  type StudyCost,
} from "../services/study-ai";

type Pdf = { key: string; name: string };
type View =
  | { kind: "list" }
  | { kind: "setup"; picked?: string[] }
  | { kind: "course"; id: string }
  | { kind: "checkpoint"; id: string; index: number }
  | { kind: "final"; id: string }
  | { kind: "results"; id: string }
  | { kind: "drill"; id: string };

/** The notebook's courses, updated when any of them changes. */
function useCourses(spaceDoc: Y.Doc) {
  const cache = useRef<{ version: number; courses: StudyCourse[] }>({
    version: -1,
    courses: [],
  });
  const version = useRef(0);
  return useSyncExternalStore(
    (notify) => {
      const map = courseMap(spaceDoc);
      const changed = () => {
        version.current++;
        notify();
      };
      map.observe(changed);
      return () => map.unobserve(changed);
    },
    () => {
      if (cache.current.version !== version.current)
        cache.current = { version: version.current, courses: readCourses(spaceDoc) };
      return cache.current.courses;
    },
  );
}

/**
 * The Study tab (design proposal A): a notebook's study courses, each a
 * tracker of checkpoints with lessons and MCQs, a final exam and results.
 */
export function StudyPanel({
  spaceDoc,
  documentId,
  readonly,
  pdfs,
  notebookTitle,
  selected,
  start,
  onOpenPdf,
  onSaveSheet,
  onSaveQuestions,
}: {
  spaceDoc: Y.Doc;
  documentId: string;
  readonly: boolean;
  /** PDFs and slide decks attached to the notebook. */
  pdfs: () => Pdf[];
  /** The notebook's title, the default name for a course over several decks. */
  notebookTitle: string;
  /** PDFs selected on the canvas: a new course starts with these. */
  selected: () => string[];
  /** Decks picked on the canvas toolbar or in Ask Knot: open the setup. */
  start?: { keys: string[]; nonce: number };
  onOpenPdf: (pdf: Pdf, page: number) => void;
  onSaveSheet: (blocks: AiBlock[]) => void;
  onSaveQuestions: (questions: AiQuestion[]) => void;
}) {
  const courses = useCourses(spaceDoc);
  const [view, setView] = useState<View>(() =>
    start && Date.now() - start.nonce < 5000
      ? { kind: "setup", picked: start.keys }
      : { kind: "list" },
  );
  const startedAt = useRef(start?.nonce);
  useEffect(() => {
    if (!start || startedAt.current === start.nonce) return;
    startedAt.current = start.nonce;
    setView({ kind: "setup", picked: start.keys });
  }, [start]);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState("");
  const abort = useRef<AbortController>();
  /** Lessons being made in the background, shared with an open checkpoint
   * so the same lesson is never requested (and paid for) twice. */
  const prefetching = useRef(new Map<string, Promise<StudyLesson>>());
  useEffect(() => () => abort.current?.abort(), []);

  const course = "id" in view ? courses.find((c) => c.id === view.id) : undefined;
  // What the open view still needs from the model: a lesson, the final exam
  // or a drill. Made once; a failure waits for the user to come back.
  const needs =
    !course || readonly
      ? undefined
      : view.kind === "checkpoint" && !course.checkpoints[view.index]?.lesson
        ? `lesson:${view.index}`
        : view.kind === "final" && !course.final
          ? "final"
          : view.kind === "drill" && !course.drill
            ? "drill"
            : undefined;
  const asked = useRef<string>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!needs || !course) {
      asked.current = undefined;
      return;
    }
    const key = `${course.id}:${needs}`;
    if (asked.current === key) return;
    asked.current = key;
    const c = course;
    if (needs.startsWith("lesson:")) {
      const index = Number(needs.slice(7));
      void work("Preparing the lesson", async (signal) => {
        // Already being made in the background: wait for that one.
        const pending = prefetching.current.get(`${c.id}:${index}`);
        const made = pending
          ? await pending
          : await makeLesson(c, index, costTo(c.id), signal);
        update(c.id, (latest) => {
          latest.checkpoints[index].lesson ??= made;
        });
      });
    } else {
      const drill = needs === "drill";
      void work(drill ? "Writing a drill on your weak spots" : "Writing the final exam", async (signal) => {
        const questions = drill
          ? await makeDrill(c, weakAreas(c), costTo(c.id), signal)
          : await makeFinal(c, costTo(c.id), signal);
        update(c.id, (latest) => {
          if (drill) latest.drill = { questions, attempts: [] };
          else latest.final ??= { questions, attempts: [] };
        });
      });
    }
    // work, update and costTo are stable enough: they read refs and the map.
  }, [needs, course?.id, attempt]);
  /** Changes the latest saved copy, so background work never overwrites. */
  const update = (id: string, change: (course: StudyCourse) => void) => {
    const latest = readCourses(spaceDoc).find((c) => c.id === id);
    if (!latest) return;
    change(latest);
    saveCourse(spaceDoc, latest);
  };
  const costTo = (id: string) => (cost: StudyCost) =>
    cost.usd !== null &&
    update(id, (c) => {
      c.spent = (c.spent ?? 0) + (cost.usd ?? 0);
    });
  async function work(label: string, task: (signal: AbortSignal) => Promise<void>) {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(label);
    setError("");
    try {
      await task(controller.signal);
    } catch (e) {
      if (!controller.signal.aborted) setError(String(e).replace(/^Error: /, ""));
    } finally {
      if (abort.current === controller) setBusy(undefined);
    }
  }
  /** Makes the next checkpoint's lesson while this one is studied. */
  function prefetch(c: StudyCourse, index: number) {
    const next = c.checkpoints[index];
    const key = `${c.id}:${index}`;
    if (!next || next.lesson || prefetching.current.has(key) || readonly) return;
    const pending = makeLesson(c, index, costTo(c.id));
    prefetching.current.set(key, pending);
    void pending
      .then((lesson) =>
        update(c.id, (latest) => {
          latest.checkpoints[index].lesson ??= lesson;
        }),
      )
      .catch(() => {})
      .finally(() => prefetching.current.delete(key));
  }

  const slideChip = (c: StudyCourse, source: number, slide: number, to = slide) => {
    const pdf = c.sources[source];
    if (!pdf || !slide) return null;
    return (
      <PdfRef
        cited={{
          pdf: { key: pdf.key, name: pdf.name, document: documentId },
          page: slide,
          label: `${shortPdfName(pdf.name)} · ${slideRange(slide, to)}`,
        }}
        onOpen={(p, page) => onOpenPdf({ key: p.key, name: p.name }, page)}
      />
    );
  };

  const status = (busy || error) && (
    <div className="study-status" role={error ? "alert" : "status"}>
      {busy ? (
        <>
          <span className="ask-step-spinner" aria-hidden="true" />
          <span>{busy}…</span>
          <button type="button" onClick={() => abort.current?.abort()}>
            Stop
          </button>
        </>
      ) : (
        <>
          <span>{error}</span>
          {needs && (
            <button
              type="button"
              onClick={() => {
                asked.current = undefined;
                setError("");
                setAttempt((n) => n + 1);
              }}
            >
              Try again
            </button>
          )}
        </>
      )}
    </div>
  );

  // ----- Views -----

  if (view.kind === "setup")
    return (
      <StudySetup
        notebookTitle={notebookTitle}
        pdfs={pdfs()}
        picked={view.picked}
        busy={!!busy}
        readonly={readonly}
        status={status}
        onCancel={() => {
          abort.current?.abort();
          setView({ kind: "list" });
        }}
        onCreate={(setup) =>
          void work("Reading the files and planning checkpoints", async (signal) => {
            let planCost = 0;
            const plan = await planCourse(
              setup,
              (cost) => (planCost += cost.usd ?? 0),
              signal,
            );
            const created: StudyCourse = {
              id: crypto.randomUUID(),
              created: Date.now(),
              name: setup.name,
              goal: setup.goal,
              pace: setup.pace,
              options: setup.options,
              sources: plan.sources,
              checkpoints: plan.checkpoints,
              ...(planCost && { spent: planCost }),
            };
            saveCourse(spaceDoc, created);
            setView({ kind: "course", id: created.id });
            prefetch(created, 0);
          })
        }
      />
    );

  if (!course || view.kind === "list")
    return (
      <div className="study-panel" key="list">
        <div className="study-head">
          <h2>Study courses</h2>
          <button
            type="button"
            className="study-primary"
            disabled={readonly}
            onClick={() => setView({ kind: "setup", picked: selected() })}
          >
            <ShellIcon name="plus" />
            New course
          </button>
        </div>
        {courses.length ? (
          <ul className="study-course-list">
            {courses.map((c) => {
              const p = courseProgress(c);
              return (
                <li key={c.id}>
                  <button type="button" onClick={() => setView({ kind: "course", id: c.id })}>
                    <span className="study-course-name">{c.name}</span>
                    <span className="study-muted">
                      {p.done} of {p.steps} done
                      {p.asked ? ` · ${p.right}/${p.asked} correct` : ""}
                    </span>
                    <span className="study-bar" aria-hidden="true">
                      <span style={{ width: `${(p.done / p.steps) * 100}%` }} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="study-empty">
            <ShellIcon name="study" />
            <p>
              Turn slide decks into a guided course: short lessons, MCQ checkpoints with a
              progress tracker, then a final exam and a revision sheet.
            </p>
          </div>
        )}
        {status}
      </div>
    );

  const states = checkpointStates(course);
  const progress = courseProgress(course);
  const back = (
    <button type="button" className="study-back" onClick={() => setView({ kind: "course", id: course.id })}>
      <ShellIcon name="back" /> Course
    </button>
  );
  const tracker = (
    <div className="study-tracker" aria-label={`${progress.done} of ${progress.steps} done`}>
      {Array.from({ length: progress.steps }, (_, i) => (
        <span
          key={i}
          data-state={
            i < course.checkpoints.length
              ? states[i]
              : course.final?.attempts.length
                ? "done"
                : allCheckpointsDone(course)
                  ? "current"
                  : "locked"
          }
        />
      ))}
    </div>
  );

  if (view.kind === "checkpoint") {
    const index = view.index;
    const checkpoint = course.checkpoints[index];
    const lesson = checkpoint?.lesson;
    if (lesson) prefetch(course, index + 1);
    const graded = checkpoint ? currentAttempt(checkpoint) : undefined;
    const isLast = index === course.checkpoints.length - 1;
    return (
      <div className="study-panel" key={`checkpoint:${index}`}>
        <div className="study-bar-row">
          {back}
          {tracker}
          <span className="study-muted">
            {progress.done}/{progress.steps} done
          </span>
        </div>
        {checkpoint && (
          <article className="study-lesson">
            <div className="study-kicker">
              Checkpoint {index + 1} of {course.checkpoints.length}
            </div>
            <h2>{checkpoint.title}</h2>
            <div className="study-sources">
              {checkpoint.slides.map((r, i) => (
                <span key={i}>{slideChip(course, r.source, r.from, r.to)}</span>
              ))}
            </div>
            {lesson && (
              <>
                {lesson.intro && <p className="study-intro">{lesson.intro}</p>}
                <dl className="study-points">
                  {lesson.points.map((p, i) => (
                    <div key={i}>
                      <dt>{p.term}</dt>
                      <dd>
                        {withoutTerm(p.term, p.definition)}
                        {p.example && (
                          <span className="study-example">e.g. {p.example}</span>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
                {/* The table only when it adds terms the list above doesn't
                    already cover; it always goes in the revision sheet. */}
                {rememberAddsTerms(lesson) && (
                  <div className="ask-table">
                    <table>
                      <caption>Remember</caption>
                      <thead>
                        <tr>
                          {lesson.remember.columns.map((c, i) => (
                            <th key={i}>{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {lesson.remember.rows.map((row, r) => (
                          <tr key={r}>
                            {row.map((cell, i) => (
                              <td key={i}>{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {lesson.traps.length > 0 && (
                  <section className="study-traps" aria-label="MCQ traps">
                    <h3>Watch out</h3>
                    <ul>
                      {lesson.traps.map((trap, i) => (
                        <li key={i}>{trap}</li>
                      ))}
                    </ul>
                  </section>
                )}
                <StudyQuiz
                  key={`${index}:${lesson.round ?? 0}:${checkpoint.attempts.length}`}
                  title={`Checkpoint ${index + 1} quiz`}
                  questions={lesson.questions}
                  graded={graded}
                  renderSlide={(q) => slideChip(course, q.source, q.slide)}
                  onSubmit={(picks) =>
                    update(course.id, (c) => {
                      c.checkpoints[index].attempts.push(
                        grade(lesson.questions, picks, lesson.round ?? 0),
                      );
                    })
                  }
                  footer={
                    <>
                      <button
                        type="button"
                        disabled={!!busy || readonly}
                        onClick={() =>
                          void work("Writing new questions", async (signal) => {
                            const questions = await makeDrill(
                              course,
                              [index],
                              costTo(course.id),
                              signal,
                            );
                            update(course.id, (c) => {
                              const l = c.checkpoints[index].lesson;
                              if (!l) return;
                              l.questions = questions.map(({ area, shortcut, ...q }) => {
                                void area;
                                void shortcut;
                                return q;
                              });
                              // A new round: earlier scores stay in the history.
                              l.round = (l.round ?? 0) + 1;
                            });
                          })
                        }
                      >
                        Retry with new questions
                      </button>
                      <button
                        type="button"
                        className="study-primary"
                        onClick={() =>
                          setView(
                            isLast
                              ? course.options.finalExam
                                ? { kind: "final", id: course.id }
                                : { kind: "course", id: course.id }
                              : { kind: "checkpoint", id: course.id, index: index + 1 },
                          )
                        }
                      >
                        {isLast
                          ? course.options.finalExam
                            ? "Final exam →"
                            : "Back to course"
                          : `Next: ${course.checkpoints[index + 1].title} →`}
                      </button>
                    </>
                  }
                />
              </>
            )}
          </article>
        )}
        {status}
      </div>
    );
  }

  if (view.kind === "final" || view.kind === "drill") {
    const drill = view.kind === "drill";
    const set = drill ? course.drill : course.final;
    const graded = drill ? set?.attempts.at(-1) : undefined;
    return (
      <div className="study-panel" key={view.kind}>
        <div className="study-bar-row">
          {back}
          {tracker}
        </div>
        <article className="study-lesson">
          <div className="study-kicker">{drill ? "Drill" : "Final mixed exam"}</div>
          <h2>{drill ? "Your weak spots" : "All checkpoints"}</h2>
          {!drill && (
            <p className="study-intro">
              Harder questions across every deck. Aim for{" "}
              {Math.ceil((set?.questions.length ?? 15) * FINAL_TARGET)}/
              {set?.questions.length ?? 15}.
            </p>
          )}
          {set && (
            <StudyQuiz
              key={`${view.kind}:${set.attempts.length}:${set.questions[0]?.question}`}
              title={drill ? "Drill" : "Final exam"}
              questions={set.questions}
              graded={graded}
              renderSlide={(q) => slideChip(course, q.source, q.slide)}
              onSubmit={(picks) => {
                update(course.id, (c) => {
                  const target = drill ? c.drill : c.final;
                  target?.attempts.push(grade(set.questions, picks));
                });
                if (!drill) setView({ kind: "results", id: course.id });
              }}
              footer={
                <button
                  type="button"
                  className="study-primary"
                  onClick={() => setView({ kind: "results", id: course.id })}
                >
                  Back to results
                </button>
              }
            />
          )}
        </article>
        {status}
      </div>
    );
  }

  if (view.kind === "results" && course.final?.attempts.length) {
    const final = course.final;
    const last = final.attempts.at(-1)!;
    const total = final.questions.length;
    const target = Math.ceil(total * FINAL_TARGET);
    const ready = readiness(course);
    const verdict =
      last.score >= target && !ready.some((r) => r.level === "Review")
        ? "Exam ready"
        : last.score / total >= 0.7
          ? "Almost there"
          : "More practice needed";
    const mistakes = final.questions
      .map((q, i) => ({ q, pick: last.picks[i] }))
      .filter(({ q, pick }) => pick !== q.correct);
    const sheet = revisionSheet(course);
    const allQuestions: StudyQuestion[] = [
      ...course.checkpoints.flatMap((c) => c.lesson?.questions ?? []),
      ...final.questions,
    ];
    return (
      <div className="study-panel" key="results">
        <div className="study-bar-row">
          {back}
          {tracker}
        </div>
        <div className="study-result" data-pass={last.score >= target}>
          <strong>
            {last.score}/{total}
          </strong>
          <span>
            {last.score >= target ? "Passed" : "Below target"} · target {target}/{total}
            {progress.asked ? ` · course total ${progress.right}/${progress.asked}` : ""}
          </span>
        </div>
        {mistakes.length > 0 && (
          <section className="study-section">
            <h3>{mistakes.length === 1 ? "Your one mistake" : `Your ${mistakes.length} mistakes`}</h3>
            {mistakes.map(({ q, pick }, i) => (
              <div className="study-mistake" key={i}>
                <div className="study-mistake-q">{q.question}</div>
                <div>
                  <span className="study-wrong">✕ You:</span> {q.options[pick] ?? "No answer"}
                </div>
                <div>
                  <span className="study-right">✓ Answer:</span> {q.options[q.correct]}
                </div>
                <p>{q.explanation}</p>
                {q.shortcut && (
                  <p className="study-shortcut">
                    <strong>Memory shortcut:</strong> {q.shortcut}
                  </p>
                )}
                {slideChip(course, q.source, q.slide)}
              </div>
            ))}
          </section>
        )}
        <section className="study-section">
          <h3>Readiness</h3>
          <ul className="study-readiness">
            {ready.map((r, i) => (
              <li key={i} data-level={r.level}>
                <span>{r.title}</span>
                <span>{r.asked ? r.level : "Not tested"}</span>
              </li>
            ))}
          </ul>
          <p className="study-verdict">Verdict: {verdict}</p>
        </section>
        <section className="study-section">
          <h3>Last-minute revision sheet</h3>
          {sheet.map((part, i) => (
            <div className="ask-table" key={i}>
              <table>
                <caption>{part.title}</caption>
                <thead>
                  <tr>
                    {part.columns.map((c, j) => (
                      <th key={j}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {part.rows.map((row, r) => (
                    <tr key={r}>
                      {row.map((cell, j) => (
                        <td key={j}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>
        <section className="study-section study-actions">
          <button
            type="button"
            className="study-primary"
            disabled={readonly}
            onClick={() =>
              onSaveSheet([
                { type: "h1", text: `${course.name}: revision sheet` },
                ...sheet.flatMap((part): AiBlock[] => [
                  { type: "h2", text: part.title },
                  { type: "table", text: "", columns: part.columns, rows: part.rows },
                  ...part.traps.map((t): AiBlock => ({ type: "bulleted", text: `Trap: ${t}` })),
                ]),
              ])
            }
          >
            <ShellIcon name="cardPlus" />
            Save revision sheet to canvas
          </button>
          <button
            type="button"
            disabled={readonly || !allQuestions.length}
            onClick={() =>
              onSaveQuestions(
                allQuestions.map(({ question, options, correct, explanation }) => ({
                  question,
                  options,
                  correct,
                  explanation,
                })),
              )
            }
          >
            Save {allQuestions.length} questions to Card Deck
          </button>
          <button
            type="button"
            disabled={readonly || !!busy || !weakAreas(course).length}
            onClick={() => {
              update(course.id, (c) => {
                delete c.drill;
              });
              setView({ kind: "drill", id: course.id });
            }}
          >
            Drill weak spots
          </button>
          <button type="button" onClick={() => setView({ kind: "final", id: course.id })}>
            Review exam
          </button>
        </section>
        {status}
      </div>
    );
  }

  // The tracker.
  const firstOpen = states.findIndex((s) => s === "current");
  return (
    <div className="study-panel" key="tracker">
      <button type="button" className="study-back" onClick={() => setView({ kind: "list" })}>
        <ShellIcon name="back" /> All courses
      </button>
      <div className="study-kicker">
        Study course · {course.sources.length}{" "}
        {course.sources.length === 1 ? "file" : "files"} ·{" "}
        {course.goal === "mcq" ? "MCQ test" : course.goal === "written" ? "Written exam" : "Understanding"}
      </div>
      <h2>{course.name}</h2>
      <div className="study-stats">
        <div>
          <span>Progress</span>
          <strong>
            {progress.done} / {progress.steps}
          </strong>
          <span className="study-bar" aria-hidden="true">
            <span style={{ width: `${(progress.done / progress.steps) * 100}%` }} />
          </span>
        </div>
        <div>
          <span>Accuracy</span>
          <strong>{progress.asked ? `${progress.right} / ${progress.asked}` : "—"}</strong>
          <span>
            {progress.asked ? `${Math.round((progress.right / progress.asked) * 100)}% so far` : "No answers yet"}
          </span>
        </div>
        <div>
          <span>Left</span>
          <strong>{progress.steps - progress.done}</strong>
          <span>{progress.steps - progress.done === 1 ? "step" : "steps"}</span>
        </div>
      </div>
      <ol className="study-checkpoints">
        {course.checkpoints.map((c, i) => {
          const state = states[i];
          const score = bestScore(c.attempts);
          const bestOf = c.attempts.find((attempt) => attempt.score === score);
          const range = c.slides
            .map((r) => `${shortPdfName(course.sources[r.source]?.name ?? "")} · ${slideRange(r.from, r.to)}`)
            .join(", ");
          return (
            <li key={i} data-state={state}>
              <span className="study-step-badge" aria-hidden="true">
                {state === "done" ? <ShellIcon name="check" /> : i + 1}
              </span>
              <span className="study-step-text">
                <span>{c.title}</span>
                <span className="study-muted">{range}</span>
              </span>
              {state === "done" ? (
                <button type="button" onClick={() => setView({ kind: "checkpoint", id: course.id, index: i })}>
                  {score}/{bestOf?.total ?? c.lesson?.questions.length ?? "?"}
                </button>
              ) : state === "locked" ? (
                <span className="study-muted" aria-label="Locked">
                  <ShellIcon name="lock" />
                </span>
              ) : (
                <button
                  type="button"
                  className="study-primary"
                  onClick={() => setView({ kind: "checkpoint", id: course.id, index: i })}
                >
                  {state === "current" ? "Continue" : "Start"}
                </button>
              )}
            </li>
          );
        })}
        {course.options.finalExam && (
          <li data-state={course.final?.attempts.length ? "done" : allCheckpointsDone(course) ? "current" : "locked"}>
            <span className="study-step-badge" aria-hidden="true">
              <ShellIcon name="star" />
            </span>
            <span className="study-step-text">
              <span>Final mixed exam</span>
              <span className="study-muted">All files · about 15 harder questions</span>
            </span>
            {course.final?.attempts.length ? (
              <button type="button" onClick={() => setView({ kind: "results", id: course.id })}>
                {course.final.attempts.at(-1)!.score}/{course.final.questions.length}
              </button>
            ) : allCheckpointsDone(course) ? (
              <button type="button" className="study-primary" onClick={() => setView({ kind: "final", id: course.id })}>
                Start
              </button>
            ) : (
              <span className="study-muted" aria-label="Locked">
                <ShellIcon name="lock" />
              </span>
            )}
          </li>
        )}
      </ol>
      <div className="study-footnote">
        <ShellIcon name="check" />
        <span>Saved in this notebook{course.spent ? ` · ≈ $${course.spent.toFixed(3)} so far` : ""}</span>
        <span className="study-spacer" />
        {states.includes("locked") && (
          <button
            type="button"
            onClick={() =>
              update(course.id, (c) => {
                const next = checkpointStates(c).indexOf("locked");
                if (next >= 0) c.unlocked = [...(c.unlocked ?? []), next];
              })
            }
          >
            Skip ahead
          </button>
        )}
        <DeleteCourse onDelete={() => {
          deleteCourse(spaceDoc, course.id);
          setView({ kind: "list" });
        }} />
      </div>
      {firstOpen >= 0 && status}
      {firstOpen < 0 && status}
    </div>
  );
}

function DeleteCourse({ onDelete }: { onDelete: () => void }) {
  const [asking, setAsking] = useState(false);
  return asking ? (
    <span className="study-confirm">
      Delete this course?
      <button type="button" onClick={onDelete}>
        Delete
      </button>
      <button type="button" onClick={() => setAsking(false)}>
        Keep
      </button>
    </span>
  ) : (
    <button type="button" onClick={() => setAsking(true)}>
      Delete course
    </button>
  );
}

/** A deck added to the canvas twice (an embed and a card) is listed once,
 * keeping the copy that was selected. */
function uniquePdfs(pdfs: Pdf[], picked: string[] = []) {
  const byName = new Map<string, Pdf>();
  for (const pdf of pdfs) {
    const seen = byName.get(pdf.name);
    if (!seen || (!picked.includes(seen.key) && picked.includes(pdf.key)))
      byName.set(pdf.name, pdf);
  }
  return [...byName.values()];
}

/** A row that is a switch, drawn like Settings (.knot-switch). */
function SwitchRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="study-switch-row"
      onClick={() => onChange(!checked)}
    >
      <span>{label}</span>
      <span className="knot-switch" aria-hidden="true">
        <span />
      </span>
    </button>
  );
}

/** New course: which files, what it's for, how fast (design Course 1). */
function StudySetup({
  notebookTitle,
  pdfs: allPdfs,
  picked,
  busy,
  readonly,
  status,
  onCancel,
  onCreate,
}: {
  notebookTitle: string;
  pdfs: Pdf[];
  picked?: string[];
  busy: boolean;
  readonly: boolean;
  status: React.ReactNode;
  onCancel: () => void;
  onCreate: (setup: {
    name: string;
    goal: StudyGoal;
    pace: StudyPace;
    options: { harder: boolean; finalExam: boolean };
    sources: Pdf[];
  }) => void;
}) {
  const pdfs = uniquePdfs(allPdfs, picked);
  const [keys, setKeys] = useState<string[]>(() => {
    const preferred = pdfs.filter((p) => picked?.includes(p.key)).map((p) => p.key);
    return (preferred.length ? preferred : pdfs.map((p) => p.key)).slice(
      0,
      MAX_COURSE_SOURCES,
    );
  });
  const chosen = pdfs.filter((p) => keys.includes(p.key));
  const [name, setName] = useState("");
  const [goal, setGoal] = useState<StudyGoal>("mcq");
  const [pace, setPace] = useState<StudyPace>("fast");
  const [finalExam, setFinalExam] = useState(true);
  const fallback =
    chosen.length === 1 ? shortPdfName(chosen[0].name) : notebookTitle || "Study course";
  const title = name.trim() || fallback;
  return (
    <form
      className="study-panel study-setup"
      onSubmit={(event) => {
        event.preventDefault();
        if (chosen.length && title)
          onCreate({
            name: title,
            goal,
            pace,
            // Questions always build up through the course.
            options: { harder: true, finalExam },
            // Plan in the decks' own order (11, 12, 13), not the list's.
            sources: [...chosen].sort((a, b) =>
              a.name.localeCompare(b.name, undefined, { numeric: true }),
            ),
          });
      }}
    >
      <h2>New study course</h2>
      <div className="study-name-field">
        <input
          className="study-name"
          aria-label="Course name"
          value={name}
          maxLength={80}
          placeholder={fallback}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <fieldset className="study-files">
        <legend>Files</legend>
        {pdfs.length ? (
          pdfs.map((pdf) => {
            const on = keys.includes(pdf.key);
            return (
              <label key={pdf.key}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!on && keys.length >= MAX_COURSE_SOURCES}
                  title={
                    !on && keys.length >= MAX_COURSE_SOURCES
                      ? `Up to ${MAX_COURSE_SOURCES} files per course`
                      : undefined
                  }
                  onChange={(e) =>
                    setKeys(
                      e.target.checked
                        ? [...keys, pdf.key]
                        : keys.filter((k) => k !== pdf.key),
                    )
                  }
                />
                <ShellIcon name="pdf" />
                <span>{shortPdfName(pdf.name)}</span>
              </label>
            );
          })
        ) : (
          <p className="study-muted">Add PDFs or slide decks to this notebook first.</p>
        )}
      </fieldset>
      <div className="study-rows">
        <label className="study-row">
          <span>Goal</span>
          <select value={goal} onChange={(e) => setGoal(e.target.value as StudyGoal)}>
            <option value="mcq">MCQ test</option>
            <option value="written">Written exam</option>
            <option value="understanding">Understanding</option>
          </select>
        </label>
        <label className="study-row">
          <span>Pace</span>
          <select value={pace} onChange={(e) => setPace(e.target.value as StudyPace)}>
            <option value="fast">Fast</option>
            <option value="balanced">Balanced</option>
            <option value="thorough">Thorough</option>
          </select>
        </label>
        <SwitchRow label="Final exam" checked={finalExam} onChange={setFinalExam} />
      </div>
      <div className="study-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className="study-primary"
          disabled={busy || readonly || !chosen.length || !title}
        >
          Create the plan
        </button>
      </div>
      {status}
    </form>
  );
}
