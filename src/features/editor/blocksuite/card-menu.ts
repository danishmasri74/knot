import { shellIconPaths } from "../../../app/ShellIcon";
type Action = { label: string; run: () => void; trash?: boolean };

export function openCardMenu(
  x: number,
  y: number,
  actions: Action[],
  trigger?: HTMLElement,
) {
  const menu = document.createElement("div");
  menu.className = "card-deck-menu knot-dropdown";
  menu.setAttribute("role", "menu");
  const controller = new AbortController();
  const options = { signal: controller.signal, capture: true };
  const close = () => {
    if (controller.signal.aborted) return;
    controller.abort();
    menu.remove();
    trigger?.setAttribute("aria-expanded", "false");
  };
  for (const action of actions) {
    const button = document.createElement("button");
    button.setAttribute("role", "menuitem");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "shell-icon");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.7");
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute(
      "d",
      shellIconPaths[
        action.trash
          ? "trash"
          : action.label === "Add to canvas"
            ? "plus"
            : "close"
      ],
    );
    svg.append(path);
    button.append(svg, action.label);
    if (action.trash) button.className = "collection-danger";
    button.onclick = () => {
      close();
      action.run();
    };
    menu.append(button);
  }
  document.body.append(menu);
  menu.style.left =
    Math.max(4, Math.min(x, innerWidth - menu.offsetWidth - 4)) + "px";
  menu.style.top =
    Math.max(4, Math.min(y, innerHeight - menu.offsetHeight - 4)) + "px";
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (
        !e.composedPath().includes(menu) &&
        !(trigger && e.composedPath().includes(trigger))
      )
        close();
    },
    options,
  );
  menu.addEventListener("focusout", (e) => {
    if (!menu.contains(e.relatedTarget as Node)) close();
  });
  menu.addEventListener("keydown", (e) => {
    const items = Array.from(menu.querySelectorAll("button"));
    if (e.key === "Escape") {
      close();
      trigger?.focus();
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[
        (items.indexOf(document.activeElement as HTMLButtonElement) +
          (e.key === "ArrowDown" ? 1 : -1) +
          items.length) %
          items.length
      ].focus();
    }
  });
  window.addEventListener("blur", close, { signal: controller.signal });
  trigger?.setAttribute("aria-expanded", "true");
  menu.querySelector("button")?.focus();
  return close;
}
