import {
  ACESFilmicToneMapping, BoxGeometry, Color, DepthTexture, DirectionalLight, GridHelper, Group, HalfFloatType, HemisphereLight, Mesh, MeshBasicMaterial, PerspectiveCamera,
  Scene, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { DEFAULTS, sanitize } from '../core/params';
import { loadLocal, saveLocal } from '../core/persist';
import { Store } from '../core/store';
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
// 設定の枠で閉じているまとまり
const CLOSED_KEY = 'laser:viewer:closed';
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
// VRでは頭の位置がこの台の上で動く。普段は原点のままで何もしない
const player = new Group();
player.add(camera);
// カメラから見て少し上・左から当てる（真正面からだと面の向きの差が出ない）
headlight.position.set(-0.3, 0.5, 1);
headlight.target.position.set(0, 0, 0);
camera.add(headlight, headlight.target);
scene.add(hemi, player);
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
  if (renderer.xr.isPresenting) standAtView();
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
let last = performance.now();
// VR中は、ヘッドセットの描画の間隔で回る（requestAnimationFrame は止まる）
renderer.setAnimationLoop(now => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const t0 = performance.now();
  const xr = renderer.xr.isPresenting;
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
  rig.roll = vs.rolling && s0 && !xr ? vs.readout / 1000 * s0.timeScale / f0.sim.exposureTime() : 0;
  beams.haze.uRoll.value.set(rig.roll, s0?.exposureShape === 'exp' ? 1 : 0);
  renderer.getDrawingBufferSize(beams.haze.uRes.value);
  surfaces.updateFacing(camera.getWorldPosition(eyePos));
  // クッキーの描き方は画面ごとに前のコマを重ねる作りで、左右の目でずれるので、VRでは点のデータで描く
  const video = vs.render === 'video' && !xr;
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
  if (xr) {
    // ブルームなどの後処理は左右2枚の描画に使えないので、そのまま描く
    renderer.render(scene, camera);
  } else {
    controls.update();
    composer.render();
  }
  cpu += (performance.now() - t0 - cpu) * 0.05;
});

// --- VR ---
// ヘッドセットの床の高さが会場の床に合うように、選んでいる視点の位置に立つ。顔はステージの方へ向ける
const eyePos = new Vector3();
function standAtView() {
  const p = camera.position.clone(), t = controls.target.clone();
  // 普段の視点の高さは目の高さ（床から1.6m）なので、足もとに直す
  player.position.set(p.x, p.y - 1.6, p.z);
  player.rotation.set(0, Math.atan2(-(t.x - p.x), -(t.z - p.z)), 0);
  camera.position.set(0, 1.6, 0);
  camera.rotation.set(0, 0, 0);
}
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
// コントローラのトリガーで、次の視点へ移る
for (const i of [0, 1]) {
  renderer.xr.getController(i).addEventListener('select', () => {
    const k = VIEWS.findIndex(v => v.id === vs.view);
    vs.view = VIEWS[(k + 1) % VIEWS.length].id;
    saveLocal(RIG_KEY, vs);
    placeCamera();
  });
}
const xrButton = document.getElementById('xr-enter') as HTMLButtonElement;
let xrSession: XRSession | null = null;
xrButton.addEventListener('click', async () => {
  if (xrSession) { await xrSession.end(); return; }
  try {
    const session = await navigator.xr!.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
    xrSession = session;
    // 視点の位置を先に計算してから立たせる（OrbitControls は VR 中は止める）
    placeCamera();
    await renderer.xr.setSession(session);
    standAtView();
    xrButton.textContent = 'VRを終える';
    session.addEventListener('end', () => {
      xrSession = null;
      xrButton.textContent = 'VRで見る';
      player.position.set(0, 0, 0);
      player.rotation.set(0, 0, 0);
      placeCamera();
      resize();
    });
  } catch (e) {
    xrButton.textContent = 'VRに入れませんでした';
    console.warn(e);
  }
});
// VRの機器がつながっていて、https で開いているときだけボタンを出す
navigator.xr?.isSessionSupported('immersive-vr').then(ok => { xrButton.hidden = !ok; }).catch(() => {});



// 設定の枠。エディタのインスペクターと同じく、役割ごとのまとまりに分けて開け閉めできるようにする
type NumKey = 'count' | 'spacing' | 'haze' | 'distance' | 'bloom' | 'work' | 'smoke' | 'grain' | 'flow' | 'extinction' | 'flat' | 'readout';

// 数値を変えたときに、作り直しが要るものだけ作り直す（毎回作ると重く、GPUのメモリも食う）
function applyNumber(key: NumKey) {
  if (key === 'distance') placeWall();
  else if (key === 'count' || key === 'spacing') { placeProjectors(); useChannels(); renderAssign(); }
  else if (key === 'bloom') applyBloom();
  else if (key === 'work') applyWorkLight();
  else applySmoke();
  applyRig();
}

function buildRigPanel() {
  const panel = document.getElementById('rig')!;
  panel.replaceChildren();
  const closed = new Set(loadLocal<string[]>(CLOSED_KEY) ?? []);
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  };
  const save = () => saveLocal(RIG_KEY, vs);

  // 見出しと、初期値に戻すボタン。チャンネルの割り当てはそのまま。URLで指定した値も外して開き直す
  const head = el('div', 'head');
  const reset = el('button', 'reset', '初期値に戻す');
  reset.title = '3Dビューアの設定をすべて初期値に戻す（台ごとのチャンネルはそのまま）';
  reset.addEventListener('click', () => {
    saveLocal(RIG_KEY, { ...VIEWER_DEFAULTS, channels: vs.channels });
    const ch = params.get('ch');
    location.href = location.pathname + (ch ? `?ch=${encodeURIComponent(ch)}` : '');
  });
  head.append(el('span', 'title', '3Dビューア'), reset);
  panel.append(head);

  const section = (id: string, title: string) => {
    const box = el('section', closed.has(id) ? 'grp closed' : 'grp');
    const h = el('h4', '', title);
    const rows = el('div', 'rows');
    h.addEventListener('click', () => {
      box.classList.toggle('closed');
      if (box.classList.contains('closed')) closed.add(id); else closed.delete(id);
      saveLocal(CLOSED_KEY, [...closed]);
    });
    box.append(h, rows);
    panel.append(box);
    return rows;
  };
  const row = (parent: HTMLElement, label: string, title: string, ...controls: HTMLElement[]) => {
    const r = el('div', 'row');
    r.title = title;
    r.append(el('span', 'name', label), ...controls);
    parent.append(r);
    return r;
  };
  const select = <T extends string>(parent: HTMLElement, label: string, title: string, options: readonly { id: T; label: string }[], value: T, set: (v: T) => void) => {
    const sel = el('select');
    for (const o of options) sel.add(new Option(o.label, o.id));
    sel.value = value;
    sel.addEventListener('change', () => { set(sel.value as T); save(); });
    return row(parent, label, title, sel);
  };
  // 選択肢が少ないものは、並んだボタンで選ぶ
  const seg = <T extends string>(parent: HTMLElement, label: string, title: string, options: readonly { id: T; label: string }[], value: T, set: (v: T) => void) => {
    const box = el('div', 'seg');
    for (const o of options) {
      const b = el('button', o.id === value ? 'on' : '', o.label);
      b.addEventListener('click', () => {
        for (const x of box.children) x.classList.toggle('on', x === b);
        set(o.id);
        save();
      });
      box.append(b);
    }
    return row(parent, label, title, box);
  };
  const range = (parent: HTMLElement, key: NumKey, label: string, title: string, min: number, max: number, step: number, unit = '') => {
    const input = Object.assign(el('input'), { type: 'range', min, max, step, value: vs[key] });
    const out = el('output');
    const digits = step < 0.1 ? 2 : step < 1 ? 1 : 0;
    const show = () => { out.textContent = vs[key].toFixed(digits) + unit; };
    input.addEventListener('input', () => {
      vs[key] = Number(input.value);
      applyNumber(key);
      save();
      show();
    });
    show();
    return row(parent, label, title, input, out);
  };
  const check = (parent: HTMLElement, key: 'eye' | 'rolling', label: string, title: string, then?: () => void) => {
    const box = Object.assign(el('input'), { type: 'checkbox', checked: vs[key] });
    box.addEventListener('change', () => { vs[key] = box.checked; then?.(); save(); });
    return row(parent, label, title, box);
  };

  // --- 表示 ---
  const view = section('view', '表示');
  seg(view, '描き方', '点のデータ: ビームを点のデータから直接出す（実機に近い）。クッキー: 出力と同じ映像（クッキー用）を、スポットライトのクッキーとして投影する（Unityなどで起きることの再現）',
    RENDER_MODES.map(m => ({ id: m.id, label: m.id === 'vector' ? '点データ' : 'クッキー' })), vs.render, v => { vs.render = v; buildRigPanel(); });
  seg(view, '画質', 'High: 高解像度・アンチエイリアス・細かいスモーク。Low: 解像度を下げ、ブルームなしで軽くする（スマホ向け）',
    (Object.keys(QUALITY) as Quality[]).map(id => ({ id, label: QUALITY[id].label })), vs.quality, v => { vs.quality = v; buildComposer(); });
  const viewRow = select(view, '視点', '見る位置。ドラッグで動かしたあと「戻す」でこの位置に戻る', VIEWS, vs.view, v => { vs.view = v; placeCamera(); });
  const back = el('button', 'small', '戻す');
  back.addEventListener('click', () => placeCamera());
  viewRow.append(back);
  viewRow.classList.add('with-button');

  // --- 会場 ---
  const venue = section('venue', '会場');
  select(venue, '投影先', 'ビームが当たる物。会場を選ぶと、奥行きも会場の大きさになる', TARGETS, vs.target, v => {
    vs.target = v;
    const room = ROOMS[v];
    // 会場を選んだら、奥行きを合わせて客席からの視点にする
    if (room) vs.distance = room.depth;
    placeWall();
    placeProjectors();
    placeCamera();
    buildRigPanel();
  });
  range(venue, 'distance', ROOMS[vs.target] ? '奥行き' : '壁までの距離', 'プロジェクターから奥の壁までの距離', 2, 150, 0.5, ' m');
  range(venue, 'work', '作業灯', '会場の形を見るための明かり。0で本番のような真っ暗', 0, 1, 0.05);

  // --- レーザー機 ---
  const rigBox = section('rig', 'レーザー機');
  range(rigBox, 'count', '台数', 'プロジェクターの台数', 1, 8, 1, ' 台');
  range(rigBox, 'spacing', '間隔', '隣の台との間隔', 0.5, 10, 0.5, ' m');
  select(rigBox, '並べ方', '複数台の並べ方。扇: 外側ほど外へ向ける / 左右対称: 右半分を左右反転', LAYOUTS, vs.layout, v => { vs.layout = v; placeProjectors(); });
  if (vs.target === 'arena') {
    select(rigBox, '設置場所', 'レーザーの置き場所。ステージ前の床・照明トラス・左右のタワー・センターステージ', PLACES, vs.place, v => { vs.place = v; placeProjectors(); });
  }
  rigBox.append(assignBox);
  renderAssign();

  // --- ヘイズ ---
  const haze = section('haze', 'ヘイズ');
  range(haze, 'haze', '濃さ', 'ヘイズの濃さ（ビームの明るさ）', 0.1, 5, 0.05);
  range(haze, 'smoke', 'むら', '濃さのむらの強さ。0で一様', 0, 1, 0.05);
  range(haze, 'grain', 'むらの細かさ', 'むらの模様の細かさ', 0.2, 2, 0.05);
  range(haze, 'flow', '流れ', '空調や送風で流れる速さ。0で止まる', 0, 3, 0.1);
  range(haze, 'extinction', '減衰', '遠くへ行くほど光が弱まる度合い（ヘイズに吸われ、散らされる）', 0, 1, 0.05);

  // --- 見え方（目・カメラ） ---
  const look = section('look', '見え方');
  range(look, 'bloom', 'ブルーム', '明るい所のにじみ（カメラやレンズでの光のあふれ）', 0, 3, 0.05);
  check(look, 'eye', '目の感度', '人の目の色ごとの感度で見る。目は緑に敏感で、同じ出力でも赤や青は暗く見える（一般的なRGB機: 赤638nm・緑520nm・青450nm）', applyRig);
  check(look, 'rolling', 'ローリング', 'スマホや一般的なビデオカメラで撮ったときの写り方。画面を上の行から順に時間をずらして撮るので、速く動くレーザーは曲がったり縞になったりして写る。スキャンのチャンネルを「点のデータ」で描いているときだけ効く', () => buildRigPanel());
  if (vs.rolling) range(look, 'readout', '読み出し時間', '画面の上から下まで読み出すのにかかる時間。スマホでだいたい10〜30ms', 1, 40, 1, ' ms');
  if (vs.render === 'video') range(look, 'flat', '距離減衰の補正', 'クッキーの描き方で、遠くの減衰を弱める（1で距離に反比例）。Unityのライトの減衰カーブを平らにしたときの見え方', 0, 1, 0.05);

  panel.append(el('p', 'note', 'ドラッグで回転、右ドラッグ（2本指）で移動、ホイール（ピンチ）で拡大。H または右上のボタンでこの枠を隠す'));
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
