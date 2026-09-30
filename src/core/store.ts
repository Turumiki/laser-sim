import type { Settings } from './params';

// local: この画面での操作 / remote: 同期で届いた変更
export type Origin = 'local' | 'remote';
export type Listener = (changed: Partial<Settings>, origin: Origin) => void;

export class Store {
  private state: Settings;
  private listeners = new Set<Listener>();

  constructor(initial: Settings) {
    this.state = { ...initial };
  }

  get(): Readonly<Settings> {
    return this.state;
  }

  set(patch: Partial<Settings>, origin: Origin = 'local') {
    const changed: Partial<Settings> = {};
    let any = false;
    for (const k of Object.keys(patch) as (keyof Settings)[]) {
      const v = patch[k];
      if (v === undefined || this.state[k] === v) continue;
      (changed as Record<string, unknown>)[k] = v;
      any = true;
    }
    if (!any) return;
    this.state = { ...this.state, ...changed };
    for (const fn of this.listeners) fn(changed, origin);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
