import { ShellIcon } from "./ShellIcon";

export type SwitchTool = "ask" | "study";

/**
 * Ask Knot ⇄ Study, in both panels' headers. The other tab comes to the
 * front, or opens in this column if it was closed. Both stay ordinary tabs
 * that the column's + menu also opens.
 */
export function ToolSwitch({
  current,
  onSwitch,
  studyUnavailable,
}: {
  current: SwitchTool;
  onSwitch: (to: SwitchTool) => void;
  /** Study belongs to a notebook: off in the Library. */
  studyUnavailable?: boolean;
}) {
  const option = (
    tool: SwitchTool,
    label: string,
    icon: "sparkles" | "study",
    tooltip: string,
    unavailable = false,
  ) => (
    <button
      type="button"
      className="tool-switch-option"
      aria-pressed={current === tool}
      aria-disabled={unavailable || undefined}
      data-tooltip={tooltip}
      onClick={() => {
        if (current !== tool && !unavailable) onSwitch(tool);
      }}
    >
      <ShellIcon name={icon} />
      <span>{label}</span>
    </button>
  );
  return (
    <div
      className="tool-switch"
      role="group"
      aria-label="Switch between Ask Knot and Study"
    >
      {option("ask", "Ask", "sparkles", "Ask Knot")}
      {option(
        "study",
        "Study",
        "study",
        studyUnavailable ? "Open a notebook to study" : "Study courses",
        studyUnavailable,
      )}
    </div>
  );
}
