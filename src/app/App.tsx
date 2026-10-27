import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";
import {
  repository,
  backups,
  organization,
  type Catalog,
  type Organization,
  type LibraryFilter,
  type KnowledgeObject,
} from "../services/workspace";
import type { SaveStatus } from "../services/persistence";
import { NavigationHistory } from "../services/navigation";
import {
  LibraryFilters,
  DocumentOrganization,
  OrganizationManager,
} from "./Organization";
import {
  openEditor,
  type EditorSession,
} from "../features/editor/blocksuite/adapter";

export function App() {
  const [catalog, setCatalog] = useState<Catalog>({ folders: [], tags: [] });
  const [filter, setFilter] = useState<LibraryFilter>({
    folder: null,
    tag: null,
  });
  const [organized, setOrganized] = useState<Organization>({
    folder: null,
    tags: [],
  });
  const [managing, setManaging] = useState(false);
  const [items, setItems] = useState<KnowledgeObject[]>([]),
    [active, setActive] = useState<KnowledgeObject | null>(null),
    [query, setQuery] = useState(""),
    [mode, setMode] = useState<"page" | "edgeless">("page"),
    [status, setStatus] = useState<SaveStatus>("saved"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [title, setTitle] = useState("");
  const host = useRef<HTMLDivElement>(null),
    history = useRef(new NavigationHistory<KnowledgeObject>()),
    session = useRef<EditorSession | null>(null),
    locked = useRef(false),
    file = useRef<HTMLInputElement>(null),
    searchGeneration = useRef(0);
  const report = (e: unknown) => setError(String(e));
  useEffect(() => {
    if (host.current) host.current.inert = busy;
  }, [busy]);
  const refresh = async (search = query, selected = filter) => {
    const generation = ++searchGeneration.current;
    const rows = await repository.list(search, 0, selected);
    if (generation === searchGeneration.current) setItems(rows);
    return rows;
  };
  async function run(task: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      report(e);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function select(item: KnowledgeObject, record = true) {
    await session.current?.flush();
    const metadata = await organization.get(item.id);
    const next = await openEditor(
      item,
      (s, e) => {
        setStatus(s);
        if (e) report(e);
      },
      (savedTitle) => {
        history.current.update(item.id, { title: savedTitle });
        setItems((rows) =>
          rows.map((row) =>
            row.id === item.id ? { ...row, title: savedTitle } : row,
          ),
        );
        setActive((current) =>
          current?.id === item.id ? { ...current, title: savedTitle } : current,
        );
        if (
          document.activeElement?.getAttribute("aria-label") !==
          "Document title"
        )
          setTitle(savedTitle);
      },
    );
    session.current?.destroy();
    session.current = next;
    host.current?.replaceChildren(next.editor);
    setActive(item);
    setOrganized(metadata);
    setTitle(item.title);
    setMode(next.editor.mode);
    if (record) history.current.visit(item);
  }
  useEffect(() => {
    if (!isTauri()) {
      setError(
        "Open Knot with pnpm tauri dev. The browser preview has no durable workspace connection.",
      );
      return;
    }
    void run(async () => {
      setCatalog(await organization.catalog());
      const rows = await refresh("");
      if (rows[0]) await select(rows[0]);
    });
    let off: (() => void) | undefined;
    let gone = false;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        if (locked.current) {
          setError("An operation is in progress. Please wait before closing.");
          return;
        }
        await run(async () => {
          await session.current?.flush();
          await getCurrentWindow().destroy();
        });
      })
      .then((fn) => {
        if (gone) fn();
        else off = fn;
      });
    return () => {
      gone = true;
      off?.();
    };
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    const timer = setTimeout(() => void refresh(query).catch(report), 180);
    return () => clearTimeout(timer);
  }, [query, filter]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "s") {
        e.preventDefault();
        void run(async () => {
          await session.current?.flush();
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const create = (kind: KnowledgeObject["kind"]) =>
    run(async () => {
      await session.current?.flush();
      const id = await repository.create(kind);
      setQuery("");
      const all = { folder: null, tag: null };
      setFilter(all);
      const rows = await refresh("", all);
      await select(rows.find((x) => x.id === id)!);
    });
  const reloadOrganization = async () => {
    const next = await organization.catalog();
    setCatalog(next);
    const selected = {
      folder:
        filter.folder && !next.folders.some((f) => f.id === filter.folder)
          ? null
          : filter.folder,
      tag:
        filter.tag && !next.tags.some((t) => t.id === filter.tag)
          ? null
          : filter.tag,
    };
    setFilter(selected);
    if (active) setOrganized(await organization.get(active.id));
    await refresh(query, selected);
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">⌘</span>
          <span>
            Knot<small>YOUR LOCAL WORKSPACE</small>
          </span>
        </div>
        <div className="workspace-label">
          <span className="workspace-dot" /> Personal workspace{" "}
          <span className="local-label">LOCAL</span>
        </div>
        <button
          className="primary"
          disabled={busy}
          onClick={() => void create("note")}
        >
          ＋ New note <kbd>↵</kbd>
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void create("whiteboard")}
        >
          ◇ New whiteboard
        </button>
        <label className="search">
          <span>⌕</span>
          <input
            aria-label="Search titles"
            placeholder="Find an idea…"
            value={query}
            disabled={busy}
            onChange={(e) => {
              ++searchGeneration.current;
              setQuery(e.target.value);
            }}
          />
        </label>
        <div className="section-label">
          YOUR LIBRARY{" "}
          <span>
            {items.length}
            {items.length === 100 ? "+" : ""}
          </span>
        </div>
        <LibraryFilters
          catalog={catalog}
          busy={busy}
          value={filter}
          onChange={(value) => {
            ++searchGeneration.current;
            setFilter(value);
          }}
        />
        <button
          className="manage-organization"
          disabled={busy}
          onClick={() => setManaging(!managing)}
        >
          Manage folders & tags
        </button>
        <nav className="library">
          {items.map((item) => (
            <button
              key={item.id}
              className={`document-row ${active?.id === item.id ? "selected" : ""}`}
              disabled={busy}
              onClick={() => void run(() => select(item))}
            >
              <span className="document-icon">
                {item.kind === "whiteboard" ? "◇" : "▤"}
              </span>
              <span>{item.title}</span>
            </button>
          ))}
          {!items.length && (
            <p className="empty">
              {query || filter.folder !== null || filter.tag
                ? "No documents match these filters."
                : "A little room for your next idea."}
            </p>
          )}
          {items.length >= 100 && (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () =>
                  setItems([
                    ...items,
                    ...(await repository.list(query, items.length, filter)),
                  ]),
                )
              }
            >
              Load more
            </button>
          )}
        </nav>
        <div className="sidebar-footer">
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await session.current?.flush();
                const result = await repository.integrity();
                setNotice(
                  `Workspace check: ${result.checked} assets checked; ${result.missing.length} missing, ${result.corrupt.length} corrupt, ${result.orphan_files.length} unreferenced files. No files were removed.`,
                );
              })
            }
          >
            ✓ Check workspace
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await session.current?.flush();
                const path = await backups.export();
                if (path) setNotice(`Backup saved: ${path}`);
              })
            }
          >
            ↗ Back up workspace
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (
                  !confirm(
                    "Restore a backup into a separate workspace and open it? Your current workspace will be retained.",
                  )
                )
                  return;
                await session.current?.flush();
                const path = await backups.restore();
                if (path) {
                  history.current.clear();
                  session.current?.destroy();
                  session.current = null;
                  host.current?.replaceChildren();
                  setActive(null);
                  setQuery("");
                  const all = { folder: null, tag: null };
                  setFilter(all);
                  setManaging(false);
                  setCatalog(await organization.catalog());
                  const rows = await refresh("", all);
                  if (rows[0]) await select(rows[0]);
                  setNotice(`Opened restored workspace: ${path}`);
                }
              })
            }
          >
            ↙ Restore backup
          </button>
          <p>
            <span className="workspace-dot" /> Offline by design. Yours to keep.
          </p>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <button
            aria-label="Go back"
            disabled={busy || !history.current.canBack}
            onClick={() =>
              void run(() =>
                history.current.move(-1, (item) => select(item, false)),
              )
            }
          >
            ←
          </button>
          <button
            aria-label="Go forward"
            disabled={busy || !history.current.canForward}
            onClick={() =>
              void run(() =>
                history.current.move(1, (item) => select(item, false)),
              )
            }
          >
            →
          </button>
          <span className="breadcrumb">
            Workspace <span>/</span>
          </span>
          <input
            className="title-input"
            aria-label="Document title"
            value={title}
            disabled={!active || busy}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            onBlur={() => {
              if (active && title !== active.title)
                void run(async () => {
                  await session.current?.rename(title);
                  setActive({ ...active, title });
                  await refresh();
                });
            }}
          />
          <button
            className={`save-status ${status}`}
            title="Save now / retry"
            onClick={() =>
              void run(async () => {
                await session.current?.flush();
              })
            }
          >
            {status === "saved"
              ? "✓ Saved"
              : status === "saving"
                ? "◌ Saving…"
                : "! Save failed · Retry"}
          </button>
        </header>
        <div className="toolbar">
          <div className="mode-switch">
            {(["page", "edgeless"] as const).map((m) => (
              <button
                key={m}
                disabled={!active || busy}
                className={mode === m ? "current" : ""}
                onClick={() => {
                  if (session.current) {
                    session.current.editor.mode = m;
                    setMode(m);
                  }
                }}
              >
                {m === "page" ? "▤ Page" : "◇ Canvas"}
              </button>
            ))}
          </div>
          <span className="toolbar-hint">
            {mode === "page"
              ? "A space to think, one thought at a time."
              : "Make room for the bigger picture."}
          </span>
          <div className="actions">
            <button
              title="Undo (Ctrl+Z)"
              disabled={!active || busy}
              onClick={() => session.current?.doc.undo()}
            >
              ↶
            </button>
            <button
              title="Redo (Ctrl+Y)"
              disabled={!active || busy}
              onClick={() => session.current?.doc.redo()}
            >
              ↷
            </button>
            <button
              disabled={!active || busy}
              onClick={() => file.current?.click()}
            >
              ＋ Attach
            </button>
            <button
              title="Delete document"
              disabled={!active || busy}
              onClick={() =>
                void run(async () => {
                  if (
                    !active ||
                    !confirm(
                      `Move “${active.title}” out of your library? Its data will be retained in the workspace.`,
                    )
                  )
                    return;
                  await session.current?.flush();
                  await repository.delete(active.id);
                  history.current.remove(active.id);
                  session.current?.destroy();
                  session.current = null;
                  host.current?.replaceChildren();
                  setActive(null);
                  setTitle("");
                  const rows = await refresh();
                  if (rows[0]) await select(rows[0]);
                })
              }
            >
              ⌫
            </button>
          </div>
        </div>
        {error && (
          <div role="alert" className="error-banner">
            {error}
            <button onClick={() => setError("")}>Dismiss</button>
          </div>
        )}
        {managing && (
          <OrganizationManager
            catalog={catalog}
            busy={busy}
            run={run}
            onChanged={reloadOrganization}
            onClose={() => setManaging(false)}
          />
        )}
        {active && (
          <DocumentOrganization
            catalog={catalog}
            busy={busy}
            value={organized}
            onChange={(value) =>
              void run(async () => {
                await session.current?.flush();
                await organization.save(active.id, value);
                setOrganized(value);
                await refresh();
              })
            }
          />
        )}
        {notice && (
          <div role="status" className="notice-banner">
            {notice}
            <button onClick={() => setNotice("")}>×</button>
          </div>
        )}
        <div className="editor-area" ref={host} />
        {!active && !busy && (
          <div className="welcome">
            <div className="welcome-symbol">⌘</div>
            <h1>A little space for big ideas.</h1>
            <p>Create a note or whiteboard to begin.</p>
          </div>
        )}
        <footer className="statusbar">
          <span>
            {active?.kind === "whiteboard" ? "WHITEBOARD" : "NOTE"} · KNOT
          </span>
          <span>{busy ? "Working…" : "Stored on this device"}</span>
        </footer>
      </main>
      <input
        ref={file}
        type="file"
        hidden
        accept="image/*,application/pdf"
        onChange={(e) => {
          const selected = e.target.files?.[0];
          e.target.value = "";
          if (selected)
            void run(async () => {
              await session.current?.insert(selected);
            });
        }}
      />
    </div>
  );
}
