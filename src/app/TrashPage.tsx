import { useEffect, useState } from "react";
import { CardDeck, cardPreview } from "../features/editor/blocksuite/card-deck";
import type { ReactNode } from "react";
import type { TrashedObject } from "../services/workspace";
import { ShellIcon } from "./ShellIcon";

export function TrashPage({
  deck,
  items,
  query,
  searched,
  busy,
  more,
  onQuery,
  onRestore,
  onDelete,
  onEmpty,
  onMore,
  onHealth,
  onBackups,
  children,
}: {
  deck?: CardDeck;
  items: TrashedObject[];
  query: string;
  searched: string;
  busy: boolean;
  more: boolean;
  onQuery: (query: string) => void;
  onRestore: (item: TrashedObject) => void;
  onDelete: (item: TrashedObject) => void;
  onEmpty: () => void;
  onMore: () => void;
  onHealth: () => void;
  onBackups: () => void;
  children?: ReactNode;
}) {
  const [, refresh] = useState(0);
  useEffect(() => deck?.subscribe(() => refresh((n) => n + 1)), [deck]);
  const cards = Object.values(deck?.data ?? {}).filter(
    (card) =>
      card.deleted &&
      cardPreview(card, undefined, deck?.data).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section className="trash-page" aria-label="Trash and recovery">
      <header className="trash-page-heading">
        <div className="trash-heading-icon">
          <ShellIcon name="trash" />
        </div>
        <h1>Trash</h1>
        <p>Restore your items, or let them go.</p>
      </header>
      <div className="trash-retention">
        <ShellIcon name="undo" />
        <span>
          Notebooks and collections in Trash are permanently deleted after 30
          days.
        </span>
      </div>
      <div className="trash-toolbar">
        <label className="panel-search">
          <ShellIcon name="search" />
          <input
            aria-label="Search Trash"
            placeholder="Search deleted items…"
            value={query}
            disabled={busy}
            onChange={(event) => onQuery(event.target.value)}
          />
        </label>
        <button
          className="trash-empty-button"
          disabled={busy || (!items.length && !searched)}
          onClick={onEmpty}
        >
          Empty Trash
        </button>
      </div>
      {children}
      <div className="trash-results" aria-live="polite">
        {items.length > 0 && (
          <div className="trash-list-label">
            {searched ? "Search results" : "Deleted items"}
            <span>
              {items.length}
              {more ? "+" : ""}
            </span>
          </div>
        )}
        <div className="trash-list">
          {items.map((item) => {
            const days = Math.max(
              0,
              Math.ceil(
                (item.deleted_at + 30 * 86400000 - Date.now()) / 86400000,
              ),
            );
            return (
              <div className="trash-item" key={item.id}>
                <div className="trash-item-icon">
                  <ShellIcon
                    name={item.kind === "collection" ? "folder" : "notebook"}
                  />
                </div>
                <div className="trash-item-info">
                  <strong data-tooltip={item.title}>{item.title}</strong>
                  <small>
                    Deleted{" "}
                    {new Date(item.deleted_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                    <span aria-hidden="true"> · </span>
                    <span>
                      {days
                        ? `${days} ${days === 1 ? "day" : "days"} left`
                        : "Expires soon"}
                    </span>
                  </small>
                </div>
                <div className="trash-item-actions">
                  <button
                    disabled={busy}
                    aria-label={`Restore ${item.title}`}
                    onClick={() => onRestore(item)}
                  >
                    <ShellIcon name="undo" />
                    Restore
                  </button>
                  <button
                    className="trash-delete-button"
                    disabled={busy}
                    aria-label={`Delete permanently ${item.title}`}
                    data-tooltip="Delete permanently"
                    onClick={() => onDelete(item)}
                  >
                    <ShellIcon name="trash" />
                  </button>
                </div>
              </div>
            );
          })}
          {cards.map((card) => (
            <div className="trash-item" key={card.id}>
              <div className="trash-item-icon">
                <ShellIcon name="note" />
              </div>
              <div className="trash-item-info">
                <strong>{cardPreview(card, undefined, deck?.data).split("\n")[0]}</strong>
                <small>Card Deck</small>
              </div>
              <div className="trash-item-actions">
                <button onClick={() => deck?.restore(card.id)}>
                  <ShellIcon name="undo" />
                  Restore to deck
                </button>
              </div>
            </div>
          ))}
          {!items.length && !cards.length && (
            <div className="trash-empty-state">
              <ShellIcon name={searched ? "search" : "trash"} />
              <h2>{searched ? "No matching items" : "Trash is empty."}</h2>
              <p>
                {searched
                  ? "Try another title to find what you’re looking for."
                  : "Deleted items will appear here. You have 30 days to bring them back."}
              </p>
            </div>
          )}
        </div>
        {more && (
          <button className="trash-load-more" disabled={busy} onClick={onMore}>
            Load more deleted documents
          </button>
        )}
      </div>
      <footer className="trash-recovery-footer">
        <div>
          <strong>Looking for something else?</strong>
          <p>Check missing files or recover a workspace backup.</p>
        </div>
        <div>
          <button disabled={busy} onClick={onHealth}>
            Workspace health
            <ShellIcon name="forward" />
          </button>
          <button disabled={busy} onClick={onBackups}>
            Backups
            <ShellIcon name="forward" />
          </button>
        </div>
      </footer>
    </section>
  );
}
