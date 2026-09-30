import type { FrameBuilder } from '../frame';

export type PatternCategory = 'line' | 'shape' | 'beam' | 'test';

export interface Pattern {
  id: string;
  name: string;
  category: PatternCategory;
  // ツールチップ
  hint?: string;
  // t: アニメーション時間（秒）。時計は見ずに必ずこれを使う
  draw(f: FrameBuilder, t: number): void;
}

const patterns = new Map<string, Pattern>();

export function register(p: Pattern) {
  patterns.set(p.id, p);
}

export function getPattern(id: string): Pattern {
  return patterns.get(id) ?? patterns.values().next().value!;
}

export function listPatterns(): Pattern[] {
  return [...patterns.values()];
}
