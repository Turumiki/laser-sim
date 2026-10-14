import { openScreen } from '../app/screen';

const canvas = document.getElementById('out') as HTMLCanvasElement;
const { params, store, engine, link, timer, run } = openScreen('output', canvas);
// 開発中だけ、ブラウザのコンソールから中身を見られるようにする
if (import.meta.env.DEV) Object.assign(window, { laser: { engine, sync: link, store } });

// OBSではウィンドウと出力サイズが一致するので等倍。大きいウィンドウでも拡大はしない
const fit = () => {
  const [w, h] = engine.size;
  const k = Math.min(1, innerWidth / w, innerHeight / h);
  canvas.style.width = `${w * k}px`;
  canvas.style.height = `${h * k}px`;
};
addEventListener('resize', fit);
store.subscribe(changed => { if (changed.output) fit(); });

if (params.get('stats') === '1') {
  const stats = Object.assign(document.createElement('div'), { id: 'stats' });
  document.body.append(stats);
  setInterval(() => {
    stats.textContent = `${timer.avg.toFixed(2)} ms/frame · ${engine.segments} seg`;
  }, 250);
}

engine.render();
fit();
run();
