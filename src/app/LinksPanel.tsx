import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type {
  EditorSession,
  NotebookLinkPlacement,
} from "../features/editor/blocksuite/adapter";
import type { KnowledgeObject } from "../services/workspace";
import { ShellIcon } from "./ShellIcon";

type Preview = NonNullable<ReturnType<EditorSession["referencePlacement"]>>;
type Point = { x: number; y: number };
export type LinksView = "add" | "backlinks";
const linkMime = "application/x-knot-notebook-link";

export function LinksPanel({
  session,
  notebooks,
  mode,
  enabled,
  view,
  count,
  onView,
  onPlace,
  children,
}: {
  session: EditorSession;
  notebooks: KnowledgeObject[];
  mode: "page" | "edgeless";
  enabled: boolean;
  view: LinksView;
  count?: number;
  onView: (view: LinksView) => void;
  onPlace: (id: string, placement: NotebookLinkPlacement) => void;
  children: ReactNode;
}) {
  const tabs = useId();
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<{
    target: KnowledgeObject;
    placement: Preview;
  }>();
  const [placing, setPlacing] = useState(false);
  const placement = useRef<{ target: KnowledgeObject; point?: Point }>();
  const apply = useRef(onPlace);
  apply.current = onPlace;
  const cancel = () => {
    placement.current = undefined;
    setPreview(undefined);
    setPlacing(false);
  };
  const update = (point: Point) => {
    const current = placement.current;
    if (!current) return;
    current.point = point;
    const result = session.referencePlacement(point);
    setPreview(
      result ? { target: current.target, placement: result } : undefined,
    );
    return result;
  };
  const updateRef = useRef(update);
  updateRef.current = update;
  useEffect(() => {
    cancel();
    if (!enabled || view !== "add") return;
    const { editor } = session;
    const pointer = (event: MouseEvent) => ({
      x: event.clientX,
      y: event.clientY,
    });
    const commit = (point: Point) => {
      const target = placement.current?.target;
      const result = updateRef.current(point);
      cancel();
      if (target && result) apply.current(target.id, result);
    };
    const dragOver = (event: DragEvent) => {
      if (!placement.current || !event.dataTransfer?.types.includes(linkMime))
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      event.dataTransfer.dropEffect = "copy";
      updateRef.current(pointer(event));
    };
    const drop = (event: DragEvent) => {
      if (
        event.dataTransfer?.getData(linkMime) !==
          placement.current?.target.id ||
        !placement.current
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      commit(pointer(event));
    };
    const leave = (event: DragEvent) => {
      if (
        !(event.relatedTarget instanceof Node) ||
        !editor.contains(event.relatedTarget)
      )
        setPreview(undefined);
    };
    const move = (event: PointerEvent) => {
      if (placement.current?.point) updateRef.current(pointer(event));
    };
    const click = (event: MouseEvent) => {
      if (!placement.current?.point) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      commit(pointer(event));
    };
    const key = (event: KeyboardEvent) => {
      const point = placement.current?.point;
      if (!placement.current) return;
      if (event.key === "Escape") cancel();
      else if (point && event.key === "Enter") commit(point);
      else if (
        point &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      ) {
        updateRef.current({
          x: Math.min(
            editor.getBoundingClientRect().right - 1,
            Math.max(
              editor.getBoundingClientRect().left + 1,
              point.x +
                (event.key === "ArrowRight"
                  ? 20
                  : event.key === "ArrowLeft"
                    ? -20
                    : 0),
            ),
          ),
          y: Math.min(
            editor.getBoundingClientRect().bottom - 1,
            Math.max(
              editor.getBoundingClientRect().top + 1,
              point.y +
                (event.key === "ArrowDown"
                  ? 20
                  : event.key === "ArrowUp"
                    ? -20
                    : 0),
            ),
          ),
        });
      } else return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    editor.addEventListener("dragover", dragOver, true);
    editor.addEventListener("drop", drop, true);
    editor.addEventListener("dragleave", leave);
    editor.addEventListener("pointermove", move, true);
    editor.addEventListener("click", click, true);
    window.addEventListener("keydown", key, true);
    return () => {
      editor.removeEventListener("dragover", dragOver, true);
      editor.removeEventListener("drop", drop, true);
      editor.removeEventListener("dragleave", leave);
      editor.removeEventListener("pointermove", move, true);
      editor.removeEventListener("click", click, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [session, mode, enabled, view]);
  const rows = notebooks.filter(({ title }) =>
    title.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <section className="links-panel" aria-label="Notebook links">
      <div className="links-views" role="tablist" aria-label="Links views">
        {(["add", "backlinks"] as const).map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            id={tabs + item}
            aria-selected={view === item}
            tabIndex={view === item ? 0 : -1}
            aria-controls={tabs + item + "-panel"}
            onClick={() => onView(item)}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
              event.preventDefault();
              const other = item === "add" ? "backlinks" : "add";
              onView(other);
              document.getElementById(tabs + other)?.focus();
            }}
          >
            {item === "add" ? "Add link" : "Backlinks"}
            {item === "backlinks" && count ? <small>{count}</small> : null}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={tabs + "add-panel"}
        aria-labelledby={tabs + "add"}
        hidden={view !== "add"}
      >
        <label className="links-search">
          <ShellIcon name="search" />
          <input
            type="search"
            aria-label="Find a notebook"
            placeholder="Find a notebook…"
            value={query}
            onChange={(event) => {
              cancel();
              setQuery(event.target.value);
            }}
          />
        </label>
        <p className="links-help" role="status">
          {placing
            ? "Choose a position. Arrow keys move the preview, Enter places it, and Escape cancels."
            : mode === "edgeless"
              ? "Drag a notebook onto the canvas."
              : "Drag a notebook between blocks."}
        </p>
        {rows.map((target) => (
          <button
            type="button"
            className="links-notebook"
            key={target.id}
            draggable={enabled}
            disabled={!enabled}
            aria-label={`Place link to ${target.title}`}
            data-tooltip={target.title}
            onDragStart={(event) => {
              cancel();
              placement.current = { target };
              event.dataTransfer.setData(linkMime, target.id);
              event.dataTransfer.effectAllowed = "copy";
              const image = document.createElement("canvas");
              image.width = image.height = 1;
              event.dataTransfer.setDragImage(image, 0, 0);
            }}
            onDragEnd={cancel}
            onClick={() => {
              const bounds = session.editor.getBoundingClientRect();
              placement.current = { target };
              setPlacing(true);
              update({
                x: bounds.left + bounds.width / 2,
                y: bounds.top + bounds.height / 2,
              });
            }}
          >
            <ShellIcon name="notebook" />
            <span>{target.title}</span>
            <ShellIcon name="gripVertical" />
          </button>
        ))}
        {!rows.length && (
          <p className="links-help">
            {query
              ? "No notebooks found."
              : "Create another notebook to link to it."}
          </p>
        )}
      </div>
      <div
        role="tabpanel"
        id={tabs + "backlinks-panel"}
        aria-labelledby={tabs + "backlinks"}
        hidden={view !== "backlinks"}
      >
        {children}
      </div>
      {enabled &&
        preview &&
        createPortal(
          <div
            aria-hidden="true"
            className={`notebook-link-preview ${preview.placement.kind}`}
            style={preview.placement.preview}
          >
            {preview.placement.kind === "edgeless" && (
              <>
                <ShellIcon name="notebook" />
                <span className="notebook-link-title">
                  <strong>{preview.target.title}</strong>
                  <small>Notebook link</small>
                </span>
                <ShellIcon name="external" />
              </>
            )}
          </div>,
          document.body,
        )}
    </section>
  );
}
