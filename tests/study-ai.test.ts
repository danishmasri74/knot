import { expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string) =>
    command === "ai_connected" ? true : command === "ai_models" ? ["gpt-6.1-terra"] : undefined,
  ),
  Channel: class {
    onmessage?: unknown;
  },
}));
vi.mock("../src/services/pdf-input", () => ({
  slicePdf: vi.fn(async () => {
    throw new Error("Blob not found: abc123");
  }),
  preparePdfInput: vi.fn(),
  pdfPageCount: vi.fn(),
  MAX_PDF_FILES_BYTES: 30_000_000,
}));

it("names a deck that was removed from the notebook", async () => {
  const { makeLesson } = await import("../src/services/study-ai");
  await expect(
    makeLesson(
      {
        id: "c",
        name: "Course",
        created: 1,
        goal: "mcq",
        pace: "fast",
        options: { harder: true, finalExam: true },
        sources: [{ key: "k", name: "12-Test Levels.pptx", pages: 5 }],
        checkpoints: [{ title: "Levels", slides: [{ source: 0, from: 2, to: 3 }], attempts: [] }],
      },
      0,
      () => {},
    ),
  ).rejects.toThrow("“12-Test Levels.pptx” is no longer in this notebook");
});
