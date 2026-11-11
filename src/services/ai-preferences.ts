export const WORKSPACE_SEARCH_CHANGED = "knot-workspace-search-changed";
const workspaceSearchKey = "knot.ai-workspace-search";
export function getWorkspaceSearchEnabled(): boolean {
  try {
    return localStorage.getItem(workspaceSearchKey) !== "false";
  } catch {
    return true;
  }
}
export function setWorkspaceSearchEnabled(enabled: boolean) {
  localStorage.setItem(workspaceSearchKey, String(enabled));
  window.dispatchEvent(new Event(WORKSPACE_SEARCH_CHANGED));
}
const key = "knot.ai-enabled";
export function getAiEnabled(): boolean {
  try {
    return localStorage.getItem(key) !== "false";
  } catch {
    return true;
  }
}
export function setAiEnabled(enabled: boolean) {
  localStorage.setItem(key, String(enabled));
}

export const AI_CONNECTOR_SHAPES = ["curve", "elbowed", "straight"] as const;
export type AiConnectorShape = (typeof AI_CONNECTOR_SHAPES)[number];
const connectorShapeKey = "knot.ai-connector-shape";
export function getAiConnectorShape(): AiConnectorShape {
  try {
    const saved = localStorage.getItem(connectorShapeKey);
    return AI_CONNECTOR_SHAPES.find((shape) => shape === saved) ?? "elbowed";
  } catch {
    return "elbowed";
  }
}
export function setAiConnectorShape(shape: AiConnectorShape) {
  localStorage.setItem(connectorShapeKey, shape);
}

export const AI_MODELS = [
  {
    id: "gpt-6-luna",
    name: "GPT-6 Luna",
    description: "Quick summaries, simple questions, and everyday note tasks.",
    tag: "Fast",
  },
  {
    id: "gpt-6.1-terra",
    name: "GPT-6.1 Terra",
    description: "Natural writing, polished drafts, and thoughtful revisions.",
    tag: "Writing",
  },
  {
    id: "gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    description: "Reason through complex notes and connect detailed ideas.",
    tag: "Reasoning",
  },
  {
    id: "gpt-6-astra",
    name: "GPT-6 Astra",
    description: "For your most demanding questions. Higher API cost.",
    tag: "Premium",
  },
  {
    id: "gpt-5.4-mini",
    name: "GPT-5.4 mini",
    description: "Fast, everyday help with writing and summaries.",
    tag: "Everyday",
  },
  {
    id: "gpt-5.4",
    name: "GPT-5.4",
    description: "Deeper reasoning for complex notes and thoughtful revisions.",
    tag: "Advanced",
  },
];
export const AI_MODELS_CHANGED = "knot-ai-models-changed";
const modelsKey = "knot.ai-models.v1";
export function normalizeAiModels(value: unknown): string[] {
  const selected = AI_MODELS.filter(
    (model) => Array.isArray(value) && value.includes(model.id),
  ).map((model) => model.id);
  return selected.length ? selected : AI_MODELS.map((model) => model.id);
}
export function getAiModels(): string[] {
  try {
    return normalizeAiModels(
      JSON.parse(localStorage.getItem(modelsKey) ?? "null"),
    );
  } catch {
    return normalizeAiModels(null);
  }
}
export function setAiModels(models: string[]) {
  localStorage.setItem(modelsKey, JSON.stringify(normalizeAiModels(models)));
  window.dispatchEvent(new Event(AI_MODELS_CHANGED));
}
export function visibleAiModels(
  available: string[],
  selected = getAiModels(),
): string[] {
  return available.filter((id) => selected.includes(id));
}

export function aiModelName(id: string): string {
  return AI_MODELS.find((model) => model.id === id)?.name ?? id;
}

const pickerKey = "knot.ai-model-choice";
export function initialAiModel(available: string[]) {
  const saved = localStorage.getItem(pickerKey);
  if (!available.length) return "";
  return saved && (saved === "auto" || available.includes(saved))
    ? saved
    : available[0];
}
export function saveAiModelChoice(choice: string) {
  localStorage.setItem(pickerKey, choice);
}
export function automaticAiModel(
  available: string[],
  mode: string,
  prompt: string,
  visual: boolean,
  contextLength: number,
) {
  const reasoning = ["gpt-6.1-sol", "gpt-5.4", "gpt-6-astra"];
  const writing = ["gpt-6.1-terra", "gpt-5.4"];
  const quick = ["gpt-6-luna", "gpt-5.4-mini"];
  const priorities =
    mode !== "ask"
      ? [...writing, ...reasoning, ...quick]
      : visual ||
          contextLength > 16000 ||
          /\b(analy[sz]e|compare|contrast|reason|explain why|trade-?offs?|debug|prove)\b/i.test(
            prompt,
          )
        ? [...reasoning, ...writing, ...quick]
        : [...quick, ...writing, ...reasoning];
  const chosen =
    priorities.find((id) => available.includes(id)) ?? available[0];
  if (!chosen) throw new Error("No enabled models are available.");
  return chosen;
}

export const AI_SUGGESTIONS_CHANGED = "knot-ai-suggestions-changed";
export function getAiSuggestionsEnabled(): boolean {
  try {
    return localStorage.getItem("knot.ai-suggestions") === "true";
  } catch {
    return false;
  }
}
export function setAiSuggestionsEnabled(enabled: boolean) {
  localStorage.setItem("knot.ai-suggestions", String(enabled));
  window.dispatchEvent(new Event(AI_SUGGESTIONS_CHANGED));
}
