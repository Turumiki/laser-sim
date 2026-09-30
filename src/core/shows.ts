import type { Settings } from './params';
import type { Show } from './show';

const GREEN = '#00ff40', CYAN = '#00e5ff', BLUE = '#2060ff', MAGENTA = '#ff20c0', RED = '#ff2020', WHITE = '#ffffff';

// 位置や回転は、書いていなければ中央・静止に戻す
const base: Partial<Settings> = {
  colorMode: 'single', color: GREEN, offX: 0, offY: 0, size: 0.85, angle: 0, rotSpeed: 0, animSpeed: 1,
};
const cue = (beats: number, values: Partial<Settings>) => ({ beats, values: { ...base, ...values } });

// 組み込みのショー。実際のレーザーショーでよくある流れを参考にしたもの
export const BUILTIN_SHOWS: readonly Show[] = [
  {
    id: 'opening', name: 'オープニング', bpm: 128, loop: true,
    steps: [
      // 静かに1本ずつ → 広げる → 空間を埋める → 図形 → 盛り上げ
      cue(8, { pattern: 'dot', color: WHITE, offY: 0.3 }),
      cue(8, { pattern: 'fan', color: CYAN, animSpeed: 0.5, offY: 0.3 }),
      cue(16, { pattern: 'liquidsky', color: CYAN, offY: 0.1 }),
      cue(8, { pattern: 'rotline', color: BLUE, offY: 0.3, animSpeed: 1.5 }),
      cue(8, { pattern: 'circle', color: GREEN, size: 0.5, offY: 0.3 }),
      cue(8, { pattern: 'tunnel', color: GREEN, size: 0.7, animSpeed: 1.5 }),
      cue(8, { pattern: 'star', color: MAGENTA, rotSpeed: 90 }),
      cue(16, { pattern: 'spiro', colorMode: 'rainbow', animSpeed: 1.5 }),
      cue(8, { pattern: 'fan', color: RED, animSpeed: 2, offY: 0.3 }),
      cue(8, { pattern: 'lines', colorMode: 'cycle', animSpeed: 2 }),
    ],
  },
  {
    id: 'beams', name: 'ビーム中心', bpm: 128, loop: true,
    steps: [
      cue(8, { pattern: 'fan', color: GREEN, offY: 0.35 }),
      cue(8, { pattern: 'fan', color: CYAN, offY: 0.35, angle: 15, animSpeed: 2 }),
      cue(16, { pattern: 'liquidsky', color: GREEN }),
      cue(8, { pattern: 'hline', color: BLUE, offY: 0.35, rotSpeed: 45 }),
      cue(8, { pattern: 'dots', color: MAGENTA, size: 0.6, offY: 0.3, animSpeed: 1.5 }),
      cue(8, { pattern: 'vline', color: CYAN, rotSpeed: -60, offY: 0.3 }),
      cue(8, { pattern: 'circle', color: GREEN, size: 0.3, offY: 0.35 }),
    ],
  },
  {
    id: 'graphics', name: 'グラフィック中心', bpm: 120, loop: true,
    steps: [
      cue(8, { pattern: 'circle', color: GREEN }),
      cue(8, { pattern: 'star', color: CYAN, rotSpeed: 45 }),
      cue(8, { pattern: 'cube', color: MAGENTA }),
      cue(8, { pattern: 'lissajous', colorMode: 'rainbow' }),
      cue(8, { pattern: 'wave', color: BLUE }),
      cue(8, { pattern: 'spiro', colorMode: 'rainbow' }),
    ],
  },
];
