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
    // 速いテンポで短く切り替え、ストロボと色の変化で盛り上げる
    id: 'festival', name: 'フェス', bpm: 150, loop: true,
    steps: [
      // 暗転からの1本 → 開く
      cue(2, { pattern: 'blackout' }),
      cue(2, { pattern: 'dot', color: WHITE, offY: 0.3 }),
      cue(2, { pattern: 'fan', color: CYAN, offY: 0.3 }),
      cue(2, { pattern: 'multifan', color: MAGENTA, offY: 0.3, animSpeed: 2 }),
      cue(4, { pattern: 'sweep', color: GREEN, offY: 0.3, animSpeed: 2 }),
      // ストロボ
      cue(1, { pattern: 'fan', color: RED, offY: 0.3 }),
      cue(1, { pattern: 'blackout' }),
      cue(1, { pattern: 'fan', color: BLUE, offY: 0.3 }),
      cue(1, { pattern: 'blackout' }),
      cue(1, { pattern: 'fan', color: WHITE, offY: 0.3 }),
      cue(1, { pattern: 'blackout' }),
      cue(1, { pattern: 'multifan', colorMode: 'rainbow', offY: 0.3 }),
      cue(1, { pattern: 'blackout' }),
      // 空間を埋める
      cue(8, { pattern: 'liquidsky', color: CYAN, animSpeed: 2 }),
      cue(4, { pattern: 'tunnel', colorMode: 'rainbow', animSpeed: 3 }),
      cue(4, { pattern: 'circle', colorMode: 'cycle', size: 0.4, offY: 0.3, animSpeed: 3 }),
      cue(2, { pattern: 'rotline', color: MAGENTA, offY: 0.3, animSpeed: 3 }),
      cue(2, { pattern: 'vline', color: CYAN, offY: 0.3, rotSpeed: -180 }),
      cue(2, { pattern: 'rotline', color: RED, offY: 0.3, rotSpeed: -270 }),
      cue(2, { pattern: 'hline', color: GREEN, offY: 0.3, rotSpeed: 240 }),
      cue(8, { pattern: 'spiro', colorMode: 'rainbow', animSpeed: 3, rotSpeed: 90 }),
      cue(4, { pattern: 'lines', colorMode: 'cycle', animSpeed: 4 }),
      cue(4, { pattern: 'star', colorMode: 'rainbow', rotSpeed: 360, size: 1 }),
      // ストロボ（点）
      cue(1, { pattern: 'dots', color: WHITE, offY: 0.3, animSpeed: 3 }),
      cue(1, { pattern: 'blackout' }),
      cue(1, { pattern: 'dots', color: WHITE, offY: 0.3, animSpeed: 3 }),
      cue(1, { pattern: 'blackout' }),
      // 締め
      cue(8, { pattern: 'liquidsky', colorMode: 'rainbow', animSpeed: 3 }),
      cue(8, { pattern: 'multifan', colorMode: 'rainbow', offY: 0.3, animSpeed: 3 }),
      cue(4, { pattern: 'sweep', colorMode: 'cycle', offY: 0.3, animSpeed: 4 }),
      cue(4, { pattern: 'blackout' }),
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
  {
    // 曲のビートに合わせて動くパターンだけで組んだショー。どのステップもアニメ速度は1（拍がずれないように）
    id: 'beat', name: 'ビート', bpm: 140, loop: true,
    steps: [
      // カウントイン → 円錐で始めて、ウェーブとチェイスで温める
      cue(4, { pattern: 'count', color: WHITE }),
      cue(8, { pattern: 'cone', color: CYAN, offY: 0.3 }),
      cue(8, { pattern: 'beamwave', color: GREEN, offY: 0.3 }),
      cue(4, { pattern: 'chase', color: MAGENTA, offY: 0.3 }),
      cue(4, { pattern: 'chase', color: CYAN, offY: 0.3, angle: 180 }),
      // 交差する膜から、ストロボで一度落とす
      cue(8, { pattern: 'cross', color: BLUE, offY: 0.2 }),
      cue(4, { pattern: 'strobe', color: WHITE, offY: 0.35 }),
      cue(4, { pattern: 'sparkle', colorMode: 'rainbow', offY: 0.3 }),
      // 図形
      cue(8, { pattern: 'heart', color: RED, size: 0.6 }),
      cue(8, { pattern: 'spiral', colorMode: 'rainbow', size: 0.7 }),
      // 盛り上げて、暗転で次の周へ
      cue(4, { pattern: 'cone', color: MAGENTA, offY: 0.3, size: 1.1 }),
      cue(8, { pattern: 'beamwave', colorMode: 'rainbow', offY: 0.3 }),
      cue(4, { pattern: 'strobe', colorMode: 'cycle', offY: 0.35 }),
      cue(2, { pattern: 'blackout' }),
    ],
  },
];
