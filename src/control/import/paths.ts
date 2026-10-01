import type { VectorPath } from '../../core/assets';

// 画像の座標（下向きが +y）の線を、レーザーの座標（-1..1、上が +y）に収める。縦横比は保つ
export function fitPaths(paths: VectorPath[], margin = 0.95): VectorPath[] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of paths) {
    for (let i = 0; i < p.pts.length; i += 2) {
      x0 = Math.min(x0, p.pts[i]); x1 = Math.max(x1, p.pts[i]);
      y0 = Math.min(y0, p.pts[i + 1]); y1 = Math.max(y1, p.pts[i + 1]);
    }
  }
  if (!Number.isFinite(x0)) return [];
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const k = 2 * margin / Math.max(x1 - x0, y1 - y0, 1e-9);
  return paths.map(p => ({
    ...p,
    pts: p.pts.map((v, i) => (i % 2 ? -(v - cy) * k : (v - cx) * k)),
  }));
}

// 細かすぎる点を間引く（Douglas-Peucker）。tol はレーザーの座標で
export function simplify(pts: number[], tol: number): number[] {
  const n = pts.length / 2;
  if (n <= 2) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = pts[a * 2], ay = pts[a * 2 + 1], bx = pts[b * 2], by = pts[b * 2 + 1];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    let best = -1, far = tol;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i * 2] - ax, py = pts[i * 2 + 1] - ay;
      const d = len > 1e-12 ? Math.abs(px * dy - py * dx) / len : Math.hypot(px, py);
      if (d > far) { far = d; best = i; }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1]);
  return out;
}

// 消灯して移動する距離が短くなるように、描く順番と向きを決める（近いものから順に）
export function orderPaths(paths: VectorPath[]): VectorPath[] {
  const left = paths.slice(), out: VectorPath[] = [];
  let cx = -1, cy = 1;
  while (left.length) {
    let best = 0, bestD = Infinity, flip = false, start = 0;
    left.forEach((p, k) => {
      const n = p.pts.length / 2;
      if (p.closed) {
        // 閉じた線は、どの点から描き始めてもよい
        for (let i = 0; i < n; i++) {
          const d = Math.hypot(p.pts[i * 2] - cx, p.pts[i * 2 + 1] - cy);
          if (d < bestD) { bestD = d; best = k; flip = false; start = i; }
        }
      } else {
        const d0 = Math.hypot(p.pts[0] - cx, p.pts[1] - cy);
        const d1 = Math.hypot(p.pts[(n - 1) * 2] - cx, p.pts[(n - 1) * 2 + 1] - cy);
        if (d0 < bestD) { bestD = d0; best = k; flip = false; start = 0; }
        if (d1 < bestD) { bestD = d1; best = k; flip = true; start = 0; }
      }
    });
    const p = left.splice(best, 1)[0];
    let pts = p.pts;
    if (p.closed && start) pts = [...pts.slice(start * 2), ...pts.slice(0, start * 2)];
    if (flip) {
      const r: number[] = [];
      for (let i = pts.length - 2; i >= 0; i -= 2) r.push(pts[i], pts[i + 1]);
      pts = r;
    }
    out.push({ ...p, pts });
    const end = p.closed ? 0 : pts.length - 2;
    cx = pts[end];
    cy = pts[end + 1];
  }
  return out;
}

// 読み込んだ線を、レーザーで描ける形にまとめる
export function finishPaths(paths: VectorPath[]): VectorPath[] {
  const fitted = fitPaths(paths)
    .map(p => ({ ...p, pts: simplify(p.pts, 0.003) }))
    .filter(p => p.pts.length >= 2);
  return orderPaths(fitted).map(p => ({ ...p, pts: p.pts.map(v => Math.round(v * 10000) / 10000) }));
}
