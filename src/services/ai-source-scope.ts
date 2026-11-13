export type SourceMode =
  "workspace" | "current" | "explicit" | "none" | "legacy";
export function resolveSourceMode(input: {
  scope: "auto" | "workspace" | "current" | "none";
  mode: string;
  prompt: string;
  automatic: boolean;
  selected: boolean;
  attached: boolean;
  active: boolean;
  inherited?: SourceMode;
}): SourceMode {
  if (input.mode !== "ask" && input.mode !== "auto") return "legacy";
  if (input.scope === "none") return "none";
  if (input.scope === "current") return "current";
  if (
    input.selected ||
    (input.active &&
      (/\b(this note|this page|this card|this pdf)\b/i.test(input.prompt) ||
        (input.mode === "auto" && editIntent(input.prompt))))
  )
    return "current";
  if (input.attached) return "explicit";
  if (input.scope === "workspace")
    return input.automatic ? "workspace" : "legacy";
  if (!input.automatic) return "legacy";
  return input.inherited === "legacy"
    ? "workspace"
    : (input.inherited ?? "workspace");
}
/**
 * True when a message asks to change or add to what is open, such as
 * "Shorten this" or "Turn it into a mind map". Such requests use the open
 * note or canvas (where the edit tools apply) instead of workspace search.
 * Questions like "What did I write about X?" are not edits.
 */
export function editIntent(prompt: string): boolean {
  return (
    /^\s*(please\s+|can you\s+|could you\s+)?(rewrite|rephrase|reword|shorten|lengthen|expand|condense|simplify|proofread|polish|improve|translate|fix|correct|edit|insert|add|append|draft|write|turn|convert|make|create|put|restructure|reorgani[sz]e)\b/i.test(
      prompt,
    ) ||
    /\b(mind ?map|on (the|this) canvas|as cards|into cards|(to|into) (the|my|this) note)\b/i.test(
      prompt,
    )
  );
}
export function usesNoteSources(
  scope: "auto" | "workspace" | "current" | "none",
  mode: string,
  prompt: string,
  selected: boolean,
  attached: boolean,
): boolean {
  if (mode === "rewrite") return true;
  if (scope !== "auto") return scope === "current";
  if (mode !== "canvas" || selected || attached) return true;
  return /\b(this|these|those|above|attached|selected|canvas|notes?|sources?|summari[sz]e|takeaways)\b/i.test(
    prompt,
  );
}

/**
 * After a proposal, a short note of what was proposed and what the user did
 * with it, so "make it shorter" can refine it. Only the user's own message is
 * replayed; the proposal content and any sources never are.
 */
export function proposalHistory<
  T extends {
    role: string;
    content: string;
    failed?: boolean;
    proposal?: unknown;
    mode?: string;
    status?: string;
  },
>(turns: T[]): { role: string; content: string }[] {
  const last = turns.at(-1);
  const user = turns.at(-2);
  if (last?.role !== "assistant" || !last.proposal || last.failed) return [];
  if (user?.role !== "user") return [];
  const what =
    last.mode === "rewrite"
      ? "a rewrite of the selected text"
      : last.mode === "canvas"
        ? "content for the canvas"
        : "an addition to the note";
  const outcome =
    last.status === "applied"
      ? "The user applied it."
      : last.status === "dismissed"
        ? "The user dismissed it."
        : "The user has not applied it yet.";
  return [
    { role: "user", content: user.content },
    { role: "assistant", content: `(Proposed ${what}. ${outcome})` },
  ];
}

/** Source-less and newly scoped requests never replay legacy source-bearing transcript text. */
export function outgoingSourceHistory<
  T extends {
    role: string;
    content: string;
    failed?: boolean;
    proposal?: unknown;
    request?: { sourceMode?: SourceMode };
  },
>(turns: T[], mode: SourceMode): { role: string; content: string }[] {
  if (mode !== "legacy") return [];
  return turns
    .filter(
      (turn) => !turn.failed && !turn.proposal && !turn.request?.sourceMode,
    )
    .map((turn) => ({ role: turn.role, content: turn.content }));
}
