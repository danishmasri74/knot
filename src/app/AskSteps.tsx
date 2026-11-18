import { useEffect, useState } from "react";
import { ShellIcon } from "./ShellIcon";
import {
  stepSummary,
  visibleSteps,
  type AskStep,
} from "../services/ask-steps";

/**
 * How long the running step has taken, ticking each second, so a long step
 * (building a section, checking the layout) visibly keeps going. Shown from
 * 3 s on; quick steps don't need it.
 */
function StepClock({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.floor((now - since) / 1000);
  if (seconds < 3) return null;
  return (
    <span className="ask-step-clock">
      {seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, "0")} s`}
    </span>
  );
}

/** What Knot is doing right now, one line per step. */
export function AskStepList({ steps }: { steps: AskStep[] | undefined }) {
  const shown = visibleSteps(steps);
  if (!shown.length)
    return (
      <span className="ask-thinking">
        Thinking<span>…</span>
      </span>
    );
  return (
    <ol className="ask-steps" aria-label="Progress" aria-live="polite">
      {shown.map((step, i) => (
        <li key={`${step.id}-${i}`} data-state={step.state}>
          {step.state === "active" ? (
            <span className="ask-step-spinner" aria-hidden="true" />
          ) : (
            <ShellIcon name={step.state === "failed" ? "close" : "check"} />
          )}
          <span>
            {step.state === "active"
              ? `${step.label}…`
              : step.state === "failed"
                ? `${step.label} (stopped)`
                : step.done}
          </span>
          {step.state === "active" && <StepClock since={step.at} />}
        </li>
      ))}
    </ol>
  );
}

/** A finished (or writing) answer's steps folded into one quiet line. */
export function AskStepSummary({ steps }: { steps: AskStep[] | undefined }) {
  const [open, setOpen] = useState(false);
  const summary = stepSummary(steps);
  if (!summary) return null;
  return (
    <div className="ask-step-summary">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ShellIcon name="chevron" />
        <span>{summary}</span>
      </button>
      {open && <AskStepList steps={steps} />}
    </div>
  );
}
