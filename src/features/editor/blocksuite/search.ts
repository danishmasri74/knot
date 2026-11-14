import { mcqText, readMcq } from "../../quiz/mcq";
import { cardMcq, cardQuestionReferences, mcqReferenceFlavour, resolveDeckMcq, type DeckData } from "./card-deck";
import * as Y from "yjs";
import type { KnowledgeObject, Snapshot } from "../../../services/workspace";

export const SEARCH_DOCUMENTS = 200;
export const SEARCH_BYTES = 1024 * 1024;
export const SEARCH_TOTAL_BYTES = 16 * SEARCH_BYTES;
export interface SearchContent {
  text: string;
  /** `cardId`: the Card Deck card the note shows, for reusing it. */
  notes: { id: string; title: string; text: string; cardId?: string }[];
}
export interface SearchReport {
  results: {
    source: KnowledgeObject;
    excerpt: string;
    noteId?: string;
    noteTitle?: string;
    /** The Card Deck card a matching note shows. */
    cardId?: string;
    /** A match in text OCR read from an image (docs/WORKSPACE-OCR-PLAN.md). */
    image?: import("../../../services/topic-types").ImageLocation;
    /** A match in text OCR read from a scanned PDF page. */
    pdf?: import("./pdf-highlights").PdfLocation;
  }[];
  skipped: string[];
  limited: boolean;
  checkedAt: number;
}

/** Isolated, read-only decoding; never hydrate the editor's workspace collection. */
export function savedSearchText(
  id: string,
  snapshot: Snapshot,
  structured = false,
): string {
  const content = readSavedSearch(id, snapshot);
  return structured ? JSON.stringify(content.blocks) : content.text;
}

export function savedSearchContent(
  id: string,
  snapshot: Snapshot,
  deck?: DeckData,
): SearchContent {
  const { text, blocks, links } = readSavedSearch(id, snapshot, deck);
  const notes = new Map<string, SearchContent["notes"][number]>();
  for (const block of blocks) {
    if (!block.note || !SEARCH_FLAVOURS.includes(block.flavour)) continue;
    let note = notes.get(block.note);
    if (!note) {
      note = { id: block.note, title: "", text: "", cardId: links[block.note] };
      notes.set(block.note, note);
    }
    if (!note.title && block.text.trim())
      note.title = block.text.trim().slice(0, 80);
    note.text += `${note.text ? "\n" : ""}${block.text}`;
  }
  return { text, notes: [...notes.values()] };
}

const SEARCH_FLAVOURS = [
  "affine:paragraph",
  "affine:list",
  "affine:code",
  "knot:cited-excerpt",
  "knot:web-source",
  "knot:mcq",
  mcqReferenceFlavour,
];

function readSavedSearch(id: string, snapshot: Snapshot, deck?: DeckData) {
  if (snapshot.collection.length + snapshot.document.length > SEARCH_BYTES)
    throw new Error("Snapshot exceeds 1 MiB");
  const envelope = new Y.Doc(),
    body = new Y.Doc();
  try {
    Y.applyUpdate(envelope, new Uint8Array(snapshot.collection));
    Y.applyUpdate(body, new Uint8Array(snapshot.document));
    if (
      envelope.store.pendingStructs ||
      envelope.store.pendingDs ||
      body.store.pendingStructs ||
      body.store.pendingDs
    )
      throw new Error("Incomplete update");
    const pages = envelope.getMap("meta").get("pages");
    const metadata = pages instanceof Y.Array ? pages.toJSON() : pages;
    if (!Array.isArray(metadata) || !metadata.some((entry) => entry?.id === id))
      throw new Error("Mismatched identity");
    const blocks = body.getMap("blocks");
    if (
      [...blocks.values()].filter(
        (block) =>
          block instanceof Y.Map && block.get("sys:flavour") === "affine:page",
      ).length !== 1
    )
      throw new Error("Invalid page root");
    const content = structuredSavedBlocks(blocks, body.getMap<string>("knot:card-links"), deck);
    const parts: string[] = [];
    let length = 0;
    const append = (text: string) => {
      length += text.length + 1;
      if (length > 100000) throw new Error("Body exceeds 100,000 characters");
      parts.push(text);
    };
    for (const block of blocks.values()) {
      if (!(block instanceof Y.Map) ||
          !SEARCH_FLAVOURS.includes(String(block.get("sys:flavour")))) continue;
      const value = block.get("prop:text");
      if (value instanceof Y.Text) append(value.toString());
    }
    for (const block of content) {
      if (block.flavour === "knot:mcq" || block.flavour === mcqReferenceFlavour)
        append(block.text);
    }
    const links = Object.fromEntries(body.getMap<string>("knot:card-links"));
    return { text: parts.join("\n"), blocks: content, links };
  } finally {
    envelope.destroy();
    body.destroy();
  }
}

export async function searchSavedDocuments(
  query: string,
  list: (offset: number) => Promise<KnowledgeObject[]>,
  load: (id: string) => Promise<Snapshot | null>,
  extract: (id: string, snapshot: Snapshot) => Promise<string | SearchContent>,
): Promise<SearchReport> {
  const needle = query.trim().toLowerCase();
  if (!needle || needle.length > 200)
    throw new Error("Enter 1–200 characters to search.");
  const catalog = new Map<string, KnowledgeObject>();
  let limited = false;
  for (let offset = 0; offset <= SEARCH_DOCUMENTS; offset += 100) {
    const page = await list(offset);
    if (offset === SEARCH_DOCUMENTS) {
      limited = page.length > 0;
      break;
    }
    for (const row of page) catalog.set(row.id, row);
    if (page.length < 100) break;
  }
  const report: SearchReport = {
    results: [],
    skipped: [],
    limited,
    checkedAt: Date.now(),
  };
  let total = 0;
  for (const source of [...catalog.values()].slice(0, SEARCH_DOCUMENTS)) {
    let text = "";
    let notes: SearchContent["notes"] = [];
    // Storage failures abort the whole attempt; bad individual bodies are explicit omissions.
    const snapshot =
      total < SEARCH_TOTAL_BYTES ? await load(source.id) : undefined;
    const size = snapshot
      ? snapshot.collection.length + snapshot.document.length
      : 0;
    if (
      snapshot === undefined ||
      size > SEARCH_BYTES ||
      total + size > SEARCH_TOTAL_BYTES
    ) {
      report.skipped.push(source.title);
      total += size;
    } else if (snapshot) {
      total += size;
      try {
        const content = await extract(source.id, snapshot);
        text = typeof content === "string" ? content : content.text;
        notes = typeof content === "string" ? [] : content.notes;
      } catch {
        report.skipped.push(source.title);
      }
    }
    const position = text.toLowerCase().indexOf(needle);
    const matches = notes.filter((note) =>
      note.text.toLowerCase().includes(needle),
    );
    for (const note of matches) {
      const position = note.text.toLowerCase().indexOf(needle);
      const start = Math.max(0, position - 50);
      report.results.push({
        source,
        noteId: note.id,
        noteTitle: note.title || "Untitled note",
        ...(note.cardId ? { cardId: note.cardId } : {}),
        excerpt: `${start ? "…" : ""}${note.text.slice(start, start + 220)}${note.text.length > start + 220 ? "…" : ""}`,
      });
    }
    if (
      !matches.length &&
      (source.title.toLowerCase().includes(needle) || position >= 0)
    ) {
      const start = Math.max(0, position - 50);
      report.results.push({
        source,
        excerpt:
          position < 0
            ? "Title match"
            : `${start ? "…" : ""}${text.slice(start, start + 220)}${text.length > start + 220 ? "…" : ""}`,
      });
    }
  }
  report.results.sort(
    (a, b) =>
      a.source.title.localeCompare(b.source.title) ||
      a.source.id.localeCompare(b.source.id),
  );
  return report;
}

/** Preserve tree order and ownership without hydrating the editor. */
function structuredSavedBlocks(blocks: Y.Map<unknown>, links: Y.Map<string>, deck?: DeckData) {
  const result: {
    webSource?: string;
    id: string;
    parent: string | null;
    note: string | null;
    type: string;
    flavour: string;
    checked?: boolean;
    text: string;
  }[] = [];
  const visited = new Set<string>();
  const walk = (id: string, parent: string | null, note: string | null) => {
    if (visited.has(id)) return;
    visited.add(id);
    const block = blocks.get(id);
    if (!(block instanceof Y.Map)) return;
    const flavour = String(block.get("sys:flavour"));
    if (flavour === "affine:note") {
      note = id;
      const shared = links.get(id);
      const card = shared && deck ? deck[shared] : undefined;
      if (card?.deleted) return;
      if (card && deck) {
        const direct = cardMcq(card);
        if (direct) result.push({ id, parent, note, type: "knot:mcq", flavour: "knot:mcq", text: mcqText(direct) });
        for (const cardId of new Set(cardQuestionReferences(card.nodes))) {
          const question = resolveDeckMcq(deck, cardId);
          if (question) result.push({
            id: `${id}:${cardId}`, parent: id, note, type: mcqReferenceFlavour,
            flavour: mcqReferenceFlavour, text: mcqText(question),
          });
        }
      }
    }
    const value = block.get("prop:text");
    const canonical = note && deck && deck[links.get(note) ?? ""];
    const quiz = !canonical && (flavour === "knot:mcq" ? readMcq(block.get("prop:definition"))
      : flavour === mcqReferenceFlavour && deck
        ? resolveDeckMcq(deck, block.get("prop:cardId"))
        : undefined);
    if (value instanceof Y.Text || quiz)
      result.push({
        id,
        parent,
        note,
        type: String(block.get("prop:type") ?? flavour),
        flavour,
        ...(block.get("prop:type") === "todo"
          ? { checked: block.get("prop:checked") === true }
          : {}),
        text: quiz ? mcqText(quiz) : (value as Y.Text).toString(),
        ...(flavour === "knot:web-source"
          ? { webSource: String(block.get("prop:evidence")) }
          : {}),
      });
    const children = block.get("sys:children");
    if (children instanceof Y.Array)
      for (const child of children.toArray()) walk(String(child), id, note);
  };
  for (const [id, block] of blocks)
    if (block instanceof Y.Map && block.get("sys:flavour") === "affine:page")
      walk(id, null, null);
  return result;
}
