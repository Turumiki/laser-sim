import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, canEncodeVideo } from 'mediabunny';
import { outputSize, sanitize, type Settings } from '../core/params';
import { locate, type Show } from '../core/show';
import { Store } from '../core/store';
import { Engine } from '../engine/engine';

export interface ExportOptions {
  seconds: number;
  fps: number;
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
  // 指定があれば、ショーの流れに沿って設定を切り替えながら書き出す
  show?: Show;
}

// 設定をその時点で固定し、t=0 から1コマずつ計算して書き出す。
// 画面の描画とは別に回すので、処理が重くてもコマ落ちしない
export async function exportVideo(settings: Readonly<Settings>, opts: ExportOptions): Promise<Blob> {
  const [w, h] = outputSize(settings);
  if (!(await canEncodeVideo('avc', { width: w, height: h }))) {
    throw new Error('このブラウザはH.264での書き出しに対応していません（Chrome推奨）');
  }

  const canvas = document.createElement('canvas');
  const store = new Store({ ...settings, paused: false });
  const engine = new Engine(canvas, store);
  let step = -1;
  try {
    engine.render();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    // 黒地に細い線なので、圧縮で線が崩れないよう高めのビットレートにする（FHDで約40Mbps）
    const bitrate = Math.round(40e6 * (w * h) / (1920 * 1080));
    const source = new CanvasSource(canvas, { codec: 'avc', bitrate, keyFrameInterval: 1 });
    output.addVideoTrack(source, { frameRate: opts.fps });
    await output.start();

    const n = Math.round(opts.seconds * opts.fps), dt = 1 / opts.fps;
    for (let i = 0; i < n; i++) {
      if (opts.signal?.aborted) {
        await output.cancel();
        throw new DOMException('中止しました', 'AbortError');
      }
      if (opts.show) {
        const pos = locate(opts.show, i * dt);
        if (pos && pos.index !== step) {
          step = pos.index;
          store.set(sanitize(opts.show.steps[step].values));
        }
      }
      engine.update(dt);
      engine.render();
      await source.add(i * dt, dt);
      opts.onProgress?.((i + 1) / n);
    }
    await output.finalize();
    return new Blob([output.target.buffer!], { type: 'video/mp4' });
  } finally {
    engine.dispose();
  }
}
