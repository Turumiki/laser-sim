import { OUTPUT_SIZES } from '../core/params';
import { isValidChannel } from '../core/protocol';
import type { Store } from '../core/store';
import { el } from '../browser/dom';
import { switchChannel } from './channel';
import { attachExport } from './export-button';
import type { Recorder } from './recorder';

const EXPORT_TITLE = '今の設定で、頭から1コマずつ計算してMP4に書き出す（映像のfps、コマ落ちなし）';

export function buildToolbar(root: HTMLElement, store: Store, recorder: Recorder, channel: string) {
  const play = el('button', { class: 'tb', title: '再生 / 一時停止 (Space)' });
  play.addEventListener('click', () => store.set({ paused: !store.get().paused }));

  const clean = el('button', { class: 'tb', title: '図形をそのまま、きれいな線で描く。スキャナの特性は反映しない' }, 'ベクター');
  const scan = el('button', { class: 'tb', title: 'pps・スキャナ性能・ダンピング・カラーシフトを反映して、実機が描いたときの見え方を再現する' }, 'スキャン');
  clean.addEventListener('click', () => store.set({ mode: 'clean' }));
  scan.addEventListener('click', () => store.set({ mode: 'scan' }));

  const post = el('button', { class: 'tb', title: 'オン: 強い所が白く飛び、にじみが付く（配信・モニター向け）。オフ: 光の量をそのまま書き出す（Unityなどのライトのクッキー・ボリュームライト向け）' }, 'ポストエフェクト');
  post.addEventListener('click', () => store.set({ look: store.get().look === 'display' ? 'source' : 'display' }));

  const size = el('select', { class: 'tb', title: '出力サイズ' });
  for (const k of Object.keys(OUTPUT_SIZES)) size.append(new Option(k.replace('x', ' × '), k));
  size.addEventListener('change', () => store.set({ output: size.value }));

  const dur = el('select', { class: 'tb', title: '録画時間' });
  for (const [v, t] of [[0, '手動'], [5, '5 s'], [10, '10 s'], [30, '30 s'], [60, '60 s']] as const) dur.append(new Option(t, String(v)));
  dur.value = '10';
  const rec = el('button', { class: 'tb rec', title: '画面をそのまま録画する（リアルタイム）' }, 'REC');
  const exp = el('button', { class: 'tb', title: EXPORT_TITLE }, '書き出し');
  attachExport(exp, () => {
    const seconds = Number(dur.value) || 10;
    return { settings: store.get(), seconds, name: `laser_${store.get().pattern}_${seconds}s` };
  });
  const time = el('span', { class: 'time' }, '0:00.0');
  rec.addEventListener('click', () => {
    if (recorder.recording) recorder.stop();
    else recorder.start(Number(dur.value), `laser_${store.get().pattern}`, Number(store.get().fps));
  });

  // チャンネルの切り替え。選ぶとそのチャンネルの操作画面を開き直す
  const chSel = el('select', { class: 'tb', title: 'チャンネル。出力や3Dビューアと同じ名前のものが連動する' });
  const NEW = '__new';
  const fillChannels = (list: string[]) => {
    chSel.replaceChildren();
    for (const c of new Set([channel, ...list])) chSel.add(new Option(`ch: ${c}`, c));
    chSel.add(new Option('＋ 新しいチャンネル…', NEW));
    chSel.value = channel;
  };
  fillChannels([]);
  fetch('/api/channels').then(r => r.json()).then(fillChannels).catch(() => {});
  chSel.addEventListener('change', () => {
    let next = chSel.value;
    if (next === NEW) {
      next = prompt('チャンネル名（英数字と _ - だけ）') ?? '';
      if (!isValidChannel(next)) { chSel.value = channel; return; }
    }
    if (next !== channel) switchChannel(next);
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
    post,
    size,
    el('span', { class: 'grow' }),
    dur, exp, rec, time,
    el('span', { class: 'sep' }),
    chSel, openOut, copy,
  );

  const refresh = () => {
    const s = store.get();
    play.textContent = s.paused ? '▶' : '❚❚';
    play.classList.toggle('on', s.paused);
    clean.classList.toggle('on', s.mode === 'clean');
    scan.classList.toggle('on', s.mode === 'scan');
    post.classList.toggle('on', s.look === 'display');
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
