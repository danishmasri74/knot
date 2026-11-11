import type { useSidebarDrag } from "./useSidebarDrag";
import { Mascot } from "./Mascot";
import { ChoicePopover } from "./ChoicePopover";
import { Fragment, useEffect, useState, useRef, type ReactNode } from "react";
import {
  libraryPage,
  type LibraryRow,
  type Catalog,
  type KnowledgeObject,
} from "../services/workspace";
import { ShellIcon } from "./ShellIcon";
import { AnimatedFavorite } from "./AnimatedFavorite";
import {
  CollectionMembership,
  CreateCollection,
  CollectionList,
} from "./Collections";
import { Popover } from "./Collections";
import { NewNotebook } from "./NewNotebook";
export type LibraryLocation = {
  id: string;
  library: "notebooks" | "collections" | "cardDeck";
  collection?: string;
  cardId?: string;
};
export function dateGroup(value: number | null, now = new Date()) {
  if (value === null) return "Creation date unknown";
  const date = new Date(value),
    today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const week = new Date(today);
  week.setDate(today.getDate() - 7);
  if (date >= today) return "Today";
  if (date >= yesterday) return "Yesterday";
  if (date >= week) return "Previous 7 days";
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}
const preferences = new Map<
  string,
  {
    query: string;
    created: boolean;
    filter: string;
    alpha: boolean;
    page: number;
    scroll: number;
  }
>();
export function LibraryPage({
  preferenceKey,
  location,
  catalog,
  busy,
  run,
  onChanged,
  onOpen,
  onNavigate,
  onCreate,
  onFavorite,
  revision,
  sidebarDrag,
  pinned,
  onTogglePin,
  cardDeck,
}: {
  pinned: string[];
  onTogglePin: (id: string) => void;
  cardDeck?: ReactNode;
  preferenceKey: string;
  location: LibraryLocation;
  catalog: Catalog;
  busy: boolean;
  run: (task: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
  onOpen: (item: KnowledgeObject) => void;
  onNavigate: (location: LibraryLocation) => void;
  onCreate: (name: string) => Promise<void>;
  onFavorite: (id: string) => void;
  revision: number;
  sidebarDrag: ReturnType<typeof useSidebarDrag>;
}) {
  const saved = preferences.get(preferenceKey);
  const root = useRef<HTMLElement>(null);
  const [query, setQuery] = useState(saved?.query ?? "");
  const [created, setCreated] = useState(saved?.created ?? false);
  const [filter, setFilter] = useState(saved?.filter ?? "all");
  const [alpha, setAlpha] = useState(saved?.alpha ?? false);
  const [layout, setLayout] = useState<"list" | "grid">(() => {
    try {
      return localStorage.getItem("knot.library.layout") === "grid"
        ? "grid"
        : "list";
    } catch {
      return "list";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("knot.library.layout", layout);
    } catch {
      // Layout switching still works when browser storage is unavailable.
    }
  }, [layout]);
  const [page, setPage] = useState(saved?.page ?? 0);
  const [result, setResult] = useState<{
    rows: LibraryRow[];
    total: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const scroll = useRef(saved?.scroll ?? 0);
  useEffect(() => {
    preferences.set(preferenceKey, {
      query,
      created,
      filter,
      alpha,
      page,
      scroll: scroll.current,
    });
  }, [preferenceKey, query, created, filter, alpha, page]);
  useEffect(() => {
    if (root.current) root.current.scrollTop = scroll.current;
  }, [result]);
  const directory =
    location.library === "collections" && location.collection === undefined;
  const cards = location.library === "cardDeck";
  const collection =
    location.collection !== undefined
      ? location.collection
      : filter === "all"
        ? null
        : filter;
  const current = catalog.collections.find((c) => c.id === location.collection);
  const title = directory
    ? "Library"
    : location.library === "notebooks" || cards
      ? "Library"
      : location.collection === ""
        ? "Uncollected"
        : (current?.name ?? "Collection unavailable");
  useEffect(() => {
    if (directory || cards) return;
    let alive = true;
    setResult(null);
    setError("");
    const timer = setTimeout(() => {
      libraryPage(query, collection, created, page * 100)
        .then((r) => {
          if (alive) setResult(r);
        })
        .catch((e) => {
          if (alive) setError(String(e));
        });
    }, 150);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [
    query,
    collection,
    created,
    page,
    directory,
    cards,
    revision,
    retry,
    catalog.collections,
  ]);
  const entries = catalog.collections.filter((c) =>
    c.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  if (alpha) entries.sort((a, b) => a.name.localeCompare(b.name));
  const shared = { catalog, busy, run, onChanged, pinned, onTogglePin };
  let previous = "";
  return (
    <section
      ref={root}
      onScroll={(e) => {
        scroll.current = e.currentTarget.scrollTop;
        const current = preferences.get(preferenceKey);
        if (current) current.scroll = scroll.current;
      }}
      className="library-page"
      aria-label={title}
    >
      <div className="library-page-heading">
        <div>
          <h1>{title}</h1>
          <p>
            {location.collection === undefined
              ? "Browse and organize your notebooks, collections, and note cards."
              : location.collection === ""
                ? "Notebooks that haven’t been added to a collection."
                : "Notebooks in this collection."}
          </p>
        </div>
        {cards ? null : directory ? (
          <CreateCollection {...shared} labeled />
        ) : (
          <NewNotebook busy={busy} run={run} onCreate={onCreate} />
        )}
      </div>
      <nav className="library-tabs" aria-label="Library views">
        {(["notebooks", "collections", "cardDeck"] as const).map((kind) => (
          <button
            key={kind}
            aria-current={location.library === kind ? "page" : undefined}
            onClick={() => onNavigate({ id: `library:${kind}`, library: kind })}
          >
            <ShellIcon
              name={
                kind === "notebooks"
                  ? "notebook"
                  : kind === "collections"
                    ? "folder"
                    : "cardDeck"
              }
            />
            {kind === "notebooks"
              ? "Notebooks"
              : kind === "collections"
                ? "Collections"
                : "Card Deck"}
          </button>
        ))}
      </nav>
      {cards ? (
        cardDeck
      ) : (
        <>
          <div className="library-toolbar">
            <label className="library-search">
              <ShellIcon name="search" />
              <input
                aria-label={
                  directory ? "Search collections" : "Search notebooks"
                }
                placeholder={
                  directory ? "Search collections…" : "Search notebooks…"
                }
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
              />
            </label>
            <div className="library-view-controls">
              <div
                className="library-sort-group"
                role="group"
                aria-label="Library layout"
              >
                {(["list", "grid"] as const).map((view) => (
                  <button
                    key={view}
                    aria-label={view === "list" ? "List view" : "Grid view"}
                    data-tooltip={view === "list" ? "List view" : "Grid view"}
                    aria-pressed={layout === view}
                    onClick={() => setLayout(view)}
                  >
                    <ShellIcon name={view} />
                  </button>
                ))}
              </div>
              <ChoicePopover
                label={directory ? "Sort collections" : "Sort notebooks"}
                options={
                  directory
                    ? ["Sidebar order", "Name (A–Z)"]
                    : ["Last updated", "Date created"]
                }
                value={
                  directory
                    ? alpha
                      ? "Name (A–Z)"
                      : "Sidebar order"
                    : created
                      ? "Date created"
                      : "Last updated"
                }
                onChange={(value) => {
                  if (directory) setAlpha(value === "Name (A–Z)");
                  else setCreated(value === "Date created");
                  setPage(0);
                }}
              />
              {!directory && location.library === "notebooks" && (
                <Popover
                  label="Filter by collection"
                  className={`library-filter-button${filter !== "all" ? " is-active" : ""}`}
                  trigger={
                    <>
                      <ShellIcon name="folder" />
                      <span>
                        {filter === "all"
                          ? "All collections"
                          : filter === ""
                            ? "Uncollected"
                            : (catalog.collections.find((c) => c.id === filter)
                                ?.name ?? "Collection unavailable")}
                      </span>
                      <ShellIcon name="chevron" />
                    </>
                  }
                >
                  {(close) => (
                    <div
                      className="library-filter-options"
                      role="group"
                      aria-label="Collection filter"
                    >
                      {[
                        { id: "all", name: "All collections" },
                        { id: "", name: "Uncollected" },
                        ...catalog.collections,
                      ].map((option) => (
                        <button
                          key={option.id}
                          aria-pressed={filter === option.id}
                          onClick={() => {
                            setFilter(option.id);
                            setPage(0);
                            close();
                          }}
                        >
                          <span>{option.name}</span>
                          {filter === option.id && <ShellIcon name="check" />}
                        </button>
                      ))}
                    </div>
                  )}
                </Popover>
              )}
            </div>
          </div>
          <div className="library-summary" role="status">
            {directory
              ? `${entries.length} ${entries.length === 1 ? "collection" : "collections"}`
              : result
                ? `${result.total} ${result.total === 1 ? "notebook" : "notebooks"}`
                : "Loading notebooks…"}
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
          {directory ? (
            <>
              <div
                className={`library-list${layout === "grid" ? " library-grid" : ""}`}
              >
                {entries.slice(page * 100, (page + 1) * 100).map((c) => (
                  <div
                    className="library-row"
                    key={c.id}
                    {...sidebarDrag.start({ kind: "collection", id: c.id })}
                  >
                    <button
                      className="library-row-open"
                      onClick={() =>
                        onNavigate({
                          id: `library:collection:${c.id}`,
                          library: "collections",
                          collection: c.id,
                        })
                      }
                    >
                      <ShellIcon name="folder" />
                      <span>{c.name}</span>
                      <small>{c.notebooks.length} notebooks</small>
                      <ShellIcon name="chevron" />
                    </button>
                    <Popover
                      label={`Options for ${c.name}`}
                      trigger={<ShellIcon name="more" />}
                    >
                      {(close) => (
                        <CollectionList
                          {...shared}
                          selected={c.id}
                          onSelect={close}
                        />
                      )}
                    </Popover>
                  </div>
                ))}
                {(!query || "uncollected".includes(query.toLowerCase())) && (
                  <div className="library-row">
                    <button
                      className="library-row-open"
                      onClick={() =>
                        onNavigate({
                          id: "library:uncollected",
                          library: "collections",
                          collection: "",
                        })
                      }
                    >
                      <ShellIcon name="folder" />
                      <span>
                        Uncollected
                        <small>Notebooks outside your collections</small>
                      </span>
                      <ShellIcon name="chevron" />
                    </button>
                  </div>
                )}
              </div>
              {!entries.length &&
                query &&
                !"uncollected".includes(query.toLowerCase()) && (
                  <div className="library-empty mascot-empty-state">
                    <Mascot mood="search" />
                    <p>No collections match your search.</p>
                  </div>
                )}
            </>
          ) : (
            <>
              {error ? (
                <p role="alert">
                  {error}{" "}
                  <button onClick={() => setRetry((v) => v + 1)}>Retry</button>
                </p>
              ) : !result ? (
                <div
                  className="library-skeleton"
                  role="status"
                  aria-label="Loading notebooks"
                >
                  <div aria-hidden="true">
                    <div className="library-skeleton-group library-skeleton-block" />
                    {Array.from({ length: 6 }, (_, index) => (
                      <div
                        className="library-row library-skeleton-row"
                        key={index}
                      >
                        <span className="library-skeleton-icon library-skeleton-block" />
                        <div className="library-skeleton-copy">
                          <span
                            className="library-skeleton-title library-skeleton-block"
                            style={{
                              width: `${[42, 58, 35, 49, 63, 40][index]}%`,
                            }}
                          />
                          <span className="library-skeleton-subtitle library-skeleton-block" />
                        </div>
                        <span className="library-skeleton-date library-skeleton-block" />
                        <span className="library-skeleton-action library-skeleton-block" />
                        <span className="library-skeleton-action library-skeleton-block" />
                      </div>
                    ))}
                  </div>
                </div>
              ) : !result.rows.length ? (
                <div className="library-empty mascot-empty-state">
                  <Mascot mood={query ? "search" : "library"} />
                  <p>{query
                    ? "No notebooks match your search."
                    : "No notebooks here yet."}</p>
                </div>
              ) : (
                <div
                  className={`library-list${layout === "grid" ? " library-grid" : ""}`}
                >
                  {result.rows.map((row) => {
                    const value = created ? row.created_at : row.updated_at;
                    const group = dateGroup(value);
                    const heading = group !== previous;
                    previous = group;
                    const memberships = catalog.collections.filter((c) =>
                      c.notebooks.includes(row.id),
                    );
                    return (
                      <Fragment key={row.id}>
                        {heading && (
                          <h2 className="library-date-group">{group}</h2>
                        )}
                        <div
                          className="library-row"
                          {...sidebarDrag.start({
                            kind: "notebook",
                            item: row,
                            source: location.collection || null,
                          })}
                        >
                          <button
                            className="library-row-open"
                            disabled={busy}
                            onClick={() => onOpen(row)}
                          >
                            <ShellIcon name="notebook" />
                            <span className="library-row-title">
                              <span>{row.title || "Untitled notebook"}</span>
                              <small
                                title={memberships
                                  .map((c) => c.name)
                                  .join(", ")}
                              >
                                {memberships
                                  .slice(0, 2)
                                  .map((c) => c.name)
                                  .join(" · ") || "Uncollected"}
                                {memberships.length > 2
                                  ? ` +${memberships.length - 2}`
                                  : ""}
                              </small>
                            </span>
                            <time
                              title={
                                value
                                  ? new Date(value).toLocaleString()
                                  : undefined
                              }
                            >
                              {value
                                ? new Date(value).toLocaleDateString()
                                : "Unknown"}
                            </time>
                          </button>
                          <button
                            className="library-favorite"
                            disabled={busy}
                            aria-label={`Favorite ${row.title}`}
                            aria-pressed={catalog.favorites.includes(row.id)}
                            onClick={() => onFavorite(row.id)}
                          >
                            <AnimatedFavorite
                              favorite={catalog.favorites.includes(row.id)}
                            />
                          </button>
                          <CollectionMembership
                            {...shared}
                            object={row.id}
                            title={row.title}
                          />
                        </div>
                      </Fragment>
                    );
                  })}
                </div>
              )}
            </>
          )}
          {((directory ? entries.length : (result?.total ?? 0)) > 100 ||
            page > 0) && (
            <nav className="library-pagination" aria-label="Library pages">
              <button
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              <span>Page {page + 1}</span>
              <button
                disabled={
                  (page + 1) * 100 >=
                  (directory ? entries.length : (result?.total ?? 0))
                }
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
