import { useEffect, useRef, useState } from "react";

import type { AffineEditorContainer } from "@blocksuite/presets";
import { ShellIcon } from "./ShellIcon";
import { ShellMenu } from "./ShellMenu";
import { structuredAiBlocks } from "../features/editor/blocksuite/ai";
import {
  cardActions,
  qualifiedActions,
  type CardAction,
} from "../features/editor/blocksuite/card-suggestions";

type Tip = {
  id: string;
  actions: CardAction[];
  x: number;
  y: number;
  alignMenuRight: boolean;
  openMenuAbove: boolean;
};

type HiddenSuggestions = Record<string, string>;
const suggestionKey = (id: string, action: CardAction) =>
  JSON.stringify([id, action]);

function readHidden(key: string): HiddenSuggestions {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? "{}");
    // Older builds stored card IDs for the only suggestion available then.
    if (Array.isArray(stored))
      return Object.fromEntries(
        stored
          .filter((id) => typeof id === "string")
          .map((id) => [suggestionKey(id, "improve"), "always"]),
      );
    const today = new Date().toDateString();
    return Object.fromEntries(
      Object.entries(stored).filter(
        ([, until]) => until === "always" || until === today,
      ),
    ) as HiddenSuggestions;
  } catch {
    return {};
  }
}

export function CanvasSuggestions({
  editor,
  workspace,
  disabled,
  onStart,
}: {
  editor: AffineEditorContainer;
  workspace: string;
  disabled: boolean;
  onStart: (id: string, action: CardAction) => void;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const [tips, setTips] = useState<Tip[]>([]);
  const key = JSON.stringify([
    "knot.card-suggestions.dismissed",
    workspace,
    editor.doc.id,
  ]);
  const [hidden, setHidden] = useState(() => readHidden(key));

  function hide(id: string, actions: CardAction[], duration: string) {
    const next = { ...hidden };
    for (const action of actions) next[suggestionKey(id, action)] = duration;
    setHidden(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* Keep the choice for this visit when storage is unavailable. */
    }
  }
  useEffect(() => {
    let frame = 0;
    let stopped = false;
    let candidates = new Map<string, CardAction[]>();
    const qualify = () => {
      candidates = new Map();
      for (const { model } of editor.doc.getBlocksByFlavour("affine:note")) {
        const actions = qualifiedActions(
          structuredAiBlocks(model),
          editor.doc.id,
        ).filter((action) => !hidden[suggestionKey(model.id, action)]);
        if (actions.length) candidates.set(model.id, actions);
      }
      schedule();
    };
    function layout() {
      frame = 0;
      const bounds = editor.getBoundingClientRect();
      const parent = layer.current?.offsetParent;
      if (!layer.current || !parent) return;
      const origin = parent.getBoundingClientRect();
      Object.assign(layer.current.style, {
        left: `${bounds.left - origin.left}px`,
        top: `${bounds.top - origin.top}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
      });
      const visible: Tip[] = [];
      for (const card of editor.querySelectorAll("affine-edgeless-note")) {
        const id = card.model.id;
        const actions = candidates.get(id);
        if (!actions) continue;
        const rect = card.getBoundingClientRect();
        if (
          !rect.width ||
          !rect.height ||
          rect.right <= bounds.left ||
          rect.left >= bounds.right ||
          rect.bottom < bounds.top + 28 ||
          rect.top >= bounds.bottom
        )
          continue;
        const x = Math.max(
          0,
          Math.min(
            rect.left - bounds.left,
            bounds.width - actions.length * 26 - 100,
          ),
        );
        const y = Math.max(0, rect.top - bounds.top - 28);
        visible.push({
          id,
          actions,
          x,
          y,
          alignMenuRight: x + 180 > bounds.width,
          openMenuAbove: y + 90 > bounds.height,
        });
      }
      setTips(visible);
    }
    function schedule() {
      if (!stopped && !frame) frame = requestAnimationFrame(layout);
    }
    const mutation = new MutationObserver(schedule);
    mutation.observe(editor, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style"],
    });
    const resize = new ResizeObserver(schedule);
    resize.observe(editor);
    let timer: ReturnType<typeof setTimeout>;
    const contentChanged = () => {
      clearTimeout(timer);
      timer = setTimeout(qualify, 120);
    };
    editor.doc.spaceDoc.on("update", contentChanged);
    qualify();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      mutation.disconnect();
      resize.disconnect();
      clearTimeout(timer);
      editor.doc.spaceDoc.off("update", contentChanged);
    };
  }, [editor, hidden]);

  return (
    <div ref={layer} className="canvas-suggestions">
      {tips.map((tip) => (
        <div
          role="group"
          aria-label="Card suggestions"
          className="card-suggestion"
          key={tip.id}
          style={{ left: tip.x, top: tip.y }}
        >
          {tip.actions.map((action) => (
            <button
              key={action}
              disabled={disabled}
              title={cardActions[action].label}
              aria-label={cardActions[action].label}
              onClick={() => onStart(tip.id, action)}
            >
              <ShellIcon name="sparkles" size={15} />
            </button>
          ))}
          <button
            className="card-suggestion-later"
            title="Hide until you revisit on a later day"
            onClick={() => hide(tip.id, tip.actions, new Date().toDateString())}
          >
            Not now
          </button>
          <ShellMenu
            label="Suggestion options"
            icon={<ShellIcon name="more" size={15} />}
            className={`card-suggestion-menu ${tip.alignMenuRight ? "align-right" : ""} ${tip.openMenuAbove ? "open-above" : ""}`}
          >
            {tip.actions.map((action) => (
              <button
                key={action}
                onClick={() => hide(tip.id, [action], "always")}
              >
                {tip.actions.length === 1
                  ? "Dismiss this suggestion"
                  : `Dismiss “${cardActions[action].label}”`}
              </button>
            ))}
          </ShellMenu>
        </div>
      ))}
    </div>
  );
}
