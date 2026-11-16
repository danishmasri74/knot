import type { ContextBlock } from "./ai";
import { composeAiContext } from "../../../services/ai-context-composer";

export const cardActions = {
  // The key stays "improve" so dismissals saved by older Knot still apply.
  improve: {
    label: "Break this into ideas?",
    prompt:
      "Break this card into atomic idea cards that replace it, so it is easier to digest and the connections between ideas are visible. Use cards and connections only; leave mindmap empty. Each card holds exactly one idea and makes sense on its own: a short title that states the point as a claim (for example \"Early testing is cheaper\", not \"Early testing\"), then at most about 60 words of formatted detail, with lists or a table only when they help. Keep every fact, number, example, exception and qualification from the source in some card, because the original card is removed; never add facts the source does not state. Prefer 5 to 12 cards, at most 20. Connect related cards with directional arrows labelled with exactly one of: leads to, causes, requires, part of, example of, contrasts with. The arrow points from the card the label describes, for example A requires B, A is an example of B, A is part of B. Only connect ideas the source relates; do not invent relationships.",
  },
} as const;

export type CardAction = keyof typeof cardActions;

// Send each passage once so long cards can use the same request budget as Ask Knot.
export function cardRequestContext(
  document: string,
  structure: ContextBlock[],
) {
  return composeAiContext(
    JSON.stringify({
      document,
      scope: "Focused note",
      mode: "canvas",
      citationSources: structure.map((block, index) => ({
        ...block,
        document,
        citation: `[S${index + 1}]`,
      })),
    }),
  );
}

export function qualifiedActions(
  blocks: ContextBlock[],
  document: string,
): CardAction[] {
  const content = blocks.filter((b) => b.text.trim());
  const text = content.map((b) => b.text.trim()).join("\n");
  if (text.length < 1000) return [];
  const sections = new Set(
    content.filter((b) => /^h[1-6]$/.test(b.type)).map((b) => b.text.trim()),
  );
  const points = new Set(
    content
      .filter((b) => /^(bulleted|numbered)$/.test(b.type))
      .map((b) => b.text.trim()),
  );
  const passages = new Set(
    text
      .split(/(?:\n+|(?<=[.!?。！？])\s+)/u)
      .map((t) => t.trim())
      .filter((t) => t.length >= 40),
  );
  const actions: CardAction[] = [];
  if (
    passages.size >= 4 ||
    (passages.size >= 3 &&
      (sections.size >= 3 || (sections.size >= 1 && points.size >= 4)))
  )
    actions.push("improve");
  if (actions.length) {
    try {
      if (
        new TextEncoder().encode(cardRequestContext(document, blocks)).length >
        180000
      )
        return [];
    } catch {
      return [];
    }
  }
  return actions;
}
