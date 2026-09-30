import { Frame } from './frame';

export type FrameSource = (out: Frame, t: number) => void;

interface ScanParams {
  pps: number;
  lag: number; // ms
  animSpeed: number;
}

const CAP = 1 << 16;

// ガルバノスキャナの再現。点を1つずつpps間隔で出力し、ミラーは一次遅れで追従する。
// 通った位置はリングバッファに残し、描画側が露光時間ぶんだけ読む
export class Scanner {
  readonly cap = CAP;
  readonly x = new Float32Array(CAP);
  readonly y = new Float32Array(CAP);
  readonly t = new Float64Array(CAP);
  readonly r = new Uint8Array(CAP);
  readonly g = new Uint8Array(CAP);
  readonly b = new Uint8Array(CAP);
  readonly on = new Uint8Array(CAP);
  head = 0;
  count = 0;

  // スキャナの時間とアニメーションの時間（秒）
  scanT = 0;
  animT = 0;

  private frame = new Frame();
  private fi = 0;
  private gx = 0;
  private gy = 0;
  private carry = 0;
  private source: FrameSource;

  constructor(source: FrameSource) {
    this.source = source;
  }

  step(scanDt: number, p: ScanParams) {
    this.carry += scanDt * p.pps;
    const n = Math.min(Math.floor(this.carry), 30000);
    this.carry -= Math.floor(this.carry);
    const dtp = 1 / p.pps;
    const a = p.lag > 0 ? 1 - Math.exp(-dtp / (p.lag / 1000)) : 1;
    const f = this.frame;
    for (let k = 0; k < n; k++) {
      if (this.fi >= f.length) {
        this.source(f, this.animT);
        this.fi = 0;
      }
      const i = this.fi++;
      this.gx += (f.x[i] - this.gx) * a;
      this.gy += (f.y[i] - this.gy) * a;
      this.scanT += dtp;
      this.animT += dtp * p.animSpeed;

      const h = this.head;
      this.x[h] = this.gx;
      this.y[h] = this.gy;
      this.t[h] = this.scanT;
      this.r[h] = f.r[i];
      this.g[h] = f.g[i];
      this.b[h] = f.b[i];
      this.on[h] = f.on[i];
      this.head = (h + 1) & (CAP - 1);
      if (this.count < CAP) this.count++;
    }
  }

  // シミュレーションせずに時間だけ進める（クリーン表示用）
  advance(scanDt: number, animSpeed: number) {
    this.scanT += scanDt;
    this.animT += scanDt * animSpeed;
  }

  // 新しい方から k 番目のインデックス
  index(k: number) {
    return (this.head - 1 - k + CAP) & (CAP - 1);
  }
}
