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
  /** What caching changed, at current rates; null when cost is unknown. */
  cache?: { extra_usd: number; saved_usd: number } | null;
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

/** Turns that carry earlier messages; workspace turns send only the latest. */
const isFollowUp = (a: AiAttempt) => Number(a.composition.messages ?? 0) > 1;

/**
 * Prompt caching's effect on priced attempts: the write surcharge paid, the
 * saving from cached reads, and how often a first question that paid to write
 * was followed up (a write pays off only when a later turn reads it).
 */
export function summarizeCache(attempts: AiAttempt[]) {
  const known = attempts.filter((a) => a.cache);
  const total = (rows: AiAttempt[]) => {
    const extra = rows.reduce((sum, a) => sum + a.cache!.extra_usd, 0);
    const saved = rows.reduce((sum, a) => sum + a.cache!.saved_usd, 0);
    const input = rows.reduce((sum, a) => sum + (a.usage.input ?? 0), 0);
    const cached = rows.reduce((sum, a) => sum + (a.usage.cached ?? 0), 0);
    return {
      attempts: rows.length,
      extra,
      saved,
      net: saved - extra,
      readShare: input ? cached / input : null,
    };
  };
  const groups = new Map<string, AiAttempt[]>();
  for (const a of known)
    groups.set(a.operation, [...(groups.get(a.operation) ?? []), a]);
  return {
    ...total(known),
    priced: known.length,
    firstWrites: known.filter((a) => !isFollowUp(a) && a.cache!.extra_usd > 0)
      .length,
    followUps: known.filter(isFollowUp).length,
    followUpReads: known.filter(
      (a) => isFollowUp(a) && (a.usage.cached ?? 0) > 0,
    ).length,
    byOperation: [...groups]
      .map(([operation, rows]) => ({ operation, ...total(rows) }))
      .sort((a, b) => b.extra + b.saved - (a.extra + a.saved)),
  };
}
