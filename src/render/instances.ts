import type { Frame } from '../core/frame';
import type { Scanner } from '../core/scanner';
import type { Settings } from '../core/params';
import { EYE_GAIN, pincushion } from '../core/color';

// 1本の線分 = x0 y0 x1 y1 / エネルギー r g b / グローの有無 / 古さ（露光時間を1とする。ローリングシャッター用）
export const STRIDE = 10;
const SQRT_2PI = 2.5066283;

export class Instances {
  data = new Float32Array(STRIDE * 8192);
  count = 0;

  clear() {
    this.count = 0;
  }

  push(x0: number, y0: number, x1: number, y1: number, e: number, r: number, g: number, b: number, glow: number, age = 0) {
    if ((this.count + 1) * STRIDE > this.data.length) {
      const next = new Float32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    const d = this.data, o = this.count++ * STRIDE;
    d[o] = x0; d[o + 1] = y0; d[o + 2] = x1; d[o + 3] = y1;
    d[o + 4] = e; d[o + 5] = r; d[o + 6] = g; d[o + 7] = b; d[o + 8] = glow; d[o + 9] = age;
  }
}

export interface View {
  cx: number;
  cy: number;
  // 点の座標1あたりのピクセル数
  unit: number;
  sigma: number;
  // この長さ(px)の図形を描いたときに線の明るさが1になる
  lref: number;
}

// 点の座標 → 画面の位置（px）。糸巻きゆがみを入れるときはここで曲げる
function mapper(s: Readonly<Settings>, v: View) {
  const half = s.pincushion ? s.scanAngle / 2 * Math.PI / 180 : 0;
  const p = { x: 0, y: 0 };
  return (x: number, y: number) => {
    if (half) {
      pincushion(x * s.size, y * s.size, half, p);
      p.x /= s.size;
      p.y /= s.size;
    } else {
      p.x = x;
      p.y = y;
    }
    p.x = v.cx + p.x * v.unit;
    p.y = v.cy - p.y * v.unit;
    return p;
  };
}

const ONE: readonly [number, number, number] = [1, 1, 1];

// スキャン再現：露光時間内に通った軌跡を、通った時間に比例したエネルギーで積む。
// 遅く動いた所ほど明るく、図形が長いほど暗くなる（実機と同じ）
// roll: ローリングシャッターの読み出し時間（露光時間を1とする）。0なら全体を同時に撮る。
//   行ごとに撮る時間帯がずれるので、どの時間の光を積むかはGPU側で行ごとに決める
export function scanInstances(out: Instances, sc: Scanner, s: Readonly<Settings>, v: View, tau: number, roll = 0) {
  const isExp = s.exposureShape === 'exp';
  const window = (isExp ? tau * 5 : tau) + roll * tau;
  const dt = 1 / s.pps;
  const map = mapper(s, v);
  const [gr, gg, gb] = s.eye ? EYE_GAIN : ONE;

  let L = 0;
  while (L < sc.count && sc.scanT - sc.t[sc.index(L)] <= window) L++;
  if (L < 1) return;

  // 1点ずつ位置を出し、前の点の位置を使い回す
  let p = map(sc.x[sc.index(L - 1)], sc.y[sc.index(L - 1)]);
  let xj = p.x, yj = p.y;
  for (let k = L - 1; k >= 1; k--) {
    const i = sc.index(k - 1);
    p = map(sc.x[i], sc.y[i]);
    const xi = p.x, yi = p.y;
    if (sc.on[i]) {
      const age = (sc.scanT - sc.t[i]) / tau;
      const w = roll || !isExp ? 1 : Math.exp(-age);
      const e = w * dt / tau * v.lref;
      out.push(xj, yj, xi, yi, e, sc.r[i] / 255 * gr, sc.g[i] / 255 * gg, sc.b[i] / 255 * gb, 1, age);
    } else if (s.showBlank) {
      out.push(xj, yj, xi, yi, 0.25 * Math.hypot(xi - xj, yi - yj), 0.6, 0.6, 0.6, 0, (sc.scanT - sc.t[i]) / tau);
    }
    xj = xi;
    yj = yi;
  }

  if (s.head && sc.count) {
    const i = sc.index(0);
    if (sc.on[i]) {
      p = map(sc.x[i], sc.y[i]);
      out.push(p.x, p.y, p.x, p.y, 4 * SQRT_2PI * v.sigma, sc.r[i] / 255 * gr, sc.g[i] / 255 * gg, sc.b[i] / 255 * gb, 1);
    }
  }
}

// ベクター表示：今のフレームの図形をそのまま均一な明るさで描く
export function frameInstances(out: Instances, f: Frame, s: Readonly<Settings>, v: View) {
  const map = mapper(s, v);
  const [gr, gg, gb] = s.eye ? EYE_GAIN : ONE;
  const dot = SQRT_2PI * v.sigma;
  let prevLit = false;
  let p = map(f.x[0], f.y[0]);
  let x0 = p.x, y0 = p.y;
  for (let i = 1; i < f.length; i++) {
    p = map(f.x[i], f.y[i]);
    const x1 = p.x, y1 = p.y;
    const r = f.r[i] / 255 * gr, g = f.g[i] / 255 * gg, b = f.b[i] / 255 * gb;
    if (!f.on[i]) {
      prevLit = false;
    } else if (Math.hypot(x1 - x0, y1 - y0) > 1e-3) {
      out.push(x0, y0, x1, y1, Math.hypot(x1 - x0, y1 - y0), r, g, b, 1);
      prevLit = true;
    } else {
      // その場に留まる点（ドットや角の溜め）。線の途中や角なら線だけで十分なので、孤立した点だけ描く
      let k = i;
      while (k + 1 < f.length && f.on[k + 1] && f.x[k + 1] === f.x[i] && f.y[k + 1] === f.y[i]) k++;
      const continues = k + 1 < f.length && f.on[k + 1];
      if (!prevLit && !continues) out.push(x1, y1, x1, y1, dot, r, g, b, 1);
      i = k;
    }
    x0 = x1;
    y0 = y1;
  }
}
