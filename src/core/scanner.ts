import { Frame } from './frame';

export type FrameSource = (out: Frame, t: number) => void;

interface ScanParams {
  pps: number;
  scannerK: number; // kpps
  damping: number;
  colorShift: number; // µs
  scanAngle: number; // 光学角（全幅）
  size: number;
  animSpeed: number;
}

const CAP = 1 << 16;

// 送った点を少しの間覚えておく。カラーシフトで色だけ前後にずらすため
const CMD = 128;
// 座標側をこの点数だけ遅らせておき、色を前にも後ろにもずらせるようにする
const BASE_DELAY = 40;

// スキャナ性能(kpps)からミラーの固有振動数への換算。30K ≒ 1.5kHz
const HZ_PER_KPPS = 50;
// ミラーが振れる速さの上限（光学角 °/s）。30Kで15000°/s。
// ILDAテストパターンを走査角8°で描けて、それより大きく描くと崩れ始めるくらいの値
export const DEG_PER_SEC_PER_KPPS = 500;

// ガルバノスキャナの再現。点を1つずつpps間隔で出力し、ミラーは「ばね＋おもり＋減衰」として追従する。
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
  private carry = 0;
  private source: FrameSource;

  private cx = new Float32Array(CMD);
  private cy = new Float32Array(CMD);
  private cr = new Uint8Array(CMD);
  private cg = new Uint8Array(CMD);
  private cb = new Uint8Array(CMD);
  private con = new Uint8Array(CMD);
  private ch = 0;

  // ミラーの位置と速度
  private px = 0;
  private py = 0;
  private vx = 0;
  private vy = 0;

  constructor(source: FrameSource) {
    this.source = source;
  }

  step(scanDt: number, p: ScanParams) {
    this.carry += scanDt * p.pps;
    const n = Math.min(Math.floor(this.carry), 30000);
    this.carry -= Math.floor(this.carry);
    const dtp = 1 / p.pps;

    const w = 2 * Math.PI * HZ_PER_KPPS * p.scannerK;
    const zeta = p.damping;
    // 1点の間に数回に分けて積分する（速いミラーでも発散しないように）
    const sub = Math.max(1, Math.ceil(w * dtp / 0.25));
    const h = dtp / sub;
    // 速さの上限を点の座標の単位に直す（座標1 = 正方形の半分 = 最大走査角の半分 × サイズ）
    const vmax = DEG_PER_SEC_PER_KPPS * p.scannerK / (p.scanAngle / 2 * p.size);
    const clamp = (v: number) => (v > vmax ? vmax : v < -vmax ? -vmax : v);
    const shift = Math.max(-BASE_DELAY, Math.min(BASE_DELAY, Math.round(p.colorShift * 1e-6 * p.pps)));

    const f = this.frame;
    for (let k = 0; k < n; k++) {
      if (this.fi >= f.length && this.bi >= this.bn) {
        this.source(f, this.animT);
        this.fi = 0;
        this.bridge(f, p);
      }
      const c = this.ch;
      if (this.bi < this.bn) {
        // コマのつなぎ目の、消灯したままの移動
        const b = this.bi++;
        this.cx[c] = this.bx[b];
        this.cy[c] = this.by[b];
        this.cr[c] = this.cg[c] = this.cb[c] = 0;
        this.con[c] = 0;
      } else {
        const i = this.fi++;
        this.cx[c] = f.x[i];
        this.cy[c] = f.y[i];
        this.cr[c] = f.r[i];
        this.cg[c] = f.g[i];
        this.cb[c] = f.b[i];
        this.con[c] = f.on[i];
      }
      this.ch = (c + 1) & (CMD - 1);

      const pi = (c - BASE_DELAY + CMD) & (CMD - 1);
      const ci = (c - BASE_DELAY - shift + CMD) & (CMD - 1);
      const tx = this.cx[pi], ty = this.cy[pi];
      for (let s = 0; s < sub; s++) {
        this.vx = clamp(this.vx + (w * w * (tx - this.px) - 2 * zeta * w * this.vx) * h);
        this.vy = clamp(this.vy + (w * w * (ty - this.py) - 2 * zeta * w * this.vy) * h);
        this.px += this.vx * h;
        this.py += this.vy * h;
      }

      this.scanT += dtp;
      this.animT += dtp * p.animSpeed;

      const o = this.head;
      this.x[o] = this.px;
      this.y[o] = this.py;
      this.t[o] = this.scanT;
      this.r[o] = this.cr[ci];
      this.g[o] = this.cg[ci];
      this.b[o] = this.cb[ci];
      this.on[o] = this.con[ci];
      this.head = (o + 1) & (CAP - 1);
      if (this.count < CAP) this.count++;
    }
  }

  // 前のコマの終わりと次のコマの始まりが離れているとき（パターンが切り替わった、何も描かないコマの後など）、
  // 消してから、ミラーが付いて来られる速さで移動し、落ち着くまで待つ点を挟む。挟まないと始まりの点に尾が付く
  private bx = new Float32Array(600);
  private by = new Float32Array(600);
  private bn = 0;
  private bi = 0;
  private bridge(f: Frame, p: ScanParams) {
    this.bn = this.bi = 0;
    if (!f.length) return;
    const last = (this.ch - 1 + CMD) & (CMD - 1);
    const x0 = this.cx[last], y0 = this.cy[last], x1 = f.x[0], y1 = f.y[0];
    const d = Math.hypot(x1 - x0, y1 - y0);
    // 隣り合う点くらいの差（円などを続けて描くときのつなぎ目）はそのまま点けてつなぐ
    if (d < 0.06) return;
    const step = Math.max(1e-3, 0.85 * DEG_PER_SEC_PER_KPPS * p.scannerK / (p.scanAngle / 2 * p.size) / p.pps);
    const n = Math.min(400, Math.ceil(d / step));
    const settle = Math.min(150, Math.round(8 * (30 / p.scannerK) * (p.pps / 30000)));
    const put = (x: number, y: number) => { this.bx[this.bn] = x; this.by[this.bn++] = y; };
    for (let k = 0; k < 3; k++) put(x0, y0);
    for (let k = 1; k <= n; k++) put(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n);
    for (let k = 0; k < settle; k++) put(x1, y1);
  }

  // シミュレーションせずに時間だけ進める（ベクター表示用）
  advance(scanDt: number, animSpeed: number) {
    this.scanT += scanDt;
    this.animT += scanDt * animSpeed;
  }

  // 新しい方から k 番目のインデックス
  index(k: number) {
    return (this.head - 1 - k + CAP) & (CAP - 1);
  }
}
