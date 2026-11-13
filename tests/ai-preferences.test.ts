import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  AI_MODELS,
  automaticAiModel,
  automaticAiTools,
  normalizeAiAbilities,
  aiModelName,
  normalizeAiModels,
  visibleAiModels,
} from "../src/services/ai-preferences";
describe("AI model preferences", () => {
  it("keeps settings and the native model allowlist aligned", () => {
    const source = readFileSync(
      new URL("../src-tauri/src/ai.rs", import.meta.url),
      "utf8",
    );
    const list = source.match(/const MODELS:[\s\S]*?= \[([\s\S]*?)\];/)![1];
    expect([...list.matchAll(/"([^"]+)"/g)].map((match) => match[1])).toEqual(
      AI_MODELS.map((model) => model.id),
    );
    expect(aiModelName("gpt-6.1-terra")).toBe("GPT-6.1 Terra");
  });
  it("preserves existing choices without silently enabling new models", () => {
    expect(normalizeAiModels(["gpt-5.4-mini"])).toEqual(["gpt-5.4-mini"]);
    expect(normalizeAiModels(["gpt-6.1-terra", "gpt-6-luna"])).toEqual([
      "gpt-6-luna",
      "gpt-6.1-terra",
    ]);
  });
  it("recovers invalid or empty saved preferences and removes unknown models", () => {
    expect(normalizeAiModels([])).toEqual(AI_MODELS.map((model) => model.id));
    expect(normalizeAiModels(null)).toHaveLength(6);
    expect(normalizeAiModels(["unknown", "gpt-5.4", "gpt-5.4"])).toEqual([
      "gpt-5.4",
    ]);
  });
  it("only shows enabled models the connected account can access", () => {
    expect(visibleAiModels(["gpt-5.4-mini", "gpt-5.4"], ["gpt-5.4"])).toEqual([
      "gpt-5.4",
    ]);
    expect(visibleAiModels(["gpt-5.4-mini"], ["gpt-5.4"])).toEqual([]);
  });
});

it("routes automatic requests only among enabled and available models", () => {
  const available = AI_MODELS.map((m) => m.id);
  expect(automaticAiModel(available, "ask", "Summarize this", false, 100)).toBe(
    "gpt-6-luna",
  );
  expect(automaticAiModel(available, "rewrite", "Rewrite", false, 100)).toBe(
    "gpt-6.1-terra",
  );
  expect(automaticAiModel(available, "ask", "Describe this", true, 100)).toBe(
    "gpt-6.1-sol",
  );
  expect(
    automaticAiModel(["gpt-5.4-mini"], "ask", "Compare these", true, 100),
  ).toBe("gpt-5.4-mini");
});

it("defaults abilities on and offers only possible, allowed tools", () => {
  expect(normalizeAiAbilities(null)).toEqual({
    editNote: true,
    canvasCards: true,
    searchWorkspace: true,
    searchWeb: true,
    viewImages: true,
    createNotes: false,
  });
  expect(normalizeAiAbilities({ editNote: false, junk: 1 })).toEqual({
    editNote: false,
    canvasCards: true,
    searchWorkspace: true,
    searchWeb: true,
    viewImages: true,
    createNotes: false,
  });
  const all = normalizeAiAbilities(null);
  const open = { selection: true, note: true, canvas: true, editable: true };
  expect(automaticAiTools(all, open)).toEqual([
    "rewrite_selection",
    "insert_blocks",
    "create_on_canvas",
  ]);
  expect(automaticAiTools(all, { ...open, editable: false })).toEqual([]);
  expect(automaticAiTools({ ...all, editNote: false }, open)).toEqual([
    "create_on_canvas",
  ]);
  expect(
    automaticAiTools(all, { ...open, selection: false, canvas: false }),
  ).toEqual(["insert_blocks"]);
  // Search needs Settings and the chat to allow it, and works read-only.
  expect(
    automaticAiTools(all, { ...open, editable: false, search: true }),
  ).toEqual(["search_workspace"]);
  expect(
    automaticAiTools(
      { ...all, searchWorkspace: false },
      { ...open, search: true },
    ),
  ).not.toContain("search_workspace");
  expect(automaticAiTools(all, { ...open, search: false })).not.toContain(
    "search_workspace",
  );
  // Web search needs Settings; images need images and the ability.
  expect(
    automaticAiTools(all, {
      ...open,
      editable: false,
      web: true,
      images: true,
    }),
  ).toEqual(["web_search", "view_images"]);
  expect(
    automaticAiTools(
      { ...all, searchWeb: false, viewImages: false },
      { ...open, editable: false, web: true, images: true },
    ),
  ).toEqual([]);
  expect(automaticAiTools(all, { ...open, editable: false })).toEqual([]);
  // New notes are off until turned on, and need an editable notebook.
  expect(automaticAiTools(all, { ...open, notebook: true })).not.toContain(
    "create_note",
  );
  expect(
    automaticAiTools(
      { ...all, createNotes: true },
      { ...open, notebook: true },
    ),
  ).toContain("create_note");
  expect(
    automaticAiTools(
      { ...all, createNotes: true },
      { ...open, notebook: true, editable: false },
    ),
  ).not.toContain("create_note");
});
