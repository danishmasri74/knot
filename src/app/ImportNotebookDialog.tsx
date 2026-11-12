import { useEffect, useMemo, useRef, useState } from "react";
import { ShellIcon } from "./ShellIcon";
import { ChoicePopover } from "./ChoicePopover";
import type { Collection } from "../services/workspace";
import {
  buildImport,
  type ImportChoice,
  type InspectedPackage,
} from "../services/knotbook-import";

export type InspectReply =
  | { status: "ready"; package: InspectedPackage }
  | {
      status: "blocked";
      reason:
        | { kind: "newer"; needed: string; current: string }
        | { kind: "backup" }
        | { kind: "invalid"; reason: string };
    };

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}
function formatDate(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
const KEEP = "Keep both";
const REPLACE = "Replace mine";

/** The import dialog from the sharing designs (NOTEBOOK-SHARING-PLAN.md). */
export function ImportNotebookDialog({
  inspect,
  collections,
  context,
  onImport,
  onClose,
  onOpenUpdates,
  onOpenBackups,
}: {
  inspect: () => Promise<InspectReply>;
  collections: Collection[];
  /** The recipient's card deck and Library titles, for conflicts and names. */
  context: () => Promise<{
    deck: Record<string, unknown>;
    titles: Set<string>;
  }>;
  onImport: (
    plan: ReturnType<typeof buildImport>,
    collection: string | null,
  ) => Promise<void>;
  onClose: () => void;
  onOpenUpdates: () => void;
  onOpenBackups: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [reply, setReply] = useState<InspectReply | null>(null);
  const [choices, setChoices] = useState(new Map<string, ImportChoice>());
  const [collection, setCollection] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
  useEffect(() => {
    let current = true;
    inspect()
      .then((result) => {
        if (!current) return;
        setReply(result);
        if (result.status === "ready")
          setChoices(
            new Map(
              result.package.notebooks.map((n) => [
                n.id,
                // Identical notebooks are skipped unless chosen.
                { include: n.status !== "current", replace: false },
              ]),
            ),
          );
      })
      .catch((cause) => current && setError(String(cause)));
    return () => {
      current = false;
    };
  }, []);

  const pkg = reply?.status === "ready" ? reply.package : null;
  const rows = useMemo(() => {
    if (!pkg) return [];
    const byId = new Map(pkg.manifest.notebooks.map((n) => [n.id, n]));
    const depth = (id: string, seen = new Set<string>()): number => {
      const parent = byId.get(id)?.parent;
      if (!parent || !byId.has(parent) || seen.has(id)) return 0;
      seen.add(id);
      return 1 + depth(parent, seen);
    };
    const status = new Map(pkg.notebooks.map((n) => [n.id, n.status]));
    return pkg.manifest.notebooks.map((n) => ({
      ...n,
      depth: depth(n.id),
      status: status.get(n.id)!,
    }));
  }, [pkg]);
  const count = [...choices.values()].filter((c) => c.include).length;
  const setChoice = (id: string, change: Partial<ImportChoice>) =>
    setChoices((previous) => {
      const next = new Map(previous);
      next.set(id, { ...next.get(id)!, ...change });
      return next;
    });
  const setAll = (include: boolean) =>
    setChoices((previous) => {
      const next = new Map(previous);
      for (const [id, choice] of next) next.set(id, { ...choice, include });
      return next;
    });

  const submit = async () => {
    if (!pkg || !count) return;
    setBusy(true);
    setError("");
    try {
      const { deck, titles } = await context();
      await onImport(buildImport(pkg, choices, deck, titles), collection);
    } catch (cause) {
      setError(String(cause));
      setBusy(false);
    }
  };

  const blocked = reply?.status === "blocked" ? reply.reason : null;
  const title = pkg
    ? `Import “${pkg.manifest.notebooks.find((n) => n.id === pkg.manifest.root)?.title ?? "notebook"}”`
    : blocked?.kind === "newer"
      ? "Update Knot first"
      : blocked
        ? "Can't open this file"
        : "Import notebook";
  const description = pkg
    ? `From ${pkg.manifest.sharedBy} · ${formatDate(pkg.manifest.exportedAt)}`
    : blocked?.kind === "newer"
      ? `This file needs Knot ${blocked.needed}. You have ${blocked.current}.`
      : blocked?.kind === "backup"
        ? "This is a full workspace backup. Use Restore backup in Settings → Backups."
        : blocked
          ? "It's damaged or incomplete. Ask for it again."
          : "Checking the file…";
  const collectionNames = ["None", ...collections.map((c) => c.name)];

  return (
    <dialog
      ref={dialog}
      className="trash-confirmation share-dialog"
      aria-labelledby="import-title"
      aria-describedby="import-description"
      aria-busy={!reply || busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="confirmation-icon">
        <ShellIcon name={blocked?.kind === "newer" ? "refresh" : "import"} />
      </div>
      <h2 id="import-title">{title}</h2>
      <p id="import-description">{description}</p>

      {pkg && (
        <>
          <div className="share-list">
            <div className="share-section share-section-row">
              <span>Notebooks</span>
              {rows.length > 2 && (
                <span className="share-bulk">
                  <button disabled={busy} onClick={() => setAll(true)}>
                    All
                  </button>
                  <button disabled={busy} onClick={() => setAll(false)}>
                    None
                  </button>
                </span>
              )}
            </div>
            {rows.map((row) => {
              const choice = choices.get(row.id);
              return (
                <div
                  key={row.id}
                  className="share-row"
                  style={{ paddingInlineStart: 3 + row.depth * 22 }}
                >
                  <input
                    id={`import-${row.id}`}
                    type="checkbox"
                    checked={!!choice?.include}
                    disabled={busy}
                    onChange={(event) =>
                      setChoice(row.id, { include: event.target.checked })
                    }
                  />
                  <ShellIcon name="notebook" />
                  <label
                    htmlFor={`import-${row.id}`}
                    className="share-row-title"
                  >
                    {row.title}
                  </label>
                  {row.status === "library" ? (
                    <ChoicePopover
                      label={`${row.title} is already in your Library`}
                      className="import-choice"
                      value={choice?.replace ? REPLACE : KEEP}
                      options={[KEEP, REPLACE]}
                      disabled={busy || !choice?.include}
                      onChange={(value) =>
                        setChoice(row.id, { replace: value === REPLACE })
                      }
                    />
                  ) : (
                    <span className="import-tag">
                      {row.status === "new" ? "New" : "Up to date"}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {pkg.manifest.unshared.length > 0 && (
            <p className="share-note">
              {pkg.manifest.unshared.length === 1
                ? "1 linked notebook wasn't shared."
                : `${pkg.manifest.unshared.length} linked notebooks weren't shared.`}
            </p>
          )}
          {collections.length > 0 && (
            <label className="share-name">
              <span>Collection</span>
              <select
                value={collection ?? ""}
                disabled={busy}
                onChange={(event) => setCollection(event.target.value || null)}
              >
                <option value="">{collectionNames[0]}</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}

      <div className="trash-actions share-actions">
        <span className="share-summary">{pkg ? formatSize(pkg.size) : ""}</span>
        {blocked ? (
          <>
            {blocked.kind === "newer" && (
              <button ref={cancel} onClick={onClose}>
                Not now
              </button>
            )}
            <button
              ref={blocked.kind === "newer" ? undefined : cancel}
              className="primary"
              onClick={
                blocked.kind === "newer"
                  ? onOpenUpdates
                  : blocked.kind === "backup"
                    ? onOpenBackups
                    : onClose
              }
            >
              {blocked.kind === "newer"
                ? "Open Updates"
                : blocked.kind === "backup"
                  ? "Open Backups"
                  : "Close"}
            </button>
          </>
        ) : (
          <>
            <button ref={cancel} disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={!pkg || !count || busy}
              onClick={() => void submit()}
            >
              {busy ? "Importing…" : count ? `Import ${count}` : "Import"}
            </button>
          </>
        )}
      </div>
    </dialog>
  );
}
