import { DEFAULTS } from '../src/core/params.ts';

export interface Clock {
  // この時刻（サーバーのms）に
  t0: number;
  // アニメーション時間がこの値で
  anim: number;
  // 1秒あたりこれだけ進む
  rate: number;
}

const TIME_KEYS = ['timeScale', 'animSpeed', 'paused'];

// チャンネルごとのアニメーションの時間軸。全部の画面がこれに合わせるので、動きの位置が揃う
export class Clocks {
  private clocks = new Map<string, Clock>();

  get(ch: string, data: Record<string, unknown>): Clock {
    let c = this.clocks.get(ch);
    if (!c) this.clocks.set(ch, c = { t0: Date.now(), anim: 0, rate: rateOf(data) });
    return c;
  }

  // 時間軸を頭（0）に戻す。複数チャンネルのショーを同時に始めるとき、動きの位置も揃える
  reset(ch: string, data: Record<string, unknown>, t0: number) {
    this.clocks.set(ch, { t0, anim: 0, rate: rateOf(data) });
  }

  // 速さが変わる直前に、その時点の位置で区切ってから新しい速さにする
  update(ch: string, before: Record<string, unknown>, patch: Record<string, unknown>) {
    if (!TIME_KEYS.some(k => k in patch)) return false;
    const c = this.get(ch, before), now = Date.now();
    c.anim += (now - c.t0) / 1000 * c.rate;
    c.t0 = now;
    c.rate = rateOf({ ...before, ...patch });
    return true;
  }
}

function rateOf(data: Record<string, unknown>) {
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  if (data.paused === true) return 0;
  return num(data.timeScale, DEFAULTS.timeScale) * num(data.animSpeed, DEFAULTS.animSpeed);
}
