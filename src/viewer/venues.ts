// 会場の形を、平らな凸多角形の組み合わせで作る。見た目と当たり判定に同じものを使う。
// 座標: プロジェクターが原点で -z（客席）を向く。+y が上、+z がステージの奥
export type Material = 'room' | 'stand' | 'stage' | 'screen' | 'gear';

export interface Poly {
  // 同じ平面上の凸多角形（周回順）
  pts: number[][];
  mat: Material;
  // 表を向ける側にある点（裏からは描かない）
  toward: number[];
}

type V2 = [number, number];

// 床の縁（x, z の折れ線）を外側へ d だけずらす。角は斜めの線どうしの交点で合わせる
function offset(line: V2[], d: number, out: V2): V2[] {
  const n = line.length;
  const normals = line.slice(0, -1).map((p, i) => {
    const q = line[i + 1], dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz);
    let nx = dz / len, nz = -dx / len;
    // 外側（out の向き）を向く法線にそろえる
    const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
    if (nx * (mx - out[0]) + nz * (mz - out[1]) < 0) { nx = -nx; nz = -nz; }
    return [nx, nz] as V2;
  });
  return line.map((p, i) => {
    // 前後の線の法線の間の向きへ、どちらの線からも d 離れる所まで進める（端は1本の法線だけ）
    const a = normals[Math.max(0, i - 1)], b = normals[Math.min(n - 2, i)];
    let bx = a[0] + b[0], bz = a[1] + b[1];
    const bl = Math.hypot(bx, bz);
    bx /= bl; bz /= bl;
    const k = d / Math.max(0.2, bx * a[0] + bz * a[1]);
    return [p[0] + bx * k, p[1] + bz * k] as V2;
  });
}

// 2本の折れ線（内側 a・高さ ya、外側 b・高さ yb）の間を帯でつなぐ
function band(a: V2[], ya: number, b: V2[], yb: number, mat: Material, toward: number[]): Poly[] {
  const out: Poly[] = [];
  for (let i = 0; i < a.length - 1; i++) {
    out.push({
      pts: [[a[i][0], ya, a[i][1]], [a[i + 1][0], ya, a[i + 1][1]], [b[i + 1][0], yb, b[i + 1][1]], [b[i][0], yb, b[i][1]]],
      mat, toward,
    });
  }
  return out;
}

// 軸に沿った箱の、見える面（底は除く）。表は外向き
// f は客席側（-z）、b はステージの奥側（+z）の面。z0 と z1 はどちらが大きくてもよい
function box(x0: number, x1: number, y0: number, y1: number, za: number, zb: number, mat: Material, faces = 'tfblr'): Poly[] {
  const z0 = Math.max(za, zb), z1 = Math.min(za, zb);
  const c = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
  const away = (n: number[]) => [c[0] + n[0] * 1e4, c[1] + n[1] * 1e4, c[2] + n[2] * 1e4];
  const out: Poly[] = [];
  if (faces.includes('t')) out.push({ pts: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], mat, toward: away([0, 1, 0]) });
  if (faces.includes('f')) out.push({ pts: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], mat, toward: away([0, 0, -1]) });
  if (faces.includes('b')) out.push({ pts: [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], mat, toward: away([0, 0, 1]) });
  if (faces.includes('l')) out.push({ pts: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], mat, toward: away([-1, 0, 0]) });
  if (faces.includes('r')) out.push({ pts: [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], mat, toward: away([1, 0, 0]) });
  return out;
}

// 長方形（4点）。表は toward の側
const rect = (pts: number[][], mat: Material, toward: number[]): Poly => ({ pts, mat, toward });

export interface HallSize { width: number; height: number; floor: number; stage: number }

// コンサートホール。箱の中に、プロジェクターより後ろのステージ
export function hallPolys(r: HallSize, depth: number): Poly[] {
  const y0 = -r.floor, y1 = r.height - r.floor, z0 = r.stage, z1 = -depth, x = r.width / 2;
  const inside = [0, (y0 + y1) / 2, (z0 + z1) / 2];
  return [
    rect([[-x, y0, z0], [x, y0, z0], [x, y0, z1], [-x, y0, z1]], 'room', inside),
    rect([[-x, y1, z0], [x, y1, z0], [x, y1, z1], [-x, y1, z1]], 'room', inside),
    rect([[-x, y0, z0], [-x, y0, z1], [-x, y1, z1], [-x, y1, z0]], 'room', inside),
    rect([[x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0]], 'room', inside),
    rect([[-x, y0, z1], [x, y0, z1], [x, y1, z1], [-x, y1, z1]], 'room', inside),
    rect([[-x, y0, z0], [x, y0, z0], [x, y1, z0], [-x, y1, z0]], 'room', inside),
  ];
}

export interface ArenaSize { floor: number; stage: number }

// アリーナの主な寸法（会場の形と、レーザーやカメラの置き場所で共通に使う）
export function arenaLayout(r: ArenaSize, depth: number) {
  const y0 = -r.floor, z0 = r.stage;
  // アリーナ（平土間）の半幅、奥の角を落とす長さ、スタンドの段（水平の奥行き・高さ）
  const xf = 22, chamfer = 12;
  const t1 = { run: 15, rise: 8 }, fascia = 1.4, t2 = { run: 13, rise: 11 }, roof = 34;
  const zf = Math.min(-20, -(depth - t1.run - t2.run));
  // ステージ（高さ1.8m、幅20m、前の縁はプロジェクターの少し手前）
  const deck = y0 + 1.8, sw = 20, front = -1.2;
  // 花道とセンターステージ
  const run = Math.min(24, -zf * 0.4), cs = 5, hy = y0 + 1.2;
  return {
    y0, z0, xf, chamfer, t1, fascia, t2, roof, zf, deck, sw, front, run, cs, hy,
    // FOH（音響・照明の卓）は客席の中ほど
    fohZ: zf * 0.62,
    // ステージ上の照明トラスの高さと位置
    trussY: y0 + 15, trussZ: 6,
  };
}

// 屋内アリーナ（エンドステージ）。国内の1万〜1万5千人規模の会場を参考にしたおおよその形。
// アリーナ（平土間）を、2層のスタンドがコの字に囲む（奥の角は斜めに落とす）。
// ステージは端に置き、花道の先にセンターステージ。客席の中ほどにFOH（音響・照明の卓）
export function arenaPolys(r: ArenaSize, depth: number): Poly[] {
  const { y0, z0, xf, chamfer, t1, fascia, t2, roof, zf, deck, sw, front, run, cs, hy, fohZ } = arenaLayout(r, depth);
  const standDepth = t1.run + t2.run;
  const inside = [0, y0 + 12, (z0 + zf) / 2];
  const out: Poly[] = [];

  // 床の縁（下手の端 → 奥 → 上手の端）。ステージの端（z0）から始まって z0 に戻る
  const edge: V2[] = [[-xf, z0], [-xf, zf + chamfer], [-xf + chamfer, zf], [xf - chamfer, zf], [xf, zf + chamfer], [xf, z0]];
  const center: V2 = [0, (z0 + zf) / 2];
  const ring1 = offset(edge, t1.run, center);
  const ring2 = offset(edge, standDepth, center);
  const yA = y0 + t1.rise, yB = yA + fascia, yC = yB + t2.rise, yTop = y0 + roof;

  // アリーナの床
  out.push({ pts: edge.map(p => [p[0], y0, p[1]]), mat: 'room', toward: inside });
  // 1階スタンド、2階の手すり壁、2階スタンド、その後ろの壁
  out.push(...band(edge, y0, ring1, yA, 'stand', inside));
  out.push(...band(ring1, yA, ring1, yB, 'room', inside));
  out.push(...band(ring1, yB, ring2, yC, 'stand', inside));
  out.push(...band(ring2, yC, ring2, yTop, 'room', inside));
  // 屋根とステージ側の壁（スタンドの外まで覆う長方形。スタンドの切り口もこの壁で塞がる）
  const X = Math.max(...ring2.map(p => Math.abs(p[0]))), Z = Math.min(...ring2.map(p => p[1]));
  out.push(rect([[-X, yTop, z0], [X, yTop, z0], [X, yTop, Z], [-X, yTop, Z]], 'room', inside));
  out.push(rect([[-X, y0, z0], [X, y0, z0], [X, yTop, z0], [-X, yTop, z0]], 'room', inside));
  // ステージと、奥の大きなLEDスクリーン
  out.push(...box(-sw / 2, sw / 2, y0, deck, front, z0, 'stage', 'tflr'));
  out.push(rect([[-11, deck + 1, z0 - 2], [11, deck + 1, z0 - 2], [11, deck + 12, z0 - 2], [-11, deck + 12, z0 - 2]], 'screen', [0, deck, -50]));
  // 左右のサイドスクリーン（中継映像用）と、吊ったスピーカー（PA）
  for (const s of [-1, 1]) {
    const x = s * (sw / 2 + 7);
    out.push(rect([[x - 3.5, y0 + 7, 0.5], [x + 3.5, y0 + 7, 0.5], [x + 3.5, y0 + 13, 0.5], [x - 3.5, y0 + 13, 0.5]], 'screen', [x, y0 + 10, -50]));
    const px = s * (sw / 2 + 2);
    out.push(...box(px - 0.7, px + 0.7, y0 + 8, y0 + 18, -0.5, 0.8, 'gear', 'flr'));
  }
  // 花道とセンターステージ（ステージより少し低い）
  out.push(...box(-1.5, 1.5, y0, hy, -run, front, 'stage', 'tlr'));
  out.push(...box(-cs, cs, y0, hy, -run - 2 * cs, -run, 'stage', 'tflr'));
  // FOH（客席の中ほど、少し高い台の上に音響・照明の卓）
  const fz = fohZ;
  // 台（高さ60cm）の上に、ステージ側を向いた卓。オペレーターは卓の後ろに立つ
  out.push(...box(-5, 5, y0, y0 + 0.6, fz - 3, fz + 3, 'gear', 'tfblr'));
  out.push(...box(-3.5, 3.5, y0 + 0.6, y0 + 1.6, fz + 0.5, fz + 1.6, 'gear', 'tfblr'));
  return out;
}

// ステージ上の照明トラス（線だけ。ビームは当てない）。角トラス（約50cm角）を3本
export function arenaTruss(r: ArenaSize, depth: number): number[] {
  const { trussY: y, sw } = arenaLayout(r, depth), x = sw / 2 + 4, h = 0.5;
  const out: number[] = [];
  for (const z of [2, 8, 14]) {
    for (const [dy, dz] of [[0, 0], [h, 0], [0, h], [h, h]]) out.push(-x, y + dy, z + dz, x, y + dy, z + dz);
    // 吊りのチェーン
    for (const cx of [-x + 1, 0, x - 1]) out.push(cx, y + h, z, cx, y + 14, z);
  }
  return out;
}
