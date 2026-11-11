import { Mascot } from "./Mascot";
import { useEffect, useState } from "react";
import {
  editorFontFamily,
  getEditorPreferences,
} from "../services/editor-preferences";
import "../styles/view-transition.css";
const tips = [
  "Select one note card on the canvas and press Ctrl+Enter to open it in Page view.",
  "Use the collapsible table of contents to jump to a note on the canvas.",
  "Give a note a title you would actually type when searching for it.",
  "Leave a question at the end of a note. It gives you a place to start next time.",
  "Try placing two related cards side by side. The gap between them can be a good spot for a question.",
  "Use Favorites for the notebook you keep reaching for.",
  "When a note gets crowded, give the next idea a card of its own.",
  "Use Page when you want to follow one idea. Switch to Canvas to see what sits around it.",
  "A collection can keep the notebooks for one project together.",
];
let bag: string[] = [];
let previous = "";
function nextTip() {
  if (!bag.length) {
    bag = [...tips];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    if (bag.at(-1) === previous)
      [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
  }
  previous = bag.pop()!;
  return previous;
}

export function ViewTransition({
  view,
  done,
}: {
  view: "page" | "edgeless";
  done: boolean;
}) {
  const [tip, setTip] = useState(nextTip);
  const preferences = getEditorPreferences();
  useEffect(() => {
    const timer = window.setInterval(() => setTip(nextTip()), 6500);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div
      className={`view-transition ${view === "edgeless" ? "spread" : done ? "" : "gathering"} ${done ? "done settling" : ""}`}
    >
      <Mascot mood="sleep" />
      <span role="status">
        Opening {view === "edgeless" ? "Canvas" : "Page"}…
      </span>
      <div className="signal" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <aside
        className="loading-tip"
        aria-label="Notebook tip"
        style={{
          fontFamily: editorFontFamily(preferences),
          fontSize: preferences.fontSize,
        }}
      >
        {tip}
      </aside>
    </div>
  );
}
