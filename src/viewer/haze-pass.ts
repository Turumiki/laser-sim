import {
  AdditiveBlending, Color, HalfFloatType, LinearFilter, ShaderMaterial, Vector2, WebGLRenderTarget,
  type Camera, type Mesh, type Texture, type WebGLRenderer,
} from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import type { HazeUniforms } from './beams';

// 光の膜は、画面とは別の粗いバッファに描いてから、画面に足す。
// 膜はもともとぼんやりした光なので、高精細な画面（Retinaなど）では見た目の解像度で描いても違いが分からない。
// 何枚も重なる膜の計算が、画素の数のぶん（2倍の画面なら4分の1に）軽くなる。
// 壁や物の手前で光を止める判定は、元の画面の奥行きをそのまま読んで行う

// 膜だけを載せる層。普段の描画（RenderPass）には入らない。VRで使う層（1・2）とは別にする
export const HAZE_LAYER = 5;

export class HazePass extends Pass {
  // 元の画面に対する、膜を描くバッファの大きさの割合
  scale = 1;
  private target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  private quad: FullScreenQuad;
  private res = new Vector2();
  private size = new Vector2(1, 1);
  private clearColor = new Color();

  // depth: 会場の奥行き（ScenePass のもの）
  constructor(private mesh: Mesh, private camera: Camera, private haze: HazeUniforms, private depth: () => Texture | null) {
    super();
    this.needsSwap = false;
    this.target.texture.minFilter = this.target.texture.magFilter = LinearFilter;
    this.quad = new FullScreenQuad(new ShaderMaterial({
      uniforms: { tHaze: { value: this.target.texture } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D tHaze; varying vec2 vUv; void main() { gl_FragColor = vec4(texture(tHaze, vUv).rgb, 1.0); }',
      blending: AdditiveBlending,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }));
  }

  setSize(width: number, height: number) {
    this.size.set(width, height);
    this.target.setSize(Math.max(1, Math.round(width * this.scale)), Math.max(1, Math.round(height * this.scale)));
  }

  setScale(scale: number) {
    this.scale = scale;
    this.setSize(this.size.x, this.size.y);
  }

  render(renderer: WebGLRenderer, _writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget) {
    if (!this.mesh.visible || !this.mesh.parent?.visible) return;
    const mat = this.mesh.material as ShaderMaterial;
    const u = mat.uniforms;
    // 奥行きは自分で比べるので、描画の奥行きテストは切る
    u.tDepth.value = this.depth();
    u.uManualDepth.value = 1;
    u.uHazeRes.value.set(this.target.width, this.target.height);
    mat.depthTest = false;
    // ローリングシャッターの行の計算も、このバッファの大きさで行う
    this.res.copy(this.haze.uRes.value);
    this.haze.uRes.value.set(this.target.width, this.target.height);
    this.camera.layers.enable(HAZE_LAYER);

    renderer.setRenderTarget(this.target);
    renderer.getClearColor(this.clearColor);
    const alpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.render(this.mesh, this.camera);
    renderer.setClearColor(this.clearColor, alpha);

    this.camera.layers.disable(HAZE_LAYER);
    this.haze.uRes.value.copy(this.res);
    mat.depthTest = true;
    u.uManualDepth.value = 0;

    // 足すだけなので、描く前に消さない
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    this.quad.render(renderer);
    renderer.autoClear = autoClear;
  }

  dispose() {
    this.target.dispose();
    (this.quad.material as ShaderMaterial).dispose();
    this.quad.dispose();
  }
}
