import { invoke } from "@tauri-apps/api/core";
export type AiOutcome =
  | "answer_displayed"
  | "proposal_valid"
  | "proposal_invalid"
  | "apply"
  | "apply_failed"
  | "dismiss"
  | "undo"
  | "undo_failed";
export function recordAiOutcome(id: string | undefined, outcome: AiOutcome) {
  if (id)
    void invoke("ai_diagnostics_outcome", { id, outcome }).catch(() => {});
}
export type AiAttempt = {
  id: string;
  model: string;
  operation: string;
  started: number;
  status: string;
  failure: string | null;
  http_status: number | null;
  elapsed_ms: number | null;
  first_delta_ms: number | null;
  response_bytes: number;
  link: { parent: string; kind: string } | null;
  composition: Record<string, number | boolean>;
  usage: {
    input: number | null;
    cached: number | null;
    cache_write: number | null;
    cache_write_30m: number | null;
    cache_write_12h: number | null;
    output: number | null;
    reasoning: number | null;
    total: number | null;
  };
  cost_usd: number | null;
  pricing_version: string;
  service_tier: string | null;
};
export type AiDiagnosticsSnapshot = {
  schema_version: number;
  enabled: boolean;
  dropped: number;
  write_failures: number;
  attempts: AiAttempt[];
  outcomes: { attempt: string; kind: AiOutcome; at: number }[];
};
export function summarizeAttempts(attempts: AiAttempt[]) {
  const priced = attempts.filter((a) => a.cost_usd !== null);
  const usage = attempts.filter(
    (a) => a.usage.input !== null && a.usage.output !== null,
  );
  const latencies = attempts
    .flatMap((a) => (a.elapsed_ms == null ? [] : [a.elapsed_ms]))
    .sort((a, b) => a - b);
  return {
    attempts: attempts.length,
    priced: priced.length,
    usage: usage.length,
    cost: priced.reduce((total, a) => total + a.cost_usd!, 0),
    failed: attempts.filter((a) => a.status === "failed").length,
    cancelled: attempts.filter((a) => a.status === "cancelled").length,
    input: usage.reduce((total, a) => total + a.usage.input!, 0),
    output: usage.reduce((total, a) => total + a.usage.output!, 0),
    p50: latencies.length
      ? latencies[Math.ceil(latencies.length * 0.5) - 1]
      : null,
    p95: latencies.length
      ? latencies[Math.ceil(latencies.length * 0.95) - 1]
      : null,
  };
}
