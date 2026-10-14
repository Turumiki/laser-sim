import type { Projector } from './beams';
import type { ViewerSettings } from './settings';
import { ROOMS } from './surfaces';
import { arenaLayout } from './venues';

const deg = (d: number) => d * Math.PI / 180;
// 扇に並べたとき、一番外側の台を外へ向ける角度
const FAN_SPREAD = deg(20);

// ステージの前に横一列で並べる。扇は外側ほど外を向け、左右対称は右半分を左右反転する
function lineUp({ count, spacing, layout }: ViewerSettings): Projector[] {
  const list: Projector[] = [];
  const mid = (count - 1) / 2;
  for (let i = 0; i < count; i++) {
    const k = mid ? (i - mid) / mid : 0;
    list.push({
      pos: [(i - mid) * spacing, 0, 0],
      yaw: layout === 'fan' ? -k * FAN_SPREAD : 0,
      mirror: layout === 'mirror' && i > mid,
    });
  }
  return list;
}

// アリーナでは、設置場所に合わせて高さと前後の位置を決める（座標はプロジェクターの標準位置が原点）
function placeIn(list: Projector[], vs: ViewerSettings): Projector[] {
  const room = ROOMS.arena;
  if (vs.target !== 'arena' || !room || vs.place === 'rig') return list;
  const L = arenaLayout(room, vs.distance);
  const half = Math.ceil(list.length / 2);
  return list.map((p, i) => {
    const [x] = p.pos;
    switch (vs.place) {
      // ステージの前の縁に床置き（高さ30cmほどの台）。客席に当てないよう少し上に向ける
      case 'deck': return { ...p, pos: [x, L.deck + 0.3, L.front + 0.5], pitch: deg(12) };
      // 一番前の照明トラスに吊る。客席の上へ少し下向きに
      case 'truss': return { ...p, pos: [x, L.trussY - 0.4, 2], pitch: deg(-8) };
      // ステージの左右に立てたタワーに、半分ずつ縦に積む。少し内向きに振る
      case 'towers': {
        const left = i < half, k = left ? i : i - half;
        const side = left ? -1 : 1;
        return { ...p, pos: [side * (L.sw / 2 + 3), L.y0 + 6 + k * 0.9, 0], yaw: p.yaw - side * deg(10), pitch: deg(5) };
      }
      // 花道の先のセンターステージ
      case 'center': return { ...p, pos: [x, L.hy + 0.3, -L.run - L.cs], pitch: deg(15) };
    }
    return p;
  });
}

export const projectorsFor = (vs: ViewerSettings) => placeIn(lineUp(vs), vs);
