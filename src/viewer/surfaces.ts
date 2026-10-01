import {
  BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, Group, LineBasicMaterial, LineSegments,
  Mesh, MeshLambertMaterial, PlaneGeometry, SphereGeometry,
} from 'three';
import { CUBE_TILT, cross, facingPts, Hits, sub, type TargetKind } from './hits';
import { arenaTruss, type Material as VenueMaterial } from './venues';

export { ROOMS, TARGETS, type Room, type TargetKind } from './hits';

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

// ビームが当たる物の見た目。当たり判定は hits（three.js を使わない部分）
export class Surfaces {
  readonly group = new Group();
  readonly hits = new Hits();
  // 会場の面ごとの、表の向きと縁の線
  private facing: { lines: LineSegments; n: number[]; mid: number[] }[] = [];

  get floor() {
    return this.hits.floor;
  }
  get kind() {
    return this.hits.kind;
  }
  get distance() {
    return this.hits.d;
  }

  // カメラから見て裏を向いている面の縁を隠す（面そのものは裏面を描かない設定で消える）
  updateFacing(cam: { x: number; y: number; z: number }) {
    for (const f of this.facing) {
      f.lines.visible = f.n[0] * (cam.x - f.mid[0]) + f.n[1] * (cam.y - f.mid[1]) + f.n[2] * (cam.z - f.mid[2]) > 0;
    }
  }

  build(kind: TargetKind, distance: number) {
    const h = this.hits;
    h.build(kind, distance);
    // 前の形が持っていたGPUのメモリを手放してから作り直す
    this.group.traverse(o => {
      if (o !== this.group && 'geometry' in o) (o as Mesh).geometry.dispose();
    });
    this.group.clear();
    this.facing = [];
    if (kind === 'none') return;
    if (h.room) {
      this.buildVenue();
      if (kind === 'arena') {
        const geo = new BufferGeometry();
        geo.setAttribute('position', new BufferAttribute(new Float32Array(arenaTruss(h.room, distance)), 3));
        this.group.add(new LineSegments(geo, edgeMaterial));
      }
      return;
    }

    // 壁や床は、ビームが端からはみ出さないよう距離に合わせて大きくする
    const w = Math.max(60, distance * 8), ht = Math.max(30, distance * 4);
    const wall = new Mesh(new PlaneGeometry(w, ht), material);
    wall.position.z = -distance - 0.01;
    const floor = new Mesh(new PlaneGeometry(w, w), material);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -h.floor - 0.01;
    this.group.add(wall, floor);

    if (kind === 'corner') {
      const side = new Mesh(new PlaneGeometry(w, ht), material);
      side.rotation.y = Math.PI / 2;
      side.position.x = -h.sideX() - 0.01;
      this.group.add(side);
    }
    if (kind === 'sphere') {
      const m = new Mesh(new SphereGeometry(h.size, 48, 32), material);
      m.position.z = -h.center;
      this.group.add(m);
    }
    if (kind === 'cube') {
      const m = new Mesh(new BoxGeometry(h.size * 1.6, h.size * 1.6, h.size * 1.6), material);
      m.position.z = -h.center;
      m.rotation.set(CUBE_TILT[0], CUBE_TILT[1], 0);
      this.group.add(m);
    }
    if (kind === 'cylinder') {
      const m = new Mesh(new CylinderGeometry(h.size, h.size, h.size * 3, 48), material);
      m.position.z = -h.center;
      this.group.add(m);
    }
  }

  // 会場の面を、材質ごとに1つのメッシュにまとめる。縁の線は面ごと（裏向きのとき隠すため）
  private buildVenue() {
    const byMat = new Map<VenueMaterial, number[]>();
    for (const p of this.hits.polys) {
      const pts = facingPts(p);
      const list = byMat.get(p.mat) ?? [];
      byMat.set(p.mat, list);
      for (let i = 1; i < pts.length - 1; i++) list.push(...pts[0], ...pts[i], ...pts[i + 1]);
      const edge: number[] = [];
      for (let i = 0; i < pts.length; i++) edge.push(...pts[i], ...pts[(i + 1) % pts.length]);
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(new Float32Array(edge), 3));
      const lines = new LineSegments(geo, edgeMaterial);
      this.group.add(lines);
      const mid = [0, 1, 2].map(k => pts.reduce((sum, q) => sum + q[k], 0) / pts.length);
      this.facing.push({ lines, n: cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])), mid });
    }
    for (const [mat, list] of byMat) {
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(new Float32Array(list), 3));
      geo.computeVertexNormals();
      this.group.add(new Mesh(geo, MATERIALS[mat]));
    }
  }
}
