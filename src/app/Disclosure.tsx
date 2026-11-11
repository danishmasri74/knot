import { useEffect, useRef, useState, type ReactNode } from "react";

/** Keep closing content alive until its fold finishes. */
export function Disclosure({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  const [present, setPresent] = useState(open);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (open) {
      setPresent(true);
      setExpanded(true);
      return;
    }
    setExpanded(false);
    const timer = setTimeout(() => setPresent(false), 240);
    return () => clearTimeout(timer);
  }, [open]);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (root.current) root.current.inert = !open;
  }, [open]);
  return (
    <div
      ref={root}
      className="animated-disclosure"
      data-expanded={expanded && open}
      aria-hidden={!open}
    >
      <div>{present && children}</div>
    </div>
  );
}
