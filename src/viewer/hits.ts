import { arenaPolys, hallPolys, type Poly } from './venues';

// ビームが当たる物の形と、当たり判定。three.js を使わないので、Worker（別スレッド）でもそのまま動く。
// プロジェクターは原点で -z 方向を向いている。毎フレーム数千本を調べるので、汎用の当たり判定ではなく形ごとに式で解く

export type TargetKind = 'wall' | 'sphere' | 'cube' | 'cylinder' | 'corner' | 'hall' | 'arena' | 'none';

export const TARGETS: readonly { id: TargetKind; label: string }[] = [
  { id: 'wall', label: '壁' },
  { id: 'sphere', label: '球' },
  { id: 'cube', label: '立方体' },
  { id: 'cylinder', label: '円柱' },
  { id: 'corner', label: '部屋の角' },
  { id: 'hall', label: 'コンサートホール' },
  { id: 'arena', label: 'アリーナ' },
  { id: 'none', label: 'なし（ヘイズのみ）' },
];

// 会場の大きさ（m）。実際の会場を参考にしたおおよその値
// floor: プロジェクターの床からの高さ、depth: 選んだときの奥行き（壁までの距離）、
// stage: プロジェクターより後ろ（ステージ側）の奥行き。細かい形は venues.ts
export interface Room {
  width: number;
  height: number;
  floor: number;
  depth: number;
  stage: number;
}
export const ROOMS: Partial<Record<TargetKind, Room>> = {
  // 2000席くらいのホール。プロジェクターはステージの前の方
  hall: { width: 30, height: 16, floor: 3, depth: 45, stage: 12 },
  // 1万〜1万5千人規模の屋内アリーナ（エンドステージ）。幅と高さはスタンドの外側まで
  arena: { width: 100, height: 34, floor: 5, depth: 110, stage: 18 },
};
export const DEFAULT_FLOOR = 2.2;
// 立方体を置くときの傾き（x軸・y軸まわり、rad）
export const CUBE_TILT = [0.35, 0.6] as const;

export const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: readonly number[], b: readonly number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const sub = (a: readonly number[], b: readonly number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

// 当たり判定用の三角形（Möller–Trumbore 法で解くための値を前もって持つ）
interface Tri { a: number[]; e1: number[]; e2: number[]; id: number }

// 三角形と光線の交点（Möller–Trumbore 法）。当たらなければ -1
function rayTri(t: Tri, o: readonly number[], d: readonly number[], p: number[]) {
  const { a, e1, e2 } = t;
  p[0] = d[1] * e2[2] - d[2] * e2[1]; p[1] = d[2] * e2[0] - d[0] * e2[2]; p[2] = d[0] * e2[1] - d[1] * e2[0];
  const det = dot(e1, p);
  if (Math.abs(det) < 1e-12) return -1;
  const inv = 1 / det;
  const sx = o[0] - a[0], sy = o[1] - a[1], sz = o[2] - a[2];
  const u = (sx * p[0] + sy * p[1] + sz * p[2]) * inv;
  if (u < 0 || u > 1) return -1;
  const qx = sy * e1[2] - sz * e1[1], qy = sz * e1[0] - sx * e1[2], qz = sx * e1[1] - sy * e1[0];
  const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
  if (v < 0 || u + v > 1) return -1;
  const dist = (e2[0] * qx + e2[1] * qy + e2[2] * qz) * inv;
  return dist > 1e-6 ? dist : -1;
}

// 多角形を、表が toward を向く順に並べ直す
export function facingPts(p: Poly) {
  const n = cross(sub(p.pts[1], p.pts[0]), sub(p.pts[2], p.pts[0]));
  return dot(n, sub(p.toward, p.pts[0])) >= 0 ? p.pts : p.pts.slice().reverse();
}

// ビームの側から当たり判定に使う部分
export interface HitTarget {
  // 形を作り直すたびに増える（ビーム側の当たり方の覚え書きを捨てる合図）
  readonly version: number;
  // 平らな面だけでできている（会場）。面の番号が分かれば平面との交点だけで当たる位置が出せる
  readonly planar: boolean;
  // 最後に hit で当たった面の番号（-1: 何にも当たらない）
  readonly lastId: number;
  hit(o: readonly number[], d: readonly number[]): number;
  hitPlane(id: number, o: readonly number[], d: readonly number[]): number;
  concave(a: number, b: number): boolean;
  // 会場の面の数と、面の頂点（表を内側に向けた順）
  readonly polyCount: number;
  polyPoints(id: number): readonly (readonly number[])[];
  // 決まった面の中だけで当たりを探す（候補を絞れているとき用。lastId は hit と同じ）
  hitAmong(ids: readonly number[], o: readonly number[], d: readonly number[]): number;
}

export class Hits implements HitTarget {
  version = 0;
  lastId = -1;
  kind: TargetKind = 'wall';
  d = 8;
  room: Room | null = null;
  // 会場の面（表を内側に向けた順に並べ直したもの）
  polys: Poly[] = [];
  // プロジェクターから床までの高さ
  floor = DEFAULT_FLOOR;
  // 物体の置き場所（壁の手前）と大きさ
  center = 6;
  size = 1.2;
  private tris: Tri[] = [];
  // 面ごとの三角形
  private trisOf: Tri[][] = [];
  private planes: { n: number[]; np: number }[] = [];
  private polyPts: number[][][] = [];
  private concaveMemo = new Map<number, boolean>();
  // 立方体の向きに直す回転（傾けた回転の逆）
  private cubeRot = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  private w = [0, 0, 0];

  get planar() {
    return !!this.room;
  }

  build(kind: TargetKind, distance: number) {
    this.version++;
    this.kind = kind;
    this.d = distance;
    this.room = ROOMS[kind] ?? null;
    this.floor = this.room?.floor ?? DEFAULT_FLOOR;
    this.center = distance * 0.72;
    this.size = distance * 0.16;
    this.tris = [];
    this.trisOf = [];
    this.planes = [];
    this.polyPts = [];
    this.concaveMemo.clear();
    this.polys = [];
    if (this.room && kind !== 'none') {
      this.polys = kind === 'arena' ? arenaPolys(this.room, distance) : hallPolys(this.room, distance);
      this.polys.forEach((p, id) => {
        const pts = facingPts(p);
        const n = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]));
        this.planes[id] = { n, np: dot(n, pts[0]) };
        this.polyPts[id] = pts;
        const list: Tri[] = this.trisOf[id] = [];
        for (let i = 1; i < pts.length - 1; i++) list.push({ a: pts[0], e1: sub(pts[i], pts[0]), e2: sub(pts[i + 1], pts[0]), id });
        this.tris.push(...list);
      });
    }
    // 立方体は x軸まわりに傾けてから y軸まわりに回した向き（three.js の rotation.set(x, y, 0) と同じ）。その逆回転
    const [ax, ay] = CUBE_TILT, cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay);
    // R = Rx·Ry。逆は転置
    const R = [cy, 0, sy, sx * sy, cx, -sx * cy, -cx * sy, sx, cx * cy];
    this.cubeRot = [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]];
  }

  get polyCount() {
    return this.polyPts.length;
  }

  polyPoints(id: number) {
    return this.polyPts[id];
  }

  hitAmong(ids: readonly number[], o: readonly number[], d: readonly number[]) {
    let best = Infinity;
    this.lastId = -1;
    for (const id of ids) {
      for (const t of this.trisOf[id]) {
        const dist = rayTri(t, o, d, this.w);
        if (dist > 0 && dist < best) { best = dist; this.lastId = id; }
      }
    }
    return best;
  }

  sideX() {
    return this.d * 0.6;
  }

  // 2つの面が「へこんだ角」でつながっているか（床と壁、床と客席の段など）。
  // へこんだ角なら、両方に当たった2本のビームの間を膜でそのままつないでも、物の中を通らない。
  // それぞれの面の表側に、もう一方の面の点があれば、へこんだ角とみなす
  concave(a: number, b: number) {
    if (a < 0 || b < 0 || !this.planes[a] || !this.planes[b]) return false;
    const key = a < b ? a * 65536 + b : b * 65536 + a;
    let v = this.concaveMemo.get(key);
    if (v === undefined) {
      const front = (p: number, q: number) => {
        const pl = this.planes[p], len = Math.hypot(pl.n[0], pl.n[1], pl.n[2]);
        return this.polyPts[q].some(v => (dot(pl.n, v) - pl.np) / len > 0.05);
      };
      v = front(a, b) && front(b, a);
      this.concaveMemo.set(key, v);
    }
    return v;
  }

  // 面 id の平面に当たるまでの t（向こう向きなら Infinity）
  hitPlane(id: number, o: readonly number[], d: readonly number[]) {
    const pl = this.planes[id];
    if (!pl) return Infinity;
    const den = dot(pl.n, d);
    if (Math.abs(den) < 1e-12) return Infinity;
    const t = (pl.np - dot(pl.n, o)) / den;
    return t > 1e-6 ? t : Infinity;
  }

  // 点 o から方向 d へ飛ぶ光が最初に当たる所。o + d * t の t を返す（何にも当たらなければ Infinity）
  hit(o: readonly number[], d: readonly number[]): number {
    this.lastId = -1;
    if (this.kind === 'none') return Infinity;
    if (this.room) return this.hitTris(o, d);
    const [ox, oy, oz] = o, [dx, dy, dz] = d;
    const plane = (p: number, v: number, target: number) => {
      if (Math.abs(v) < 1e-9) return Infinity;
      const t = (target - p) / v;
      return t > 1e-6 ? t : Infinity;
    };
    // 面ごとに番号を付ける（0: 壁、1: 床、2: 横の壁、3: 物）
    let t = Infinity;
    const take = (v: number, id: number) => { if (v < t) { t = v; this.lastId = id; } };
    take(plane(oz, dz, -this.d), 0);
    take(plane(oy, dy, -this.floor), 1);
    switch (this.kind) {
      case 'corner':
        take(plane(ox, dx, -this.sideX()), 2);
        break;
      case 'sphere':
        take(this.sphere(o, d), 3);
        break;
      case 'cube':
        // 立方体は面ごとに分けない（角では奥行きの差で分かれる）
        take(this.cube(o, d), 3);
        break;
      case 'cylinder':
        take(this.cylinder(o, d), 3);
        break;
    }
    return t;
  }

  private hitTris(o: readonly number[], d: readonly number[]) {
    let best = Infinity;
    for (const t of this.tris) {
      const dist = rayTri(t, o, d, this.w);
      if (dist > 0 && dist < best) { best = dist; this.lastId = t.id; }
    }
    return best;
  }

  private sphere(o: readonly number[], d: readonly number[]) {
    const R = this.size;
    const cx = o[0], cy = o[1], cz = o[2] + this.center;
    const a = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    const b = 2 * (cx * d[0] + cy * d[1] + cz * d[2]);
    const c = cx * cx + cy * cy + cz * cz - R * R;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return Infinity;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    return t > 1e-6 ? t : Infinity;
  }

  private cube(o: readonly number[], d: readonly number[]) {
    // 立方体の向きに直してから、軸に沿った箱として解く（スラブ法）
    const M = this.cubeRot;
    const px = o[0], py = o[1], pz = o[2] + this.center;
    const lo = [M[0] * px + M[1] * py + M[2] * pz, M[3] * px + M[4] * py + M[5] * pz, M[6] * px + M[7] * py + M[8] * pz];
    const v = [M[0] * d[0] + M[1] * d[1] + M[2] * d[2], M[3] * d[0] + M[4] * d[1] + M[5] * d[2], M[6] * d[0] + M[7] * d[1] + M[8] * d[2]];
    const h = this.size * 0.8;
    let near = -Infinity, far = Infinity;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(v[k]) < 1e-9) {
        if (Math.abs(lo[k]) > h) return Infinity;
        continue;
      }
      let t1 = (-h - lo[k]) / v[k], t2 = (h - lo[k]) / v[k];
      if (t1 > t2) [t1, t2] = [t2, t1];
      near = Math.max(near, t1);
      far = Math.min(far, t2);
    }
    return near <= far && near > 1e-6 ? near : Infinity;
  }

  private cylinder(o: readonly number[], d: readonly number[]) {
    const R = this.size, half = this.size * 1.5;
    const px = o[0], pz = o[2] + this.center;
    let best = Infinity;
    // 側面（縦向きの円柱。xz平面で円と交わるか）
    const a = d[0] * d[0] + d[2] * d[2];
    const b = 2 * (px * d[0] + pz * d[2]);
    const c = px * px + pz * pz - R * R;
    const disc = b * b - 4 * a * c;
    if (a > 1e-12 && disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / (2 * a);
      if (t > 1e-6 && Math.abs(o[1] + d[1] * t) <= half) best = t;
    }
    // 上下のふた
    if (Math.abs(d[1]) > 1e-9) {
      for (const y of [half, -half]) {
        const t = (y - o[1]) / d[1];
        if (t > 1e-6 && t < best && (px + d[0] * t) ** 2 + (pz + d[2] * t) ** 2 <= R * R) best = t;
      }
    }
    return best;
  }
}
