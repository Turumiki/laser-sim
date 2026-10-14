import type { Settings } from '../core/params';
import { EYE_GAIN } from '../core/color';
import { clampMirror } from '../core/mirror';
import type { HitTarget } from './hits';

// ビームを3Dの形（光の膜・ビーム・物に当たった所の光）にする計算。three.js を使わないので、Worker（別スレッド）でも動く。
// 隣り合う2点の間は光の膜（三角形）、その場に留まる点は1本のビーム（線）にする

// 当たり方を覚えておく格子の細かさ（1辺）。最大走査角40°なら1マス 0.2°くらい
const GRID = 256;
interface HitGrid {
  key: string;
  // 格子が覆う範囲（tan で ±T）
  T: number;
  N: number;
  // 隅ごとに当たる面の番号（-2: まだ調べていない、-1: 何にも当たらない）
  ids: Int32Array;
  // 面ごとの、プロジェクターから見た範囲（tan で [左, 下, 右, 上]。前に無い面は NaN）
  boxes: Float32Array;
  // マスごとに、当たる可能性のある面（使うときに作る）
  cand: (number[] | undefined)[];
  // 面ごとに、プロジェクターから表が見えるか（1: 見える）
  faces: Uint8Array;
}

export interface Rig {
  // プロジェクターから壁までの距離
  distance: number;
  // ヘイズの濃さ（ビームの明るさ）
  haze: number;
  // ローリングシャッターの読み出し時間（露光時間を1とする）。0なら全体を同時に撮る
  roll: number;
  // 人の目の色ごとの感度で見る
  eye: boolean;
}

// プロジェクター1台の置き場所と向き
export interface Projector {
  pos: readonly [number, number, number];
  // 左右の向き（rad）。正で左を向く
  yaw: number;
  // 上下の傾き（rad）。正で上を向く。省くと水平
  pitch?: number;
  // 左右反転（左右対称に並べるときの右側）
  mirror: boolean;
}

// スキャナが露光時間内に通った点（新しい順）。age はその点から今までの時間（秒）
export interface ScanWindow {
  count: number;
  x: Float32Array;
  y: Float32Array;
  age: Float32Array;
  r: Uint8Array;
  g: Uint8Array;
  b: Uint8Array;
  on: Uint8Array;
}

// ベクター表示のときの今のフレーム
export interface FramePoints {
  length: number;
  x: Float32Array;
  y: Float32Array;
  r: Uint8Array;
  g: Uint8Array;
  b: Uint8Array;
  on: Uint8Array;
}

export type BeamSettings = Pick<Settings, 'mode' | 'exposureShape' | 'pps' | 'bright' | 'scanAngle' | 'size' | 'pincushion'>;

// 1台ぶんの描く材料。チャンネルごとに設定とシミュレーションが違う
export interface BeamSource {
  settings: BeamSettings;
  // 光を積算する時間（スキャンのとき）
  tau: number;
  scan: ScanWindow | null;
  frame: FramePoints | null;
}

// 1フレームに描ける数（光の膜の三角形・ビームの線・当たった所の線）。GPU側のバッファも同じ大きさで作る
export const CAPACITY = { sheets: 160000, rays: 60000, wall: 160000 } as const;

// 頂点の並び。位置・色・光源の位置・光の古さ（露光時間を1とする。時刻がないときは -1）
export class Arrays {
  pos: Float32Array;
  col: Float32Array;
  org: Float32Array;
  age: Float32Array;
  count = 0;
  curAge = -1;
  origin: readonly number[] = [0, 0, 0];
  readonly per: number;

  constructor(max: number, vertsPer: number) {
    this.per = vertsPer;
    this.pos = new Float32Array(max * vertsPer * 3);
    this.col = new Float32Array(max * vertsPer * 3);
    this.org = new Float32Array(max * vertsPer * 3);
    this.age = new Float32Array(max * vertsPer);
  }

  full() {
    return (this.count + 1) * this.per * 3 > this.pos.length;
  }

  vert(k: number, x: number, y: number, z: number, r: number, g: number, b: number) {
    const o = (this.count * this.per + k) * 3;
    this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z;
    this.col[o] = r; this.col[o + 1] = g; this.col[o + 2] = b;
    this.org[o] = this.origin[0]; this.org[o + 1] = this.origin[1]; this.org[o + 2] = this.origin[2];
    this.age[this.count * this.per + k] = this.curAge;
  }
}

export class BeamGeometry {
  readonly sheets = new Arrays(CAPACITY.sheets, 3);
  readonly rays = new Arrays(CAPACITY.rays, 2);
  readonly wall = new Arrays(CAPACITY.wall, 2);
  private hits: HitTarget;
  private rig: Rig = { distance: 8, haze: 1, roll: 0, eye: false };
  private ext = 0;
  private proj: Projector = { pos: [0, 0, 0], yaw: 0, mirror: false };
  private cos = 1;
  private sin = 0;
  private pcos = 1;
  private psin = 0;
  private dir = [0, 0, 0];
  // 点の座標はサイズを掛ける前の値なので、ここで掛ける
  private scale = 1;
  // 最大走査角の半分（rad）。台ごとに、そのチャンネルの設定から
  private half = 0.35;
  private pincushion = true;
  // 色ごとの見かけの明るさ
  private gain: readonly number[] = [1, 1, 1];

  constructor(hits: HitTarget) {
    this.hits = hits;
  }

  // 台ごとに、割り当てたチャンネルの材料で描く（材料は台の順に繰り返して使う）。
  // ext: ヘイズの減衰係数（1mあたり）
  draw(projectors: readonly Projector[], sources: readonly BeamSource[], rig: Rig, ext: number) {
    this.rig = rig;
    this.ext = ext;
    this.cached = -1;
    this.sheets.count = this.rays.count = this.wall.count = 0;
    if (!sources.length) return;
    projectors.forEach((p, k) => {
      const src = sources[k % sources.length], s = src.settings;
      this.use(p, k, s);
      if (s.mode === 'scan' && src.scan) this.scanOne(src.scan, s, src.tau);
      else if (src.frame) this.frameOne(src.frame, s);
    });
  }

  // 点の座標 → ビームが当たる位置。戻り値は奥行き（何にも当たらなければ Infinity）
  private hit(x: number, y: number, out: number[]) {
    const a = this.half * this.scale;
    // 2枚のミラーで振るので、Yを振るほどXが広がる（糸巻きゆがみ）
    const ax = clampMirror(x * a), ay = clampMirror(y * a);
    const warp = this.pincushion ? 1 / Math.cos(ay) : 1;
    const tx = Math.tan(ax) * warp * (this.proj.mirror ? -1 : 1), ty = Math.tan(ay);
    const t = this.cast(tx, ty);
    const d = this.dir, o = this.proj.pos;
    // 当たらないビームは一定の長さで止め、先へ行くほど消えていく
    const reach = Number.isFinite(t) ? t : this.rig.distance * 1.2;
    out[0] = o[0] + d[0] * reach;
    out[1] = o[1] + d[1] * reach;
    out[2] = o[2] + d[2] * reach;
    return t;
  }

  // 向き (tx, ty)（プロジェクターから見た tan）を、空間の向きにして this.dir に入れる。
  // 正面は -z。上下に傾けて（x軸まわり）から、左右に振る（y軸まわり）
  private aim(tx: number, ty: number) {
    const d = this.dir;
    const py = ty * this.pcos + this.psin, pz = ty * this.psin - this.pcos;
    d[0] = tx * this.cos + pz * this.sin;
    d[1] = py;
    d[2] = -tx * this.sin + pz * this.cos;
  }

  // 向き (tx, ty) のビームが当たるまでの t。lastId に当たった面の番号を入れる。
  // 会場では、プロジェクターごとに「どの向きがどの面に当たるか」を格子で覚えておき、
  // 格子の4隅が同じ面に当たるなら、その中は平面との交点だけで済ませる（結果は全部調べたときと同じ）
  private cast(tx: number, ty: number) {
    const g = this.grid;
    if (g && Math.abs(tx) < g.T && Math.abs(ty) < g.T) {
      const fx = (tx / g.T * 0.5 + 0.5) * g.N, fy = (ty / g.T * 0.5 + 0.5) * g.N;
      const i = Math.min(g.N - 1, fx | 0), j = Math.min(g.N - 1, fy | 0);
      const id = this.corner(g, i, j);
      if (id === this.corner(g, i + 1, j) && id === this.corner(g, i, j + 1) && id === this.corner(g, i + 1, j + 1)) {
        this.aim(tx, ty);
        this.lastId = id;
        return id < 0 ? Infinity : this.hits.hitPlane(id, this.proj.pos, this.dir);
      }
      // 面の境目のマスは、このマスに掛かっている面だけを調べる（範囲は広めに取っているので、全部調べたときと同じ結果）
      this.aim(tx, ty);
      const t = this.hits.hitAmong(this.candidates(g, i, j), this.proj.pos, this.dir);
      this.lastId = Number.isFinite(t) ? this.hits.lastId : -1;
      return t;
    }
    this.aim(tx, ty);
    const t = this.hits.hit(this.proj.pos, this.dir);
    this.lastId = Number.isFinite(t) ? this.hits.lastId : -1;
    return t;
  }

  // 格子の隅の向きが当たる面の番号（初めて使うときに調べて覚える。-1 は何にも当たらない）
  private corner(g: HitGrid, i: number, j: number) {
    const k = j * (g.N + 1) + i;
    let id = g.ids[k];
    if (id === -2) {
      this.aim((i / g.N * 2 - 1) * g.T, (j / g.N * 2 - 1) * g.T);
      // 隅はマスの縁の上なので、隣のマスの候補にも入っている
      const t = this.hits.hitAmong(this.candidates(g, Math.min(i, g.N - 1), Math.min(j, g.N - 1)), this.proj.pos, this.dir);
      id = Number.isFinite(t) ? this.hits.lastId : -1;
      g.ids[k] = id;
    }
    return id;
  }

  // マス (i, j) に掛かっている面の番号
  private candidates(g: HitGrid, i: number, j: number) {
    const k = j * g.N + i;
    let c = g.cand[k];
    if (!c) {
      c = [];
      const x0 = (i / g.N * 2 - 1) * g.T, x1 = ((i + 1) / g.N * 2 - 1) * g.T;
      const y0 = (j / g.N * 2 - 1) * g.T, y1 = ((j + 1) / g.N * 2 - 1) * g.T;
      const b = g.boxes;
      for (let id = 0; id < b.length / 4; id++) {
        if (b[id * 4] <= x1 && b[id * 4 + 2] >= x0 && b[id * 4 + 1] <= y1 && b[id * 4 + 3] >= y0) c.push(id);
      }
      g.cand[k] = c;
    }
    return c;
  }

  // 面ごとに、プロジェクターから見た範囲を出す。面をプロジェクターの向きに直し、
  // 前（-z）にある部分だけに切ってから、z = -1 の面に映した点の範囲を取る
  private boxes(p: Projector) {
    const n = this.hits.polyCount, out = new Float32Array(n * 4).fill(NaN);
    const o = p.pos, NEAR = -1e-3;
    for (let id = 0; id < n; id++) {
      const local = this.hits.polyPoints(id).map(v => {
        const wx = v[0] - o[0], wy = v[1] - o[1], wz = v[2] - o[2];
        const lx = wx * this.cos - wz * this.sin, pz = wx * this.sin + wz * this.cos;
        return [lx, wy * this.pcos + pz * this.psin, -wy * this.psin + pz * this.pcos];
      });
      // z <= NEAR の側だけ残す（多角形を平面で切る）
      const kept: number[][] = [];
      for (let k = 0; k < local.length; k++) {
        const a = local[k], b = local[(k + 1) % local.length];
        const ain = a[2] <= NEAR, bin = b[2] <= NEAR;
        if (ain) kept.push(a);
        if (ain !== bin) {
          const t = (NEAR - a[2]) / (b[2] - a[2]);
          kept.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]);
        }
      }
      if (!kept.length) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const v of kept) {
        const x = v[0] / -v[2], y = v[1] / -v[2];
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      // 少し広げておく（丸め誤差で取りこぼさないように）
      const m = 1e-4;
      out.set([x0 - m, y0 - m, x1 + m, y1 + m], id * 4);
    }
    return out;
  }

  // 面ごとに、プロジェクターがその面の表側にいるか。裏側の面には、縁をかすめたとき以外は当たらない
  private facing(p: Projector) {
    const n = this.hits.polyCount, out = new Uint8Array(n);
    for (let id = 0; id < n; id++) {
      const pl = this.hits.plane(id);
      if (pl) out[id] = pl.n[0] * p.pos[0] + pl.n[1] * p.pos[1] + pl.n[2] * p.pos[2] - pl.np > 1e-6 ? 1 : 0;
    }
    return out;
  }

  // 台ごとの格子。会場・置き場所・向き・振れる範囲が変わったら作り直す
  private grids: (HitGrid | undefined)[] = [];
  private grid: HitGrid | null = null;

  private use(p: Projector, index: number, s: BeamSettings) {
    this.proj = p;
    this.cached = -1;
    this.half = s.scanAngle / 2 * Math.PI / 180;
    this.scale = s.size;
    this.pincushion = s.pincushion;
    this.gain = this.rig.eye ? EYE_GAIN : [1, 1, 1];
    this.cos = Math.cos(p.yaw);
    this.sin = Math.sin(p.yaw);
    this.pcos = Math.cos(p.pitch ?? 0);
    this.psin = Math.sin(p.pitch ?? 0);
    this.sheets.origin = this.rays.origin = this.wall.origin = p.pos;
    this.grid = null;
    if (this.hits.planar) {
      // 振れる一番端の向き（糸巻きゆがみで横に広がる分も含める）
      const a = clampMirror(this.half * this.scale * 1.02);
      const T = Math.tan(a) / Math.cos(a);
      const key = `${this.hits.version}|${p.pos.join(',')}|${p.yaw}|${p.pitch ?? 0}|${T.toFixed(5)}`;
      let g = this.grids[index];
      if (!g || g.key !== key) {
        g = { key, T, N: GRID, ids: new Int32Array((GRID + 1) * (GRID + 1)).fill(-2), boxes: this.boxes(p), cand: [], faces: this.facing(p) };
        this.grids[index] = g;
      }
      this.grid = g;
    }
  }

  // 2本のビームが別々の面に当たっている（または奥行きが飛んでいる）か。
  // 別の面どうしを膜でそのままつなぐと、当たらないはずの所（箱の横の面など）を光が横切ってしまう。
  // ただし、へこんだ角でつながる面どうし（床と壁など）は、そのままつないでも物の中を通らないので分けない
  private split(ta: number, ia: number, tb: number, ib: number, strict = false) {
    if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Number.isFinite(ta) !== Number.isFinite(tb);
    if (Math.abs(ta - tb) > 0.15 * Math.max(ta, tb)) return true;
    if (ia === ib) return false;
    // へこんだ角とみなすのは、プロジェクターから両方の面の表が見えるときだけ（縁をかすめて裏の面に当たったものは除く）
    const f = this.grid?.faces;
    return strict || !f || !f[ia] || !f[ib] || !this.hits.concave(ia, ib);
  }
  private lastId = -1;
  private ia = -1;
  private ib = -1;

  // 線分の両端の当たる位置と奥行き。隣の線分と端を共有するので、1点につき1回だけ計算して使い回す
  private a = [0, 0, 0];
  private b = [0, 0, 0];
  private ta = 0;
  private tb = 0;
  private cached = -1;

  // 点 (x0,y0) → (x1,y1) の両端を a / b に用意する。key は前の点の番号（同じなら前回の b を a として使う）
  private ends(key: number, x0: number, y0: number, x1: number, y1: number, next: number) {
    if (this.cached === key) {
      const t = this.a; this.a = this.b; this.b = t;
      this.ta = this.tb;
      this.ia = this.ib;
    } else {
      this.ta = this.hit(x0, y0, this.a);
      this.ia = this.lastId;
    }
    this.tb = this.hit(x1, y1, this.b);
    this.ib = this.lastId;
    this.cached = next;
    this.p0[0] = x0; this.p0[1] = y0; this.p1[0] = x1; this.p1[1] = y1;
    this.edged = false;
    this.cornered = false;
  }

  // 両端が別々の物に当たっているとき、境目の手前（ea）と向こう（eb）の当たる位置。
  // 線分を二分探索して縁を探す。見つからなければ false
  private p0 = [0, 0];
  private p1 = [0, 0];
  private ea = [0, 0, 0];
  private eb = [0, 0, 0];
  private tmp = [0, 0, 0];
  private edged = false;
  private edgeOk = false;
  // strict: へこんだ角も境目として扱う（角の点が出せなかったとき用）
  private edgeStrict = false;
  private edge(strict = false) {
    if (this.edged && this.edgeStrict === strict) return this.edgeOk;
    this.edged = true;
    this.edgeStrict = strict;
    let lo = 0, hi = 1, tLo = this.ta, tHi = this.tb, iLo = this.ia, iHi = this.ib;
    const ea = this.ea, eb = this.eb;
    ea[0] = this.a[0]; ea[1] = this.a[1]; ea[2] = this.a[2];
    eb[0] = this.b[0]; eb[1] = this.b[1]; eb[2] = this.b[2];
    // 6回で、線分の1/64まで縁に寄せる（点の間隔より十分細かい）
    for (let i = 0; i < 6; i++) {
      const m = (lo + hi) / 2, tmp = this.tmp;
      const t = this.hit(this.p0[0] + (this.p1[0] - this.p0[0]) * m, this.p0[1] + (this.p1[1] - this.p0[1]) * m, tmp);
      const id = this.lastId;
      if (!this.split(tLo, iLo, t, id, strict)) { lo = m; tLo = t; iLo = id; ea[0] = tmp[0]; ea[1] = tmp[1]; ea[2] = tmp[2]; }
      else { hi = m; tHi = t; iHi = id; eb[0] = tmp[0]; eb[1] = tmp[1]; eb[2] = tmp[2]; }
    }
    // 縁の両側がそれぞれつながっていれば、そこで分けて描ける
    this.edgeOk = !this.split(tHi, iHi, this.tb, this.ib, strict) || hi === 1;
    return this.edgeOk;
  }

  // へこんだ角をまたぐとき、膜の平面（光源・a・b を通る）と2つの面が交わる点 c（角の上の点）を出す。
  // a → c → b と折り曲げれば、面の上を正しくたどる。出せなければ false
  private c = [0, 0, 0];
  private cornerOk = false;
  private cornered = false;
  private bend() {
    if (this.cornered) return this.cornerOk;
    this.cornered = true;
    this.cornerOk = false;
    const A = this.hits.plane(this.ia), B = this.hits.plane(this.ib);
    if (!A || !B) return false;
    const o = this.proj.pos, a = this.a, b = this.b;
    const ua = [a[0] - o[0], a[1] - o[1], a[2] - o[2]], ub = [b[0] - o[0], b[1] - o[1], b[2] - o[2]];
    // 膜の平面
    const ns = [ua[1] * ub[2] - ua[2] * ub[1], ua[2] * ub[0] - ua[0] * ub[2], ua[0] * ub[1] - ua[1] * ub[0]];
    const nps = ns[0] * o[0] + ns[1] * o[1] + ns[2] * o[2];
    // 3枚の平面の交点（クラメルの公式）
    const m = [A.n, B.n, ns], r = [A.np, B.np, nps];
    const det3 = (c0: number[], c1: number[], c2: number[]) =>
      c0[0] * (c1[1] * c2[2] - c1[2] * c2[1]) - c1[0] * (c0[1] * c2[2] - c0[2] * c2[1]) + c2[0] * (c0[1] * c1[2] - c0[2] * c1[1]);
    // 行列の列ごとに見る（行 = 平面）
    const col = (k: number) => [m[0][k], m[1][k], m[2][k]];
    const D = det3(col(0), col(1), col(2));
    if (Math.abs(D) < 1e-9) return false;
    const c = this.c;
    c[0] = det3(r, col(1), col(2)) / D;
    c[1] = det3(col(0), r, col(2)) / D;
    c[2] = det3(col(0), col(1), r) / D;
    // 角の点が a と b の間（光源から見て2本のビームの間）にあるか
    const uc = [c[0] - o[0], c[1] - o[1], c[2] - o[2]];
    const cross = (p: number[], q: number[]) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
    const dotp = (p: number[], q: number[]) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
    if (dotp(cross(ua, uc), ns) < 0 || dotp(cross(uc, ub), ns) < 0) return false;
    // 角の点が、2つの面が実際に接している所（両方の面の上）にあるか。外れていれば、間に別の物や隙間がある
    if (!this.hits.contains(this.ia, c, 0.02) || !this.hits.contains(this.ib, c, 0.02)) return false;
    this.cornerOk = true;
    return true;
  }

  private tri(p: number[], q: number[], r: number, g: number, b: number) {
    if (this.sheets.full()) return;
    const s = this.sheets, o = this.proj.pos;
    s.vert(0, o[0], o[1], o[2], r, g, b);
    s.vert(1, p[0], p[1], p[2], r, g, b);
    s.vert(2, q[0], q[1], q[2], r, g, b);
    s.count++;
  }

  private sheet(r: number, g: number, b: number, k: number) {
    r *= k; g *= k; b *= k;
    if (!this.split(this.ta, this.ia, this.tb, this.ib)) {
      // へこんだ角をまたぐときは、角の点で折り曲げる
      if (this.ia === this.ib) { this.tri(this.a, this.b, r, g, b); return; }
      if (this.bend()) {
        this.tri(this.a, this.c, r, g, b);
        this.tri(this.c, this.b, r, g, b);
        return;
      }
      // 角の点が出せなければ、境目を探して分ける
      if (!this.edge(true)) return;
      this.tri(this.a, this.ea, r, g, b);
      this.tri(this.eb, this.b, r, g, b);
      return;
    }
    // 物の縁をまたぐ膜は、そのまま張ると手前の物を突き抜けるので、縁で2枚に分ける
    if (!this.edge()) return;
    this.tri(this.a, this.ea, r, g, b);
    this.tri(this.eb, this.b, r, g, b);
  }

  private ray(r: number, g: number, b: number, k: number) {
    if (this.rays.full()) return;
    const s = this.rays, o = this.proj.pos;
    s.vert(0, o[0], o[1], o[2], r * k, g * k, b * k);
    s.vert(1, this.b[0], this.b[1], this.b[2], r * k, g * k, b * k);
    s.count++;
  }

  // 物に当たった所の光。当たっていなければ描かない
  private spot(r: number, g: number, b: number, k: number) {
    const ta = this.ta, tb = this.tb;
    if (!Number.isFinite(ta) && !Number.isFinite(tb)) return;
    k *= Math.exp(-this.ext * ((Number.isFinite(ta) ? ta : tb) + (Number.isFinite(tb) ? tb : ta)) / 2);
    if (!this.split(ta, this.ia, tb, this.ib)) {
      // 面の上の光は、へこんだ角で必ず折り曲げる（まっすぐ引くと角を空中で横切る）
      if (this.ia === this.ib) { this.line(this.a, this.b, r * k, g * k, b * k); return; }
      if (this.bend()) {
        this.line(this.a, this.c, r * k, g * k, b * k);
        this.line(this.c, this.b, r * k, g * k, b * k);
        return;
      }
      if (!this.edge(true)) return;
      this.line(this.a, this.ea, r * k, g * k, b * k);
      this.line(this.eb, this.b, r * k, g * k, b * k);
      return;
    }
    // 縁をまたぐときは、縁の両側で別々に引く（何にも当たらない側は引かない）。
    // 面の上の光は、へこんだ角も含めて必ず境目で分ける（まっすぐつなぐと空中を横切る）
    if (!this.edge(true)) return;
    if (Number.isFinite(ta)) this.line(this.a, this.ea, r * k, g * k, b * k);
    if (Number.isFinite(tb)) this.line(this.eb, this.b, r * k, g * k, b * k);
  }

  private line(p: number[], q: number[], r: number, g: number, b: number) {
    if (this.wall.full()) return;
    // 面の上にそのまま置く（面と重ならないようにするのは、描くときにカメラ側へずらして行う）
    const s = this.wall;
    s.vert(0, p[0], p[1], p[2], r, g, b);
    s.vert(1, q[0], q[1], q[2], r, g, b);
    s.count++;
  }

  private setAge(a: number) {
    this.sheets.curAge = this.rays.curAge = this.wall.curAge = a;
  }

  // スキャン: 露光時間内に通った軌跡。遅く動いた所ほど明るい（2D出力と同じ考え方）
  private scanOne(w: ScanWindow, s: BeamSettings, tau: number) {
    const isExp = s.exposureShape === 'exp';
    const roll = this.rig.roll;
    const dt = 1 / s.pps;
    const haze = this.rig.haze * s.bright;
    // 新しい順に並んでいるので、古い方から1区間ずつ
    for (let k = w.count - 1; k >= 1; k--) {
      const j = k, i = k - 1;
      if (!w.on[i]) continue;
      const age = w.age[i] / tau;
      const wt = isExp && !roll ? Math.exp(-age) : 1;
      const e = wt * dt / tau;
      this.setAge(roll ? age : -1);
      const r = w.r[i] / 255 * this.gain[0], g = w.g[i] / 255 * this.gain[1], b = w.b[i] / 255 * this.gain[2];
      const d = Math.hypot(w.x[i] - w.x[j], w.y[i] - w.y[j]);
      this.ends(j, w.x[j], w.y[j], w.x[i], w.y[i], i);
      // ほとんど動いていない間は1本のビーム、動いている間は光の膜
      if (d < 0.004) this.ray(r, g, b, e * haze * 40);
      else this.sheet(r, g, b, e / d * haze * 0.12);
      this.spot(r, g, b, 0.8);
    }
  }

  // ベクター: 今のフレームの図形をそのまま、均一な明るさで
  private frameOne(f: FramePoints, s: BeamSettings) {
    // ベクターには時刻がないので、ローリングシャッターは効かない
    this.setAge(-1);
    const haze = this.rig.haze * s.bright;
    let total = 0;
    for (let i = 1; i < f.length; i++) {
      if (f.on[i]) total += Math.hypot(f.x[i] - f.x[i - 1], f.y[i] - f.y[i - 1]);
    }
    const density = haze * 0.12 / Math.max(total, 0.5);
    let prevLit = false;
    for (let i = 1; i < f.length; i++) {
      if (!f.on[i]) { prevLit = false; continue; }
      const r = f.r[i] / 255 * this.gain[0], g = f.g[i] / 255 * this.gain[1], b = f.b[i] / 255 * this.gain[2];
      const d = Math.hypot(f.x[i] - f.x[i - 1], f.y[i] - f.y[i - 1]);
      if (d > 1e-3) {
        this.ends(i - 1, f.x[i - 1], f.y[i - 1], f.x[i], f.y[i], i);
        this.sheet(r, g, b, density);
        this.spot(r, g, b, 0.8);
        prevLit = true;
      } else if (!prevLit) {
        this.ends(i - 1, f.x[i - 1], f.y[i - 1], f.x[i], f.y[i], i);
        this.ray(r, g, b, haze * 0.3);
        prevLit = true;
      }
    }
  }
}
