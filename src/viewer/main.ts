import {
  ACESFilmicToneMapping, BoxGeometry, Color, DepthTexture, DirectionalLight, GridHelper, Group, HalfFloatType, HemisphereLight, Mesh, MeshBasicMaterial, PerspectiveCamera,
  Scene, Vector2, WebGLRenderer, WebGLRenderTarget,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { DEFAULTS, sanitize } from '../core/params';
import { loadLocal, saveLocal } from '../core/persist';
import { Store } from '../core/store';
import { startLoop } from '../engine/loop';
import { Simulation } from '../engine/simulation';
import { connectSync } from '../sync/client';
import { fastTooltips } from '../control/tooltip';
import { Cookies } from './cookies';
import { VolumePass, type VolumeProjector } from './volume';
import { EYE_GAIN } from '../core/color';
import { Beams, type Projector, type Rig, type Source } from './beams';
import { ROOMS, setEdgeLevel, Surfaces, TARGETS, type TargetKind } from './surfaces';
import { preventDoubleTapZoom } from '../control/dom';
import { arenaLayout } from './venues';

// レーザーが空間にどう出るかを3Dで見る（隠し機能）。設定は操作画面と同期する
const params = new URLSearchParams(location.search);
const channel = params.get('ch') || 'default';

// チャンネルごとの映像ソース。台ごとに違うチャンネルを割り当てられるので、使うチャンネルの数だけ持つ
interface Feed {
  store: Store;
  sim: Simulation;
  sync: ReturnType<typeof connectSync>;
}
const feeds = new Map<string, Feed>();
const feedOf = (ch: string): Feed => {
  let f = feeds.get(ch);
  if (!f) {
    const store = new Store({ ...DEFAULTS, ...sanitize(Object.fromEntries(params)) });
    f = { store, sim: new Simulation(store), sync: connectSync(store, { channel: ch, role: 'output' }) };
    feeds.set(ch, f);
  }
  return f;
};
// 台に割り当てるチャンネルの並び。使わなくなったチャンネルは接続を切る
let feedOrder: Feed[] = [];
const useChannels = () => {
  const names = assigned();
  feedOrder = names.map(feedOf);
  for (const [ch, f] of feeds) {
    if (!names.includes(ch)) { f.sync.close(); feeds.delete(ch); }
  }
};

const validChannel = (t: unknown): t is string => typeof t === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(t);
// 1台ずつのチャンネル。足りない台は、最後に決めた台と同じチャンネルにする
const assigned = () => {
  const list = vs.channels.filter(validChannel);
  return Array.from({ length: vs.count }, (_, i) => list[Math.min(i, list.length - 1)] ?? channel);
};

// ビューア独自の設定（同期しない）
type Quality = 'high' | 'mid' | 'low';
// thick: スモークの厚みを何か所で測るか（1: 3か所）、procedural: スモークをその場で計算するか
const QUALITY: Record<Quality, { label: string; pixelRatio: () => number; samples: number; thick: number; procedural: number }> = {
  high: { label: 'High', pixelRatio: () => Math.min(devicePixelRatio, 2), samples: 4, thick: 1, procedural: 1 },
  mid: { label: 'Mid', pixelRatio: () => 1, samples: 0, thick: 0, procedural: 0 },
  low: { label: 'Low', pixelRatio: () => 0.75, samples: 0, thick: 0, procedural: 0 },
};

// 複数台の並べ方。実際の現場でよくある置き方
type Layout = 'parallel' | 'fan' | 'mirror';
type Place = 'rig' | 'deck' | 'truss' | 'towers' | 'center';

type View = 'audience' | 'foh' | 'side' | 'stage';
const VIEWS: { id: View; label: string }[] = [
  { id: 'audience', label: '客席' },
  // 照明やレーザーのオペレーターがいる卓（客席の中央、後ろ寄り）
  { id: 'foh', label: 'FOH' },
  { id: 'side', label: '横・俯瞰' },
  { id: 'stage', label: 'ステージ後方' },
];
// 描き方。ベクター: 点のデータから直接ビームを出す（実機に近い） / 映像: Unityに渡すのと同じ映像をクッキーとして投影する
type RenderMode = 'vector' | 'video';
const RENDER_MODES: { id: RenderMode; label: string }[] = [
  { id: 'vector', label: '点のデータから直接' },
  { id: 'video', label: 'クッキー（出力の映像）' },
];

// 設置場所（アリーナのとき）。現場でよく使う置き場所
const PLACES: { id: Place; label: string }[] = [
  { id: 'rig', label: '標準（床から5m）' },
  { id: 'deck', label: 'ステージ前の床' },
  { id: 'truss', label: 'ステージ上のトラス' },
  { id: 'towers', label: '上手・下手のタワー' },
  { id: 'center', label: 'センターステージ' },
];

const LAYOUTS: { id: Layout; label: string }[] = [
  { id: 'parallel', label: '平行' },
  { id: 'fan', label: '扇' },
  { id: 'mirror', label: '左右対称' },
];

// ステージの前に横一列で並べる。扇は外側ほど外を向け、左右対称は右半分を左右反転する
function layout(count: number, spacing: number, mode: Layout): Projector[] {
  const list: Projector[] = [];
  const mid = (count - 1) / 2;
  for (let i = 0; i < count; i++) {
    const k = mid ? (i - mid) / mid : 0;
    list.push({
      pos: [(i - mid) * spacing, 0, 0],
      yaw: mode === 'fan' ? -k * 20 * Math.PI / 180 : 0,
      mirror: mode === 'mirror' && i > mid,
    });
  }
  return list;
}

interface ViewerSettings {
  // 台ごとのチャンネル（左の台から順）
  channels: string[];
  quality: Quality;
  haze: number;
  distance: number;
  bloom: number;
  smoke: number;
  grain: number;
  extinction: number;
  // 映像の描き方で、遠くの減衰を弱める量
  flat: number;
  // ヘイズが流れる速さ（1で空調くらい、0で止まる）
  flow: number;
  // 作業灯（会場の形を見るための明かり）の明るさ
  work: number;
  // 人の目の色ごとの感度で見る（緑は明るく、赤・青は暗く見える）
  eye: boolean;
  // ローリングシャッター（撮っているカメラが、画面を上の行から順に時間をずらして撮る）
  rolling: boolean;
  // 上から下まで読み出すのにかかる時間（ms）
  readout: number;
  target: TargetKind;
  count: number;
  spacing: number;
  layout: Layout;
  // アリーナでのレーザーの設置場所
  place: Place;
  view: View;
  render: RenderMode;
}
const RIG_KEY = 'laser:viewer';
// 初期値（チャンネルの割り当ては除く）
const VIEWER_DEFAULTS: Omit<ViewerSettings, 'channels'> = {
  // スマホのGPUは非力なので、初めて開いたときは軽い画質にする
  quality: matchMedia('(pointer: coarse)').matches ? 'low' : 'mid', haze: 1, distance: 8, bloom: 1, smoke: 0.6, grain: 0.6, extinction: 0.3, flat: 0, flow: 1, work: 0.3, eye: false, rolling: false, readout: 16, target: 'wall', count: 1, spacing: 2, layout: 'parallel', place: 'rig', view: 'audience', render: 'vector',
};
const vs: ViewerSettings = {
  channels: [channel],
  ...VIEWER_DEFAULTS,
  ...loadLocal<ViewerSettings>(RIG_KEY),
};
if (!VIEWS.some(v => v.id === vs.view)) vs.view = 'audience';
// URLでチャンネルを指定して開いたときは、それを使う
if (params.has('ch')) vs.channels = [channel];
// URLで会場や台の並べ方を指定できる（例: ?target=arena&count=6&layout=mirror&assign=a,a,b,b,c,c&view=foh）
{
  const q = (k: string) => params.get(k);
  if (TARGETS.some(t => t.id === q('target'))) vs.target = q('target') as TargetKind;
  if (LAYOUTS.some(l => l.id === q('layout'))) vs.layout = q('layout') as Layout;
  if (PLACES.some(l => l.id === q('place'))) vs.place = q('place') as Place;
  if (VIEWS.some(v => v.id === q('view'))) vs.view = q('view') as View;
  if (RENDER_MODES.some(m => m.id === q('render'))) vs.render = q('render') as RenderMode;
  const num = (k: string, min: number, max: number) => {
    const n = Number(q(k));
    return q(k) !== null && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
  };
  vs.count = num('count', 1, 8) ?? vs.count;
  vs.spacing = num('spacing', 0.5, 10) ?? vs.spacing;
  vs.distance = num('distance', 2, 150) ?? (q('target') && ROOMS[vs.target] ? ROOMS[vs.target]!.depth : vs.distance);
  if (q('assign')) vs.channels = q('assign')!.split(',').map(t => t.trim());
}
// 以前はカンマ区切りの文字で持っていた
if (typeof vs.channels === 'string') vs.channels = (vs.channels as string).split(',').map(t => t.trim());
useChannels();
const rig: Rig = { distance: 0, haze: 0, roll: 0, eye: false };
const applyRig = () => {
  rig.distance = vs.distance;
  rig.haze = vs.haze;
  rig.eye = vs.eye;
};
applyRig();

// アンチエイリアスは画質設定に合わせて、ポストエフェクト用のバッファ側でかける
const renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.toneMapping = ACESFilmicToneMapping;
document.body.prepend(renderer.domElement);

const scene = new Scene();
scene.background = new Color(0x030303);

// 作業灯。本番中の会場は真っ暗だが、形が分からないと見づらいので、弱い明かりを足せるようにする。
// 全体を照らす柔らかい明かり（上は明るめ）と、カメラから照らす明かり（CADのビューアと同じ。どこから見ても面が黒く潰れない）
const hemi = new HemisphereLight(0xd8e0ec, 0x5a5a5a, 0);
const headlight = new DirectionalLight(0xffffff, 0);
const applyWorkLight = () => {
  hemi.intensity = vs.work * 1.4;
  headlight.intensity = vs.work * 1.6;
  setEdgeLevel(vs.work);
};

const camera = new PerspectiveCamera(50, 1, 0.05, 2000);
// カメラから見て少し上・左から当てる（真正面からだと面の向きの差が出ない）
headlight.position.set(-0.3, 0.5, 1);
headlight.target.position.set(0, 0, 0);
camera.add(headlight, headlight.target);
scene.add(hemi, camera);
applyWorkLight();
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// プロジェクター本体、床、壁
const bodies = new Group();
scene.add(bodies);
const bodyGeo = new BoxGeometry(0.4, 0.2, 0.5), bodyMat = new MeshBasicMaterial({ color: 0x1c1c1c });
let grid: GridHelper | null = null;
// 床の目盛りは1m間隔。壁までの距離に合わせて広げる
const placeGrid = () => {
  if (grid) { scene.remove(grid); grid.dispose(); grid = null; }
  // 会場の中では床そのものが見えるので、目盛りは出さない
  if (ROOMS[vs.target]) return;
  const size = Math.max(40, Math.ceil(vs.distance * 3));
  grid = new GridHelper(size, Math.min(size, 300), 0x1a1a1a, 0x111111);
  grid.position.y = -surfaces.floor;
  scene.add(grid);
};
const surfaces = new Surfaces();
scene.add(surfaces.group);
const placeWall = () => {
  surfaces.build(vs.target, vs.distance);
  placeGrid();
};
placeWall();

// 視点。プロジェクターは原点で客席（-z）の方を向いている
function placeCamera() {
  const d = vs.distance, floor = -surfaces.floor, eye = floor + 1.6;
  const room = ROOMS[vs.target];
  const width = room?.width ?? d, height = room?.height ?? 8;
  // ステージ（プロジェクター）の少し上を見る
  const stage = () => controls.target.set(0, floor + height * 0.3, 0);
  if (vs.view === 'audience') {
    // 客席の前寄り、少し横から
    camera.position.set(width * 0.12, eye, -d * 0.35);
    stage();
  } else if (vs.view === 'foh') {
    if (vs.target === 'arena' && room) {
      // アリーナではFOHの卓の後ろに立った目線
      const L = arenaLayout(room, d);
      camera.position.set(0, L.y0 + 0.6 + 1.6, L.fohZ - 0.5);
    } else {
      // 客席の中央、奥行きの6割くらい。1mほどの台の上
      camera.position.set(0, eye + 1, -d * 0.6);
    }
    stage();
  } else if (vs.view === 'side') {
    if (room) {
      // 会場では、客席の後ろの高い角から全体を見下ろす
      camera.position.set(width * 0.42, floor + height * 0.85, -d * 0.95);
      controls.target.set(0, floor + height * 0.2, -d * 0.3);
    } else {
      camera.position.set(d * 0.55, 1.6, -d * 0.35);
      controls.target.set(0, 0, -d * 0.45);
    }
  } else {
    camera.position.set(0, 1.2, 3);
    controls.target.set(0, 0, -d / 2);
  }
  controls.update();
}
placeCamera();

const beams = new Beams(rig, surfaces);
let projectorList: Projector[] = [];
const deg = (d: number) => d * Math.PI / 180;

// アリーナでは、設置場所に合わせて高さと前後の位置を決める（座標はプロジェクターの標準位置が原点）
function placeIn(list: Projector[]): Projector[] {
  const room = ROOMS.arena;
  if (vs.target !== 'arena' || !room || vs.place === 'rig') return list;
  const L = arenaLayout(room, vs.distance);
  return list.map((p, i) => {
    const [x] = p.pos;
    switch (vs.place) {
      // ステージの前の縁に床置き（高さ30cmほどの台）。客席に当てないよう少し上に向ける
      case 'deck': return { ...p, pos: [x, L.deck + 0.3, L.front + 0.5], pitch: deg(12) };
      // 一番前の照明トラスに吊る。客席の上へ少し下向きに
      case 'truss': return { ...p, pos: [x, L.trussY - 0.4, 2], pitch: deg(-8) };
      // ステージの左右に立てたタワーに、半分ずつ縦に積む。少し内向きに振る
      case 'towers': {
        const left = i < Math.ceil(list.length / 2), k = left ? i : i - Math.ceil(list.length / 2);
        const side = left ? -1 : 1;
        return { ...p, pos: [side * (L.sw / 2 + 3), L.y0 + 6 + k * 0.9, 0], yaw: p.yaw - side * deg(10), pitch: deg(5) };
      }
      // 花道の先のセンターステージ
      case 'center': return { ...p, pos: [x, L.hy + 0.3, -L.run - L.cs], pitch: deg(15) };
    }
    return p;
  });
}

const placeProjectors = () => {
  const list = placeIn(layout(vs.count, vs.spacing, vs.layout));
  projectorList = list;
  beams.setProjectors(list);
  bodies.clear();
  for (const p of list) {
    const m = new Mesh(bodyGeo, bodyMat);
    m.position.set(p.pos[0], p.pos[1], p.pos[2]);
    // 左右に振ってから、上下に傾ける
    m.rotation.set(p.pitch ?? 0, p.yaw, 0, 'YXZ');
    m.translateZ(0.26);
    bodies.add(m);
  }
};
placeProjectors();
const applySmoke = () => {
  beams.haze.uSmoke.value = vs.smoke;
  beams.haze.uGrain.value = vs.grain;
  // 1で100mあたり約5の減衰（45m先で約1/10）
  beams.haze.uExt.value = vs.extinction * 0.05;
};
applySmoke();
scene.add(beams.group);

// スライダーの1をどのくらいの強さにするか
const BLOOM_SCALE = 0.5;
let composer: EffectComposer;
let volume: VolumePass;
const cookies = new Cookies();
// 映像の描き方の明るさ。ベクターの見え方とだいたい揃うように合わせた値（クッキーには「クッキー用」の映像を使う）
const VIDEO_GAIN = 36;
// 積算の細かさ（視線に沿って何回調べるか）
// 光の範囲の中だけを調べるので、1台あたりの回数（範囲の外は調べない）
const STEPS: Record<Quality, number> = { high: 40, mid: 24, low: 14 };
// 空間の光を計算する解像度（画面に対する割合）。光の筋はもともとぼやけているので、下げても見た目はほとんど変わらない
const VOLUME_SCALE: Record<Quality, number> = { high: 0.5, mid: 0.35, low: 0.25 };
let bloom: UnrealBloomPass;
// 画質を変えたら、解像度とアンチエイリアスに合わせて作り直す
// ブルームは画面全体を何段もぼかすので重い。Lowや強さ0のときは処理ごと止める
const applyBloom = () => {
  bloom.strength = vs.bloom * BLOOM_SCALE;
  bloom.enabled = vs.bloom > 0 && vs.quality !== 'low';
};
const buildComposer = () => {
  const q = QUALITY[vs.quality] ?? QUALITY.mid;
  // 作り直す前に、前のブルームなどが持っていたGPUのメモリを手放す
  if (composer) {
    for (const pass of composer.passes) pass.dispose();
    composer.dispose();
  }
  renderer.setPixelRatio(q.pixelRatio());
  const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: q.samples });
  // 映像の描き方で、光を壁や物の手前で止めるのに奥行きを使う
  target.depthTexture = new DepthTexture(1, 1);
  composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  volume = new VolumePass(camera, beams.haze);
  volume.scale = VOLUME_SCALE[vs.quality] ?? 0.35;
  composer.addPass(volume);
  cookies.size = vs.quality === 'low' ? 256 : 512;
  // しきい値を高めにして、ビームの芯のように明るい所だけをにじませる（ヘイズ全体がかすまないように）
  bloom = new UnrealBloomPass(new Vector2(1, 1), vs.bloom * BLOOM_SCALE, 0.35, 0.6);
  composer.addPass(bloom);
  applyBloom();
  composer.addPass(new OutputPass());
  beams.haze.uThick.value = q.thick;
  beams.haze.uProcedural.value = q.procedural;
  resize();
};

const resize = () => {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
};
addEventListener('resize', resize);
buildComposer();

// 台ごとのチャンネルを選ぶ欄。選択肢はサーバーで使われているチャンネルの一覧
const assignBox = document.createElement('div');
assignBox.className = 'assign';
let knownChannels: string[] = [];
// 一覧を取り直しても欄は作り直さず、選択肢だけ入れ替える（開いている選択肢が閉じないように）
const fillOptions = (sel: HTMLSelectElement, names: string[]) => {
  const want = [...new Set([...knownChannels, ...names])];
  const have = [...sel.options].map(o => o.value);
  if (want.join() === have.join()) return;
  const value = sel.value;
  sel.replaceChildren(...want.map(c => new Option(c, c)));
  sel.value = value;
};
const refreshChannels = () =>
  fetch('/api/channels').then(r => r.json()).then((list: string[]) => {
    knownChannels = list;
    const names = assigned();
    for (const sel of assignBox.querySelectorAll('select')) {
      if (document.activeElement !== sel) fillOptions(sel, names);
    }
  }).catch(() => {});
// 触ろうとしたとき（開く前）と、ときどき一覧を取り直す
assignBox.addEventListener('pointerenter', refreshChannels);
setInterval(refreshChannels, 10000);
function renderAssign() {
  const names = assigned();
  assignBox.replaceChildren();
  const head = document.createElement('div');
  head.className = 'assign-head';
  head.textContent = '台ごとのチャンネル';
  head.title = '左の台から順。出力や操作画面と同じチャンネル名のものが連動する';
  assignBox.append(head);
  names.forEach((name, i) => {
    const row = document.createElement('label');
    row.classList.add('wide');
    const sel = document.createElement('select');
    fillOptions(sel, names);
    sel.value = name;
    sel.addEventListener('change', () => {
      const next = assigned();
      next[i] = sel.value;
      vs.channels = next;
      useChannels();
      saveLocal(RIG_KEY, vs);
    });
    row.append(`${i + 1}台目`, sel);
    assignBox.append(row);
  });
}
refreshChannels();

buildRigPanel();
fastTooltips();
// 開発中だけ、ブラウザのコンソールから中身を見られるようにする
preventDoubleTapZoom();
if (import.meta.env.DEV) Object.assign(window, { laser3d: { renderer, feeds, beams, camera, controls } });

// ?stats=1 で、fps と1フレームの処理時間（CPU側）を出す
const stats = params.get('stats') === '1' ? document.body.appendChild(document.createElement('div')) : null;
let fps = 0, cpu = 0;
if (stats) {
  stats.id = 'stats';
  let lastUpdates = 0, rate = 0;
  setInterval(() => {
    rate = (beams.updates - lastUpdates) * 4;
    lastUpdates = beams.updates;
    stats.textContent = `${fps.toFixed(0)} fps · 画面 ${cpu.toFixed(2)} ms · ビーム ${beams.calcMs.toFixed(1)} ms（${beams.threaded ? '別スレッド' : '画面と同じ'}、${rate}回/秒）`;
  }, 250);
}

let hazeTime = 0;
startLoop(dt => {
  const t0 = performance.now();
  if (dt > 0) fps += (1 / dt - fps) * 0.05;
  for (const f of feeds.values()) {
    f.sim.update(dt);
    f.sim.syncAnim(f.sync.time.animNow());
  }
  // チャンネルごとに1回だけフレームを作り、同じチャンネルの台で使い回す
  const sources = new Map<Feed, Source>();
  for (const f of new Set(feedOrder)) {
    const s = f.store.get();
    sources.set(f, {
      settings: s,
      scanner: f.sim.scanner,
      tau: f.sim.exposureTime(),
      frame: s.mode === 'scan' ? null : f.sim.currentFrame(),
    });
  }
  // ローリングシャッター。露光時間とスローは全チャンネル共通なので、どのチャンネルで計っても同じ
  const f0 = feedOrder[0], s0 = f0?.store.get();
  rig.roll = vs.rolling && s0 ? vs.readout / 1000 * s0.timeScale / f0.sim.exposureTime() : 0;
  beams.haze.uRoll.value.set(rig.roll, s0?.exposureShape === 'exp' ? 1 : 0);
  renderer.getDrawingBufferSize(beams.haze.uRes.value);
  surfaces.updateFacing(camera.position);
  const video = vs.render === 'video';
  beams.group.visible = !video;
  volume.enabled = video;
  if (video) {
    // 各台に、そのチャンネルの映像をクッキーとして割り当てる
    const list: VolumeProjector[] = projectorList.map((p, k) => {
      const f = feedOrder[k % feedOrder.length];
      return { ...p, halfTan: Math.tan(f.store.get().scanAngle / 2 * Math.PI / 180), cookie: cookies.get(f.store, f.sim) };
    });
    cookies.update(new Set(feedOrder.map(f => f.sim)));
    volume.set(list, STEPS[vs.quality] ?? 48, vs.distance * 1.5, vs.haze * VIDEO_GAIN, vs.flat, vs.eye ? EYE_GAIN : [1, 1, 1]);
  } else {
    cookies.update(new Set());
    beams.draw(feedOrder.map(f => sources.get(f)!));
  }
  // 流れの速さを変えても形が飛ばないよう、時間を積み上げる
  hazeTime += dt * vs.flow;
  beams.haze.uTime.value = hazeTime;
  controls.update();
  composer.render();
  cpu += (performance.now() - t0 - cpu) * 0.05;
});


function checkRow(key: 'eye' | 'rolling', label: string, title: string, then?: () => void) {
  const row = document.createElement('label');
  const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: vs[key] });
  box.addEventListener('change', () => { vs[key] = box.checked; then?.(); saveLocal(RIG_KEY, vs); });
  row.title = title;
  row.append(label, box);
  return row;
}

function buildRigPanel() {
  const panel = document.getElementById('rig')!;
  const rows: [Exclude<keyof ViewerSettings, 'target' | 'quality' | 'layout' | 'view' | 'channels' | 'render' | 'rolling' | 'eye' | 'place'>, string, number, number, number][] = [
    ['count', '台数', 1, 8, 1],
    ['spacing', '間隔', 0.5, 10, 0.5],
    ['haze', 'ヘイズ', 0.1, 5, 0.05],
    ['distance', '壁までの距離', 2, 150, 0.5],
    ['bloom', 'ブルーム', 0, 3, 0.05],
    ['work', '作業灯', 0, 1, 0.05],
    ['smoke', 'ヘイズのむら', 0, 1, 0.05],
    ['grain', 'むらの細かさ', 0.2, 2, 0.05],
    ['flow', 'ヘイズの流れ', 0, 3, 0.1],
    ['extinction', 'ヘイズの減衰', 0, 1, 0.05],
    ['flat', '距離減衰の補正（クッキー）', 0, 1, 0.05],
    ['readout', '読み出し時間 ms', 1, 40, 1],
  ];
  panel.innerHTML = '<h3>3D</h3>';
  // 設定を初期値に戻す。チャンネルの割り当てはそのまま。URLで指定した値も外して開き直す
  const reset = document.createElement('button');
  reset.className = 'reset';
  reset.textContent = '初期値に戻す';
  reset.title = '3Dビューアの設定をすべて初期値に戻す（台ごとのチャンネルはそのまま）';
  reset.addEventListener('click', () => {
    saveLocal(RIG_KEY, { ...VIEWER_DEFAULTS, channels: vs.channels });
    const ch = params.get('ch');
    location.href = location.pathname + (ch ? `?ch=${encodeURIComponent(ch)}` : '');
  });
  panel.querySelector('h3')!.append(reset);
  const qualityRow = document.createElement('label');
  const quality = document.createElement('select');
  for (const [id, q] of Object.entries(QUALITY)) quality.add(new Option(q.label, id));
  quality.value = vs.quality;
  quality.addEventListener('change', () => {
    vs.quality = quality.value as Quality;
    buildComposer();
    saveLocal(RIG_KEY, vs);
  });
  qualityRow.title = 'High: 高解像度・アンチエイリアス・細かいスモーク。Low: 解像度を下げ、ブルームなしで軽くする（スマホ向け）';
  qualityRow.append('画質', quality);
  panel.append(qualityRow);

  const modeRow = document.createElement('label');
  const modeSel = document.createElement('select');
  for (const m of RENDER_MODES) modeSel.add(new Option(m.label, m.id));
  modeSel.value = vs.render;
  modeSel.addEventListener('change', () => {
    vs.render = modeSel.value as RenderMode;
    saveLocal(RIG_KEY, vs);
  });
  modeRow.title = '点のデータから直接: ビームを点のデータから直接出す（実機に近い）。クッキー: 出力と同じ映像（クッキー用）を、スポットライトのクッキーとして投影する（Unityなどで起きることの再現）';
  modeRow.append('描き方', modeSel);
  panel.append(modeRow);

  const layoutRow = document.createElement('label');
  const layoutSel = document.createElement('select');
  for (const l of LAYOUTS) layoutSel.add(new Option(l.label, l.id));
  layoutSel.value = vs.layout;
  layoutSel.addEventListener('change', () => {
    vs.layout = layoutSel.value as Layout;
    placeProjectors();
    saveLocal(RIG_KEY, vs);
  });
  layoutRow.title = '複数台の並べ方。扇: 外側ほど外へ向ける / 左右対称: 右半分を左右反転';
  layoutRow.append('並べ方', layoutSel);
  panel.append(layoutRow);

  // 設置場所はアリーナのときだけ
  if (vs.target === 'arena') {
    const placeRow = document.createElement('label');
    const placeSel = document.createElement('select');
    for (const l of PLACES) placeSel.add(new Option(l.label, l.id));
    placeSel.value = vs.place;
    placeSel.addEventListener('change', () => {
      vs.place = placeSel.value as Place;
      placeProjectors();
      saveLocal(RIG_KEY, vs);
    });
    placeRow.title = 'レーザーの置き場所。ステージ前の床・照明トラス・左右のタワー・センターステージ';
    placeRow.append('設置場所', placeSel);
    panel.append(placeRow);
  }

  panel.append(assignBox);
  renderAssign();
  const targetRow = document.createElement('label');
  const select = document.createElement('select');
  for (const t of TARGETS) select.add(new Option(t.label, t.id));
  select.value = vs.target;
  select.addEventListener('change', () => {
    vs.target = select.value as TargetKind;
    const room = ROOMS[vs.target];
    if (room) {
      // 会場を選んだら、奥行きを合わせて客席からの視点にする
      vs.distance = room.depth;
    }
    placeWall();
    placeProjectors();
    placeCamera();
    saveLocal(RIG_KEY, vs);
    buildRigPanel();
  });
  targetRow.append('投影先', select);
  panel.append(targetRow);

  const viewRow = document.createElement('label');
  const viewSel = document.createElement('select');
  for (const v of VIEWS) viewSel.add(new Option(v.label, v.id));
  viewSel.value = vs.view;
  viewSel.addEventListener('change', () => {
    vs.view = viewSel.value as View;
    placeCamera();
    saveLocal(RIG_KEY, vs);
  });
  // ドラッグで動かしたあと、選んでいる視点の位置に戻す
  const back = document.createElement('button');
  back.textContent = '戻す';
  back.addEventListener('click', e => { e.preventDefault(); placeCamera(); });
  viewRow.classList.add('with-button');
  viewRow.append('視点', viewSel, back);
  panel.append(viewRow);
  for (const [key, label, min, max, step] of rows) {
    // 見る側（目・カメラ）の性質はオン/オフで、読み出し時間の手前に並べる
    if (key === 'readout') {
      panel.append(checkRow('eye', '目の感度', '人の目の色ごとの感度で見る。目は緑に敏感で、同じ出力でも赤や青は暗く見える（一般的なRGB機: 赤638nm・緑520nm・青450nm）', applyRig));
      panel.append(checkRow('rolling', 'ローリング', 'スマホや一般的なビデオカメラで撮ったときの写り方。画面を上の行から順に時間をずらして撮るので、速く動くレーザーは曲がったり縞になったりして写る。スキャンのチャンネルを「点のデータから直接」で描いているときだけ効く'));
    }
    const row = document.createElement('label');
    const input = Object.assign(document.createElement('input'), { type: 'range', min, max, step, value: vs[key] });
    const out = document.createElement('output');
    const show = () => { out.textContent = String(vs[key]); };
    input.addEventListener('input', () => {
      vs[key] = Number(input.value);
      // 形を作り直すのは、形に関わる値が変わったときだけ（毎回作ると重く、GPUのメモリも食う）
      if (key === 'distance') placeWall();
      else if (key === 'count' || key === 'spacing') { placeProjectors(); useChannels(); renderAssign(); }
      else if (key === 'bloom') applyBloom();
      else if (key === 'work') applyWorkLight();
      else applySmoke();
      applyRig();
      saveLocal(RIG_KEY, vs);
      show();
    });
    row.append(label, input, out);
    panel.append(row);
    show();
  }
  const note = document.createElement('p');
  note.textContent = 'ドラッグで回転、右ドラッグ（2本指）で移動、ホイール（ピンチ）で拡大。H または右上のボタンでこの枠を隠す';
  panel.append(note);
}

// 設定の枠を隠す（キーボードのないスマホ用にボタンも置く）
const PANEL_KEY = 'laser:viewer:hidden';
const panelToggle = document.getElementById('rig-toggle')!;
const setPanel = (hidden: boolean) => {
  document.getElementById('rig')!.classList.toggle('hidden', hidden);
  panelToggle.textContent = hidden ? '設定' : '隠す';
  saveLocal(PANEL_KEY, hidden);
};
setPanel(loadLocal<boolean>(PANEL_KEY) ?? false);
panelToggle.addEventListener('click', () => setPanel(!document.getElementById('rig')!.classList.contains('hidden')));
addEventListener('keydown', e => {
  if (e.key === 'h' || e.key === 'H') panelToggle.click();
});
