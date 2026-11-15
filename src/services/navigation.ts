/** Session-only history. A failed open must leave the current position intact. */
export class NavigationHistory<T extends { id: string }> {
  private entries: T[] = [];
  private position = -1;
  private revision = 0;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.revision;

  private changed() {
    this.revision++;
    this.listeners.forEach((listener) => listener());
  }

  get canBack() {
    return this.position > 0;
  }
  get canForward() {
    return this.position < this.entries.length - 1;
  }

  visit(item: T) {
    if (this.entries[this.position]?.id === item.id) return;
    this.entries = [...this.entries.slice(0, this.position + 1), item].slice(
      -100,
    );
    this.position = this.entries.length - 1;
    this.changed();
  }

  /** Swap the current entry for a more specific one (same place). */
  replace(item: T) {
    if (this.position < 0) return this.visit(item);
    this.entries = this.entries.map((entry, index) =>
      index === this.position ? item : entry,
    );
    this.changed();
  }

  /** The current entry, if any. */
  get current(): T | undefined {
    return this.entries[this.position];
  }

  update(id: string, change: Partial<T>) {
    this.entries = this.entries.map((item) =>
      item.id === id ? { ...item, ...change } : item,
    );
    this.changed();
  }

  async move(delta: -1 | 1, open: (item: T) => Promise<void>) {
    const target = this.position + delta;
    if (target < 0 || target >= this.entries.length) return;
    await open(this.entries[target]);
    this.position = target;
    this.changed();
  }

  remove(id: string) {
    this.removeWhere((item) => item.id === id);
  }

  removeWhere(test: (item: T) => boolean) {
    const before = this.entries
      .slice(0, this.position + 1)
      .filter((item) => !test(item)).length;
    this.entries = this.entries.filter((item) => !test(item));
    this.position = before - 1;
    this.changed();
  }

  clear() {
    this.entries = [];
    this.position = -1;
    this.changed();
  }
}
