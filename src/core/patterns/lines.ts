import type { Pattern } from './registry';

// 0→1→0。1本の線を往復でなぞると消灯せずに済む
const tri = (u: number) => 1 - Math.abs(2 * u - 1);

export const lines: Pattern[] = [
  {
    id: 'hline', name: '横線', category: 'line',
    draw(f) {
      f.curve((u, p) => { p.x = -0.95 + 1.9 * tri(u); p.y = 0; });
    },
  },
  {
    id: 'vline', name: '縦線', category: 'line',
    draw(f) {
      f.curve((u, p) => { p.x = 0; p.y = -0.95 + 1.9 * tri(u); });
    },
  },
  {
    id: 'rotline', name: '回転ライン', category: 'line',
    draw(f, t) {
      const c = Math.cos(t * 0.8), s = Math.sin(t * 0.8);
      f.curve((u, p) => {
        const d = -0.95 + 1.9 * tri(u);
        p.x = d * c;
        p.y = d * s;
      });
    },
  },
  {
    id: 'lines', name: '平行ライン', category: 'line',
    draw(f, t) {
      for (let k = 0; k < 4; k++) {
        const y = ((k / 4 + t * 0.15) % 1) * 1.8 - 0.9;
        const dir = k % 2 ? -1 : 1;
        f.curve((u, p) => { p.x = dir * (-0.95 + 1.9 * u); p.y = y; });
      }
    },
  },
];
