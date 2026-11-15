import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type Dispatch,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { browserApi, browserBounds } from "../services/browser";
import { ShellIcon } from "./ShellIcon";
import { ShellMenu } from "./ShellMenu";
import {
  columnDropPreview,
  edgeDropPreview,
  projectLayout,
  minimumWidth,
  MAX_COLUMNS,
  RAIL_WIDTH,
  tabPolicy,
  hasCanvas,
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
export function ColumnVisibilityToggle({
  layout,
  dispatch,
  disabled = false,
}: {
  layout: WorkspaceLayout;
  dispatch: Dispatch<LayoutAction>;
  disabled?: boolean;
}) {
  const label = layout.hidden ? "Show columns" : "Hide columns";
  // Hiding leaves only the canvas column, so it needs a canvas and something
  // else to hide.
  const others = Object.values(layout.tabs).some((t) => t.kind !== "canvas");
  return (
    <button
      aria-label={label}
      data-tooltip={label}
      aria-pressed={!layout.hidden && others}
      aria-controls="supporting-columns"
      disabled={disabled || !others || !hasCanvas(layout)}
      onClick={() => dispatch({ type: "visibility", hidden: !layout.hidden })}
    >
      <ShellIcon name="columns" />
    </button>
  );
}
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
  /** Pinned first in the first column's tab row (the notebook pill). It gets
   * that column's menu sections; when it renders, the column has no ⋯ menu. */
  lead?: (columnMenu: ReactNode[]) => ReactNode;
  /** "Open in this column" items for a column's menu. */
  newTab?: (group: string) => ReactNode;
  /** Controls for a column's active tab, at the end of its tab row. */
  tools?: (tab: PaneTab) => ReactNode;
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
  // With two columns, collapsing one expands the other.
  const collapse = (groupId: string) => {
    const other = layout.groups.find((g) => g.id !== groupId);
    if (other) dispatch({ type: "expand", group: other.id });
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
    if (!dragging || dragging.startsWith("group:")) return null;
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
  /** A column's menu, in sections. The first column's sections join the
   * notebook pill's menu (lead) instead of a ⋯ button. */
  const columnSections = (group: (typeof layout.groups)[number]) => {
    return [
      newTab?.(group.id),
      layout.groups.length > 1 && !projection.collapsed && (
        <>
          <button
            onClick={() =>
              dispatch(
                expanded
                  ? { type: "restore" }
                  : { type: "expand", group: group.id },
              )
            }
          >
            {expanded ? "Show both columns" : "Expand column"}
          </button>
          {!expanded && (
            <button onClick={() => collapse(group.id)}>Collapse column</button>
          )}
        </>
      ),
      <>
        <button
          disabled={!roomForColumn || group.tabIds.length < 2}
          data-tooltip={
            !roomForColumn ? "Widen the window to separate a tab" : undefined
          }
          onClick={() =>
            move(
              { type: "split", id: group.activeTabId, side: "left" },
              "Tab separated to the left",
            )
          }
        >
          Separate tab to left
        </button>
        <button
          disabled={!roomForColumn || group.tabIds.length < 2}
          onClick={() =>
            move(
              { type: "split", id: group.activeTabId, side: "right" },
              "Tab separated to the right",
            )
          }
        >
          Separate tab to right
        </button>
        {(["left", "right"] as const).map((side) => {
          const at = layout.groups.findIndex((g) => g.id === group.id);
          const neighbour = layout.groups[side === "left" ? at - 1 : at + 1];
          if (at < 0 || !neighbour) return null;
          return (
            <Fragment key={side}>
              <button
                onClick={() =>
                  move(
                    {
                      type: "move",
                      id: group.activeTabId,
                      group: neighbour.id,
                    },
                    `Tab moved to the ${side} column`,
                  )
                }
              >
                Move tab to {side} column
              </button>
              <button
                onClick={() =>
                  move(
                    layout.groups.length === 2
                      ? { type: "swap" }
                      : {
                          type: "moveColumn",
                          group: group.id,
                          index: side === "left" ? at - 1 : at + 1,
                        },
                    "Column moved",
                  )
                }
              >
                Move column {side}
              </button>
              <button
                onClick={() =>
                  move(
                    { type: "merge", group: group.id, into: neighbour.id },
                    "Columns merged",
                  )
                }
              >
                Merge with {side} column
              </button>
            </Fragment>
          );
        })}
        <button onClick={() => close(group.activeTabId)}>Close tab</button>
      </>,
    ].filter(Boolean);
  };
  const slots = projection.groups.map((g, index) => ({
    group: g,
    width: projection.widths[index],
    left: projection.lefts[index],
  }));
  const leadNode = slots[0] && lead?.(columnSections(slots[0].group));
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
          <button
            className="pane-rail-toggle"
            aria-label="Show column"
            data-tooltip={expanded ? "Show column (Esc)" : "Show column"}
            onClick={() =>
              expanded
                ? dispatch({ type: "restore" })
                : activate(group.activeTabId)
            }
          >
            <ShellIcon name="expand" />
          </button>
          {group.tabIds.map((id) => (
            <button
              key={id}
              aria-label={`Show ${label(layout.tabs[id])}`}
              data-tooltip={label(layout.tabs[id])}
              data-active={id === group.activeTabId}
              // Brings the column back showing this tab.
              onClick={() => activate(id)}
            >
              <ShellIcon
                name={icon?.(layout.tabs[id]) ?? icons[layout.tabs[id].kind]}
              />
            </button>
          ))}
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
            onKeyDown={(e) => {
              if (
                e.key === "Escape" &&
                !e.defaultPrevented &&
                !dragging &&
                !document.querySelector(
                  ".shell-menu[open], :popover-open, dialog[open]",
                )
              ) {
                e.preventDefault();
                e.stopPropagation();
                // Esc first restores an expanded column, then closes tabs.
                if (expanded) dispatch({ type: "restore" });
                else if (layout.tabs[group.activeTabId]?.kind !== "canvas")
                  close(group.activeTabId);
              }
            }}
            onDragOver={(e) => {
              if (!dragging) return;
              if (dragging.startsWith("group:")) {
                if (expanded || projection.single) return;
                const source = layout.groups.findIndex(
                  (g) => g.id === dragging.slice(6),
                );
                if (source < 0 || source === index) return;
                setDropSide(index < source ? "left" : "right");
              } else {
                const strip =
                  e.currentTarget.querySelector<HTMLElement>(".pane-tabs");
                if (strip) setTabDrop(tabInsertion(strip, group.id, e.clientX));
              }
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
              if (dragging.startsWith("group:")) {
                const source = dragging.slice(6);
                if (!expanded && !projection.single && source !== group.id)
                  move(
                    layout.groups.length === 2
                      ? { type: "swap" }
                      : { type: "moveColumn", group: source, index },
                    "Column moved",
                  );
                else endGesture();
              } else {
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
              }
            }}
          >
            {index === 0 && leadNode}
            <TabStrip
              activeTab={group.activeTabId}
              role="tablist"
              aria-label="Tabs"
              className="pane-tabs"
              onDragOver={(e) => {
                if (!dragging || dragging.startsWith("group:")) return;
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
                if (!dragging || dragging.startsWith("group:")) return;
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
            {layout.tabs[group.activeTabId] && (
              <span className="pane-tools">
                {tools?.(layout.tabs[group.activeTabId])}
              </span>
            )}
            {expanded ? (
              <button
                className="pane-expand"
                aria-label="Show both columns"
                data-tooltip="Show both columns (Esc)"
                onClick={() => dispatch({ type: "restore" })}
              >
                <ShellIcon name="columns" />
              </button>
            ) : (
              layout.groups.length > 1 &&
              !projection.collapsed && (
                // Side by side: fold this column into a rail.
                <button
                  className="pane-expand"
                  aria-label="Collapse column"
                  data-tooltip="Collapse column"
                  onClick={() => collapse(group.id)}
                >
                  <ShellIcon name="collapse" />
                </button>
              )
            )}
            {!(index === 0 && leadNode) && (
              <ShellMenu
                label="Pane actions"
                icon={<ShellIcon name="more" />}
                className="pane-menu"
              >
                {columnSections(group).map((section, i) => (
                  <Fragment key={i}>
                    {i > 0 && <hr />}
                    {section}
                  </Fragment>
                ))}
              </ShellMenu>
            )}
            <button
              className="pane-group-drag"
              draggable
              aria-label="Move column"
              onDragStart={(e) => {
                if (composing.current) {
                  e.preventDefault();
                  return;
                }
                beginGesture();
                setDragging(`group:${group.id}`);
                e.dataTransfer.setData("application/x-knot-pane", group.id);
              }}
              onDragEnd={endGesture}
            >
              <ShellIcon name="gripVertical" />
            </button>
          </header>
        </div>
      ))}
      {dragging &&
        !expanded &&
        (["left", "right"] as const).map((side) => {
          const movingColumn = dragging.startsWith("group:");
          const preview = movingColumn
            ? columnDropPreview(layout, dragging.slice(6), side, available)
            : edgeDropPreview(layout, dragging, side, available);
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
              {movingColumn
                ? `Move column ${side}`
                : `${preview.action.type === "split" ? "New" : "Move to"} ${side} column`}
            </div>
          );
        })}
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
            onFocusCapture={() => {
              if (
                layout.lastUsedGroupId !==
                layout.groups.find((g) => g.tabIds.includes(tab.id))?.id
              )
                dispatch({ type: "activate", id: tab.id });
            }}
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
 * show there's more, and the active tab is kept in view. */
function TabStrip({
  activeTab,
  ...props
}: { activeTab: string | null } & HTMLAttributes<HTMLDivElement>) {
  const strip = useRef<HTMLDivElement>(null);
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
    };
    const resize = new ResizeObserver(update);
    resize.observe(el);
    const tabs = new MutationObserver(update);
    tabs.observe(el, { childList: true, subtree: true, characterData: true });
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
