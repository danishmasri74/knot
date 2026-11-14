import {
  CardPlacement,
  cardPlacement,
  useCardPlacements,
} from "./CardPlacement";
import { repository } from "../services/workspace";
import { ChoicePopover } from "./ChoicePopover";
import { CardDeckPreview } from "./CardDeckPreview";
import { openCardMenu } from "../features/editor/blocksuite/card-menu";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CardDeck,
  cardPreview,
  isBlankCard,
  type DeckCard,
} from "../features/editor/blocksuite/card-deck";
import { cardIcon } from "./CardThumbnail";
import { ShellIcon } from "./ShellIcon";
const orders = [
  "Newest first",
  "Oldest first",
  "Recently edited",
  "Name A–Z",
  "Name Z–A",
];
const filters = [
  "All cards",
  "On this canvas",
  "Not on this canvas",
  "Not on any canvas",
];
const pageSize = 40;
type Preview = {
  id: string;
  source: DeckCard;
  name: string;
  searchable: string;
};
const previews = new WeakMap<DeckCard, Preview>();

export function CardDeckPanel({
  deck,
  onPlace,
  canvas,
  workspace,
  source,
}: {
  deck?: CardDeck;
  canvas?: string;
  workspace?: string;
  source?: { id: string; text: string };
  onPlace: (id: string) => Promise<void>;
}) {
  const placements = useCardPlacements(deck, workspace ?? "");
  const [sourcePreview, setSourcePreview] = useState<{
    card: DeckCard;
    text: string;
  }>();
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!source) {
        setSourcePreview(undefined);
        return;
      }
      const card =
        deck?.data[source.id] ??
        JSON.parse(await repository.loadCardDeck())[source.id];
      if (!cancelled)
        setSourcePreview(
          card && !card.deleted && cardPreview(card, undefined, deck?.data).includes(source.text)
            ? { card, text: source.text }
            : undefined,
        );
    };
    void load();
    const stop = deck?.subscribe(() => void load());
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [deck, source]);
  const [index, setIndex] = useState<{ deck: CardDeck; rows: Preview[] }>();
  const [page, setPage] = useState(0);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!deck) return;
    let timer: ReturnType<typeof setTimeout>;
    const rebuild = () => {
      clearTimeout(timer);
      const cards = Object.values(deck.data);
      const rows: Preview[] = [];
      let offset = 0;
      const batch = () => {
        const end = Math.min(offset + 100, cards.length);
        while (offset < end) {
          const card = cards[offset++];
          // Nothing to reuse in a blank card; it appears once it has content.
          if (card.deleted || isBlankCard(card)) continue;
          let preview = previews.get(card);
          if (!preview) {
            const text = cardPreview(card, undefined, deck?.data);
            preview = {
              id: card.id,
              source: card,
              name: cardPreview(card, "", deck?.data).split(/\r?\n/)[0].trim(),
              searchable: text.toLowerCase(),
            };
            previews.set(card, preview);
          }
          rows.push(preview);
        }
        if (offset < cards.length) timer = setTimeout(batch, 0);
        else setIndex({ deck, rows });
      };
      timer = setTimeout(batch, 0);
    };
    rebuild();
    const stop = deck.subscribe(rebuild);
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [deck]);
  const preference = "knot:deck-sort:" + workspace;
  const [sort, setSort] = useState(() => {
    const saved = localStorage.getItem(preference);
    return saved && orders.includes(saved) ? saved : orders[0];
  });
  const [filter, setFilter] = useState(filters[0]);
  const [query, setQuery] = useState("");
  const menu = useRef<() => void>(() => {});
  useEffect(() => () => menu.current(), [deck]);
  const showMenu = (
    id: string,
    x: number,
    y: number,
    trigger?: HTMLElement,
  ) => {
    menu.current();
    menu.current = openCardMenu(
      x,
      y,
      [
        { label: "Add to canvas", run: () => void onPlace(id) },
        { label: "Move to Trash", trash: true, run: () => deck?.delete(id) },
      ],
      trigger,
    );
  };
  const loading = !deck || index?.deck !== deck;
  const cards = useMemo(() => {
    const term = query.toLowerCase();
    const rows =
      index?.rows.filter((card) => {
        if (!card.searchable.includes(term)) return false;
        const state = cardPlacement(placements, card.id, canvas).state;
        return (
          filter === filters[0] ||
          (filter === filters[1] && state === "here") ||
          (filter === filters[2] && state !== "here" && state !== "unknown") ||
          (filter === filters[3] && state === "unplaced")
        );
      }) ?? [];
    return rows.sort((a, b) => {
      if (sort === orders[3] || sort === orders[4]) {
        return (
          Number(!a.name) - Number(!b.name) ||
          a.name.localeCompare(b.name, undefined, { numeric: true }) *
            (sort === orders[3] ? 1 : -1)
        );
      }
      const field = sort === orders[2] ? "updatedAt" : "createdAt";
      return (
        ((b.source[field] ?? 0) - (a.source[field] ?? 0)) *
        (sort === orders[1] ? -1 : 1)
      );
    });
  }, [index, query, sort, filter, placements, canvas]);
  const pages = Math.ceil(cards.length / pageSize);
  const current = Math.min(page, Math.max(0, pages - 1));
  const changePage = (next: number) => {
    setPage(next);
    panel.current?.scrollTo(0, 0);
  };
  return (
    <section
      ref={panel}
      aria-busy={loading}
      className="card-deck-panel"
      aria-label="Card Deck"
    >
      <div className="deck-tools">
        <label className="panel-search">
          <ShellIcon name="search" />
          <input
            aria-label="Search Card Deck"
            placeholder="Search cards…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              changePage(0);
            }}
          />
        </label>
        <ChoicePopover
          label="Sort cards"
          icon="sortAlpha"
          value={sort}
          options={orders}
          onChange={(value) => {
            setSort(value);
            localStorage.setItem(preference, value);
            changePage(0);
          }}
        />
        <ChoicePopover
          label="Filter cards"
          icon="filter"
          value={filter}
          options={filters}
          onChange={(value) => {
            setFilter(value);
            changePage(0);
          }}
        />
      </div>
      {filter !== filters[0] && (
        <button
          aria-label={"Clear filter: " + filter}
          onClick={() => {
            setFilter(filters[0]);
            changePage(0);
          }}
        >
          {filter} ×
        </button>
      )}
      {!loading && pages > 1 && (
        <nav className="deck-pagination" aria-label="Card Deck pages">
          <button disabled={!current} onClick={() => changePage(current - 1)}>
            Previous
          </button>
          <span aria-live="polite">
            {current + 1} of {pages}
          </span>
          <button
            disabled={current + 1 >= pages}
            onClick={() => changePage(current + 1)}
          >
            Next
          </button>
        </nav>
      )}
      {sourcePreview && (
        <div className="card-deck-card" aria-label="Cited Card Deck item">
          <button
            aria-label="Close cited card"
            onClick={() => setSourcePreview(undefined)}
          >
            Close
          </button>
          <blockquote>{sourcePreview.text}</blockquote>
          <CardDeckPreview deck={deck?.data} deckVersion={deck?.contentVersion} card={sourcePreview.card} />
        </div>
      )}
      <div className="card-deck-grid">
        {loading &&
          Array.from({ length: 4 }, (_, i) => (
            <div
              key={i}
              aria-hidden="true"
              className="card-deck-card deck-placeholder library-skeleton"
            >
              <span />
              <span />
              <span />
              <span />
            </div>
          ))}
        {!loading &&
          cards
            .slice(current * pageSize, (current + 1) * pageSize)
            .map((card) => (
              <article
                key={card.id}
                className="card-deck-card"
                data-placement={
                  cardPlacement(placements, card.id, canvas).state
                }
                aria-label={`${card.name || "Untitled card"}. ${cardPlacement(placements, card.id, canvas).label}`}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData(
                    "application/x-knot-card",
                    card.id,
                  );
                  event.dataTransfer.effectAllowed = "copy";
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  showMenu(card.id, event.clientX, event.clientY);
                }}
              >
                <ShellIcon name={cardIcon(card.source)} />
                <button
                  className="card-deck-trigger"
                  aria-label="Card actions"
                  aria-haspopup="menu"
                  aria-expanded="false"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    const trigger = event.currentTarget;
                    if (trigger.getAttribute("aria-expanded") === "true")
                      return menu.current();
                    const rect = trigger.getBoundingClientRect();
                    showMenu(card.id, rect.left, rect.bottom, trigger);
                  }}
                >
                  <ShellIcon name="more" />
                </button>
                <CardDeckPreview deck={deck?.data} deckVersion={deck?.contentVersion} card={card.source} />
                <CardPlacement
                  placement={cardPlacement(placements, card.id, canvas)}
                />
              </article>
            ))}
      </div>
      {!loading && !cards.length && (
        <p>
          {query || filter !== filters[0]
            ? "No matching cards."
            : "Your notes, videos, links, files and images appear here. Plain text stays on its whiteboard."}
        </p>
      )}
    </section>
  );
}
