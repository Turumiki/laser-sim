type Rgb = [number, number, number];

export function hsv(h: number, out: Rgb): Rgb {
  const i = Math.floor(h * 6), f = h * 6 - i, q = 1 - f;
  let r = 0, g = 0, b = 0;
  switch (((i % 6) + 6) % 6) {
    case 0: r = 1; g = f; break;
    case 1: r = q; g = 1; break;
    case 2: g = 1; b = f; break;
    case 3: g = q; b = 1; break;
    case 4: r = f; b = 1; break;
    case 5: r = 1; b = q; break;
  }
  out[0] = r * 255 | 0;
  out[1] = g * 255 | 0;
  out[2] = b * 255 | 0;
  return out;
}

export function hexToRgb(hex: string, out: Rgb): Rgb {
  const n = parseInt(hex.slice(1), 16);
  out[0] = n >> 16 & 255;
  out[1] = n >> 8 & 255;
  out[2] = n & 255;
  return out;
}

// 色ごとの見かけの明るさ（緑を1とする）。一般的なRGB機の出力と、目の感度（比視感度）から出した値
// 赤 638nm 0.8W × 0.18、緑 520nm 0.8W × 0.71、青 450nm 1.4W × 0.038
export const EYE_GAIN: readonly [number, number, number] = [0.25, 1, 0.09];

// 2枚のミラーで振ったとき、平面に映る位置。x, y は正方形の半分を1とした単位、half は最大走査角の半分（rad）。
// X用ミラーの後にY用ミラーがあるので、Yを振るほどXの振れ幅が広がる（糸巻き型）
// 実機のミラーはこれ以上振れない。90°に近づくと tan が発散・反転するので、その手前で止める
export const MAX_MIRROR = 85 * Math.PI / 180;
const clampAngle = (a: number) => Math.max(-MAX_MIRROR, Math.min(MAX_MIRROR, a));

export function pincushion(x: number, y: number, half: number, out: { x: number; y: number }) {
  const ay = clampAngle(y * half), t = Math.tan(half);
  out.x = Math.tan(clampAngle(x * half)) / Math.cos(ay) / t;
  out.y = Math.tan(ay) / t;
  return out;
}
