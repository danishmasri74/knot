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
  if (input.mode !== "ask") return "legacy";
  if (input.scope === "none") return "none";
  if (input.scope === "current") return "current";
  if (
    input.selected ||
    (input.active &&
      /\b(this note|this page|this card|this pdf)\b/i.test(input.prompt))
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
