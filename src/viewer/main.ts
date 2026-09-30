import {
  ACESFilmicToneMapping, BoxGeometry, Color, GridHelper, Group, HalfFloatType, Mesh, MeshBasicMaterial, PerspectiveCamera,
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
import { Beams, type Projector, type Rig } from './beams';
import { ROOMS, Surfaces, TARGETS, type TargetKind } from './surfaces';

// レーザーが空間にどう出るかを3Dで見る（隠し機能）。設定は操作画面と同期する
const params = new URLSearchParams(location.search);
const channel = params.get('ch') || 'default';

const store = new Store({ ...DEFAULTS, ...sanitize(Object.fromEntries(params)) });
const sync = connectSync(store, { channel, role: 'output' });
const sim = new Simulation(store);

// ビューア独自の設定（同期しない）
type Quality = 'high' | 'mid' | 'low';
const QUALITY: Record<Quality, { label: string; pixelRatio: () => number; samples: number; thick: number }> = {
  high: { label: 'High', pixelRatio: () => Math.min(devicePixelRatio, 2), samples: 4, thick: 1 },
  mid: { label: 'Mid', pixelRatio: () => 1, samples: 0, thick: 1 },
  low: { label: 'Low', pixelRatio: () => 0.5, samples: 0, thick: 0 },
};

// 複数台の並べ方。実際の現場でよくある置き方
type Layout = 'parallel' | 'fan' | 'mirror';
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
  quality: Quality;
  angle: number;
  haze: number;
  distance: number;
  bloom: number;
  smoke: number;
  grain: number;
  extinction: number;
  target: TargetKind;
  count: number;
  spacing: number;
  layout: Layout;
}
const RIG_KEY = 'laser:viewer';
const vs: ViewerSettings = {
  quality: 'mid', angle: 40, haze: 1, distance: 8, bloom: 1, smoke: 0.6, grain: 0.6, extinction: 0.3, target: 'wall', count: 1, spacing: 2, layout: 'parallel',
  ...loadLocal<ViewerSettings>(RIG_KEY),
};
const rig: Rig = { halfAngle: 0, distance: 0, haze: 0 };
const applyRig = () => {
  rig.halfAngle = vs.angle / 2 * Math.PI / 180;
  rig.distance = vs.distance;
  rig.haze = vs.haze;
};
applyRig();

// アンチエイリアスは画質設定に合わせて、ポストエフェクト用のバッファ側でかける
const renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.toneMapping = ACESFilmicToneMapping;
document.body.prepend(renderer.domElement);

const scene = new Scene();
scene.background = new Color(0x030303);

const camera = new PerspectiveCamera(50, 1, 0.05, 2000);
camera.position.set(5, 1.6, 3);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, -vs.distance / 2);
controls.enableDamping = true;

// プロジェクター本体、床、壁
const bodies = new Group();
scene.add(bodies);
const bodyGeo = new BoxGeometry(0.4, 0.2, 0.5), bodyMat = new MeshBasicMaterial({ color: 0x1c1c1c });
let grid: GridHelper | null = null;
// 床の目盛りは1m間隔。壁までの距離に合わせて広げる
const placeGrid = () => {
  if (grid) { scene.remove(grid); grid.dispose(); }
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

const beams = new Beams(rig, surfaces);
const placeProjectors = () => {
  const list = layout(vs.count, vs.spacing, vs.layout);
  beams.setProjectors(list);
  bodies.clear();
  for (const p of list) {
    const m = new Mesh(bodyGeo, bodyMat);
    m.position.set(p.pos[0], p.pos[1], p.pos[2]);
    m.rotation.y = p.yaw;
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

let composer: EffectComposer;
let bloom: UnrealBloomPass;
// 画質を変えたら、解像度とアンチエイリアスに合わせて作り直す
const buildComposer = () => {
  const q = QUALITY[vs.quality] ?? QUALITY.mid;
  composer?.dispose();
  renderer.setPixelRatio(q.pixelRatio());
  const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: q.samples });
  composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new Vector2(1, 1), vs.bloom, 0.5, 0.05);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  beams.haze.uThick.value = q.thick;
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

buildRigPanel();

startLoop(dt => {
  sim.update(dt);
  sim.syncAnim(sync.time.animNow());
  const s = store.get();
  if (s.mode === 'scan') beams.fromScanner(sim.scanner, s, sim.exposureTime());
  else beams.fromFrame(sim.currentFrame(), s);
  beams.haze.uTime.value = performance.now() / 1000;
  controls.update();
  composer.render();
});

function buildRigPanel() {
  const panel = document.getElementById('rig')!;
  const rows: [Exclude<keyof ViewerSettings, 'target' | 'quality' | 'layout'>, string, number, number, number][] = [
    ['count', '台数', 1, 8, 1],
    ['spacing', '間隔', 0.5, 10, 0.5],
    ['angle', '走査角', 10, 80, 1],
    ['haze', 'ヘイズ', 0.1, 5, 0.05],
    ['distance', '壁までの距離', 2, 150, 0.5],
    ['bloom', 'ブルーム', 0, 3, 0.05],
    ['smoke', 'スモーク', 0, 1, 0.05],
    ['grain', 'スモークの粒', 0.2, 2, 0.05],
    ['extinction', 'ヘイズの減衰', 0, 1, 0.05],
  ];
  panel.innerHTML = '<h3>3D</h3>';
  const qualityRow = document.createElement('label');
  const quality = document.createElement('select');
  for (const [id, q] of Object.entries(QUALITY)) quality.add(new Option(q.label, id));
  quality.value = vs.quality;
  quality.addEventListener('change', () => {
    vs.quality = quality.value as Quality;
    buildComposer();
    saveLocal(RIG_KEY, vs);
  });
  qualityRow.title = 'High: 高解像度とアンチエイリアス。Low: 半分の解像度で軽くする';
  qualityRow.append('画質', quality);
  panel.append(qualityRow);

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
      camera.position.set(room.width * 0.2, -room.floor + 1.6, -room.depth * 0.7);
      controls.target.set(0, room.height * 0.25, 0);
    }
    placeWall();
    saveLocal(RIG_KEY, vs);
    if (room) buildRigPanel();
  });
  targetRow.append('投影先', select);
  panel.append(targetRow);
  for (const [key, label, min, max, step] of rows) {
    const row = document.createElement('label');
    const input = Object.assign(document.createElement('input'), { type: 'range', min, max, step, value: vs[key] });
    const out = document.createElement('output');
    const show = () => { out.textContent = key === 'angle' ? `${vs[key]}°` : String(vs[key]); };
    input.addEventListener('input', () => {
      vs[key] = Number(input.value);
      applyRig();
      placeWall();
      bloom.strength = vs.bloom;
      applySmoke();
      placeProjectors();
      saveLocal(RIG_KEY, vs);
      show();
    });
    row.append(label, input, out);
    panel.append(row);
    show();
  }
  const note = document.createElement('p');
  note.textContent = 'ドラッグで回転、右ドラッグで移動、ホイールで拡大。H でこの枠を隠す';
  panel.append(note);
}

addEventListener('keydown', e => {
  if (e.key === 'h' || e.key === 'H') document.getElementById('rig')!.classList.toggle('hidden');
});
