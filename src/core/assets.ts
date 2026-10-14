import type { FrameBuilder } from './frame.ts';

// 読み込んだ素材（画像・SVG・ILDAファイル）。中身はサーバーに置き、パターン名 "asset:<id>" で使う。
// 座標は -1..1（ILDAの座標空間と同じ正方形）、上が +y
export interface VectorPath {
  // [x0, y0, x1, y1, ...]
  pts: number[];
  rgb: [number, number, number];
  closed: boolean;
}

export interface IldaFrame {
  x: number[];
  y: number[];
  // 色を 0xRRGGBB にしたもの。-1 は消灯
  c: number[];
}

export type AssetData =
  | { kind: 'vector'; paths: VectorPath[] }
  | { kind: 'ilda'; fps: number; frames: IldaFrame[] };

export interface AssetInfo {
  id: string;
  name: string;
  kind: AssetData['kind'];
}

export interface Asset extends AssetInfo {
  data: AssetData;
}

export const ASSET_PREFIX = 'asset:';
export const isAsset = (pattern: string) => pattern.startsWith(ASSET_PREFIX);
export const assetPattern = (id: string) => ASSET_PREFIX + id;

// 読み込み済みの素材。無ければサーバーから取ってくる（取れるまでは何も描かない）
const cache = new Map<string, Asset | 'loading' | 'missing'>();

function load(id: string): Asset | null {
  const hit = cache.get(id);
  if (hit && typeof hit === 'object') return hit;
  if (!hit && typeof fetch === 'function') {
    cache.set(id, 'loading');
    fetch(`/api/assets/${encodeURIComponent(id)}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((a: Asset) => cache.set(id, a))
      .catch(() => cache.set(id, 'missing'));
  }
  return null;
}

// 自分で読み込んだ素材は、サーバーから取り直さずにすぐ使う
export function primeAsset(a: Asset) {
  cache.set(a.id, a);
}

// 読み込み直したり消したりしたときに、手元の写しを捨てる
export function forgetAsset(id: string) {
  cache.delete(id);
}

export function assetName(id: string) {
  const a = load(id);
  return a ? a.name : '素材';
}

const rgbOf = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

export function drawAsset(f: FrameBuilder, id: string, t: number) {
  const a = load(id);
  if (!a) return;
  const d = a.data;
  if (d.kind === 'vector') {
    for (const p of d.paths) {
      f.color(p.rgb);
      f.path(p.pts, p.closed);
    }
    f.color(null);
    return;
  }
  if (!d.frames.length) return;
  // アニメーションはファイルのコマ数で回す（速さはアニメ速度で変わる）
  const fr = d.frames[Math.floor(Math.max(0, t) * d.fps) % d.frames.length];
  for (let i = 0; i < fr.x.length; i++) {
    const c = fr.c[i];
    f.raw(fr.x[i], fr.y[i], c >= 0, c >= 0 ? rgbOf(c) : BLACK);
  }
}

const BLACK: readonly number[] = [0, 0, 0];
