import {
  cardPlacement,
  useCardPlacements,
} from "./CardPlacement";
import { repository } from "../services/workspace";
import { Popover } from "./Collections";
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
import { PlacementMenu, type OpenCardUse } from "./CardUses";
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
/** Card types the filter offers, by the card's object icon. */
const types = [
  { label: "Notes", icons: ["note"] },
  { label: "Files", icons: ["pdf", "wordDocument", "slides", "attach"] },
  { label: "Images and video", icons: ["image", "video"] },
  { label: "Links", icons: ["link"] },
  { label: "Quizzes", icons: ["multipleChoice"] },
] as const;
type TypeLabel = (typeof types)[number]["label"];
function cardType(card: DeckCard): TypeLabel {
  const icon: string = cardIcon(card);
  return (
    types.find((type) => (type.icons as readonly string[]).includes(icon))
      ?.label ?? "Notes"
  );
}
type Placement = ReturnType<typeof cardPlacement>["state"];
function matchesPlacement(filter: string, state: Placement) {
  return (
    filter === filters[0] ||
    (filter === filters[1] && state === "here") ||
    (filter === filters[2] && state !== "here" && state !== "unknown") ||
    (filter === filters[3] && state === "unplaced")
  );
}
/** The placement colour a filter choice shows, if it has one. */
function placementState(option: string) {
  return option === filters[1]
    ? "here"
    : option === filters[3]
      ? "unplaced"
      : option === filters[2]
        ? "linked"
        : undefined;
}
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
  onOpenUse,
}: {
  /** Opens a notebook at one place the card is used. */
  onOpenUse?: OpenCardUse;
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
  const [typeFilter, setTypeFilter] = useState<ReadonlySet<TypeLabel>>(
    new Set(),
  );
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
  // Search first, then count each placement and type among the matches so
  // the filter menu shows what each choice would leave.
  const searched = useMemo(() => {
    const term = query.toLowerCase();
    return (
      index?.rows.flatMap((card) => {
        if (!card.searchable.includes(term)) return [];
        const state = cardPlacement(placements, card.id, canvas).state;
        // Its notebook is in Trash: back in the deck when it's restored.
        if (state === "trashed") return [];
        return [{ card, state, type: cardType(card.source) }];
      }) ?? []
    );
  }, [index, query, placements, canvas]);
  const counts = useMemo(() => {
    const placement = new Map<string, number>();
    const type = new Map<TypeLabel, number>();
    for (const row of searched) {
      if (!typeFilter.size || typeFilter.has(row.type))
        for (const option of filters)
          if (matchesPlacement(option, row.state))
            placement.set(option, (placement.get(option) ?? 0) + 1);
      if (matchesPlacement(filter, row.state))
        type.set(row.type, (type.get(row.type) ?? 0) + 1);
    }
    return { placement, type };
  }, [searched, filter, typeFilter]);
  const cards = useMemo(() => {
    const rows = searched
      .filter(
        (row) =>
          matchesPlacement(filter, row.state) &&
          (!typeFilter.size || typeFilter.has(row.type)),
      )
      .map((row) => row.card);
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
  }, [searched, sort, filter, typeFilter]);
  const placementOptions = canvas
    ? filters
    : filters.filter((option) => option !== filters[1] && option !== filters[2]);
  const activeFilters = (filter !== filters[0] ? 1 : 0) + typeFilter.size;
  const pages = Math.ceil(cards.length / pageSize);
  const current = Math.min(page, Math.max(0, pages - 1));
  const changePage = (next: number) => {
    setPage(next);
    panel.current?.scrollTo(0, 0);
  };
  const toggleType = (label: TypeLabel) => {
    const next = new Set(typeFilter);
    if (next.has(label)) next.delete(label);
    else next.add(label);
    setTypeFilter(next);
    changePage(0);
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
        <Popover
          label={
            activeFilters
              ? `Filter and sort, ${activeFilters} ${activeFilters === 1 ? "filter" : "filters"} on`
              : "Filter and sort"
          }
          className="deck-tool-button"
          trigger={
            <>
              <ShellIcon name="filter" />
              {activeFilters > 0 && (
                <span className="deck-filter-badge" aria-hidden="true">
                  {activeFilters}
                </span>
              )}
            </>
          }
        >
          {() => (
            <div className="deck-filter-menu">
              <div className="placement-menu-heading">Placement</div>
              <div
                role="group"
                aria-label="Placement"
                className="library-filter-options"
              >
                {placementOptions.map((option) => (
                  <button
                    key={option}
                    aria-pressed={option === filter}
                    data-placement={placementState(option)}
                    onClick={() => {
                      setFilter(option);
                      changePage(0);
                    }}
                  >
                    <span className="deck-filter-dot" aria-hidden="true" />
                    <span className="deck-filter-label">{option}</span>
                    <span className="deck-filter-count">
                      {counts.placement.get(option) ?? 0}
                    </span>
                    <ShellIcon name="check" />
                  </button>
                ))}
              </div>
              <div className="placement-menu-separator" role="separator" />
              <div className="placement-menu-heading">Type</div>
              <div
                role="group"
                aria-label="Type"
                className="library-filter-options"
              >
                {types.map(({ label }) => (
                  <button
                    key={label}
                    aria-pressed={typeFilter.has(label)}
                    onClick={() => toggleType(label)}
                  >
                    <span className="deck-filter-label">{label}</span>
                    <span className="deck-filter-count">
                      {counts.type.get(label) ?? 0}
                    </span>
                    <ShellIcon name="check" />
                  </button>
                ))}
              </div>
              <div className="placement-menu-separator" role="separator" />
              <div className="placement-menu-heading">Sort</div>
              <div
                role="group"
                aria-label="Sort cards"
                className="library-filter-options"
              >
                {orders.map((option) => (
                  <button
                    key={option}
                    aria-pressed={option === sort}
                    onClick={() => {
                      setSort(option);
                      localStorage.setItem(preference, option);
                      changePage(0);
                    }}
                  >
                    <span className="deck-filter-label">{option}</span>
                    <ShellIcon name="check" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </Popover>
      </div>
      {activeFilters > 0 && (
        <div className="deck-active-filters">
          {filter !== filters[0] && (
            <button
              data-placement={placementState(filter)}
              aria-label={"Clear filter: " + filter}
              onClick={() => {
                setFilter(filters[0]);
                changePage(0);
              }}
            >
              <span className="deck-filter-dot" aria-hidden="true" />
              {filter}
              <ShellIcon name="close" size={12} />
            </button>
          )}
          {[...typeFilter].map((label) => (
            <button
              key={label}
              aria-label={"Clear filter: " + label}
              onClick={() => toggleType(label)}
            >
              {label}
              <ShellIcon name="close" size={12} />
            </button>
          ))}
          <span className="deck-filter-total">
            {cards.length} of {searched.length}
          </span>
        </div>
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
                <div className="card-deck-footer">
                  <PlacementMenu
                    index={placements}
                    cardId={card.id}
                    deck={deck?.data}
                    canvas={canvas}
                    onOpen={onOpenUse}
                  />
                  {canvas &&
                    ["linked", "unplaced"].includes(
                      cardPlacement(placements, card.id, canvas).state,
                    ) && (
                      <button
                        className="card-deck-add"
                        aria-label={`Add ${card.name || "card"} to canvas`}
                        data-tooltip="Add to canvas"
                        onClick={() => void onPlace(card.id)}
                      >
                        <ShellIcon name="plus" size={12} />
                        Add
                      </button>
                    )}
                </div>
              </article>
            ))}
      </div>
      {!loading && !cards.length && (
        <p>
          {query || activeFilters
            ? "No matching cards."
            : "Your notes, videos, links, files and images appear here. Plain text stays on its whiteboard."}
        </p>
      )}
    </section>
  );
}
