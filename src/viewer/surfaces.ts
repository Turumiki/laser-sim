import {
  BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, DoubleSide, Group, LineBasicMaterial, LineSegments, Matrix4,
  Mesh, MeshBasicMaterial, PlaneGeometry, SphereGeometry, Vector3,
} from 'three';

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
// stage: プロジェクターより後ろ（ステージ側）の奥行き、stands: 客席の段（アリーナのスタンド）
export interface Room {
  width: number;
  height: number;
  floor: number;
  depth: number;
  stage: number;
  stands?: { inset: number; height: number };
}
export const ROOMS: Partial<Record<TargetKind, Room>> = {
  // 2000席くらいのホール。プロジェクターはステージの前の方
  hall: { width: 30, height: 16, floor: 3, depth: 45, stage: 12 },
  // 大きめの屋内アリーナ。プロジェクターはトラス上。左右と奥にスタンド
  arena: { width: 70, height: 30, floor: 5, depth: 110, stage: 18, stands: { inset: 12, height: 12 } },
};
const DEFAULT_FLOOR = 2.2;
const material = new MeshBasicMaterial({ color: 0x161616 });
const roomMaterial = new MeshBasicMaterial({ color: 0x161616, side: DoubleSide });
const standMaterial = new MeshBasicMaterial({ color: 0x1d1d1d, side: DoubleSide });
// 暗い会場でも形が分かるよう、面の縁に薄く線を引く
const edgeMaterial = new LineBasicMaterial({ color: 0x333333 });

// 長方形の面。点 = p + a*u + b*v（0≦a,b≦1、u と v は直交）
interface Quad {
  p: number[];
  u: number[];
  v: number[];
  stand?: boolean;
  // 当たり判定用に前もって計算しておく値（法線、n・p、|u|²、|v|²）
  n?: number[];
  np?: number;
  uu?: number;
  vv?: number;
}

const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// 会場を長方形の組み合わせで作る。見た目と当たり判定に同じものを使う
function roomQuads(r: Room, depth: number): Quad[] {
  const y0 = -r.floor, y1 = r.height - r.floor, z0 = r.stage, z1 = -depth;
  const xl = -r.width / 2, W = r.width, H = r.height, L = z1 - z0;
  const q: Quad[] = [
    { p: [xl, y1, z0], u: [W, 0, 0], v: [0, 0, L] },
    { p: [xl, y0, z0], u: [W, 0, 0], v: [0, H, 0] },
  ];
  const s = r.stands;
  if (!s) {
    q.push(
      { p: [xl, y0, z0], u: [W, 0, 0], v: [0, 0, L] },
      { p: [xl, y0, z0], u: [0, 0, L], v: [0, H, 0] },
      { p: [-xl, y0, z0], u: [0, 0, L], v: [0, H, 0] },
      { p: [xl, y0, z1], u: [W, 0, 0], v: [0, H, 0] },
    );
    return q;
  }
  // スタンド付き：床は内側だけ。左右と奥に斜めの客席、その上に壁
  const i = s.inset, sh = s.height, ys = y0 + sh;
  q.push(
    { p: [xl + i, y0, z0], u: [W - 2 * i, 0, 0], v: [0, 0, L + i] },
    { p: [xl + i, y0, z0], u: [0, 0, L], v: [-i, sh, 0], stand: true },
    { p: [-xl - i, y0, z0], u: [0, 0, L], v: [i, sh, 0], stand: true },
    { p: [xl, y0, z1 + i], u: [W, 0, 0], v: [0, sh, -i], stand: true },
    { p: [xl, ys, z0], u: [0, 0, L], v: [0, H - sh, 0] },
    { p: [-xl, ys, z0], u: [0, 0, L], v: [0, H - sh, 0] },
    { p: [xl, ys, z1], u: [W, 0, 0], v: [0, H - sh, 0] },
  );
  return q;
}

function quadMesh(q: Quad) {
  const { p, u, v } = q;
  const c = (a: number, b: number) => [p[0] + u[0] * a + v[0] * b, p[1] + u[1] * a + v[1] * b, p[2] + u[2] * a + v[2] * b];
  const pts = [c(0, 0), c(1, 0), c(1, 1), c(0, 0), c(1, 1), c(0, 1)].flat();
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
  const edges = new BufferGeometry();
  edges.setAttribute('position', new BufferAttribute(new Float32Array(
    [c(0, 0), c(1, 0), c(1, 0), c(1, 1), c(1, 1), c(0, 1), c(0, 1), c(0, 0)].flat()), 3));
  const g = new Group();
  g.add(new Mesh(geo, q.stand ? standMaterial : roomMaterial), new LineSegments(edges, edgeMaterial));
  return g;
}

// ビームが当たる物。プロジェクターは原点で -z 方向を向いている。
// 毎フレーム数千本を調べるので、汎用の当たり判定ではなく形ごとに式で解く
export class Surfaces {
  readonly group = new Group();
  private kind: TargetKind = 'wall';
  private d = 8;
  private room: Room | null = null;
  private quads: Quad[] = [];
  // プロジェクターから床までの高さ
  floor = DEFAULT_FLOOR;
  // 物体の置き場所（壁の手前）と大きさ
  private center = 6;
  private size = 1.2;
  // 立方体は少し傾けて置くので、レイを立方体の向きに直す行列
  private toCube = new Matrix4();
  private v = new Vector3();
  private o = new Vector3();
  private w = [0, 0, 0];

  build(kind: TargetKind, distance: number) {
    this.kind = kind;
    this.d = distance;
    this.room = ROOMS[kind] ?? null;
    this.floor = this.room?.floor ?? DEFAULT_FLOOR;
    this.center = distance * 0.72;
    this.size = distance * 0.16;
    // 前の形が持っていたGPUのメモリを手放してから作り直す
    this.group.traverse(o => {
      if (o !== this.group && 'geometry' in o) (o as Mesh).geometry.dispose();
    });
    this.group.clear();
    this.quads = [];
    if (kind === 'none') return;
    if (this.room) {
      this.quads = roomQuads(this.room, distance);
      for (const q of this.quads) {
        q.n = cross(q.u, q.v);
        q.np = dot(q.n, q.p);
        q.uu = dot(q.u, q.u);
        q.vv = dot(q.v, q.v);
      }
      for (const q of this.quads) this.group.add(quadMesh(q));
      return;
    }

    // 壁や床は、ビームが端からはみ出さないよう距離に合わせて大きくする
    const w = Math.max(60, distance * 8), h = Math.max(30, distance * 4);
    const wall = new Mesh(new PlaneGeometry(w, h), material);
    wall.position.z = -distance - 0.01;
    const floor = new Mesh(new PlaneGeometry(w, w), material);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -this.floor - 0.01;
    this.group.add(wall, floor);

    if (kind === 'corner') {
      const side = new Mesh(new PlaneGeometry(w, h), material);
      side.rotation.y = Math.PI / 2;
      side.position.x = -this.sideX() - 0.01;
      this.group.add(side);
    }
    if (kind === 'sphere') {
      const m = new Mesh(new SphereGeometry(this.size, 48, 32), material);
      m.position.z = -this.center;
      this.group.add(m);
    }
    if (kind === 'cube') {
      const m = new Mesh(new BoxGeometry(this.size * 1.6, this.size * 1.6, this.size * 1.6), material);
      m.position.z = -this.center;
      m.rotation.set(0.35, 0.6, 0);
      m.updateMatrix();
      this.toCube.copy(m.matrix).invert();
      this.group.add(m);
    }
    if (kind === 'cylinder') {
      const m = new Mesh(new CylinderGeometry(this.size, this.size, this.size * 3, 48), material);
      m.position.z = -this.center;
      this.group.add(m);
    }
  }

  private sideX() {
    return this.d * 0.6;
  }

  // 点 o から方向 d へ飛ぶ光が最初に当たる所。o + d * t の t を返す（何にも当たらなければ Infinity）
  hit(o: readonly number[], d: readonly number[]): number {
    if (this.kind === 'none') return Infinity;
    if (this.room) return this.hitQuads(o, d);
    const [ox, oy, oz] = o, [dx, dy, dz] = d;
    const plane = (p: number, v: number, target: number) => {
      if (Math.abs(v) < 1e-9) return Infinity;
      const t = (target - p) / v;
      return t > 1e-6 ? t : Infinity;
    };
    let t = plane(oz, dz, -this.d);
    t = Math.min(t, plane(oy, dy, -this.floor));
    switch (this.kind) {
      case 'corner':
        t = Math.min(t, plane(ox, dx, -this.sideX()));
        break;
      case 'sphere':
        t = Math.min(t, this.sphere(o, d));
        break;
      case 'cube':
        t = Math.min(t, this.cube(o, d));
        break;
      case 'cylinder':
        t = Math.min(t, this.cylinder(o, d));
        break;
    }
    return t;
  }

  private hitQuads(o: readonly number[], d: readonly number[]) {
    let best = Infinity;
    const w = this.w;
    for (const q of this.quads) {
      const n = q.n!, den = dot(n, d);
      if (Math.abs(den) < 1e-12) continue;
      const t = (q.np! - dot(n, o)) / den;
      if (t <= 1e-6 || t >= best) continue;
      for (let k = 0; k < 3; k++) w[k] = o[k] + d[k] * t - q.p[k];
      const a = dot(w, q.u) / q.uu!, b = dot(w, q.v) / q.vv!;
      if (a >= 0 && a <= 1 && b >= 0 && b <= 1) best = t;
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
    const lo = this.o.set(o[0], o[1], o[2]).applyMatrix4(this.toCube);
    const len = Math.hypot(d[0], d[1], d[2]);
    const v = this.v.set(d[0], d[1], d[2]).transformDirection(this.toCube).multiplyScalar(len);
    const h = this.size * 0.8;
    let near = -Infinity, far = Infinity;
    for (const k of ['x', 'y', 'z'] as const) {
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
