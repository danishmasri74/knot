import { HtmlAdapter, MixTextAdapter } from "@blocksuite/blocks";
import type {
  BlockSnapshot,
  DocCollection,
  JobMiddleware,
  FromSliceSnapshotPayload,
} from "@blocksuite/store";
import { parsePdfSourceUrl, pdfSourceLabel } from "./pdf-highlights";
import { cardEmbedFlavour, cardPreview, mcqReferenceFlavour, resolveDeckMcq, unavailableMcq, type CardDeck } from "./card-deck";
import { mcqText, readMcq } from "../../quiz/mcq";
import { readDurableWebSource } from "../../../services/web-ai-evidence";

// Markdown exports use standard quote and source paragraphs without mutating
// the stored block. Internal clipboard snapshots keep the custom block intact.
export const exportDecks = new WeakMap<DocCollection, CardDeck>();

export const guardMcqClipboard: JobMiddleware = ({ collection, slots }) => {
  slots.beforeImport.on((payload) => {
    if (payload.type !== "slice" || payload.snapshot.workspaceId === collection.id) return;
    const check = (block: BlockSnapshot) => {
      // Card IDs mean nothing in another workspace.
      if (block.flavour === mcqReferenceFlavour || block.flavour === cardEmbedFlavour)
        block.props = { ...block.props, cardId: "" };
      block.children.forEach(check);
    };
    payload.snapshot.content.forEach(check);
  });
};

export function exportCitedExcerpts(block: BlockSnapshot, deck?: CardDeck) {
  block.children = block.children.flatMap((child) => {
    exportCitedExcerpts(child, deck);
    if (child.flavour === "knot:mcq" || child.flavour === mcqReferenceFlavour) {
      const quiz = child.flavour === "knot:mcq"
        ? readMcq(child.props.definition)
        : deck
          ? resolveDeckMcq(deck.data, child.props.cardId)
          : undefined;
      return (quiz ? mcqText(quiz).split("\n") : [unavailableMcq]).map((line, index) => ({
        ...child,
        id: child.id + "-" + index,
        flavour: "affine:paragraph",
        version: 1,
        props: { type: "text", text: { "$blocksuite:internal:text$": true, delta: [{ insert: line }] } },
      }));
    }
    if (child.flavour === cardEmbedFlavour) {
      // The card's text, as plain paragraphs.
      const card = deck?.data[String(child.props.cardId)];
      const lines =
        card && !card.deleted
          ? cardPreview(card, "Empty card", deck?.data).split(/\r?\n/)
          : ["Card unavailable"];
      return lines.map((line, index) => ({
        ...child,
        id: child.id + "-" + index,
        flavour: "affine:paragraph",
        version: 1,
        children: [],
        props: { type: "text", text: { "$blocksuite:internal:text$": true, delta: [{ insert: line }] } },
      }));
    }
    if (child.flavour === "knot:web-source") {
      const source = readDurableWebSource(String(child.props.evidence));
      return [
        {
          ...child,
          flavour: "affine:paragraph",
          version: 1,
          props: { text: child.props.text, type: "quote" },
        },
        ...(source
          ? [
              {
                type: "block" as const,
                id: child.id + "-source",
                flavour: "affine:paragraph",
                version: 1,
                children: [],
                props: {
                  type: "text",
                  text: {
                    "$blocksuite:internal:text$": true,
                    delta: [
                      {
                        insert: `${source.title} · Captured ${source.fetchedAt}${source.warnings.length ? " · " + source.warnings.join("; ") : ""}`,
                        attributes: { link: source.finalUrl },
                      },
                    ],
                  },
                },
              },
            ]
          : []),
      ];
    }
    if (child.flavour !== "knot:cited-excerpt") return [child];
    const location = parsePdfSourceUrl(String(child.props.source));
    return [
      {
        ...child,
        flavour: "affine:paragraph",
        version: 1,
        props: { text: child.props.text, type: "quote" },
      },
      {
        type: "block" as const,
        id: child.id + "-source",
        flavour: "affine:paragraph",
        version: 1,
        children: [],
        props: {
          type: "text",
          text: {
            "$blocksuite:internal:text$": true,
            delta: [
              {
                insert: location ? pdfSourceLabel(location) : "PDF source",
                attributes: { link: child.props.source },
              },
            ],
          },
        },
      },
    ];
  });
}

function exportSlice(payload: FromSliceSnapshotPayload, deck?: CardDeck) {
  const snapshot = structuredClone(payload.snapshot);
  const root: BlockSnapshot = {
    type: "block",
    id: "excerpt-export",
    flavour: "affine:note",
    props: {},
    children: snapshot.content,
  };
  exportCitedExcerpts(root, deck);
  snapshot.content = root.children;
  return { ...payload, snapshot };
}
export class ExcerptHtmlAdapter extends HtmlAdapter {
  override fromSliceSnapshot(payload: FromSliceSnapshotPayload) {
    return super.fromSliceSnapshot(exportSlice(payload, exportDecks.get(this.job.collection)));
  }
}
export class ExcerptTextAdapter extends MixTextAdapter {
  override fromSliceSnapshot(payload: FromSliceSnapshotPayload) {
    return super.fromSliceSnapshot(exportSlice(payload, exportDecks.get(this.job.collection)));
  }
}
