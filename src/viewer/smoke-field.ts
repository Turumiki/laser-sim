import {
  Camera, LinearFilter, LinearMipmapLinearFilter, Mesh, PlaneGeometry, RepeatWrapping, RGFormat, ShaderMaterial, UnsignedByteType,
  WebGL3DRenderTarget, type Data3DTexture, type WebGLRenderer,
} from 'three';

// 煙が渦を巻いてできる細い糸の模様を、3Dテクスチャに焼いておく。
// 画素ごと・重なった膜ごとに毎回計算すると、高い解像度や膜の多い絵柄でとても重くなるため。
// 模様は一定の周期で繰り返すように作るので、どこまで広い会場でも貼り続けられる。
// 形がゆっくり変わる分は、時刻の違う2枚をなめらかにつなぎ、その間に次の1枚を少しずつ焼いておく

// 繰り返しの周期（糸の模様の座標で）。中で使う倍率 0.3・0.7・0.4 を掛けても整数になる値
export const FIELD_PERIOD = 10;
// 1枚の時刻の間隔（ヘイズの流れを掛けた時間で）
const KEY_STEP = 2;

const BAKE_FRAG = `
  precision highp float;
  uniform float uLayer;
  uniform float uSize;
  uniform float uTime;
  // 格子の番号を周期で折り返してから乱数にする。こうすると模様がちょうど周期で繰り返す
  float hash(vec3 p, float n) {
    p = mod(p, n);
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x, float n) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i, n), hash(i + vec3(1, 0, 0), n), f.x), mix(hash(i + vec3(0, 1, 0), n), hash(i + vec3(1, 1, 0), n), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1), n), hash(i + vec3(1, 0, 1), n), f.x), mix(hash(i + vec3(0, 1, 1), n), hash(i + vec3(1, 1, 1), n), f.x), f.y),
      f.z);
  }
  // 細かい段は倍率を整数にして、周期が崩れないようにする
  float fbm(vec3 p, float n) {
    return 0.5 * noise(p, n) + 0.25 * noise(p * 2.0 + 1.7, n * 2.0) + 0.125 * noise(p * 4.0 + 9.2, n * 4.0);
  }
  void main() {
    float P = ${FIELD_PERIOD.toFixed(1)};
    vec3 pc = vec3(gl_FragCoord.xy, uLayer + 0.5) / uSize * P;
    // 2回歪ませると、糸がくるくると巻き込む（歪み自体も時間でゆっくり変わる）
    float n1 = P * 0.3;
    pc += 2.6 * (vec3(noise(pc * 0.3 + vec3(0.0, 0.0, uTime * 0.25), n1), noise(pc * 0.3 + 5.2, n1), noise(pc * 0.3 + 9.7, n1)) - 0.5);
    float n2 = P * 0.7;
    pc += 1.2 * (vec3(noise(pc * 0.7 + 3.3, n2), noise(pc * 0.7 + 7.1, n2), noise(pc * 0.7 + 1.9, n2)) - 0.5);
    // r: 糸の元になる値（0.5 の所が糸）、g: 糸の太さを決める値
    gl_FragColor = vec4(fbm(pc, P), noise(pc * 0.4 + 8.0, P * 0.4), 0.0, 1.0);
  }`;

// 1層あたりの1マスの大きさ（糸の模様の座標で）
export const FIELD_VOXEL = FIELD_PERIOD / 128;

export class SmokeField {
  // keys[0] と keys[1] の間をつなぐ。keys[2] は次に使う1枚（焼いている途中）
  private keys: { rt: WebGL3DRenderTarget; time: number }[];
  private baked = 0;
  private mat: ShaderMaterial;
  private quad: Mesh;
  private cam = new Camera();
  private started = false;
  readonly uniforms = {
    uField0: { value: null as Data3DTexture | null },
    uField1: { value: null as Data3DTexture | null },
    uFieldMix: { value: 0 },
  };

  constructor(readonly size = 128) {
    const make = () => {
      const rt = new WebGL3DRenderTarget(size, size, size, { format: RGFormat, type: UnsignedByteType, depthBuffer: false });
      const t = rt.texture;
      // 膜の厚みのぶん模様をぼかして読むため、ぼかした段（ミップマップ）も持つ
      t.minFilter = LinearMipmapLinearFilter;
      t.magFilter = LinearFilter;
      t.wrapS = t.wrapT = t.wrapR = RepeatWrapping;
      t.generateMipmaps = true;
      return rt;
    };
    this.keys = [0, 1, 2].map(k => ({ rt: make(), time: k * KEY_STEP }));
    this.mat = new ShaderMaterial({
      uniforms: { uLayer: { value: 0 }, uSize: { value: size }, uTime: { value: 0 } },
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: BAKE_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
  }

  // 毎フレーム呼ぶ。t はヘイズの流れを掛けた時間
  update(renderer: WebGLRenderer, t: number) {
    const prev = renderer.getRenderTarget();
    // VR中は描画が左右の目に分けられてしまうので、焼く間だけVRの扱いを外す
    const xr = renderer.xr.enabled;
    renderer.xr.enabled = false;
    if (!this.started) {
      // ぼかした段の置き場所を確保してから、最初は3枚とも一度に焼く
      for (const k of this.keys) renderer.initRenderTarget(k.rt);
      for (const k of this.keys) this.bake(renderer, k, 0, this.size);
      this.baked = this.size;
      this.started = true;
    }
    let [a, b, next] = this.keys;
    // 時間が戻ったとき（流れを止めて巻き戻すなど）は、最初から焼き直す
    if (t < a.time) {
      a.time = t; b.time = t + KEY_STEP; next.time = t + 2 * KEY_STEP;
      for (const k of this.keys) this.bake(renderer, k, 0, this.size);
      this.baked = this.size;
    }
    // 次の1枚を、残り時間に合わせて少しずつ焼く（間に合わなければ残りを一度に）
    while (t >= b.time) {
      this.bake(renderer, next, this.baked, this.size);
      this.keys = [b, next, a];
      [a, b, next] = this.keys;
      next.time = b.time + KEY_STEP;
      this.baked = 0;
    }
    const left = (b.time - t) / KEY_STEP;
    const want = Math.min(this.size, Math.ceil(this.size * (1 - left) * 1.25) + 1);
    if (want > this.baked) {
      this.bake(renderer, next, this.baked, want);
      this.baked = want;
    }
    renderer.setRenderTarget(prev);
    renderer.xr.enabled = xr;
    this.uniforms.uField0.value = a.rt.texture as unknown as Data3DTexture;
    this.uniforms.uField1.value = b.rt.texture as unknown as Data3DTexture;
    const m = (t - a.time) / KEY_STEP;
    // 端でぴたりと止まらないよう、なめらかにつなぐ
    this.uniforms.uFieldMix.value = m * m * (3 - 2 * m);
  }

  private bake(renderer: WebGLRenderer, key: { rt: WebGL3DRenderTarget; time: number }, from: number, to: number) {
    this.mat.uniforms.uTime.value = key.time;
    for (let z = from; z < to; z++) {
      this.mat.uniforms.uLayer.value = z;
      // ぼかした段は、最後の1層を焼いたときに一度だけ作る（毎層作ると重い）
      key.rt.texture.generateMipmaps = z === this.size - 1;
      renderer.setRenderTarget(key.rt, z);
      renderer.render(this.quad, this.cam);
    }
  }

  dispose() {
    for (const k of this.keys) k.rt.dispose();
    this.mat.dispose();
    this.quad.geometry.dispose();
  }
}
