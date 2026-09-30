import { Matrix4, ShaderMaterial, type PerspectiveCamera, type Texture, Vector2, Vector3, type WebGLRenderer, type WebGLRenderTarget } from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import type { Projector } from './beams';
import { SMOKE_GLSL, type HazeUniforms } from './beams';

const MAX = 8;
const COOKIES = 4;

export interface VolumeProjector extends Projector {
  // 最大走査角の半分の tan
  halfTan: number;
  cookie: Texture;
}

// 映像（クッキー）を投影するスポットライトを、ヘイズの中で積算して描く（Unityのボリュメトリックライトと同じ考え方）。
// 画面の1点ごとに視線に沿って進み、各点がクッキーのどの画素に当たるかを調べて光を足していく
export class VolumePass extends Pass {
  private quad: FullScreenQuad;
  private mat: ShaderMaterial;
  private camera: PerspectiveCamera;

  constructor(camera: PerspectiveCamera, haze: HazeUniforms) {
    super();
    this.camera = camera;
    this.needsSwap = true;
    this.mat = new ShaderMaterial({
      uniforms: {
        ...haze,
        tDiffuse: { value: null },
        tDepth: { value: null },
        uInvProj: { value: new Matrix4() },
        uInvView: { value: new Matrix4() },
        uCam: { value: new Vector3() },
        uCount: { value: 0 },
        uPos: { value: Array.from({ length: MAX }, () => new Vector3()) },
        uRot: { value: Array.from({ length: MAX }, () => new Vector2(1, 0)) },
        uHalfTan: { value: new Array(MAX).fill(0.36) },
        uMirror: { value: new Array(MAX).fill(1) },
        uCookieIndex: { value: new Array(MAX).fill(0) },
        uCk0: { value: null }, uCk1: { value: null }, uCk2: { value: null }, uCk3: { value: null },
        uSteps: { value: 48 },
        uMaxT: { value: 60 },
        uIntensity: { value: 1 },
        uLod: { value: 2.5 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: SMOKE_GLSL + `
        uniform sampler2D tDiffuse;
        uniform sampler2D tDepth;
        uniform mat4 uInvProj;
        uniform mat4 uInvView;
        uniform vec3 uCam;
        uniform int uCount;
        uniform vec3 uPos[${MAX}];
        uniform vec2 uRot[${MAX}];
        uniform float uHalfTan[${MAX}];
        uniform float uMirror[${MAX}];
        uniform int uCookieIndex[${MAX}];
        uniform sampler2D uCk0;
        uniform sampler2D uCk1;
        uniform sampler2D uCk2;
        uniform sampler2D uCk3;
        uniform float uSteps;
        uniform float uMaxT;
        uniform float uIntensity;
        uniform float uLod;
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
          float lx = rel.x * uRot[j].x - rel.z * uRot[j].y;
          float lz = rel.x * uRot[j].y + rel.z * uRot[j].x;
          if (lz > -0.05) return false;
          uv = vec2(lx, rel.y) / (-lz) / uHalfTan[j];
          uv.x *= uMirror[j];
          return abs(uv.x) <= 1.0 && abs(uv.y) <= 1.0;
        }

        void main() {
          vec3 base = texture(tDiffuse, vUv).rgb;
          float depth = texture(tDepth, vUv).r;
          vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
          vp /= vp.w;
          vec3 wp = (uInvView * vp).xyz;
          vec3 dir = normalize(wp - uCam);
          float surf = distance(wp, uCam);
          float tEnd = min(surf, uMaxT);
          float dt = tEnd / uSteps;
          // 段差の縞が出ないよう、進み始めを画素ごとに少しずらす
          float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);

          vec3 acc = vec3(0.0);
          for (int i = 0; i < 128; i++) {
            if (float(i) >= uSteps) break;
            vec3 p = uCam + dir * ((float(i) + jitter) * dt);
            float dens = mix(1.0, smoke1(p) * 1.7, uSmoke);
            for (int j = 0; j < ${MAX}; j++) {
              if (j >= uCount) break;
              vec2 uv; vec3 rel;
              if (!project(j, p, uv, rel)) continue;
              // スポットライトは距離の2乗で弱まる
              acc += cookie(uCookieIndex[j], uv * 0.5 + 0.5, uLod) * airlight(rel, dir) * dens / max(dot(rel, rel), 0.25);
            }
          }
          acc *= dt * uIntensity;

          // 壁や床に映る絵
          vec3 lit = vec3(0.0);
          if (surf < uMaxT) {
            for (int j = 0; j < ${MAX}; j++) {
              if (j >= uCount) break;
              vec2 uv; vec3 rel;
              if (!project(j, wp - dir * 0.02, uv, rel)) continue;
              float r2 = dot(rel, rel);
              lit += cookie(uCookieIndex[j], uv * 0.5 + 0.5, 0.0) * exp(-uExt * sqrt(r2)) / max(r2, 0.25);
            }
          }
          gl_FragColor = vec4(base + acc + lit * uIntensity * 6.0, 1.0);
        }`,
    });
    this.quad = new FullScreenQuad(this.mat);
  }

  set(projectors: readonly VolumeProjector[], steps: number, maxT: number, intensity: number) {
    const u = this.mat.uniforms;
    const cookies: Texture[] = [];
    const list = projectors.slice(0, MAX);
    u.uCount.value = list.length;
    list.forEach((p, i) => {
      let k = cookies.indexOf(p.cookie);
      if (k < 0 && cookies.length < COOKIES) k = cookies.push(p.cookie) - 1;
      u.uPos.value[i].set(p.pos[0], p.pos[1], p.pos[2]);
      u.uRot.value[i].set(Math.cos(p.yaw), Math.sin(p.yaw));
      u.uHalfTan.value[i] = p.halfTan;
      u.uMirror.value[i] = p.mirror ? -1 : 1;
      u.uCookieIndex.value[i] = Math.max(0, k);
    });
    for (let k = 0; k < COOKIES; k++) u[`uCk${k}`].value = cookies[k] ?? cookies[0] ?? null;
    u.uSteps.value = steps;
    u.uMaxT.value = maxT;
    u.uIntensity.value = intensity;
  }

  render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget) {
    const u = this.mat.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tDepth.value = readBuffer.depthTexture;
    u.uInvProj.value.copy(this.camera.projectionMatrixInverse);
    u.uInvView.value.copy(this.camera.matrixWorld);
    u.uCam.value.setFromMatrixPosition(this.camera.matrixWorld);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    this.mat.dispose();
    this.quad.dispose();
  }
}
