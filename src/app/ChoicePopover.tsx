import { Popover } from "./Collections";
import { ShellIcon } from "./ShellIcon";

export function ChoicePopover({
  label,
  icon,
  value,
  options,
  onChange,
  className = "",
  disabled = false,
  placement = "bottom",
}: {
  label: string;
  icon?: "sortAlpha" | "filter";
  value: string;
  options: string[];
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  placement?: "top" | "bottom";
}) {
  return (
    <Popover
      label={label}
      className={`${icon ? "deck-tool-button" : "library-filter-button"} ${className}`}
      disabled={disabled}
      placement={placement}
      trigger={
        icon ? (
          <ShellIcon name={icon} />
        ) : (
          <>
            <span>{value}</span>
            <ShellIcon name="chevron" />
          </>
        )
      }
    >
      {(close) => (
        <div
          role="group"
          aria-label={label}
          className="library-filter-options"
          ref={(element) => {
            element
              ?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
              ?.focus({ preventScroll: true });
          }}
          onKeyDown={(event) => {
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
              return;
            const buttons = Array.from(
              event.currentTarget.querySelectorAll("button"),
            );
            const index = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? buttons.length - 1
                  : (index +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      buttons.length) %
                    buttons.length;
            event.preventDefault();
            buttons[next]?.focus();
          }}
        >
          {options.map((option) => (
            <button
              key={option}
              aria-pressed={option === value}
              onClick={() => {
                onChange(option);
                close();
              }}
            >
              <span>{option}</span>
              {option === value && <ShellIcon name="check" />}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}
