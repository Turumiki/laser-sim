// ILDAの1フレーム分の点列。毎フレーム作り直すのでオブジェクトは作らず配列を使い回す
export class Frame {
  x: Float32Array;
  y: Float32Array;
  r: Uint8Array;
  g: Uint8Array;
  b: Uint8Array;
  on: Uint8Array;
  // 点ごとの明るさ（0〜255）。色に掛ける
  l: Uint8Array;
  // 1 なら、その点は自分の色（素材の色）を持っている
  own: Uint8Array;
  length = 0;

  constructor(capacity = 4096) {
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.r = new Uint8Array(capacity);
    this.g = new Uint8Array(capacity);
    this.b = new Uint8Array(capacity);
    this.on = new Uint8Array(capacity);
    this.l = new Uint8Array(capacity);
    this.own = new Uint8Array(capacity);
  }

  clear() {
    this.length = 0;
  }

  push(x: number, y: number, on: boolean, level = 255, rgb: readonly number[] | null = null) {
    if (this.length === this.x.length) this.grow();
    const i = this.length++;
    this.x[i] = x;
    this.y[i] = y;
    this.on[i] = on ? 1 : 0;
    this.l[i] = level;
    this.own[i] = rgb ? 1 : 0;
    if (rgb) { this.r[i] = rgb[0]; this.g[i] = rgb[1]; this.b[i] = rgb[2]; }
  }

  // 先頭の n 点を捨てて詰める
  dropFront(n: number) {
    n = Math.min(n, this.length);
    for (const a of [this.x, this.y, this.r, this.g, this.b, this.on, this.l, this.own]) a.copyWithin(0, n, this.length);
    this.length -= n;
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
    this.l = copy(this.l, new Uint8Array(n));
    this.own = copy(this.own, new Uint8Array(n));
  }
}

export interface Vec { x: number; y: number }

// 消灯移動の前後に置く点数（30kppsで約100µs / 約270µs）
// 曲線の長さを測るときの分割数と、1radの曲がりを長さに換算した値（点の詰め方）
const CURVE_SAMPLES = 512;
const TURN_COST = 0.03;

const BLANK_BEFORE = 3;
const BLANK_AFTER = 8;

// パターンから使う描画道具。座標は -1..1（ILDAの座標空間と同じ正方形）
export class FrameBuilder {
  private frame!: Frame;
  private step = 0.025;
  private started = false;
  // moveTo（消灯して移動）した回数。1なら一筆書き
  private paths = 0;
  // 点灯して進んだ長さ（その場に留まる点だけの図形を見分ける）
  private litLen = 0;
  private fx = 0;
  private fy = 0;
  private cx = 0;
  private cy = 0;
  private tmp: Vec = { x: 0, y: 0 };
  // これ以降に打つ点の明るさ（0〜1）
  level = 1;
  // これ以降に打つ点の色（素材の色。null なら設定の色）
  private rgb: readonly number[] | null = null;
  // ILDAファイルの点をそのまま打っている（戻りの移動もデータに任せる）
  private rawMode = false;

  // 消灯中の移動の刻み（1点あたり）と、着いてから点けるまで待つ点数の倍率。
  // レーザー機の設定（サイズ・走査角・スキャナ性能・pps）から決める（実機用のソフトの自動調整と同じ）
  private travelStep = 0.03;
  private settleK = 1;
  private after = BLANK_AFTER;

  reset(frame: Frame, step: number, travelStep = 0.03, settleK = 1) {
    this.frame = frame;
    this.step = step;
    this.travelStep = travelStep;
    this.settleK = settleK;
    this.after = Math.max(2, Math.round(BLANK_AFTER * settleK));
    this.started = false;
    this.paths = 0;
    this.litLen = 0;
    this.level = 1;
    this.rgb = null;
    this.rawMode = false;
  }

  private push(x: number, y: number, on: boolean) {
    if (on) this.litLen += Math.hypot(x - this.cx, y - this.cy);
    this.frame.push(x, y, on, Math.round(this.level * 255), on ? this.rgb : null);
    this.cx = x;
    this.cy = y;
  }

  // 消灯したまま移動。消してから動き出し、着いたらミラーが落ち着くまで待ってから点ける
  moveTo(x: number, y: number) {
    this.paths++;
    if (!this.started) {
      this.started = true;
      this.fx = x;
      this.fy = y;
      for (let i = 0; i < this.after; i++) this.push(x, y, false);
      return;
    }
    // 遠くへ飛ぶほどミラーが落ち着くのに時間がかかる
    const settle = this.after + Math.round(Math.hypot(x - this.cx, y - this.cy) * 4 * this.settleK);
    this.travel(x, y);
    for (let i = 0; i < settle; i++) this.push(x, y, false);
  }

  private travel(x: number, y: number) {
    const x0 = this.cx, y0 = this.cy;
    // 消灯中の移動点。ミラーが付いて来られる速さで刻む。速すぎると着く前に点灯して、ドットや線の始まりに尾が付く
    const n = Math.max(1, Math.ceil(Math.hypot(x - x0, y - y0) / this.travelStep));
    for (let i = 0; i < BLANK_BEFORE; i++) this.push(x0, y0, false);
    for (let i = 1; i <= n; i++) this.push(x0 + (x - x0) * i / n, y0 + (y - y0) * i / n, false);
  }

  // フレームは繰り返し描かれるので、最後に最初の点まで消灯して戻っておく
  closeLoop() {
    if (!this.started || this.rawMode) return;
    // 一筆書きで始点に戻って終わる図形（円など）は、消灯せずにそのまま次の周へつなぐ。
    // 実機のソフトでも閉じた図形はこうする。消すと毎周その場所が欠ける
    // ドット1つだけ（長さのない図形）は、次のコマで別の場所へ動くことがあるので、毎回消してから移る
    if (this.paths === 1 && this.litLen > this.step * 4 && Math.hypot(this.fx - this.cx, this.fy - this.cy) < this.step * 0.5) {
      this.frame.dropFront(this.after);
      return;
    }
    const extra = Math.round(Math.hypot(this.fx - this.cx, this.fy - this.cy) * 4 * this.settleK);
    this.travel(this.fx, this.fy);
    for (let i = 0; i < extra; i++) this.push(this.fx, this.fy, false);
  }

  lineTo(x: number, y: number) {
    const x0 = this.cx, y0 = this.cy;
    const n = Math.max(1, Math.ceil(Math.hypot(x - x0, y - y0) / this.step));
    for (let i = 1; i <= n; i++) this.push(x0 + (x - x0) * i / n, y0 + (y - y0) * i / n, true);
  }

  dwell(n: number) {
    for (let i = 0; i < n; i++) this.push(this.cx, this.cy, true);
  }

  color(rgb: readonly number[] | null) {
    this.rgb = rgb;
  }

  // 読み込んだ線（素材）。点はそのまま通り、向きが大きく変わる所だけ少し溜める
  path(pts: ArrayLike<number>, closed: boolean) {
    const n = pts.length / 2;
    if (n < 1) return;
    this.moveTo(pts[0], pts[1]);
    if (n === 1) { this.dwell(6); return; }
    this.dwell(2);
    const last = closed ? n : n - 1;
    for (let k = 1; k <= last; k++) {
      const i = k % n, h = k - 1, j = (k + 1) % n;
      this.lineTo(pts[i * 2], pts[i * 2 + 1]);
      if (k === last && !closed) { this.dwell(2); break; }
      const ax = pts[i * 2] - pts[h * 2], ay = pts[i * 2 + 1] - pts[h * 2 + 1];
      const bx = pts[j * 2] - pts[i * 2], by = pts[j * 2 + 1] - pts[i * 2 + 1];
      const turn = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
      if (turn > 0.7) this.dwell(turn > 1.6 ? 3 : 2);
    }
  }

  // ILDAファイルの点。消灯や溜めはデータに入っているので、手を加えずに打つ
  raw(x: number, y: number, on: boolean, rgb: readonly number[]) {
    this.rawMode = true;
    this.frame.push(x, y, on, 255, on ? rgb : null);
    this.cx = x;
    this.cy = y;
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

  // 点数を固定して曲線を打つ（テストパターン用。点間隔の設定に左右されない）
  curveN(fn: (u: number, out: Vec) => void, n: number) {
    const p = this.tmp;
    fn(0, p);
    this.moveTo(p.x, p.y);
    for (let i = 1; i <= n; i++) {
      fn(i / n, p);
      this.push(p.x, p.y, true);
    }
  }

  // u: 0..1 の曲線を、長さに沿って点間隔が揃うように打つ。
  // 急に曲がる所は点を詰める（ミラーが曲がり切れずに丸まらないように。実機用のソフトも同じことをする）
  private cu = new Float32Array(CURVE_SAMPLES + 1);
  curve(fn: (u: number, out: Vec) => void) {
    const p = this.tmp, cost = this.cu;
    fn(0, p);
    let px = p.x, py = p.y, dx = 0, dy = 0;
    cost[0] = 0;
    for (let i = 1; i <= CURVE_SAMPLES; i++) {
      fn(i / CURVE_SAMPLES, p);
      const ex = p.x - px, ey = p.y - py, len = Math.hypot(ex, ey);
      // 前の区間からの向きの変わり方（rad）
      const turn = len > 1e-9 && (dx || dy) ? Math.abs(Math.atan2(dx * ey - dy * ex, dx * ex + dy * ey)) : 0;
      cost[i] = cost[i - 1] + len + turn * TURN_COST;
      if (len > 1e-9) { dx = ex; dy = ey; }
      px = p.x;
      py = p.y;
    }
    const total = cost[CURVE_SAMPLES];
    const n = Math.max(8, Math.ceil(total / this.step));
    fn(0, p);
    this.moveTo(p.x, p.y);
    let j = 0;
    for (let i = 1; i <= n; i++) {
      const target = total * i / n;
      while (j < CURVE_SAMPLES - 1 && cost[j + 1] < target) j++;
      const span = cost[j + 1] - cost[j];
      const u = (j + (span > 0 ? (target - cost[j]) / span : 0)) / CURVE_SAMPLES;
      fn(Math.min(u, 1), p);
      this.push(p.x, p.y, true);
    }
  }
}
