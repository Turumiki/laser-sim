import './style.css';
import { openScreen } from '../app/screen';
import { preventDoubleTapZoom } from '../browser/dom';
import { fastTooltips } from '../browser/tooltip';
import type { SyncStatus } from '../sync/client';
import { buildInspector } from './inspector';
import { buildPatternGrid } from './pattern-grid';
import { Recorder } from './recorder';
import { attachBottomResize } from './resize';
import { buildSequence } from './sequence';
import { buildTabs } from './tabs';
import { buildToolbar } from './toolbar';
import { attachViewer } from './viewer';

const $ = (id: string) => document.getElementById(id)!;

const canvas = $('preview') as HTMLCanvasElement;
const { channel, store, engine, link, timer, run } = openScreen('control', canvas);

const recorder = new Recorder(canvas);
buildToolbar($('toolbar'), store, recorder, channel);
const inspector = buildInspector($('inspector'), store, channel);
const sequence = buildSequence($('sequence'), store, msg => link.show(msg), () => link.time.serverNow(), label => inspector.setTarget(label));
link.onShow(info => sequence.onShow(info));
buildPatternGrid($('patterns'), store);
buildTabs($('bottom'));
attachBottomResize($('app'), $('bottom'));
fastTooltips();
preventDoubleTapZoom();
attachViewer($('viewer'), canvas, store);

addEventListener('keydown', e => {
  const t = e.target as HTMLElement;
  if (['INPUT', 'SELECT', 'BUTTON', 'TEXTAREA'].includes(t.tagName)) return;
  if (e.code === 'Space') {
    e.preventDefault();
    store.set({ paused: !store.get().paused });
  }
});

let sync: SyncStatus = 'connecting';
link.onStatus(s => { sync = s; });
const status = $('status');
const seqTab = document.querySelector<HTMLButtonElement>('.tabs button[data-tab="sequence"]')!;
setInterval(() => {
  const label = { connecting: '接続中…', open: '同期中', closed: '未接続' }[sync];
  const cls = sync === 'open' ? 'ok' : sync === 'closed' ? 'ng' : '';
  const item = (text: string, className = '') => Object.assign(document.createElement('span'), { className, textContent: text });
  // シーケンスが流れているときは、どのタブを開いていても分かるようにする
  const playing = sequence.nowPlaying();
  seqTab.classList.toggle('live', !!playing);
  const show = playing ? item(`▶ ${playing}`, 'live') : null;
  if (show) {
    show.title = 'シーケンスを再生中。クリックでシーケンスのタブを開く';
    show.addEventListener('click', () => seqTab.click());
  }
  status.replaceChildren(
    item(`● ${label}`, cls),
    ...(show ? [show] : []),
    item(`ch: ${channel}`),
    item(`${timer.avg.toFixed(2)} ms`),
    item(`${engine.segments} seg`),
  );
}, 250);

run();
