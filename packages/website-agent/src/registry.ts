export type DisposableSession = { dispose: () => Promise<void> };

export class ActiveSessionRegistry<T extends DisposableSession> {
  private readonly entries = new Map<string, Promise<T>>();
  private readonly closing = new Map<string, Promise<void>>();

  async getOrLoad(id: string, load: () => Promise<T>): Promise<T> {
    const close = this.closing.get(id);
    if (close) await close;
    const existing = this.entries.get(id);
    if (existing) return existing;
    const pending = load();
    this.entries.set(id, pending);
    try {
      return await pending;
    } catch (error) {
      if (this.entries.get(id) === pending) this.entries.delete(id);
      throw error;
    }
  }

  async close(id: string): Promise<void> {
    const existingClose = this.closing.get(id);
    if (existingClose) return existingClose;
    const pending = this.entries.get(id);
    if (!pending) return;
    this.entries.delete(id);
    const close = (async () => {
      const session = await pending;
      await session.dispose();
    })();
    this.closing.set(id, close);
    try {
      await close;
    } finally {
      if (this.closing.get(id) === close) this.closing.delete(id);
    }
  }

  async disposeAll(): Promise<void> {
    const ids = [...this.entries.keys()];
    await Promise.all([...ids.map((id) => this.close(id)), ...this.closing.values()]);
  }

  get size(): number {
    return this.entries.size;
  }
}
