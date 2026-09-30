import { buildFrame } from '../core/build';
import { Frame } from '../core/frame';
import { Scanner } from '../core/scanner';
import type { Store } from '../core/store';

// 描画方法に依存しない部分。2Dの出力と3Dのビューアで共有する
export class Simulation {
  readonly scanner: Scanner;
  readonly frame = new Frame();
  private store: Store;

  constructor(store: Store) {
    this.store = store;
    this.scanner = new Scanner((out, t) => buildFrame(out, this.store.get(), t));
  }

  update(dt: number) {
    const s = this.store.get();
    if (s.paused) return;
    const scanDt = dt * s.timeScale;
    if (s.mode === 'scan') this.scanner.step(scanDt, s);
    else this.scanner.advance(scanDt, s.animSpeed);
  }

  // ベクター表示用。今の時刻のフレームを組み立てて返す
  currentFrame(): Frame {
    buildFrame(this.frame, this.store.get(), this.scanner.animT);
    return this.frame;
  }
}
