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
/**
 * Settings → AI → Read text in images (docs/WORKSPACE-OCR-PLAN.md). On by
 * default: Windows OCR runs on this device, paced, for new images only until
 * the backlog is started. Pause lasts for this session.
 */
export const OCR_CHANGED = "knot-ocr-changed";
const ocrKey = "knot.ai-ocr";
const ocrBatteryKey = "knot.ai-ocr-battery";
let ocrPaused = false;
export type OcrPreferences = {
  enabled: boolean;
  battery: boolean;
  paused: boolean;
};
export function getOcrPreferences(): OcrPreferences {
  let enabled = true,
    battery = false;
  try {
    enabled = localStorage.getItem(ocrKey) !== "false";
    battery = localStorage.getItem(ocrBatteryKey) === "true";
  } catch {
    /* defaults */
  }
  return { enabled, battery, paused: ocrPaused };
}
export function setOcrPreferences(next: Partial<OcrPreferences>) {
  if (next.enabled !== undefined)
    localStorage.setItem(ocrKey, String(next.enabled));
  if (next.battery !== undefined)
    localStorage.setItem(ocrBatteryKey, String(next.battery));
  if (next.paused !== undefined) ocrPaused = next.paused;
  window.dispatchEvent(new Event(OCR_CHANGED));
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

/**
 * What Ask Knot may propose without being asked for a specific action.
 * Settings holds the defaults; a chat can override them. Every proposal is
 * still previewed before it changes anything.
 */
export type AiAbilities = {
  editNote: boolean;
  canvasCards: boolean;
  /** Per chat only: Settings → AI → Search my workspace is the default. */
  searchWorkspace: boolean;
  /** Per chat only: Settings → AI → Search the web must also be on. */
  searchWeb: boolean;
  /** Look at images in the open note or canvas when a question needs them. */
  viewImages: boolean;
  /** Propose a whole new note in the open notebook. Off unless turned on. */
  createNotes: boolean;
};
export const AI_ABILITIES_CHANGED = "knot-ai-abilities-changed";
const abilitiesKey = "knot.ai-abilities.v1";
export function normalizeAiAbilities(value: unknown): AiAbilities {
  const saved = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  return {
    editNote: saved.editNote !== false,
    canvasCards: saved.canvasCards !== false,
    searchWorkspace: saved.searchWorkspace !== false,
    searchWeb: saved.searchWeb !== false,
    viewImages: saved.viewImages !== false,
    createNotes: saved.createNotes === true,
  };
}
export function getAiAbilities(): AiAbilities {
  try {
    return normalizeAiAbilities(
      JSON.parse(localStorage.getItem(abilitiesKey) ?? "null"),
    );
  } catch {
    return normalizeAiAbilities(null);
  }
}
export function setAiAbilities(abilities: AiAbilities) {
  localStorage.setItem(
    abilitiesKey,
    JSON.stringify(normalizeAiAbilities(abilities)),
  );
  window.dispatchEvent(new Event(AI_ABILITIES_CHANGED));
}

/** Write tools an automatic request can offer, and the edit each proposes. */
export const AI_TOOL_MODES = {
  rewrite_selection: "rewrite",
  insert_blocks: "insert",
  create_on_canvas: "canvas",
  create_note: "note",
} as const;
/** Searches the workspace on this device; results go back to the model. */
export type AiTool =
  | keyof typeof AI_TOOL_MODES
  | "search_workspace"
  | "web_search"
  | "view_images";
/** Searches one message may run; matches MAX_SEARCHES in ai.rs. */
export const MAX_SEARCHES = 2;
/**
 * Tools to offer for one request: allowed by the abilities and possible for
 * what is open. A tool that is not offered cannot be called.
 */
export function automaticAiTools(
  abilities: AiAbilities,
  target: {
    selection: boolean;
    note: boolean;
    canvas: boolean;
    editable: boolean;
    /** Workspace search is on in Settings. */
    search?: boolean;
    /** Web search is on in Settings and nothing rules it out. */
    web?: boolean;
    /** The open note or canvas has images. */
    images?: boolean;
    /** A notebook is open that a new note can be added to. */
    notebook?: boolean;
  },
): AiTool[] {
  const tools: AiTool[] = [];
  if (abilities.searchWorkspace && target.search)
    tools.push("search_workspace");
  if (abilities.searchWeb && target.web) tools.push("web_search");
  if (abilities.viewImages && target.images) tools.push("view_images");
  if (!target.editable) return tools;
  if (abilities.editNote && target.selection) tools.push("rewrite_selection");
  if (abilities.editNote && target.note) tools.push("insert_blocks");
  if (abilities.canvasCards && target.canvas) tools.push("create_on_canvas");
  if (abilities.createNotes && target.notebook) tools.push("create_note");
  return tools;
}

/** Images view_images may send at once; matches MAX_IMAGES in ai.rs. */
export const MAX_IMAGES = 3;

/**
 * Settings → AI → Search the web. Off by default: searches go through
 * OpenAI and each one is charged.
 */
export const WEB_SEARCH_CHANGED = "knot-web-search-changed";
const webSearchKey = "knot.ai-web-search";
export function getWebSearchEnabled(): boolean {
  try {
    return localStorage.getItem(webSearchKey) === "true";
  } catch {
    return false;
  }
}
export function setWebSearchEnabled(enabled: boolean) {
  localStorage.setItem(webSearchKey, String(enabled));
  window.dispatchEvent(new Event(WEB_SEARCH_CHANGED));
}
