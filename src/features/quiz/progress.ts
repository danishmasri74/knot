import { quizRepository } from "../../services/mcq";
import type { McqContext } from "../editor/blocksuite/mcq-block";
import type { McqDefinition, McqMutation, McqProgress } from "./mcq";

export class NotebookQuizProgress extends EventTarget implements McqContext {
  ready = false;
  exporting = false;
  private pending = new Map<string, McqMutation>();
  error = "";
  progress = new Map<string, McqProgress>();
  busy = new Set<string>();
  private loading?: Promise<void>;

  constructor(
    private notebookId: string,
    private save: (mutation: McqMutation) => Promise<void>,
    private flush: () => Promise<void>,
  ) {
    super();
  }

  load() {
    if (this.ready) return Promise.resolve();
    return (this.loading ??= this.fetch());
  }

  private async fetch() {
    try {
      const rows = await quizRepository.loadProgress(this.notebookId);
      this.progress = new Map(rows.map((row) => [row.cardId, row]));
      this.error = "";
      this.ready = true;
    } catch (error) {
      this.error = String(error);
    } finally {
      this.loading = undefined;
      this.changed();
    }
  }

  private changed() {
    this.dispatchEvent(new Event("change"));
  }

  async answer(
    cardId: string,
    quiz: McqDefinition,
    optionId: string | null,
    submit: boolean,
  ) {
    if (!this.ready || this.busy.has(cardId)) return;
    const current = this.progress.get(cardId);
    if (
      current?.revision === quiz.gradingRevision &&
      current.correct !== null &&
      optionId !== null
    )
      return;
    this.busy.add(cardId);
    const previous = this.pending.get(cardId);
    const mutation =
      previous?.revision === quiz.gradingRevision
        ? previous
        : {
            cardId,
            notebookId: this.notebookId,
            revision: quiz.gradingRevision,
            optionId,
            attemptId: submit ? crypto.randomUUID() : null,
          };
    this.pending.set(cardId, mutation);
    // Keep the radio selected while the write runs. Only reveal a grade after
    // the submitted attempt has been acknowledged.
    if (!mutation.attemptId && mutation.optionId !== null) {
      this.progress.set(cardId, {
        cardId,
        revision: mutation.revision,
        optionId: mutation.optionId,
        correct: null,
      });
    }
    this.changed();
    try {
      await this.save(mutation);
      this.pending.delete(cardId);
      this.progress.set(cardId, {
        cardId,
        revision: mutation.revision,
        optionId: mutation.optionId,
        correct: mutation.attemptId
          ? mutation.optionId === quiz.correctOptionId
          : null,
      });
    } finally {
      this.busy.delete(cardId);
      this.changed();
    }
  }

  setExporting(exporting: boolean) {
    this.exporting = exporting;
    this.changed();
  }

  async reset() {
    await this.flush();
    await quizRepository.resetProgress(this.notebookId);
    this.pending.clear();
    this.progress.clear();
    this.changed();
  }
}
