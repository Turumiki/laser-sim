import {
  BoxGeometry, CylinderGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, SphereGeometry, Vector3,
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
// floor: プロジェクターの床からの高さ、depth: 選んだときの奥行き（壁までの距離）
export interface Room { width: number; height: number; floor: number; depth: number }
export const ROOMS: Partial<Record<TargetKind, Room>> = {
  // 2000席くらいのホール。プロジェクターはステージ上
  hall: { width: 30, height: 16, floor: 3, depth: 45 },
  // 大きめの屋内アリーナ。プロジェクターはトラス上
  arena: { width: 70, height: 30, floor: 5, depth: 110 },
};
const DEFAULT_FLOOR = 2.2;
const material = new MeshBasicMaterial({ color: 0x161616 });

// ビームが当たる物。プロジェクターは原点で -z 方向を向いている。
// 毎フレーム数千本を調べるので、汎用の当たり判定ではなく形ごとに式で解く
export class Surfaces {
  readonly group = new Group();
  private kind: TargetKind = 'wall';
  private d = 8;
  private room: Room | null = null;
  // プロジェクターから床までの高さ
  floor = DEFAULT_FLOOR;
  // 物体の置き場所（壁の手前）と大きさ
  private center = 6;
  private size = 1.2;
  // 立方体は少し傾けて置くので、レイを立方体の向きに直す行列
  private toCube = new Matrix4();
  private v = new Vector3();
  private o = new Vector3();

  build(kind: TargetKind, distance: number) {
    this.kind = kind;
    this.d = distance;
    this.room = ROOMS[kind] ?? null;
    this.floor = this.room?.floor ?? DEFAULT_FLOOR;
    this.center = distance * 0.72;
    this.size = distance * 0.16;
    this.group.clear();
    if (kind === 'none') return;

    // 壁や床は、ビームが端からはみ出さないよう距離に合わせて大きくする
    const w = Math.max(60, distance * 8), h = Math.max(30, distance * 4);
    const wall = new Mesh(new PlaneGeometry(w, h), material);
    wall.position.z = -distance - 0.01;
    const floor = new Mesh(new PlaneGeometry(w, w), material);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -this.floor - 0.01;
    this.group.add(wall, floor);

    if (this.room) {
      const { width, height } = this.room;
      const ceil = new Mesh(new PlaneGeometry(width, w), material);
      ceil.rotation.x = Math.PI / 2;
      ceil.position.y = height - this.floor + 0.01;
      const left = new Mesh(new PlaneGeometry(w, h), material);
      left.rotation.y = Math.PI / 2;
      left.position.x = -width / 2 - 0.01;
      const right = new Mesh(new PlaneGeometry(w, h), material);
      right.rotation.y = -Math.PI / 2;
      right.position.x = width / 2 + 0.01;
      this.group.add(ceil, left, right);
    }

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
    const [ox, oy, oz] = o, [dx, dy, dz] = d;
    const plane = (p: number, v: number, target: number) => {
      if (Math.abs(v) < 1e-9) return Infinity;
      const t = (target - p) / v;
      return t > 1e-6 ? t : Infinity;
    };
    let t = plane(oz, dz, -this.d);
    t = Math.min(t, plane(oy, dy, -this.floor));
    if (this.room) {
      const { width, height } = this.room;
      t = Math.min(t, plane(oy, dy, height - this.floor), plane(ox, dx, -width / 2), plane(ox, dx, width / 2));
    }
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
