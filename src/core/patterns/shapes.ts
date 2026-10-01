import type { Pattern } from './registry';

const TAU = Math.PI * 2;

export const shapes: Pattern[] = [
  {
    id: 'circle', name: '円', category: 'shape',
    draw(f, t) {
      const r = 0.8 + 0.08 * Math.sin(t * 2);
      f.curve((u, p) => {
        p.x = r * Math.cos(u * TAU + t);
        p.y = r * Math.sin(u * TAU + t);
      });
    },
  },
  {
    id: 'star', name: 'スター', category: 'shape',
    draw(f, t) {
      const pts: number[] = [];
      for (let i = 0; i < 10; i++) {
        const a = i * TAU / 10 + t * 0.8, r = i % 2 ? 0.35 : 0.85;
        pts.push(r * Math.sin(a), r * Math.cos(a));
      }
      f.poly(pts, true);
    },
  },
  {
    id: 'lissajous', name: 'リサージュ', category: 'shape',
    draw(f, t) {
      f.curve((u, p) => {
        p.x = 0.85 * Math.sin(3 * u * TAU + t * 0.6);
        p.y = 0.85 * Math.sin(2 * u * TAU);
      });
    },
  },
  {
    id: 'tunnel', name: 'トンネル', category: 'shape',
    draw(f, t) {
      for (let k = 0; k < 6; k++) {
        const s = (k / 6 + t * 0.2) % 1, r = 0.08 + s * 0.9, rot = s * 2 + t * 0.3;
        const pts: number[] = [];
        for (let i = 0; i < 6; i++) pts.push(r * Math.cos(rot + i * TAU / 6), r * Math.sin(rot + i * TAU / 6));
        f.poly(pts, true, 2);
      }
    },
  },
  {
    id: 'wave', name: 'ウェーブ', category: 'shape',
    draw(f, t) {
      f.curve((u, p) => { p.x = -0.95 + 1.9 * u; p.y = 0.35 * Math.sin(u * 3 * TAU - t * 3); });
      f.curve((u, p) => { p.x = 0.95 - 1.9 * u; p.y = 0.35 * Math.sin((1 - u) * 3 * TAU - t * 3 + Math.PI); });
    },
  },
  {
    id: 'cube', name: 'キューブ', category: 'shape',
    draw(f, t) {
      const s = 0.6, ay = t * 0.7, ax = t * 0.45;
      const v = [[-s, -s, -s], [s, -s, -s], [s, -s, s], [-s, -s, s], [-s, s, -s], [s, s, -s], [s, s, s], [-s, s, s]].map(([x, y, z]) => {
        const X = x * Math.cos(ay) + z * Math.sin(ay);
        let Z = -x * Math.sin(ay) + z * Math.cos(ay);
        const Y = y * Math.cos(ax) - Z * Math.sin(ax);
        Z = y * Math.sin(ax) + Z * Math.cos(ax);
        const k = 2.4 / (Z + 3);
        return [X * k, Y * k];
      });
      const face = (a: number, b: number, c: number, d: number) => [...v[a], ...v[b], ...v[c], ...v[d]];
      f.poly(face(0, 1, 2, 3), true);
      f.poly(face(4, 5, 6, 7), true);
      for (let i = 0; i < 4; i++) f.poly([...v[i], ...v[i + 4]], false);
    },
  },
  {
    id: 'dots', name: 'ドット', category: 'shape',
    draw(f, t) {
      for (let i = 0; i < 8; i++) {
        const a = i * TAU / 8 + t * 0.8, r = 0.7 + 0.1 * Math.sin(t * 3 + i);
        f.moveTo(r * Math.cos(a), r * Math.sin(a));
        f.dwell(20);
      }
    },
  },
  {
    id: 'spiro', name: 'スピログラフ', category: 'shape',
    draw(f, t) {
      const R = 5, r = 3, d = 3 + 1.5 * Math.sin(t * 0.5), k = 0.85 / (R - r + d), rot = t * 0.3;
      const c = Math.cos(rot), sn = Math.sin(rot);
      f.curve((u, p) => {
        const a = u * 3 * TAU;
        const x = (R - r) * Math.cos(a) + d * Math.cos((R - r) / r * a);
        const y = (R - r) * Math.sin(a) - d * Math.sin((R - r) / r * a);
        p.x = k * (x * c - y * sn);
        p.y = k * (x * sn + y * c);
      });
    },
  },
  {
    // 拍の頭で「どくん」と2回脈打つハート
    id: 'heart', name: 'ハート', category: 'shape',
    hint: '拍に合わせて脈打つハート',
    draw(f, _t, beat) {
      const p0 = beat % 1, pulse = Math.exp(-14 * p0) + 0.6 * Math.exp(-14 * Math.abs(p0 - 0.22));
      const k = (0.8 + 0.08 * pulse) / 17;
      f.curve((u, p) => {
        const a = u * TAU, sn = Math.sin(a);
        p.x = k * 16 * sn * sn * sn;
        p.y = k * (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) + 0.08;
      });
    },
  },
  {
    // 中心から外へ3周の渦巻き。8拍で1回転
    id: 'spiral', name: 'スパイラル', category: 'shape',
    hint: '中心から外へ広がる渦巻き。回すと吸い込まれるように見える',
    draw(f, _t, beat) {
      const rot = Math.PI * beat / 4;
      f.curve((u, p) => {
        const r = 0.04 + 0.86 * u, a = u * 3 * TAU + rot;
        p.x = r * Math.cos(a);
        p.y = r * Math.sin(a);
      });
    },
  },
  {
    // 1拍ごとに 4, 3, 2, 1 と数える（カウントイン）。BPMを60にすれば1秒ごとのカウントダウン
    id: 'count', name: 'カウント', category: 'shape',
    hint: '1拍ごとに 4・3・2・1 と数字を出す。BPMを60にすると1秒ごとのカウントダウン',
    draw(f, _t, beat) {
      const n = 4 - (Math.floor(beat) % 4);
      // 数字の線（幅1・高さ1.6の枠の中）を、真ん中に大きく描く
      const k = 0.7, ox = -0.5 * k, oy = -0.8 * k;
      for (const line of DIGITS[n]) f.poly(line.flatMap((v, i) => [i % 2 ? oy + v * k : ox + v * k]), false);
    },
  },
];

// 数字の形（幅1・高さ1.6の枠の中の折れ線）。カウントで使う 1〜4
const DIGITS: Record<number, number[][]> = {
  1: [[0.25, 1.3, 0.55, 1.6, 0.55, 0]],
  2: [[0, 1.25, 0.2, 1.55, 0.5, 1.6, 0.8, 1.55, 1, 1.3, 0.95, 1.0, 0, 0, 1, 0]],
  3: [[0.05, 1.6, 1, 1.6, 0.45, 0.95, 0.8, 0.88, 1, 0.55, 0.85, 0.12, 0.5, 0, 0.15, 0.08, 0, 0.3]],
  4: [[0.75, 0, 0.75, 1.6, 0, 0.45, 1, 0.45]],
};
