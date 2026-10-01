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
  {
    // 並んだビームが1本ずつ順番に点く（照明のチェイスと同じ）。行って戻る
    id: 'chase', name: 'ビームチェイス', category: 'beam',
    hint: '横に並んだ9本のビームが、1本ずつ順番に高速で点いていく',
    draw(f, t) {
      const n = 9, step = Math.floor(t * 18), k = step % (2 * n - 2);
      const i = k < n ? k : 2 * n - 2 - k;
      f.moveTo((i / (n - 1) * 2 - 1) * 0.8, 0);
      f.dwell(40);
    },
  },
  {
    // たくさんの置き場所から、毎回ばらばらに数本だけ光らせる。時間から決めるので、書き出しても毎回同じ並び
    id: 'sparkle', name: 'スパークル', category: 'beam',
    hint: '客席の上に散らばった点のうち、ランダムに選んだ数本だけが一瞬ずつ光る',
    draw(f, t) {
      const slots = 48, lit = 5, step = Math.floor(t * 15);
      for (let j = 0; j < lit; j++) {
        const s = Math.floor(rand(step * 7.13 + j * 1.71) * slots);
        // 横に広く、縦は少しだけ散らす
        f.moveTo((rand(s * 3.1) * 2 - 1) * 0.9, (rand(s * 5.7 + 1) * 2 - 1) * 0.25);
        f.dwell(10);
      }
    },
  },
];

// 0〜1 の擬似乱数（同じ値からは同じ結果）
function rand(x: number) {
  const v = Math.sin(x * 12.9898 + 78.233) * 43758.5453;
  return v - Math.floor(v);
}
