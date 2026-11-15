import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type Dispatch,
  type DragEvent,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { browserApi, browserBounds } from "../services/browser";
import { Popover } from "./Collections";
import { PaneTabMenu, type PaneMenuItem } from "./PaneTabMenu";
import { ShellIcon } from "./ShellIcon";
import { ShellMenu } from "./ShellMenu";
import {
  edgeDropPreview,
  projectLayout,
  minimumWidth,
  MAX_COLUMNS,
  RAIL_WIDTH,
  tabPolicy,
  type WorkspaceLayout,
  type LayoutAction,
  type PaneTab,
} from "./workspace-layout";
/** live: on screen. warm: just left the screen. asleep: may drop its editor. */
export type TabState = "live" | "warm" | "asleep";
const WARM_MS = 30_000;
const icons = {
  canvas: "board",
  note: "note",
  pdf: "highlight",
  browser: "globe",
  ask: "sparkles",
  cardDeck: "cardDeck",
  reference: "link",
  video: "video",
} as const;
export function WorkspacePanes({
  layout,
  dispatch,
  available,
  blocked,
  label,
  render,
  contentKey = (tab) => tab.id,
  onReturn,
  icon,
  lead,
  newTab,
  tools,
}: {
  /** Pinned first in the first column's tab row (the notebook pill). */
  lead?: () => ReactNode;
  /** "Open in this column" items for a column's + menu. */
  newTab?: (group: string) => ReactNode;
  /** Notebook-wide controls (undo, redo), once, at the header's right end. */
  tools?: () => ReactNode;
  /** Overrides the kind's icon, e.g. the canvas tab while it shows a page. */
  icon?: (tab: PaneTab) => ComponentProps<typeof ShellIcon>["name"] | undefined;
  layout: WorkspaceLayout;
  dispatch: Dispatch<LayoutAction>;
  available: number;
  blocked: boolean;
  label: (tab: PaneTab) => string;
  render: (tab: PaneTab, onClose: () => void, state: TabState) => ReactNode;
  contentKey?: (tab: PaneTab) => string;
  onReturn: () => void;
}) {
  const projection = projectLayout(layout, available);
  // Rails from an expanded column (not from a narrow window).
  const expanded = !!layout.expandedGroupId && projection.rails.length > 0;
  const hidden = !projection.groups.length;
  const [announcement, setAnnouncement] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  // Tabs that just stopped being visible stay loaded briefly, so flipping
  // between two tabs doesn't rebuild an editor each time.
  const [warm, setWarm] = useState<Record<string, number>>({});
  const shownTabs = projection.groups.map((g) => g.activeTabId);
  const shownKey = shownTabs.join("\n");
  const previouslyShown = useRef<string[]>([]);
  useEffect(() => {
    const now = Date.now();
    const left = previouslyShown.current.filter((id) => !shownTabs.includes(id));
    previouslyShown.current = shownTabs;
    if (!left.length) return;
    setWarm((current) => {
      const next = { ...current };
      for (const id of left) next[id] = now + WARM_MS;
      return next;
    });
    // shownKey stands for shownTabs.
  }, [shownKey]);
  useEffect(() => {
    const until = Object.values(warm);
    if (!until.length) return;
    const timer = setTimeout(
      () =>
        setWarm((current) =>
          Object.fromEntries(
            Object.entries(current).filter(([, end]) => end > Date.now()),
          ),
        ),
      Math.max(0, Math.min(...until) - Date.now()) + 50,
    );
    return () => clearTimeout(timer);
  }, [warm]);
  const tabState = (tab: PaneTab): TabState =>
    tabPolicy[tab.kind].idle === "alive" || shownTabs.includes(tab.id)
      ? "live"
      : (warm[tab.id] ?? 0) > Date.now()
        ? "warm"
        : "asleep";
  const [dropSide, setDropSide] = useState<"left" | "right" | null>(null);
  const [tabDrop, setTabDrop] = useState<{
    strip: string;
    group: string;
    index: number;
    left: number;
  } | null>(null);
  const [tabMenu, setTabMenu] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  // Per column: tabs scrolled fully or partly out of its tab row.
  const [outOfView, setOutOfView] = useState<Record<string, string[]>>({});
  const composing = useRef(false);
  const toggleTarget = useRef({ expanded, group: layout.lastUsedGroupId, count: layout.groups.length });
  toggleTarget.current = { expanded, group: layout.lastUsedGroupId, count: layout.groups.length };
  useEffect(() => {
    const toggle = (e: KeyboardEvent) => {
      if (
        e.key !== "Enter" ||
        !e.ctrlKey ||
        !e.shiftKey ||
        e.altKey ||
        e.metaKey ||
        e.isComposing ||
        root.current?.inert
      )
        return;
      const { expanded, group, count } = toggleTarget.current;
      if (!group || count < 2) return;
      e.preventDefault();
      dispatch(expanded ? { type: "restore" } : { type: "expand", group });
    };
    document.addEventListener("keydown", toggle);
    return () => document.removeEventListener("keydown", toggle);
  }, [dispatch]);
  // Esc shows both columns again from anywhere that doesn't use Esc itself:
  // a rail, the page after Collapse, a column's controls. Headers handle
  // their own Esc; editors, fields and open menus keep theirs.
  const expandedNow = useRef(expanded);
  expandedNow.current = expanded;
  useEffect(() => {
    const restore = (e: KeyboardEvent) => {
      if (
        e.key !== "Escape" ||
        e.defaultPrevented ||
        e.isComposing ||
        !expandedNow.current ||
        root.current?.inert ||
        document.documentElement.hasAttribute("data-pane-gesture") ||
        document.querySelector(".shell-menu[open], :popover-open, dialog[open]")
      )
        return;
      const target = e.target instanceof Element ? e.target : null;
      if (
        target?.closest(
          "input, textarea, select, [contenteditable], affine-editor-container, .ask-knot, .pane-header",
        )
      )
        return;
      e.preventDefault();
      dispatch({ type: "restore" });
    };
    document.addEventListener("keydown", restore);
    return () => document.removeEventListener("keydown", restore);
  }, [dispatch]);
  const root = useRef<HTMLDivElement>(null);
  const gestureFocus = useRef<HTMLElement | null>(null);
  const resizeStart = useRef<{ x: number; widths: number[] } | null>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const scrollTabs = (event: WheelEvent) => {
      if (
        element.inert ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.deltaX ||
        !event.deltaY
      )
        return;
      const tabs =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>(".pane-tabs")
          : null;
      if (
        !tabs ||
        !element.contains(tabs) ||
        tabs.scrollWidth <= tabs.clientWidth
      )
        return;
      // Native horizontal/trackpad gestures keep their normal behavior. Map a
      // vertical wheel over overflowing tabs without scrolling the notebook.
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? tabs.clientWidth
            : 1;
      event.preventDefault();
      tabs.scrollLeft += event.deltaY * unit;
    };
    // React's delegated wheel listener is passive, so bind locally to cancel
    // vertical scrolling when the tab strip consumes the wheel.
    element.addEventListener("wheel", scrollTabs, { passive: false });
    return () => element.removeEventListener("wheel", scrollTabs);
  }, []);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    element.inert = blocked || hidden;
    if (hidden)
      element
        .querySelectorAll<HTMLDetailsElement>(".shell-menu[open]")
        .forEach((menu) => (menu.open = false));
  }, [blocked, hidden]);
  // The canvas editor lives outside the panes (it must never change parents),
  // so publish where its column is and let the editor area follow.
  const canvasIndex = projection.groups.findIndex(
    (g) => layout.tabs[g.activeTabId]?.kind === "canvas",
  );
  const canvasShown = canvasIndex >= 0;
  const canvasLeft = canvasShown
    ? projection.lefts[canvasIndex]
    : 0;
  const canvasWidth = canvasShown ? projection.widths[canvasIndex] : 0;
  useLayoutEffect(() => {
    const parent = root.current?.parentElement;
    if (!parent) return;
    parent.dataset.canvas = canvasShown ? "visible" : "hidden";
    parent.dataset.singleContent = String(!canvasShown && !hidden);
    parent.style.setProperty("--canvas-left", `${canvasLeft}px`);
    parent.style.setProperty("--canvas-width", `${canvasWidth}px`);
    const right = canvasShown ? available - canvasLeft - canvasWidth : 0;
    parent.style.setProperty("--support-width", `${right}px`);
    parent.closest("main")?.style.setProperty("--support-width", `${right}px`);
  }, [canvasShown, canvasLeft, canvasWidth, available, hidden]);
  // Columns glide when the layout changes (expand, restore, close, move), but
  // follow the window and sidebar exactly while those resize.
  const previousWidth = useRef(available);
  useLayoutEffect(() => {
    const parent = root.current?.parentElement;
    if (!parent || previousWidth.current === available) return;
    previousWidth.current = available;
    parent.dataset.resizing = "true";
    const timer = setTimeout(() => delete parent.dataset.resizing, 300);
    return () => clearTimeout(timer);
  }, [available]);
  const endGesture = () => {
    setDragging(null);
    setDropSide(null);
    setTabDrop(null);
    document.documentElement.removeAttribute("data-pane-gesture");
    const element = gestureFocus.current;
    requestAnimationFrame(() => {
      if (element?.isConnected) element.focus();
    });
    gestureFocus.current = null;
  };
  useEffect(() => {
    const cancel = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        document.documentElement.hasAttribute("data-pane-gesture")
      ) {
        e.preventDefault();
        endGesture();
      }
    };
    document.addEventListener("keydown", cancel, true);
    return () => {
      document.removeEventListener("keydown", cancel, true);
      document.documentElement.removeAttribute("data-pane-gesture");
    };
  }, []);
  const beginGesture = () => {
    setDropSide(null);
    setTabDrop(null);
    gestureFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    document.documentElement.setAttribute("data-pane-gesture", "");
    const viewport = document.querySelector<HTMLElement>(".browser-viewport");
    if (viewport)
      void browserApi.bounds(browserBounds(viewport), false).catch(() => {});
  };
  const move = (action: LayoutAction, message: string) => {
    if (composing.current) return;
    dispatch(
      action.type === "swap"
        ? { ...action, slotWidths: action.slotWidths ?? projection.widths }
        : action,
    );
    setAnnouncement(message);
    endGesture();
    requestAnimationFrame(() => {
      const id = "id" in action ? action.id : undefined;
      const tab = id
        ? document.getElementById(`tab-${encodeURIComponent(id)}`)
        : root.current?.querySelector<HTMLElement>(
            '[role="tab"][aria-selected="true"]',
          );
      tab?.focus();
    });
  };
  const activate = (id: string) => {
    dispatch({ type: "activate", id });
  };
  /** The current column is where new tabs open and what Focus fills. */
  const makeCurrent = (id: string) => {
    if (
      layout.lastUsedGroupId !==
      layout.groups.find((g) => g.tabIds.includes(id))?.id
    )
      dispatch({ type: "activate", id });
  };
  const close = (id: string) => {
    dispatch({ type: "close", id });
    requestAnimationFrame(() => {
      const tab = root.current?.querySelector<HTMLElement>(
        '[role="tab"][aria-selected="true"]',
      );
      if (tab) tab.focus();
      else onReturn();
    });
  };
  const tabInsertion = (
    strip: HTMLElement,
    groupId: string,
    clientX: number,
  ) => {
    if (!dragging) return null;
    const bounds = strip.getBoundingClientRect();
    const tabs = [...strip.querySelectorAll<HTMLElement>(".pane-tab")].filter(
      (tab) => tab.dataset.tabId !== dragging,
    );
    const before = tabs.find((tab) => {
      const rect = tab.getBoundingClientRect();
      return clientX < rect.left + rect.width / 2;
    });
    const hovered = tabs.find((tab) => {
      const rect = tab.getBoundingClientRect();
      return clientX >= rect.left && clientX <= rect.right;
    });
    const anchor = hovered ?? before ?? tabs.at(-1);
    const after =
      hovered &&
      clientX >=
        hovered.getBoundingClientRect().left +
          hovered.getBoundingClientRect().width / 2;
    const target =
      layout.groups.find((g) =>
        g.tabIds.includes(anchor?.dataset.tabId ?? ""),
      ) ?? layout.groups.find((g) => g.id === groupId);
    if (!target) return null;
    const ids = target.tabIds.filter((id) => id !== dragging);
    return {
      strip: groupId,
      group: target.id,
      index: hovered
        ? ids.indexOf(hovered.dataset.tabId!) + (after ? 1 : 0)
        : before
          ? ids.indexOf(before.dataset.tabId!)
          : ids.length,
      left:
        ((hovered
          ? after
            ? hovered.getBoundingClientRect().right
            : hovered.getBoundingClientRect().left
          : undefined) ??
          before?.getBoundingClientRect().left ??
          anchor?.getBoundingClientRect().right ??
          bounds.left) -
        bounds.left +
        strip.scrollLeft,
    };
  };
  // Dividers sit between columns: index is the column to the divider's right.
  const resize = (index: number, value: number, widths = projection.widths) => {
    const group = projection.groups[index];
    if (!index || projection.single) return;
    dispatch({
      type: "resizePair",
      left: projection.groups[index - 1].id,
      right: group.id,
      leftWidth: widths[index - 1] + widths[index] - value,
      total: widths[index - 1] + widths[index],
    });
  };
  const roomForColumn =
    layout.groups.length < MAX_COLUMNS &&
    layout.groups.reduce((n, g) => n + minimumWidth(layout, g) + 1, 0) + 320 <=
      available;
  /** What a tab's context menu offers. Moving columns only ever means
   * swapping sides, since there are at most two. */
  const tabActions = (id: string): PaneMenuItem[] => {
    const tab = layout.tabs[id];
    const group = layout.groups.find((g) => g.tabIds.includes(id));
    if (!tab || !group) return [];
    const canvas = tab.kind === "canvas";
    const other = layout.groups.find((g) => g !== group);
    const focusedHere = expanded && layout.expandedGroupId === group.id;
    const closable = group.tabIds.filter(
      (t) => t !== id && layout.tabs[t]?.kind !== "canvas",
    );
    return [
      ...(layout.groups.length > 1 && !(projection.collapsed && !expanded)
        ? [
            focusedHere
              ? {
                  label: "Show all columns",
                  run: () => dispatch({ type: "restore" }),
                }
              : {
                  label: "Focus this column",
                  run: () => dispatch({ type: "expand", id }),
                },
            "separator" as const,
          ]
        : []),
      ...(canvas
        ? []
        : other
          ? [
              {
                label: "Move to other column",
                run: () =>
                  move(
                    { type: "move", id, group: other.id },
                    "Tab moved to the other column",
                  ),
              },
            ]
          : (["left", "right"] as const).map((side) => ({
              label: `Open in new column ${side === "left" ? "←" : "→"}`,
              disabled: !roomForColumn || group.tabIds.length < 2,
              tooltip: !roomForColumn
                ? "Widen the window to open another column"
                : undefined,
              run: () =>
                move(
                  { type: "split", id, side },
                  `Tab opened in a new column on the ${side}`,
                ),
            }))),
      ...(other
        ? [{ label: "Swap columns", run: () => move({ type: "swap" }, "Columns swapped") }]
        : []),
      "separator",
      ...(canvas ? [] : [{ label: "Close tab", run: () => close(id) }]),
      {
        label: "Close other tabs",
        disabled: !closable.length,
        run: () => {
          activate(id);
          for (const t of closable) dispatch({ type: "close", id: t });
        },
      },
    ];
  };
  const openTabMenu = (id: string, x: number, y: number) => {
    if (composing.current || dragging) return;
    document
      .querySelectorAll<HTMLDetailsElement>(".shell-menu[open]")
      .forEach((menu) => (menu.open = false));
    setTabMenu({ id, x, y });
  };
  // Focus fills the window with the current column; the others become rails.
  // When the window is too narrow for both, it's on and can't be turned off.
  const forcedRails = projection.collapsed && !expanded;
  const focusTarget =
    layout.groups.find((g) => g.id === layout.lastUsedGroupId) ??
    layout.groups.at(-1);
  const toggleFocus = () => {
    if (expanded) dispatch({ type: "restore" });
    else if (focusTarget) dispatch({ type: "expand", group: focusTarget.id });
  };
  const slots = projection.groups.map((g, index) => ({
    group: g,
    width: projection.widths[index],
    left: projection.lefts[index],
  }));
  const leadNode = slots[0] && lead?.();
  return (
    <div
      ref={root}
      id="supporting-columns"
      className="workspace-panes"
      data-collapsed={hidden}
      style={{ "--pane-width": `${available}px` } as CSSProperties}
      data-dragging={!!dragging}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
      }}
    >
      <span className="sr-only" role="status">
        {announcement}
      </span>
      {projection.rails.map(({ group, left }) => (
        <nav
          key={group.id}
          className="pane-rail"
          style={{ left, width: RAIL_WIDTH }}
          aria-label="Collapsed column"
        >
          {/* Rails switch columns; only the Focus switch or Esc brings both
              back. A tall stack of tabs scrolls. */}
          <div className="pane-rail-tabs">
            {group.tabIds.map((id) => (
              <button
                key={id}
                aria-label={`Show ${label(layout.tabs[id])}`}
                data-tooltip={label(layout.tabs[id])}
                data-active={id === group.activeTabId}
                onClick={() =>
                  expanded ? dispatch({ type: "expand", id }) : activate(id)
                }
              >
                <ShellIcon
                  name={icon?.(layout.tabs[id]) ?? icons[layout.tabs[id].kind]}
                />
              </button>
            ))}
          </div>
          <span className="pane-rail-label" aria-hidden="true">
            {label(layout.tabs[group.activeTabId])}
          </span>
        </nav>
      ))}
      {slots.map(({ group, width, left }, index) => (
        <div className="pane-group" key={group.id} style={{ left, width }}>
          {index > 0 && <div
            className="pane-divider"
            role="separator"
            tabIndex={0}
            aria-label="Resize columns"
            aria-orientation="vertical"
            aria-valuemin={minimumWidth(layout, group)}
            aria-valuemax={Math.max(minimumWidth(layout, group), available)}
            aria-valuenow={Math.round(width)}
            onKeyDown={(e) => {
              if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
                e.preventDefault();
                resize(index, width + (e.key === "ArrowLeft" ? 24 : -24));
              }
            }}
            onPointerDown={(e) => {
              if (composing.current) return;
              beginGesture();
              resizeStart.current = {
                x: e.clientX,
                widths: [...projection.widths],
              };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                const start = resizeStart.current!;
                resize(
                  index,
                  start.widths[index] + start.x - e.clientX,
                  start.widths,
                );
              }
            }}
            onPointerUp={(e) => {
              e.currentTarget.releasePointerCapture(e.pointerId);
              endGesture();
            }}
            onPointerCancel={endGesture}
            onLostPointerCapture={endGesture}
          />}
          <header
            className="pane-header"
            // Side by side, the column Focus acts on carries a thin accent.
            data-current={
              slots.length > 1 ? group.id === focusTarget?.id : undefined
            }
            // The right-end controls act on the current column, so clicking
            // them must not change which one that is.
            onPointerDownCapture={(e) => {
              if (
                !(e.target instanceof Element) ||
                !e.target.closest(".pane-tools")
              )
                makeCurrent(group.activeTabId);
            }}
            onFocusCapture={(e) => {
              if (!e.target.closest(".pane-tools"))
                makeCurrent(group.activeTabId);
            }}
            onKeyDown={(e) => {
              // Esc only leaves Focus; it never closes a tab, so reaching
              // for "get out" can't lose your place.
              if (
                e.key === "Escape" &&
                expanded &&
                !e.defaultPrevented &&
                !dragging &&
                !document.querySelector(
                  ".shell-menu[open], :popover-open, dialog[open]",
                )
              ) {
                e.preventDefault();
                e.stopPropagation();
                dispatch({ type: "restore" });
              }
            }}
            onDragOver={(e) => {
              if (!dragging) return;
              const strip =
                e.currentTarget.querySelector<HTMLElement>(".pane-tabs");
              if (strip) setTabDrop(tabInsertion(strip, group.id, e.clientX));
              e.preventDefault();
            }}
            onDragLeave={(e) => {
              if (
                e.relatedTarget instanceof Node &&
                e.currentTarget.contains(e.relatedTarget)
              )
                return;
              setDropSide(null);
              setTabDrop((current) =>
                current?.strip === group.id ? null : current,
              );
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (!dragging) return;
              const strip =
                e.currentTarget.querySelector<HTMLElement>(".pane-tabs");
              const insertion =
                strip && tabInsertion(strip, group.id, e.clientX);
              if (insertion)
                move(
                  {
                    type: "move",
                    id: dragging,
                    group: insertion.group,
                    index: insertion.index,
                  },
                  "Tab moved",
                );
              else endGesture();
            }}
          >
            {index === 0 && leadNode}
            <TabStrip
              activeTab={group.activeTabId}
              onOutOfView={(ids) =>
                setOutOfView((current) =>
                  (current[group.id] ?? []).join("\n") === ids.join("\n")
                    ? current
                    : { ...current, [group.id]: ids },
                )
              }
              role="tablist"
              aria-label="Tabs"
              className="pane-tabs"
              onDragOver={(e) => {
                if (!dragging) return;
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "move";
                const strip = e.currentTarget;
                const bounds = strip.getBoundingClientRect();
                if (e.clientX < bounds.left + 24) strip.scrollLeft -= 16;
                else if (e.clientX > bounds.right - 24) strip.scrollLeft += 16;
                setDropSide(null);
                setTabDrop(tabInsertion(strip, group.id, e.clientX));
              }}
              onDragLeave={(e) => {
                if (
                  e.relatedTarget instanceof Node &&
                  e.currentTarget.contains(e.relatedTarget)
                )
                  return;
                setTabDrop((current) =>
                  current?.strip === group.id ? null : current,
                );
              }}
              onDrop={(e) => {
                if (!dragging) return;
                e.preventDefault();
                e.stopPropagation();
                const insertion = tabInsertion(
                  e.currentTarget,
                  group.id,
                  e.clientX,
                );
                if (insertion)
                  move(
                    {
                      type: "move",
                      id: dragging,
                      group: insertion.group,
                      index: insertion.index,
                    },
                    "Tab moved",
                  );
                else endGesture();
              }}
            >
              {group.tabIds.map((id) => (
                <div
                  className="pane-tab"
                  key={id}
                  data-active={id === group.activeTabId}
                  data-tab-id={id}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    openTabMenu(id, e.clientX, e.clientY);
                  }}
                >
                  <button
                    role="tab"
                    data-pane-kind={layout.tabs[id].kind}
                    id={`tab-${encodeURIComponent(id)}`}
                    aria-controls={`panel-${encodeURIComponent(id)}`}
                    aria-selected={id === group.activeTabId}
                    tabIndex={id === group.activeTabId ? 0 : -1}
                    data-tooltip={label(layout.tabs[id])}
                    onClick={() => activate(id)}
                    onFocus={(e) =>
                      e.currentTarget.scrollIntoView({
                        block: "nearest",
                        inline: "nearest",
                      })
                    }
                    draggable
                    onDragStart={(e) => {
                      if (composing.current) {
                        e.preventDefault();
                        return;
                      }
                      beginGesture();
                      setDragging(id);
                      e.dataTransfer.setData("application/x-knot-pane", id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={endGesture}
                    onKeyDown={(e) => {
                      if (
                        e.key === "ContextMenu" ||
                        (e.key === "F10" && e.shiftKey)
                      ) {
                        e.preventDefault();
                        const rect = e.currentTarget.getBoundingClientRect();
                        openTabMenu(id, rect.left, rect.bottom + 4);
                        return;
                      }
                      if (
                        ["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                          e.key,
                        )
                      ) {
                        e.preventDefault();
                        const n = group.tabIds.indexOf(id);
                        const target =
                          group.tabIds[
                            e.key === "Home"
                              ? 0
                              : e.key === "End"
                                ? group.tabIds.length - 1
                                : (n +
                                    (e.key === "ArrowRight" ? 1 : -1) +
                                    group.tabIds.length) %
                                  group.tabIds.length
                          ];
                        activate(target);
                        requestAnimationFrame(() =>
                          document
                            .getElementById(`tab-${encodeURIComponent(target)}`)
                            ?.focus(),
                        );
                      }
                    }}
                  >
                    <ShellIcon
                      name={icon?.(layout.tabs[id]) ?? icons[layout.tabs[id].kind]}
                    />
                    <span>{label(layout.tabs[id])}</span>
                  </button>
                  <button
                    className="pane-tab-close"
                    tabIndex={id === group.activeTabId ? 0 : -1}
                    aria-label={`Close ${label(layout.tabs[id])} tab`}
                    onClick={() => close(id)}
                  >
                    <ShellIcon name="close" />
                  </button>
                </div>
              ))}
              {tabDrop?.strip === group.id && (
                <span
                  className="pane-tab-drop-indicator"
                  aria-hidden="true"
                  style={{ left: tabDrop.left }}
                />
              )}
            </TabStrip>
            {(outOfView[group.id]?.length ?? 0) > 0 && (
              <TabOverflow
                tabs={group.tabIds}
                active={group.activeTabId}
                outOfView={outOfView[group.id]}
                label={(id) => label(layout.tabs[id])}
                onPick={(id) => {
                  activate(id);
                  requestAnimationFrame(() =>
                    document
                      .getElementById(`tab-${encodeURIComponent(id)}`)
                      ?.scrollIntoView({ block: "nearest", inline: "nearest" }),
                  );
                }}
                onMenu={openTabMenu}
                onDragOver={(e) => {
                  if (!dragging) return;
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = "move";
                  setTabDrop(null);
                }}
                onDrop={(e) => {
                  if (!dragging) return;
                  e.preventDefault();
                  e.stopPropagation();
                  // Dropped on the count: the tab goes last in this column.
                  move(
                    { type: "move", id: dragging, group: group.id },
                    "Tab moved",
                  );
                }}
              />
            )}
            {newTab && (
              <ShellMenu
                label="New tab"
                icon={<ShellIcon name="plus" />}
                className="pane-new-tab"
              >
                {newTab(group.id)}
              </ShellMenu>
            )}
            {index === slots.length - 1 && (
              // Notebook-wide controls sit once, at the header's right end,
              // whichever column is rightmost on screen.
              <span className="pane-tools">
                {tools?.()}
                {layout.groups.length > 1 && (
                  <button
                    className="pane-focus"
                    aria-label={expanded ? "Show all columns" : "Focus column"}
                    aria-pressed={expanded || forcedRails}
                    disabled={forcedRails}
                    data-tooltip={
                      forcedRails
                        ? "Widen the window to show both columns"
                        : expanded
                          ? "Show all columns (Esc)"
                          : "Focus this column (Ctrl+Shift+Enter)"
                    }
                    onClick={toggleFocus}
                  >
                    <ShellIcon name="expand" />
                  </button>
                )}
              </span>
            )}
          </header>
        </div>
      ))}
      {dragging &&
        !expanded &&
        (["left", "right"] as const).map((side) => {
          const preview = edgeDropPreview(layout, dragging, side, available);
          if (!preview) return null;
          return (
            <div
              key={side}
              className={`pane-split-target ${side}`}
              data-drop-active={dropSide === side}
              style={{ left: preview.left, width: preview.width }}
              onDragEnter={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDropSide(side);
                setTabDrop(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDropSide(side);
                setTabDrop(null);
              }}
              onDragLeave={(e) => {
                if (
                  e.relatedTarget instanceof Node &&
                  e.currentTarget.contains(e.relatedTarget)
                )
                  return;
                setDropSide((current) => (current === side ? null : current));
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                move(preview.action, `Pane moved to the ${side}`);
              }}
            >
              {`${preview.action.type === "split" ? "New" : "Move to"} ${side} column`}
            </div>
          );
        })}
      {tabMenu && layout.tabs[tabMenu.id] && (
        <PaneTabMenu
          label={`${label(layout.tabs[tabMenu.id])} tab`}
          x={tabMenu.x}
          y={tabMenu.y}
          items={tabActions(tabMenu.id)}
          onClose={(restoreFocus) => {
            const id = tabMenu.id;
            setTabMenu(null);
            if (restoreFocus)
              document.getElementById(`tab-${encodeURIComponent(id)}`)?.focus();
          }}
        />
      )}
      {/* Flat, stable parents keep live editor/PDF controllers mounted when membership changes. */}
      {Object.values(layout.tabs).map((tab) => {
        // The canvas editor is positioned from outside (see canvasLeft).
        if (tab.kind === "canvas") return null;
        // Hidden columns keep their hosts mounted, just out of view.
        const slot = slots.find((s) => s.group.tabIds.includes(tab.id)) ?? {
          group: null,
          left: 0,
          width: available,
        };
        const visible = slot.group?.activeTabId === tab.id;
        return (
          <section
            key={contentKey(tab)}
            id={`panel-${encodeURIComponent(tab.id)}`}
            role="tabpanel"
            aria-hidden={!visible}
            aria-labelledby={`tab-${encodeURIComponent(tab.id)}`}
            className={`pane-content pane-${tab.kind}`}
            hidden={!visible}
            ref={(e) => {
              if (e) e.inert = !visible || blocked || hidden;
            }}
            style={{ left: slot.left, width: slot.width }}
            // Clicking or focusing anywhere in a column makes it current.
            onFocusCapture={() => makeCurrent(tab.id)}
            onPointerDownCapture={() => makeCurrent(tab.id)}
          >
            {render(tab, () => close(tab.id), tabState(tab))}
          </section>
        );
      })}
    </div>
  );
}

/** The tab row: tabs shrink first (CSS); when they still don't fit, the row
 * scrolls without a scrollbar. The wheel scrolls it sideways, faded edges
 * show there's more, the active tab is kept in view, and the tabs that are
 * out of view are reported so the column can show how many. */
function TabStrip({
  activeTab,
  onOutOfView,
  ...props
}: {
  activeTab: string | null;
  onOutOfView: (ids: string[]) => void;
} & HTMLAttributes<HTMLDivElement>) {
  const strip = useRef<HTMLDivElement>(null);
  const report = useRef(onOutOfView);
  report.current = onOutOfView;
  // Wheel scrolling over the strip is handled once, by WorkspacePanes.
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      const start = el.scrollLeft > 1;
      const end = el.scrollLeft < max - 1;
      if (start || end) el.dataset.overflow = start && end ? "both" : start ? "start" : "end";
      else delete el.dataset.overflow;
      // A tab counts as out of view unless it's whole (a 2px allowance for
      // rounding). The active tab is always scrolled in, so it never counts.
      const bounds = el.getBoundingClientRect();
      report.current(
        start || end
          ? [...el.querySelectorAll<HTMLElement>(".pane-tab")]
              .filter((tab) => {
                if (tab.dataset.active === "true") return false;
                const rect = tab.getBoundingClientRect();
                return (
                  rect.left < bounds.left - 2 || rect.right > bounds.right + 2
                );
              })
              .map((tab) => tab.dataset.tabId!)
          : [],
      );
    };
    // When the row narrows (the window, a divider, or the count appearing),
    // the active tab stays whole.
    const resize = new ResizeObserver(() => {
      el.querySelector<HTMLElement>('.pane-tab[data-active="true"]')
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
      update();
    });
    resize.observe(el);
    const tabs = new MutationObserver(update);
    tabs.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-active"],
    });
    el.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      resize.disconnect();
      tabs.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, []);
  useEffect(() => {
    if (!activeTab) return;
    strip.current
      ?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeTab)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTab]);
  return <div ref={strip} {...props} />;
}

/** "+N" after a crowded tab row: lists every tab in the column, the ones in
 * view first, with the current one checked. Each row's ⋯ opens the same
 * actions as right-clicking the tab. */
function TabOverflow({
  tabs,
  active,
  outOfView,
  label,
  onPick,
  onMenu,
  onDragOver,
  onDrop,
}: {
  tabs: string[];
  active: string;
  outOfView: string[];
  label: (id: string) => string;
  onPick: (id: string) => void;
  onMenu: (id: string, x: number, y: number) => void;
  onDragOver: (e: DragEvent<HTMLElement>) => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
}) {
  const [filter, setFilter] = useState("");
  const hidden = new Set(outOfView);
  const query = filter.trim().toLocaleLowerCase();
  const matches = (id: string) =>
    !query || label(id).toLocaleLowerCase().includes(query);
  const inView = tabs.filter((id) => !hidden.has(id) && matches(id));
  const away = tabs.filter((id) => hidden.has(id) && matches(id));
  const count = outOfView.length;
  const row = (id: string, close: () => void) => (
    <div className="pane-overflow-row" key={id}>
      <button
        aria-pressed={id === active}
        onClick={() => {
          close();
          onPick(id);
        }}
      >
        <span>{label(id)}</span>
        {id === active && <ShellIcon name="check" />}
      </button>
      <button
        className="pane-overflow-more"
        aria-label={`${label(id)} tab actions`}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          close();
          onMenu(id, rect.left, rect.bottom + 4);
        }}
      >
        <ShellIcon name="more" />
      </button>
    </div>
  );
  return (
    <span className="pane-overflow" onDragOver={onDragOver} onDrop={onDrop}>
      <Popover
        label={`${count} more ${count === 1 ? "tab" : "tabs"}`}
        className="pane-overflow-chip"
        trigger={
          <>
            <span>+{count}</span>
            <ShellIcon name="chevron" />
          </>
        }
      >
        {(close) => (
          <div
            className="pane-overflow-list"
            role="group"
            aria-label="All tabs in this column"
            ref={(element) => {
              // With a filter field, Popover focuses the field instead.
              if (element && tabs.length < 8)
                element
                  .querySelector<HTMLButtonElement>('[aria-pressed="true"]')
                  ?.focus({ preventScroll: true });
            }}
            onKeyDown={(event) => {
              if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
                return;
              const buttons = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  ".pane-overflow-row > button:first-child",
                ),
              );
              if (!buttons.length) return;
              event.preventDefault();
              const index = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? buttons.length - 1
                    : (index +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        buttons.length) %
                      buttons.length;
              buttons[next]?.focus();
            }}
          >
            {tabs.length >= 8 && (
              <input
                className="pane-overflow-filter"
                aria-label="Find a tab"
                placeholder="Find a tab"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => {
                  const first = inView[0] ?? away[0];
                  if (e.key === "Enter" && first) {
                    e.preventDefault();
                    close();
                    onPick(first);
                  }
                }}
              />
            )}
            {inView.map((id) => row(id, close))}
            {inView.length > 0 && away.length > 0 && <hr />}
            {away.length > 0 && (
              <span className="pane-overflow-heading">Out of view</span>
            )}
            {away.map((id) => row(id, close))}
            {!inView.length && !away.length && (
              <span className="pane-overflow-empty">No matching tabs</span>
            )}
          </div>
        )}
      </Popover>
    </span>
  );
}
