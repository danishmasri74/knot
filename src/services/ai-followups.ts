import type { AiAbilities } from "./ai-preferences";

/**
 * Next steps offered under an Ask Knot answer. Each turns the whole answer
 * into something the user previews before applying; matches
 * FOLLOWUP_ACTIONS in ai.rs.
 */
export type FollowUpAction = "cards" | "mindmap" | "quiz" | "note" | "insert";
export type FollowUp = {
  action: FollowUpAction;
  label: string;
  /** Optional shaping instruction from the model; never adds facts. */
  focus?: string;
};

export const followUpIcons = {
  cards: "board",
  mindmap: "mindmap",
  quiz: "multipleChoice",
  note: "note",
  insert: "note",
} as const satisfies Record<FollowUpAction, string>;

const defaultLabels: Record<FollowUpAction, string> = {
  cards: "Make canvas cards",
  mindmap: "Make a mind map",
  quiz: "Quiz me on this",
  note: "Save as a new note",
  insert: "Add to this note",
};

/** Shortest answer worth offering next steps for. */
export const MIN_FOLLOWUP_ANSWER = 200;
/** Answer text sent when asking the model for next steps. */
export const MAX_FOLLOWUP_ANSWER = 12000;

/** Next steps possible for what is open and allowed in this chat. */
export function followUpActions(
  abilities: AiAbilities,
  target: { canvas: boolean; note: boolean; editable: boolean },
): FollowUpAction[] {
  if (!target.editable) return [];
  const actions: FollowUpAction[] = [];
  if (abilities.canvasCards && target.canvas) actions.push("cards", "mindmap");
  if (abilities.quizzes) actions.push("quiz");
  if (abilities.createNotes) actions.push("note");
  // On a canvas, cards replace inserting into the focused note.
  if (abilities.editNote && target.note && !target.canvas)
    actions.push("insert");
  return actions;
}

/**
 * Next steps picked from the answer's shape alone, with no AI request (AI
 * suggestions off, or that request failed). Most answers get none: only
 * lists, sections or testable facts qualify.
 */
export function ruleFollowUps(
  answer: string,
  available: FollowUpAction[],
): FollowUp[] {
  const text = answer.trim();
  if (text.length < MIN_FOLLOWUP_ANSWER) return [];
  const lines = text.split("\n");
  const headings = lines.filter((line) => /^#{1,6}\s+\S/.test(line)).length;
  const items = lines.filter((line) =>
    /^\s*(\d+[.)]|[-*•])\s+\S/.test(line),
  ).length;
  // Headings and numbered items both mark separable ideas.
  const ideas = items + headings;
  const facts = lines.filter(
    (line) =>
      /\*\*[^*]+\*\*\s*[:—–-]|\*\*[^*]+[:?]\*\*/.test(line) ||
      /\?\*{0,2}\s+\S/.test(line),
  ).length;
  const wanted: FollowUpAction[] = [];
  if (ideas >= 3) wanted.push("cards");
  if (headings >= 2 && items + headings >= 5) wanted.push("mindmap");
  if (facts >= 3 || ideas >= 4) wanted.push("quiz");
  // Saving is offered only for structured material, never plain chat.
  if (!wanted.length) return [];
  if (text.length >= 500) wanted.push("note");
  wanted.push("insert");
  return wanted
    .filter((action) => available.includes(action))
    .slice(0, 3)
    .map((action) => ({ action, label: defaultLabels[action] }));
}

/** The model's suggestions, kept only when they fit what is possible. */
export function parseFollowUps(
  text: string,
  available: FollowUpAction[],
): FollowUp[] {
  const value: unknown = JSON.parse(text);
  const items: unknown =
    value && typeof value === "object" && "items" in value
      ? value.items
      : value;
  if (!Array.isArray(items)) throw Error("Invalid follow-ups");
  const seen = new Set<FollowUpAction>();
  const result: FollowUp[] = [];
  for (const item of items as unknown[]) {
    if (!item || typeof item !== "object") continue;
    const { action, label, focus } = item as Record<string, unknown>;
    if (
      typeof action !== "string" ||
      !available.includes(action as FollowUpAction) ||
      seen.has(action as FollowUpAction) ||
      typeof label !== "string" ||
      !label.trim() ||
      label.length > 60 ||
      /https?:|www\./i.test(label)
    )
      continue;
    const shaped =
      typeof focus === "string" &&
      focus.trim() &&
      focus.length <= 200 &&
      !/https?:|www\./i.test(focus)
        ? focus.trim()
        : undefined;
    seen.add(action as FollowUpAction);
    result.push({
      action: action as FollowUpAction,
      label: label.trim(),
      ...(shaped && { focus: shaped }),
    });
    if (result.length === 3) break;
  }
  return result;
}

/** What a next step sends to the model; the answer is the only source. */
export function followUpMessage(followUp: FollowUp, answer: string): string {
  const instruction = {
    cards:
      "Turn the following answer into separate canvas cards, one per idea. Do not make a mind map.",
    mindmap:
      "Turn the following answer into a native mind map on the canvas, adding detail cards only where branches need explanation.",
    quiz: "Create a multiple-choice quiz from the following answer.",
    note: "Create a new note from the following answer.",
    insert: "Add the following answer to my note.",
  }[followUp.action];
  const focus = followUp.focus ? ` ${followUp.focus}` : "";
  return `${instruction}${focus} Keep its facts and do not add new ones.\n\n${answer}`;
}
