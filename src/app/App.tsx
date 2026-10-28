import { BackupManager } from "./BackupManager";
import { BacklinksPanel } from "./BacklinksPanel";
import {
  findBacklinks,
  type BacklinkReport,
} from "../features/editor/blocksuite/backlinks";
import { IntegrityPanel } from "./IntegrityPanel";
import { QuarantinePanel } from "./QuarantinePanel";
import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";
import {
  repository,
  attachments,
  quarantine,
  type OrphanCandidate,
  type QuarantineCatalog,
  backups,
  workspaces,
  type WorkspaceCatalog,
  type IntegrityReport,
  type BackupEntry,
  exportDocument,
  type ExportFormat,
  organization,
  type Catalog,
  type Organization,
  type LibraryFilter,
  type KnowledgeObject,
  type TrashedObject,
} from "../services/workspace";
import type { SaveStatus } from "../services/persistence";
import { WorkspacePicker, workspaceName } from "./WorkspacePicker";
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
  const [showBacklinks, setShowBacklinks] = useState(false);
  const [backlinks, setBacklinks] = useState<BacklinkReport | null>(null);
  async function scanBacklinks() {
    setShowBacklinks(true);
    setBacklinks(null);
    await session.current?.flush();
    if (active)
      setBacklinks(
        await findBacklinks(
          active.id,
          await repository.catalog(),
          repository.load,
        ),
      );
  }
  const [cleanup, setCleanup] = useState<{
    candidates: OrphanCandidate[] | null;
    catalog: QuarantineCatalog;
  } | null>(null);
  const [cleanupVersion, setCleanupVersion] = useState(0);
  async function loadCleanup() {
    setCleanupVersion((v) => v + 1);
    setCleanup({ candidates: null, catalog: { entries: [], warnings: [] } });
    const catalog = await quarantine.catalog();
    setCleanup({ candidates: null, catalog });
    const candidates = await quarantine.preview();
    setCleanup({ candidates, catalog });
  }
  const [integrity, setIntegrity] = useState<IntegrityReport | null>(null);
  async function checkWorkspace() {
    setIntegrity(null);
    await session.current?.flush();
    setIntegrity(await repository.integrity());
  }
  async function restoreDocument(
    item: { id: string; title: string },
    auditAfter = integrity !== null,
  ) {
    await session.current?.flush();
    await repository.restore(item.id);
    setIntegrity(null);
    setNotice(
      `Restored “${item.title}”. It is available in your library; current filters may hide it.`,
    );
    try {
      if (trash !== null) await loadTrash();
      await refresh();
      if (active) await select(active, false);
    } finally {
      if (auditAfter) await checkWorkspace();
    }
  }
  async function restoreReferenceTarget(id: string) {
    await session.current?.flush();
    setIntegrity(null);
    const latest = await repository.integrity();
    setIntegrity(latest);
    const target = latest.documents.recoverableTargets.find(
      (entry) => entry.id === id,
    );
    if (!target)
      throw new Error(
        "This target is no longer eligible for direct recovery. Review the refreshed report or open Trash & recovery.",
      );
    await restoreDocument(target, true);
  }
  const [exporting, setExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("markdown");
  const [workspaceCatalog, setWorkspaceCatalog] = useState<WorkspaceCatalog>({
    active: null,
    entries: [],
  });
  const [backupEntries, setBackupEntries] = useState<BackupEntry[] | null>(
    null,
  );
  const [pickingWorkspace, setPickingWorkspace] = useState(false);
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
  const [trash, setTrash] = useState<TrashedObject[] | null>(null);
  const [trashQuery, setTrashQuery] = useState("");
  const [trashSearch, setTrashSearch] = useState("");
  const [moreTrash, setMoreTrash] = useState(false);
  async function loadTrash(search = trashSearch, append = false) {
    const rows = await repository.trash(
      search,
      append ? (trash?.length ?? 0) : 0,
    );
    setTrash(append ? [...(trash ?? []), ...rows] : rows);
    setTrashSearch(search);
    setMoreTrash(rows.length === 100);
  }
  const [references, setReferences] = useState<KnowledgeObject[]>([]);
  const [referenceTarget, setReferenceTarget] = useState("");
  const [choosingReference, setChoosingReference] = useState(false);
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
      (id) =>
        void run(async () => {
          await session.current?.flush();
          const target = (await repository.catalog()).find(
            (row) => row.id === id,
          );
          if (!target)
            throw new Error("This document was deleted or is unavailable.");
          await select(target);
        }),
      () => void refresh().catch(report),
    );
    session.current?.destroy();
    session.current = next;
    host.current?.replaceChildren(next.editor);
    setReferences(next.catalog.filter((row) => row.id !== item.id));
    setReferenceTarget("");
    setChoosingReference(false);
    setActive(item);
    setShowBacklinks(false);
    setBacklinks(null);
    setOrganized(metadata);
    setTitle(item.title);
    setMode(next.editor.mode);
    if (record) history.current.visit(item);
  }
  async function reloadWorkspace() {
    setShowBacklinks(false);
    setBacklinks(null);
    setCleanup(null);
    setIntegrity(null);
    setExporting(false);
    ++searchGeneration.current;
    history.current.clear();
    session.current?.destroy();
    session.current = null;
    host.current?.replaceChildren();
    setActive(null);
    setItems([]);
    setTitle("");
    setQuery("");
    setStatus("saved");
    setNotice("");
    setReferences([]);
    setReferenceTarget("");
    setChoosingReference(false);
    setOrganized({ folder: null, tags: [] });
    setCatalog({ folders: [], tags: [] });
    const all = { folder: null, tag: null };
    setFilter(all);
    setManaging(false);
    setTrash(null);
    setBackupEntries(null);
    setPickingWorkspace(false);
    setWorkspaceCatalog(await workspaces.catalog());
    setCatalog(await organization.catalog());
    const rows = await refresh("", all);
    if (rows[0]) await select(rows[0]);
  }
  useEffect(() => {
    if (!isTauri()) {
      setError(
        "Open Knot with pnpm tauri dev. The browser preview has no durable workspace connection.",
      );
      return;
    }
    void run(async () => {
      setWorkspaceCatalog(await workspaces.catalog());
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
          <img
            className="brand-mark"
            src="/knot-icon.png"
            alt=""
            width="40"
            height="40"
          />
          <span>
            Knot<small>YOUR LOCAL WORKSPACE</small>
          </span>
        </div>
        <div className="workspace-label">
          <span className="workspace-dot" />{" "}
          {workspaceCatalog.active
            ? workspaceName(workspaceCatalog.active)
            : "Workspace unavailable"}{" "}
          <span className="local-label">LOCAL</span>
        </div>
        <button
          className="manage-organization"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              setWorkspaceCatalog(await workspaces.catalog());
              setPickingWorkspace(!pickingWorkspace);
            })
          }
        >
          Switch workspace
        </button>
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
                setBackupEntries(await backups.list());
              })
            }
          >
            Manage backups
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await loadTrash("");
                setTrashQuery("");
              })
            }
          >
            Trash & recovery
          </button>
          <button disabled={busy} onClick={() => void run(checkWorkspace)}>
            ✓ Check workspace
          </button>
          <button
            disabled={busy || !workspaceCatalog.active}
            onClick={() => void run(loadCleanup)}
          >
            Orphan quarantine
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
                  await reloadWorkspace();
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
                    session.current.setMode(m);
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
              disabled={!active || busy}
              onClick={() => void run(scanBacklinks)}
            >
              Backlinks
            </button>
            <button
              disabled={!active || busy}
              onClick={() => setExporting(!exporting)}
            >
              Export
            </button>
            <button
              disabled={!active || busy}
              onClick={() => setChoosingReference(!choosingReference)}
            >
              ＋ Reference
            </button>
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
                      `Move “${active.title}” to Trash? You can restore it later from Trash & recovery.`,
                    )
                  )
                    return;
                  await session.current?.flush();
                  await repository.delete(active.id);
                  setShowBacklinks(false);
                  setBacklinks(null);
                  if (trash !== null) await loadTrash();
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
        {showBacklinks && active && (
          <BacklinksPanel
            report={backlinks}
            busy={busy}
            onRefresh={() => void run(scanBacklinks)}
            onClose={() => {
              setShowBacklinks(false);
              setBacklinks(null);
            }}
            onOpen={(source) =>
              void run(async () => {
                await session.current?.flush();
                const current = (await repository.catalog()).find(
                  (row) => row.id === source.id,
                );
                if (!current) {
                  setBacklinks(null);
                  throw new Error(
                    "This source is no longer available. Refresh backlinks.",
                  );
                }
                await select(current);
              })
            }
          />
        )}
        {choosingReference && active && (
          <div className="notice-banner">
            <label>
              Workspace document{" "}
              <select
                aria-label="Reference document"
                value={referenceTarget}
                disabled={busy}
                onChange={(event) => setReferenceTarget(event.target.value)}
              >
                <option value="">Choose a document…</option>
                {references.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={busy || !referenceTarget}
              onClick={() =>
                void run(async () => {
                  await session.current?.reference(referenceTarget, false);
                  setChoosingReference(false);
                })
              }
            >
              Insert link
            </button>
            <button
              disabled={
                busy ||
                !referenceTarget ||
                references.find((item) => item.id === referenceTarget)?.kind !==
                  "note"
              }
              onClick={() =>
                void run(async () => {
                  await session.current?.reference(referenceTarget, true);
                  setChoosingReference(false);
                })
              }
            >
              Place shared note
            </button>
            <span>
              Shared notes preview the original. Open a card to edit its source.
            </span>
            <button disabled={busy} onClick={() => setChoosingReference(false)}>
              Close
            </button>
          </div>
        )}
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
        {exporting && active && (
          <section className="recovery-panel" aria-label="Export document">
            <h2>Export document</h2>
            <p>
              Markdown exports page text and supported blocks, with attachments
              in a ZIP when needed. Canvas drawings are omitted; shared notes
              and document references remain links to workspace IDs, not
              portable copies.
            </p>
            <p>
              PNG and PDF capture the current Page or Canvas view. PDF is a
              single image-based page; text is not selectable. Embedded files
              and remote media may appear as cards. Keep a Knot backup for full
              fidelity.
            </p>
            <label>
              Format{" "}
              <select
                aria-label="Export format"
                disabled={busy}
                value={exportFormat}
                onChange={(e) =>
                  setExportFormat(e.target.value as ExportFormat)
                }
              >
                <option value="markdown">Markdown (.md / .zip)</option>
                <option value="png">PNG image (.png)</option>
                <option value="pdf">PDF snapshot (.pdf)</option>
              </select>
            </label>{" "}
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const current = session.current;
                  if (!current) return;
                  await current.flush();
                  const files = await current.exportFiles(exportFormat);
                  const path = await exportDocument(
                    current.doc.meta?.title || title,
                    exportFormat,
                    files,
                  );
                  setNotice(
                    path ? `Export saved: ${path}` : "Export canceled.",
                  );
                })
              }
            >
              Save export
            </button>{" "}
            <button disabled={busy} onClick={() => setExporting(false)}>
              Close export
            </button>
            <p>
              Choose a new filename; existing files are never overwritten.
              Maximum export: 100 MiB. Visual exports are limited to 16
              megapixels.
            </p>
          </section>
        )}
        {cleanup !== null && (
          <QuarantinePanel
            key={cleanupVersion}
            {...cleanup}
            busy={busy}
            onClose={() => setCleanup(null)}
            onRefresh={() => void run(loadCleanup)}
            onDispose={(entry) =>
              void run(async () => {
                if (
                  !confirm(
                    `Permanently delete the quarantine copy of ${entry.original} (${entry.size.toLocaleString()} bytes)? Recovery ID: ${entry.id}. This cannot be undone. Backups do not include this copy. Any restored original will remain.`,
                  )
                )
                  return;
                await session.current?.flush();
                setIntegrity(null);
                try {
                  const warning = await quarantine.dispose(entry);
                  setNotice(
                    `Permanently deleted the quarantine copy of ${entry.original} (${entry.size.toLocaleString()} bytes). ${warning ?? ""}`,
                  );
                } finally {
                  await loadCleanup().catch(report);
                }
              })
            }
            onMove={(selected) =>
              void run(async () => {
                if (
                  !confirm(
                    `Quarantine ${selected.length} files (${selected.reduce((sum, c) => sum + c.size, 0).toLocaleString()} bytes)? Recovery copies stay in this workspace. No disk space will be freed.`,
                  )
                )
                  return;
                await session.current?.flush();
                setIntegrity(null);
                try {
                  const outcomes = await quarantine.move(
                    selected.map(({ id, size, digest }) => ({
                      id,
                      size,
                      digest,
                    })),
                  );
                  const failed = outcomes.filter((o) => o.error);
                  setNotice(
                    `Quarantined ${outcomes.length - failed.length} files. ${failed.length} failed. ` +
                      failed
                        .map(
                          (o) =>
                            `${selected.find((c) => c.id === o.id)?.path}: ${o.error}`,
                        )
                        .join(" "),
                  );
                } finally {
                  await loadCleanup().catch(report);
                }
              })
            }
            onRestore={(id) =>
              void run(async () => {
                await session.current?.flush();
                setIntegrity(null);
                try {
                  await quarantine.restore(id);
                  setNotice(
                    "Restored file to its original location. The quarantine copy is retained.",
                  );
                } finally {
                  await loadCleanup().catch(report);
                }
              })
            }
          />
        )}
        {integrity !== null && (
          <IntegrityPanel
            report={integrity}
            busy={busy}
            onClose={() => setIntegrity(null)}
            onCheck={() => void run(checkWorkspace)}
            onRestoreTarget={(id) => void run(() => restoreReferenceTarget(id))}
            onRecoverAttachment={(hash) =>
              void run(async () => {
                await session.current?.flush();
                try {
                  const source = await attachments.recoverMissing(hash);
                  setNotice(
                    `Recovered missing attachment from ${source}. The source copy is retained.`,
                  );
                  if (active) await select(active, false);
                } finally {
                  await checkWorkspace();
                }
              })
            }
            onBackups={() =>
              void run(async () => setBackupEntries(await backups.list()))
            }
          />
        )}
        {backupEntries !== null && (
          <BackupManager
            entries={backupEntries}
            busy={busy}
            available={!!workspaceCatalog.active}
            onClose={() => setBackupEntries(null)}
            onAction={(action, id) =>
              void run(async () => {
                if (action === "create") {
                  await session.current?.flush();
                  const created = await backups.create();
                  setNotice(`Backup created: ${created}`);
                } else if (action === "validate" && id) {
                  await backups.validate(id);
                  setNotice(
                    `Backup verified: ${id}. Database, relationships, and attachment hashes passed.`,
                  );
                } else if (action === "delete" && id) {
                  if (
                    !confirm(
                      `Permanently delete backup “${id}”? This removes only this archive, not any workspace.`,
                    )
                  )
                    return;
                  await backups.delete(id);
                  setNotice(`Deleted backup: ${id}`);
                } else if (action === "restore" && id) {
                  if (
                    !confirm(
                      "Restore this backup into a separate workspace and open it? Your current workspace will be retained.",
                    )
                  )
                    return;
                  await session.current?.flush();
                  const path = await backups.open(id);
                  await reloadWorkspace();
                  setNotice(`Opened restored workspace: ${path}`);
                  return;
                }
                setBackupEntries(await backups.list());
              })
            }
          />
        )}
        {pickingWorkspace && (
          <WorkspacePicker
            catalog={workspaceCatalog}
            busy={busy}
            onClose={() => setPickingWorkspace(false)}
            onOpenExternal={() =>
              void run(async () => {
                await session.current?.flush();
                if (await workspaces.openExternal()) {
                  await reloadWorkspace();
                  setNotice("Opened workspace folder.");
                }
              })
            }
            onRelocate={() =>
              void run(async () => {
                if (
                  !confirm(
                    "Create and open a copy in a new location? The source workspace will be retained as a recovery copy. Later edits to the two copies are independent.",
                  )
                )
                  return;
                await session.current?.flush();
                const path = await workspaces.relocate();
                if (path) {
                  await reloadWorkspace();
                  setNotice(
                    `Workspace relocated to ${path}. The source remains as a recovery copy.`,
                  );
                }
              })
            }
            onSwitch={(id) =>
              void run(async () => {
                await session.current?.flush();
                await workspaces.switch(id);
                await reloadWorkspace();
                setNotice(`Opened ${workspaceName(id)}.`);
              })
            }
          />
        )}
        {trash !== null && (
          <section className="recovery-panel" aria-label="Trash and recovery">
            <h2>Trash & recovery</h2>
            <p>
              Restore notes and whiteboards with their original content,
              attachments, and remaining folder and tag assignments. Existing
              references reconnect to the same document.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run(() => loadTrash(trashQuery));
              }}
            >
              <input
                aria-label="Search Trash"
                value={trashQuery}
                disabled={busy}
                onChange={(event) => setTrashQuery(event.target.value)}
              />
              <button disabled={busy}>Search Trash</button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setTrash(null)}
              >
                Close Trash
              </button>
            </form>
            <div className="trash-list">
              {trash.map((item) => (
                <div className="trash-row" key={item.id}>
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      {item.kind === "note" ? "Note" : "Whiteboard"} · Deleted{" "}
                      {new Date(item.deleted_at).toLocaleString()}
                    </small>
                  </span>
                  <button
                    disabled={busy}
                    aria-label={`Restore ${item.title}`}
                    onClick={() => void run(() => restoreDocument(item))}
                  >
                    Restore
                  </button>
                </div>
              ))}
              {!trash.length && (
                <p>
                  {trashSearch
                    ? "No deleted documents match this search."
                    : "Trash is empty."}
                </p>
              )}
            </div>
            {moreTrash && (
              <button
                disabled={busy}
                onClick={() => void run(() => loadTrash(trashSearch, true))}
              >
                Load more deleted documents
              </button>
            )}
            <p>
              For missing or damaged files, use Check workspace. To recover an
              archived workspace, use Restore backup; it opens a separate
              workspace.
            </p>
          </section>
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
