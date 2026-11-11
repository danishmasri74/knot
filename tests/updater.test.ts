import { beforeEach, describe, expect, it, vi } from "vitest";

const plugin = vi.hoisted(() => ({
  version: "0.2.0",
  check: vi.fn(),
}));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => plugin.version }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: plugin.check }));

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
});

const updater = await import("../src/services/updater");

beforeEach(() => {
  store.clear();
  plugin.check.mockReset();
  plugin.version = "0.2.0";
});

describe("updater", () => {
  it("reads release notes as plain lines", () => {
    expect(updater.parseNotes("- Share notebooks\n\n* Faster search\n• Fix undo")).toEqual([
      "Share notebooks",
      "Faster search",
      "Fix undo",
    ]);
    expect(updater.parseNotes(undefined)).toEqual([]);
  });

  it("explains failures in one plain sentence", () => {
    expect(updater.describeUpdateError(new Error("signature verification failed"), "downloading")).toBe(
      "The update couldn't be verified, so it wasn't installed.",
    );
    expect(updater.describeUpdateError("error sending request for url", "checking")).toBe(
      "Couldn't reach GitHub. Check your connection and try again.",
    );
    expect(updater.describeUpdateError("connection reset", "downloading")).toBe(
      "The download stopped. Try again to start it over.",
    );
  });

  it("checks automatically at most once a day and never when turned off", async () => {
    plugin.check.mockResolvedValue(null);
    await updater.checkForUpdate({ manual: false });
    await updater.checkForUpdate({ manual: false });
    expect(plugin.check).toHaveBeenCalledTimes(1);
    expect(updater.getUpdateState().kind).toBe("current");

    await updater.checkForUpdate({ manual: true });
    expect(plugin.check).toHaveBeenCalledTimes(2);

    store.clear();
    updater.setAutoCheckEnabled(false);
    await updater.checkForUpdate({ manual: false });
    expect(plugin.check).toHaveBeenCalledTimes(2);
  });

  it("stays quiet when an automatic check fails, and reports a manual one", async () => {
    plugin.check.mockRejectedValue(new Error("dns error"));
    await updater.checkForUpdate({ manual: false });
    expect(updater.getUpdateState().kind).not.toBe("failed");
    await updater.checkForUpdate({ manual: true });
    expect(updater.getUpdateState()).toMatchObject({
      kind: "failed",
      retry: "check",
      message: "Couldn't reach GitHub. Check your connection and try again.",
    });
  });

  it("announces a version once and never after it is skipped", async () => {
    expect(updater.shouldAnnounce("0.3.0")).toBe(true);
    expect(updater.shouldAnnounce("0.3.0")).toBe(false);
    updater.skipUpdate("0.4.0");
    expect(updater.shouldAnnounce("0.4.0")).toBe(false);
    expect(updater.shouldAnnounce("0.5.0")).toBe(true);
  });

  it("reports a finished or unfinished update on the next launch", async () => {
    expect(await updater.launchReport()).toBeNull(); // first run
    plugin.version = "0.3.0";
    expect(await updater.launchReport()).toEqual({ kind: "updated", version: "0.3.0" });
    expect(await updater.launchReport()).toBeNull();

    store.set("knot.updates.pending", "0.4.0");
    expect(await updater.launchReport()).toEqual({
      kind: "unfinished",
      version: "0.4.0",
      current: "0.3.0",
    });
  });

  it("shows the notes saved for the installed version only", () => {
    store.set("knot.updates.notes", JSON.stringify({ version: "0.3.0", notes: ["New"] }));
    expect(updater.installedNotes("0.3.0")).toEqual(["New"]);
    expect(updater.installedNotes("0.2.0")).toEqual([]);
  });
});
