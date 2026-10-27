export type SaveStatus = "saved" | "saving" | "failed";
/** Serializes writes. A change during a write always schedules another snapshot. */
export class SaveCoordinator {
  private version = 0;
  private saved = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  constructor(
    private write: () => Promise<void>,
    private status: (s: SaveStatus, error?: unknown) => void,
    private delay = 600,
  ) {}
  changed = () => {
    this.version++;
    this.status("saving");
    if (!this.timer)
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.flush().catch(() => {});
      }, this.delay);
  };
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.running) {
      await this.running;
      return this.flush();
    }
    if (this.saved === this.version) return;
    this.running = (async () => {
      try {
        while (this.saved !== this.version) {
          const target = this.version;
          await this.write();
          this.saved = target;
        }
        this.status("saved");
      } catch (e) {
        this.status("failed", e);
        throw e;
      }
    })();
    try {
      await this.running;
    } finally {
      this.running = undefined;
    }
  }
  dispose() {
    clearTimeout(this.timer);
  }
}
