import {
  HalfFloatType, Matrix4, ShaderMaterial, type PerspectiveCamera, type Texture, Vector2, Vector3, type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import type { Projector } from './beams';
import { SMOKE_GLSL, type HazeUniforms } from './haze-shader';

const MAX = 8;
const COOKIES = 4;

export interface VolumeProjector extends Projector {
  // 最大走査角の半分の tan
  halfTan: number;
  cookie: Texture;
}

const VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

// 空間の光と、壁に映る絵の両方で使う部分
const COMMON = `
  uniform sampler2D tDepth;
  uniform mat4 uInvProj;
  uniform mat4 uInvView;
  uniform vec3 uCam;
  uniform int uCount;
  uniform vec3 uPos[${MAX}];
  uniform vec2 uRot[${MAX}];
  // 上下の傾き（cos, sin）
  uniform vec2 uPitch[${MAX}];
  // ワールドの向き → プロジェクターの向き（左右に振った分と、傾けた分を戻す）
  vec3 toLocal(int j, vec3 v) {
    vec2 cs = uRot[j], ps = uPitch[j];
    float lx = v.x * cs.x - v.z * cs.y, lz = v.x * cs.y + v.z * cs.x;
    return vec3(lx, v.y * ps.x + lz * ps.y, -v.y * ps.y + lz * ps.x);
  }
  uniform float uHalfTan[${MAX}];
  uniform float uMirror[${MAX}];
  uniform int uCookieIndex[${MAX}];
  uniform sampler2D uCk0;
  uniform sampler2D uCk1;
  uniform sampler2D uCk2;
  uniform sampler2D uCk3;
  uniform float uIntensity;
  // 色ごとの明るさ（人の目の感度で見るとき）
  uniform vec3 uGain;
  varying vec2 vUv;

  // lod: どのくらいぼかした段を読むか（0 でそのまま）
  vec3 cookie(int k, vec2 uv, float lod) {
    if (k == 0) return textureLod(uCk0, uv, lod).rgb;
    if (k == 1) return textureLod(uCk1, uv, lod).rgb;
    if (k == 2) return textureLod(uCk2, uv, lod).rgb;
    return textureLod(uCk3, uv, lod).rgb;
  }

  // 点 p がプロジェクター j のクッキーのどこに当たるか。範囲外なら false
  bool project(int j, vec3 p, out vec2 uv, out vec3 rel) {
    rel = p - uPos[j];
    vec3 l = toLocal(j, rel);
    if (l.z > -0.05) return false;
    uv = l.xy / (-l.z) / uHalfTan[j];
    uv.x *= uMirror[j];
    return abs(uv.x) <= 1.0 && abs(uv.y) <= 1.0;
  }

  // 画面の点に写っている物の位置（奥行きから出す）
  vec3 surfacePos() {
    float depth = texture(tDepth, vUv).r;
    vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vp /= vp.w;
    return (uInvView * vp).xyz;
  }
`;

// 映像（クッキー）を投影するスポットライトを、ヘイズの中で積算して描く（Unityのボリュメトリックライトと同じ考え方）。
// 重い計算なので、空間の光は低い解像度で出して引き伸ばし、壁に映る絵だけ元の解像度で足す
export class VolumePass extends Pass {
  // 会場の奥行き。指定がなければ、前の段のバッファの奥行きを使う
  depth: (() => Texture | null) | null = null;
  private volumeQuad: FullScreenQuad;
  private compositeQuad: FullScreenQuad;
  private volumeMat: ShaderMaterial;
  private compositeMat: ShaderMaterial;
  // 今回の光と、前のフレームまでを混ぜた結果（交互に使う）
  private target = new WebGLRenderTarget(1, 1, { type: HalfFloatType });
  private history = [new WebGLRenderTarget(1, 1, { type: HalfFloatType }), new WebGLRenderTarget(1, 1, { type: HalfFloatType })];
  private accumQuad: FullScreenQuad;
  private accumMat: ShaderMaterial;
  private frame = 0;
  private fresh = true;
  private lastView = new Matrix4();
  private lastProj = new Matrix4();
  private camera: PerspectiveCamera;
  // 空間の光を計算する解像度（画面に対する割合）
  scale = 0.35;
  private w = 1;
  private h = 1;

  constructor(camera: PerspectiveCamera, haze: HazeUniforms) {
    super();
    this.camera = camera;
    this.needsSwap = true;
    const shared = {
      tDepth: { value: null },
      uInvProj: { value: new Matrix4() },
      uInvView: { value: new Matrix4() },
      uCam: { value: new Vector3() },
      uCount: { value: 0 },
      uPos: { value: Array.from({ length: MAX }, () => new Vector3()) },
      uRot: { value: Array.from({ length: MAX }, () => new Vector2(1, 0)) },
      uPitch: { value: Array.from({ length: MAX }, () => new Vector2(1, 0)) },
      uHalfTan: { value: new Array(MAX).fill(0.36) },
      uMirror: { value: new Array(MAX).fill(1) },
      uCookieIndex: { value: new Array(MAX).fill(0) },
      uCk0: { value: null }, uCk1: { value: null }, uCk2: { value: null }, uCk3: { value: null },
      uIntensity: { value: 1 },
      uGain: { value: new Vector3(1, 1, 1) },
    };

    this.volumeMat = new ShaderMaterial({
      // ヘイズのむらは、作り置きのノイズと焼いておいた糸の模様を読むだけにする（1画素で何十回も調べるので）
      uniforms: { ...haze, ...shared, uFrame: { value: 0 }, uSteps: { value: 24 }, uMaxT: { value: 60 }, uLod: { value: 1.5 }, uFlat: { value: 0 } },
      vertexShader: VERTEX,
      fragmentShader: SMOKE_GLSL + COMMON + `
        uniform float uSteps;
        uniform float uMaxT;
        uniform float uLod;
        uniform float uFlat;
        uniform float uFrame;

        // 隣り合う画素で偏りにくいノイズ（インターリーブド・グラディエント・ノイズ）。フレームごとにずらす
        float ign(vec2 p) {
          return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
        }

        // a + b*t <= 0 を満たす t だけに区間を狭める
        void clipT(float a, float b, inout float t0, inout float t1) {
          if (abs(b) < 1e-6) {
            if (a > 0.0) t1 = -1.0;
            return;
          }
          float t = -a / b;
          if (b > 0.0) t1 = min(t1, t); else t0 = max(t0, t);
        }

        void main() {
          vec3 wp = surfacePos();
          vec3 dir = normalize(wp - uCam);
          float tEnd = min(distance(wp, uCam), uMaxT);
          float jitter = ign(gl_FragCoord.xy + uFrame * vec2(5.588238, 3.1));
          vec3 acc = vec3(0.0);
          for (int j = 0; j < ${MAX}; j++) {
            if (j >= uCount) break;
            // 視線をプロジェクターの向きに直す。光の範囲（四角錐）に入って出るまでの区間を式で求め、その中だけを調べる
            vec3 a = uCam - uPos[j];
            vec3 la = toLocal(j, a);
            vec3 lb = toLocal(j, dir);
            float h = uHalfTan[j];
            float t0 = 0.0, t1 = tEnd;
            clipT(la.z, lb.z, t0, t1);
            clipT(la.x + h * la.z, lb.x + h * lb.z, t0, t1);
            clipT(-la.x + h * la.z, -lb.x + h * lb.z, t0, t1);
            clipT(la.y + h * la.z, lb.y + h * lb.z, t0, t1);
            clipT(-la.y + h * la.z, -lb.y + h * lb.z, t0, t1);
            if (t1 <= t0) continue;
            float dt = (t1 - t0) / uSteps;
            for (int i = 0; i < 64; i++) {
              if (float(i) >= uSteps) break;
              float t = t0 + (float(i) + jitter) * dt;
              vec3 l = la + lb * t;
              vec2 uv = l.xy / (-l.z) / h;
              uv.x *= uMirror[j];
              vec3 rel = a + dir * t;
              vec3 p = uCam + dir * t;
              float dens = mix(1.0, smoke1(p, 0.0), uSmoke);
              // スポットライトは距離の2乗で弱まる。細い線を取りこぼさないよう、少しぼかした段を読む。
              // uFlat を上げると遠くの減衰を弱める（1で距離に反比例。4mの所は変わらない）
              float r2 = max(dot(rel, rel), 0.25);
              acc += cookie(uCookieIndex[j], clamp(uv * 0.5 + 0.5, 0.0, 1.0), uLod) * airlight(rel, dir) * dens
                * pow(r2 / 16.0, 0.5 * uFlat) / r2 * dt;
            }
          }
          gl_FragColor = vec4(acc * uGain * uIntensity, 1.0);
        }`,
    });

    this.compositeMat = new ShaderMaterial({
      uniforms: { ...haze, ...shared, tDiffuse: { value: null }, tVolume: { value: null }, uTexel: { value: new Vector2(1, 1) } },
      vertexShader: VERTEX,
      fragmentShader: `uniform float uExt;\n` + COMMON + `
        uniform sampler2D tDiffuse;
        uniform sampler2D tVolume;
        uniform vec2 uTexel;
        // 低い解像度の光を引き伸ばすとき、斜め4点を混ぜてつぶつぶを目立たなくする
        vec3 volume() {
          vec2 o = uTexel * 0.75;
          return (texture(tVolume, vUv + vec2(o.x, o.y)).rgb + texture(tVolume, vUv + vec2(-o.x, o.y)).rgb
            + texture(tVolume, vUv + vec2(o.x, -o.y)).rgb + texture(tVolume, vUv - o).rgb) * 0.25;
        }
        void main() {
          vec3 wp = surfacePos();
          vec3 dir = normalize(wp - uCam);
          // 壁や床に映る絵（元の解像度で）
          vec3 lit = vec3(0.0);
          for (int j = 0; j < ${MAX}; j++) {
            if (j >= uCount) break;
            vec2 uv; vec3 rel;
            if (!project(j, wp - dir * 0.02, uv, rel)) continue;
            float r2 = dot(rel, rel);
            lit += cookie(uCookieIndex[j], uv * 0.5 + 0.5, 0.0) * exp(-uExt * sqrt(r2)) / max(r2, 0.25);
          }
          vec3 base = texture(tDiffuse, vUv).rgb;
          gl_FragColor = vec4(base + volume() + lit * uGain * uIntensity * 6.0, 1.0);
        }`,
    });
    // 両方の材質で同じ値を使う
    for (const k of Object.keys(shared)) this.compositeMat.uniforms[k] = this.volumeMat.uniforms[k];

    // 調べる位置をフレームごとに変えているので、前の結果と混ぜると粒々が平均されて滑らかになる
    this.accumMat = new ShaderMaterial({
      uniforms: { tCur: { value: null }, tHist: { value: null }, uAlpha: { value: 1 }, uTexel: { value: new Vector2(1, 1) } },
      vertexShader: VERTEX,
      fragmentShader: `
        uniform sampler2D tCur;
        uniform sampler2D tHist;
        uniform float uAlpha;
        uniform vec2 uTexel;
        varying vec2 vUv;
        void main() {
          // 前の結果は、今のまわり3×3の明るさの範囲（平均±ばらつき）に収める。
          // 粒は均されるが、もう光がない所に前の光が残らない（速く動くドットが尾を引かない）
          vec3 m1 = vec3(0.0), m2 = vec3(0.0);
          for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
              vec3 c = texture(tCur, vUv + vec2(x, y) * uTexel).rgb;
              m1 += c;
              m2 += c * c;
            }
          }
          m1 /= 9.0;
          vec3 sd = sqrt(max(m2 / 9.0 - m1 * m1, 0.0));
          vec3 hist = clamp(texture(tHist, vUv).rgb, m1 - sd * 1.25, m1 + sd * 1.25);
          gl_FragColor = vec4(mix(hist, texture(tCur, vUv).rgb, uAlpha), 1.0);
        }`,
    });
    this.accumQuad = new FullScreenQuad(this.accumMat);
    this.volumeQuad = new FullScreenQuad(this.volumeMat);
    this.compositeQuad = new FullScreenQuad(this.compositeMat);
  }

  set(projectors: readonly VolumeProjector[], steps: number, maxT: number, intensity: number, flat: number, gain: readonly number[]) {
    const u = this.volumeMat.uniforms;
    const cookies: Texture[] = [];
    const list = projectors.slice(0, MAX);
    u.uCount.value = list.length;
    list.forEach((p, i) => {
      let k = cookies.indexOf(p.cookie);
      if (k < 0 && cookies.length < COOKIES) k = cookies.push(p.cookie) - 1;
      u.uPos.value[i].set(p.pos[0], p.pos[1], p.pos[2]);
      u.uRot.value[i].set(Math.cos(p.yaw), Math.sin(p.yaw));
      u.uPitch.value[i].set(Math.cos(p.pitch ?? 0), Math.sin(p.pitch ?? 0));
      u.uHalfTan.value[i] = p.halfTan;
      u.uMirror.value[i] = p.mirror ? -1 : 1;
      u.uCookieIndex.value[i] = Math.max(0, k);
    });
    for (let k = 0; k < COOKIES; k++) u[`uCk${k}`].value = cookies[k] ?? cookies[0] ?? null;
    u.uSteps.value = steps;
    u.uMaxT.value = maxT;
    u.uIntensity.value = intensity;
    u.uFlat.value = flat;
    u.uGain.value.set(gain[0], gain[1], gain[2]);
  }

  setSize(width: number, height: number) {
    this.w = width;
    this.h = height;
    const w = Math.max(1, Math.round(width * this.scale)), h = Math.max(1, Math.round(height * this.scale));
    this.target.setSize(w, h);
    for (const t of this.history) t.setSize(w, h);
    this.fresh = true;
  }

  setScale(scale: number) {
    this.scale = scale;
    this.setSize(this.w, this.h);
  }

  render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget) {
    const u = this.volumeMat.uniforms;
    u.tDepth.value = this.depth?.() ?? readBuffer.depthTexture;
    u.uInvProj.value.copy(this.camera.projectionMatrixInverse);
    u.uInvView.value.copy(this.camera.matrixWorld);
    u.uCam.value.setFromMatrixPosition(this.camera.matrixWorld);

    u.uFrame.value = this.frame++ % 64;
    renderer.setRenderTarget(this.target);
    this.volumeQuad.render(renderer);

    // カメラが動いている間は前の結果をあまり混ぜない（残像にならないように）
    const moved = !this.lastView.equals(this.camera.matrixWorld) || !this.lastProj.equals(this.camera.projectionMatrix);
    this.lastView.copy(this.camera.matrixWorld);
    this.lastProj.copy(this.camera.projectionMatrix);
    const [prev, next] = this.history;
    const a = this.accumMat.uniforms;
    a.tCur.value = this.target.texture;
    a.tHist.value = prev.texture;
    a.uAlpha.value = this.fresh ? 1 : moved ? 0.6 : 0.25;
    a.uTexel.value.set(1 / this.target.width, 1 / this.target.height);
    this.fresh = false;
    renderer.setRenderTarget(next);
    this.accumQuad.render(renderer);
    this.history.reverse();

    const c = this.compositeMat.uniforms;
    c.tDiffuse.value = readBuffer.texture;
    c.tVolume.value = next.texture;
    c.uTexel.value.set(1 / next.width, 1 / next.height);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.compositeQuad.render(renderer);
  }

  dispose() {
    this.volumeMat.dispose();
    this.compositeMat.dispose();
    this.volumeQuad.dispose();
    this.compositeQuad.dispose();
    this.accumMat.dispose();
    this.accumQuad.dispose();
    this.target.dispose();
    for (const t of this.history) t.dispose();
  }
}
