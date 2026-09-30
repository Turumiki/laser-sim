import { outputSize, type Look } from '../core/params';
import type { Store } from '../core/store';
import { Instances, frameInstances, scanInstances, type View } from '../render/instances';
import { LaserRenderer } from '../render/renderer';
import { Simulation } from './simulation';

// シミュレーションと2D描画をまとめたもの。時間は外から渡す（リアルタイムでも書き出しでも同じ）
export class Engine {
  readonly sim: Simulation;
  private renderer: LaserRenderer;
  private inst = new Instances();
  private store: Store;

  // sim を渡すと、そのシミュレーションを描くだけにする（3Dビューアで同じ動きを映像にするとき）
  constructor(canvas: HTMLCanvasElement, store: Store, sim?: Simulation) {
    this.store = store;
    this.sim = sim ?? new Simulation(store);
    this.renderer = new LaserRenderer(canvas);
  }

  get size() {
    return outputSize(this.store.get());
  }

  get scanner() {
    return this.sim.scanner;
  }

  update(dt: number) {
    this.sim.update(dt);
  }

  // size を渡すと、出力サイズの代わりにそのサイズで描く。look を渡すと用途の設定より優先する
  render(size?: readonly [number, number], look?: Look) {
    const s = this.store.get();
    const linear = (look ?? s.look) === 'source';
    const [W, H] = size ?? outputSize(s);
    const side = Math.min(W, H);
    // 太さはFHD基準のpx。解像度が変わっても見た目の比率は同じにする
    const px = side / 1080;
    const view: View = {
      cx: W / 2,
      cy: H / 2,
      unit: side / 2 * s.size,
      sigma: s.beam / 2.355 * px,
      lref: 2500 * px,
    };

    // ローリングシャッターはカメラの写り方なので、クッキー用には入れない
    const tau = this.sim.exposureTime();
    const roll = s.rolling && s.mode === 'scan' && !linear ? s.readout / 1000 * s.timeScale / tau : 0;
    this.inst.clear();
    if (s.mode === 'scan') {
      scanInstances(this.inst, this.scanner, s, view, tau, roll);
    } else {
      frameInstances(this.inst, this.sim.currentFrame(), s, view);
    }

    this.renderer.resize(W, H);
    this.renderer.draw(this.inst, {
      sigma: view.sigma,
      sigmaG: view.sigma * 6,
      glow: linear ? 0 : s.glow,
      exposure: s.bright,
      linear,
      roll,
      rollExp: s.exposureShape === 'exp',
      clip: s.clip ? [(W - side) / 2, (H - side) / 2, side, side] : null,
    });
  }

  dispose() {
    this.renderer.dispose();
  }

  get segments() {
    return this.inst.count;
  }
}
