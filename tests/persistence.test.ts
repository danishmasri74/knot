import { describe, it, expect } from "vitest";
import { SaveCoordinator } from "../src/services/persistence";
describe("save coordinator", () => {
  it("retries failed writes without acknowledging unsaved state", async () => {
    let attempts = 0;
    const statuses: string[] = [];
    const save = new SaveCoordinator(
      async () => {
        if (++attempts === 1) throw Error("disk full");
      },
      (s) => statuses.push(s),
    );
    save.changed();
    await expect(save.flush()).rejects.toThrow("disk full");
    await save.flush();
    expect(attempts).toBe(2);
    expect(statuses.at(-1)).toBe("saved");
    save.dispose();
  });
  it("flushes changes arriving during an in-flight write in order", async () => {
    let finish!: () => void;
    let writes = 0;
    const save = new SaveCoordinator(
      async () => {
        if (++writes === 1) await new Promise<void>((r) => (finish = r));
      },
      () => {},
    );
    save.changed();
    const flush = save.flush();
    save.changed();
    finish();
    await flush;
    expect(writes).toBe(2);
    save.dispose();
  });
  it("coalesces edits into one snapshot", async () => {
    let writes = 0;
    const save = new SaveCoordinator(
      async () => {
        writes++;
      },
      () => {},
    );
    save.changed();
    save.changed();
    save.changed();
    await save.flush();
    expect(writes).toBe(1);
    save.dispose();
  });
});
