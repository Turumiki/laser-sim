import { loadLocal } from '../browser/persist';
import { isValidChannel } from '../core/protocol';
import { ROOMS, TARGETS, type TargetKind } from './surfaces';

// 3Dビューア独自の設定（同期しない。この端末のブラウザに保存する）

export type Quality = 'high' | 'mid' | 'low';
// thick: ヘイズの膜の厚みを何か所で測るか（1: 3か所）
export const QUALITY: Record<Quality, { label: string; pixelRatio: () => number; samples: number; thick: number }> = {
  high: { label: '高', pixelRatio: () => Math.min(devicePixelRatio, 2), samples: 4, thick: 1 },
  mid: { label: '中', pixelRatio: () => 1, samples: 0, thick: 0 },
  low: { label: '低', pixelRatio: () => 0.75, samples: 0, thick: 0 },
};
const QUALITIES = (Object.keys(QUALITY) as Quality[]).map(id => ({ id, label: QUALITY[id].label }));

// 複数台の並べ方。実際の現場でよくある置き方
export type Layout = 'parallel' | 'fan' | 'mirror';
export const LAYOUTS: readonly { id: Layout; label: string }[] = [
  { id: 'parallel', label: '平行' },
  { id: 'fan', label: '扇' },
  { id: 'mirror', label: '左右対称' },
];

// 設置場所（アリーナのとき）。現場でよく使う置き場所
export type Place = 'rig' | 'deck' | 'truss' | 'towers' | 'center';
export const PLACES: readonly { id: Place; label: string }[] = [
  { id: 'rig', label: '標準（床から5m）' },
  { id: 'deck', label: 'ステージ前の床' },
  { id: 'truss', label: 'ステージ上のトラス' },
  { id: 'towers', label: '上手・下手のタワー' },
  { id: 'center', label: 'センターステージ' },
];

export type View = 'audience' | 'foh' | 'side' | 'stage';
export const VIEWS: readonly { id: View; label: string }[] = [
  { id: 'audience', label: '客席' },
  // 照明やレーザーのオペレーターがいる卓（客席の中央、後ろ寄り）
  { id: 'foh', label: 'FOH（卓）' },
  { id: 'side', label: '俯瞰' },
  { id: 'stage', label: 'ステージ後方' },
];

// 描き方。点データ: 点データから直接ビームを出す（実機に近い） / クッキー: Unityに渡すのと同じ映像をクッキーとして投影する
export type RenderMode = 'vector' | 'video';
export const RENDER_MODES: readonly { id: RenderMode; label: string }[] = [
  { id: 'vector', label: '点データ' },
  { id: 'video', label: 'クッキー' },
];

export interface ViewerSettings {
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

export type NumKey = 'count' | 'spacing' | 'haze' | 'distance' | 'bloom' | 'work' | 'smoke' | 'grain' | 'flow' | 'extinction' | 'flat' | 'readout';
type BoolKey = 'eye' | 'rolling';

// 数値の範囲。設定の枠のスライダーも、保存した値やURLの値を揃えるのもこれを使う
export const RANGES: Record<NumKey, { min: number; max: number; step: number }> = {
  count: { min: 1, max: 8, step: 1 },
  spacing: { min: 0.5, max: 10, step: 0.5 },
  distance: { min: 2, max: 150, step: 0.5 },
  work: { min: 0, max: 1, step: 0.05 },
  haze: { min: 0.1, max: 5, step: 0.05 },
  smoke: { min: 0, max: 1, step: 0.05 },
  grain: { min: 0.2, max: 2, step: 0.05 },
  flow: { min: 0, max: 3, step: 0.1 },
  extinction: { min: 0, max: 1, step: 0.05 },
  bloom: { min: 0, max: 3, step: 0.05 },
  readout: { min: 1, max: 40, step: 1 },
  flat: { min: 0, max: 1, step: 0.05 },
};

// 選択肢にある値ならそれを返す
const pick = <T extends string>(options: readonly { id: T }[], v: unknown): T | undefined =>
  options.find(o => o.id === v)?.id;

export const VIEWER_KEY = 'laser:viewer';

// 初期値（チャンネルの割り当ては除く）
export const VIEWER_DEFAULTS: Omit<ViewerSettings, 'channels'> = {
  // スマホのGPUは非力なので、初めて開いたときは軽い画質にする
  quality: matchMedia('(pointer: coarse)').matches ? 'low' : 'mid',
  haze: 1, distance: 8, bloom: 1, smoke: 0.6, grain: 0.6, extinction: 0.3, flat: 0, flow: 1, work: 0.3,
  eye: false, rolling: false, readout: 16,
  target: 'wall', count: 1, spacing: 2, layout: 'parallel', place: 'rig', view: 'audience', render: 'vector',
};

// 保存した値やURLの値を、型と範囲に揃えて上書きする。合わない値は使わない
function apply(vs: ViewerSettings, input: Record<string, unknown>) {
  for (const key of Object.keys(RANGES) as NumKey[]) {
    const v = input[key];
    if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) vs[key] = Math.min(RANGES[key].max, Math.max(RANGES[key].min, n));
  }
  vs.quality = pick(QUALITIES, input.quality) ?? vs.quality;
  vs.target = pick(TARGETS, input.target) ?? vs.target;
  vs.layout = pick(LAYOUTS, input.layout) ?? vs.layout;
  vs.place = pick(PLACES, input.place) ?? vs.place;
  vs.view = pick(VIEWS, input.view) ?? vs.view;
  vs.render = pick(RENDER_MODES, input.render) ?? vs.render;
  for (const key of ['eye', 'rolling'] as BoolKey[]) {
    if (typeof input[key] === 'boolean') vs[key] = input[key];
  }
  // 以前はカンマ区切りの文字で持っていた
  const ch = typeof input.channels === 'string' ? input.channels.split(',') : input.channels;
  if (Array.isArray(ch)) vs.channels = ch.map(c => (typeof c === 'string' ? c.trim() : '')).filter(isValidChannel);
}

// 前回の設定 → URLの指定 の順に上書きする
// URLで会場や台の並べ方を指定できる（例: ?target=arena&count=6&layout=mirror&assign=a,a,b,b,c,c&view=foh）
export function loadViewerSettings(params: URLSearchParams, channel: string): ViewerSettings {
  const vs: ViewerSettings = { channels: [channel], ...VIEWER_DEFAULTS };
  const saved = loadLocal<unknown>(VIEWER_KEY);
  if (saved && typeof saved === 'object') apply(vs, saved as Record<string, unknown>);
  // URLでチャンネルを指定して開いたときは、それを使う
  if (params.has('ch')) vs.channels = [channel];
  const q = Object.fromEntries(params);
  // 会場だけを指定したときは、奥行きを会場の大きさにする
  const room = ROOMS[q.target as TargetKind];
  if (room && q.distance === undefined) q.distance = String(room.depth);
  apply(vs, { ...q, channels: q.assign });
  return vs;
}

// 1台ずつのチャンネル。足りない台は、最後に決めた台と同じチャンネルにする
export function assignedChannels(vs: ViewerSettings, fallback: string) {
  const list = vs.channels;
  return Array.from({ length: vs.count }, (_, i) => list[Math.min(i, list.length - 1)] ?? fallback);
}
