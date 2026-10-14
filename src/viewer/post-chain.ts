import { HalfFloatType, Vector2, WebGLRenderTarget, type PerspectiveCamera, type Scene, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { Beams } from './beams';
import { HazePass } from './haze-pass';
import { ScenePass } from './scene-pass';
import { QUALITY, type Quality } from './settings';
import { VolumePass, type VolumeProjector } from './volume';

// スライダーの1をどのくらいの強さにするか
const BLOOM_SCALE = 0.5;
// 映像の描き方の明るさ。点データの見え方とだいたい揃うように合わせた値（クッキーには「クッキー用」の映像を使う）
const VIDEO_GAIN = 36;
// 積算の細かさ（視線に沿って何回調べるか）
// 光の範囲の中だけを調べるので、1台あたりの回数（範囲の外は調べない）
const STEPS: Record<Quality, number> = { high: 40, mid: 24, low: 14 };
// 空間の光を計算する解像度（画面に対する割合）。光の筋はもともとぼやけているので、下げても見た目はほとんど変わらない
const VOLUME_SCALE: Record<Quality, number> = { high: 0.5, mid: 0.35, low: 0.25 };

// にじみは細かさが要らないので、高精細な画面でも見た目の解像度（divisor で割った大きさ）で計算する
class CoarseBloomPass extends UnrealBloomPass {
  constructor(private divisor: number, strength: number) {
    // しきい値を高めにして、ビームの芯のように明るい所だけをにじませる（ヘイズ全体がかすまないように）
    super(new Vector2(1, 1), strength, 0.35, 0.6);
  }

  setSize(width: number, height: number) {
    super.setSize(Math.round(width / this.divisor), Math.round(height / this.divisor));
  }
}

export interface VideoOptions {
  // 光が届く一番遠い距離（m）
  maxDistance: number;
  haze: number;
  flat: number;
  gain: readonly [number, number, number];
}

// 画面に出すまでの処理（会場とビーム → 光の膜 → クッキーの光 → ブルーム → 仕上げ）
export class PostChain {
  private composer: EffectComposer | null = null;
  private volume: VolumePass | null = null;
  private bloom: CoarseBloomPass | null = null;
  private quality: Quality = 'mid';

  constructor(
    private renderer: WebGLRenderer,
    private scene: Scene,
    private camera: PerspectiveCamera,
    private beams: Beams,
  ) {}

  // 画質を変えたら、解像度とアンチエイリアスに合わせて作り直す
  build(quality: Quality, bloom: number) {
    const q = QUALITY[quality];
    this.quality = quality;
    this.dispose();
    this.renderer.setPixelRatio(q.pixelRatio());
    // アンチエイリアスは最初の描画（ScenePass）だけ。後の処理は普通のバッファで行う
    const composer = new EffectComposer(this.renderer, new WebGLRenderTarget(1, 1, { type: HalfFloatType }));
    const scenePass = new ScenePass(this.scene, this.camera, q.samples);
    composer.addPass(scenePass);
    const depth = () => scenePass.depth;
    // 光の膜は、高精細な画面では見た目の解像度（CSSのピクセル）で描いて足す
    const fine = Math.max(1, q.pixelRatio());
    const haze = new HazePass(this.beams.sheetMesh, this.camera, this.beams.haze, depth);
    haze.scale = 1 / fine;
    composer.addPass(haze);
    this.volume = new VolumePass(this.camera, this.beams.haze);
    this.volume.depth = depth;
    this.volume.scale = VOLUME_SCALE[quality];
    this.volume.enabled = false;
    composer.addPass(this.volume);
    this.bloom = new CoarseBloomPass(fine, bloom * BLOOM_SCALE);
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
    this.composer = composer;
    this.setBloom(bloom);
    this.beams.haze.uThick.value = q.thick;
  }

  // ブルームは画面全体を何段もぼかすので重い。画質「低」や強さ0のときは処理ごと止める
  setBloom(level: number) {
    if (!this.bloom) return;
    this.bloom.strength = level * BLOOM_SCALE;
    this.bloom.enabled = level > 0 && this.quality !== 'low';
  }

  setSize(width: number, height: number) {
    this.composer?.setSize(width, height);
  }

  // クッキーの描き方で描く（毎フレーム、台ごとのクッキーを渡す）
  drawVideo(list: readonly VolumeProjector[], opts: VideoOptions) {
    if (!this.volume) return;
    this.volume.enabled = true;
    this.volume.set(list, STEPS[this.quality], opts.maxDistance, opts.haze * VIDEO_GAIN, opts.flat, opts.gain);
  }

  // 点データの描き方に戻す
  stopVideo() {
    if (this.volume) this.volume.enabled = false;
  }

  render() {
    this.composer?.render();
  }

  // 作り直す前に、前のブルームなどが持っていたGPUのメモリを手放す
  dispose() {
    if (!this.composer) return;
    for (const pass of this.composer.passes) pass.dispose();
    this.composer.dispose();
    this.composer = this.volume = this.bloom = null;
  }
}
