import ImageTracer from 'imagetracerjs';
import type { VectorPath } from '../../core/assets';
import { svgToPaths } from './svg';

// 輪郭をなぞるときの画像の大きさ（長辺）。大きいほど細かいが、線が増えてちらつきやすくなる
const SIZE = 400;

// PNG・JPGのロゴなどを、色ごとの輪郭の線にする。背景（四隅の色・透明）はなぞらない
export async function rasterToPaths(file: Blob, colors: number): Promise<VectorPath[]> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, SIZE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const img = g.getImageData(0, 0, w, h);

  // 背景の色は四隅の多数決（透明なら透明が背景）
  const corner = (x: number, y: number) => {
    const i = (y * w + x) * 4, d = img.data;
    return d[i + 3] < 128 ? null : [d[i], d[i + 1], d[i + 2]] as const;
  };
  const corners = [corner(0, 0), corner(w - 1, 0), corner(0, h - 1), corner(w - 1, h - 1)];
  const transparent = corners.filter(c => !c).length >= 2;
  const bg = transparent ? null : corners.find(Boolean)!;

  // 透明な所は背景の色で塗っておく（なぞる対象から外すため）
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) { d[i] = bg?.[0] ?? 0; d[i + 1] = bg?.[1] ?? 0; d[i + 2] = bg?.[2] ?? 0; }
    d[i + 3] = 255;
  }
  const back = bg ?? [0, 0, 0];

  const svg: string = ImageTracer.imagedataToSVG(img, {
    numberofcolors: colors + 1,
    colorquantcycles: 3,
    pathomit: 16,
    ltres: 1,
    qtres: 1,
    blurradius: 0,
    strokewidth: 0,
    linefilter: true,
    viewbox: true,
  });
  // 背景に近い色の領域は捨てる
  const near = (c: readonly number[]) => Math.hypot(c[0] - back[0], c[1] - back[1], c[2] - back[2]) < 60;
  return svgToPaths(svg, near);
}
