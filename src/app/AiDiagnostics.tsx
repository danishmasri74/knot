import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ShellIcon } from "./ShellIcon";
import {
  summarizeAttempts,
  summarizeCache,
  type AiDiagnosticsSnapshot,
} from "../services/ai-diagnostics";

const operationLabels = {
  "auto:answer": "Answer",
  "auto:rewrite": "Rewrite proposal",
  "auto:insert": "Insert proposal",
  "auto:canvas": "Canvas proposal",
  "auto:note": "New note proposal",
  "auto:search": "Workspace search",
  "auto:images": "Image viewing",
  auto: "Ask Knot (unfinished)",
  ask: "Ask Knot (forced answer)",
  rewrite: "Rewrite",
  insert: "Insert",
  canvas: "Canvas",
  suggestions: "Suggestions",
  unknown: "Other",
};

/** Small cache amounts need more places than whole-request costs. */
const usd = (n: number) => `$${Math.abs(n).toFixed(4)}`;

const statusLabels = {
  running: "In progress",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
};

export function AiDiagnostics() {
  const [data, setData] = useState<AiDiagnosticsSnapshot>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState("");
  const [operation, setOperation] = useState("");
  const [status, setStatus] = useState("");
  const [days, setDays] = useState(90);
  const [limit, setLimit] = useState(30);
  const [clear, setClear] = useState(false);
  async function load(
    command = "ai_diagnostics",
    args?: Record<string, unknown>,
  ) {
    setBusy(true);
    try {
      setData(await invoke<AiDiagnosticsSnapshot>(command, args));
      setError("");
    } catch {
      setError("Diagnostics are unavailable. AI still works. Try refreshing.");
    } finally {
      setBusy(false);
    }
  }
  const attempts = (data?.attempts ?? []).filter(
    (a) =>
      (!model || a.model === model) &&
      (!operation || a.operation === operation) &&
      (!status || a.status === status) &&
      a.started >= Date.now() / 1000 - days * 86400,
  );
  const summary = summarizeAttempts(attempts);
  const cache = summarizeCache(attempts);
  const selectedIds = new Set(attempts.map((a) => a.id));
  const outcomes =
    data?.outcomes.filter((o) => selectedIds.has(o.attempt)) ?? [];
  return (
    <section className="ai-diagnostics" aria-labelledby="ai-diagnostics-title">
      <details
        onToggle={(event) => {
          if (event.currentTarget.open && !data && !busy) void load();
        }}
      >
        <summary className="diagnostics-disclosure">
          <span>
            <strong id="ai-diagnostics-title">Usage &amp; diagnostics</strong>
            <small>
              Review AI usage and troubleshoot requests on this device.
            </small>
          </span>
          <ShellIcon name="chevron" />
        </summary>
        <div className="diagnostics-content" aria-busy={busy}>
          <div className="settings-row">
            <div>
              <strong id="ai-diagnostics-label">Collect diagnostics</strong>
              <p>
                Store request measurements on this device for up to 90 days.
              </p>
            </div>
            <button
              className="settings-toggle"
              role="switch"
              aria-labelledby="ai-diagnostics-label"
              aria-checked={data?.enabled ?? false}
              disabled={busy || !data}
              onClick={() =>
                void load("ai_diagnostics_enabled", { enabled: !data?.enabled })
              }
            >
              <span />
            </button>
          </div>
          {busy && !data && <p role="status">Loading diagnostics…</p>}
          {error && <p role="alert">{error}</p>}
          <div className="diagnostics-controls">
            <button disabled={busy} onClick={() => void load()}>
              Refresh
            </button>
            <button
              disabled={busy || !data}
              onClick={async () => {
                setBusy(true);
                try {
                  await invoke("ai_diagnostics_export");
                  setError("");
                } catch {
                  setError("Could not export diagnostics.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Export all retained records
            </button>
            <button disabled={busy || !data} onClick={() => setClear(true)}>
              Clear diagnostics
            </button>
          </div>
          {clear && (
            <div
              className="diagnostics-confirm"
              role="group"
              aria-label="Confirm clear diagnostics"
            >
              <p>
                Permanently clear all diagnostics? Chats and notes are
                unaffected.
              </p>
              <button onClick={() => setClear(false)}>Cancel</button>
              <button
                disabled={busy}
                onClick={() => {
                  setClear(false);
                  void load("ai_diagnostics_clear");
                }}
              >
                Clear all records
              </button>
            </div>
          )}
          {data && (
            <>
              <div
                className="diagnostics-filters"
                role="group"
                aria-label="Filter diagnostics"
              >
                <label>
                  Period{" "}
                  <select
                    aria-label="Period"
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value))}
                  >
                    <option value={1}>24 hours</option>
                    <option value={7}>7 days</option>
                    <option value={30}>30 days</option>
                    <option value={90}>90 days</option>
                  </select>
                </label>
                <label>
                  Model{" "}
                  <select
                    aria-label="Model"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  >
                    <option value="">All models</option>
                    {[...new Set(data.attempts.map((a) => a.model))].map(
                      (m) => (
                        <option key={m}>{m}</option>
                      ),
                    )}
                  </select>
                </label>
                <label>
                  Operation{" "}
                  <select
                    aria-label="Operation"
                    value={operation}
                    onChange={(e) => setOperation(e.target.value)}
                  >
                    <option value="">All operations</option>
                    {Object.entries(operationLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Status{" "}
                  <select
                    aria-label="Status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    <option value="">All statuses</option>
                    {Object.entries(statusLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="diagnostics-overview" aria-live="polite">
                <div>
                  <span>Requests</span>
                  <strong>
                    {summary.attempts.toLocaleString()}{" "}
                    {summary.attempts === 1 ? "attempt" : "attempts"}
                  </strong>
                  <small>
                    {summary.failed} failed · {summary.cancelled} cancelled
                  </small>
                </div>
                <div>
                  <span>Estimated cost</span>
                  <strong>
                    {summary.priced
                      ? `$${summary.cost.toFixed(6)} USD`
                      : "Unavailable"}
                  </strong>
                  <small>
                    {summary.priced} of {summary.attempts} attempts priced
                  </small>
                </div>
                <div>
                  <span>Prompt caching</span>
                  <strong>
                    {cache.priced
                      ? `${cache.net < 0 ? "Cost" : "Saved"} ${usd(cache.net)}`
                      : "Unavailable"}
                  </strong>
                  <small>
                    {cache.priced
                      ? `${usd(cache.saved)} saved · ${usd(cache.extra)} extra for writes`
                      : "No priced attempts"}
                  </small>
                </div>
              </div>
              {cache.priced > 0 && (
                <details className="diagnostics-technical">
                  <summary className="diagnostics-disclosure">
                    <strong>Prompt caching by operation</strong>
                    <ShellIcon name="chevron" />
                  </summary>
                  <p>
                    {`Writing a cache entry costs 25% more than ordinary input; reading it later costs 90–95% less. A write pays off only when a later turn reads it within 30 minutes. ${
                      cache.readShare === null
                        ? ""
                        : `${Math.round(cache.readShare * 100)}% of input came from the cache. `
                    }${cache.firstWrites} first ${cache.firstWrites === 1 ? "question" : "questions"} paid to write; ${cache.followUps} follow-up ${cache.followUps === 1 ? "turn" : "turns"} (${cache.followUpReads} read from the cache). Writing on first questions pays off at roughly 26–28 cached follow-ups per 100 first questions.`}
                  </p>
                  <div
                    className="diagnostics-cache-table"
                    role="table"
                    aria-label="Prompt caching by operation"
                  >
                    <div role="row">
                      <span role="columnheader">Operation</span>
                      <span role="columnheader">Attempts</span>
                      <span role="columnheader">From cache</span>
                      <span role="columnheader">Write extra</span>
                      <span role="columnheader">Saved</span>
                    </div>
                    {cache.byOperation.map((row) => (
                      <div role="row" key={row.operation}>
                        <span role="cell">
                          {operationLabels[
                            row.operation as keyof typeof operationLabels
                          ] ?? row.operation}
                        </span>
                        <span role="cell">{row.attempts}</span>
                        <span role="cell">
                          {row.readShare === null
                            ? "—"
                            : `${Math.round(row.readShare * 100)}%`}
                        </span>
                        <span role="cell">{usd(row.extra)}</span>
                        <span role="cell">{usd(row.saved)}</span>
                      </div>
                    ))}
                  </div>
                  <p className="settings-description">
                    Estimated at current standard rates from each attempt’s
                    reported usage; attempts without complete usage are left
                    out.
                  </p>
                </details>
              )}
              <details className="diagnostics-technical">
                <summary className="diagnostics-disclosure">
                  <strong>Measurement details &amp; privacy</strong>
                  <ShellIcon name="chevron" />
                </summary>
                <p>
                  Measurements stay on this device, separate from workspaces and
                  backups. Knot records request measurements only. It excludes
                  prompts, answers, note contents and titles, attachments,
                  paths, and API keys. Records expire after 90 days or when they
                  fall outside the latest 20,000 attempts. Turning collection
                  off stops recording in-flight requests. Existing records
                  remain until cleared or expired.
                </p>
                <p className="settings-description">
                  Cost covers only attempts with complete usage and a supported
                  standard service tier. Missing usage is unknown. Cached input
                  is included in input, and reasoning is included in output. New
                  estimates use pricing version openai-standard-2026-11-11-v2;
                  each attempt shows the version it was estimated with. Use your
                  provider’s invoice for actual charges. Each retry counts as a
                  separate billable attempt. Actions on an answer or proposal
                  add no cost.
                </p>
                <p>
                  Known input {summary.input.toLocaleString()} / output{" "}
                  {summary.output.toLocaleString()} tokens from {summary.usage}{" "}
                  of {summary.attempts} attempts. Duration p50{" "}
                  {summary.p50 ?? "unknown"} / p95 {summary.p95 ?? "unknown"}{" "}
                  ms.
                </p>
                <p>
                  Outcomes:{" "}
                  {outcomes.filter((o) => o.kind === "answer_displayed").length}{" "}
                  answers displayed /{" "}
                  {outcomes.filter((o) => o.kind === "proposal_valid").length}{" "}
                  valid proposals /{" "}
                  {outcomes.filter((o) => o.kind === "proposal_invalid").length}{" "}
                  invalid proposals /{" "}
                  {outcomes.filter((o) => o.kind === "apply").length} applied /{" "}
                  {outcomes.filter((o) => o.kind === "dismiss").length}{" "}
                  dismissed / {outcomes.filter((o) => o.kind === "undo").length}{" "}
                  undone
                </p>
                <p>
                  Collection gaps this session: {data.dropped} dropped writes ·{" "}
                  {data.write_failures} storage failures
                </p>
              </details>
              <h4 className="diagnostics-history-title">Recent attempts</h4>
              {!attempts.length && (
                <p className="diagnostics-empty">
                  {data.attempts.length
                    ? "No attempts match these filters."
                    : "No diagnostics have been recorded yet."}
                </p>
              )}
              {attempts.slice(0, limit).map((a) => (
                <details key={a.id} className="diagnostics-attempt">
                  <summary className="diagnostics-disclosure">
                    <span>
                      <strong>
                        {operationLabels[
                          a.operation as keyof typeof operationLabels
                        ] ?? a.operation}
                      </strong>
                      <small>
                        {new Date(a.started * 1000).toLocaleString()} ·{" "}
                        {a.model}
                      </small>
                    </span>
                    <span className="diagnostics-status">
                      {statusLabels[a.status as keyof typeof statusLabels] ??
                        a.status}
                    </span>
                    <ShellIcon name="chevron" />
                  </summary>
                  <div className="diagnostics-attempt-body">
                    <p>
                      Attempt {a.id}
                      {a.link && (
                        <>
                          {" "}
                          · {a.link.kind} of {a.link.parent}
                        </>
                      )}
                    </p>
                    <p>
                      Duration {a.elapsed_ms ?? "unknown"} ms · First text{" "}
                      {a.first_delta_ms ?? "unknown"} ms · HTTP{" "}
                      {a.http_status ?? "unknown"} · Failure{" "}
                      {a.failure ?? "none"}
                    </p>
                    <p>
                      Input {a.usage.input ?? "unknown"} · Cached input{" "}
                      {a.usage.cached ?? "unknown"} · Output{" "}
                      {a.usage.output ?? "unknown"} · Reasoning{" "}
                      {a.usage.reasoning ?? "unknown"} · Total{" "}
                      {a.usage.total ?? "unknown"} tokens
                    </p>
                    <p>
                      Estimated cost{" "}
                      {a.cost_usd === null
                        ? "unknown"
                        : `$${a.cost_usd.toFixed(6)} USD`}{" "}
                      · {a.pricing_version} · Service tier{" "}
                      {a.service_tier ?? "unknown"}
                    </p>
                    <p>
                      Cache writes {a.usage.cache_write ?? "unknown"} /
                      30-minute {a.usage.cache_write_30m ?? "unknown"} / 12-hour{" "}
                      {a.usage.cache_write_12h ?? "unknown"} tokens (subsets of
                      input)
                    </p>
                    <h4>Context breakdown</h4>
                    <p>
                      UTF-8 serialized bytes, not token estimates. Components
                      describe the saved context and may repeat source text;
                      note context is compacted before sending, so payload bytes
                      show what was sent. Image/PDF bytes are encoded transport
                      sizes.
                    </p>
                    <dl>
                      {Object.entries(a.composition).map(([key, value]) => (
                        <div key={key}>
                          <dt>{key.replaceAll("_", " ")}</dt>
                          <dd>{String(value)}</dd>
                        </div>
                      ))}
                    </dl>
                    <h4>Application outcomes</h4>
                    {data.outcomes
                      .filter((o) => o.attempt === a.id)
                      .map((o) => (
                        <p key={o.kind}>
                          {o.kind.replaceAll("_", " ")} ·{" "}
                          {new Date(o.at * 1000).toLocaleString()}
                        </p>
                      ))}
                  </div>
                </details>
              ))}
              {attempts.length > limit && (
                <button onClick={() => setLimit(limit + 30)}>
                  Show 30 more
                </button>
              )}
            </>
          )}
        </div>
      </details>
    </section>
  );
}
