import './style.css';
import { DEFAULTS, sanitize } from '../core/params';
import { loadLocal, saveLocal } from '../core/persist';
import { Store } from '../core/store';
import { Engine } from '../engine/engine';
import { FrameTimer, startLoop } from '../engine/loop';
import { connectSync, type SyncStatus } from '../sync/client';
import { buildInspector } from './inspector';
import { buildPatternGrid } from './pattern-grid';
import { buildSequence } from './sequence';
import { buildTabs } from './tabs';
import { fastTooltips } from './tooltip';
import { Recorder } from './recorder';
import { buildToolbar } from './toolbar';
import { attachViewer } from './viewer';

const $ = (id: string) => document.getElementById(id)!;

const params = new URLSearchParams(location.search);
const channel = params.get('ch') || 'default';
const saveKey = `laser:${channel}:control`;

interface Saved { state?: Record<string, unknown>; animT?: number }
const saved = loadLocal<Saved>(saveKey);

const store = new Store({
  ...DEFAULTS,
  ...sanitize(saved?.state ?? {}),
  ...sanitize(Object.fromEntries(params)),
});

const canvas = $('preview') as HTMLCanvasElement;
const engine = new Engine(canvas, store);
if (saved?.animT) engine.scanner.animT = saved.animT;

let sync: SyncStatus = 'connecting';
const sequence = buildSequence($('sequence'), store, msg => link.show(msg), () => link.time.serverNow());
const link = connectSync(store, {
  channel,
  role: 'control',
  onStatus: s => { sync = s; },
  onShow: info => sequence.onShow(info),
});

const recorder = new Recorder(canvas);
buildToolbar($('toolbar'), store, recorder, channel);
buildInspector($('inspector'), store);
buildPatternGrid($('patterns'), store);
buildTabs($('bottom'));
fastTooltips();
attachViewer($('viewer'), canvas, store);

addEventListener('keydown', e => {
  const t = e.target as HTMLElement;
  if (['INPUT', 'SELECT', 'BUTTON', 'TEXTAREA'].includes(t.tagName)) return;
  if (e.code === 'Space') {
    e.preventDefault();
    store.set({ paused: !store.get().paused });
  }
});

const save = () => saveLocal(saveKey, { state: store.get(), animT: engine.scanner.animT });
setInterval(save, 2000);
addEventListener('pagehide', save);

const timer = new FrameTimer();
const status = $('status');
setInterval(() => {
  const label = { connecting: '接続中…', open: '同期中', closed: '未接続' }[sync];
  const cls = sync === 'open' ? 'ok' : sync === 'closed' ? 'ng' : '';
  const item = (text: string, className = '') => Object.assign(document.createElement('span'), { className, textContent: text });
  status.replaceChildren(
    item(`● ${label}`, cls),
    item(`ch: ${channel}`),
    item(`${timer.avg.toFixed(2)} ms`),
    item(`${engine.segments} seg`),
  );
}, 250);

startLoop(dt => {
  timer.begin();
  engine.update(dt);
  engine.sim.syncAnim(link.time.animNow());
  engine.render();
  timer.end();
});
