import {
  AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, Group, LineSegments, Mesh,
  ShaderMaterial, Vector2,
} from 'three';
import type { Frame } from '../core/frame';
import type { Settings } from '../core/params';
import type { Scanner } from '../core/scanner';
import { BeamGeometry, CAPACITY, type Arrays, type BeamSource, type Projector, type Rig, type ScanWindow } from './beam-geometry';
import type { Built, WorkerRequest, WorkerResult } from './beam-worker';
import type { Surfaces } from './surfaces';
import { smokeTexture } from './noise';
import { SmokeField } from './smoke-field';
import { HAZE_LAYER, SHUTTER_GLSL, SMOKE_GLSL, type HazeUniforms } from './haze-shader';

export type { Projector, Rig } from './beam-geometry';

// あるチャンネルの今の状態（設定とシミュレーション）。Worker に渡す前の、画面側での材料
export interface ChannelSnapshot {
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
  readonly sheetMesh: Mesh<BufferGeometry, ShaderMaterial>;
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

  draw(sources: readonly ChannelSnapshot[]) {
    const rig = { ...this.rig }, ext = this.haze.uExt.value;
    if (!this.worker) {
      const g = this.local ?? (this.local = new BeamGeometry(this.surfaces.hits));
      const t0 = performance.now();
      g.draw(this.projectors, sources.map(s => toBeamSource(s, rig.roll)), rig, ext);
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
    this.post({ type: 'draw', projectors: this.projectors.map(p => ({ ...p })), sources: sources.map(s => toBeamSource(s, rig.roll)), rig, ext, recycle }, recycle);
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    for (const o of this.group.children) {
      const m = o as Mesh | LineSegments;
      m.geometry.dispose();
      (m.material as ShaderMaterial).dispose();
    }
    this.field.dispose();
    this.haze.uNoise.value.dispose();
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
function toBeamSource(src: ChannelSnapshot, roll: number): BeamSource {
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
