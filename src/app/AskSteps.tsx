import { useState } from "react";
import { ShellIcon } from "./ShellIcon";
import {
  stepSummary,
  visibleSteps,
  type AskStep,
} from "../services/ask-steps";

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
