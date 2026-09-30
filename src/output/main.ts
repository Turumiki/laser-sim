import { DEFAULTS, sanitize } from '../core/params';
import { loadLocal, saveLocal } from '../core/persist';
import { Store } from '../core/store';
import { Engine } from '../engine/engine';
import { FrameTimer, startLoop } from '../engine/loop';
import { connectSync } from '../sync/client';

const params = new URLSearchParams(location.search);
const channel = params.get('ch') || 'default';
const saveKey = `laser:${channel}:output`;

interface Saved { state?: Record<string, unknown>; animT?: number }
const saved = loadLocal<Saved>(saveKey);

// 前回の状態 → URLの指定 → サーバーの設定 の順に上書き
const store = new Store({
  ...DEFAULTS,
  ...sanitize(saved?.state ?? {}),
  ...sanitize(Object.fromEntries(params)),
});

const canvas = document.getElementById('out') as HTMLCanvasElement;
let engine: Engine;
try {
  engine = new Engine(canvas, store);
} catch (e) {
  document.body.innerHTML = `<p id="error">${(e as Error).message}</p>`;
  throw e;
}
if (saved?.animT) engine.scanner.animT = saved.animT;

const sync = connectSync(store, { channel, role: 'output' });
// 開発中だけ、ブラウザのコンソールから中身を見られるようにする
if (import.meta.env.DEV) Object.assign(window, { laser: { engine, sync, store } });

// OBSではウィンドウと出力サイズが一致するので等倍。大きいウィンドウでも拡大はしない
const fit = () => {
  const [w, h] = engine.size;
  const k = Math.min(1, innerWidth / w, innerHeight / h);
  canvas.style.width = `${w * k}px`;
  canvas.style.height = `${h * k}px`;
};
addEventListener('resize', fit);
store.subscribe(changed => { if (changed.output) fit(); });

const save = () => saveLocal(saveKey, { state: store.get(), animT: engine.scanner.animT });
setInterval(save, 2000);
addEventListener('pagehide', save);

const timer = new FrameTimer();
let stats: HTMLElement | null = null;
if (params.get('stats') === '1') {
  stats = document.createElement('div');
  stats.id = 'stats';
  document.body.append(stats);
  setInterval(() => {
    stats!.textContent = `${timer.avg.toFixed(2)} ms/frame · ${engine.segments} seg`;
  }, 250);
}

engine.render();
fit();
startLoop(dt => {
  timer.begin();
  engine.update(dt);
  engine.sim.syncAnim(sync.time.animNow());
  engine.render();
  timer.end();
});
