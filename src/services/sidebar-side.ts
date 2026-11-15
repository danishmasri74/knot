/** Which side of the window the sidebar sits on. */
export type SidebarSide = "left" | "right";
const preferenceKey = "knot.sidebar.side";
let sessionSide: SidebarSide | undefined;

export function getSidebarSide(): SidebarSide {
  if (sessionSide) return sessionSide;
  try {
    return localStorage.getItem(preferenceKey) === "right" ? "right" : "left";
  } catch {
    return "left";
  }
}

export function setSidebarSide(side: SidebarSide) {
  sessionSide = side;
  try {
    localStorage.setItem(preferenceKey, side);
  } catch {
    /* Keep the preference for this session when storage is unavailable. */
  }
}
