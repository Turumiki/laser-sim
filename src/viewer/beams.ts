import {
  AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, Group, LineSegments, Mesh,
  ShaderMaterial, Vector2, type Data3DTexture,
} from 'three';
import type { Frame } from '../core/frame';
import type { Settings } from '../core/params';
import type { Scanner } from '../core/scanner';
import { BeamGeometry, type Arrays, type BeamSource, type Projector, type Rig, type ScanWindow } from './beam-geometry';
import type { Built, WorkerRequest, WorkerResult } from './beam-worker';
import type { Surfaces } from './surfaces';
import { smokeTexture } from './noise';

export type { Projector, Rig } from './beam-geometry';

// 1台ぶんの描く材料。チャンネルごとに設定とシミュレーションが違う
export interface Source {
  settings: Readonly<Settings>;
  scanner: Scanner;
  // 光を積算する時間（スキャンのとき）
  tau: number;
  // ベクター表示のときの今のフレーム
  frame: Frame | null;
}

// GPUに送る頂点の並び（位置・色・光源の位置・光の古さ）
class GpuBuffer {
  readonly geo = new BufferGeometry();
  private attrs: BufferAttribute[];
  private per: number;

  constructor(max: number, vertsPer: number) {
    this.per = vertsPer;
    const v = max * vertsPer;
    this.attrs = [
      new BufferAttribute(new Float32Array(v * 3), 3),
      new BufferAttribute(new Float32Array(v * 3), 3),
      new BufferAttribute(new Float32Array(v * 3), 3),
      new BufferAttribute(new Float32Array(v), 1),
    ];
    ['position', 'color', 'aOrigin', 'aAge'].forEach((name, i) => this.geo.setAttribute(name, this.attrs[i]));
  }

  // 使った分だけ写して、その分だけGPUに送る（バッファ全体を毎フレーム送ると重い）
  load(count: number, parts: readonly Float32Array[]) {
    const n = count * this.per;
    this.geo.setDrawRange(0, n);
    this.attrs.forEach((attr, i) => {
      (attr.array as Float32Array).set(parts[i].subarray(0, n * attr.itemSize));
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, n * attr.itemSize);
      attr.needsUpdate = true;
    });
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
    // 空調や送風で流される（横に速く、上下はゆっくり）。uTime は流れの速さを掛けた時間
    vec3 p = w * uGrain * vec3(0.7, 1.8, 0.7) + vec3(uTime * 0.2, uTime * 0.03, -uTime * 0.12);
    float d;
    if (uProcedural > 0.5) {
      // 流れながら形も変わるよう、歪ませる量を時間で動かす
      vec3 q = p * 0.5 + vec3(0.0, 0.0, uTime * 0.2);
      p += 1.6 * (vec3(noise(q + 3.1), noise(q + 7.4), noise(q + 1.3)) - 0.5);
      d = fbm(p) * 0.7 + (1.0 - abs(2.0 * noise(p * 2.3) - 1.0)) * 0.3;
    } else {
      p += 1.6 * (tex(p * 0.5 + vec3(3.1, 7.4, uTime * 0.2)) - 0.5);
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
  // ローリングシャッター: x = 読み出し時間（露光時間を1とする。0で無効）, y = 1 なら残像（指数）
  uRoll: { value: Vector2 };
  // 描画先の大きさ（px）。どの行を撮っているかを出すのに使う
  uRes: { value: Vector2 };
}

// カメラは上の行ほど早く撮り終わる（ローリングシャッター）。その行が撮っている時間帯に、この光が入るか。
// 古さが負（時刻のないベクター表示）なら常に写る
const SHUTTER_GLSL = `
  uniform vec2 uRoll;
  uniform vec2 uRes;
  varying float vAge;
  float shutter() {
    if (uRoll.x <= 0.0 || vAge < 0.0) return 1.0;
    float row = 1.0 - gl_FragCoord.y / uRes.y;
    float a = vAge - (1.0 - row) * uRoll.x;
    if (a < 0.0) return 0.0;
    return uRoll.y > 0.5 ? exp(-a) : step(a, 1.0);
  }
`;

const beamVertex = `
  attribute vec3 aOrigin;
  attribute float aAge;
  varying float vAge;
  varying vec3 vColor;
  varying vec3 vView;
  varying vec3 vWorld;
  varying vec3 vRel;
  varying vec3 vEye;
  void main() {
    vColor = color;
    vAge = aAge;
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
  fragmentShader: SMOKE_GLSL + SHUTTER_GLSL + `
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
      gl_FragColor = vec4(vColor / max(c, 0.12) * s * airlight(vRel, viewDir) * spread(vRel) * shutter(), 1.0);
    }`,
});

const rayMaterial = (uniforms: HazeUniforms) => new ShaderMaterial({
  ...additive,
  uniforms: { ...uniforms },
  vertexShader: beamVertex,
  fragmentShader: SMOKE_GLSL + SHUTTER_GLSL + `
    varying vec3 vColor;
    varying vec3 vWorld;
    varying vec3 vRel;
    varying vec3 vEye;
    void main() {
      vec3 viewDir = normalize(vEye);
      gl_FragColor = vec4(vColor * smoke(vWorld, viewDir, length(vRel)) * airlight(vRel, viewDir) * shutter(), 1.0);
    }`,
});

// 物に当たった所の光
const spotMaterial = (uniforms: HazeUniforms) => new ShaderMaterial({
  ...additive,
  uniforms: { uRoll: uniforms.uRoll, uRes: uniforms.uRes },
  vertexShader: `
    attribute float aAge;
    varying float vAge;
    varying vec3 vColor;
    void main() {
      vColor = color;
      vAge = aAge;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: SHUTTER_GLSL + `
    varying vec3 vColor;
    void main() {
      gl_FragColor = vec4(vColor * shutter(), 1.0);
    }`,
});

// ビームを3Dにしたもの。形を作る計算（beam-geometry.ts）は、使えれば Worker（別スレッド）で行う。
// Worker の結果は次のフレームで届くので、表示は1フレーム遅れる
export class Beams {
  readonly group = new Group();
  private sheets = new GpuBuffer(160000, 3);
  private rays = new GpuBuffer(60000, 2);
  private wall = new GpuBuffer(160000, 2);
  private projectors: readonly Projector[] = [{ pos: [0, 0, 0], yaw: 0, mirror: false }];
  private rig: Rig;
  private surfaces: Surfaces;
  readonly haze: HazeUniforms = { uTime: { value: 0 }, uSmoke: { value: 0.6 }, uGrain: { value: 0.6 }, uExt: { value: 0.015 }, uThick: { value: 1 }, uNoise: { value: smokeTexture() }, uProcedural: { value: 0 }, uRoll: { value: new Vector2() }, uRes: { value: new Vector2(1, 1) } };

  private worker: Worker | null = null;
  // Worker が計算中（結果を待っている間は次を頼まない）
  private busy = false;
  // Worker に伝えた会場の版
  private sentVersion = -1;
  // 写し終わった入れ物。次に頼むときに Worker へ返す
  private recycle: ArrayBuffer[] = [];
  // Worker が使えないときは、同じ計算をここで行う
  private local: BeamGeometry | null = null;

  constructor(rig: Rig, surfaces: Surfaces) {
    this.rig = rig;
    this.surfaces = surfaces;
    this.group.add(
      new Mesh(this.sheets.geo, sheetMaterial(this.haze)),
      new LineSegments(this.rays.geo, rayMaterial(this.haze)),
      new LineSegments(this.wall.geo, spotMaterial(this.haze)),
    );
    for (const o of this.group.children) o.frustumCulled = false;
    try {
      this.worker = new Worker(new URL('./beam-worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<WorkerResult>) => this.receive(e.data);
      this.worker.onerror = () => this.fallback();
    } catch {
      this.fallback();
    }
  }

  private fallback() {
    this.worker?.terminate();
    this.worker = null;
    this.busy = false;
    this.local ??= new BeamGeometry(this.surfaces.hits);
  }

  setProjectors(list: readonly Projector[]) {
    this.projectors = list.length ? list : this.projectors;
  }

  draw(sources: readonly Source[]) {
    const rig = { ...this.rig }, ext = this.haze.uExt.value;
    if (!this.worker) {
      const g = this.local ?? (this.local = new BeamGeometry(this.surfaces.hits));
      g.draw(this.projectors, sources.map(s => material(s, rig.roll)), rig, ext);
      const load = (buf: GpuBuffer, a: Arrays) => buf.load(a.count, [a.pos, a.col, a.org, a.age]);
      load(this.sheets, g.sheets);
      load(this.rays, g.rays);
      load(this.wall, g.wall);
      return;
    }
    const h = this.surfaces.hits;
    if (h.version !== this.sentVersion) {
      this.sentVersion = h.version;
      this.post({ type: 'scene', kind: h.kind, distance: h.d });
    }
    // 前の結果がまだなら、このフレームは頼まない（前の形をそのまま表示する）
    if (this.busy) return;
    this.busy = true;
    const recycle = this.recycle;
    this.recycle = [];
    this.post({ type: 'draw', projectors: this.projectors.map(p => ({ ...p })), sources: sources.map(s => material(s, rig.roll)), rig, ext, recycle }, recycle);
  }

  private post(m: WorkerRequest, transfer: Transferable[] = []) {
    this.worker!.postMessage(m, transfer);
  }

  private receive(r: WorkerResult) {
    this.busy = false;
    const load = (buf: GpuBuffer, b: Built) => {
      const parts = [b.pos, b.col, b.org, b.age];
      buf.load(b.count, parts.map(p => new Float32Array(p.buf, 0, p.n)));
      for (const p of parts) this.recycle.push(p.buf);
    };
    load(this.sheets, r.sheets);
    load(this.rays, r.rays);
    load(this.wall, r.wall);
  }
}

// 描く材料を、Worker に渡せる形（必要な設定と、点の並びの写し）にする
function material(src: Source, roll: number): BeamSource {
  const s = src.settings;
  const settings = { mode: s.mode, exposureShape: s.exposureShape, pps: s.pps, bright: s.bright, scanAngle: s.scanAngle, size: s.size, pincushion: s.pincushion };
  if (s.mode !== 'scan') {
    const f = src.frame;
    const frame = f && { length: f.length, x: f.x.slice(0, f.length), y: f.y.slice(0, f.length), r: f.r.slice(0, f.length), g: f.g.slice(0, f.length), b: f.b.slice(0, f.length), on: f.on.slice(0, f.length) };
    return { settings, tau: src.tau, scan: null, frame };
  }
  return { settings, tau: src.tau, scan: scanWindow(src.scanner, s.exposureShape === 'exp', src.tau, roll), frame: null };
}

// 露光時間内に通った点を、新しい順に写す。ローリングシャッターのときは、
// どの時間の光が写るかを行ごとにGPU側で決めるので、読み出し時間ぶん多めに渡す
function scanWindow(sc: Scanner, isExp: boolean, tau: number, roll: number): ScanWindow {
  const window = (isExp ? tau * 5 : tau) + roll * tau;
  let L = 0;
  while (L < sc.count && sc.scanT - sc.t[sc.index(L)] <= window) L++;
  const w: ScanWindow = {
    count: L,
    x: new Float32Array(L), y: new Float32Array(L), age: new Float32Array(L),
    r: new Uint8Array(L), g: new Uint8Array(L), b: new Uint8Array(L), on: new Uint8Array(L),
  };
  for (let k = 0; k < L; k++) {
    const i = sc.index(k);
    w.x[k] = sc.x[i]; w.y[k] = sc.y[i]; w.age[k] = sc.scanT - sc.t[i];
    w.r[k] = sc.r[i]; w.g[k] = sc.g[i]; w.b[k] = sc.b[i]; w.on[k] = sc.on[i];
  }
  return w;
}
