import { Data3DTexture, LinearFilter, RedFormat, RepeatWrapping, UnsignedByteType } from 'three';

// スモークの濃さのもとになる3Dノイズ。毎フレーム計算すると重いので、最初に一度だけ作ってテクスチャにする。
// 端がつながるように作ってあるので、繰り返して貼っても継ぎ目が出ない
export function smokeTexture(size = 64): Data3DTexture {
  const data = new Uint8Array(size * size * size);
  const octaves = [
    { cells: 8, amp: 0.5 },
    { cells: 16, amp: 0.25 },
    { cells: 32, amp: 0.125 },
  ];
  const lattices = octaves.map(o => {
    const n = o.cells, v = new Float32Array(n * n * n);
    for (let i = 0; i < v.length; i++) v[i] = hash(i * 7919 + n);
    return { ...o, v };
  });
  const smooth = (f: number) => f * f * (3 - 2 * f);

  let o = 0;
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let sum = 0;
        for (const l of lattices) {
          const n = l.cells, s = n / size;
          const fx = x * s, fy = y * s, fz = z * s;
          const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
          const tx = smooth(fx - x0), ty = smooth(fy - y0), tz = smooth(fz - z0);
          const at = (i: number, j: number, k: number) => l.v[((k % n) * n + (j % n)) * n + (i % n)];
          const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
          const c00 = lerp(at(x0, y0, z0), at(x0 + 1, y0, z0), tx);
          const c10 = lerp(at(x0, y0 + 1, z0), at(x0 + 1, y0 + 1, z0), tx);
          const c01 = lerp(at(x0, y0, z0 + 1), at(x0 + 1, y0, z0 + 1), tx);
          const c11 = lerp(at(x0, y0 + 1, z0 + 1), at(x0 + 1, y0 + 1, z0 + 1), tx);
          sum += l.amp * lerp(lerp(c00, c10, ty), lerp(c01, c11, ty), tz);
        }
        data[o++] = Math.round(Math.min(1, sum / 0.875) * 255);
      }
    }
  }

  const tex = new Data3DTexture(data, size, size, size);
  tex.format = RedFormat;
  tex.type = UnsignedByteType;
  tex.minFilter = tex.magFilter = LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = RepeatWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

function hash(n: number) {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}
