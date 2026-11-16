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
  const mentioned =
    input.active &&
    /\b(this note|this page|this card|this pdf)\b/i.test(input.prompt);
  if (input.mode === "auto") {
    // Knot searches the workspace itself when it needs to, so an automatic
    // message reads what is open and decides from there.
    if (input.selected || mentioned) return "current";
    if (input.attached || input.inherited === "explicit") return "explicit";
    return input.active ? "current" : "none";
  }
  if (input.selected || mentioned) return "current";
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
/**
 * True when a message looks like it needs the web: recent or changing facts
 * ("latest", "today", "price", a recent year), news, a website or domain, or
 * an explicit request to search online. Web search is offered only then (or
 * right after an answer that searched the web), because merely offering it
 * adds about 4,450 input tokens to a request.
 */
export function webIntent(prompt: string): boolean {
  return (
    /\b(latest|newest|current(ly)?|today|tonight|yesterday|tomorrow|this (week|month|year)|right now|recent(ly)?|up[- ]to[- ]date|news|headlines?|price[sd]?|pricing|costs? of|exchange rate|stock|weather|forecast|scores?|released|announced|launched|search (the )?(web|online|internet)|look (it |this |that )?up|online|on the (web|internet)|internet|google|website|web ?site|url)\b/i.test(
      prompt,
    ) ||
    /\b20[2-9]\d\b/.test(prompt) ||
    /\b[\w-]+\.(com|org|net|io|dev|ai|gov|edu|co|app)\b/i.test(prompt)
  );
}
export function editIntent(prompt: string): boolean {
  return (
    /^\s*(please\s+|can you\s+|could you\s+)?(rewrite|rephrase|reword|shorten|lengthen|expand|condense|simplify|proofread|polish|improve|translate|fix|correct|edit|insert|add|append|draft|write|turn|convert|make|create|put|restructure|reorgani[sz]e)\b/i.test(
      prompt,
    ) ||
    /\b(mind ?map|on (the|this) canvas|as cards|into cards|(to|into) (the|my|this) note|quiz(zes)?|mcqs?|multiple[- ]choice|practice questions)\b/i.test(
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
 * The chat's last few exchanges, so a follow-up ("what are its drawbacks?",
 * "make it shorter") can refer back. Only the user's own messages are
 * replayed; each reply is a short note of what Knot did, never its answer,
 * proposal or sources.
 */
export function exchangeHistory<
  T extends {
    role: string;
    content: string;
    failed?: boolean;
    proposal?: unknown;
    mode?: string;
    status?: string;
  },
>(turns: T[], limit = 3): { role: string; content: string }[] {
  const history: { role: string; content: string }[] = [];
  for (let i = turns.length - 1; i > 0 && history.length < limit * 2; i--) {
    const reply = turns[i];
    const user = turns[i - 1];
    if (reply.role !== "assistant" || user.role !== "user" || reply.failed)
      continue;
    const what =
      reply.mode === "rewrite"
        ? "a rewrite of the selected text"
        : reply.mode === "canvas"
          ? "content for the canvas"
          : reply.mode === "quiz"
            ? "multiple-choice questions for the note"
            : reply.mode === "arrange"
              ? "a new arrangement of canvas cards"
              : reply.mode === "connect"
                ? "new arrows between canvas cards"
              : "an addition to the note";
    const outcome =
      reply.status === "applied"
        ? "The user applied it."
        : reply.status === "dismissed"
          ? "The user dismissed it."
          : "The user has not applied it yet.";
    history.unshift(
      { role: "user", content: user.content },
      {
        role: "assistant",
        content: reply.proposal
          ? `(Proposed ${what}. ${outcome})`
          : "(Answered in chat; the answer is not repeated here.)",
      },
    );
    i--;
  }
  return history;
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
