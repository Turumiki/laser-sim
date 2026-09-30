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
