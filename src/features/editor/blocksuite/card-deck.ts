import * as Y from "yjs";
import { mcqText, readMcq, type McqDefinition } from "../../quiz/mcq";
import {
  isContentProp,
  isMediaFlavour,
  mediaIdentity,
  mediaKind,
  type MediaFlavour,
  type MediaKind,
} from "./media-cards";

type Value =
  | { type: "text"; delta: ReturnType<Y.Text["toDelta"]> }
  | { type: "map"; entries: Record<string, Value> }
  | { type: "array"; items: Value[] }
  | { type: "json"; value: unknown };
export interface CardNode {
  props: Record<string, Value>;
  children: CardNode[];
}
export interface DeckCard {
  id: string;
  nodes: CardNode[];
  createdAt?: number;
  updatedAt?: number;
  deleted?: boolean;
  /** Emptied from Trash: content is gone, the ID stays so old placements expire. */
  purged?: boolean;
  generation?: number;
  /** Moved to Trash because its last note was deleted while it was empty or
   * very short. A note that still (or again) shows it restores it. */
  autoTrashed?: true;
  /** A standalone canvas object (video, link, file or image):
   * `nodes` is that one block's shared content, not a note's children. */
  media?: true;
}
export type DeckData = Record<string, DeckCard>;
const encode = (value: unknown): Value => {
  if (value instanceof Y.Text) return { type: "text", delta: value.toDelta() };
  if (value instanceof Y.Map)
    return {
      type: "map",
      entries: Object.fromEntries([...value].map(([k, v]) => [k, encode(v)])),
    };
  if (value instanceof Y.Array)
    return { type: "array", items: value.toArray().map(encode) };
  return { type: "json", value };
};
const decode = (value: Value): unknown => {
  if (value.type === "text") {
    const text = new Y.Text();
    text.applyDelta(value.delta);
    return text;
  }
  if (value.type === "map")
    return new Y.Map(
      Object.entries(value.entries).map(([k, v]) => [k, decode(v)]),
    );
  if (value.type === "array") {
    const array = new Y.Array();
    array.push(value.items.map(decode));
    return array;
  }
  return value.value;
};
/** The canvas object a media card is, and what it shows as. */
export function cardMedia(card: DeckCard | undefined):
  | { flavour: MediaFlavour; kind: MediaKind; get: (key: string) => unknown; identity?: string }
  | undefined {
  if (!card?.media || card.nodes.length !== 1) return;
  const node = card.nodes[0];
  const get = (key: string) => {
    const value = node.props[key];
    return value?.type === "json" ? value.value : undefined;
  };
  const flavour = get("sys:flavour");
  if (!isMediaFlavour(flavour)) return;
  const kind = mediaKind(flavour, get);
  if (!kind) return;
  return { flavour, kind, get, identity: mediaIdentity(flavour, get) };
}
const mediaLabels: Record<MediaKind, string> = {
  video: "YouTube video",
  link: "Link",
  pdf: "PDF",
  file: "File",
  image: "Image",
};
/** A media card's name and secondary line, for lists and search. */
export function mediaText(card: DeckCard) {
  const media = cardMedia(card);
  if (!media) return;
  const text = (key: string) => {
    const value = media.get(key);
    return typeof value === "string" ? value.trim() : "";
  };
  const url = text("prop:url");
  const title =
    text("prop:title") ||
    text("prop:name") ||
    text("prop:caption") ||
    url ||
    mediaLabels[media.kind];
  let site = "";
  try {
    site = url ? new URL(url).host.replace(/^www\./, "") : "";
  } catch {
    site = url;
  }
  const detail = [mediaLabels[media.kind], site].filter(Boolean).join(" · ");
  // Everything searchable: title, address, description and caption.
  const search = [title, url, text("prop:description"), text("prop:caption"), text("prop:name")]
    .filter((part, index, all) => part && all.indexOf(part) === index)
    .join("\n");
  return { title, detail, search, label: mediaLabels[media.kind] };
}
export function isMcqCard(card: DeckCard | undefined): boolean {
  if (!card) return false;
  const flavour = card.nodes[0]?.props["sys:flavour"];
  return card.nodes.length === 1 && flavour?.type === "json" && flavour.value === "knot:mcq";
}
export function cardMcq(card: DeckCard | undefined) {
  if (!card || !isMcqCard(card)) return;
  const definition = card.nodes[0]?.props["prop:definition"];
  return definition?.type === "json" ? readMcq(definition.value) : undefined;
}
export const mcqReferenceFlavour = "knot:mcq-reference";
/** A note card shown inside another note, by ID (see card-embed.ts). */
export const cardEmbedFlavour = "knot:card-embed";

/** Cards shown inside these nodes through card embeds. */
export function* cardEmbedReferences(nodes: CardNode[]): Generator<string> {
  for (const node of nodes) {
    const flavour = node.props["sys:flavour"];
    const id = node.props["prop:cardId"];
    if (flavour?.type === "json" && flavour.value === cardEmbedFlavour &&
        id?.type === "json" && typeof id.value === "string" && id.value)
      yield id.value;
    yield* cardEmbedReferences(node.children);
  }
}

/** What reusing a card inside a note adds: a question reference, a copy of
 * a video, link, file or image, or an embed that shows a note card. */
export function cardInsertion(card: DeckCard | undefined):
  | { flavour: string; props: Record<string, unknown> }
  | undefined {
  if (!card || card.deleted) return;
  if (isMcqCard(card)) return { flavour: mcqReferenceFlavour, props: { cardId: card.id } };
  if (card.media) {
    const node = card.nodes[0];
    const flavour = node?.props["sys:flavour"];
    if (flavour?.type !== "json" || typeof flavour.value !== "string") return;
    const props: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node.props))
      if (key.startsWith("prop:") && value.type === "json")
        props[key.slice(5)] = value.value;
    return { flavour: flavour.value, props };
  }
  return { flavour: cardEmbedFlavour, props: { cardId: card.id } };
}
export const unavailableMcq = "Multiple-choice question unavailable";

export function resolveDeckMcq(deck: DeckData, cardId: unknown) {
  if (typeof cardId !== "string") return;
  const card = deck[cardId];
  return card && !card.deleted ? cardMcq(card) : undefined;
}

export function* cardQuestionReferences(nodes: CardNode[]): Generator<string> {
  for (const node of nodes) {
    const flavour = node.props["sys:flavour"];
    const id = node.props["prop:cardId"];
    if (flavour?.type === "json" && flavour.value === mcqReferenceFlavour &&
        id?.type === "json" && typeof id.value === "string" && id.value)
      yield id.value;
    yield* cardQuestionReferences(node.children);
  }
}

export function nodeMcq(node: CardNode, deck?: DeckData) {
  const flavour = node.props["sys:flavour"];
  if (flavour?.type !== "json") return;
  if (flavour.value === "knot:mcq") {
    const definition = node.props["prop:definition"];
    if (definition?.type === "json") return readMcq(definition.value);
  }
  if (flavour.value === mcqReferenceFlavour && deck) {
    const reference = node.props["prop:cardId"];
    if (reference?.type === "json") return resolveDeckMcq(deck, reference.value);
  }
}

// Blocks that hold nothing to reuse when their text is empty.
const textOnly = new Set(["affine:paragraph", "affine:list", "affine:code", "affine:divider"]);
/** A note card with nothing in it: no text (spaces don't count), no media,
 * no question. The deck doesn't list these; there's nothing to reuse. */
export function isBlankCard(card: DeckCard): boolean {
  if (card.media || isMcqCard(card)) return false;
  const blank = (nodes: CardNode[]): boolean =>
    nodes.every((node) => {
      const flavour = node.props["sys:flavour"];
      if (flavour?.type === "json" && !textOnly.has(String(flavour.value)))
        return false;
      const text = node.props["prop:text"];
      if (
        text?.type === "text" &&
        text.delta.some(
          (run: { insert?: unknown }) =>
            typeof run.insert === "string" && run.insert.trim(),
        )
      )
        return false;
      return blank(node.children);
    });
  return blank(card.nodes);
}
/** Longest text a note card can have and still go to Trash with its last note. */
export const shortCardLength = 20;
/** Blank, or a few characters of plain text: deleting its last note on a
 * canvas means it isn't worth keeping in the deck. */
export function isShortCard(card: DeckCard): boolean {
  if (card.media || isMcqCard(card)) return false;
  let length = 0;
  const plain = (nodes: CardNode[]): boolean =>
    nodes.every((node) => {
      const flavour = node.props["sys:flavour"];
      if (flavour?.type === "json" && !textOnly.has(String(flavour.value)))
        return false;
      const text = node.props["prop:text"];
      if (text?.type === "text")
        for (const run of text.delta as { insert?: unknown }[])
          if (typeof run.insert === "string") length += run.insert.trim().length;
      return length <= shortCardLength && plain(node.children);
    });
  return plain(card.nodes);
}
export function cardPreview(card: DeckCard, fallback = "Empty card", deck?: DeckData): string {
  const media = mediaText(card);
  if (media) return media.search || fallback;
  if (isMcqCard(card)) {
    const quiz = cardMcq(card);
    return quiz ? mcqText(quiz) : "Multiple-choice question unavailable";
  }
  const lines: string[] = [];
  const walk = (nodes: CardNode[]) =>
    nodes.forEach((node) => {
      const quiz = nodeMcq(node, deck);
      const flavour = node.props["sys:flavour"];
      if (quiz) lines.push(mcqText(quiz));
      else if (flavour?.type === "json" && flavour.value === mcqReferenceFlavour)
        lines.push(unavailableMcq);
      const text = node.props["prop:text"];
      if (text?.type === "text")
        lines.push(
          text.delta
            .map((part: { insert?: unknown }) =>
              typeof part.insert === "string" ? part.insert : "",
            )
            .join(""),
        );
      walk(node.children);
    });
  walk(card.nodes);
  return lines.join("\n").trim() || fallback;
}
/** Media blocks placed directly on the canvas (not inside a note). */
export function standaloneMedia(doc: Y.Doc) {
  const blocks = doc.getMap<Y.Map<unknown>>("blocks");
  const ids = new Set<string>();
  for (const block of blocks.values()) {
    if (!(block instanceof Y.Map) || block.get("sys:flavour") !== "affine:surface")
      continue;
    const children = block.get("sys:children");
    if (!(children instanceof Y.Array)) continue;
    for (const id of children.toArray())
      if (
        typeof id === "string" &&
        isMediaFlavour(blocks.get(id)?.get("sys:flavour"))
      )
        ids.add(id);
  }
  return ids;
}
/** The deck owns content; a document owns placement, size and instance identity. */
export class CardDeck {
  contentVersion = 0;
  private docs = new Set<Y.Doc>();
  private editorDocs = new Set<Y.Doc>();
  private stops: (() => void)[] = [];
  private signatures = new Map<string, string>();
  private revisions = new Map<string, { signature: string; date: number }[]>();
  private syncing = false;
  private listeners = new Set<() => void>();
  constructor(
    public data: DeckData,
    private changed: () => void,
    readonly workspace = "knot-workspace",
  ) {
    const now = Date.now();
    for (const card of Object.values(data)) {
      card.createdAt ??= now;
      card.updatedAt ??= card.createdAt;
    }
    this.dropRetired();
  }
  placements(canvas?: string) {
    const ids = new Set<string>();
    for (const doc of this.docs) {
      if (this.editorDocs.has(doc) || (canvas && doc.guid !== canvas)) continue;
      for (const id of this.usedCards(doc)) ids.add(id);
    }
    return ids;
  }
  usedCards(doc: Y.Doc) {
    const ids = new Set<string>();
    const standalone = standaloneMedia(doc);
    const blocks = doc.getMap<Y.Map<unknown>>("blocks");
    for (const [instance, shared] of doc.getMap<string>("knot:card-links")) {
      const flavour = blocks.get(instance)?.get("sys:flavour");
      // A media block moved into a note is part of that note's content.
      if (flavour === "affine:note" || standalone.has(instance)) ids.add(shared);
    }
    for (const block of doc.getMap<Y.Map<unknown>>("blocks").values()) {
      const flavour = block.get("sys:flavour");
      const id = block.get("prop:cardId");
      if (typeof id !== "string") continue;
      if (flavour === mcqReferenceFlavour && resolveDeckMcq(this.data, id)) ids.add(id);
      // A card shown inside a note is in use there.
      if (flavour === cardEmbedFlavour && this.data[id] && !this.data[id].deleted)
        ids.add(id);
    }
    return ids;
  }
  placementDocuments() {
    return [...this.docs].filter((doc) => !this.editorDocs.has(doc));
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private notify() {
    this.changed();
    this.listeners.forEach((fn) => fn());
  }
  private read(doc: Y.Doc, id: string): CardNode {
    const block = doc.getMap<Y.Map<unknown>>("blocks").get(id)!;
    return {
      props: Object.fromEntries(
        [...block]
          .filter(([key]) => key !== "sys:id" && key !== "sys:children")
          .map(([k, v]) => [k, encode(v)]),
      ),
      children: (block.get("sys:children") as Y.Array<string>)
        .toArray()
        .map((child) => this.read(doc, child)),
    };
  }
  private content(doc: Y.Doc, id: string) {
    return this.read(doc, id).children;
  }
  private replace(doc: Y.Doc, id: string, nodes: CardNode[]) {
    const blocks = doc.getMap<Y.Map<unknown>>("blocks");
    const parent = blocks.get(id);
    if (!parent) return;
    const remove = (child: string) => {
      const block = blocks.get(child);
      (block?.get("sys:children") as Y.Array<string> | undefined)
        ?.toArray()
        .forEach(remove);
      blocks.delete(child);
    };
    const insert = (node: CardNode): string => {
      const child = crypto.randomUUID();
      const block = new Y.Map<unknown>();
      block.set("sys:id", child);
      Object.entries(node.props).forEach(([k, v]) => block.set(k, decode(v)));
      const children = new Y.Array<string>();
      children.push(node.children.map(insert));
      block.set("sys:children", children);
      blocks.set(child, block);
      return child;
    };
    doc.transact(() => {
      const children = parent.get("sys:children") as Y.Array<string>;
      children.toArray().forEach(remove);
      children.delete(0, children.length);
      children.push(nodes.map(insert));
    });
  }
  /** A standalone object's shared content: its flavour and content props. */
  private mediaContent(doc: Y.Doc, id: string): CardNode[] {
    const block = doc.getMap<Y.Map<unknown>>("blocks").get(id)!;
    const props: Record<string, Value> = {};
    // Sorted, so the same content has the same signature in every document.
    for (const key of [...block.keys()].sort())
      if (isContentProp(key)) props[key] = encode(block.get(key));
    return [{ props, children: [] }];
  }
  private applyMedia(doc: Y.Doc, id: string, nodes: CardNode[]) {
    const block = doc.getMap<Y.Map<unknown>>("blocks").get(id);
    const node = nodes[0];
    if (!block || !node) return;
    const flavour = node.props["sys:flavour"];
    if (flavour?.type !== "json" || flavour.value !== block.get("sys:flavour"))
      return;
    doc.transact(() => {
      for (const key of [...block.keys()])
        if (isContentProp(key) && !(key in node.props)) block.delete(key);
      for (const [key, value] of Object.entries(node.props)) {
        if (key === "sys:flavour" || key === "sys:version") continue;
        if (JSON.stringify(encode(block.get(key))) !== JSON.stringify(value))
          block.set(key, decode(value));
      }
    });
  }
  /** Placements of a card other than `instance` in `doc`, across open documents. */
  private otherPlacements(cardId: string, doc: Y.Doc, instance: string) {
    let count = 0;
    for (const target of this.docs) {
      if (this.editorDocs.has(target)) continue;
      const standalone = standaloneMedia(target);
      for (const [other, shared] of target.getMap<string>("knot:card-links"))
        if (
          shared === cardId &&
          standalone.has(other) &&
          !(target === doc && other === instance)
        )
          count++;
    }
    return count;
  }
  /** Cards for objects that are no longer cards (linked pages, which an
   * earlier build saved) and the links to them. */
  private dropRetired(doc?: Y.Doc) {
    if (!doc) {
      for (const [id, card] of Object.entries(this.data))
        if (card.media && !cardMedia(card)) {
          delete this.data[id];
          this.contentVersion++;
        }
      return;
    }
    const links = doc.getMap<string>("knot:card-links");
    const blocks = doc.getMap<Y.Map<unknown>>("blocks");
    for (const [instance, shared] of [...links]) {
      const flavour = blocks.get(instance)?.get("sys:flavour");
      if (!this.data[shared] && flavour !== undefined && flavour !== "affine:note" && !isMediaFlavour(flavour))
        links.delete(instance);
    }
  }
  /** The oldest live card of this object type for this video, page or file.
   * Different types (a YouTube card and a link to it) can't share content. */
  private findMedia(identity: string, flavour: unknown) {
    let found: DeckCard | undefined;
    for (const card of Object.values(this.data)) {
      const media = cardMedia(card);
      if (card.deleted || media?.identity !== identity || media.flavour !== flavour)
        continue;
      if (!found || (card.createdAt ?? 0) < (found.createdAt ?? 0)) found = card;
    }
    return found;
  }
  /** Give a standalone object a card: the existing one for the same thing, or
   * a new one. Returns false while it has nothing to be identified by yet. */
  private linkMedia(doc: Y.Doc, id: string) {
    const block = doc.getMap<Y.Map<unknown>>("blocks").get(id)!;
    const identity = mediaIdentity(block.get("sys:flavour"), (key) =>
      block.get(key),
    );
    if (!identity) return false;
    const links = doc.getMap<string>("knot:card-links");
    const nodes = this.mediaContent(doc, id);
    const signature = JSON.stringify(nodes);
    const existing = this.findMedia(identity, block.get("sys:flavour"));
    const now = Date.now();
    if (existing) {
      links.set(id, existing.id);
      doc
        .getMap<number>("knot:card-generations")
        .set(id, existing.generation ?? 0);
      // Placed elsewhere: the card wins, so other canvases don't change.
      // Its only copy: this object is the newest version of it.
      if (this.otherPlacements(existing.id, doc, id)) {
        this.applyMedia(doc, id, existing.nodes);
        this.signatures.set(doc.guid + id, JSON.stringify(existing.nodes));
      } else {
        if (JSON.stringify(existing.nodes) !== signature) {
          this.contentVersion++;
          this.data[existing.id] = { ...existing, nodes, updatedAt: now };
        }
        this.signatures.set(doc.guid + id, signature);
      }
      return true;
    }
    const cardId = crypto.randomUUID();
    links.set(id, cardId);
    this.contentVersion++;
    this.data[cardId] = {
      id: cardId,
      nodes,
      media: true,
      createdAt: now,
      updatedAt: now,
    };
    this.signatures.set(doc.guid + id, signature);
    return true;
  }
  /** How a card is already shown on a canvas, if anywhere: new placements
   * reuse its display style. */
  placementStyle(cardId: string) {
    for (const target of this.docs) {
      if (this.editorDocs.has(target)) continue;
      const blocks = target.getMap<Y.Map<unknown>>("blocks");
      const standalone = standaloneMedia(target);
      for (const [instance, shared] of target.getMap<string>(
        "knot:card-links",
      )) {
        if (shared !== cardId || !standalone.has(instance)) continue;
        const block = blocks.get(instance)!;
        return {
          style: block.get("prop:style"),
          embed: block.get("prop:embed"),
        };
      }
    }
  }
  attach(doc: Y.Doc, editorOnly = false) {
    this.docs.add(doc);
    if (editorOnly) this.editorDocs.add(doc);
    this.syncing = true;
    try {
      const links = doc.getMap<string>("knot:card-links");
      doc.transact(() => {
        for (const [id, block] of doc.getMap<Y.Map<unknown>>("blocks")) {
          if (block.get("sys:flavour") !== "affine:note") continue;
          let cardId = links.get(id);
          if (!cardId) {
            cardId = crypto.randomUUID();
            links.set(id, cardId);
            const now = Date.now();
            this.contentVersion++;
            this.data[cardId] = {
              id: cardId,
              nodes: this.content(doc, id),
              createdAt: now,
              updatedAt: now,
            };
          }
          const card = this.data[cardId];
          if (!card)
            throw new Error(
              "Shared card is missing from Card Deck. Stored document preserved.",
            );
          this.reclaim(card);
          if (this.expired(doc, id, card)) {
            this.removeInstance(doc, id);
            continue;
          }
          if (
            JSON.stringify(this.content(doc, id)) !== JSON.stringify(card.nodes)
          )
            this.replace(doc, id, card.nodes);
          this.signatures.set(doc.guid + id, JSON.stringify(card.nodes));
        }
        if (!editorOnly) {
          this.dropRetired(doc);
          this.attachMedia(doc);
        }
      });
    } finally {
      this.syncing = false;
    }
    const listener = (tx: Y.Transaction) => this.scan(doc, tx.origin);
    doc.on("afterTransaction", listener);
    const stop = () => {
      doc.off("afterTransaction", listener);
      this.docs.delete(doc);
      this.editorDocs.delete(doc);
      for (const id of doc.getMap<string>("knot:card-links").keys())
        this.signatures.delete(doc.guid + id);
    };
    this.stops.push(stop);
    this.notify();
    return () => {
      stop();
      this.stops = this.stops.filter((entry) => entry !== stop);
    };
  }
  private attachMedia(doc: Y.Doc) {
    const links = doc.getMap<string>("knot:card-links");
    for (const id of standaloneMedia(doc)) {
      const cardId = links.get(id);
      const card = cardId ? this.data[cardId] : undefined;
      if (!card) {
        this.linkMedia(doc, id);
        continue;
      }
      if (this.expired(doc, id, card)) {
        this.removeInstance(doc, id);
        continue;
      }
      if (
        JSON.stringify(this.mediaContent(doc, id)) !== JSON.stringify(card.nodes)
      )
        this.applyMedia(doc, id, card.nodes);
      this.signatures.set(doc.guid + id, JSON.stringify(card.nodes));
    }
  }
  /** Publish edits to standalone objects and enroll new ones. */
  private scanMedia(doc: Y.Doc, origin: unknown) {
    const links = doc.getMap<string>("knot:card-links");
    for (const id of standaloneMedia(doc)) {
      const cardId = links.get(id);
      const card = cardId ? this.data[cardId] : undefined;
      if (!cardId || !card) {
        this.linkMedia(doc, id);
        continue;
      }
      if (this.expired(doc, id, card)) {
        this.removeInstance(doc, id);
        continue;
      }
      if (!this.signatures.has(doc.guid + id)) {
        // Undo restored this object: show the card as it is now.
        this.applyMedia(doc, id, card.nodes);
        this.signatures.set(doc.guid + id, JSON.stringify(card.nodes));
        continue;
      }
      const nodes = this.mediaContent(doc, id);
      const signature = JSON.stringify(nodes);
      if (this.signatures.get(doc.guid + id) === signature) continue;
      const media = cardMedia({ id: cardId, nodes, media: true });
      const identity = media?.identity;
      const other = identity ? this.findMedia(identity, media.flavour) : undefined;
      if (!identity || (other && other.id !== cardId)) {
        // Now the same as another card (or nothing at all): use the matching
        // card for this object and leave this card as it was.
        links.delete(id);
        this.signatures.delete(doc.guid + id);
        this.linkMedia(doc, id);
        continue;
      }
      this.publish(doc, id, cardId, nodes, signature, origin);
      for (const target of this.docs) {
        const standalone = standaloneMedia(target);
        for (const [instance, shared] of target.getMap<string>(
          "knot:card-links",
        )) {
          if (shared !== cardId || (target === doc && instance === id)) continue;
          if (!standalone.has(instance)) continue;
          this.applyMedia(target, instance, nodes);
          this.signatures.set(target.guid + instance, signature);
        }
      }
    }
  }
  /** Record a card's new content, keeping the revision dates Undo restores. */
  private publish(
    doc: Y.Doc,
    id: string,
    cardId: string,
    nodes: CardNode[],
    signature: string,
    origin: unknown,
  ) {
    const previous = this.data[cardId];
    const now = Date.now();
    let updatedAt = now;
    if (previous) {
      const history = this.revisions.get(cardId) ?? [];
      if (origin instanceof Y.UndoManager) {
        const prior = history
          .slice()
          .reverse()
          .find((entry) => entry.signature === signature);
        updatedAt = prior?.date ?? previous.updatedAt ?? now;
      }
      history.push({
        signature: JSON.stringify(previous.nodes),
        date: previous.updatedAt ?? now,
      });
      this.revisions.set(cardId, history);
    }
    this.contentVersion++;
    this.data[cardId] = {
      id: cardId,
      nodes,
      generation: previous?.generation,
      createdAt: previous?.createdAt ?? now,
      updatedAt,
      ...(previous?.media ? { media: true as const } : {}),
    };
    this.signatures.set(doc.guid + id, signature);
  }
  private scan(doc: Y.Doc, origin: unknown) {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const links = doc.getMap<string>("knot:card-links");
      for (const [id, block] of doc.getMap<Y.Map<unknown>>("blocks")) {
        if (block.get("sys:flavour") !== "affine:note") continue;
        let cardId = links.get(id);
        // Undo brought back a note whose card went to Trash with it.
        if (cardId && this.data[cardId]) this.reclaim(this.data[cardId]);
        if (
          cardId &&
          this.data[cardId] &&
          this.expired(doc, id, this.data[cardId])
        ) {
          this.removeInstance(doc, id);
          continue;
        }
        // Undoing a removed placement must use the current shared content,
        // rather than publishing its older snapshot back into the deck.
        if (
          cardId &&
          this.data[cardId] &&
          !this.signatures.has(doc.guid + id)
        ) {
          this.replace(doc, id, this.data[cardId].nodes);
          this.signatures.set(
            doc.guid + id,
            JSON.stringify(this.data[cardId].nodes),
          );
          continue;
        }
        const nodes = this.content(doc, id),
          signature = JSON.stringify(nodes);
        if (this.signatures.get(doc.guid + id) === signature) continue;
        if (!cardId) {
          cardId = crypto.randomUUID();
          links.set(id, cardId);
        }
        this.publish(doc, id, cardId, nodes, signature, origin);
        for (const target of this.docs)
          for (const [instance, shared] of target.getMap<string>(
            "knot:card-links",
          )) {
            if (
              shared !== cardId ||
              (target === doc && instance === id) ||
              !target.getMap("blocks").has(instance)
            )
              continue;
            this.replace(target, instance, nodes);
            this.signatures.set(target.guid + instance, signature);
          }
      }
      if (!this.editorDocs.has(doc)) this.scanMedia(doc, origin);
      for (const [id, shared] of links) {
        if (doc.getMap("blocks").has(id)) continue;
        // A note shown until now was deleted: if it was its card's last
        // placement and the card is empty or very short, Trash the card.
        if (this.signatures.has(doc.guid + id) && !this.editorDocs.has(doc))
          this.trashIfLeftover(shared);
        this.signatures.delete(doc.guid + id);
      }
      this.notify();
    } finally {
      this.syncing = false;
    }
  }
  writeMcq(definition: McqDefinition, existing?: string) {
    const id = existing ?? crypto.randomUUID();
    const previous = this.data[id];
    if (existing && (!previous || previous.deleted || !isMcqCard(previous)))
      throw Error("This quiz is unavailable.");
    const nodes: CardNode[] = [{
      props: {
        "sys:flavour": { type: "json", value: "knot:mcq" },
        "sys:version": { type: "json", value: 1 },
        "prop:definition": { type: "json", value: definition },
      },
      children: [],
    }];
    this.syncing = true;
    try {
      const signature = JSON.stringify(nodes);
      const now = Date.now();
      this.data[id] = { ...previous, id, nodes, createdAt: previous?.createdAt ?? now, updatedAt: now };
      this.contentVersion++;
      for (const doc of this.docs)
        for (const [instance, shared] of doc.getMap<string>("knot:card-links")) {
          if (shared !== id || !doc.getMap("blocks").has(instance)) continue;
          this.replace(doc, instance, nodes);
          this.signatures.set(doc.guid + instance, signature);
        }
    } finally {
      this.syncing = false;
    }
    this.notify();
    return id;
  }
  private removeInstance(doc: Y.Doc, id: string) {
    this.replace(doc, id, []);
    const blocks = doc.getMap<Y.Map<unknown>>("blocks");
    for (const block of blocks.values()) {
      const children = block.get("sys:children") as Y.Array<string>;
      const index = children?.toArray().indexOf(id);
      if (index !== undefined && index >= 0) children.delete(index, 1);
    }
    blocks.delete(id);
  }
  private expired(doc: Y.Doc, instance: string, card: DeckCard) {
    return (
      card.deleted ||
      (doc.getMap<number>("knot:card-generations").get(instance) ?? 0) <
        (card.generation ?? 0)
    );
  }
  /** Move blank cards that aren't placed anywhere to Trash. Callers make
   * sure every notebook is loaded first, so placements are complete. */
  trashBlankUnplaced() {
    const used = this.placements();
    let count = 0;
    for (const card of Object.values(this.data)) {
      if (card.deleted || used.has(card.id) || !isBlankCard(card)) continue;
      this.delete(card.id);
      count++;
    }
    return count;
  }
  restore(id: string) {
    if (!this.data[id]?.deleted || this.data[id].purged) return;
    this.contentVersion++;
    delete this.data[id].deleted;
    delete this.data[id].autoTrashed;
    this.notify();
  }
  private trashIfLeftover(id: string) {
    const card = this.data[id];
    if (!card || card.deleted || !isShortCard(card)) return;
    if (this.placements().has(id)) return;
    // Its generation stays, so a note that still shows it (Undo, or a
    // notebook not open now) can bring it back instead of being removed.
    this.contentVersion++;
    card.deleted = true;
    card.autoTrashed = true;
  }
  /** A live note shows a card that went to Trash with its last note. */
  private reclaim(card: DeckCard) {
    if (!card.deleted || !card.autoTrashed || card.purged) return;
    this.contentVersion++;
    delete card.deleted;
    delete card.autoTrashed;
  }
  /** Cards waiting in Trash (deleted, not yet emptied). */
  trashed() {
    return Object.values(this.data).filter((card) => card.deleted && !card.purged);
  }
  /** Empty these cards from Trash. A content-free tombstone keeps the ID, so
   * notebooks that still link to the card drop it instead of failing to open. */
  purge(ids: string[]) {
    let count = 0;
    for (const id of ids) {
      const card = this.data[id];
      if (!card?.deleted || card.purged) continue;
      this.data[id] = {
        id,
        nodes: [],
        deleted: true,
        purged: true,
        generation: card.generation,
        createdAt: card.createdAt,
        updatedAt: Date.now(),
      };
      count++;
    }
    if (count) {
      this.contentVersion++;
      this.notify();
    }
    return count;
  }
  delete(id: string) {
    const card = this.data[id];
    if (!card) return;
    this.syncing = true;
    try {
      this.contentVersion++;
      card.deleted = true;
      card.generation = (card.generation ?? 0) + 1;
      for (const doc of this.docs)
        doc.transact(() => {
          for (const [instance, shared] of doc.getMap<string>(
            "knot:card-links",
          ))
            if (shared === id) this.removeInstance(doc, instance);
        });
      this.notify();
    } finally {
      this.syncing = false;
    }
  }
  place(doc: Y.Doc, id: string, create: () => string) {
    const card = this.data[id];
    if (!card || card.deleted) return;
    this.syncing = true;
    try {
      doc.transact(() => {
        const instance = create();
        doc.getMap<string>("knot:card-links").set(instance, id);
        doc
          .getMap<number>("knot:card-generations")
          .set(instance, card.generation ?? 0);
        if (card.media) this.applyMedia(doc, instance, card.nodes);
        else this.replace(doc, instance, card.nodes);
        this.signatures.set(doc.guid + instance, JSON.stringify(card.nodes));
      });
      this.notify();
    } finally {
      this.syncing = false;
    }
  }
  dispose() {
    this.stops.forEach((stop) => stop());
    this.listeners.clear();
  }
}
