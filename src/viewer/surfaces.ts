import { arenaPolys, arenaTruss, hallPolys, type Material as VenueMaterial, type Poly } from './venues';
import {
  BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, Group, LineBasicMaterial, LineSegments, Matrix4,
  Mesh, MeshLambertMaterial, PlaneGeometry, SphereGeometry, Vector3,
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
const DEFAULT_FLOOR = 2.2;
// 面は作業灯（ビューアの明かり）で照らす。向きで明るさが変わるので、床・壁・天井の区別が付く
const material = new MeshLambertMaterial({ color: 0x8c8c8c });
const MATERIALS: Record<VenueMaterial, MeshLambertMaterial> = {
  room: new MeshLambertMaterial({ color: 0x8c8c8c }),
  stand: new MeshLambertMaterial({ color: 0xa0a0a0 }),
  stage: new MeshLambertMaterial({ color: 0x7c7c7c }),
  // スクリーンや機材は暗め（真っ黒だと形が見えないので少し明るく）
  screen: new MeshLambertMaterial({ color: 0x4a4a4a }),
  gear: new MeshLambertMaterial({ color: 0x5a5a5a }),
};
// 暗い会場でも形が分かるよう、面の縁に薄く線を引く（作業灯が明るいほど濃く）
const edgeMaterial = new LineBasicMaterial({ color: 0x333333 });
export function setEdgeLevel(k: number) {
  edgeMaterial.color.setScalar(0.2 + 0.25 * k);
}

const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: readonly number[], b: readonly number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a: readonly number[], b: readonly number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

// 当たり判定用の三角形（Möller–Trumbore 法で解くための値を前もって持つ）
interface Tri { a: number[]; e1: number[]; e2: number[]; id: number }

// 多角形を、表が toward を向く順に並べ直す
function facingPts(p: Poly) {
  const n = cross(sub(p.pts[1], p.pts[0]), sub(p.pts[2], p.pts[0]));
  return dot(n, sub(p.toward, p.pts[0])) >= 0 ? p.pts : p.pts.slice().reverse();
}

// ビームが当たる物。プロジェクターは原点で -z 方向を向いている。
// 毎フレーム数千本を調べるので、汎用の当たり判定ではなく形ごとに式で解く
export class Surfaces {
  // 会場の面ごとの、表の向きと縁の線
  private facing: { lines: LineSegments; n: number[]; mid: number[] }[] = [];

  // カメラから見て裏を向いている面の縁を隠す（面そのものは裏面を描かない設定で消える）
  updateFacing(cam: { x: number; y: number; z: number }) {
    for (const f of this.facing) {
      f.lines.visible = f.n[0] * (cam.x - f.mid[0]) + f.n[1] * (cam.y - f.mid[1]) + f.n[2] * (cam.z - f.mid[2]) > 0;
    }
  }

  readonly group = new Group();
  private kind: TargetKind = 'wall';
  private d = 8;
  private room: Room | null = null;
  private tris: Tri[] = [];
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
    this.tris = [];
    this.facing = [];
    if (kind === 'none') return;
    if (this.room) {
      this.buildVenue(kind === 'arena' ? arenaPolys(this.room, distance) : hallPolys(this.room, distance));
      if (kind === 'arena') {
        const geo = new BufferGeometry();
        geo.setAttribute('position', new BufferAttribute(new Float32Array(arenaTruss(this.room, distance)), 3));
        this.group.add(new LineSegments(geo, edgeMaterial));
      }
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

  // 会場の面を、材質ごとに1つのメッシュにまとめる。縁の線は面ごと（裏向きのとき隠すため）
  private buildVenue(polys: Poly[]) {
    const byMat = new Map<VenueMaterial, number[]>();
    polys.forEach((p, id) => {
      const pts = facingPts(p);
      const list = byMat.get(p.mat) ?? [];
      byMat.set(p.mat, list);
      for (let i = 1; i < pts.length - 1; i++) {
        list.push(...pts[0], ...pts[i], ...pts[i + 1]);
        this.tris.push({ a: pts[0], e1: sub(pts[i], pts[0]), e2: sub(pts[i + 1], pts[0]), id });
      }
      const edge: number[] = [];
      for (let i = 0; i < pts.length; i++) edge.push(...pts[i], ...pts[(i + 1) % pts.length]);
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(new Float32Array(edge), 3));
      const lines = new LineSegments(geo, edgeMaterial);
      this.group.add(lines);
      const mid = [0, 1, 2].map(k => pts.reduce((sum, q) => sum + q[k], 0) / pts.length);
      this.facing.push({ lines, n: cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])), mid });
    });
    for (const [mat, list] of byMat) {
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(new Float32Array(list), 3));
      geo.computeVertexNormals();
      this.group.add(new Mesh(geo, MATERIALS[mat]));
    }
  }

  private sideX() {
    return this.d * 0.6;
  }

  // 点 o から方向 d へ飛ぶ光が最初に当たる所。o + d * t の t を返す（何にも当たらなければ Infinity）
  // 最後に hit で当たった面の番号（別の面に当たった2本のビームの間は、膜をそのままつながない）
  lastId = -1;

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
    const p = this.w;
    for (const t of this.tris) {
      const { a, e1, e2 } = t;
      // p = d × e2
      p[0] = d[1] * e2[2] - d[2] * e2[1]; p[1] = d[2] * e2[0] - d[0] * e2[2]; p[2] = d[0] * e2[1] - d[1] * e2[0];
      const det = dot(e1, p);
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det;
      const sx = o[0] - a[0], sy = o[1] - a[1], sz = o[2] - a[2];
      const u = (sx * p[0] + sy * p[1] + sz * p[2]) * inv;
      if (u < 0 || u > 1) continue;
      // q = s × e1
      const qx = sy * e1[2] - sz * e1[1], qy = sz * e1[0] - sx * e1[2], qz = sx * e1[1] - sy * e1[0];
      const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      const dist = (e2[0] * qx + e2[1] * qy + e2[2] * qz) * inv;
      if (dist > 1e-6 && dist < best) { best = dist; this.lastId = t.id; }
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
