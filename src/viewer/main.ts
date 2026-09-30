import {
  ACESFilmicToneMapping, BoxGeometry, Color, GridHelper, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry,
  Scene, Vector2, WebGLRenderer,
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

// レーザーが空間にどう出るかを3Dで見る（隠し機能）。設定は操作画面と同期する
const params = new URLSearchParams(location.search);
const channel = params.get('ch') || 'default';

const store = new Store({ ...DEFAULTS, ...sanitize(Object.fromEntries(params)) });
connectSync(store, { channel, role: 'output' });
const sim = new Simulation(store);

// ビューア独自の設定（同期しない）
interface ViewerSettings { angle: number; haze: number; distance: number; bloom: number }
const RIG_KEY = 'laser:viewer';
const vs: ViewerSettings = { angle: 40, haze: 1, distance: 8, bloom: 1, ...loadLocal<ViewerSettings>(RIG_KEY) };
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

const camera = new PerspectiveCamera(50, 1, 0.05, 200);
camera.position.set(5, 1.6, 3);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, -vs.distance / 2);
controls.enableDamping = true;

// プロジェクター本体、床、壁
const body = new Mesh(new BoxGeometry(0.4, 0.2, 0.5), new MeshBasicMaterial({ color: 0x1c1c1c }));
body.position.z = 0.26;
scene.add(body);
const floor = new GridHelper(40, 40, 0x1a1a1a, 0x111111);
floor.position.y = -2.2;
scene.add(floor);
const wall = new Mesh(new PlaneGeometry(60, 30), new MeshBasicMaterial({ color: 0x080808 }));
scene.add(wall);
const placeWall = () => { wall.position.z = -vs.distance - 0.02; };
placeWall();

const beams = new Beams(rig);
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
  const s = store.get();
  if (s.mode === 'scan') beams.fromScanner(sim.scanner, s);
  else beams.fromFrame(sim.currentFrame(), s);
  controls.update();
  composer.render();
});

function buildRigPanel() {
  const panel = document.getElementById('rig')!;
  const rows: [keyof ViewerSettings, string, number, number, number][] = [
    ['angle', '走査角', 10, 80, 1],
    ['haze', 'ヘイズ', 0.1, 5, 0.05],
    ['distance', '壁までの距離', 2, 20, 0.5],
    ['bloom', 'ブルーム', 0, 3, 0.05],
  ];
  panel.innerHTML = '<h3>3D</h3>';
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
  addEventListener('keydown', e => { if (e.key === 'h' || e.key === 'H') panel.classList.toggle('hidden'); });
}
