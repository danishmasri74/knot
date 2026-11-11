import { Popover } from "./Collections";
import { ShellIcon } from "./ShellIcon";
import { webSourceLabel } from "../services/web-sources";
import type { WebAttempt, WebEvidence } from "../services/web-source-types";

export function WebSourceList({
  sources,
  busy,
  onRemove,
  onCapture,
}: {
  sources: WebAttempt[];
  busy: boolean;
  onRemove: (id: string) => void;
  onCapture: (source: WebAttempt) => void;
}) {
  if (!sources.length) return null;
  return (
    <div className="web-source-list" aria-label="Website sources">
      {sources.map((source) => {
        const label = source.capture?.title || webSourceLabel(source.url);
        return (
          <div
            key={source.id}
            className="web-source-item"
            title={source.reason || source.url}
          >
            <ShellIcon name="link" />
            <Popover
              label={`Website details: ${label}`}
              trigger={<span>{label}</span>}
            >
              {(close) => (
                <div>
                  <strong>{label}</strong>
                  <p>
                    {source.state}
                    {source.reason ? ` · ${source.reason}` : ""}
                  </p>
                  {source.capture && (
                    <small>
                      {source.capture.sections.length} retained sections
                    </small>
                  )}
                  <button
                    disabled={busy}
                    onClick={() => {
                      close();
                      onCapture(source);
                    }}
                  >
                    {source.state === "failed" || source.state === "cancelled"
                      ? "Retry"
                      : "Refresh"}
                  </button>
                </div>
              )}
            </Popover>
            {source.state !== "ready" && <small>{source.state}</small>}
            <button
              type="button"
              aria-label={`Remove website: ${label}`}
              disabled={busy}
              onClick={() => onRemove(source.id)}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
export function WebCoverage({ context }: { context?: string }) {
  try {
    const data = JSON.parse(context ?? "{}");
    const outcomes = data.webOutcomes as
      | { sourceId: string; url: string; state: string; reason?: string }[]
      | undefined;
    if (!outcomes?.length) return null;
    const used = outcomes.filter((s) =>
      ["ready", "partial"].includes(s.state),
    ).length;
    return (
      <details
        className="web-coverage"
        open={
          used < outcomes.length ||
          data.webEvidence?.some((e: WebEvidence) => e.warnings.length)
        }
      >
        <summary>
          {used} of {outcomes.length} website sources used
        </summary>
        {outcomes
          .filter((s) => !["ready", "partial"].includes(s.state))
          .map((s) => (
            <p key={s.sourceId}>
              Excluded: {webSourceLabel(s.url)} · {s.reason ?? s.state}
            </p>
          ))}
        {(data.webEvidence as WebEvidence[]).map((e) => (
          <div key={e.captureId}>
            <strong>{e.title}</strong>
            {e.warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
            <small>
              Supplied sections:{" "}
              {(data.citationSources ?? [])
                .filter(
                  (s: { captureId?: string }) => s.captureId === e.captureId,
                )
                .map((s: { sectionId: string }) => s.sectionId)
                .join(", ")}
              . Omitted: {e.omitted.join(", ") || "none"}.
            </small>
          </div>
        ))}
      </details>
    );
  } catch {
    return null;
  }
}
