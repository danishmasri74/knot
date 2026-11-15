import type { NoteView } from "./note-navigation";

export type StartupDestination = "library" | "last-notebook";
const destinationKey = "knot.startup-destination";
const notebookKey = (workspace: string) => `knot.last-notebook:${workspace}`;

export function getStartupDestination(): StartupDestination {
  try {
    if (localStorage.getItem(destinationKey) === "last-notebook")
      return "last-notebook";
  } catch {
    // Storage can be unavailable.
  }
  return "library";
}

export function setStartupDestination(destination: StartupDestination) {
  localStorage.setItem(destinationKey, destination);
}

export function readLastNotebook(
  workspace: string,
): { id: string; view: NoteView } | null {
  try {
    const last = JSON.parse(
      localStorage.getItem(notebookKey(workspace)) ?? "null",
    );
    if (
      typeof last?.id === "string" &&
      (last.view === "page" || last.view === "edgeless")
    )
      return { id: last.id, view: last.view };
  } catch {
    // Fall back to Library for missing or unreadable preferences.
  }
  return null;
}

export function rememberLastNotebook(
  workspace: string,
  id: string,
  view: NoteView,
) {
  try {
    localStorage.setItem(notebookKey(workspace), JSON.stringify({ id, view }));
  } catch {
    // Opening a notebook still works without preference storage.
  }
}
