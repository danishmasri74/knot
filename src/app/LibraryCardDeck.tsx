import { Mascot } from "./Mascot";
import {
  CardPlacement,
  cardPlacement,
  useCardPlacements,
} from "./CardPlacement";
import { createPortal } from "react-dom";
import type { EditorSession } from "../features/editor/blocksuite/adapter";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  cardMedia,
  cardPreview,
  isMcqCard,
  mediaText,
  type CardDeck,
  type DeckData,
  type DeckCard,
} from "../features/editor/blocksuite/card-deck";
import { repository, type KnowledgeObject } from "../services/workspace";
import { CardDeckPreview } from "./CardDeckPreview";
import { ChoicePopover } from "./ChoicePopover";
import { Destinations } from "./AddNotePicker";
import { ShellIcon } from "./ShellIcon";
import { ShellMenu } from "./ShellMenu";
import { cardIcon, CardThumbnail } from "./CardThumbnail";
import type { MediaKind } from "../features/editor/blocksuite/media-cards";

const types = [
  "All cards",
  "Notes",
  "Multiple choice",
  "Videos",
  "Links",
  "PDFs & files",
  "Images",
];
const typeKinds: Record<string, MediaKind[]> = {
  Videos: ["video"],
  Links: ["link"],
  "PDFs & files": ["pdf", "file"],
  Images: ["image"],
};
function matchesType(card: DeckCard, type: string) {
  const media = cardMedia(card);
  if (type === "All cards") return true;
  if (type === "Multiple choice") return isMcqCard(card);
  if (type === "Notes") return !media && !isMcqCard(card);
  return !!media && (typeKinds[type] ?? []).includes(media.kind);
}

type CreateCardEditor = (
  id: string,
  host: HTMLElement,
) => ReturnType<EditorSession["createCardPageView"]>;

const orders = [
  "Recently edited",
  "Newest first",
  "Oldest first",
  "Name A–Z",
  "Name Z–A",
];
const pageSize = 60;
const titleOf = (card: DeckCard, deck?: DeckData) =>
  cardPreview(card, "", deck)
    .split(/\r?\n/)
    .find((line) => line.trim())
    ?.trim()
    .slice(0, 120) || "Untitled card";

export function LibraryCardDeck({
  deck,
  workspace,
  revision,
  onOpen,
  onPlace,
  onCreateEditor,
  onFlush,
  onComposeMcq,
  cardId,
  onSelect,
  onTrash,
}: {
  cardId?: string;
  /** Moves a card to Trash (restorable from Trash, like the sidebar's Card Deck). */
  onTrash: (id: string) => Promise<void>;
  onSelect?: (id?: string) => Promise<void>;
  onComposeMcq?: (cardId?: string) => void;
  deck?: CardDeck;
  workspace: string;
  revision: number;
  onCreateEditor: CreateCardEditor;
  onFlush: () => Promise<void>;
  onOpen: (id: string) => Promise<boolean>;
  onPlace: (
    id: string,
    notebook?: KnowledgeObject,
    name?: string,
  ) => Promise<void>;
}) {
  const placements = useCardPlacements(deck, workspace, revision);
  const [data, setData] = useState<DeckData>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("All cards");
  const [page, setPage] = useState(0);
  const [localSelected, setLocalSelected] = useState<string>();
  const selected = onSelect ? cardId : localSelected;
  const selectCard = async (id?: string) => {
    if (onSelect) await onSelect(id);
    else setLocalSelected(id);
  };
  const preference = `knot:library-deck-sort:${workspace}`;
  const [sort, setSort] = useState(() => {
    try {
      const saved = localStorage.getItem(preference);
      return saved && orders.includes(saved) ? saved : orders[0];
    } catch {
      return orders[0];
    }
  });
  useEffect(() => {
    let alive = true;
    setError("");
    setData(undefined);
    if (deck) {
      const update = () => setData({ ...deck.data });
      update();
      return deck.subscribe(update);
    }
    repository
      .loadCardDeck()
      .then((value) => {
        if (alive) setData(JSON.parse(value));
      })
      .catch((cause) => {
        if (alive) setError(String(cause));
      });
    return () => {
      alive = false;
    };
  }, [deck, workspace, revision, retry]);
  const cards = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return Object.values(data ?? {})
      .filter((card) => !card.deleted && matchesType(card, type))
      .map((card) => ({ card, title: titleOf(card, data), text: cardPreview(card, undefined, data) }))
      .filter((row) => row.text.toLocaleLowerCase().includes(term))
      .sort((a, b) => {
        if (sort === "Name A–Z" || sort === "Name Z–A")
          return (
            a.title.localeCompare(b.title, undefined, { numeric: true }) *
              (sort === "Name Z–A" ? -1 : 1) ||
            a.card.id.localeCompare(b.card.id)
          );
        const field = sort === "Recently edited" ? "updatedAt" : "createdAt";
        return (
          ((b.card[field] ?? 0) - (a.card[field] ?? 0)) *
            (sort === "Oldest first" ? -1 : 1) ||
          a.card.id.localeCompare(b.card.id)
        );
      });
  }, [data, query, sort, type]);
  const pages = Math.ceil(cards.length / pageSize);
  const current = Math.min(page, Math.max(0, pages - 1));
  const card = selected ? data?.[selected] : undefined;
  if (card && !card.deleted)
    return (
      <CardPage
        deckData={data}
        key={card.id}
        card={card}
        onCreateEditor={onCreateEditor}
        onEditMcq={() => onComposeMcq?.(card.id)}
        onFlush={onFlush}
        onClose={async () => {
          await selectCard(undefined);
          requestAnimationFrame(() =>
            document
              .querySelector<HTMLButtonElement>(
                `[data-library-card-id="${CSS.escape(card.id)}"]`,
              )
              ?.focus(),
          );
        }}
        onOpen={() => onOpen(card.id)}
        onPlace={(notebook, name) => onPlace(card.id, notebook, name)}
        onTrash={async () => {
          await onTrash(card.id);
          await selectCard(undefined);
        }}
      />
    );
  return (
    <section
      className="library-card-deck"
      aria-label="Library Card Deck"
      aria-busy={!data && !error}
    >
      <div className="library-toolbar">
        <label className="library-search">
          <ShellIcon name="search" />
          <input
            aria-label="Search Card Deck"
            placeholder="Search cards…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
        </label>
        <div className="library-view-controls">
          <ChoicePopover label="Card type" value={type} options={types}
            onChange={(value) => { setType(value); setPage(0); }} />
          <ChoicePopover
            label="Sort cards"
            value={sort}
            options={orders}
            onChange={(value) => {
              setSort(value);
              setPage(0);
              try {
                localStorage.setItem(preference, value);
              } catch {
                /* Sorting still works without storage. */
              }
            }}
          />
        </div>
      </div>
      <div className="library-summary" role="status">
        {data
          ? `${cards.length} ${cards.length === 1 ? "card" : "cards"}`
          : error
            ? "Cards unavailable"
            : "Loading cards…"}
        {query && (
          <button
            onClick={() => {
              setQuery("");
              setPage(0);
            }}
          >
            Clear search
          </button>
        )}
      </div>
      {error ? (
        <p role="alert">
          {error}{" "}
          <button onClick={() => setRetry((value) => value + 1)}>Retry</button>
        </p>
      ) : (
        <div className="library-card-grid">
          {!data &&
            Array.from({ length: 8 }, (_, index) => (
              <div
                key={index}
                className="card-deck-card deck-placeholder library-skeleton"
                aria-hidden="true"
              >
                <span />
                <span />
                <span />
                <span />
              </div>
            ))}
          {cards
            .slice(current * pageSize, (current + 1) * pageSize)
            .map(({ card, title }) => (
              <button
                className="library-note-card"
                key={card.id}
                data-library-card-id={card.id}
                data-placement={cardPlacement(placements, card.id).state}
                aria-label={`Edit ${title}`}
                aria-description={cardPlacement(placements, card.id).label}
                onClick={() => {
                  void selectCard(card.id);
                }}
              >
                <CardDeckPreview deck={data} card={card} />
                <span className="library-note-card-footer">
                  <CardPlacement
                    placement={cardPlacement(placements, card.id)}
                  />
                  <span>
                    <ShellIcon name={cardIcon(card)} />
                    {card.updatedAt
                      ? new Date(card.updatedAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })
                      : isMcqCard(card) ? "Multiple choice" : (mediaText(card)?.label ?? "Note card")}
                  </span>
                  <ShellIcon name="expand" />
                </span>
              </button>
            ))}
        </div>
      )}
      {data && !cards.length && (
        <div className="library-empty mascot-empty-state">
          <Mascot mood={query ? "search" : "library"} />
          <p>{query
            ? "No cards match your search."
            : "Your notes, videos, links, files and images appear here as you add them to your notebooks."}</p>
        </div>
      )}
      {pages > 1 && (
        <nav className="library-pagination" aria-label="Card Deck pages">
          <button disabled={!current} onClick={() => setPage(current - 1)}>
            Previous
          </button>
          <span>
            Page {current + 1} of {pages}
          </span>
          <button
            disabled={current + 1 >= pages}
            onClick={() => setPage(current + 1)}
          >
            Next
          </button>
        </nav>
      )}
    </section>
  );
}

function CardPage({
  deckData,
  card,
  onClose,
  onOpen,
  onPlace,
  onCreateEditor,
  onEditMcq,
  onFlush,
  onTrash,
}: {
  card: DeckCard;
  /** Moves the card to Trash and leaves its page. */
  onTrash: () => Promise<void>;
  deckData?: DeckData;
  onEditMcq: () => void;
  onCreateEditor: CreateCardEditor;
  onFlush: () => Promise<void>;
  onClose: () => void | Promise<void>;
  onOpen: () => Promise<boolean>;
  onPlace: (notebook?: KnowledgeObject, name?: string) => Promise<void>;
}) {
  const page = useRef<HTMLElement>(null);
  const toolbar = useRef<HTMLElement>(null);
  const [pending, setPending] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const close = async () => {
    setPending(true);
    try {
      await onFlush();
      await onClose();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setPending(false);
    }
  };
  const place = async (notebook?: KnowledgeObject, name?: string) => {
    setPending(true);
    try {
      await onPlace(notebook, name);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setPending(false);
    }
  };
  useEffect(() => {
    if (choosing)
      page.current
        ?.querySelector<HTMLInputElement>(".library-card-destinations input")
        ?.focus();
  }, [choosing]);
  const back = () => {
    setChoosing(false);
    setMessage("");
    requestAnimationFrame(() =>
      toolbar.current?.querySelector("summary")?.focus(),
    );
  };
  const chromeHost = document.getElementById("library-card-chrome");
  const chrome = (
    <header ref={toolbar} className="card-page-toolbar">
      <nav className="card-page-breadcrumb" aria-label="Card note location">
        {chromeHost && (
          <span className="card-page-separator" aria-hidden="true">
            /
          </span>
        )}
        <button disabled={pending} onClick={() => void close()}>
          Card Deck
        </button>
        <span className="card-page-separator" aria-hidden="true">
          /
        </span>
        <span
          className="card-page-current"
          title={titleOf(card, deckData)}
          aria-current="page"
        >
          <ShellIcon name={cardIcon(card)} /> <span>{titleOf(card, deckData)}</span>
        </span>
      </nav>
      <ShellMenu
        label="Note actions"
        icon={<ShellIcon name="more" />}
        className="card-page-menu"
      >
        <button disabled={pending} onClick={() => setChoosing(true)}>
          <ShellIcon name="plus" /> Add to notebook…
        </button>
        <button
          disabled={pending}
          onClick={async () => {
            setPending(true);
            setError("");
            try {
              // Opening the notebook already leaves the Library; closing the
              // card page here would navigate straight back to the deck.
              if (!(await onOpen())) {
                setMessage("Choose a notebook to add this linked card.");
                setChoosing(true);
              }
            } catch (cause) {
              setError(String(cause));
            } finally {
              setPending(false);
            }
          }}
        >
          <ShellIcon name="notebook" /> Open in notebook
        </button>
        <button
          className="collection-danger"
          disabled={pending}
          onClick={async (event) => {
            event.currentTarget.closest("details")?.removeAttribute("open");
            setPending(true);
            setError("");
            try {
              await onFlush();
              await onTrash();
            } catch (cause) {
              setError(String(cause));
              setPending(false);
            }
          }}
        >
          <ShellIcon name="trash" /> Move to Trash
        </button>
      </ShellMenu>
    </header>
  );
  return (
    <section
      ref={page}
      className="library-card-page"
      aria-label="Card note page"
    >
      {chromeHost ? createPortal(chrome, chromeHost) : chrome}
      <div className="card-page-content" hidden={choosing}>
        {isMcqCard(card) ? (
          <div className="mcq-deck-preview">
            <CardDeckPreview deck={deckData} card={card} expanded />
            <button type="button" onClick={onEditMcq}>Edit or preview question</button>
          </div>
        ) : cardMedia(card) ? (
          <MediaCardView card={card} />
        ) : <CardEditor cardId={card.id} create={onCreateEditor} />}
      </div>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {choosing && (
        <div className="library-card-destinations">
          <button
            className="card-destinations-back"
            disabled={pending}
            onClick={back}
          >
            <ShellIcon name="back" /> Back to editor
          </button>
          <h2>Add to notebook</h2>
          <Destinations
            searchLabel="Notebook"
            busy={pending}
            onChoose={(notebook) => place(notebook)}
            onCreate={(name) => place(undefined, name)}
            close={onClose}
          />
        </div>
      )}
    </section>
  );
}

/** A video, link, file or image card: shown, not edited. Its own canvas
 * toolbar edits it; changes there update the card everywhere. */
function MediaCardView({ card }: { card: DeckCard }) {
  const media = cardMedia(card)!;
  const text = mediaText(card)!;
  const url = String(media.get("prop:url") ?? "");
  const videoId = media.identity?.startsWith("youtube:")
    ? media.identity.slice("youtube:".length)
    : "";
  const description = String(media.get("prop:description") ?? "");
  return (
    <div className="media-card-view" data-kind={media.kind}>
      {videoId ? (
        <div className="media-card-player">
          <iframe
            src={`https://www.youtube.com/embed/${videoId}?rel=0`}
            title={`YouTube video: ${text.title}`}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      ) : (
        <CardThumbnail card={card} />
      )}
      <h2>{text.title}</h2>
      <p className="media-card-detail">{text.detail}</p>
      {description && <p>{description}</p>}
      {url && (
        <a href={url} target="_blank" rel="noreferrer">
          <ShellIcon name="external" /> {url}
        </a>
      )}
      <p className="media-card-hint">
        Use “Open in notebook” to see it on its canvas.
      </p>
    </div>
  );
}

function CardEditor({
  cardId,
  create,
}: {
  cardId: string;
  create: CreateCardEditor;
}) {
  const host = useRef<HTMLDivElement>(null);
  const factory = useRef(create);
  factory.current = create;
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    let view: Awaited<ReturnType<CreateCardEditor>> | undefined;
    void factory
      .current(cardId, host.current!)
      .then((next) => {
        if (!alive) next.dispose();
        else {
          view = next;
          next.focus();
        }
      })
      .catch((cause) => {
        if (alive) setError(String(cause));
      });
    return () => {
      alive = false;
      view?.dispose();
    };
  }, [cardId]);
  return (
    <section
      className="library-card-editor note-page-pane"
      aria-label="Note Page editor"
    >
      {error && <p role="alert">{error}</p>}
      <div className="note-page-host" ref={host} hidden={!!error} />
    </section>
  );
}
