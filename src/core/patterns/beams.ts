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
