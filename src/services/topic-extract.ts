import { youtubeVideoId } from "./youtube-transcript";
import { mcqText, readMcq } from "../features/quiz/mcq";
import * as Y from "yjs";
import type { Snapshot } from "./workspace";
import type { TopicPassage, TopicSource } from "./topic-types";
import {
  nodeMcq,
  type DeckData,
  type DeckCard,
  type CardNode,
} from "../features/editor/blocksuite/card-deck";
function retainedAttribution(raw: unknown): string {
  try {
    const value = JSON.parse(String(raw));
    return JSON.stringify({
      title: value.title,
      finalUrl: value.finalUrl,
      fetchedAt: value.fetchedAt,
      author: value.author,
    });
  } catch {
    return String(raw ?? "").slice(0, 500);
  }
}
export interface TopicPdf {
  key: string;
  name: string;
  blockId: string;
}
/** A YouTube card whose saved transcript is indexed with its document. */
export interface TopicVideo {
  videoId: string;
  blockId: string;
  title: string;
}
export function extractDeckPassages(
  source: TopicSource,
  card: DeckCard,
  deck?: DeckData,
): { passages: TopicPassage[]; pdfs: TopicPdf[] } {
  if (card.deleted || source.id !== `deck:${card.id}`)
    return { passages: [], pdfs: [] };
  const texts: string[] = [],
    pdfs: TopicPdf[] = [],
    segments: { text: string; attribution?: string }[] = [];
  const walk = (nodes: CardNode[]) =>
    nodes.forEach((node, index) => {
      const prop = (key: string) => {
        const value = node.props[key];
        return value?.type === "json" ? String(value.value ?? "") : "";
      };
      const flavour = prop("sys:flavour"),
        value = node.props["prop:text"];
      const quiz = nodeMcq(node, deck);
      const text = quiz ? mcqText(quiz) : value?.type === "text" ? value.delta
          .map((run: { insert?: unknown }) =>
            typeof run.insert === "string" ? run.insert : "",
          )
          .join("") : undefined;
      if (text !== undefined) {
        texts.push(text);
        const attribution =
          flavour === "knot:web-source"
            ? retainedAttribution(prop("prop:evidence"))
            : flavour === "knot:cited-excerpt"
              ? retainedAttribution(prop("prop:source"))
              : undefined;
        const last = segments.at(-1);
        if (!attribution && last && !last.attribution) last.text += "\n" + text;
        else segments.push({ text, attribution });
      }
      if (
        flavour === "affine:attachment" &&
        prop("prop:type") === "application/pdf" &&
        prop("prop:sourceId")
      )
        pdfs.push({
          key: prop("prop:sourceId"),
          name: prop("prop:name") || "PDF",
          blockId: String(index),
        });
      walk(node.children);
    });
  walk(card.nodes);
  const passages = segments.flatMap((segment) =>
    splitPassage(segment.text)
      .filter((text) => text.trim())
      .map((text) => ({
        document: source.id,
        id: card.id,
        title: texts[0]?.slice(0, 120) || "Card Deck",
        text,
        revision: source.revision,
        vector: [],
        ...(segment.attribution ? { attribution: segment.attribution } : {}),
      })),
  );
  return { passages, pdfs };
}
/** Isolated decoding: follow only reachable blocks, never instantiate an editor. */
export function extractTopicContent(
  source: TopicSource,
  snapshot: Snapshot,
): { passages: TopicPassage[]; pdfs: TopicPdf[]; videos: TopicVideo[] } {
  if (snapshot.collection.length + snapshot.document.length > 8 * 1024 * 1024)
    throw Error("oversized");
  const envelope = new Y.Doc(),
    body = new Y.Doc();
  try {
    Y.applyUpdate(envelope, new Uint8Array(snapshot.collection));
    Y.applyUpdate(body, new Uint8Array(snapshot.document));
    if (
      [envelope, body].some((d) => d.store.pendingStructs || d.store.pendingDs)
    )
      throw Error("incomplete");
    const pages = envelope.getMap("meta").get("pages");
    const meta = pages instanceof Y.Array ? pages.toJSON() : pages;
    if (!Array.isArray(meta) || !meta.some((p) => p?.id === source.id))
      throw Error("identity");
    const blocks = body.getMap<Y.Map<unknown>>("blocks");
    const roots = [...blocks].filter(
      ([, b]) => b instanceof Y.Map && b.get("sys:flavour") === "affine:page",
    );
    if (roots.length !== 1) throw Error("root");
    const pdfs: TopicPdf[] = [];
    const videos: TopicVideo[] = [];
    const result: TopicPassage[] = [],
      visited = new Set<string>();
    let size = 0;
    let headings: string[] = [];
    function walk(id: string) {
      if (visited.has(id)) return;
      visited.add(id);
      if (visited.size > 100000) throw Error("block-limit");
      const block = blocks.get(id);
      if (!(block instanceof Y.Map)) return;
      const flavour = String(block.get("sys:flavour"));
      if (flavour === "affine:note") headings = [];
      if (flavour === "affine:note" && body.getMap("knot:card-links").has(id))
        return;
      if (
        flavour === "affine:attachment" &&
        block.get("prop:type") === "application/pdf" &&
        block.get("prop:sourceId")
      )
        pdfs.push({
          key: String(block.get("prop:sourceId")),
          name: String(block.get("prop:name") || "PDF"),
          blockId: id,
        });
      if (flavour === "affine:embed-youtube") {
        const videoId =
          String(block.get("prop:videoId") || "") ||
          youtubeVideoId(String(block.get("prop:url") || "")) ||
          "";
        if (/^[\w-]{11}$/.test(videoId) && videos.length < 20)
          videos.push({
            videoId,
            blockId: id,
            title: String(block.get("prop:title") || "YouTube video"),
          });
      }
      const value = block.get("prop:text");
      const quiz = flavour === "knot:mcq" ? readMcq(block.get("prop:definition")) : undefined;
      if (
        quiz || (value instanceof Y.Text &&
        [
          "affine:paragraph",
          "affine:list",
          "affine:code",
          "knot:cited-excerpt",
          "knot:web-source",
        ].includes(flavour))
      ) {
        const text = quiz ? mcqText(quiz) : (value as Y.Text).toString();
        const heading = String(block.get("prop:type") ?? "").match(
          /^h([1-6])$/,
        );
        if (heading) {
          headings = headings.slice(0, Number(heading[1]) - 1);
          headings[Number(heading[1]) - 1] = text;
        }
        size += text.length;
        if (size > 1000000) throw Error("text-limit");
        // Keep exact original substrings. Token-aware refinement occurs in the embedding worker.
        for (const part of splitPassage(text))
          if (part.trim())
            result.push({
              document: source.id,
              id,
              title:
                source.title +
                (headings.length
                  ? " / " + headings.filter(Boolean).join(" / ")
                  : ""),
              text: part,
              revision: source.revision,
              vector: [],
              ...(flavour === "knot:web-source"
                ? {
                    attribution: retainedAttribution(
                      block.get("prop:evidence"),
                    ),
                  }
                : flavour === "knot:cited-excerpt"
                  ? {
                      attribution: retainedAttribution(
                        block.get("prop:source"),
                      ),
                    }
                  : {}),
            });
      }
      const children = block.get("sys:children");
      if (children instanceof Y.Array)
        for (const child of children.toArray()) walk(String(child));
    }
    walk(roots[0][0]);
    return { passages: result, pdfs, videos };
  } finally {
    envelope.destroy();
    body.destroy();
  }
}
export function extractTopicPassages(source: TopicSource, snapshot: Snapshot) {
  return extractTopicContent(source, snapshot).passages;
}
export function splitPassage(text: string, max = 900): string[] {
  const parts: string[] = [];
  while (text.length > max) {
    let end = Math.max(
      text.lastIndexOf("\n", max),
      text.lastIndexOf(". ", max) + 1,
    );
    if (end < max / 2) end = text.lastIndexOf(" ", max);
    if (end < max / 2) end = max;
    if (/^[\uDC00-\uDFFF]$/.test(text[end])) end--;
    parts.push(text.slice(0, end));
    text = text.slice(end);
  }
  if (text) parts.push(text);
  return parts;
}
