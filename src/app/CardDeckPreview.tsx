import { memo, type ReactNode } from "react";
import { CardThumbnail } from "./CardThumbnail";
import { cardMcq, isMcqCard, mediaText, mcqReferenceFlavour, nodeMcq, unavailableMcq, type CardNode, type DeckCard, type DeckData } from "../features/editor/blocksuite/card-deck";

function property(node: CardNode, key: string) {
  const value = node.props[key];
  return value?.type === "json" ? value.value : undefined;
}

type Run = { insert?: unknown; attributes?: Record<string, unknown> };

function formattedRun(
  text: string,
  marks: Record<string, unknown>,
  key: number,
) {
  let content: ReactNode = text;
  if (marks.bold) content = <strong>{content}</strong>;
  if (marks.italic) content = <em>{content}</em>;
  if (marks.code) content = <code>{content}</code>;
  if (marks.strike) content = <s>{content}</s>;
  if (marks.underline || marks.link) content = <u>{content}</u>;
  return (
    <span
      key={key}
      style={{
        color:
          typeof marks.color === "string"
            ? marks.color
            : marks.link
              ? "var(--shell-accent)"
              : undefined,
        backgroundColor:
          typeof marks.background === "string" ? marks.background : undefined,
      }}
    >
      {content}
    </span>
  );
}

export const CardDeckPreview = memo(function CardDeckPreview({
  card,
  expanded = false,
  deck,
}: {
  card: DeckCard;
  deck?: DeckData;
  deckVersion?: number;
  expanded?: boolean;
}) {
  const media = mediaText(card);
  if (media)
    return (
      <div className="card-deck-preview media-deck-preview">
        <CardThumbnail card={card} />
        <strong>{media.title}</strong>
        <small>{media.detail}</small>
      </div>
    );
  if (isMcqCard(card)) {
    const quiz = cardMcq(card);
    return <div className="card-deck-preview mcq-deck-preview">
      <small>Multiple choice</small>
      <strong>{quiz?.question ?? "Question unavailable"}</strong>
      {quiz && <small>{quiz.options.length} options</small>}
    </div>;
  }
  const blocks: ReactNode[] = [];
  let remaining = expanded ? 100000 : 600;
  function visit(nodes: CardNode[], depth: number) {
    let ordinal = 0;
    for (const node of nodes) {
      if (!remaining || blocks.length >= (expanded ? 2000 : 12)) break;
      const type = property(node, "prop:type");
      const flavour = property(node, "sys:flavour");
      const value = node.props["prop:text"];
      ordinal =
        flavour === "affine:list" && type === "numbered" ? ordinal + 1 : 0;
      if (flavour === mcqReferenceFlavour) {
        const quiz = nodeMcq(node, deck);
        const text = (quiz?.question ?? unavailableMcq).slice(0, remaining);
        remaining -= text.length;
        blocks.push(<strong key={blocks.length}>{text}</strong>);
      } else if (value?.type === "text") {
        const runs: ReactNode[] = [];
        for (const run of value.delta as Run[]) {
          if (!remaining) break;
          if (typeof run.insert !== "string" || !run.insert) continue;
          const text = run.insert.slice(0, remaining);
          remaining -= text.length;
          runs.push(formattedRun(text, run.attributes ?? {}, runs.length));
        }
        const marker =
          flavour !== "affine:list"
            ? ""
            : ordinal
              ? ordinal + ". "
              : type === "todo"
                ? property(node, "prop:checked")
                  ? "☑ "
                  : "☐ "
                : "• ";
        blocks.push(
          <div
            key={blocks.length}
            data-kind={flavour === "affine:code" ? "code" : String(type ?? "")}
            style={{ marginInlineStart: Math.min(depth, 3) * 8 }}
          >
            {marker}
            {runs.length ? runs : <br />}
          </div>,
        );
      } else if (flavour === "affine:divider")
        blocks.push(<hr key={blocks.length} />);
      visit(node.children, depth + 1);
    }
  }
  visit(card.nodes, 0);
  return (
    <div className="card-deck-preview">
      {blocks.length ? blocks : "Empty card"}
    </div>
  );
});
