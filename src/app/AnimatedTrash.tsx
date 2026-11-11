import { useEffect, useId, useState } from "react";
import { ShellIcon } from "./ShellIcon";

export function AnimatedTrash({
  revision = 0,
  item = "notebook",
  dragOver = false,
  dropped = false,
}: {
  revision?: number;
  item?: "notebook" | "folder";
  dragOver?: boolean;
  dropped?: boolean;
}) {
  const clip = useId();
  const [finishedRevision, setFinishedRevision] = useState(0);
  useEffect(() => {
    if (dragOver) {
      setFinishedRevision(revision);
      return;
    }
    // Let animationend finish the sequence, even if refreshing the editor
    // occupies the main thread. A wall-clock timeout can skip visible frames.
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finishWithoutMotion = () => {
      if (motion.matches) setFinishedRevision(revision);
    };
    finishWithoutMotion();
    motion.addEventListener("change", finishWithoutMotion);
    return () => motion.removeEventListener("change", finishWithoutMotion);
  }, [revision, dragOver]);
  const playing = revision !== finishedRevision && !dragOver;
  return (
    <svg
      className="shell-icon animated-trash"
      data-icon="trash"
      data-drag-over={dragOver}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={clip}>
          <path d="M0-14h24v21H0z" />
        </clipPath>
      </defs>
      <g
        key={revision}
        className={
          playing
            ? dropped
              ? "trash-drop-feedback"
              : "trash-feedback"
            : undefined
        }
        onAnimationEnd={(event) => {
          if (
            event.animationName === "trash-lid" ||
            event.animationName === "trash-drop-lid"
          )
            setFinishedRevision(revision);
        }}
      >
        <g clipPath={`url(#${clip})`}>
          <g className="animated-trash-item">
            <ShellIcon name={item} size={8} />
          </g>
        </g>
        <path d="M5 6l1 15h12l1-15 M10 10v7 M14 10v7" />
        <g className="animated-trash-lid">
          <path d="M3 6h18 M9 6V3h6v3" />
        </g>
      </g>
    </svg>
  );
}
