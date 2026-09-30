import {
  AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, Group, LineBasicMaterial, LineSegments, Mesh,
  ShaderMaterial, type Data3DTexture,
} from 'three';
import type { Frame } from '../core/frame';
import type { Settings } from '../core/params';
import type { Scanner } from '../core/scanner';
import type { Surfaces } from './surfaces';
import { smokeTexture } from './noise';
import { EYE_GAIN, MAX_MIRROR } from '../core/color';

const clampMirror = (v: number) => Math.max(-MAX_MIRROR, Math.min(MAX_MIRROR, v));

export interface Rig {
  // プロジェクターから壁までの距離
  distance: number;
  // ヘイズの濃さ（ビームの明るさ）
  haze: number;
}

// 1台ぶんの描く材料。チャンネルごとに設定とシミュレーションが違う
export interface Source {
  settings: Readonly<Settings>;
  scanner: Scanner;
  // 光を積算する時間（スキャンのとき）
  tau: number;
  // ベクター表示のときの今のフレーム
  frame: Frame | null;
}

// プロジェクター1台の置き場所と向き
export interface Projector {
  pos: readonly [number, number, number];
  // 左右の向き（rad）。正で左を向く
  yaw: number;
  // 左右反転（左右対称に並べるときの右側）
  mirror: boolean;
}


class Buffer {
  pos: Float32Array;
  col: Float32Array;
  org: Float32Array;
  count = 0;
  // これから打つ頂点の光源（プロジェクター）の位置
  origin: readonly number[] = [0, 0, 0];
  readonly geo = new BufferGeometry();
  private posAttr: BufferAttribute;
  private colAttr: BufferAttribute;
  private orgAttr: BufferAttribute;
  private per: number;

  constructor(max: number, vertsPer: number) {
    this.per = vertsPer;
    this.pos = new Float32Array(max * vertsPer * 3);
    this.col = new Float32Array(max * vertsPer * 3);
    this.org = new Float32Array(max * vertsPer * 3);
    this.posAttr = new BufferAttribute(this.pos, 3);
    this.colAttr = new BufferAttribute(this.col, 3);
    this.orgAttr = new BufferAttribute(this.org, 3);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('color', this.colAttr);
    this.geo.setAttribute('aOrigin', this.orgAttr);
  }

  full() {
    return (this.count + 1) * this.per * 3 > this.pos.length;
  }

  vert(k: number, x: number, y: number, z: number, r: number, g: number, b: number) {
    const o = (this.count * this.per + k) * 3;
    this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z;
    this.col[o] = r; this.col[o + 1] = g; this.col[o + 2] = b;
    this.org[o] = this.origin[0]; this.org[o + 1] = this.origin[1]; this.org[o + 2] = this.origin[2];
  }

  // 使った分だけGPUに送る（バッファ全体を毎フレーム送ると重い）
  commit() {
    const n = this.count * this.per;
    this.geo.setDrawRange(0, n);
    for (const attr of [this.posAttr, this.colAttr, this.orgAttr]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, n * 3);
      attr.needsUpdate = true;
    }
  }
}

const additive = { vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false } as const;

// ヘイズの濃さのむら。ノイズを少し歪ませて渦のように流す。
// 濃い所ほどビームが明るく見える（smoke=0 なら一様なヘイズ）
export const SMOKE_GLSL = `
  uniform float uTime;
  uniform float uSmoke;
  uniform float uGrain;
  uniform float uExt;
  // 1: 膜の厚みの中を3か所測る / 0: 1か所だけ（軽い）
  uniform float uThick;
  // ビームの見え方の物理:
  // ・ヘイズで散乱した分だけビームは減っていく（ベール・ランベルト則）
  // ・ヘイズの粒は光を前向きに散乱しやすいので、光源の方を向いて見るほど明るい（ヘニエイ・グリーンスタイン）
  // w: 光源から見た位置
  float airlight(vec3 w, vec3 viewDir) {
    float r = length(w);
    vec3 beamDir = w / max(r, 1e-4);
    float c = dot(beamDir, -viewDir);
    const float g = 0.4;
    float phase = pow((1.0 + g * g) / (1.0 + g * g - 2.0 * g * c), 1.5);
    return exp(-uExt * r) * phase;
  }
  // 光の膜は遠いほど広がって薄くなる（距離に反比例。4mで1）
  float spread(vec3 w) {
    return min(3.0, 4.0 / max(length(w), 0.1));
  }
  uniform highp sampler3D uNoise;
  // 前もって作った3Dノイズを読む（1周期 = ノイズの格子8つぶん）
  float tex(vec3 p) {
    return texture(uNoise, p * 0.125).r;
  }
  // 1: その場でノイズを計算する（細かいが重い。画質High） / 0: 作っておいたノイズを読む（軽い）
  uniform float uProcedural;
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
  float smoke1(vec3 w) {
    // ヘイズは横に広がって層になりやすいので、縦方向を詰める
    vec3 p = w * uGrain * vec3(0.7, 1.8, 0.7) + vec3(uTime * 0.05, uTime * 0.02, -uTime * 0.04);
    float d;
    if (uProcedural > 0.5) {
      // 流れながら形も変わるよう、歪ませる量を時間で動かす
      vec3 q = p * 0.5 + vec3(0.0, 0.0, uTime * 0.07);
      p += 1.6 * (vec3(noise(q + 3.1), noise(q + 7.4), noise(q + 1.3)) - 0.5);
      d = fbm(p) * 0.7 + (1.0 - abs(2.0 * noise(p * 2.3) - 1.0)) * 0.3;
    } else {
      p += 1.6 * (tex(p * 0.5 + vec3(3.1, 7.4, uTime * 0.07)) - 0.5);
      d = tex(p) * 0.7 + (1.0 - abs(2.0 * tex(p * 2.3 + 5.0) - 1.0)) * 0.3;
    }
    return smoothstep(0.38, 0.72, d);
  }
  // 光の膜には厚みがある（遠いほどビームが広がって厚い）。視線に沿って厚みの中を数か所測って平均する
  // w: 空間での位置、r: 光源からの距離
  float smoke(vec3 w, vec3 viewDir, float r) {
    float thick = 0.03 + 0.05 * r;
    float d = uThick > 0.5
      ? (smoke1(w - viewDir * thick) + smoke1(w) + smoke1(w + viewDir * thick)) / 3.0
      : smoke1(w);
    return mix(1.0, d * 1.7, uSmoke);
  }
`;

export interface HazeUniforms {
  uTime: { value: number };
  uSmoke: { value: number };
  uGrain: { value: number };
  // ヘイズの減衰係数（1mあたり）
  uExt: { value: number };
  uThick: { value: number };
  uNoise: { value: Data3DTexture };
  uProcedural: { value: number };
}

const beamVertex = `
  attribute vec3 aOrigin;
  varying vec3 vColor;
  varying vec3 vView;
  varying vec3 vWorld;
  varying vec3 vRel;
  varying vec3 vEye;
  void main() {
    vColor = color;
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    vRel = vWorld - aOrigin;
    vEye = vWorld - cameraPosition;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }`;

// 光の膜は、斜めから見るほどヘイズの中を長く通して見るので明るく見える（円錐の縁が明るいのはこのため）
const sheetMaterial = (uniforms: HazeUniforms) => new ShaderMaterial({
  ...additive,
  side: DoubleSide,
  uniforms: { ...uniforms },
  vertexShader: beamVertex,
  fragmentShader: SMOKE_GLSL + `
    varying vec3 vColor;
    varying vec3 vView;
    varying vec3 vWorld;
    varying vec3 vRel;
    varying vec3 vEye;
    void main() {
      vec3 n = normalize(cross(dFdx(vView), dFdy(vView)));
      float c = abs(dot(n, normalize(-vView)));
      vec3 viewDir = normalize(vEye);
      float s = smoke(vWorld, viewDir, length(vRel));
      gl_FragColor = vec4(vColor / max(c, 0.12) * s * airlight(vRel, viewDir) * spread(vRel), 1.0);
    }`,
});

const rayMaterial = (uniforms: HazeUniforms) => new ShaderMaterial({
  ...additive,
  uniforms: { ...uniforms },
  vertexShader: beamVertex,
  fragmentShader: SMOKE_GLSL + `
    varying vec3 vColor;
    varying vec3 vWorld;
    varying vec3 vRel;
    varying vec3 vEye;
    void main() {
      vec3 viewDir = normalize(vEye);
      gl_FragColor = vec4(vColor * smoke(vWorld, viewDir, length(vRel)) * airlight(vRel, viewDir), 1.0);
    }`,
});

// ビームを3Dにしたもの。隣り合う2点の間は光の膜（三角形）、その場に留まる点は1本のビーム（線）にする
export class Beams {
  readonly group = new Group();
  private sheets = new Buffer(160000, 3);
  private rays = new Buffer(60000, 2);
  private wall = new Buffer(160000, 2);
  private projectors: readonly Projector[] = [{ pos: [0, 0, 0], yaw: 0, mirror: false }];
  private proj: Projector = this.projectors[0];
  private cos = 1;
  private sin = 0;
  private dir = [0, 0, 0];
  private rig: Rig;
  // 点の座標はサイズを掛ける前の値なので、ここで掛ける
  private scale = 1;
  // 最大走査角の半分（rad）。台ごとに、そのチャンネルの設定から
  private half = 0.35;
  private pincushion = true;
  // 色ごとの見かけの明るさ
  private gain: readonly number[] = [1, 1, 1];

  private surfaces: Surfaces;
  readonly haze: HazeUniforms = { uTime: { value: 0 }, uSmoke: { value: 0.6 }, uGrain: { value: 0.6 }, uExt: { value: 0.015 }, uThick: { value: 1 }, uNoise: { value: smokeTexture() }, uProcedural: { value: 0 } };

  constructor(rig: Rig, surfaces: Surfaces) {
    this.rig = rig;
    this.surfaces = surfaces;
    this.group.add(
      new Mesh(this.sheets.geo, sheetMaterial(this.haze)),
      new LineSegments(this.rays.geo, rayMaterial(this.haze)),
      new LineSegments(this.wall.geo, new LineBasicMaterial(additive)),
    );
    for (const o of this.group.children) o.frustumCulled = false;
  }

  // 点の座標 → ビームが当たる位置。戻り値は奥行き（何にも当たらなければ Infinity）
  private hit(x: number, y: number, out: number[]) {
    const a = this.half * this.scale;
    // 2枚のミラーで振るので、Yを振るほどXが広がる（糸巻きゆがみ）
    const ax = clampMirror(x * a), ay = clampMirror(y * a);
    const warp = this.pincushion ? 1 / Math.cos(ay) : 1;
    const tx = Math.tan(ax) * warp * (this.proj.mirror ? -1 : 1), ty = Math.tan(ay);
    // プロジェクターの向き（y軸まわりの回転）に合わせる。正面は -z
    const d = this.dir, o = this.proj.pos;
    d[0] = tx * this.cos - this.sin;
    d[1] = ty;
    d[2] = -tx * this.sin - this.cos;
    const t = this.surfaces.hit(o, d);
    // 当たらないビームは一定の長さで止め、先へ行くほど消えていく
    const reach = Number.isFinite(t) ? t : this.rig.distance * 1.2;
    out[0] = o[0] + d[0] * reach;
    out[1] = o[1] + d[1] * reach;
    out[2] = o[2] + d[2] * reach;
    return t;
  }

  private use(p: Projector, s: Readonly<Settings>) {
    this.proj = p;
    this.cached = -1;
    this.half = s.scanAngle / 2 * Math.PI / 180;
    this.scale = s.size;
    this.pincushion = s.pincushion;
    this.gain = s.eye ? EYE_GAIN : [1, 1, 1];
    this.cos = Math.cos(p.yaw);
    this.sin = Math.sin(p.yaw);
    this.sheets.origin = this.rays.origin = this.wall.origin = p.pos;
  }

  setProjectors(list: readonly Projector[]) {
    this.projectors = list.length ? list : this.projectors;
  }

  // 2本のビームが別々の物に当たっている（奥行きが飛んでいる）か
  private split(ta: number, tb: number) {
    if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Number.isFinite(ta) !== Number.isFinite(tb);
    return Math.abs(ta - tb) > 0.15 * Math.max(ta, tb);
  }

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
    } else {
      this.ta = this.hit(x0, y0, this.a);
    }
    this.tb = this.hit(x1, y1, this.b);
    this.cached = next;
    this.p0[0] = x0; this.p0[1] = y0; this.p1[0] = x1; this.p1[1] = y1;
    this.edged = false;
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
  private edge() {
    if (this.edged) return this.edgeOk;
    this.edged = true;
    let lo = 0, hi = 1, tLo = this.ta, tHi = this.tb;
    const ea = this.ea, eb = this.eb;
    ea.splice(0, 3, ...this.a);
    eb.splice(0, 3, ...this.b);
    for (let i = 0; i < 8; i++) {
      const m = (lo + hi) / 2;
      const t = this.hit(this.p0[0] + (this.p1[0] - this.p0[0]) * m, this.p0[1] + (this.p1[1] - this.p0[1]) * m, this.tmp);
      if (!this.split(tLo, t)) { lo = m; tLo = t; ea.splice(0, 3, ...this.tmp); }
      else { hi = m; tHi = t; eb.splice(0, 3, ...this.tmp); }
    }
    // 縁の両側がそれぞれつながっていれば、そこで分けて描ける
    this.edgeOk = !this.split(tHi, this.tb) || hi === 1;
    return this.edgeOk;
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
    if (!this.split(this.ta, this.tb)) { this.tri(this.a, this.b, r, g, b); return; }
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
    k *= Math.exp(-this.haze.uExt.value * ((Number.isFinite(ta) ? ta : tb) + (Number.isFinite(tb) ? tb : ta)) / 2);
    if (!this.split(ta, tb)) { this.line(this.a, this.b, r * k, g * k, b * k); return; }
    // 縁をまたぐときは、縁の両側で別々に引く（何にも当たらない側は引かない）
    if (!this.edge()) return;
    if (Number.isFinite(ta)) this.line(this.a, this.ea, r * k, g * k, b * k);
    if (Number.isFinite(tb)) this.line(this.eb, this.b, r * k, g * k, b * k);
  }

  private line(p: number[], q: number[], r: number, g: number, b: number) {
    if (this.wall.full()) return;
    // 面から少しだけ手前に出して、面と重ならないようにする
    const s = this.wall, o = this.proj.pos, pull = 0.998;
    const P = (v: number[], i: number) => o[i] + (v[i] - o[i]) * pull;
    s.vert(0, P(p, 0), P(p, 1), P(p, 2), r, g, b);
    s.vert(1, P(q, 0), P(q, 1), P(q, 2), r, g, b);
    s.count++;
  }

  private begin() {
    this.cached = -1;
    this.sheets.count = this.rays.count = this.wall.count = 0;
  }

  private end() {
    this.sheets.commit();
    this.rays.commit();
    this.wall.commit();
  }

  // スキャン: 露光時間内に通った軌跡。遅く動いた所ほど明るい（2D出力と同じ考え方）
  // 台ごとに、割り当てたチャンネルの映像ソースで描く（ソースは台の順に繰り返して使う）
  draw(sources: readonly Source[]) {
    this.begin();
    if (sources.length) {
      this.projectors.forEach((p, k) => {
        const src = sources[k % sources.length], s = src.settings;
        this.use(p, s);
        if (s.mode === 'scan') this.scanOne(src.scanner, s, src.tau);
        else if (src.frame) this.frameOne(src.frame, s);
      });
    }
    this.end();
  }

  private scanOne(sc: Scanner, s: Readonly<Settings>, tau: number) {
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
      const r = sc.r[i] / 255 * this.gain[0], g = sc.g[i] / 255 * this.gain[1], b = sc.b[i] / 255 * this.gain[2];
      const d = Math.hypot(sc.x[i] - sc.x[j], sc.y[i] - sc.y[j]);
      this.ends(j, sc.x[j], sc.y[j], sc.x[i], sc.y[i], i);
      // ほとんど動いていない間は1本のビーム、動いている間は光の膜
      if (d < 0.004) this.ray(r, g, b, e * haze * 40);
      else this.sheet(r, g, b, e / d * haze * 0.12);
      this.spot(r, g, b, 0.8);
    }
  }

  // ベクター: 今のフレームの図形をそのまま、均一な明るさで

  private frameOne(f: Frame, s: Readonly<Settings>) {
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
