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
    const before = this.entries
      .slice(0, this.position + 1)
      .filter((item) => item.id !== id).length;
    this.entries = this.entries.filter((item) => item.id !== id);
    this.position = before - 1;
    this.changed();
  }

  clear() {
    this.entries = [];
    this.position = -1;
    this.changed();
  }
}
