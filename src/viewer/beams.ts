import {
  AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, Group, LineSegments, Mesh,
  ShaderMaterial, Vector2, type Data3DTexture,
} from 'three';
import type { Frame } from '../core/frame';
import type { Settings } from '../core/params';
import type { Scanner } from '../core/scanner';
import { BeamGeometry, CAPACITY, type Arrays, type BeamSource, type Projector, type Rig, type ScanWindow } from './beam-geometry';
import type { Built, WorkerRequest, WorkerResult } from './beam-worker';
import type { Surfaces } from './surfaces';
import { smokeTexture } from './noise';
import { FIELD_PERIOD, FIELD_VOXEL, SmokeField } from './smoke-field';
import { HAZE_LAYER } from './haze-pass';

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
  // 煙の糸の模様（smoke-field.ts で焼いたもの）。時刻の違う2枚をつないで、形をゆっくり変える
  uniform highp sampler3D uField0;
  uniform highp sampler3D uField1;
  uniform float uFieldMix;
  vec2 field(vec3 q, float lod) {
    return mix(textureLod(uField0, q, lod).rg, textureLod(uField1, q, lod).rg, uFieldMix);
  }
  // ヘイズの濃さ（平均1）。大きくゆるいむら・流れに沿った筋に加えて、
  // 煙が渦を巻いてできる細い糸（光の膜の上では、渦巻く暗い筋に見える）を重ねる。
  // 空調や送風で横に流され、熱で上の方に少し溜まる。uTime は流れの速さを掛けた時間
  // blur: どれだけの幅（m）でならして読むか。光の膜の厚みのぶん、模様はならされて見える
  float smoke1(vec3 w, float blur) {
    vec3 flow = vec3(uTime * 0.25, uTime * 0.02, -uTime * 0.15);
    vec3 pl = (w + flow) * uGrain * 0.15;
    vec3 pm = (w + flow * 1.6) * uGrain * vec3(0.35, 1.2, 0.35);
    pm += 0.6 * (tex(pm * 0.35 + vec3(0.0, 0.0, uTime * 0.12)) - 0.5);
    float large = tex(pl);
    float mid = tex(pm);
    // 糸の模様は周期 ${FIELD_PERIOD} で焼いてあるので、その周期で割って読む。細かい糸は同じ模様を2倍の細かさで読む
    vec3 q = (w + flow * 1.4) * uGrain * 2.2 / ${FIELD_PERIOD.toFixed(1)};
    // ならす幅が焼いた模様の何マスぶんか。その分ぼかした段を読む。
    // そのままでは遠くの膜で糸が消えて染みのようになるので、ぼかしは控えめにして2段までにする
    float lod = clamp(log2(max(1.0, blur * uGrain * 2.2 / ${FIELD_VOXEL.toFixed(6)})) - 2.0, 0.0, 2.0);
    vec2 f = field(q, lod);
    float c2 = field(q * 2.0 + 0.37, lod + 1.0).r;
    // ノイズの値は0.5のまわりに集まるので、振れ幅を大きめに取る
    float d = 1.0 + 1.4 * (large - 0.5) + 1.6 * (mid - 0.5);
    // ノイズがちょうど真ん中になる所を、煙の糸として取り出す（糸の所は煙が薄く、暗く見える）。
    // 糸の太さは場所によって変える（太く柔らかい筋から細い筋まで）。細かい糸も少し重ねる
    float w1 = mix(0.03, 0.16, smoothstep(0.35, 0.65, f.g));
    float t1 = smoothstep(0.0, w1, abs(f.r - 0.5));
    float t2 = smoothstep(0.0, 0.05, abs(c2 - 0.5));
    d *= mix(0.3, 1.1, t1) * mix(0.7, 1.04, t2);
    // 上の方ほど少し濃い（10m上で1割ほど）
    return max(0.0, d * (1.0 + 0.01 * w.y));
  }
  // 光の膜には厚みがある（遠いほどビームが広がって厚い）。視線に沿って厚みの中を数か所測って平均する
  // w: 空間での位置、r: 光源からの距離
  float smoke(vec3 w, vec3 viewDir, float r) {
    float thick = 0.03 + 0.05 * r;
    // 厚みの中を何か所も測る代わりに、厚みのぶんぼかした模様を1回読む
    return mix(1.0, smoke1(w, uThick > 0.5 ? thick : 0.0), uSmoke);
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
  uField0: { value: Data3DTexture | null };
  uField1: { value: Data3DTexture | null };
  uFieldMix: { value: number };
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
// 普段は粗いバッファに描く（haze-pass.ts）。そのときは奥行きを自分で比べて、壁や物の奥を描かない
const sheetMaterial = (uniforms: HazeUniforms) => new ShaderMaterial({
  ...additive,
  side: DoubleSide,
  uniforms: { ...uniforms, tDepth: { value: null }, uManualDepth: { value: 0 }, uHazeRes: { value: new Vector2(1, 1) } },
  vertexShader: beamVertex,
  fragmentShader: SMOKE_GLSL + SHUTTER_GLSL + `
    uniform sampler2D tDepth;
    uniform float uManualDepth;
    uniform vec2 uHazeRes;
    varying vec3 vColor;
    varying vec3 vView;
    varying vec3 vWorld;
    varying vec3 vRel;
    varying vec3 vEye;
    void main() {
      if (uManualDepth > 0.5 && gl_FragCoord.z > texture(tDepth, gl_FragCoord.xy / uHazeRes).r) discard;
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
      // カメラへの視線に沿って、ほんの少しだけ手前に寄せる。画面上の位置は変わらず、面に埋もれない
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      mv.xyz *= 0.999;
      gl_Position = projectionMatrix * mv;
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
  private sheets = new GpuBuffer(CAPACITY.sheets, 3);
  private rays = new GpuBuffer(CAPACITY.rays, 2);
  private wall = new GpuBuffer(CAPACITY.wall, 2);
  private projectors: readonly Projector[] = [{ pos: [0, 0, 0], yaw: 0, mirror: false }];
  private rig: Rig;
  private surfaces: Surfaces;
  // 煙の糸の模様。毎フレーム update() で少しずつ焼き進める
  readonly field = new SmokeField();
  readonly sheetMesh: Mesh;
  readonly haze: HazeUniforms = { uTime: { value: 0 }, uSmoke: { value: 0.6 }, uGrain: { value: 0.6 }, uExt: { value: 0.015 }, uThick: { value: 1 }, uNoise: { value: smokeTexture() }, ...this.field.uniforms, uRoll: { value: new Vector2() }, uRes: { value: new Vector2(1, 1) } };

  private worker: Worker | null = null;
  // Worker が計算中（結果を待っている間は次を頼まない）
  private busy = false;
  // Worker に伝えた会場の版
  private sentVersion = -1;
  // 写し終わった入れ物。次に頼むときに Worker へ返す
  private recycle: ArrayBuffer[] = [];
  // Worker が使えないときは、同じ計算をここで行う
  private local: BeamGeometry | null = null;
  // 計測用（?stats=1）: ビームの形を作るのにかかった時間と、1秒あたりの更新回数
  calcMs = 0;
  updates = 0;

  constructor(rig: Rig, surfaces: Surfaces) {
    this.rig = rig;
    this.surfaces = surfaces;
    // 光の膜は、粗いバッファに分けて描くため専用の層に置く（VRでは普段の描画に含める）
    this.sheetMesh = new Mesh(this.sheets.geo, sheetMaterial(this.haze));
    this.sheetMesh.layers.set(HAZE_LAYER);
    this.group.add(
      this.sheetMesh,
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

  // Worker で計算しているか（計測の表示用）
  get threaded() {
    return !!this.worker;
  }

  setProjectors(list: readonly Projector[]) {
    this.projectors = list.length ? list : this.projectors;
  }

  draw(sources: readonly Source[]) {
    const rig = { ...this.rig }, ext = this.haze.uExt.value;
    if (!this.worker) {
      const g = this.local ?? (this.local = new BeamGeometry(this.surfaces.hits));
      const t0 = performance.now();
      g.draw(this.projectors, sources.map(s => material(s, rig.roll)), rig, ext);
      const load = (buf: GpuBuffer, a: Arrays) => buf.load(a.count, [a.pos, a.col, a.org, a.age]);
      load(this.sheets, g.sheets);
      load(this.rays, g.rays);
      load(this.wall, g.wall);
      this.calcMs += (performance.now() - t0 - this.calcMs) * 0.1;
      this.updates++;
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
    this.calcMs += (r.ms - this.calcMs) * 0.1;
    this.updates++;
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
