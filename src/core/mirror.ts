// 実機のミラーはこれ以上振れない。90°に近づくと tan が発散・反転するので、その手前で止める
export const MAX_MIRROR = 85 * Math.PI / 180;
export const clampMirror = (a: number) => Math.max(-MAX_MIRROR, Math.min(MAX_MIRROR, a));

// 2枚のミラーで振ったとき、平面に映る位置。x, y は正方形の半分を1とした単位、half は最大走査角の半分（rad）。
// X用ミラーの後にY用ミラーがあるので、Yを振るほどXの振れ幅が広がる（糸巻き型）
export function pincushion(x: number, y: number, half: number, out: { x: number; y: number }) {
  const ay = clampMirror(y * half), t = Math.tan(half);
  out.x = Math.tan(clampMirror(x * half)) / Math.cos(ay) / t;
  out.y = Math.tan(ay) / t;
  return out;
}
