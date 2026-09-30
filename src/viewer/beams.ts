import {
  AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, Group, LineBasicMaterial, LineSegments, Mesh,
  ShaderMaterial,
} from 'three';
import type { Frame } from '../core/frame';
import type { Settings } from '../core/params';
import type { Scanner } from '../core/scanner';
import type { Surfaces } from './surfaces';

export interface Rig {
  // 走査角（片側, rad）。点の座標1がこの角度になる
  halfAngle: number;
  // プロジェクターから壁までの距離
  distance: number;
  // ヘイズの濃さ（ビームの明るさ）
  haze: number;
}

// 光源から遠いほど暗くする（光の膜が広がって薄くなるのと、ヘイズでの減衰）
const FAR_FADE = 0.25;

class Buffer {
  pos: Float32Array;
  col: Float32Array;
  count = 0;
  readonly geo = new BufferGeometry();
  private posAttr: BufferAttribute;
  private colAttr: BufferAttribute;
  private per: number;

  constructor(max: number, vertsPer: number) {
    this.per = vertsPer;
    this.pos = new Float32Array(max * vertsPer * 3);
    this.col = new Float32Array(max * vertsPer * 3);
    this.posAttr = new BufferAttribute(this.pos, 3);
    this.colAttr = new BufferAttribute(this.col, 3);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('color', this.colAttr);
  }

  full() {
    return (this.count + 1) * this.per * 3 > this.pos.length;
  }

  vert(k: number, x: number, y: number, z: number, r: number, g: number, b: number) {
    const o = (this.count * this.per + k) * 3;
    this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z;
    this.col[o] = r; this.col[o + 1] = g; this.col[o + 2] = b;
  }

  // 使った分だけGPUに送る（バッファ全体を毎フレーム送ると重い）
  commit() {
    const n = this.count * this.per;
    this.geo.setDrawRange(0, n);
    for (const attr of [this.posAttr, this.colAttr]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, n * 3);
      attr.needsUpdate = true;
    }
  }
}

const additive = { vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false } as const;

// ヘイズの濃さのむら。ノイズを少し歪ませて渦のように流す。
// 濃い所ほどビームが明るく見える（smoke=0 なら一様なヘイズ）
const SMOKE_GLSL = `
  uniform float uTime;
  uniform float uSmoke;
  uniform float uGrain;
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    return 0.5 * noise(p) + 0.25 * noise(p * 2.03 + 1.7) + 0.125 * noise(p * 4.1 + 9.2);
  }
  float smoke(vec3 w) {
    // ヘイズは横に広がって層になりやすいので、縦方向を詰めて筋っぽくする
    vec3 p = w * uGrain * vec3(0.7, 1.8, 0.7) + vec3(uTime * 0.05, uTime * 0.03, -uTime * 0.04);
    p += 2.0 * vec3(fbm(p + 3.1), fbm(p + 7.4), fbm(p + 1.3)) - 1.0;
    float d = smoothstep(0.25, 0.65, fbm(p));
    return mix(1.0, d * 2.0, uSmoke);
  }
`;

export interface SmokeUniforms {
  uTime: { value: number };
  uSmoke: { value: number };
  uGrain: { value: number };
}

const beamVertex = `
  varying vec3 vColor;
  varying vec3 vView;
  varying vec3 vWorld;
  void main() {
    vColor = color;
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }`;

// 光の膜は、斜めから見るほどヘイズの中を長く通して見るので明るく見える（円錐の縁が明るいのはこのため）
const sheetMaterial = (uniforms: SmokeUniforms) => new ShaderMaterial({
  ...additive,
  side: DoubleSide,
  uniforms: { ...uniforms },
  vertexShader: beamVertex,
  fragmentShader: SMOKE_GLSL + `
    varying vec3 vColor;
    varying vec3 vView;
    varying vec3 vWorld;
    void main() {
      vec3 n = normalize(cross(dFdx(vView), dFdy(vView)));
      float c = abs(dot(n, normalize(-vView)));
      gl_FragColor = vec4(vColor / max(c, 0.12) * smoke(vWorld), 1.0);
    }`,
});

const rayMaterial = (uniforms: SmokeUniforms) => new ShaderMaterial({
  ...additive,
  uniforms: { ...uniforms },
  vertexShader: beamVertex,
  fragmentShader: SMOKE_GLSL + `
    varying vec3 vColor;
    varying vec3 vWorld;
    void main() {
      gl_FragColor = vec4(vColor * smoke(vWorld), 1.0);
    }`,
});

// ビームを3Dにしたもの。隣り合う2点の間は光の膜（三角形）、その場に留まる点は1本のビーム（線）にする
export class Beams {
  readonly group = new Group();
  private sheets = new Buffer(40000, 3);
  private rays = new Buffer(20000, 2);
  private wall = new Buffer(40000, 2);
  private rig: Rig;
  // 点の座標はサイズを掛ける前の値なので、ここで掛ける
  private scale = 1;

  private surfaces: Surfaces;
  readonly smoke: SmokeUniforms = { uTime: { value: 0 }, uSmoke: { value: 0.6 }, uGrain: { value: 0.6 } };

  constructor(rig: Rig, surfaces: Surfaces) {
    this.rig = rig;
    this.surfaces = surfaces;
    this.group.add(
      new Mesh(this.sheets.geo, sheetMaterial(this.smoke)),
      new LineSegments(this.rays.geo, rayMaterial(this.smoke)),
      new LineSegments(this.wall.geo, new LineBasicMaterial(additive)),
    );
    for (const o of this.group.children) o.frustumCulled = false;
  }

  // 点の座標 → ビームが当たる位置。戻り値は奥行き（何にも当たらなければ Infinity）
  private hit(x: number, y: number, out: number[]) {
    const a = this.rig.halfAngle * this.scale;
    const tx = Math.tan(x * a), ty = Math.tan(y * a);
    const t = this.surfaces.hit(tx, ty);
    // 当たらないビームは一定の長さで止め、先へ行くほど消えていく
    const reach = Number.isFinite(t) ? t : this.rig.distance * 1.2;
    out[0] = tx * reach;
    out[1] = ty * reach;
    out[2] = -reach;
    return t;
  }

  // 光源からの距離による減衰
  private fade(p: number[]) {
    return 1 - (1 - FAR_FADE) * Math.min(1, -p[2] / this.rig.distance);
  }

  // 2本のビームが別々の物に当たっている（奥行きが飛んでいる）か
  private split(ta: number, tb: number) {
    if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Number.isFinite(ta) !== Number.isFinite(tb);
    return Math.abs(ta - tb) > 0.15 * Math.max(ta, tb);
  }

  private a = [0, 0, 0];
  private b = [0, 0, 0];

  private sheet(x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number, k: number) {
    if (this.sheets.full()) return;
    const ta = this.hit(x0, y0, this.a), tb = this.hit(x1, y1, this.b);
    // 物の縁をまたぐ膜は、手前の物を突き抜けた形になってしまうので描かない
    if (this.split(ta, tb)) return;
    const fa = k * this.fade(this.a), fb = k * this.fade(this.b), s = this.sheets;
    s.vert(0, 0, 0, 0, r * k, g * k, b * k);
    s.vert(1, this.a[0], this.a[1], this.a[2], r * fa, g * fa, b * fa);
    s.vert(2, this.b[0], this.b[1], this.b[2], r * fb, g * fb, b * fb);
    s.count++;
  }

  private ray(x: number, y: number, r: number, g: number, b: number, k: number) {
    if (this.rays.full()) return;
    this.hit(x, y, this.a);
    const f = k * this.fade(this.a), s = this.rays;
    s.vert(0, 0, 0, 0, r * k, g * k, b * k);
    s.vert(1, this.a[0], this.a[1], this.a[2], r * f, g * f, b * f);
    s.count++;
  }

  // 物に当たった所の光。当たっていなければ描かない
  private spot(x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number, k: number) {
    if (this.wall.full()) return;
    const ta = this.hit(x0, y0, this.a), tb = this.hit(x1, y1, this.b);
    if (!Number.isFinite(ta) || !Number.isFinite(tb) || this.split(ta, tb)) return;
    // 面から少しだけ手前に出して、面と重ならないようにする
    const s = this.wall, pull = 0.998;
    s.vert(0, this.a[0] * pull, this.a[1] * pull, this.a[2] * pull, r * k, g * k, b * k);
    s.vert(1, this.b[0] * pull, this.b[1] * pull, this.b[2] * pull, r * k, g * k, b * k);
    s.count++;
  }

  private begin(s: Readonly<Settings>) {
    this.scale = s.size;
    this.sheets.count = this.rays.count = this.wall.count = 0;
  }

  private end() {
    this.sheets.commit();
    this.rays.commit();
    this.wall.commit();
  }

  // スキャン: 露光時間内に通った軌跡。遅く動いた所ほど明るい（2D出力と同じ考え方）
  fromScanner(sc: Scanner, s: Readonly<Settings>, tau: number) {
    this.begin(s);
    const isExp = s.exposureShape === 'exp';
    const window = isExp ? tau * 5 : tau;
    const dt = 1 / s.pps;
    const haze = this.rig.haze * s.bright;

    let L = 0;
    while (L < sc.count && sc.scanT - sc.t[sc.index(L)] <= window) L++;
    for (let k = L - 1; k >= 1; k--) {
      const j = sc.index(k), i = sc.index(k - 1);
      if (!sc.on[i]) continue;
      const w = isExp ? Math.exp(-(sc.scanT - sc.t[i]) / tau) : 1;
      const e = w * dt / tau;
      const r = sc.r[i] / 255, g = sc.g[i] / 255, b = sc.b[i] / 255;
      const d = Math.hypot(sc.x[i] - sc.x[j], sc.y[i] - sc.y[j]);
      // ほとんど動いていない間は1本のビーム、動いている間は光の膜
      if (d < 0.004) this.ray(sc.x[i], sc.y[i], r, g, b, e * haze * 40);
      else this.sheet(sc.x[j], sc.y[j], sc.x[i], sc.y[i], r, g, b, e / d * haze * 0.12);
      this.spot(sc.x[j], sc.y[j], sc.x[i], sc.y[i], r, g, b, 0.8);
    }
    this.end();
  }

  // ベクター: 今のフレームの図形をそのまま、均一な明るさで
  fromFrame(f: Frame, s: Readonly<Settings>) {
    this.begin(s);
    const haze = this.rig.haze * s.bright;
    let total = 0;
    for (let i = 1; i < f.length; i++) {
      if (f.on[i]) total += Math.hypot(f.x[i] - f.x[i - 1], f.y[i] - f.y[i - 1]);
    }
    const density = haze * 0.12 / Math.max(total, 0.5);
    let prevLit = false;
    for (let i = 1; i < f.length; i++) {
      if (!f.on[i]) { prevLit = false; continue; }
      const r = f.r[i] / 255, g = f.g[i] / 255, b = f.b[i] / 255;
      const d = Math.hypot(f.x[i] - f.x[i - 1], f.y[i] - f.y[i - 1]);
      if (d > 1e-3) {
        this.sheet(f.x[i - 1], f.y[i - 1], f.x[i], f.y[i], r, g, b, density);
        this.spot(f.x[i - 1], f.y[i - 1], f.x[i], f.y[i], r, g, b, 0.8);
        prevLit = true;
      } else if (!prevLit) {
        this.ray(f.x[i], f.y[i], r, g, b, haze * 0.3);
        prevLit = true;
      }
    }
    this.end();
  }
}
