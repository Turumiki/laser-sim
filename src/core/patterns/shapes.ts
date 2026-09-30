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
];
