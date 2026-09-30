import {
  ACESFilmicToneMapping, BoxGeometry, Color, GridHelper, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Vector2,
  WebGLRenderer,
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
import { Beams, type Rig } from './beams';
import { ROOMS, Surfaces, TARGETS, type TargetKind } from './surfaces';

// レーザーが空間にどう出るかを3Dで見る（隠し機能）。設定は操作画面と同期する
const params = new URLSearchParams(location.search);
const channel = params.get('ch') || 'default';

const store = new Store({ ...DEFAULTS, ...sanitize(Object.fromEntries(params)) });
const sync = connectSync(store, { channel, role: 'output' });
const sim = new Simulation(store);

// ビューア独自の設定（同期しない）
interface ViewerSettings {
  angle: number;
  haze: number;
  distance: number;
  bloom: number;
  smoke: number;
  grain: number;
  extinction: number;
  target: TargetKind;
}
const RIG_KEY = 'laser:viewer';
const vs: ViewerSettings = {
  angle: 40, haze: 1, distance: 8, bloom: 1, smoke: 0.6, grain: 0.6, extinction: 0.3, target: 'wall',
  ...loadLocal<ViewerSettings>(RIG_KEY),
};
const rig: Rig = { halfAngle: 0, distance: 0, haze: 0 };
const applyRig = () => {
  rig.halfAngle = vs.angle / 2 * Math.PI / 180;
  rig.distance = vs.distance;
  rig.haze = vs.haze;
};
applyRig();

// Retinaで2倍の解像度にするとブルームまで含めて重くなるので等倍で描く（にじみでギザギザは目立たない）
const renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
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
const body = new Mesh(new BoxGeometry(0.4, 0.2, 0.5), new MeshBasicMaterial({ color: 0x1c1c1c }));
body.position.z = 0.26;
scene.add(body);
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
const applySmoke = () => {
  beams.haze.uSmoke.value = vs.smoke;
  beams.haze.uGrain.value = vs.grain;
  // 1で100mあたり約5の減衰（45m先で約1/10）
  beams.haze.uExt.value = vs.extinction * 0.05;
};
applySmoke();
scene.add(beams.group);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new Vector2(1, 1), vs.bloom, 0.5, 0.05);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const resize = () => {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
};
addEventListener('resize', resize);
resize();

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
  const rows: [Exclude<keyof ViewerSettings, 'target'>, string, number, number, number][] = [
    ['angle', '走査角', 10, 80, 1],
    ['haze', 'ヘイズ', 0.1, 5, 0.05],
    ['distance', '壁までの距離', 2, 150, 0.5],
    ['bloom', 'ブルーム', 0, 3, 0.05],
    ['smoke', 'スモーク', 0, 1, 0.05],
    ['grain', 'スモークの粒', 0.2, 2, 0.05],
    ['extinction', 'ヘイズの減衰', 0, 1, 0.05],
  ];
  panel.innerHTML = '<h3>3D</h3>';
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
