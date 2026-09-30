import { sanitize, type Settings } from '../core/params';
import type { Show } from '../core/show';
import type { Store } from '../core/store';

export type SyncStatus = 'connecting' | 'open' | 'closed';

interface Options {
  channel: string;
  // control: 操作を送る / output: 受け取るだけ
  role: 'control' | 'output';
  onStatus?: (s: SyncStatus) => void;
  onShow?: (s: ShowInfo) => void;
}

export interface ShowInfo {
  state: { playing: boolean; id: string | null; index: number; startedAt: number };
  custom: Show | null;
}

interface Clock { t0: number; anim: number; rate: number }

type Message =
  | { type: 'hello'; id: string; data: Record<string, unknown>; clock: Clock }
  | { type: 'patch'; from: string | null; data: Record<string, unknown>; clock?: Clock }
  | { type: 'pong'; t: number; server: number }
  | ({ type: 'show' } & ShowInfo);

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

  // サーバーの時計での今の時刻（ms）
  serverNow() {
    return Date.now() + this.offset;
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
  let closed = false;
  const time = new TimeBase();
  const ping = () => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping', t: Date.now() })); };
  const pinger = setInterval(ping, 5000);

  // つながっていない間の変更は取っておき、つながり直したら送る
  let unsent: Partial<Settings> | null = null;
  const send = (data: Partial<Settings>) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'patch', data }));
    else unsent = { ...unsent, ...data };
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
      if (msg.type === 'show') { opts.onShow?.(msg); return; }
      if (msg.clock) time.clock = msg.clock;
      if (msg.type === 'hello') {
        myId = msg.id;
        if (Object.keys(msg.data).length) store.set(sanitize(msg.data), 'remote');
        // まだ誰も設定していないチャンネルなら、この画面の設定を初期値にする
        else if (opts.role === 'control') send(store.get());
        // 切れている間にこの画面で変えた分は、サーバーの値より優先する（store.set でそのまま送られる）
        if (unsent && opts.role === 'control') {
          const mine = unsent;
          unsent = null;
          store.set(mine);
        }
      } else if (msg.type === 'patch' && msg.from !== myId) {
        store.set(sanitize(msg.data), 'remote');
      }
    };
    ws.onclose = () => {
      opts.onStatus?.('closed');
      ws = null;
      if (!closed) setTimeout(connect, Math.min(5000, 500 * 2 ** retry++));
    };
  };

  if (location.protocol.startsWith('http')) connect();
  else opts.onStatus?.('closed');
  // ショーの操作（play / stop / save）
  const show = (msg: Record<string, unknown>) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'show', ...msg }));
  };
  // もう使わないときに切る（つなぎ直さない）
  const close = () => {
    closed = true;
    clearInterval(pinger);
    ws?.close();
  };
  return { time, show, close };
}
