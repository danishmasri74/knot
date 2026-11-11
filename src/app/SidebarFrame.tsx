import { useEffect, useRef, useState, type ReactNode } from "react";
const MIN = 200;
const MAX = 400;
const clamp = (width: number) => Math.max(MIN, Math.min(MAX, width));
function readWidth() {
  try {
    const value = Number(localStorage.getItem("knot.sidebar.width"));
    return value ? clamp(value) : 232;
  } catch {
    return 232;
  }
}
export function SidebarFrame({
  collapsed,
  onCollapse,
  children,
}: {
  collapsed: boolean;
  onCollapse: (value: boolean) => void;
  children: ReactNode;
}) {
  const [width, setWidth] = useState(readWidth);
  const [dragging, setDragging] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const origin = useRef({ x: 0, width: 232 });
  useEffect(() => {
    if (root.current) root.current.inert = collapsed;
  }, [collapsed]);
  useEffect(() => {
    try {
      localStorage.setItem("knot.sidebar.width", String(width));
    } catch {
      /* Optional UI preference. */
    }
  }, [width]);
  return (
    <div
      ref={root}
      className="sidebar-frame"
      data-collapsed={collapsed}
      data-dragging={dragging}
      aria-hidden={collapsed}
      style={{ "--sidebar-width": `${width}px` } as React.CSSProperties}
    >
      {children}
      <div
        className="sidebar-resizer"
        role="separator"
        tabIndex={collapsed ? -1 : 0}
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        aria-valuemin={MIN}
        aria-valuemax={MAX}
        aria-valuenow={width}
        data-tooltip="Drag to resize · Double-click to collapse"
        onDoubleClick={() => onCollapse(true)}
        onKeyDown={(event) => {
          const next =
            event.key === "Home"
              ? MIN
              : event.key === "End"
                ? MAX
                : event.key === "ArrowLeft"
                  ? width - 16
                  : event.key === "ArrowRight"
                    ? width + 16
                    : null;
          if (next !== null) {
            event.preventDefault();
            setWidth(clamp(next));
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          origin.current = { x: event.clientX, width };
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            setWidth(
              clamp(origin.current.width + event.clientX - origin.current.x),
            );
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
          setDragging(false);
        }}
        onLostPointerCapture={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
      />
    </div>
  );
}
