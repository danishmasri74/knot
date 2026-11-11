import { useEffect, useRef, useState, type ReactNode } from "react";

export function Notice({
  children,
  onDismiss,
  duration = 5000,
  busy = false,
}: {
  children: ReactNode;
  onDismiss: () => void;
  duration?: number;
  busy?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    if (hovered || focused || busy) return;
    const timer = window.setTimeout(() => dismiss.current(), duration);
    return () => window.clearTimeout(timer);
  }, [hovered, focused, busy, duration]);
  return (
    <div
      role="status"
      className="notice-banner"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setFocused(false);
      }}
    >
      {children}
    </div>
  );
}
