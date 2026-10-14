import type { Settings } from '../core/params';
import { Store } from '../core/store';
import { Simulation } from '../engine/simulation';
import { connectSync } from '../sync/client';

// チャンネルごとの映像ソース。台ごとに違うチャンネルを割り当てられるので、使うチャンネルの数だけ持つ
export interface Feed {
  store: Store;
  sim: Simulation;
  sync: ReturnType<typeof connectSync>;
}

export class Feeds {
  // 台の順に並べたもの（同じチャンネルの台は同じ Feed）
  order: Feed[] = [];
  private map = new Map<string, Feed>();
  private initial: Readonly<Settings>;

  constructor(initial: Readonly<Settings>) {
    this.initial = initial;
  }

  // 台に割り当てるチャンネルの並びにする。使わなくなったチャンネルは接続を切る
  use(names: readonly string[]) {
    this.order = names.map(ch => this.get(ch));
    for (const [ch, f] of this.map) {
      if (!names.includes(ch)) { f.sync.close(); this.map.delete(ch); }
    }
  }

  all() {
    return this.map.values();
  }

  private get(ch: string): Feed {
    let f = this.map.get(ch);
    if (!f) {
      const store = new Store(this.initial);
      f = { store, sim: new Simulation(store), sync: connectSync(store, { channel: ch, role: 'output' }) };
      this.map.set(ch, f);
    }
    return f;
  }
}
