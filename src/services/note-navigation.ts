export type NoteView = "page" | "edgeless";
const preferenceKey = "knot.note-view";
let sessionView: NoteView | undefined;

export function getNoteView(): NoteView {
  if (sessionView) return sessionView;
  try {
    return localStorage.getItem(preferenceKey) === "edgeless" ? "edgeless" : "page";
  } catch {
    return "page";
  }
}

export function setNoteView(view: NoteView) {
  sessionView = view;
  try {
    localStorage.setItem(preferenceKey, view);
  } catch {
    /* Keep the preference for this session when storage is unavailable. */
  }
}
