import {
  BoxGeometry, CylinderGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, SphereGeometry, Vector3,
} from 'three';

export type TargetKind = 'wall' | 'sphere' | 'cube' | 'cylinder' | 'corner' | 'none';

export const TARGETS: readonly { id: TargetKind; label: string }[] = [
  { id: 'wall', label: '壁' },
  { id: 'sphere', label: '球' },
  { id: 'cube', label: '立方体' },
  { id: 'cylinder', label: '円柱' },
  { id: 'corner', label: '部屋の角' },
  { id: 'none', label: 'なし（ヘイズのみ）' },
];

const FLOOR = 2.2;
const material = new MeshBasicMaterial({ color: 0x161616 });

// ビームが当たる物。プロジェクターは原点で -z 方向を向いている。
// レイは v = (tx, ty, -1) と置き、当たった点を v * t で表す（t はそのまま奥行きになる）。
// 毎フレーム数千本を調べるので、汎用の当たり判定ではなく形ごとに式で解く
export class Surfaces {
  readonly group = new Group();
  private kind: TargetKind = 'wall';
  private d = 8;
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
    floor.position.y = -FLOOR - 0.01;
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

  // 何にも当たらなければ Infinity
  hit(tx: number, ty: number): number {
    if (this.kind === 'none') return Infinity;
    let t = this.d;
    if (ty < 0) t = Math.min(t, FLOOR / -ty);
    switch (this.kind) {
      case 'corner':
        if (tx < 0) t = Math.min(t, this.sideX() / -tx);
        break;
      case 'sphere':
        t = Math.min(t, this.sphere(tx, ty));
        break;
      case 'cube':
        t = Math.min(t, this.cube(tx, ty));
        break;
      case 'cylinder':
        t = Math.min(t, this.cylinder(tx, ty));
        break;
    }
    return t;
  }

  private sphere(tx: number, ty: number) {
    const S = this.center, R = this.size;
    const a = tx * tx + ty * ty + 1, b = -2 * S, c = S * S - R * R;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return Infinity;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    return t > 0 ? t : Infinity;
  }

  private cube(tx: number, ty: number) {
    // 立方体の向きに直してから、軸に沿った箱として解く（スラブ法）
    const o = this.o.set(0, 0, 0).applyMatrix4(this.toCube);
    const v = this.v.set(tx, ty, -1).transformDirection(this.toCube).multiplyScalar(Math.hypot(tx, ty, 1));
    const h = this.size * 0.8;
    let near = -Infinity, far = Infinity;
    for (const k of ['x', 'y', 'z'] as const) {
      if (Math.abs(v[k]) < 1e-9) {
        if (Math.abs(o[k]) > h) return Infinity;
        continue;
      }
      let t1 = (-h - o[k]) / v[k], t2 = (h - o[k]) / v[k];
      if (t1 > t2) [t1, t2] = [t2, t1];
      near = Math.max(near, t1);
      far = Math.min(far, t2);
    }
    return near <= far && near > 0 ? near : Infinity;
  }

  private cylinder(tx: number, ty: number) {
    const S = this.center, R = this.size, half = this.size * 1.5;
    let best = Infinity;
    // 側面（縦向きの円柱。xz平面で円と交わるか）
    const a = tx * tx + 1, b = -2 * S, c = S * S - R * R;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / (2 * a);
      if (t > 0 && Math.abs(ty * t) <= half) best = t;
    }
    // 上下のふた
    if (Math.abs(ty) > 1e-9) {
      for (const y of [half, -half]) {
        const t = y / ty;
        if (t > 0 && t < best && (tx * t) ** 2 + (S - t) ** 2 <= R * R) best = t;
      }
    }
    return best;
  }
}
