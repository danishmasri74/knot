import { useEffect, useState } from "react";
import { cardQuestionReferences, type CardDeck, type DeckData } from "../features/editor/blocksuite/card-deck";
import {
  liveCardPlacements,
  savedCardPlacements,
} from "../services/topic-card-location";
import { repository, type KnowledgeObject } from "../services/workspace";
import { ShellIcon } from "./ShellIcon";

export type PlacementIndex = {
  owners: KnowledgeObject[];
  cards: Map<string, Set<string>>;
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
    let complete = false;
    let deckSnapshot: DeckData | undefined;
    const publish = () => {
      if (!alive) return;
      const live = new Map(
        deck?.placementDocuments().map((doc) => [doc.guid, doc]),
      );
      const cards = new Map<string, Set<string>>();
      const data = deck?.data ?? deckSnapshot;
      for (const owner of owners) {
        const doc = live.get(owner.id);
        const ids = doc
          ? liveCardPlacements(doc).map((id) =>
              doc.getMap<string>("knot:card-links").get(id)!,
            )
          : (saved.get(owner.id) ?? []);
        const used = new Set(ids);
        for (const id of ids) {
          const card = data?.[id];
          if (!data || !card || card.deleted) continue;
          for (const questionId of cardQuestionReferences(card.nodes))
            if (data[questionId] && !data[questionId].deleted) used.add(questionId);
        }
        for (const id of used) {
          if (!cards.has(id)) cards.set(id, new Set());
          cards.get(id)!.add(owner.id);
        }
      }
      setIndex({ owners, cards, complete });
    };
    const refresh = async () => {
      const run = ++generation;
      complete = false;
      publish();
      try {
        const [catalog, fallback] = await Promise.all([
          repository.catalog(),
          deck ? undefined : repository.loadCardDeck().then((raw) => JSON.parse(raw) as DeckData),
        ]);
        const next = new Map<string, string[]>();
        let valid = true;
        const live = new Set(deck?.placementDocuments().map((doc) => doc.guid));
        for (const owner of catalog) {
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
        deckSnapshot = fallback;
        saved.clear();
        next.forEach((ids, id) => saved.set(id, ids));
        revisions.clear();
        catalog.forEach((owner) => revisions.set(owner.id, owner.updated_at));
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

export function cardPlacement(
  index: PlacementIndex | undefined,
  id: string,
  canvas?: string,
) {
  const owners = index?.cards.get(id);
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
