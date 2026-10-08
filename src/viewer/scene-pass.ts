import {
  DepthTexture, HalfFloatType, ShaderMaterial, WebGLRenderTarget,
  type Camera, type Scene, type WebGLRenderer,
} from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';

// 会場とビームの線は、アンチエイリアス（1画素に複数の標本）つきのバッファに描き、
// 後の処理（ヘイズ・ブルーム・仕上げ）には普通のバッファに写して渡す。
// 後の処理まで標本の多いバッファで行うと、画面全体を何度も書くたびに標本の数だけ重くなるため。
// 奥行き（光を壁や物の手前で止める判定に使う）も、このバッファのものを渡す
export class ScenePass extends Pass {
  readonly target: WebGLRenderTarget;
  private quad: FullScreenQuad;

  constructor(private scene: Scene, private camera: Camera, samples: number) {
    super();
    this.needsSwap = false;
    this.target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples });
    this.target.depthTexture = new DepthTexture(1, 1);
    this.quad = new FullScreenQuad(new ShaderMaterial({
      uniforms: { tScene: { value: this.target.texture } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D tScene; varying vec2 vUv; void main() { gl_FragColor = texture(tScene, vUv); }',
      depthTest: false,
      depthWrite: false,
    }));
  }

  get depth() {
    return this.target.depthTexture;
  }

  setSize(width: number, height: number) {
    this.target.setSize(width, height);
  }

  render(renderer: WebGLRenderer, _writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget) {
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    this.target.dispose();
    (this.quad.material as ShaderMaterial).dispose();
    this.quad.dispose();
  }
}
