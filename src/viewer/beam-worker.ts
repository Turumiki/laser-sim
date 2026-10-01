import { BeamGeometry, type Arrays, type BeamSource, type Projector, type Rig } from './beam-geometry';
import { Hits, type TargetKind } from './hits';

// ビームの形を作る計算を、画面の描画とは別のスレッドで行う。
// 画面側からは会場の作り直しと、毎フレームの材料が届く。作った頂点の並びを返す

export type WorkerRequest =
  | { type: 'scene'; kind: TargetKind; distance: number }
  | { type: 'draw'; projectors: Projector[]; sources: BeamSource[]; rig: Rig; ext: number; recycle: ArrayBuffer[] };

// 頂点の並び1つ（位置・色・光源の位置・光の古さ）。buf の先頭 n 個の float が中身
export interface Part { buf: ArrayBuffer; n: number }
export interface Built { count: number; pos: Part; col: Part; org: Part; age: Part }
// ms: この計算にかかった時間
export interface WorkerResult { type: 'geometry'; sheets: Built; rays: Built; wall: Built; ms: number }

// Worker の中の self（型は画面側と分けずに、使う所だけ書く）
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(m: WorkerResult, transfer: Transferable[]): void;
};

const hits = new Hits();
const geo = new BeamGeometry(hits);
// 画面側から返ってきた入れ物。毎フレーム作り直さずに使い回す
const pool: ArrayBuffer[] = [];

function take(n: number) {
  const bytes = n * 4;
  const i = pool.findIndex(b => b.byteLength >= bytes);
  if (i >= 0) return pool.splice(i, 1)[0];
  return new ArrayBuffer(Math.max(4096, Math.ceil(bytes * 1.5)));
}

function part(src: Float32Array, n: number): Part {
  const buf = take(n);
  new Float32Array(buf, 0, n).set(src.subarray(0, n));
  return { buf, n };
}

function pack(a: Arrays): Built {
  const v = a.count * a.per;
  return { count: a.count, pos: part(a.pos, v * 3), col: part(a.col, v * 3), org: part(a.org, v * 3), age: part(a.age, v) };
}

ctx.onmessage = e => {
  const m = e.data;
  if (m.type === 'scene') {
    hits.build(m.kind, m.distance);
    return;
  }
  pool.push(...m.recycle);
  const t0 = performance.now();
  geo.draw(m.projectors, m.sources, m.rig, m.ext);
  const out: WorkerResult = { type: 'geometry', sheets: pack(geo.sheets), rays: pack(geo.rays), wall: pack(geo.wall), ms: performance.now() - t0 };
  const transfer = [out.sheets, out.rays, out.wall].flatMap(b => [b.pos.buf, b.col.buf, b.org.buf, b.age.buf]);
  ctx.postMessage(out, transfer);
};
