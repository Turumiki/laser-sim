import { useServerAssets } from '../browser/assets';
import { loadLocal, saveLocal } from '../browser/persist';
import { DEFAULTS, sanitize } from '../core/params';
import { Store } from '../core/store';
import { Engine } from '../engine/engine';
import { FrameTimer, startLoop } from '../engine/loop';
import { connectSync } from '../sync/client';

interface Saved { state?: Record<string, unknown>; animT?: number }

// 操作画面と出力画面に共通の起動の流れ。
// 前回の状態 → URLの指定 → サーバーの設定 の順に上書きし、2秒ごとと閉じるときにこの端末へ保存する
export function openScreen(role: 'control' | 'output', canvas: HTMLCanvasElement) {
  useServerAssets();
  const params = new URLSearchParams(location.search);
  const channel = params.get('ch') || 'default';
  const saveKey = `laser:${channel}:${role}`;
  const saved = loadLocal<Saved>(saveKey);

  const store = new Store({
    ...DEFAULTS,
    ...sanitize(saved?.state ?? {}),
    ...sanitize(Object.fromEntries(params)),
  });

  let engine: Engine;
  try {
    engine = new Engine(canvas, store);
  } catch (e) {
    // WebGL2 が使えないときなど。何が起きたかだけを画面に出す
    const p = Object.assign(document.createElement('p'), { id: 'error', textContent: (e as Error).message });
    document.body.replaceChildren(p);
    throw e;
  }
  if (typeof saved?.animT === 'number') engine.scanner.animT = saved.animT;

  const link = connectSync(store, { channel, role });

  const save = () => saveLocal(saveKey, { state: store.get(), animT: engine.scanner.animT });
  setInterval(save, 2000);
  addEventListener('pagehide', save);

  // サーバーの時間軸に合わせながら描く
  const timer = new FrameTimer();
  const run = () => startLoop(dt => {
    timer.begin();
    engine.update(dt);
    engine.sim.syncAnim(link.time.animNow());
    engine.render();
    timer.end();
  });

  return { params, channel, store, engine, link, timer, run };
}
