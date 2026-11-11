import { useEffect, useRef, type ReactNode } from "react";

export const surfaceTitles = {
  ask: "Ask Knot",
  cardDeck: "Card Deck",
  settings: "Settings",
  editorSettings: "Editor",
  aiSettings: "AI",
  workspaceSettings: "Workspace",
  backlinks: "Backlinks",
  reference: "Links",
  pdf: "PDF reader",
  browser: "Browser",
  export: "Export document",
  library: "Library",
  search: "Library search",
  workspace: "Workspaces",
  backups: "Backups",
  trash: "Trash & recovery",
  integrity: "Workspace health",
  quarantine: "File recovery",
};
export type SurfaceKind = keyof typeof surfaceTitles;
export const managementSurfaces = new Set<SurfaceKind>([
  "settings",
  "editorSettings",
  "aiSettings",
  "workspaceSettings",
  "workspace",
  "backups",
  "trash",
  "integrity",
  "quarantine",
]);

/** A single surface owns focus and sizing; the editor remains mounted beside it. */
export function ToolSurface({
  kind,
  title,
  busy,
  width,
  onWidth,
  onClose,
  children,
  navigation,
}: {
  kind: SurfaceKind | null;
  title: string;
  busy: boolean;
  width: number;
  onWidth: (width: number) => void;
  onClose: () => void;
  children: ReactNode;
  navigation?: ReactNode;
}) {
  const root = useRef<HTMLElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const isModal = !!kind && managementSurfaces.has(kind);
  useEffect(() => {
    if (!isModal) return;
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, [isModal]);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (kind && !busy && !root.current?.contains(document.activeElement))
      (
        close.current ??
        root.current?.querySelector<HTMLButtonElement>("[data-panel-close]")
      )?.focus();
  }, [kind, busy]);
  if (!kind) return null;
  const isManagement = managementSurfaces.has(kind);
  const maxWidth = kind === "pdf" || kind === "browser" ? 1000 : 600;
  const resize = (value: number) => {
    const available = root.current?.parentElement?.clientWidth ?? 1000;
    onWidth(Math.max(320, Math.min(maxWidth, available * 0.55, value)));
  };
  const content = (
    <aside
      ref={root}
      className={`tool-surface ${kind === "workspace" ? "workspace-surface" : ""} ${isManagement ? "management-surface" : "context-surface"} ${isModal ? "settings-modal-surface" : ""}`}
      aria-label={`${title} surface`}
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          !busy &&
          !document.querySelector(".shell-menu[open]") &&
          !document.querySelector("dialog[open]")
        ) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      {!isManagement && (
        <div
          className="panel-resizer"
          role="separator"
          tabIndex={0}
          aria-label="Resize contextual panel"
          aria-orientation="vertical"
          aria-valuemin={320}
          aria-valuemax={maxWidth}
          aria-valuenow={width}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              resize(width + (event.key === "ArrowLeft" ? 24 : -24));
            }
          }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              resize(
                (root.current?.getBoundingClientRect().right ?? 0) -
                  event.clientX,
              );
          }}
          onPointerUp={(event) =>
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
        />
      )}
      {kind !== "ask" && kind !== "browser" && (
        <div className="surface-heading">
          <h2>{isModal && navigation ? "Settings" : title}</h2>
          <button
            ref={close}
            disabled={busy}
            onClick={onClose}
            aria-label={`Close ${title} panel`}
          >
            {isModal || kind === "pdf" || kind === "cardDeck" ? (
              <span aria-hidden="true">&times;</span>
            ) : isManagement ? (
              "← Back to document"
            ) : (
              "Close"
            )}
          </button>
        </div>
      )}
      <div className="surface-layout">
        {isManagement && navigation}
        <div className="surface-body">{children}</div>
      </div>
    </aside>
  );
  return isModal ? (
    <dialog
      ref={dialog}
      className={`settings-modal${navigation ? "" : " standalone-modal"}`}
      aria-label={navigation ? "Settings" : title}
      aria-busy={busy}
      onKeyDown={(event) => {
        if (
          event.key !== "Tab" ||
          event.defaultPrevented ||
          (event.target as Element).closest("dialog") !== event.currentTarget
        )
          return;
        const items = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
          ),
        ).filter((element) => element.getClientRects().length > 0);
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget || busy) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          onClose();
      }}
    >
      {content}
    </dialog>
  ) : (
    content
  );
}
