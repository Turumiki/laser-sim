import type { AssetData, IldaFrame } from '../../core/assets';

// ILDAの標準パレット（色番号で色を指定する形式 0・1 で、パレットが入っていないときに使う）
const DEFAULT_PALETTE = [
  [255, 0, 0], [255, 16, 0], [255, 32, 0], [255, 48, 0], [255, 64, 0], [255, 80, 0], [255, 96, 0], [255, 112, 0],
  [255, 128, 0], [255, 144, 0], [255, 160, 0], [255, 176, 0], [255, 192, 0], [255, 208, 0], [255, 224, 0], [255, 240, 0],
  [255, 255, 0], [224, 255, 0], [192, 255, 0], [160, 255, 0], [128, 255, 0], [96, 255, 0], [64, 255, 0], [32, 255, 0],
  [0, 255, 0], [0, 255, 36], [0, 255, 73], [0, 255, 109], [0, 255, 146], [0, 255, 182], [0, 255, 219], [0, 255, 255],
  [0, 227, 255], [0, 198, 255], [0, 170, 255], [0, 142, 255], [0, 113, 255], [0, 85, 255], [0, 56, 255], [0, 28, 255],
  [0, 0, 255], [32, 0, 255], [64, 0, 255], [96, 0, 255], [128, 0, 255], [160, 0, 255], [192, 0, 255], [224, 0, 255],
  [255, 0, 255], [255, 32, 255], [255, 64, 255], [255, 96, 255], [255, 128, 255], [255, 160, 255], [255, 192, 255], [255, 224, 255],
  [255, 255, 255], [255, 224, 224], [255, 192, 192], [255, 160, 160], [255, 128, 128], [255, 96, 96], [255, 64, 64], [255, 32, 32],
];

// 1点あたりのバイト数（形式ごと）
const RECORD: Record<number, number> = { 0: 8, 1: 6, 2: 3, 4: 10, 5: 8 };

const pack = (r: number, g: number, b: number) => (r << 16) | (g << 8) | b;

// .ild を読む。形式 0・1・4・5（点）と 2（パレット）に対応。コマの速さはファイルに無いので fps で決める
export function parseIlda(buf: ArrayBuffer, fps = 30): AssetData {
  const v = new DataView(buf);
  let o = 0;
  let palette = DEFAULT_PALETTE.map(c => pack(c[0], c[1], c[2]));
  const frames: IldaFrame[] = [];
  while (o + 32 <= v.byteLength) {
    if (String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3)) !== 'ILDA') {
      throw new Error('ILDAファイルとして読めませんでした');
    }
    const format = v.getUint8(o + 7);
    const count = v.getUint16(o + 24);
    o += 32;
    // 点の数が 0 の見出しがファイルの終わり
    if (count === 0) break;
    const size = RECORD[format];
    if (!size) throw new Error(`この形式（${format}）には対応していません`);
    if (o + count * size > v.byteLength) throw new Error('ファイルが途中で切れています');
    if (format === 2) {
      palette = [];
      for (let i = 0; i < count; i++, o += 3) palette.push(pack(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2)));
      continue;
    }
    const three = format === 0 || format === 4;
    const f: IldaFrame = { x: [], y: [], c: [] };
    for (let i = 0; i < count; i++, o += size) {
      const x = v.getInt16(o) / 32768, y = v.getInt16(o + 2) / 32768;
      const p = o + (three ? 6 : 4);
      const status = v.getUint8(p);
      let c: number;
      if (status & 0x40) c = -1;
      else if (format === 0 || format === 1) c = palette[v.getUint8(p + 1)] ?? 0xffffff;
      // 形式 4・5 は青・緑・赤の順
      else c = pack(v.getUint8(p + 3), v.getUint8(p + 2), v.getUint8(p + 1));
      // 真っ黒は消灯と同じ
      if (c === 0) c = -1;
      f.x.push(Math.round(x * 10000) / 10000);
      f.y.push(Math.round(y * 10000) / 10000);
      f.c.push(c);
    }
    frames.push(f);
  }
  if (!frames.length) throw new Error('コマが入っていません');
  return { kind: 'ilda', fps, frames };
}
