import type { Pattern } from './registry';

const tri = (u: number) => 1 - Math.abs(2 * u - 1);

// ヘイズの中で光の筋として見せる前提の演出
export const beams: Pattern[] = [
  {
    // 客席の上に張る水平の光の膜。上下にゆっくり動かし、少し波打たせる
    id: 'liquidsky', name: 'リキッドスカイ', category: 'beam',
    hint: '客席の上に張る水平の光の膜。ヘイズの中で天井のように見える',
    draw(f, t) {
      const base = 0.5 + 0.2 * Math.sin(t * 0.6);
      f.curve((u, p) => {
        const x = -0.95 + 1.9 * tri(u);
        p.x = x;
        p.y = base + 0.04 * Math.sin(x * 5 - t * 2);
      });
    },
  },
  {
    // 何も出さない。ショーの中で暗転やストロボに使う
    id: 'blackout', name: 'ブラックアウト', category: 'beam',
    hint: '何も出さない。暗転やストロボに使う',
    draw(f) {
      f.moveTo(0, 0);
    },
  },
  {
    // 点を多く並べ、開いたり閉じたりさせる
    id: 'multifan', name: 'マルチファン', category: 'beam',
    hint: '13本のビームが開いたり閉じたりする扇',
    draw(f, t) {
      const n = 13;
      const spread = 0.25 + 0.7 * (0.5 + 0.5 * Math.sin(t * 1.3));
      for (let i = 0; i < n; i++) {
        f.moveTo((i / (n - 1) * 2 - 1) * spread, 0);
        f.dwell(6);
      }
    },
  },
  {
    // ビームの束を左右に振る
    id: 'sweep', name: 'スイープ', category: 'beam',
    hint: '5本のビームの束が左右に振れる',
    draw(f, t) {
      const n = 5, center = 0.75 * Math.sin(t * 2.2);
      for (let i = 0; i < n; i++) {
        f.moveTo(center + (i - (n - 1) / 2) * 0.06, 0);
        f.dwell(12);
      }
    },
  },
  {
    // 横に並べた点。ヘイズの中では1点ずつが光源から伸びるビームになり、扇状に見える
    id: 'fan', name: 'ファン', category: 'beam',
    hint: '横に並べた点。ヘイズの中では扇状に広がるビームになる',
    draw(f, t) {
      const n = 7;
      const spread = 0.3 + 0.55 * (0.5 + 0.5 * Math.sin(t * 0.9));
      for (let i = 0; i < n; i++) {
        f.moveTo((i / (n - 1) * 2 - 1) * spread, 0);
        f.dwell(12);
      }
    },
  },
];
