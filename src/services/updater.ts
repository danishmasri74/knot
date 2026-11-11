// Knot's in-app updater: checks the signed releases on GitHub, downloads on
// request and installs after the app has saved and backed up. Design and
// copy: docs/UPDATER-INSTALLER-PLAN.md, section 2.
import { useSyncExternalStore } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current"; checkedAt: number }
  | { kind: "available"; version: string; notes: string[] }
  | {
      kind: "downloading";
      version: string;
      notes: string[];
      downloaded: number;
      total?: number;
    }
  | { kind: "ready"; version: string; notes: string[] }
  | { kind: "preparing"; version: string; step: "saving" | "backup" }
  | {
      kind: "failed";
      message: string;
      retry: "check" | "download" | "install";
      version?: string;
      notes?: string[];
    };

const DAY = 24 * 60 * 60 * 1000;
const KEYS = {
  auto: "knot.updates.auto",
  lastCheck: "knot.updates.lastCheck",
  skipped: "knot.updates.skipped",
  announced: "knot.updates.announced",
  lastRun: "knot.updates.lastRunVersion",
  pending: "knot.updates.pending",
  notes: "knot.updates.notes",
} as const;

// Per-device conveniences only; every read and write tolerates blocked storage.
function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the preference lasts for this session only.
  }
}

let state: UpdateState = { kind: "idle" };
let update: Update | null = null;
const listeners = new Set<() => void>();
function set(next: UpdateState) {
  state = next;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function useUpdateState() {
  return useSyncExternalStore(subscribe, () => state);
}
export const getUpdateState = () => state;

export const autoCheckEnabled = () => read(KEYS.auto) !== "off";
export const setAutoCheckEnabled = (on: boolean) =>
  write(KEYS.auto, on ? "on" : "off");
export function lastCheckedAt() {
  const value = Number(read(KEYS.lastCheck));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}
export const skippedVersion = () => read(KEYS.skipped);

/** Release notes from latest.json as plain lines, without list markers. */
export function parseNotes(body?: string) {
  return (body ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*•]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

/** One plain sentence for each failure Knot can explain. */
export function describeUpdateError(
  error: unknown,
  during: UpdateState["kind"] | "install",
) {
  const text = String(
    error instanceof Error ? error.message : error,
  ).toLowerCase();
  if (text.includes("signature") || text.includes("minisign"))
    return "The update couldn't be verified, so it wasn't installed.";
  if (
    text.includes("space") ||
    text.includes("disk full") ||
    text.includes("os error 112")
  )
    return "There isn't enough free space to download the update.";
  if (during === "downloading")
    return "The download stopped. Try again to start it over.";
  if (during === "install")
    return "The update couldn't be started. Knot is unchanged.";
  if (
    text.includes("request") ||
    text.includes("network") ||
    text.includes("dns") ||
    text.includes("connect") ||
    text.includes("timed out") ||
    text.includes("status code")
  )
    return "Couldn't reach GitHub. Check your connection and try again.";
  return "Couldn't check for updates. Try again later.";
}

/**
 * Asks GitHub for the newest release. Automatic checks are silent on failure
 * and skip when one ran in the last day; manual checks always run and report.
 */
export async function checkForUpdate({ manual }: { manual: boolean }) {
  if (["checking", "downloading", "preparing"].includes(state.kind))
    return state;
  if (!manual) {
    if (!autoCheckEnabled()) return state;
    const last = lastCheckedAt();
    if (last && Date.now() - last < DAY) return state;
  }
  const previous = state;
  set({ kind: "checking" });
  try {
    const found = await check({ timeout: 30_000 });
    const checkedAt = Date.now();
    write(KEYS.lastCheck, String(checkedAt));
    if (update && update !== found) void update.close().catch(() => {});
    update = found;
    if (!found) set({ kind: "current", checkedAt });
    else
      set({
        kind: "available",
        version: found.version,
        notes: parseNotes(found.body),
      });
  } catch (error) {
    if (manual)
      set({
        kind: "failed",
        message: describeUpdateError(error, "checking"),
        retry: "check",
      });
    else set(previous.kind === "checking" ? { kind: "idle" } : previous);
  }
  return state;
}

export async function downloadUpdate() {
  if (!update || (state.kind !== "available" && state.kind !== "failed"))
    return;
  const { version } = update;
  const notes = parseNotes(update.body);
  let downloaded = 0;
  let total: number | undefined;
  set({ kind: "downloading", version, notes, downloaded });
  try {
    await update.download((event) => {
      if (event.event === "Started") total = event.data.contentLength;
      if (event.event === "Progress") downloaded += event.data.chunkLength;
      set({ kind: "downloading", version, notes, downloaded, total });
    });
    set({ kind: "ready", version, notes });
  } catch (error) {
    set({
      kind: "failed",
      message: describeUpdateError(error, "downloading"),
      retry: "download",
      version,
      notes,
    });
  }
}

export function skipUpdate(version: string) {
  write(KEYS.skipped, version);
}

/** Whether to show the one-time "available" notice for this version. */
export function shouldAnnounce(version: string) {
  if (skippedVersion() === version || read(KEYS.announced) === version)
    return false;
  write(KEYS.announced, version);
  return true;
}

/**
 * Saves and backs up through `prepare`, then hands over to the installer,
 * which exits Knot, replaces it and reopens it. Returns only on failure.
 */
export async function installUpdate(
  prepare: (step: (s: "saving" | "backup") => void) => Promise<void>,
) {
  if (!update || state.kind !== "ready") return;
  const { version } = update;
  const notes = parseNotes(update.body);
  try {
    set({ kind: "preparing", version, step: "saving" });
    await prepare((step) => set({ kind: "preparing", version, step }));
  } catch (error) {
    set({ kind: "ready", version, notes });
    throw error;
  }
  try {
    write(KEYS.pending, version);
    write(KEYS.notes, JSON.stringify({ version, notes }));
    await update.install();
  } catch (error) {
    write(KEYS.pending, null);
    set({
      kind: "failed",
      message: describeUpdateError(error, "install"),
      retry: "install",
      version,
      notes,
    });
  }
}

/** Notes saved when the running version was installed, for "What's new". */
export function installedNotes(current: string): string[] {
  try {
    const saved = JSON.parse(read(KEYS.notes) ?? "null") as {
      version?: string;
      notes?: string[];
    } | null;
    return saved?.version === current && Array.isArray(saved.notes)
      ? saved.notes
      : [];
  } catch {
    return [];
  }
}

/** Compares the running version with the last run to report what happened. */
export async function launchReport(): Promise<
  | { kind: "updated"; version: string }
  | { kind: "unfinished"; version: string; current: string }
  | null
> {
  const current = await getVersion();
  const lastRun = read(KEYS.lastRun);
  const pending = read(KEYS.pending);
  write(KEYS.lastRun, current);
  write(KEYS.pending, null);
  if (pending && pending !== current)
    return { kind: "unfinished", version: pending, current };
  if (lastRun && lastRun !== current)
    return { kind: "updated", version: current };
  return null;
}

export function formatBytes(bytes: number) {
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
}

export function relativeTime(at: number, now = Date.now()) {
  const minutes = Math.round((now - at) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
