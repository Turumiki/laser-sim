import type { VectorPath } from '../../core/assets';
import { finishPaths } from './paths';

const SHAPES = 'path, rect, circle, ellipse, line, polyline, polygon';

// 色の文字（#abc、rgb()、名前など）を [r, g, b] に。読めなければ null
const ctx = document.createElement('canvas').getContext('2d')!;
function parseColor(v: string | null): [number, number, number] | null {
  if (!v || v === 'none' || v === 'transparent' || v.startsWith('url(')) return null;
  ctx.fillStyle = '#000';
  ctx.fillStyle = v;
  const m = /^#([0-9a-f]{6})$/i.exec(ctx.fillStyle) ?? null;
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const r = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(ctx.fillStyle);
  if (!r || (r[4] !== undefined && Number(r[4]) === 0)) return null;
  return [Number(r[1]), Number(r[2]), Number(r[3])];
}

// 黒はレーザーでは見えないので、白に置き換える（黒い線のロゴを読んだとき用）
const visible = (c: [number, number, number]): [number, number, number] =>
  Math.max(...c) < 40 ? [255, 255, 255] : c;

// SVGの図形を、長さに沿って細かく点を取った線にする。
// skip を返す色（背景など）の図形は使わない
export function svgToPaths(text: string, skip: (rgb: [number, number, number]) => boolean = () => false): VectorPath[] {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const src = doc.querySelector('svg');
  if (!src) throw new Error('SVGとして読めませんでした');
  // 長さや変形を測るために、見えない所に一度置く
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
  const svg = document.importNode(src, true) as SVGSVGElement;
  host.append(svg);
  document.body.append(host);
  try {
    const root = svg.getScreenCTM();
    const shapes = [...svg.querySelectorAll<SVGGeometryElement>(SHAPES)];
    // 全体の大きさから、点を取る間隔を決める（長辺の1/600くらい）
    const box = svg.getBBox();
    const step = Math.max(box.width, box.height, 1) / 600;
    const out: VectorPath[] = [];
    for (const el of shapes) {
      if (el.closest('defs, clipPath, mask, symbol')) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
      const rgb = parseColor(style.stroke) ?? parseColor(style.fill);
      if (!rgb || skip(rgb)) continue;
      let len = 0;
      try { len = el.getTotalLength(); } catch { continue; }
      if (!(len > 0)) continue;
      const m = el.getScreenCTM();
      const toRoot = root && m ? root.inverse().multiply(m) : null;
      const n = Math.min(20000, Math.max(8, Math.ceil(len / step)));
      // 途中で大きく飛んだ所（サブパスの切れ目）で線を分ける
      let cur: number[] = [];
      let px = NaN, py = NaN;
      const flush = () => {
        if (cur.length >= 4) {
          const closed = Math.hypot(cur[0] - cur[cur.length - 2], cur[1] - cur[cur.length - 1]) < step * 1.5;
          out.push({ pts: closed ? cur.slice(0, -2) : cur, rgb: visible(rgb), closed });
        }
        cur = [];
      };
      for (let i = 0; i <= n; i++) {
        let p = el.getPointAtLength(len * i / n);
        if (toRoot) p = p.matrixTransform(toRoot);
        if (cur.length && Math.hypot(p.x - px, p.y - py) > step * 4) flush();
        cur.push(p.x, p.y);
        px = p.x;
        py = p.y;
      }
      flush();
    }
    return finishPaths(out);
  } finally {
    host.remove();
  }
}
