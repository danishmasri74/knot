import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
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
  type WorkspaceLayout,
  type LayoutAction,
  type PaneTab,
} from "./workspace-layout";
const icons = {
  note: "note",
  pdf: "highlight",
  browser: "globe",
  ask: "sparkles",
  cardDeck: "cardDeck",
  reference: "link",
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
  return (
    <button
      aria-label={label}
      data-tooltip={label}
      aria-pressed={!layout.hidden && !!layout.groups.length}
      aria-controls="supporting-columns"
      disabled={disabled || !layout.groups.length}
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
  expanded = false,
}: {
  expanded?: boolean;
  layout: WorkspaceLayout;
  dispatch: Dispatch<LayoutAction>;
  available: number;
  blocked: boolean;
  label: (tab: PaneTab) => string;
  render: (tab: PaneTab, onClose: () => void) => ReactNode;
  contentKey?: (tab: PaneTab) => string;
  onReturn: () => void;
}) {
  const projection = projectLayout(layout, available);
  if (expanded && layout.groups.length) {
    const activeGroup =
      layout.groups.find((g) => g.id === layout.lastUsedGroupId) ??
      layout.groups[0];
    projection.groups = [
      { ...activeGroup, tabIds: layout.groups.flatMap((g) => g.tabIds) },
    ];
    projection.widths = [Math.max(0, available - 1)];
    projection.single = true;
  }
  const hidden = layout.hidden || !layout.groups.length;
  const [announcement, setAnnouncement] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropSide, setDropSide] = useState<"left" | "right" | null>(null);
  const [tabDrop, setTabDrop] = useState<{
    strip: string;
    group: string;
    index: number;
    left: number;
  } | null>(null);
  const composing = useRef(false);
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
  const total = projection.widths.reduce((n, w) => n + w + 1, 0);
  useLayoutEffect(() => {
    const parent = root.current?.parentElement;
    if (!parent) return;
    parent.dataset.singleContent = String(projection.single && !hidden);
    parent.style.setProperty("--support-width", `${hidden ? 0 : total}px`);
    parent
      .closest("main")
      ?.style.setProperty("--support-width", `${hidden ? 0 : total}px`);
  }, [total, projection.single, hidden]);
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
  const resize = (index: number, value: number, widths = projection.widths) => {
    const group = projection.groups[index];
    if (index && !projection.collapsed)
      dispatch({
        type: "resizePair",
        left: projection.groups[index - 1].id,
        right: group.id,
        leftWidth: widths[index - 1] + widths[index] - value,
        total: widths[index - 1] + widths[index],
      });
    else
      dispatch({
        type: "resize",
        group: group.id,
        width: Math.min(
          Math.max(
            minimumWidth(layout, group),
            available -
              360 -
              widths.slice(1).reduce((a, b) => a + b, 0) -
              widths.length,
          ),
          value,
        ),
      });
  };
  const slots = projection.groups.map((g, index) => ({
    group: g,
    width: projection.widths[index],
    left: projection.widths.slice(0, index).reduce((n, w) => n + w + 1, 0),
  }));
  return (
    <div
      ref={root}
      id="supporting-columns"
      className="workspace-panes"
      data-collapsed={hidden}
      style={{ "--pane-width": `${total}px` } as CSSProperties}
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
      {slots.map(({ group, width, left }, index) => (
        <div className="pane-group" key={group.id} style={{ left, width }}>
          <div
            className="pane-divider"
            role="separator"
            tabIndex={0}
            aria-label={
              index ? "Resize supporting columns" : "Resize supporting pane"
            }
            aria-orientation="vertical"
            aria-valuemin={minimumWidth(layout, group)}
            aria-valuemax={Math.max(
              minimumWidth(layout, group),
              available - 360,
            )}
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
          />
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
                close(group.activeTabId);
              }
            }}
            onDragOver={(e) => {
              if (!dragging) return;
              if (dragging.startsWith("group:")) {
                const side = index === 0 ? "left" : "right";
                if (
                  expanded ||
                  !columnDropPreview(layout, dragging.slice(6), side, available)
                )
                  return;
                setDropSide(side);
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
              const side = index === 0 ? "left" : "right";
              setDropSide((current) => (current === side ? null : current));
              setTabDrop((current) =>
                current?.strip === group.id ? null : current,
              );
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (!dragging) return;
              if (dragging.startsWith("group:")) {
                const preview =
                  !expanded &&
                  columnDropPreview(
                    layout,
                    dragging.slice(6),
                    index === 0 ? "left" : "right",
                    available,
                  );
                if (preview) move(preview.action, "Columns swapped");
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
            {projection.single && (
              <button
                className="pane-return"
                aria-label="Back to canvas or page"
                data-tooltip="Back to canvas or page"
                onClick={() => {
                  dispatch({ type: "visibility", hidden: true });
                  onReturn();
                }}
              >
                <ShellIcon name="back" />
              </button>
            )}
            <TabStrip
              activeTab={group.activeTabId}
              role="tablist"
              aria-label="Supporting content"
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
                    <ShellIcon name={icons[layout.tabs[id].kind]} />
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
            <ShellMenu
              label="Pane actions"
              icon={<ShellIcon name="more" />}
              className="pane-menu"
            >
              {group.tabIds.map((id) => (
                <button key={id} onClick={() => activate(id)}>
                  {label(layout.tabs[id])}
                </button>
              ))}
              <hr />
              <button
                disabled={
                  layout.groups.length >= 2 ||
                  group.tabIds.length < 2 ||
                  available < 1082
                }
                data-tooltip={
                  available < 1082
                    ? "Widen the window to separate a tab"
                    : undefined
                }
                onClick={() =>
                  move(
                    { type: "split", id: group.activeTabId, side: "left" },
                    "Tab separated to the left",
                  )
                }
              >
                Show beside current tab
              </button>
              <button
                disabled={
                  layout.groups.length >= 2 ||
                  group.tabIds.length < 2 ||
                  available < 1082
                }
                onClick={() =>
                  move(
                    { type: "split", id: group.activeTabId, side: "right" },
                    "Tab separated to the right",
                  )
                }
              >
                Separate tab to right
              </button>
              {layout.groups.length === 2 && (
                <>
                  <button
                    onClick={() =>
                      move(
                        {
                          type: "move",
                          id: group.activeTabId,
                          group: layout.groups.find(
                            (g) => !g.tabIds.includes(group.activeTabId),
                          )!.id,
                        },
                        "Tab moved to other column",
                      )
                    }
                  >
                    {layout.groups.findIndex((g) =>
                      g.tabIds.includes(group.activeTabId),
                    ) === 0
                      ? "Move to right pane"
                      : "Move to left pane"}
                  </button>
                  <button
                    onClick={() => move({ type: "swap" }, "Columns swapped")}
                  >
                    {layout.groups.findIndex((g) =>
                      g.tabIds.includes(group.activeTabId),
                    ) === 0
                      ? "Move pane right"
                      : "Move pane left"}
                  </button>
                  <button
                    onClick={() =>
                      move(
                        {
                          type: "merge",
                          group: layout.groups.find((g) =>
                            g.tabIds.includes(group.activeTabId),
                          )!.id,
                        },
                        "Columns merged",
                      )
                    }
                  >
                    {layout.groups.findIndex((g) =>
                      g.tabIds.includes(group.activeTabId),
                    ) === 0
                      ? "Merge with right pane"
                      : "Merge with left pane"}
                  </button>
                </>
              )}
              <button onClick={() => close(group.activeTabId)}>
                Close tab
              </button>
            </ShellMenu>
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
              style={{ right: preview.right, width: preview.width }}
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
        const slot = slots.find((s) => s.group.tabIds.includes(tab.id))!;
        const visible = slot.group.activeTabId === tab.id;
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
            {render(tab, () => close(tab.id))}
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
    const wheel = (event: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      el.scrollLeft += event.deltaY;
      event.preventDefault();
    };
    const resize = new ResizeObserver(update);
    resize.observe(el);
    const tabs = new MutationObserver(update);
    tabs.observe(el, { childList: true, subtree: true, characterData: true });
    el.addEventListener("scroll", update, { passive: true });
    el.addEventListener("wheel", wheel, { passive: false });
    update();
    return () => {
      resize.disconnect();
      tabs.disconnect();
      el.removeEventListener("scroll", update);
      el.removeEventListener("wheel", wheel);
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
