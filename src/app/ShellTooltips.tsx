import { useEffect } from "react";

/** One delegated tooltip for shell controls, independent of editor tooltips. */
export function ShellTooltips() {
  useEffect(() => {
    const tip = document.createElement("div");
    tip.id = "knot-shell-tooltip";
    tip.className = "shell-tooltip";
    tip.setAttribute("role", "tooltip");
    tip.setAttribute("popover", "manual");
    document.body.append(tip);
    let anchor: HTMLElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => hide());
    const hide = () => {
      clearTimeout(timer);
      observer.disconnect();
      if (anchor) {
        const ids = (anchor.getAttribute("aria-describedby") ?? "")
          .split(" ")
          .filter((id) => id && id !== tip.id);
        if (ids.length) anchor.setAttribute("aria-describedby", ids.join(" "));
        else anchor.removeAttribute("aria-describedby");
      }
      if (tip.matches(":popover-open")) tip.hidePopover();
      anchor = null;
    };
    const target = (event: Event) =>
      event.target instanceof Element
        ? event.target.closest<HTMLElement>(
            "[data-tooltip], .app-shell button[aria-label]",
          )
        : null;
    const show = (event: Event) => {
      if (event instanceof PointerEvent && event.pointerType === "touch")
        return;
      const next = target(event);
      if (next === anchor) return;
      hide();
      if (!next || next.closest(".editor-area")) return;
      anchor = next;
      timer = setTimeout(() => {
        if (!next.isConnected || anchor !== next) return hide();
        tip.textContent =
          next.dataset.tooltip ?? next.getAttribute("aria-label") ?? "";
        tip.showPopover();
        const rect = next.getBoundingClientRect();
        const bounds = tip.getBoundingClientRect();
        const below = rect.top < bounds.height + 18;
        const x = Math.max(
          8,
          Math.min(
            innerWidth - bounds.width - 8,
            rect.left + rect.width / 2 - bounds.width / 2,
          ),
        );
        const y = below ? rect.bottom + 10 : rect.top - bounds.height - 10;
        tip.style.left = `${x}px`;
        tip.style.top = `${Math.max(8, Math.min(innerHeight - bounds.height - 8, y))}px`;
        tip.dataset.side = below ? "bottom" : "top";
        tip.style.setProperty(
          "--arrow-x",
          `${Math.max(10, Math.min(bounds.width - 10, rect.left + rect.width / 2 - x))}px`,
        );
        const ids = next.getAttribute("aria-describedby");
        next.setAttribute(
          "aria-describedby",
          [ids, tip.id].filter(Boolean).join(" "),
        );
        observer.observe(next, {
          attributes: true,
          attributeFilter: ["data-tooltip", "aria-label", "disabled"],
        });
      }, 400);
    };
    const leave = (event: Event) => {
      const related = (event as MouseEvent | FocusEvent).relatedTarget;
      if (related instanceof Node && anchor?.contains(related)) return;
      hide();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    document.addEventListener("pointerover", show);
    document.addEventListener("focusin", show);
    document.addEventListener("pointerout", leave);
    document.addEventListener("focusout", leave);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("click", hide, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    window.addEventListener("blur", hide);
    return () => {
      hide();
      tip.remove();
      document.removeEventListener("pointerover", show);
      document.removeEventListener("focusin", show);
      document.removeEventListener("pointerout", leave);
      document.removeEventListener("focusout", leave);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("click", hide, true);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      window.removeEventListener("blur", hide);
    };
  }, []);
  return null;
}
