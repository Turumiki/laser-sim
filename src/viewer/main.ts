import {
  ACESFilmicToneMapping, BoxGeometry, Color, DirectionalLight, GridHelper, Group, HemisphereLight, Mesh, MeshBasicMaterial,
  PerspectiveCamera, Scene, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useServerAssets } from '../browser/assets';
import { preventDoubleTapZoom } from '../browser/dom';
import { saveLocal } from '../browser/persist';
import { fastTooltips } from '../browser/tooltip';
import { EYE_GAIN } from '../core/color';
import { DEFAULTS, sanitize } from '../core/params';
import { Beams, type ChannelSnapshot, type Projector, type Rig } from './beams';
import { viewPose } from './camera-views';
import { ChannelAssign } from './channel-assign';
import { Cookies } from './cookies';
import { Feeds, type Feed } from './feeds';
import { HAZE_LAYER } from './haze-shader';
import { PostChain } from './post-chain';
import { projectorsFor } from './projectors';
import { buildRigPanel, setupPanelToggle } from './rig-panel';
import { assignedChannels, loadViewerSettings, VIEWER_DEFAULTS, VIEWER_KEY, VIEWS, type NumKey } from './settings';
import { ROOMS, setEdgeLevel, Surfaces } from './surfaces';
import type { VolumeProjector } from './volume';
import { setupXr, standAt } from './xr';

// レーザーが空間にどう出るかを3Dで見る（隠し機能）。設定は操作画面と同期する
useServerAssets();

const params = new URLSearchParams(location.search);
const channel = params.get('ch') || 'default';
const vs = loadViewerSettings(params, channel);
const save = () => saveLocal(VIEWER_KEY, vs);

const feeds = new Feeds({ ...DEFAULTS, ...sanitize(Object.fromEntries(params)) });
const assigned = () => assignedChannels(vs, channel);
const useChannels = () => feeds.use(assigned());
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
// スライダーの1のときの明るさ
const HEMI_LEVEL = 1.4, HEADLIGHT_LEVEL = 1.6;
const applyWorkLight = () => {
  hemi.intensity = vs.work * HEMI_LEVEL;
  headlight.intensity = vs.work * HEADLIGHT_LEVEL;
  setEdgeLevel(vs.work);
};

const camera = new PerspectiveCamera(50, 1, 0.05, 2000);
// VRでは頭の位置がこの台の上で動く
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

// 床、壁、会場
const surfaces = new Surfaces();
scene.add(surfaces.group);
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
const placeWall = () => {
  surfaces.build(vs.target, vs.distance);
  placeGrid();
};
placeWall();

function placeCamera() {
  const { pos, look } = viewPose(vs, -surfaces.floor);
  camera.position.set(...pos);
  controls.target.set(...look);
  controls.update();
  if (renderer.xr.isPresenting) standAt(player, camera, controls.target);
}
placeCamera();

// プロジェクター本体
const beams = new Beams(rig, surfaces);
scene.add(beams.group);
const bodies = new Group();
scene.add(bodies);
const bodyGeo = new BoxGeometry(0.4, 0.2, 0.5), bodyMat = new MeshBasicMaterial({ color: 0x1c1c1c });
let projectors: Projector[] = [];
const placeProjectors = () => {
  projectors = projectorsFor(vs);
  beams.setProjectors(projectors);
  bodies.clear();
  for (const p of projectors) {
    const m = new Mesh(bodyGeo, bodyMat);
    m.position.set(...p.pos);
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

const cookies = new Cookies();
const post = new PostChain(renderer, scene, camera, beams);
const resize = () => {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  post.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
};
const buildPost = () => {
  post.build(vs.quality, vs.bloom);
  cookies.size = vs.quality === 'low' ? 256 : 512;
  resize();
};
addEventListener('resize', resize);
buildPost();

// 設定の枠
const assign = new ChannelAssign(assigned, (i, ch) => {
  const next = assigned();
  next[i] = ch;
  vs.channels = next;
  useChannels();
  save();
});
// 数値を変えたときに、作り直しが要るものだけ作り直す（毎回作ると重く、GPUのメモリも食う）
const onNumber = (key: NumKey) => {
  if (key === 'distance') placeWall();
  else if (key === 'count' || key === 'spacing') { placeProjectors(); useChannels(); assign.render(); }
  else if (key === 'bloom') post.setBloom(vs.bloom);
  else if (key === 'work') applyWorkLight();
  else applySmoke();
  applyRig();
};
const panel = document.getElementById('rig')!;
buildRigPanel(panel, vs, assign, {
  number: onNumber,
  quality: buildPost,
  view: placeCamera,
  target: () => { placeWall(); placeProjectors(); placeCamera(); },
  projectors: placeProjectors,
  eye: applyRig,
  reset: () => {
    // チャンネルの割り当てはそのまま。URLで指定した値も外して開き直す
    saveLocal(VIEWER_KEY, { ...VIEWER_DEFAULTS, channels: vs.channels });
    const ch = params.get('ch');
    location.href = location.pathname + (ch ? `?ch=${encodeURIComponent(ch)}` : '');
  },
});
setupPanelToggle(panel, document.getElementById('rig-toggle')!);
fastTooltips();
preventDoubleTapZoom();

setupXr({
  renderer,
  player,
  button: document.getElementById('xr-enter') as HTMLButtonElement,
  placeCamera,
  // コントローラのトリガーで、次の視点へ移る
  onSelect: () => {
    const k = VIEWS.findIndex(v => v.id === vs.view);
    vs.view = VIEWS[(k + 1) % VIEWS.length].id;
    save();
    placeCamera();
  },
  onEnd: () => { placeCamera(); resize(); },
});

// 開発中だけ、ブラウザのコンソールから中身を見られるようにする
if (import.meta.env.DEV) Object.assign(window, { laser3d: { renderer, feeds, beams, camera, controls, post } });

// ?stats=1 で、fps と1フレームの処理時間（CPU側）を出す
let fps = 0, cpu = 0;
if (params.get('stats') === '1') {
  const stats = document.body.appendChild(document.createElement('div'));
  stats.id = 'stats';
  let lastUpdates = 0;
  setInterval(() => {
    const rate = (beams.updates - lastUpdates) * 4;
    lastUpdates = beams.updates;
    stats.textContent = `${fps.toFixed(0)} fps · 画面 ${cpu.toFixed(2)} ms · ビーム ${beams.calcMs.toFixed(1)} ms（${beams.threaded ? '別スレッド' : '画面と同じ'}、${rate}回/秒）`;
  }, 250);
}

const NO_GAIN = [1, 1, 1] as const;
const eyePos = new Vector3();
let hazeTime = 0;
let last = performance.now();
// VR中は、ヘッドセットの描画の間隔で回る（requestAnimationFrame は止まる）
renderer.setAnimationLoop(now => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const t0 = performance.now();
  const xr = renderer.xr.isPresenting;
  if (dt > 0) fps += (1 / dt - fps) * 0.05;
  for (const f of feeds.all()) {
    f.sim.update(dt);
    f.sim.syncAnim(f.sync.time.animNow());
  }
  // ローリングシャッター。露光時間とスローは全チャンネル共通なので、どのチャンネルで計っても同じ
  const f0 = feeds.order[0], s0 = f0?.store.get();
  rig.roll = vs.rolling && s0 && !xr ? vs.readout / 1000 * s0.timeScale / f0.sim.exposureTime() : 0;
  beams.haze.uRoll.value.set(rig.roll, s0?.exposureShape === 'exp' ? 1 : 0);
  renderer.getDrawingBufferSize(beams.haze.uRes.value);
  surfaces.updateFacing(camera.getWorldPosition(eyePos));
  // クッキーの描き方は画面ごとに前のコマを重ねる作りで、左右の目でずれるので、VRでは点データで描く
  const video = vs.render === 'video' && !xr;
  beams.group.visible = !video;
  if (video) {
    // 各台に、そのチャンネルの映像をクッキーとして割り当てる
    const list: VolumeProjector[] = projectors.map((p, k) => {
      const f = feeds.order[k % feeds.order.length];
      return { ...p, halfTan: Math.tan(f.store.get().scanAngle / 2 * Math.PI / 180), cookie: cookies.get(f.store, f.sim) };
    });
    cookies.update(new Set(feeds.order.map(f => f.sim)));
    post.drawVideo(list, { maxDistance: vs.distance * 1.5, haze: vs.haze, flat: vs.flat, gain: vs.eye ? EYE_GAIN : NO_GAIN });
  } else {
    cookies.update(new Set());
    post.stopVideo();
    beams.draw(snapshots(feeds.order));
  }
  // 流れの速さを変えても形が飛ばないよう、時間を積み上げる
  hazeTime += dt * vs.flow;
  beams.haze.uTime.value = hazeTime;
  // 煙の糸の模様を、時間に合わせて少しずつ焼き進める
  beams.field.update(renderer, hazeTime);
  if (xr) {
    // ブルームなどの後処理は左右2枚の描画に使えないので、そのまま描く（光の膜も一緒に）
    camera.layers.enable(HAZE_LAYER);
    renderer.render(scene, camera);
    camera.layers.disable(HAZE_LAYER);
  } else {
    controls.update();
    post.render();
  }
  cpu += (performance.now() - t0 - cpu) * 0.05;
});

// チャンネルごとに1回だけ材料を作り、同じチャンネルの台で使い回す
function snapshots(order: readonly Feed[]): ChannelSnapshot[] {
  const made = new Map<Feed, ChannelSnapshot>();
  return order.map(f => {
    let s = made.get(f);
    if (!s) {
      const settings = f.store.get();
      s = { settings, scanner: f.sim.scanner, tau: f.sim.exposureTime(), frame: settings.mode === 'scan' ? null : f.sim.currentFrame() };
      made.set(f, s);
    }
    return s;
  });
}
