import type { ContextBlock } from "./ai";
import { composeAiContext } from "../../../services/ai-context-composer";

export const cardActions = {
  improve: {
    label: "Shall we make this clearer?",
    prompt:
      "Reorganize this content to make it clearer. First assess its structure and choose the presentation automatically: use a native mind map for a branching topic outline, categories, types, components or levels; use a mind map alone when concise branch labels preserve the important information; combine a mind map overview with detail cards when the branches need explanations, examples, exceptions or tables. Use cards alone for sequences, comparisons, causal relationships or prose without a useful branching hierarchy. The source being a card is not a reason to return only cards. Preserve important facts and qualifications. In a mixed result, repeat short topic names as needed to associate details with branches, but avoid repeating whole explanations. Use headings, bold, italic, lists, tables, checklists or kanban where appropriate in detail cards. Connect related cards with labeled directional arrows that explain relationships, sequence or dependencies supported by the source. Do not invent hierarchy, relationships or task statuses. Use the format that actually clarifies this content without waiting for an explicit mind map request.",
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
