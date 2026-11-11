import { invoke } from "@tauri-apps/api/core";
import type { McqProgress } from "../features/quiz/mcq";

export const quizRepository = {
  loadProgress: (notebook: string) =>
    invoke<McqProgress[]>("load_mcq_progress", { notebook }),
  resetProgress: (notebook: string) =>
    invoke<void>("reset_mcq_progress", { notebook }),
  loadDraft: (id: string) => invoke<string | null>("load_mcq_draft", { id }),
  saveDraft: (id: string, content: string | null) =>
    invoke<void>("save_mcq_draft", { id, content }),
};
