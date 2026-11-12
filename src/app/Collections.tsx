import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type HTMLAttributes,
} from "react";
import { ShellIcon } from "./ShellIcon";
import { createPortal } from "react-dom";
import {
  collections,
  type Catalog,
  type Collection,
} from "../services/workspace";

const PopoverLayoutContext = createContext(() => {});

type Shared = {
  pinned?: string[];
  onTogglePin?: (id: string) => void;
  catalog: Catalog;
  busy: boolean;
  run: (task: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
};

export function Popover({
  label,
  trigger,
  className = "",
  disabled = false,
  placement = "bottom",
  children,
}: {
  label: string;
  trigger: ReactNode;
  className?: string;
  disabled?: boolean;
  placement?: "top" | "bottom";
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const position = useCallback(() => {
    const anchor = button.current?.getBoundingClientRect();
    if (!anchor || !panel.current) return;
    const box = panel.current.getBoundingClientRect();
    panel.current.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8))}px`;
    const above = anchor.top - box.height - 6;
    const below = anchor.bottom + 6;
    const fitsAbove = above >= 8;
    const fitsBelow = below + box.height <= window.innerHeight - 8;
    const top =
      placement === "top"
        ? fitsAbove || !fitsBelow
          ? above
          : below
        : fitsBelow || !fitsAbove
          ? below
          : above;
    panel.current.style.top = `${Math.max(8, Math.min(top, window.innerHeight - box.height - 8))}px`;
  }, [placement]);
  useLayoutEffect(() => {
    if (!open) return;
    position();
    const observer = new ResizeObserver(position);
    if (panel.current) observer.observe(panel.current);
    panel.current
      ?.querySelector<HTMLInputElement>("input")
      ?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      const path = event.composedPath();
      if (!path.includes(panel.current!) && !path.includes(button.current!))
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    // Observe before editor/canvas handlers stop pointer propagation.
    window.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
    };
  }, [open, position]);
  return (
    <>
      <button
        ref={button}
        disabled={disabled}
        className={className}
        aria-label={label}
        data-tooltip={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
      >
        {trigger}
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            id={id}
            role="dialog"
            aria-label={label}
            className="collection-popover knot-dropdown"
            onBlur={(event) => {
              if (
                event.relatedTarget &&
                !event.currentTarget.contains(event.relatedTarget as Node) &&
                event.relatedTarget !== button.current
              )
                setOpen(false);
            }}
          >
            <PopoverLayoutContext.Provider value={position}>
              {children(close)}
            </PopoverLayoutContext.Provider>
          </div>,
          document.body,
        )}
    </>
  );
}

export function CreateCollection({
  labeled = false,
  busy,
  run,
  onChanged,
}: Omit<Shared, "catalog"> & { labeled?: boolean }) {
  return (
    <Popover
      label="New collection"
      trigger={
        labeled ? (
          <>
            <ShellIcon name="folder" /> New collection…
          </>
        ) : (
          <ShellIcon name="plus" />
        )
      }
      disabled={busy}
      className={labeled ? "secondary" : "new-collection-trigger"}
    >
      {(close) => (
        <NewCollectionForm
          busy={busy}
          run={run}
          onChanged={onChanged}
          close={close}
        />
      )}
    </Popover>
  );
}

function NewCollectionForm({
  busy,
  run,
  onChanged,
  close,
}: Omit<Shared, "catalog"> & { close: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  return (
    <form
      className="collection-name-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || !name.trim()) return;
        void run(async () => {
          setError("");
          try {
            await collections.create(name.trim());
            await onChanged();
            close();
          } catch (cause) {
            setError(String(cause));
          }
        });
      }}
    >
      <label htmlFor="new-collection-name">Collection name</label>
      <input
        id="new-collection-name"
        aria-label="Collection name"
        placeholder="Collection name"
        maxLength={100}
        value={name}
        disabled={busy}
        onChange={(event) => setName(event.target.value)}
      />
      {error && <p role="alert">{error}</p>}
      <button
        className="collection-submit"
        type="submit"
        disabled={busy || !name.trim()}
      >
        Create collection <span aria-hidden="true">↵</span>
      </button>
    </form>
  );
}

export function CollectionGroup({
  collection,
  children,
  dragProps,
  dropIndicator,
  open,
  onToggle,
  ...shared
}: Shared & {
  open: boolean;
  onToggle: () => void;
  collection: Collection;
  dragProps?: HTMLAttributes<HTMLElement>;
  dropIndicator?: string;
  children: () => ReactNode[];
}) {
  const [limit, setLimit] = useState(100);
  const id = useId();
  const rows = open ? children() : [];
  return (
    <section
      className="collection-group"
      aria-label={`Collection ${collection.name}`}
    >
      <div
        className="collection-group-heading"
        {...dragProps}
        data-drop={dropIndicator}
      >
        <button
          className="collection-group-toggle"
          aria-expanded={open}
          aria-controls={id}
          onClick={onToggle}
          data-tooltip={collection.name}
        >
          <span className="collection-chevron" aria-hidden="true">
            <ShellIcon name="chevron" />
          </span>
          <ShellIcon name="folder" expanded={open} />
          <span className="collection-name">{collection.name}</span>
        </button>
        <Popover
          label={`Options for ${collection.name}`}
          trigger="⋯"
          className="collection-options-trigger"
        >
          {(close) => (
            <CollectionList
              {...shared}
              selected={collection.id}
              onSelect={close}
            />
          )}
        </Popover>
      </div>
      <div id={id} className="collection-group-notebooks" hidden={!open}>
        {open && (
          <>
            {rows.slice(0, limit)}
            {!rows.length && (
              <p className="empty">
                No notebooks yet. Add one from a notebook’s ⋯ menu.
              </p>
            )}
            {rows.length > limit && (
              <button onClick={() => setLimit(limit + 100)}>
                Show more notebooks
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export function CollectionList({
  pinned,
  onTogglePin,
  catalog,
  busy,
  selected,
  onSelect,
  run,
  onChanged,
}: Shared & {
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [mode, setMode] = useState<"menu" | "rename" | "delete">("menu");
  const current = catalog.collections.find((c) => c.id === selected);
  const [name, setName] = useState(current?.name ?? "");
  const [error, setError] = useState("");
  if (!current) return null;
  if (mode === "rename")
    return (
      <form
        className="collection-name-form"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            try {
              await collections.rename(current.id, name);
              await onChanged();
              onSelect(null);
            } catch (cause) {
              setError(String(cause));
            }
          });
        }}
      >
        <label htmlFor="rename-collection-name">Rename collection</label>
        <input
          id="rename-collection-name"
          autoFocus
          onFocus={(event) => event.target.select()}
          aria-label="Collection name"
          value={name}
          disabled={busy}
          maxLength={100}
          onChange={(event) => setName(event.target.value)}
        />
        {error && <p role="alert">{error}</p>}
        <button className="collection-submit" disabled={busy || !name.trim()}>
          Save name <span aria-hidden="true">↵</span>
        </button>
      </form>
    );
  if (mode === "delete")
    return (
      <div className="collection-delete-confirm">
        <p>Move “{current.name}” to Trash?</p>
        <small>Notebooks will be kept.</small>
        <button
          className="collection-danger"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await collections.delete(current.id);
              await onChanged();
              onSelect(null);
            })
          }
        >
          Move collection to Trash and keep notebooks
        </button>
        <button disabled={busy} onClick={() => setMode("menu")}>
          Cancel
        </button>
      </div>
    );
  return (
    <div className="collection-action-list">
      {onTogglePin && (
        <button
          disabled={busy}
          aria-pressed={pinned?.includes(current.id) ?? false}
          onClick={() => {
            onTogglePin(current.id);
            onSelect(null);
          }}
        >
          <ShellIcon name="pin" />
          {pinned?.includes(current.id)
            ? "Unpin from sidebar"
            : "Pin to sidebar"}
        </button>
      )}
      <button disabled={busy} onClick={() => setMode("rename")}>
        <ShellIcon name="rename" />
        Rename collection
      </button>
      <button
        className="collection-danger"
        disabled={busy}
        onClick={() => setMode("delete")}
      >
        <ShellIcon name="trash" />
        Move collection to Trash
      </button>
    </div>
  );
}

export function CollectionMembership({
  object,
  title,
  onRename,
  onTrash,
  favorite,
  onFavorite,
  ...shared
}: Shared & {
  object: string;
  title: string;
  onRename?: (name: string) => Promise<void>;
  onTrash?: () => void;
  /** Shown as a Favorites toggle when given. */
  favorite?: boolean;
  onFavorite?: () => void;
}) {
  return (
    <Popover
      label={
        onRename ? `Notebook options for ${title}` : `Collections for ${title}`
      }
      trigger="⋯"
      disabled={shared.busy}
      className="collection-membership-trigger"
    >
      {(close) =>
        onRename && onTrash ? (
          <NotebookActions
            key={object}
            object={object}
            title={title}
            onRename={onRename}
            onTrash={onTrash}
            favorite={favorite}
            onFavorite={onFavorite}
            close={close}
            {...shared}
          />
        ) : (
          <MembershipEditor key={object} object={object} {...shared} />
        )
      }
    </Popover>
  );
}
function NotebookActions({
  object,
  title,
  onRename,
  onTrash,
  favorite,
  onFavorite,
  close,
  ...shared
}: Shared & {
  object: string;
  title: string;
  onRename: (name: string) => Promise<void>;
  onTrash: () => void;
  favorite?: boolean;
  onFavorite?: () => void;
  close: () => void;
}) {
  const [view, setView] = useState<"menu" | "rename" | "collections">("menu");
  const [name, setName] = useState(title);
  const input = useRef<HTMLInputElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const position = useContext(PopoverLayoutContext);
  useLayoutEffect(() => {
    // Submenus change size during this commit. Place the new view before
    // paint instead of waiting for the next ResizeObserver delivery.
    position();
    if (view === "rename") {
      input.current?.focus({ preventScroll: true });
      input.current?.select();
    }
    if (view === "collections") back.current?.focus({ preventScroll: true });
  }, [view, position]);
  if (view === "rename")
    return (
      <form
        className="collection-name-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || shared.busy) return;
          void shared.run(async () => {
            await onRename(name.trim());
            close();
          });
        }}
      >
        <label htmlFor="rename-notebook">Notebook name</label>
        <input
          ref={input}
          id="rename-notebook"
          value={name}
          maxLength={200}
          disabled={shared.busy}
          onChange={(event) => setName(event.target.value)}
        />
        <button
          className="collection-submit"
          disabled={shared.busy || !name.trim()}
          type="submit"
        >
          Rename <span aria-hidden="true">↵</span>
        </button>
        <button type="button" onClick={() => setView("menu")}>
          Back
        </button>
      </form>
    );
  if (view === "collections")
    return (
      <div>
        <div className="collection-action-list">
          <button ref={back} onClick={() => setView("menu")}>
            ← Notebook options
          </button>
        </div>
        <MembershipEditor object={object} {...shared} />
      </div>
    );
  return (
    <div className="collection-action-list">
      {onFavorite && (
        <button
          disabled={shared.busy}
          onClick={() => {
            close();
            onFavorite();
          }}
        >
          <ShellIcon name="star" />
          {favorite ? "Remove from Favorites" : "Add to Favorites"}
        </button>
      )}
      <button disabled={shared.busy} onClick={() => setView("rename")}>
        <ShellIcon name="rename" />
        Rename
      </button>
      <button
        disabled={shared.busy}
        aria-haspopup="true"
        onClick={() => setView("collections")}
      >
        <ShellIcon name="folder" />
        Collections <span style={{ marginLeft: "auto" }}>›</span>
      </button>
      <button
        disabled={shared.busy}
        className="collection-danger"
        onClick={() => {
          close();
          onTrash();
        }}
      >
        <ShellIcon name="trash" />
        Move to Trash
      </button>
    </div>
  );
}

function MembershipEditor({
  object,
  catalog,
  busy,
  run,
  onChanged,
}: Shared & { object: string }) {
  const [ids, setIds] = useState<string[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    collections
      .get(object)
      .then((value) => {
        if (alive) setIds(value.collections);
      })
      .catch((cause) => {
        if (alive) setError(String(cause));
      });
    return () => {
      alive = false;
    };
  }, [object]);
  const name = query.trim();
  const canCreate =
    name &&
    !catalog.collections.some(
      (c) => c.name.toLowerCase() === name.toLowerCase(),
    );
  const create = () =>
    void run(async () => {
      const id = await collections.create(name, object);
      setIds((previous) => [...(previous ?? []), id]);
      setQuery("");
      await onChanged();
    });
  return (
    <div className="collection-membership-editor" aria-busy={!ids && !error}>
      <strong>Collections</strong>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canCreate && ids && !busy) create();
        }}
      >
        <input
          aria-label="Find or create collection"
          placeholder="Find or create…"
          maxLength={100}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {canCreate && (
          <button disabled={busy || !ids} type="submit">
            Create “{name}”
          </button>
        )}
      </form>
      {error && <p role="alert">{error}</p>}
      {/* The catalog already supplies these rows. Keep their geometry while
          membership loads so viewport placement cannot flip on completion. */}
      <div className="collection-choices">
        {catalog.collections
          .filter((c) => c.name.toLowerCase().includes(name.toLowerCase()))
          .map((c) => (
            <label key={c.id}>
              <input
                type="checkbox"
                disabled={busy || !ids}
                checked={ids?.includes(c.id) ?? false}
                onChange={(e) => {
                  const checked = e.target.checked;
                  void run(async () => {
                    const latest = await collections.get(object);
                    const next = checked
                      ? [...new Set([...latest.collections, c.id])]
                      : latest.collections.filter((id) => id !== c.id);
                    await collections.save(object, { collections: next });
                    setIds(next);
                    await onChanged();
                  });
                }}
              />
              {c.name}
            </label>
          ))}
      </div>
      {!catalog.collections.length && !name && (
        <p>Type a name to create your first collection.</p>
      )}
      <small>Choose one or more collections.</small>
    </div>
  );
}
