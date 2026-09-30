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

  // 光を積算する時間（スキャナの時間で秒）
  exposureTime(): number {
    const s = this.store.get();
    // 画面の更新間隔ではなく映像のfpsを基準にする（120Hzの画面でもOBSの60fpsと同じ見え方になるように）
    return s.exposureSync ? s.timeScale / Number(s.fps) : s.exposure / 1000;
  }

  // サーバーの時間軸に合わせる。大きくずれていれば飛ばし、小さければ少しずつ寄せる（動きが跳ねないように）
  syncAnim(target: number | null) {
    if (target === null) return;
    const sc = this.scanner, diff = target - sc.animT;
    if (Math.abs(diff) > 0.5) sc.animT = target;
    else sc.animT += diff * 0.05;
  }

  // ベクター表示用。今の時刻のフレームを組み立てて返す
  currentFrame(): Frame {
    buildFrame(this.frame, this.store.get(), this.scanner.animT);
    return this.frame;
  }
}
