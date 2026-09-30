import { sanitize, type Settings } from '../core/params';
import type { Store } from '../core/store';

export type SyncStatus = 'connecting' | 'open' | 'closed';

interface Options {
  channel: string;
  // control: 操作を送る / output: 受け取るだけ
  role: 'control' | 'output';
  onStatus?: (s: SyncStatus) => void;
}

interface Clock { t0: number; anim: number; rate: number }

type Message =
  | { type: 'hello'; id: string; data: Record<string, unknown>; clock: Clock }
  | { type: 'patch'; from: string | null; data: Record<string, unknown>; clock?: Clock }
  | { type: 'pong'; t: number; server: number };

// サーバーの時間軸。全部の画面がこれに合わせることで、アニメーションの位置が揃う
export class TimeBase {
  clock: Clock | null = null;
  // サーバーの時計 − この端末の時計（ms）
  private offset = 0;
  private bestRtt = Infinity;

  onPong(t: number, server: number) {
    const now = Date.now(), rtt = now - t;
    // 往復が速かった計測ほど信用する。古い値のままにならないよう少しずつ基準を緩める
    this.bestRtt *= 1.05;
    if (rtt > this.bestRtt) return;
    this.bestRtt = rtt;
    this.offset = server - (t + rtt / 2);
  }

  // 今のアニメーション時間。まだ届いていなければ null
  animNow(): number | null {
    const c = this.clock;
    if (!c) return null;
    return c.anim + (Date.now() + this.offset - c.t0) / 1000 * c.rate;
  }
}

// サーバー経由で設定を共有する。送るのは変わったキーだけ
export function connectSync(store: Store, opts: Options) {
  let ws: WebSocket | null = null;
  let myId = '';
  let pending: Partial<Settings> | null = null;
  let flushTimer = 0;
  let retry = 0;
  const time = new TimeBase();
  const ping = () => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping', t: Date.now() })); };
  setInterval(ping, 5000);

  const send = (data: Partial<Settings>) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'patch', data }));
  };

  // ドラッグ中などは細かく来るので、16msぶんまとめて送る
  const flush = () => {
    flushTimer = 0;
    if (pending) send(pending);
    pending = null;
  };

  if (opts.role === 'control') {
    store.subscribe((changed, origin) => {
      if (origin !== 'local') return;
      pending = { ...pending, ...changed };
      if (!flushTimer) flushTimer = window.setTimeout(flush, 16);
    });
  }

  const connect = () => {
    opts.onStatus?.('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/sync?ch=${encodeURIComponent(opts.channel)}`);
    ws.onopen = () => { retry = 0; opts.onStatus?.('open'); ping(); ping(); };
    ws.onmessage = e => {
      const msg = JSON.parse(e.data) as Message;
      if (msg.type === 'pong') { time.onPong(msg.t, msg.server); return; }
      if (msg.clock) time.clock = msg.clock;
      if (msg.type === 'hello') {
        myId = msg.id;
        if (Object.keys(msg.data).length) store.set(sanitize(msg.data), 'remote');
        // まだ誰も設定していないチャンネルなら、この画面の設定を初期値にする
        else if (opts.role === 'control') send(store.get());
      } else if (msg.type === 'patch' && msg.from !== myId) {
        store.set(sanitize(msg.data), 'remote');
      }
    };
    ws.onclose = () => {
      opts.onStatus?.('closed');
      ws = null;
      setTimeout(connect, Math.min(5000, 500 * 2 ** retry++));
    };
  };

  if (location.protocol.startsWith('http')) connect();
  else opts.onStatus?.('closed');
  return { time };
}
