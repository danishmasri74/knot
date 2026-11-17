# Study course

Status: phases 1–3 implemented 17 November 2026 (Study tab, setup, plan, lessons, batch quizzes, final exam, results, drill). New course preselects decks selected on the canvas; the canvas toolbar button and Ask Knot chip (phase 4) are still to do. Design chosen: proposal A, a Study tab (canvas "Rich Ask Knot answers", artboards Course 1–4: https://claude.ai/artifact/Br2YK5afwPh9ggQr4DZatA). No application changes are made by this plan.

## Goal

Turn slide decks into the guided exam-prep course the user already studies with (their ChatGPT "MCQ Test Preparation" session): a plan of topic checkpoints shown as a progress tracker, a short lesson and scenario MCQs per checkpoint, grading after each batch, a harder mixed final exam, then readiness, memory shortcuts and a last-minute revision sheet. Knot adds what a chat can't: click answers, keep progress in the notebook, link every point to its slide, and save the sheet and questions as real notebook content.

## User flow

1. **Start.** With PDFs or slide decks selected on a canvas, the selection toolbar offers **Make a study course**. Also: a **Make a study course** next-step chip when Ask Knot sees a test-prep request with files, and **New course** in an empty Study tab (pick files attached to the notebook).
2. **Setup** (side panel): name, goal (MCQ test · written exam · understanding), pace (fast · balanced · thorough), and three ticks: harder as you go, final mixed exam, answers after each checkpoint. **Create the plan**.
3. **Study tab** opens on the tracker: progress, accuracy, checkpoints left, then each checkpoint (title, deck and slides) as done with its score, current with **Continue**, or locked. Saved with the notebook; **Skip ahead** unlocks out of order.
4. **Checkpoint**: lesson (slide source, one-line definitions each with an example, a Remember table, MCQ traps) → 3–6 scenario MCQs, clicked, no feedback until **Submit checkpoint** → score, right/wrong per question, a short why for mistakes only, tracker updates → **Next**. **Retry** asks new questions on the same lesson.
5. **Final exam**: ~15 harder mixed questions across all decks, same batch flow.
6. **Results**: score vs target, each mistake with the right answer, memory shortcut and slide, readiness per checkpoint area, verdict, revision sheet (tables). Actions: **Save revision sheet to canvas**, **Save questions to Card Deck**, **Drill weak spot** (5 new questions on missed concepts).

## Architecture

### Where it lives

- New pane kind `study` in `src/app/workspace-layout.ts`, per notebook like `pdf` (opened with the notebook's `documentId`), title "Study", icon a progress chart.
- New `src/app/StudyPanel.tsx` (tracker, checkpoint, results) and `src/app/StudySetup.tsx`. Questions reuse the inline quiz styles from `AnswerQuiz`, in a batch mode (answers hidden until submit).
- Slide chips reuse `PdfRef` previews (`src/app/PdfPreview.tsx`) and open the PDF reader at the page.

### Storage (no format change)

A notebook's courses live in its Yjs document, in a new map `knot:study-courses` (course id → JSON), like `knot:card-links`. So courses save with the notebook, undo separately from canvas edits (own transaction origin), and travel in backups and `.knotbook` files with no schema or format change. Older Knot ignores the map; nothing it reads changes, so no `minKnotVersion` bump.

```ts
type StudyCourse = {
  id: string; name: string; created: number;
  goal: "mcq" | "written" | "understanding";
  pace: "fast" | "balanced" | "thorough";
  options: { harder: boolean; finalExam: boolean; batchAnswers: boolean };
  sources: { key: string; name: string }[];            // attachment keys
  checkpoints: {
    title: string;
    slides: { source: number; from: number; to: number }[];
    lesson?: StudyLesson;                               // made when first opened
    attempts: { picks: number[]; score: number; at: number }[];
  }[];
  final?: { questions: StudyQuestion[]; attempts: { picks: number[]; score: number; at: number }[] };
};
type StudyLesson = {
  intro: string;
  points: { term: string; definition: string; example?: string; slide?: number }[];
  remember: { columns: string[]; rows: string[][] };
  traps: string[];
  questions: StudyQuestion[];
};
type StudyQuestion = AiQuestion & { area: number; shortcut?: string; slide?: number };
```

Grading is local: correct answers and explanations are stored with the questions and only shown after submit. No AI call to grade.

### AI requests (new modes in `ai.rs`, strict JSON schemas)

| Mode | Sends | Returns |
| --- | --- | --- |
| `course_plan` | all decks (`pdf_files`), setup | 4–8 checkpoints with titles and slide ranges, in slide order |
| `course_lesson` | only that checkpoint's slides | lesson + 3–6 scenario questions, harder for later checkpoints |
| `course_final` | all decks, plus each checkpoint's points | ~15 mixed questions tagged by area, each with a memory shortcut |
| `course_drill` | the missed questions' slides and concepts | 5 new questions |

- **Cost control:** lessons send only their slide range, cut from the deck on the device with `pdf-lib` (already a dependency), not the whole deck. The next lesson is made in the background while the current quiz is answered. Each request shows in the existing cost display.
- **Revision sheet without AI:** built from every checkpoint's Remember table and traps, plus the final exam's shortcuts for mistakes.
- **Readiness without AI:** accuracy per area (checkpoint attempts + final questions tagged with that area): 90%+ Excellent, 70–89% Good, under 70% Review.
- All modes ground in the slides only, reuse the quiz quality rules (unique options, one correct, plain text), and validate with `validQuizQuestions` plus slide-range checks.

### Entry points

- Selection toolbar: Knot's edgeless toolbar integration gains **Make a study course** when the selection holds 1–3 PDF attachments.
- Follow-ups: a `course` action in `ai-followups.ts` when the request had PDFs and the question mentions a test, exam or quiz.
- Study tab empty state: **New course** with the notebook's PDFs listed.

## Phases

| Phase | Ships | Done when |
| --- | --- | --- |
| 1 | Pane kind, storage map, setup panel, `course_plan`, tracker | A course is created from 3 decks, shows its plan, survives restart and `.knotbook` export |
| 2 | `course_lesson`, lesson view, batch quiz, grading, unlock, retry | Checkpoints play end to end with slide links; next lesson prefetches |
| 3 | `course_final`, results, revision sheet, save to canvas / Card Deck, drill | Final exam and results match the design; saves create real content with Undo |
| 4 | Toolbar button, follow-up chip, multiple courses per notebook, delete course | All three ways in work |

Each phase: unit tests (schema validation, grading, readiness, storage round trip, slide cutting), `pnpm checks`, a line in `UNRELEASED.md`, `pnpm update:running`.

## Risks

- **Plan quality** (wrong slide ranges, uneven checkpoints): ranges are validated against page counts; the tracker lets the user skip ahead or rename.
- **Cost of large decks:** slicing keeps lesson requests small; setup shows that each checkpoint makes one request.
- **Stale courses** when a deck is replaced: lessons keep their text; slide links say when the file is gone.
- **Answer key in the notebook:** acceptable for self-study; not a proctoring feature.

## Decisions for the user

1. Checkpoint size: let the AI choose 4–8 (proposed), or always about 6?
2. Retry: new questions on the same lesson (proposed), or the same questions again?
3. Build order: phases 1–3 together as one release (proposed), or ship phase 1–2 first to try checkpoints sooner?
