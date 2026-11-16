import { useEffect, useRef, useState } from "react";
import { ShellIcon, type shellIconPaths } from "./ShellIcon";

export type ColumnNote = { id: string; title: string };
export type ColumnItem = {
  name: string;
  icon: keyof typeof shellIconPaths;
  run: () => void;
};

/** Lists longer than this get a filter field. */
const FILTER_AT = 8;

/**
 * A column's + menu: what can open in the column, where Note drills into
 * the notebook's notes so the person picks which one opens. Lives inside a
 * ShellMenu; buttons marked data-keep-open switch views without closing it.
 */
export function ColumnTabMenu({
  items,
  notes,
  suggested,
  openNote,
  disabled,
}: {
  /** Everything except Note, in menu order; Note goes second. */
  items: ColumnItem[];
  /** Read when the note list opens, so it is current. */
  notes: () => ColumnNote[];
  /** The note Note used to open directly (selected card, last opened). */
  suggested: () => string | null;
  openNote: (id: string) => void;
  disabled: boolean;
}) {
  const [list, setList] = useState<{
    notes: ColumnNote[];
    suggested: string | null;
  } | null>(null);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  // Back to the main list whenever the menu closes.
  useEffect(() => {
    const menu = root.current?.closest("details");
    if (!menu) return;
    const reset = () => {
      if (!menu.open) {
        setList(null);
        setQuery("");
      }
    };
    menu.addEventListener("toggle", reset);
    return () => menu.removeEventListener("toggle", reset);
  }, []);
  // Keyboard users land on the first row of the new view.
  useEffect(() => {
    root.current
      ?.querySelector<HTMLElement>(
        list ? "input, .column-note" : ".column-item-note",
      )
      ?.focus();
  }, [list]);

  if (!list) {
    const [first, ...rest] = items;
    const row = (item: ColumnItem) => (
      <button key={item.name} disabled={disabled} onClick={item.run}>
        <ShellIcon name={item.icon} />
        <span>{item.name}</span>
      </button>
    );
    return (
      <div ref={root} className="column-tab-menu">
        <span className="document-action-heading">Open in this column</span>
        {first && row(first)}
        <button
          className="column-item-note"
          data-keep-open
          aria-haspopup="menu"
          disabled={disabled}
          onClick={() => setList({ notes: notes(), suggested: suggested() })}
        >
          <ShellIcon name="note" />
          <span>Note</span>
          <span className="column-item-more" aria-hidden="true">
            <ShellIcon name="chevron" />
          </span>
        </button>
        {rest.map(row)}
      </div>
    );
  }

  const filter = query.trim().toLowerCase();
  const shown = filter
    ? list.notes.filter((note) => note.title.toLowerCase().includes(filter))
    : list.notes;
  return (
    <div ref={root} className="column-tab-menu">
      <div className="column-note-top">
        <button
          className="column-back"
          data-keep-open
          onClick={() => {
            setList(null);
            setQuery("");
          }}
        >
          <ShellIcon name="back" />
          <span>Open a note</span>
        </button>
        {list.notes.length > FILTER_AT && (
          <input
            className="column-note-filter"
            type="search"
            placeholder="Find a note"
            aria-label="Find a note"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && shown.length) {
                event.preventDefault();
                root.current
                  ?.querySelector<HTMLButtonElement>(".column-note")
                  ?.click();
              }
            }}
          />
        )}
      </div>
      {!list.notes.length && (
        <p className="column-note-empty">This notebook has no notes yet.</p>
      )}
      {!!list.notes.length && !shown.length && (
        <p className="column-note-empty">No notes match.</p>
      )}
      {shown.map((note) => (
        <button
          key={note.id}
          className="column-note"
          disabled={disabled}
          onClick={() => openNote(note.id)}
        >
          <ShellIcon name="note" />
          <span className="column-note-title">{note.title}</span>
          {note.id === list.suggested && (
            <span className="column-note-hint">Current</span>
          )}
        </button>
      ))}
    </div>
  );
}
