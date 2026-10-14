import type { WebSocket } from 'ws';
import { isShared, sanitize } from '../src/core/params.ts';
import { isValidChannel } from '../src/core/protocol.ts';
import { Clocks } from './clock.ts';
import { ShowPlayer } from './show.ts';
import { StateStore } from './state.ts';

type Data = Record<string, unknown>;

// 全チャンネル共通の設定は、この名前（チャンネル名としては使えない）で持つ
const SHARED = '*';

const split = (d: Data) => {
  const shared: Data = {}, own: Data = {};
  for (const [k, v] of Object.entries(d)) (isShared(k) ? shared : own)[k] = v;
  return { shared, own };
};

const isObject = (v: unknown): v is Data => !!v && typeof v === 'object' && !Array.isArray(v);

// チャンネルごとの設定・時間軸・ショーと、つながっている画面への配信
export class Hub {
  readonly shows: ShowPlayer;
  private states: StateStore;
  private clients = new Map<string, Set<WebSocket>>();
  private clocks = new Clocks();

  constructor(stateFile: string, showFile: string) {
    this.states = new StateStore(stateFile);
    this.shows = new ShowPlayer(showFile, (ch, values) => this.applyPatch(ch, values, null), ch => this.broadcastShow(ch));
    this.migrate();
  }

  private migrate() {
    const states = this.states;
    // 以前のバージョンで保存された、型や範囲が合わない値を掃除する
    states.rewrite(d => {
      // 試作版（Python）の形式 {v, data: {...}} だったら中身を取り出す
      const inner = isObject(d.data) ? d.data : d;
      return sanitize(inner) as Data;
    });
    // 以前はチャンネルごとに持っていたので、共通の設定は default（なければ最初のチャンネル）から引き継ぐ
    if (!states.keys().includes(SHARED)) {
      const from = states.keys().includes('default') ? 'default' : states.keys()[0];
      states.patch(SHARED, from ? split(states.get(from)).shared : {});
    }
    for (const ch of states.keys()) {
      if (ch !== SHARED) states.replace(ch, split(states.get(ch)).own);
    }
  }

  // 画面に渡すのは、共通の設定とそのチャンネルの設定を合わせたもの
  merged(ch: string): Data {
    return { ...this.states.get(SHARED), ...this.states.get(ch) };
  }

  clock(ch: string) {
    return this.clocks.get(ch, this.merged(ch));
  }

  showInfo(ch: string) {
    return { state: this.shows.state(ch), custom: this.shows.customOf(ch) };
  }

  // 使われているチャンネルの一覧（設定があるもの、カスタムのショーがあるもの、いまつながっているもの）
  channelList() {
    const all = new Set([...this.states.keys(), ...this.shows.channels(), ...this.clients.keys()]);
    all.delete(SHARED);
    return [...all].sort();
  }

  join(ch: string, ws: WebSocket) {
    let set = this.clients.get(ch);
    if (!set) this.clients.set(ch, set = new Set());
    set.add(ws);
    ws.on('close', () => set.delete(ws));
  }

  private send(ch: string, msg: string) {
    for (const ws of this.clients.get(ch) ?? []) if (ws.readyState === ws.OPEN) ws.send(msg);
  }

  // つながっている全部の画面に送る
  broadcastAll(msg: unknown) {
    const s = JSON.stringify(msg);
    for (const ch of this.clients.keys()) this.send(ch, s);
  }

  private broadcastShow(ch: string) {
    this.send(ch, JSON.stringify({ type: 'show', ...this.showInfo(ch) }));
  }

  private broadcast(ch: string, data: Data, from: string | null, withClock: boolean) {
    const clock = withClock ? this.clock(ch) : undefined;
    this.send(ch, JSON.stringify({ type: 'patch', from, data, clock }));
  }

  // 設定の変更を保存して配る。オブジェクトでなければ false
  applyPatch(ch: string, data: unknown, from: string | null) {
    if (!isObject(data)) return false;
    // 画面側と同じ決まりで型と範囲を揃え、知らないキーは捨てる
    const patch = sanitize(data) as Data;
    if (!Object.keys(patch).length) return true;
    const { shared, own } = split(patch);
    if (Object.keys(shared).length) {
      // 共通の設定は全チャンネルに配る（スローなどは各チャンネルの時間軸にも効く）
      const targets = new Set([...this.channelList(), ch]);
      const timed = new Set<string>();
      for (const t of targets) if (this.clocks.update(t, this.merged(t), shared)) timed.add(t);
      this.states.patch(SHARED, shared);
      for (const t of targets) this.broadcast(t, shared, from, timed.has(t));
    }
    if (Object.keys(own).length) {
      const timeChanged = this.clocks.update(ch, this.merged(ch), own);
      this.states.patch(ch, own);
      this.broadcast(ch, own, from, timeChanged);
    }
    return true;
  }

  // 対象のチャンネル。channels に名前の配列があればそれだけ、なければ全部
  private targetsOf(msg: Data) {
    return Array.isArray(msg.channels) ? msg.channels.filter(isValidChannel) : this.channelList();
  }

  // 頭から始めるときは時間軸も頭に揃える（ビートで動くパターンの拍がショーと合う）
  private play(ch: string, id: unknown, t0: number) {
    if (!this.shows.play(ch, id, t0)) return;
    this.clocks.reset(ch, this.merged(ch), t0);
    this.broadcast(ch, {}, null, true);
  }

  showCommand(ch: string, msg: Data) {
    switch (msg.action) {
      case 'play': this.play(ch, msg.id, Date.now()); break;
      case 'stop': this.shows.stop(ch); break;
      case 'save': this.shows.saveCustom(ch, msg.show); break;
      // 全チャンネル（channels の指定があればそれだけ）を同じ瞬間に始める
      case 'playAll': {
        const t0 = Date.now();
        for (const c of this.targetsOf(msg)) this.play(c, msg.id, t0);
        break;
      }
      case 'stopAll': for (const c of this.targetsOf(msg)) this.shows.stop(c); break;
    }
  }

  flush() {
    this.states.flush();
    this.shows.flush();
  }
}
