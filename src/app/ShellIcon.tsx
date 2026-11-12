const folderBack = "M3 18V7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1";
const folderFront = "M3 10 L21 10 L21 18 Q21 20 19 20 L5 20 Q3 20 3 18 Z";

export const shellIconPaths = {
  globe:
    "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M12 3c5 5 5 13 0 18 M12 3c-5 5-5 13 0 18",
  external: "M14 3h7v7 M21 3L10 14 M10 3H3v18h18v-7",
  expand: "M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5",
  pin: "M16 3l5 5-4 1-4 4v4l-2 2-6-6 2-2h4l4-4 1-4z M8 16l-5 5",
  library: "M12 3L2 8l10 5 10-5-10-5z M2 12l10 5 10-5 M2 16l10 5 10-5",
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  list: "M8 5h13 M8 12h13 M8 19h13 M3 5h.01 M3 12h.01 M3 19h.01",
  more: "M5 12h.01 M12 12h.01 M19 12h.01",
  calendar: "M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16 M8 14h2 M14 14h2 M8 17h2",
  sortAlpha: "M3 10l3-7 3 7 M4 8h4 M3 14h6l-6 7h6 M17 3v18 M13 17l4 4 4-4",
  filter: "M4 6h16 M7 12h10 M10 18h4",
  history: "M3 8l2.26-2.26A9 9 0 1 1 3 12 M3 3v5h5 M12 7v5l3 2",
  copy: "M9 9h12v12H9z M5 15H3V3h12v2",
  cardPlus:
    "M20 11V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6 M7 7h9 M7 11h5 M18 14v8 M14 18h8",
  check: "M5 12l4 4L19 6",
  circle: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  sparkles:
    "M10 3l2.4 6.6L19 12l-6.6 2.4L10 21l-2.4-6.6L1 12l6.6-2.4L10 3z M20 2v6 M17 5h6",
  close: "M6 6l12 12 M18 6L6 18",
  arrowUp: "M12 19V5 M6 11l6-6 6 6",
  refresh: "M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8 M21 3v5h-5",
  locate:
    "M8 3H3v5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0",
  star: "M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3z",
  rename: "M4 20l4-1L20 7l-3-3L5 16l-1 4z M14 7l3 3",
  plus: "M12 5v14 M5 12h14",
  attach:
    "M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48",
  link: "M10 13a5 5 0 0 0 7 0l4-4a5 5 0 0 0-7-7l-3 3 M14 11a5 5 0 0 0-7 0l-4 4a5 5 0 0 0 7 7l3-3",
  backlinks: "M9 5l-5 5 5 5 M4 10h10a6 6 0 0 1 6 6v4 M4 21h9",
  eraser:
    "M3 14l10-10a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-8 8H9l-6-6z M7 10l9 9 M12 20h9",
  highlight: "M4 16l10-12 6 5-10 12-6-5z M3 21h7 M12 6l6 5",
  export: "M12 15V3 M7 8l5-5 5 5 M4 14v7h16v-7",
  undo: "M9 5L4 10l5 5 M4 10h9a7 7 0 0 1 7 7v2",
  redo: "M15 5l5 5-5 5 M20 10h-9a7 7 0 0 0-7 7v2",
  trash: "M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7",
  // Object icons are semantic: note = page, notebook = bound book, folder = collection.
  notebook:
    "M6 3h13a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6V3z M6 3H3v18h3 M9 7h8 M9 11h5",
  folder: `${folderBack} ${folderFront}`,
  workspace: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  backup: "M4 4h16v5H4z M6 9v12h12V9 M10 13h4",
  note: "M6 3h9l3 3v15H6z M14 3v5h4 M9 12h6 M9 16h6",
  multipleChoice:
    "M8 5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z M8 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z M8 19a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z M5.5 12h.01 M12 5h9 M12 12h9 M12 19h9",
  pdf: "M6 3h9l3 3v15H6z M14 3v5h4 M10 16c3-2 4-7 2-6-2 1 1 7 4 5 1-1-4-1-6 1-2 2 0 2 0 0z",
  cardDeck:
    "M7 3h10 M5 6h14 M5 9h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z M7 13h10 M7 17h6",
  board: "M3 4h18v13H3z M8 21l4-4 4 4",
  search: "M15 15l6 6 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
  back: "M14 5l-7 7 7 7",
  forward: "M10 5l7 7-7 7",
  sidebar: "M3 3h18v18H3z M9 3v18",
  gripVertical: "M9 5h.01 M15 5h.01 M9 12h.01 M15 12h.01 M9 19h.01 M15 19h.01",
  columns: "M3 3h18v18H3z M13 3v18 M17 3v18",
  chevron: "M9 5l7 7-7 7",
  options: "M4 7h16 M4 17h16 M8 4v6 M16 14v6",
  share: "M6 3h13a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6V3z M6 3H3v18h3 M13 15V9 M10 12l3-3 3 3",
  import: "M6 3h13a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6V3z M6 3H3v18h3 M13 9v6 M10 12l3 3 3-3",
} as const;

export function ShellIcon({
  name,
  size,
  expanded,
}: {
  name: keyof typeof shellIconPaths;
  size?: number;
  expanded?: boolean;
}) {
  return (
    <svg
      className="shell-icon"
      data-icon={name}
      data-expanded={
        name === "folder" || name === "notebook" ? expanded : undefined
      }
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "folder" && expanded !== undefined ? (
        <>
          <path d={folderBack} />
          <path className="folder-front" d={folderFront} />
        </>
      ) : name === "notebook" && expanded !== undefined ? (
        <g className="notebook-binding">
          <path className="notebook-spine" d="M12 3H9v18h3" />
          <g className="notebook-pages">
            <path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7Z M15 7h3 M15 11h3" />
          </g>
          <g className="notebook-cover">
            <path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7Z M15 7h3 M15 11h2" />
          </g>
        </g>
      ) : (
        <path d={shellIconPaths[name]} />
      )}
    </svg>
  );
}
