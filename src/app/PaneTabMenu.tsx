import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

export type PaneMenuItem =
  | { label: string; run: () => void; disabled?: boolean; tooltip?: string }
  | "separator";

/** A tab's context menu (right-click, Shift+F10 or the menu key). It opens
 * at the pointer or under the tab, stays inside the window, and closes on
 * Esc, Tab, an outside click or the window losing focus. */
export function PaneTabMenu({
  label,
  x,
  y,
  items,
  onClose,
}: {
  label: string;
  x: number;
  y: number;
  items: PaneMenuItem[];
  /** restoreFocus: put focus back on the tab that opened the menu. */
  onClose: (restoreFocus: boolean) => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    element.style.left = `${Math.max(4, Math.min(x, innerWidth - element.offsetWidth - 4))}px`;
    element.style.top = `${Math.max(4, Math.min(y, innerHeight - element.offsetHeight - 4))}px`;
    element
      .querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus({ preventScroll: true });
  }, [x, y]);
  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    const dismiss = () => closeRef.current(false);
    window.addEventListener(
      "pointerdown",
      (event) => {
        if (menu.current && !event.composedPath().includes(menu.current))
          dismiss();
      },
      { capture: true, signal },
    );
    window.addEventListener("blur", dismiss, { signal });
    window.addEventListener("resize", dismiss, { signal });
    return () => controller.abort();
  }, []);
  // No separator first, last or twice in a row.
  const rows = items.filter(
    (item, i, all) =>
      item !== "separator" ||
      (i > 0 && i < all.length - 1 && all[i - 1] !== "separator"),
  );
  return createPortal(
    <div
      ref={menu}
      role="menu"
      aria-label={label}
      className="pane-tab-menu knot-dropdown"
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "Escape" || event.key === "Tab") {
          event.preventDefault();
          event.stopPropagation();
          closeRef.current(true);
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        const buttons = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ),
        );
        if (!buttons.length) return;
        const current = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                buttons.length;
        buttons[next]?.focus();
      }}
    >
      {rows.map((item, i) =>
        item === "separator" ? (
          <hr key={i} />
        ) : (
          <button
            key={i}
            role="menuitem"
            disabled={item.disabled}
            data-tooltip={item.tooltip}
            onClick={() => {
              closeRef.current(false);
              item.run();
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
