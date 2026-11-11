import { useEffect } from "react";

export function CanvasRecovery({
  disabled,
  onFind,
}: {
  disabled: boolean;
  onFind: () => void;
}) {
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (
        disabled ||
        event.defaultPrevented ||
        !(event.ctrlKey || event.metaKey) ||
        !event.shiftKey ||
        event.altKey ||
        event.key !== "Home" ||
        event
          .composedPath()
          .some(
            (target) =>
              target instanceof HTMLElement &&
              (target.isContentEditable ||
                target.matches("input, textarea, select")),
          ) ||
        document.querySelector('dialog[open], [role="dialog"]')
      )
        return;
      event.preventDefault();
      onFind();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [disabled, onFind]);

  return null;
}
