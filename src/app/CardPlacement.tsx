import { useEffect, useState } from "react";
import { cardEmbedReferences, cardQuestionReferences, type CardDeck, type DeckData } from "../features/editor/blocksuite/card-deck";
import {
  liveCardPlacements,
  savedCardPlacements,
} from "../services/topic-card-location";
import { repository, type KnowledgeObject } from "../services/workspace";
import { ShellIcon } from "./ShellIcon";

/** One place a card is used: on a notebook's canvas (`count` copies), or
 * shown inside a note card (`host`) in that notebook. */
export type CardUse = {
  owner: string;
  kind: "canvas" | "note";
  count: number;
  host?: string;
};

export type PlacementIndex = {
  owners: KnowledgeObject[];
  cards: Map<string, Set<string>>;
  /** Where each card is used, notebook by notebook (live notebooks only). */
  uses: Map<string, CardUse[]>;
  /** Cards placed in notebooks that are in Trash. */
  trashed: Set<string>;
  complete: boolean;
};

export function useCardPlacements(
  deck: CardDeck | undefined,
  workspace: string,
  revision = 0,
) {
  const [index, setIndex] = useState<PlacementIndex>();
  useEffect(() => {
    let alive = true;
    let generation = 0;
    let owners: KnowledgeObject[] = [];
    const saved = new Map<string, string[]>();
    const revisions = new Map<string, number>();
    let trashedOwners: string[] = [];
    let complete = false;
    let deckSnapshot: DeckData | undefined;
    const publish = () => {
      if (!alive) return;
      const live = new Map(
        deck?.placementDocuments().map((doc) => [doc.guid, doc]),
      );
      const cards = new Map<string, Set<string>>();
      const data = deck?.data ?? deckSnapshot;
      const usedBy = (ids: string[]) => {
        const used = new Set(ids);
        for (const id of ids) {
          const card = data?.[id];
          if (!data || !card || card.deleted) continue;
          for (const questionId of cardQuestionReferences(card.nodes))
            if (data[questionId] && !data[questionId].deleted) used.add(questionId);
          // Cards shown inside this card are in use wherever it is.
          for (const shown of cardEmbedReferences(card.nodes))
            if (data[shown] && !data[shown].deleted) used.add(shown);
        }
        return used;
      };
      const placed: [string, string[]][] = [];
      for (const owner of owners) {
        const doc = live.get(owner.id);
        const ids = doc
          ? liveCardPlacements(doc).map((id) =>
              doc.getMap<string>("knot:card-links").get(id)!,
            )
          : (saved.get(owner.id) ?? []);
        for (const id of usedBy(ids)) {
          if (!cards.has(id)) cards.set(id, new Set());
          cards.get(id)!.add(owner.id);
        }
        placed.push([owner.id, ids]);
      }
      const uses = collectUses(placed, data);
      const trashed = new Set<string>();
      for (const owner of trashedOwners)
        for (const id of usedBy(saved.get(owner) ?? [])) trashed.add(id);
      setIndex({ owners, cards, uses, trashed, complete });
    };
    const refresh = async () => {
      const run = ++generation;
      complete = false;
      publish();
      try {
        const [catalog, fallback, inTrash] = await Promise.all([
          repository.catalog(),
          deck ? undefined : repository.loadCardDeck().then((raw) => JSON.parse(raw) as DeckData),
          trashedNotebooks(),
        ]);
        const next = new Map<string, string[]>();
        let valid = true;
        const live = new Set(deck?.placementDocuments().map((doc) => doc.guid));
        for (const owner of [...catalog, ...inTrash]) {
          if (!alive || run !== generation) return;
          if (live.has(owner.id)) continue;
          if (
            revisions.get(owner.id) === owner.updated_at &&
            saved.has(owner.id)
          ) {
            next.set(owner.id, saved.get(owner.id)!);
            continue;
          }
          try {
            const snapshot = await repository.load(owner.id);
            next.set(
              owner.id,
              snapshot ? savedCardPlacements(owner.id, snapshot) : [],
            );
          } catch {
            valid = false;
          }
        }
        if (!alive || run !== generation) return;
        owners = catalog;
        trashedOwners = inTrash.map((owner) => owner.id);
        deckSnapshot = fallback;
        saved.clear();
        next.forEach((ids, id) => saved.set(id, ids));
        revisions.clear();
        [...catalog, ...inTrash].forEach((owner) =>
          revisions.set(owner.id, owner.updated_at),
        );
        complete = valid;
        publish();
      } catch {
        if (alive && run === generation) {
          complete = false;
          publish();
        }
      }
    };
    setIndex(undefined);
    void refresh();
    const stop = deck?.subscribe(publish);
    const changed = () => {
      void refresh();
    };
    window.addEventListener("knot-topic-sources-changed", changed);
    return () => {
      alive = false;
      stop?.();
      window.removeEventListener("knot-topic-sources-changed", changed);
    };
  }, [deck, workspace, revision]);
  return index;
}

/** Where each card is used: per notebook, its canvas copies (from the
 * placed card IDs, repeats included) and the notes that show it. */
export function collectUses(
  placed: [owner: string, cardIds: string[]][],
  data: DeckData | undefined,
) {
  const uses = new Map<string, CardUse[]>();
  const use = (id: string, entry: CardUse) => {
    if (!uses.has(id)) uses.set(id, []);
    uses.get(id)!.push(entry);
  };
  for (const [owner, ids] of placed) {
    const counts = new Map<string, number>();
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const [id, count] of counts) {
      use(id, { owner, kind: "canvas", count });
      const card = data?.[id];
      if (!data || !card || card.deleted) continue;
      const shown = new Set([
        ...cardQuestionReferences(card.nodes),
        ...cardEmbedReferences(card.nodes),
      ]);
      for (const other of shown)
        if (other !== id && data[other] && !data[other].deleted)
          use(other, { owner, kind: "note", count: 1, host: id });
    }
  }
  return uses;
}

/** Notebooks in Trash: their cards stay out of the deck until restored. */
async function trashedNotebooks() {
  const rows: { id: string; updated_at: number }[] = [];
  for (let offset = 0; offset < 100000; ) {
    const page = await repository.trash("", offset);
    if (!page.length) break;
    offset += page.length;
    for (const row of page)
      if (row.kind === "note" || row.kind === "whiteboard") rows.push(row);
  }
  return rows;
}

export function cardPlacement(
  index: PlacementIndex | undefined,
  id: string,
  canvas?: string,
) {
  const owners = index?.cards.get(id);
  if (!owners?.size && index?.trashed.has(id))
    return {
      state: "trashed",
      label: "In a notebook in Trash",
      icon: "trash",
    } as const;
  if (canvas && owners?.has(canvas))
    return { state: "here", label: "On this canvas", icon: "check" } as const;
  if (owners?.size) {
    const name =
      index?.owners.find((owner) => owners.has(owner.id))?.title ||
      "Untitled notebook";
    return {
      state: "linked",
      label: owners.size === 1 ? `On ${name}` : `On ${owners.size} canvases`,
      icon: "link",
    } as const;
  }
  return index?.complete
    ? ({ state: "unplaced", label: "Unplaced", icon: "circle" } as const)
    : ({
        state: "unknown",
        label: "Checking placement…",
        icon: "circle",
      } as const);
}

export function CardPlacement({
  placement,
}: {
  placement: ReturnType<typeof cardPlacement>;
}) {
  return (
    <span className="card-placement" title={placement.label}>
      <ShellIcon name={placement.icon} />
      <span>{placement.label}</span>
    </span>
  );
}
