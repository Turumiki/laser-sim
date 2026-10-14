import type { FrameBuilder } from '../frame.ts';
import { ASSET_PREFIX, assetName, drawAsset } from '../assets.ts';

export type PatternCategory = 'line' | 'shape' | 'beam' | 'test' | 'asset';

export interface Pattern {
  id: string;
  name: string;
  category: PatternCategory;
  // ツールチップ
  hint?: string;
  // t: アニメーション時間（秒）。時計は見ずに必ずこれを使う。
  // beat: 同じ時間を拍で数えたもの（t × BPM ÷ 60）。曲に合わせて動くパターンはこちらを使う
  draw(f: FrameBuilder, t: number, beat: number): void;
}

const patterns = new Map<string, Pattern>();

export function register(p: Pattern) {
  patterns.set(p.id, p);
}

// 読み込んだ素材は "asset:<id>"。中身は届いてから描く
const assetPatterns = new Map<string, Pattern>();
function assetPatternOf(id: string): Pattern {
  let p = assetPatterns.get(id);
  if (!p) {
    const assetId = id.slice(ASSET_PREFIX.length);
    p = {
      id,
      category: 'asset',
      get name() { return assetName(assetId); },
      draw: (f, t) => drawAsset(f, assetId, t),
    };
    assetPatterns.set(id, p);
  }
  return p;
}

export function getPattern(id: string): Pattern {
  if (id.startsWith(ASSET_PREFIX)) return assetPatternOf(id);
  return patterns.get(id) ?? patterns.values().next().value!;
}

export function listPatterns(): Pattern[] {
  return [...patterns.values()];
}
