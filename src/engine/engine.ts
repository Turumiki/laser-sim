import { outputSize } from '../core/params';
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

  constructor(canvas: HTMLCanvasElement, store: Store) {
    this.store = store;
    this.sim = new Simulation(store);
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

  render() {
    const s = this.store.get();
    const [W, H] = outputSize(s);
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

    this.inst.clear();
    if (s.mode === 'scan') {
      scanInstances(this.inst, this.scanner, s, view, this.sim.exposureTime());
    } else {
      frameInstances(this.inst, this.sim.currentFrame(), s, view);
    }

    this.renderer.resize(W, H);
    this.renderer.draw(this.inst, {
      sigma: view.sigma,
      sigmaG: view.sigma * 6,
      glow: s.glow,
      exposure: s.bright,
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
