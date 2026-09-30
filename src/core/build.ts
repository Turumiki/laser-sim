import { Frame, FrameBuilder } from './frame';
import type { Settings } from './params';
import { getPattern } from './patterns';
import { hexToRgb, hsv } from './color';

const builder = new FrameBuilder();
const rgb: [number, number, number] = [0, 0, 0];

// 設定と時刻から1フレーム分の点列を作る
export function buildFrame(out: Frame, s: Readonly<Settings>, t: number) {
  out.clear();
  builder.reset(out, s.density);
  getPattern(s.pattern).draw(builder, t);
  builder.closeLoop();
  if (out.length === 0) out.push(0, 0, false);

  const n = out.length;
  const ang = (s.angle + s.rotSpeed * t) * Math.PI / 180;
  const c = Math.cos(ang), sn = Math.sin(ang);
  // 位置は画面の正方形の半分を1とした単位なので、サイズで割って点の座標系に直す
  const ox = s.offX / s.size, oy = s.offY / s.size;
  for (let i = 0; i < n; i++) {
    const x = out.x[i], y = out.y[i];
    out.x[i] = x * c - y * sn + ox;
    out.y[i] = x * sn + y * c + oy;
  }

  if (s.colorMode === 'single') hexToRgb(s.color, rgb);
  else if (s.colorMode === 'cycle') hsv((t * 0.2) % 1, rgb);
  for (let i = 0; i < n; i++) {
    if (!out.on[i]) {
      out.r[i] = out.g[i] = out.b[i] = 0;
      continue;
    }
    if (s.colorMode === 'rainbow') hsv((i / n + t * 0.1) % 1, rgb);
    const l = out.l[i] / 255;
    out.r[i] = rgb[0] * l;
    out.g[i] = rgb[1] * l;
    out.b[i] = rgb[2] * l;
  }
}
