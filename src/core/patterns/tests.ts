import type { Pattern } from './registry';

const TAU = Math.PI * 2;

export const tests: Pattern[] = [
  {
    // ILDAテストパターンの構成を参考にしたもの（データは独自）。
    // 30K・走査角8°相当で出し、円が四角に4点で接するようにスキャナ性能と減衰を合わせる
    id: 'ildatest', name: 'ILDAテスト風', category: 'test',
    hint: 'ILDAテストパターンの構成を参考にした調整用パターン。30kppsで、円が四角に4点で接するようにスキャナ性能と減衰を合わせる',
    draw(f) {
      const s = 0.4;

      // 上: ブランキングの確認用の破線
      for (const y of [0.78, 0.66]) {
        f.poly([-0.35, y, -0.04, y], false, 2);
        f.poly([0.04, y, 0.35, y], false, 2);
      }

      // 四角（角に点を溜める）と、内接する円（少ない点で速く描く）
      f.poly([-s, s, s, s, s, -s, -s, -s], true, 8);
      // ミラーの遅れで描き終わりが欠けるので、1/8周重ねる
      f.curveN((u, p) => { p.x = s * Math.cos(u * TAU * 1.125); p.y = s * Math.sin(u * TAU * 1.125); }, 27);

      // X軸と矢印、中心の十字
      f.poly([-0.85, 0, 0.85, 0], false, 2);
      f.poly([0.78, 0.04, 0.85, 0, 0.78, -0.04], false, 2);
      f.poly([-0.04, 0, 0.04, 0], false, 2);
      f.poly([0, -0.04, 0, 0.04], false, 2);

      // 下: 短い線のはしご
      for (let i = 0; i < 4; i++) {
        const y = -0.5 - i * 0.06;
        f.poly([-0.05, y, 0.05, y], false, 1);
      }

      // 一番下: 溜める回数を変えた点
      [16, 8, 4, 2].forEach((n, i) => {
        f.moveTo(-0.3 + i * 0.2, -0.82);
        f.dwell(n);
      });
    },
  },
  {
    id: 'frame', name: '十字と外枠', category: 'test',
    hint: '描画範囲の端と中心の確認用',
    draw(f) {
      const e = 0.98;
      f.poly([-e, e, e, e, e, -e, -e, -e], true, 3);
      f.poly([-0.1, 0, 0.1, 0], false, 2);
      f.poly([0, -0.1, 0, 0.1], false, 2);
    },
  },
  {
    id: 'grid', name: 'グリッド', category: 'test',
    hint: '歪みの確認用',
    draw(f) {
      const n = 5;
      for (let i = 0; i < n; i++) {
        const v = -0.8 + 1.6 * i / (n - 1);
        f.poly(i % 2 ? [0.8, v, -0.8, v] : [-0.8, v, 0.8, v], false, 2);
      }
      for (let i = 0; i < n; i++) {
        const v = -0.8 + 1.6 * i / (n - 1);
        f.poly(i % 2 ? [v, -0.8, v, 0.8] : [v, 0.8, v, -0.8], false, 2);
      }
    },
  },
  {
    id: 'dot', name: '点', category: 'test',
    hint: '1点に留まったときの見え方',
    draw(f) {
      f.moveTo(0, 0);
      f.dwell(30);
    },
  },
  {
    id: 'steps', name: '明るさの段階', category: 'test',
    hint: '明るさ100%〜20%の5段階',
    draw(f) {
      [1, 0.8, 0.6, 0.4, 0.2].forEach((level, i) => {
        const y = 0.6 - i * 0.3;
        f.level = level;
        f.poly(i % 2 ? [0.6, y, -0.6, y] : [-0.6, y, 0.6, y], false, 2);
      });
    },
  },
];
