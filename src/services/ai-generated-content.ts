import type { AiProposal } from "../features/editor/blocksuite/ai";
import type { AiBlock } from "../features/editor/blocksuite/ai-content";

/** Request-local citation IDs have no meaning in an editable document. */
export function stripAiSourceMarkers(text: string): string {
  return text.replace(
    /[ \t]*(?:\[S\d+\](?!\()[ \t]*)+/gi,
    (match, offset: number) => {
      const after = text[offset + match.length];
      return after &&
        !/[\s.,;:!?)]/.test(after) &&
        offset > 0 &&
        !/\s/.test(text[offset - 1])
        ? " "
        : "";
    },
  );
}

export function cleanAiBlock(block: AiBlock): AiBlock {
  return {
    ...block,
    text: stripAiSourceMarkers(block.text),
    ...(block.columns && { columns: block.columns.map(stripAiSourceMarkers) }),
    ...(block.rows && {
      rows: block.rows.map((row) => row.map(stripAiSourceMarkers)),
    }),
    ...(block.children && { children: block.children.map(cleanAiBlock) }),
  };
}

export function cleanAiProposal(proposal: AiProposal): AiProposal {
  return {
    ...proposal,
    // Rewrite runs can contain existing literal text and protected links.
    blocks: proposal.blocks.map(cleanAiBlock),
    ...(proposal.connections && {
      connections: proposal.connections.map((edge) => ({
        ...edge,
        label: stripAiSourceMarkers(edge.label),
      })),
    }),
    ...(proposal.mindmap && {
      mindmap: proposal.mindmap.map((node) => ({
        ...node,
        text: stripAiSourceMarkers(node.text),
      })),
    }),
    ...(proposal.arrows && {
      arrows: proposal.arrows.map((arrow) => ({
        ...arrow,
        label: stripAiSourceMarkers(arrow.label),
        reason: stripAiSourceMarkers(arrow.reason).trim(),
      })),
    }),
    ...(proposal.links && {
      links: proposal.links.map((link) => ({
        ...link,
        label: stripAiSourceMarkers(link.label),
      })),
    }),
    ...(proposal.questions && {
      questions: proposal.questions.map((q) => ({
        ...q,
        question: stripAiSourceMarkers(q.question).trim(),
        options: q.options.map((option) =>
          stripAiSourceMarkers(option).trim(),
        ),
        explanation: stripAiSourceMarkers(q.explanation).trim(),
      })),
    }),
  };
}
