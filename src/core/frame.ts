// ILDAの1フレーム分の点列。毎フレーム作り直すのでオブジェクトは作らず配列を使い回す
export class Frame {
  x: Float32Array;
  y: Float32Array;
  r: Uint8Array;
  g: Uint8Array;
  b: Uint8Array;
  on: Uint8Array;
  length = 0;

  constructor(capacity = 4096) {
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.r = new Uint8Array(capacity);
    this.g = new Uint8Array(capacity);
    this.b = new Uint8Array(capacity);
    this.on = new Uint8Array(capacity);
  }

  clear() {
    this.length = 0;
  }

  push(x: number, y: number, on: boolean) {
    if (this.length === this.x.length) this.grow();
    const i = this.length++;
    this.x[i] = x;
    this.y[i] = y;
    this.on[i] = on ? 1 : 0;
  }

  private grow() {
    const n = this.x.length * 2;
    const copy = <T extends Float32Array | Uint8Array>(a: T, b: T) => { b.set(a); return b; };
    this.x = copy(this.x, new Float32Array(n));
    this.y = copy(this.y, new Float32Array(n));
    this.r = copy(this.r, new Uint8Array(n));
    this.g = copy(this.g, new Uint8Array(n));
    this.b = copy(this.b, new Uint8Array(n));
    this.on = copy(this.on, new Uint8Array(n));
  }
}

export interface Vec { x: number; y: number }

// パターンから使う描画道具。座標は -1..1（ILDAの座標空間と同じ正方形）
export class FrameBuilder {
  private frame!: Frame;
  private step = 0.025;
  private started = false;
  private cx = 0;
  private cy = 0;
  private tmp: Vec = { x: 0, y: 0 };

  reset(frame: Frame, step: number) {
    this.frame = frame;
    this.step = step;
    this.started = false;
  }

  private push(x: number, y: number, on: boolean) {
    this.frame.push(x, y, on);
    this.cx = x;
    this.cy = y;
  }

  // 消灯したまま移動。ミラーが落ち着くまで少し待つ
  moveTo(x: number, y: number) {
    if (!this.started) {
      this.started = true;
      for (let i = 0; i < 4; i++) this.push(x, y, false);
      return;
    }
    const x0 = this.cx, y0 = this.cy;
    const n = Math.max(1, Math.ceil(Math.hypot(x - x0, y - y0) / 0.15));
    this.push(x0, y0, false);
    for (let i = 1; i <= n; i++) this.push(x0 + (x - x0) * i / n, y0 + (y - y0) * i / n, false);
    for (let i = 0; i < 4; i++) this.push(x, y, false);
  }

  lineTo(x: number, y: number) {
    const x0 = this.cx, y0 = this.cy;
    const n = Math.max(1, Math.ceil(Math.hypot(x - x0, y - y0) / this.step));
    for (let i = 1; i <= n; i++) this.push(x0 + (x - x0) * i / n, y0 + (y - y0) * i / n, true);
  }

  dwell(n: number) {
    for (let i = 0; i < n; i++) this.push(this.cx, this.cy, true);
  }

  // pts: [x0, y0, x1, y1, ...]
  poly(pts: readonly number[], closed: boolean, corner = 3) {
    this.moveTo(pts[0], pts[1]);
    this.dwell(corner);
    for (let k = 2; k < pts.length; k += 2) {
      this.lineTo(pts[k], pts[k + 1]);
      this.dwell(corner);
    }
    if (closed) {
      this.lineTo(pts[0], pts[1]);
      this.dwell(corner);
    }
  }

  // u: 0..1 の曲線を点間隔が揃うように打つ
  curve(fn: (u: number, out: Vec) => void) {
    const p = this.tmp;
    fn(0, p);
    let px = p.x, py = p.y, len = 0;
    for (let i = 1; i <= 256; i++) {
      fn(i / 256, p);
      len += Math.hypot(p.x - px, p.y - py);
      px = p.x;
      py = p.y;
    }
    const n = Math.max(8, Math.ceil(len / this.step));
    fn(0, p);
    this.moveTo(p.x, p.y);
    for (let i = 1; i <= n; i++) {
      fn(i / n, p);
      this.push(p.x, p.y, true);
    }
  }
}
