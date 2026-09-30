import { OUTPUT_SIZES } from '../core/params';
import type { Store } from '../core/store';
import { el } from './dom';
import { download, stamp } from './download';
import { exportVideo } from './exporter';
import type { Recorder } from './recorder';

const EXPORT_TITLE = '今の設定で、頭から1コマずつ計算してMP4に書き出す（60fps、コマ落ちなし）';

export function buildToolbar(root: HTMLElement, store: Store, recorder: Recorder, channel: string) {
  const play = el('button', { class: 'tb', title: '再生 / 一時停止 (Space)' });
  play.addEventListener('click', () => store.set({ paused: !store.get().paused }));

  const clean = el('button', { class: 'tb', title: '図形をそのまま描く' }, '理想');
  const scan = el('button', { class: 'tb', title: 'pps とガルバノミラーの応答を再現する' }, '実機');
  clean.addEventListener('click', () => store.set({ mode: 'clean' }));
  scan.addEventListener('click', () => store.set({ mode: 'scan' }));

  const size = el('select', { class: 'tb', title: '出力サイズ' });
  for (const k of Object.keys(OUTPUT_SIZES)) size.append(new Option(k.replace('x', ' × '), k));
  size.addEventListener('change', () => store.set({ output: size.value }));

  const dur = el('select', { class: 'tb', title: '録画時間' });
  for (const [v, t] of [[0, '手動'], [5, '5 s'], [10, '10 s'], [30, '30 s'], [60, '60 s']] as const) dur.append(new Option(t, String(v)));
  dur.value = '10';
  const rec = el('button', { class: 'tb rec', title: '画面をそのまま録画する（リアルタイム）' }, 'REC');
  const exp = el('button', { class: 'tb', title: EXPORT_TITLE }, '書き出し');
  let abort: AbortController | null = null;
  exp.addEventListener('click', async () => {
    if (abort) { abort.abort(); return; }
    abort = new AbortController();
    const seconds = Number(dur.value) || 10;
    const s = store.get();
    let failed = '';
    try {
      exp.classList.add('on');
      const blob = await exportVideo(s, {
        seconds,
        fps: 60,
        signal: abort.signal,
        onProgress: r => { exp.textContent = `中止 ${Math.round(r * 100)}%`; },
      });
      download(blob, `laser_${s.pattern}_${seconds}s_${stamp()}.mp4`);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') failed = (e as Error).message;
    } finally {
      abort = null;
      exp.classList.remove('on');
      exp.textContent = failed ? '書き出し失敗' : '書き出し';
      exp.title = failed || EXPORT_TITLE;
      if (failed) setTimeout(() => { exp.textContent = '書き出し'; }, 4000);
    }
  });
  const time = el('span', { class: 'time' }, '0:00.0');
  rec.addEventListener('click', () => {
    if (recorder.recording) recorder.stop();
    else recorder.start(Number(dur.value), `laser_${store.get().pattern}`);
  });

  const openOut = el('button', { class: 'tb', title: '出力画面を別ウィンドウで開く' }, '出力を開く');
  openOut.addEventListener('click', () => window.open(outputPath(channel), `laser-output-${channel}`));
  const copy = el('button', { class: 'tb', title: 'OBSのブラウザソース用のURLをコピーする' }, 'URLをコピー');
  copy.addEventListener('click', async () => {
    const url = await outputUrl(channel);
    try {
      await navigator.clipboard.writeText(url);
      copy.textContent = 'コピーしました';
    } catch {
      copy.textContent = url;
    }
    setTimeout(() => { copy.textContent = 'URLをコピー'; }, 1500);
  });

  root.append(
    play,
    el('span', { class: 'sep' }),
    el('span', { class: 'seg' }, clean, scan),
    size,
    el('span', { class: 'grow' }),
    dur, exp, rec, time,
    el('span', { class: 'sep' }),
    openOut, copy,
  );

  const refresh = () => {
    const s = store.get();
    play.textContent = s.paused ? '▶' : '❚❚';
    play.classList.toggle('on', s.paused);
    clean.classList.toggle('on', s.mode === 'clean');
    scan.classList.toggle('on', s.mode === 'scan');
    size.value = s.output;
  };
  store.subscribe(refresh);
  refresh();

  recorder.onChange = () => {
    rec.classList.toggle('on', recorder.recording);
    time.classList.toggle('on', recorder.recording);
    dur.disabled = recorder.recording;
  };
  setInterval(() => {
    const t = recorder.elapsed;
    time.textContent = `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
  }, 100);
}

const outputPath = (ch: string) => `/output.html${ch === 'default' ? '' : `?ch=${encodeURIComponent(ch)}`}`;

// localhostで開いていても、他のPCのOBSから使えるようにLANのアドレスを返す
async function outputUrl(ch: string) {
  let origin = location.origin;
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    try {
      const info = await (await fetch('/api/info')).json() as { lan: string[] };
      if (info.lan[0]) origin = info.lan[0];
    } catch { /* そのままlocalhostを使う */ }
  }
  return origin + outputPath(ch);
}
