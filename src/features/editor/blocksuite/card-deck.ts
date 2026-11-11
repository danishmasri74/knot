import * as Y from "yjs";
import { mcqText, readMcq, type McqDefinition } from "../../quiz/mcq";

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
  generation?: number;
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

export function cardPreview(card: DeckCard, fallback = "Empty card", deck?: DeckData): string {
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
    for (const [instance, shared] of doc.getMap<string>("knot:card-links"))
      if (doc.getMap("blocks").has(instance)) ids.add(shared);
    for (const block of doc.getMap<Y.Map<unknown>>("blocks").values()) {
      if (block.get("sys:flavour") !== mcqReferenceFlavour) continue;
      const id = block.get("prop:cardId");
      if (typeof id === "string" && resolveDeckMcq(this.data, id)) ids.add(id);
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
  private scan(doc: Y.Doc, origin: unknown) {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const links = doc.getMap<string>("knot:card-links");
      for (const [id, block] of doc.getMap<Y.Map<unknown>>("blocks")) {
        if (block.get("sys:flavour") !== "affine:note") continue;
        let cardId = links.get(id);
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
        };
        this.signatures.set(doc.guid + id, signature);
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
      for (const id of links.keys()) {
        if (!doc.getMap("blocks").has(id))
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
  restore(id: string) {
    if (!this.data[id]?.deleted) return;
    this.contentVersion++;
    delete this.data[id].deleted;
    this.notify();
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
        this.replace(doc, instance, card.nodes);
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
