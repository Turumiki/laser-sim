import { type Frame, FrameBuilder } from './frame.ts';
import type { Settings } from './params.ts';
import { getPattern } from './patterns/index.ts';
import { hexToRgb, hsv } from './color.ts';
import { DEG_PER_SEC_PER_KPPS } from './scanner.ts';

const builder = new FrameBuilder();
const rgb: [number, number, number] = [0, 0, 0];

// 設定と時刻から1フレーム分の点列を作る
export function buildFrame(out: Frame, s: Readonly<Settings>, t: number) {
  out.clear();
  // 消灯中の移動は、ミラーが振れる速さの上限（1点あたり、点の座標で）の85%で刻む。
  // ミラーが落ち着くまでの待ちは、30Kのスキャナを30kppsで使うときを基準に、遅いスキャナや高いppsほど長くする
  const vmax = DEG_PER_SEC_PER_KPPS * s.scannerK / (s.scanAngle / 2 * s.size) / s.pps;
  const travel = Math.min(0.2, Math.max(0.004, vmax * 0.85));
  const settle = Math.min(6, Math.max(0.5, (30 / s.scannerK) * (s.pps / 30000)));
  builder.reset(out, s.density, travel, settle);
  getPattern(s.pattern).draw(builder, t, t * s.bpm / 60);
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
  const source = s.colorMode === 'source';
  if (source) hexToRgb(s.color, rgb);
  for (let i = 0; i < n; i++) {
    if (!out.on[i]) {
      out.r[i] = out.g[i] = out.b[i] = 0;
      continue;
    }
    // 素材の色。色を持たない点（素材以外のパターン）は単色の色で描く
    if (source && out.own[i]) {
      const l = out.l[i] / 255;
      out.r[i] *= l;
      out.g[i] *= l;
      out.b[i] *= l;
      continue;
    }
    if (s.colorMode === 'rainbow') hsv((i / n + t * 0.1) % 1, rgb);
    const l = out.l[i] / 255;
    out.r[i] = rgb[0] * l;
    out.g[i] = rgb[1] * l;
    out.b[i] = rgb[2] * l;
  }
}
