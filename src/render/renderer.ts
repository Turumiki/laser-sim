import { STRIDE, type Instances } from './instances';

const SPLAT_VS = `#version 300 es
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 a_seg;
layout(location=2) in vec4 a_ecol;
layout(location=3) in float a_glow;
layout(location=4) in float a_age;
uniform vec2 u_res;
uniform float u_sigma;
uniform float u_sigmaG;
uniform float u_glow;
out vec2 v_local;
flat out float v_len;
flat out float v_e;
flat out vec3 v_col;
flat out float v_glow;
flat out float v_age;
void main() {
  vec2 p0 = a_seg.xy, p1 = a_seg.zw, d = p1 - p0;
  float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float g = a_glow * u_glow;
  float R = 3.0 * (g > 0.0 ? max(u_sigmaG, u_sigma) : u_sigma) + 1.0;
  vec2 local = vec2(a_corner.x < 0.0 ? -R : len + R, a_corner.y * R);
  vec2 world = p0 + dir * local.x + nrm * local.y;
  v_local = local;
  v_len = len;
  v_e = a_ecol.x;
  v_col = a_ecol.yzw;
  v_glow = g;
  v_age = a_age;
  vec2 clip = world / u_res * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

// ビームがこの線分を掃いたときの光量。ガウス分布を線分に沿って積分したもの（erfで解ける）
const SPLAT_FS = `#version 300 es
precision highp float;
in vec2 v_local;
flat in float v_len;
flat in float v_e;
flat in vec3 v_col;
flat in float v_glow;
flat in float v_age;
uniform float u_sigma;
uniform float u_sigmaG;
uniform vec2 u_res;
// ローリングシャッター: x = 読み出し時間（露光時間を1とする。0で無効）, y = 1 なら残像（指数）
uniform vec2 u_roll;
out vec4 o;
float erf1(float x) {
  float s = sign(x);
  x = abs(x);
  float t = 1.0 / (1.0 + 0.3275911 * x);
  float y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-x * x);
  return s * y;
}
float sweep(vec2 q, float len, float s) {
  if (len < 0.5) return exp(-dot(q, q) / (2.0 * s * s)) / (2.5066283 * s);
  float k = 0.70710678 / s;
  float along = 0.5 * (erf1((len - q.x) * k) + erf1(q.x * k));
  return exp(-q.y * q.y / (2.0 * s * s)) * along / len;
}
// 上の行ほど早く撮り終わる。その行が撮っている時間帯に、この線分の光が入るか
float shutter() {
  if (u_roll.x <= 0.0) return 1.0;
  float row = 1.0 - gl_FragCoord.y / u_res.y;
  float a = v_age - (1.0 - row) * u_roll.x;
  if (a < 0.0) return 0.0;
  return u_roll.y > 0.5 ? exp(-a) : step(a, 1.0);
}
void main() {
  float I = sweep(v_local, v_len, u_sigma);
  if (v_glow > 0.0) I += v_glow * 0.12 * sweep(v_local, v_len, u_sigmaG);
  o = vec4(v_col * (v_e * I * shutter()), 1.0);
}`;

const TONE_VS = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// 積んだ光量を映像に変換する。
// 表示用: 強く当たった所は白く飛ぶ（カメラで撮ったレーザーの芯と同じ）
// クッキー用: 光量に比例した値をそのまま sRGB で書く。白に寄せず、上限で頭打ちにするだけ。
//   係数は、1本の線（全出力で描いたシート）が飽和せず、止まったビームは頭打ちになる程度
const TONE_FS = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform float u_exposure;
uniform bool u_linear;
out vec4 o;
vec3 srgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
  vec3 E = texelFetch(u_tex, ivec2(gl_FragCoord.xy), 0).rgb * u_exposure;
  if (u_linear) {
    o = vec4(srgb(clamp(E * 0.25, 0.0, 1.0)), 1.0);
    return;
  }
  float m = max(E.r, max(E.g, E.b));
  E += vec3(max(m - 1.0, 0.0) * 0.4);
  o = vec4(1.0 - exp(-E * 1.3), 1.0);
}`;

export interface DrawParams {
  sigma: number;
  sigmaG: number;
  glow: number;
  exposure: number;
  // クッキー用（光量に比例した値）で書く
  linear: boolean;
  // ローリングシャッターの読み出し時間（露光時間を1とする。0で無効）と、残像（指数）かどうか
  roll: number;
  rollExp: boolean;
  // この矩形の外には描かない [x, y, w, h]（上が原点）
  clip: readonly [number, number, number, number] | null;
}

interface Resources {
  splat: WebGLProgram;
  tone: WebGLProgram;
  vao: WebGLVertexArrayObject;
  instBuf: WebGLBuffer;
  instCap: number;
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  u: Record<string, WebGLUniformLocation | null>;
}

export class LaserRenderer {
  private gl: WebGL2RenderingContext;
  private res: Resources | null = null;
  private w = 0;
  private h = 0;
  private floatTarget = false;
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2が使えません（OBSならブラウザソースのハードウェアアクセラレーションを有効に）');
    this.gl = gl;
    // OBSでソースを隠したときなどにコンテキストが失われることがある
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.res = null; });
    canvas.addEventListener('webglcontextrestored', () => { this.w = this.h = 0; this.init(); });
    this.init();
  }

  private init() {
    const gl = this.gl;
    this.floatTarget = !!gl.getExtension('EXT_color_buffer_float');
    const splat = program(gl, SPLAT_VS, SPLAT_FS);
    const tone = program(gl, TONE_VS, TONE_FS);

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const corners = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const instBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    const bytes = STRIDE * 4;
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, bytes, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, bytes, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, bytes, 32);
    gl.vertexAttribDivisor(3, 1);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, bytes, 36);
    gl.vertexAttribDivisor(4, 1);
    gl.bindVertexArray(null);

    const u: Resources['u'] = {};
    for (const n of ['u_res', 'u_sigma', 'u_sigmaG', 'u_glow', 'u_roll']) u[n] = gl.getUniformLocation(splat, n);
    u.u_tex = gl.getUniformLocation(tone, 'u_tex');
    u.u_exposure = gl.getUniformLocation(tone, 'u_exposure');
    u.u_linear = gl.getUniformLocation(tone, 'u_linear');

    this.res = { splat, tone, vao, instBuf, instCap: 0, tex: gl.createTexture()!, fbo: gl.createFramebuffer()!, u };
  }

  resize(w: number, h: number) {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.canvas.width = w;
    this.canvas.height = h;
    const gl = this.gl, r = this.res;
    if (!r) return;
    gl.bindTexture(gl.TEXTURE_2D, r.tex);
    if (this.floatTarget) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, r.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, r.tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // 書き出し用に一時的に作ったときなど、GPUの資源をすぐ手放す
  dispose() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.res = null;
  }

  draw(inst: Instances, p: DrawParams) {
    const gl = this.gl, r = this.res;
    if (!r || gl.isContextLost()) return;

    gl.bindFramebuffer(gl.FRAMEBUFFER, r.fbo);
    gl.viewport(0, 0, this.w, this.h);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (inst.count > 0) {
      if (p.clip) {
        const [x, y, w, h] = p.clip;
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(x, this.h - y - h, w, h);
      }
      gl.useProgram(r.splat);
      gl.uniform2f(r.u.u_res, this.w, this.h);
      gl.uniform1f(r.u.u_sigma, p.sigma);
      gl.uniform1f(r.u.u_sigmaG, p.sigmaG);
      gl.uniform1f(r.u.u_glow, p.glow);
      gl.uniform2f(r.u.u_roll, p.roll, p.rollExp ? 1 : 0);
      gl.bindVertexArray(r.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, r.instBuf);
      const used = inst.data.subarray(0, inst.count * STRIDE);
      if (inst.data.length > r.instCap) {
        gl.bufferData(gl.ARRAY_BUFFER, inst.data.byteLength, gl.DYNAMIC_DRAW);
        r.instCap = inst.data.length;
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, used);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, inst.count);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
      gl.disable(gl.SCISSOR_TEST);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    gl.useProgram(r.tone);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, r.tex);
    gl.uniform1i(r.u.u_tex, 0);
    gl.uniform1f(r.u.u_exposure, p.exposure);
    gl.uniform1i(r.u.u_linear, p.linear ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader error');
    gl.attachShader(p, sh);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link error');
  return p;
}
