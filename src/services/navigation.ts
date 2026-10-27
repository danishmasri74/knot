/** Session-only history. A failed open must leave the current position intact. */
export class NavigationHistory<T extends { id: string }> {
  private entries: T[] = [];
  private position = -1;

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
  }

  update(id: string, change: Partial<T>) {
    this.entries = this.entries.map((item) =>
      item.id === id ? { ...item, ...change } : item,
    );
  }

  async move(delta: -1 | 1, open: (item: T) => Promise<void>) {
    const target = this.position + delta;
    if (target < 0 || target >= this.entries.length) return;
    await open(this.entries[target]);
    this.position = target;
  }

  remove(id: string) {
    const before = this.entries
      .slice(0, this.position + 1)
      .filter((item) => item.id !== id).length;
    this.entries = this.entries.filter((item) => item.id !== id);
    this.position = before - 1;
  }

  clear() {
    this.entries = [];
    this.position = -1;
  }
}
