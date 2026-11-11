import { useEffect, useMemo, useRef, useState } from "react";
import { ShellIcon } from "./ShellIcon";
import {
  knotbooks,
  type KnowledgeObject,
  type Snapshot,
} from "../services/workspace";
import {
  planShare,
  savedShareInfo,
  type SavedShareInfo,
  type ShareRow,
} from "../services/knotbook-share";

const NAME_KEY = "knot.share.name";
const readName = () => {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
};
const saveName = (name: string) => {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* Remembered for this session only. */
  }
};
function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/** Share as file: choose notebooks, then save a .knotbook (NOTEBOOK-SHARING-PLAN.md). */
export function ShareNotebookDialog({
  root,
  catalog,
  load,
  prepare,
  onClose,
  onSaved,
}: {
  root: { id: string; title: string };
  catalog: () => Promise<KnowledgeObject[]>;
  load: (id: string) => Promise<Snapshot | null>;
  /** Saves pending edits so the share reads what's on screen. */
  prepare: () => Promise<void>;
  onClose: () => void;
  onSaved: (filename: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [titles, setTitles] = useState<Map<string, string> | null>(null);
  const [info, setInfo] = useState(new Map<string, SavedShareInfo>());
  const [ticked, setTicked] = useState(new Set<string>());
  const [unticked, setUnticked] = useState(new Set<string>());
  const [name, setName] = useState(readName);
  const [size, setSize] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    cancel.current?.focus();
    return () => {
      element.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  // Read every notebook reachable from the root once; the list is then
  // recomputed locally as boxes are ticked.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await prepare();
        const rows = await catalog();
        const live = new Map(
          rows.map((row) => [row.id, row.title || "Untitled"]),
        );
        const found = new Map<string, SavedShareInfo>();
        const queue = [root.id];
        while (queue.length && found.size < 500) {
          const id = queue.shift()!;
          if (found.has(id) || !live.has(id)) continue;
          const snapshot = await load(id);
          let entry: SavedShareInfo = { refs: new Map(), cards: new Set() };
          try {
            if (snapshot) entry = savedShareInfo(id, snapshot);
          } catch {
            /* Unreadable notebooks are shared as stored, without their links. */
          }
          found.set(id, entry);
          for (const target of entry.refs.keys()) queue.push(target);
        }
        if (cancelled) return;
        live.set(root.id, root.title || live.get(root.id) || "Untitled");
        setTitles(live);
        setInfo(found);
      } catch (cause) {
        if (!cancelled)
          setError(`Couldn't read this notebook. ${String(cause)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const plan = useMemo(
    () => (titles ? planShare(root.id, titles, info, ticked, unticked) : null),
    [titles, info, ticked, unticked],
  );

  useEffect(() => {
    if (!plan) return;
    let current = true;
    setSize(null);
    const timer = window.setTimeout(() => {
      void knotbooks
        .size(plan.selected, plan.cards)
        .then((bytes) => current && setSize(bytes))
        .catch(() => {});
    }, 150);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [plan]);

  const toggle = (row: ShareRow) => {
    if (row.locked) return;
    const flip = (set: Set<string>) => {
      const next = new Set(set);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    };
    if (row.reason === "canvas") setUnticked(flip);
    else setTicked(flip);
  };

  const count = plan?.selected.length ?? 0;
  const trimmed = name.trim();
  const save = async () => {
    if (!plan || !trimmed) return;
    setSaving(true);
    setError("");
    try {
      saveName(trimmed);
      const saved = await knotbooks.export({
        title: root.title,
        entries: plan.selected,
        cards: plan.cards,
        unshared: plan.unshared,
        sharedBy: trimmed,
      });
      if (saved) onSaved(saved);
      else setSaving(false);
    } catch (cause) {
      setError(String(cause));
      setSaving(false);
    }
  };

  const renderRows = (section: ShareRow["section"]) =>
    plan?.rows
      .filter((row) => row.section === section)
      .map((row) => (
        <label
          key={row.id}
          className="share-row"
          style={{ paddingInlineStart: 3 + row.depth * 22 }}
        >
          <input
            type="checkbox"
            checked={row.checked}
            disabled={row.locked || saving}
            onChange={() => toggle(row)}
          />
          <ShellIcon name="notebook" />
          <span className="share-row-title">{row.title}</span>
          {row.reason !== "root" && (
            <span className="share-row-reason">
              {row.reason === "canvas" ? "On canvas" : "Link"}
            </span>
          )}
        </label>
      ));
  const linked = plan?.rows.some((row) => row.section === "linked");

  return (
    <dialog
      ref={dialog}
      className="trash-confirmation share-dialog"
      aria-labelledby="share-title"
      aria-describedby="share-description"
      aria-busy={!plan || saving}
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
    >
      <div className="confirmation-icon">
        <ShellIcon name="share" />
      </div>
      <h2 id="share-title">Share “{root.title || "Untitled"}”</h2>
      <p id="share-description">
        Saves a .knotbook file anyone with Knot can open.
      </p>

      {!plan && !error && <p className="share-loading">Reading notebooks…</p>}
      {plan && (
        <>
          <div className="share-list">
            <span className="share-section">Included</span>
            {renderRows("included")}
            {linked && <span className="share-section">Linked</span>}
            {renderRows("linked")}
          </div>
          {/* Outside the scrolling list so its border and focus ring aren't clipped. */}
          <label className="share-name">
            <span>Your name</span>
            <input
              value={name}
              maxLength={80}
              disabled={saving}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        </>
      )}
      {error && <p role="alert">{error}</p>}

      <div className="trash-actions share-actions">
        <span className="share-summary" aria-live="polite">
          {plan &&
            `${count} ${count === 1 ? "notebook" : "notebooks"}${size === null ? "" : ` · ${formatSize(size)}`}`}
        </span>
        <button ref={cancel} disabled={saving} onClick={onClose}>
          Cancel
        </button>
        <button
          className="primary"
          disabled={!plan || !trimmed || saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save…"}
        </button>
      </div>
    </dialog>
  );
}
