import type { ComponentProps } from "react";
import { ShellIcon } from "./ShellIcon";

/** Shared presentation for fixed starters and generated suggestions. */
export function AskSuggestion({
  label,
  icon = "sparkles",
  onClick,
}: {
  label: string;
  icon?: ComponentProps<typeof ShellIcon>["name"];
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick}>
      <ShellIcon name={icon} />
      <span className="ask-suggestion-label">{label}</span>
      <span className="ask-suggestion-arrow" aria-hidden="true">
        ↗
      </span>
    </button>
  );
}
