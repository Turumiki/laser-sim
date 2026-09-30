import type { Frame } from '../core/frame';
import type { Scanner } from '../core/scanner';
import type { Settings } from '../core/params';

// 1本の線分 = x0 y0 x1 y1 / エネルギー r g b / グローの有無
export const STRIDE = 9;
const SQRT_2PI = 2.5066283;

export class Instances {
  data = new Float32Array(STRIDE * 8192);
  count = 0;

  clear() {
    this.count = 0;
  }

  push(x0: number, y0: number, x1: number, y1: number, e: number, r: number, g: number, b: number, glow: number) {
    if ((this.count + 1) * STRIDE > this.data.length) {
      const next = new Float32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    const d = this.data, o = this.count++ * STRIDE;
    d[o] = x0; d[o + 1] = y0; d[o + 2] = x1; d[o + 3] = y1;
    d[o + 4] = e; d[o + 5] = r; d[o + 6] = g; d[o + 7] = b; d[o + 8] = glow;
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

// スキャン再現：露光時間内に通った軌跡を、通った時間に比例したエネルギーで積む。
// 遅く動いた所ほど明るく、図形が長いほど暗くなる（実機と同じ）
export function scanInstances(out: Instances, sc: Scanner, s: Readonly<Settings>, v: View, tau: number) {
  const isExp = s.exposureShape === 'exp';
  const window = isExp ? tau * 5 : tau;
  const dt = 1 / s.pps;
  const X = (i: number) => v.cx + sc.x[i] * v.unit;
  const Y = (i: number) => v.cy - sc.y[i] * v.unit;

  let L = 0;
  while (L < sc.count && sc.scanT - sc.t[sc.index(L)] <= window) L++;

  for (let k = L - 1; k >= 1; k--) {
    const j = sc.index(k), i = sc.index(k - 1);
    if (!sc.on[i]) {
      if (s.showBlank) {
        const len = Math.hypot(X(i) - X(j), Y(i) - Y(j));
        out.push(X(j), Y(j), X(i), Y(i), 0.25 * len, 0.6, 0.6, 0.6, 0);
      }
      continue;
    }
    const age = sc.scanT - sc.t[i];
    const w = isExp ? Math.exp(-age / tau) : 1;
    const e = w * dt / tau * v.lref;
    out.push(X(j), Y(j), X(i), Y(i), e, sc.r[i] / 255, sc.g[i] / 255, sc.b[i] / 255, 1);
  }

  if (s.head && sc.count) {
    const i = sc.index(0);
    if (sc.on[i]) out.push(X(i), Y(i), X(i), Y(i), 4 * SQRT_2PI * v.sigma, sc.r[i] / 255, sc.g[i] / 255, sc.b[i] / 255, 1);
  }
}

// クリーン表示：今のフレームの図形をそのまま均一な明るさで描く
export function frameInstances(out: Instances, f: Frame, v: View) {
  const X = (i: number) => v.cx + f.x[i] * v.unit;
  const Y = (i: number) => v.cy - f.y[i] * v.unit;
  const dot = SQRT_2PI * v.sigma;
  let prevLit = false;
  for (let i = 1; i < f.length; i++) {
    if (!f.on[i]) { prevLit = false; continue; }
    const x0 = X(i - 1), y0 = Y(i - 1), x1 = X(i), y1 = Y(i);
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len > 1e-3) {
      out.push(x0, y0, x1, y1, len, f.r[i] / 255, f.g[i] / 255, f.b[i] / 255, 1);
      prevLit = true;
      continue;
    }
    // その場に留まる点（ドットや角の溜め）。線の途中や角なら線だけで十分なので、孤立した点だけ描く
    let k = i;
    while (k + 1 < f.length && f.on[k + 1] && f.x[k + 1] === f.x[i] && f.y[k + 1] === f.y[i]) k++;
    const continues = k + 1 < f.length && f.on[k + 1];
    if (!prevLit && !continues) out.push(x1, y1, x1, y1, dot, f.r[i] / 255, f.g[i] / 255, f.b[i] / 255, 1);
    i = k;
  }
}
