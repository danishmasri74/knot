import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ShellIcon } from "./ShellIcon";

/** Measure rendered content so short proposals never acquire unnecessary chrome. */
export function AiProposalPreview({ children }: { children: ReactNode }) {
  const id = useId();
  const content = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const [long, setLong] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const collapsed = long && !expanded;

  useLayoutEffect(() => {
    const node = content.current;
    if (!node) return;
    const measure = () => setLong(node.scrollHeight > 144);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (content.current) content.current.inert = collapsed;
  }, [collapsed]);

  return (
    <div className="ask-proposal-preview" data-collapsed={collapsed}>
      <div className="ask-proposal-preview-window">
        <div id={id} ref={content} aria-hidden={collapsed || undefined}>
          {children}
        </div>
      </div>
      {long && (
        <button
          type="button"
          ref={toggle}
          className="ask-preview-toggle"
          aria-controls={id}
          aria-expanded={expanded}
          onClick={() => {
            setExpanded(!expanded);
            if (expanded)
              requestAnimationFrame(() =>
                toggle.current?.scrollIntoView({ block: "nearest" }),
              );
          }}
        >
          <ShellIcon name="chevron" />
          {expanded ? "Collapse preview" : "Show full preview"}
        </button>
      )}
    </div>
  );
}
