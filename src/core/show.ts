import type { Settings } from './params';

// ショー＝キュー（ステップ）を順に並べたもの。長さは拍数で持ち、BPMで秒にする
export interface Step {
  beats: number;
  // この間に使う絵柄の設定（パターン、色、位置、回転など）
  values: Partial<Settings>;
}

export interface Show {
  id: string;
  name: string;
  bpm: number;
  loop: boolean;
  steps: Step[];
}

export function showLength(show: Show) {
  const beat = 60 / show.bpm;
  return show.steps.reduce((sum, s) => sum + s.beats * beat, 0);
}

// 再生開始から t 秒のときに、どのステップの中にいるか。ループしないショーの終わり以降は null
export function locate(show: Show, t: number): { index: number; start: number } | null {
  const total = showLength(show);
  if (!show.steps.length || total <= 0) return null;
  if (show.loop) t %= total;
  else if (t >= total) return null;
  const beat = 60 / show.bpm;
  let start = 0;
  for (let i = 0; i < show.steps.length; i++) {
    const len = show.steps[i].beats * beat;
    if (t < start + len) return { index: i, start };
    start += len;
  }
  return { index: show.steps.length - 1, start: start - show.steps[show.steps.length - 1].beats * beat };
}

// ステップに入れる項目。レーザー機や見え方の設定は入れず、ショーを流しながら比べられるようにする
export const STEP_KEYS: readonly (keyof Settings)[] = [
  'pattern', 'colorMode', 'color', 'density', 'offX', 'offY', 'size', 'angle', 'rotSpeed', 'animSpeed',
];

export function stepFrom(s: Readonly<Settings>, beats: number): Step {
  const values: Record<string, unknown> = {};
  for (const k of STEP_KEYS) values[k as string] = s[k];
  return { beats, values: values as Partial<Settings> };
}
