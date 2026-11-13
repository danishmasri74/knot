import { invoke } from "@tauri-apps/api/core";

// Ask Knot chats live in the workspace database (Rust `ai_chats.rs`), so
// workspace backups and restores include them. Older Knot kept them in
// browser storage; loadChatRecords moves those across once and removes each
// browser copy only after the workspace has stored it.

/** Chat JSON as the panel writes it; storage only relies on these fields. */
export type ChatRecord = { id: string; updated: number; turns: unknown[] };

const legacyPrefix = (workspace: string) =>
  `knot.ai.chats.v1:${encodeURIComponent(workspace)}:`;

function isRecord(value: unknown): value is ChatRecord {
  const v = value as ChatRecord | null;
  return (
    !!v &&
    typeof v.id === "string" &&
    typeof v.updated === "number" &&
    Array.isArray(v.turns)
  );
}

function legacyKeys(workspace: string): string[] {
  try {
    return Object.keys(localStorage).filter((key) =>
      key.startsWith(legacyPrefix(workspace)),
    );
  } catch {
    return [];
  }
}

/**
 * Saved chats for the workspace, newest first. `error` is set when some
 * older browser-stored chats could not be moved; they stay in browser storage
 * and are shown anyway, and the move is retried on the next load.
 */
export async function loadChatRecords(
  workspace: string,
): Promise<{ chats: ChatRecord[]; error: string }> {
  const stored = (await invoke<string[]>("ai_chats_list", { workspace }))
    .map((data) => {
      try {
        return JSON.parse(data) as unknown;
      } catch {
        return null;
      }
    })
    .filter(isRecord);
  const chats = new Map(stored.map((chat) => [chat.id, chat]));
  let error = "";
  for (const key of legacyKeys(workspace)) {
    let legacy: unknown;
    try {
      legacy = JSON.parse(localStorage.getItem(key) ?? "null");
    } catch {
      continue; // Unreadable copies are kept untouched, as before.
    }
    if (!isRecord(legacy)) continue;
    const existing = chats.get(legacy.id);
    try {
      if (!existing || legacy.updated > existing.updated) {
        await saveChatRecord(workspace, legacy.id, JSON.stringify(legacy));
        chats.set(legacy.id, legacy);
      }
      localStorage.removeItem(key);
    } catch {
      if (!existing || legacy.updated > existing.updated)
        chats.set(legacy.id, legacy);
      error =
        "Some older chats are still only on this device and could not be added to the workspace. Knot will try again next time.";
    }
  }
  return {
    chats: [...chats.values()].sort((a, b) => b.updated - a.updated),
    error,
  };
}

// One write chain per chat. Only the newest JSON is written; a failed write
// keeps it queued so the next caller retries it rather than skipping it.
const chains = new Map<string, Promise<void>>();
const latest = new Map<string, string | null>();

function enqueue(workspace: string, id: string, data: string | null) {
  const key = `${workspace}\n${id}`;
  latest.set(key, data);
  const run = (chains.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      if (!latest.has(key)) return; // An earlier run already wrote it.
      const value = latest.get(key)!;
      latest.delete(key);
      try {
        if (value === null)
          await invoke("ai_chat_delete", { workspace, id });
        else await invoke("ai_chat_save", { workspace, id, data: value });
      } catch (error) {
        if (!latest.has(key)) latest.set(key, value);
        throw error;
      }
    });
  chains.set(key, run);
  void run
    .finally(() => {
      if (chains.get(key) === run) chains.delete(key);
    })
    .catch(() => {});
  return run;
}

/** Saves the chat JSON; resolves once this or a newer version is stored. */
export function saveChatRecord(workspace: string, id: string, data: string) {
  return enqueue(workspace, id, data);
}

/** Deletes the chat after any save already queued for it. */
export function deleteChatRecord(workspace: string, id: string) {
  return enqueue(workspace, id, null);
}

/** Waits for queued chat writes; used before closing or switching workspace. */
export async function flushChatSaves() {
  await Promise.allSettled([...chains.values()]);
}
