import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from 'three';
import type { Store } from '../core/store';
import { Engine } from '../engine/engine';
import type { Simulation } from '../engine/simulation';

interface Cookie {
  engine: Engine;
  texture: CanvasTexture;
}

// チャンネルごとの「Unityに渡すのと同じ映像」。レーザーの描画範囲（正方形）をクッキーとして使う。
// シミュレーションは3Dビューアのものを使い回すので、ベクター表示と同じ動きになる
export class Cookies {
  private map = new Map<Simulation, Cookie>();
  size = 512;

  get(store: Store, sim: Simulation): CanvasTexture {
    let c = this.map.get(sim);
    if (!c) {
      const canvas = document.createElement('canvas');
      const engine = new Engine(canvas, store, sim);
      engine.render([this.size, this.size]);
      const texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      // 空間の光は、少しぼかした段（ミップマップ）を読む。細いレーザーの線を取りこぼさないように
      texture.minFilter = LinearMipmapLinearFilter;
      texture.magFilter = LinearFilter;
      texture.generateMipmaps = true;
      c = { engine, texture };
      this.map.set(sim, c);
    }
    return c.texture;
  }

  // 使っているチャンネルの映像を描き直す。使わなくなったものは手放す
  update(using: Set<Simulation>) {
    for (const [sim, c] of this.map) {
      if (!using.has(sim)) {
        c.texture.dispose();
        c.engine.dispose();
        this.map.delete(sim);
        continue;
      }
      c.engine.render([this.size, this.size]);
      c.texture.needsUpdate = true;
    }
  }
}
