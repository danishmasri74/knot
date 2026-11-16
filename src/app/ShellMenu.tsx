import { useEffect, useRef, type ReactNode } from "react";

/** Native disclosure keyboard behavior with outside-click and Escape dismissal. */
export function ShellMenu({
  label,
  icon,
  children,
  className = "",
}: {
  label: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const root = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent | KeyboardEvent) => {
      const element = root.current;
      if (!element?.open) return;
      if (event instanceof KeyboardEvent) {
        if (
          event.key !== "Escape" ||
          event.defaultPrevented ||
          document.querySelector("dialog[open]")
        )
          return;
        event.preventDefault();
        element.open = false;
        element.querySelector("summary")?.focus();
      } else if (!element.contains(event.target as Node)) element.open = false;
    };
    // Canvas and editor controls can stop pointer events from bubbling.
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", close);
    };
  }, []);
  return (
    <details
      ref={root}
      className={`shell-menu ${className}`}
      onKeyDown={(event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
          return;
        const element = event.currentTarget;
        const buttons = Array.from(
          element.querySelectorAll<HTMLButtonElement>(
            ".shell-menu-content button:not(:disabled)",
          ),
        );
        if (!buttons.length) return;
        event.preventDefault();
        element.open = true;
        const current = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : event.key === "ArrowDown"
                ? (current + 1) % buttons.length
                : current < 0
                  ? buttons.length - 1
                  : (current - 1 + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}
      onToggle={(event) => {
        if (event.currentTarget.open) {
          document
            .querySelectorAll<HTMLDetailsElement>(".shell-menu[open]")
            .forEach((menu) => {
              if (menu !== event.currentTarget) menu.open = false;
            });
        }
      }}
    >
      <summary data-tooltip={label} aria-label={label}>
        {icon ?? label}
      </summary>
      <div
        className="shell-menu-content knot-dropdown"
        onClick={(event) => {
          const button = (event.target as Element).closest("button");
          // data-keep-open rows switch views inside the menu (a drill-in).
          if (button && !button.hasAttribute("data-keep-open") && root.current) {
            root.current.open = false;
            root.current.querySelector("summary")?.focus();
          }
        }}
      >
        {children}
      </div>
    </details>
  );
}
