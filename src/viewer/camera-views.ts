import type { ViewerSettings } from './settings';
import { ROOMS } from './surfaces';
import { arenaLayout } from './venues';

// 立った人の目の高さ（床から）
export const EYE_HEIGHT = 1.6;

type Vec3 = [number, number, number];

// 視点ごとのカメラの位置と、見る先。プロジェクターは原点で客席（-z）の方を向いている
export function viewPose(vs: ViewerSettings, floorY: number): { pos: Vec3; look: Vec3 } {
  const d = vs.distance, eye = floorY + EYE_HEIGHT;
  const room = ROOMS[vs.target];
  const width = room?.width ?? d, height = room?.height ?? 8;
  // ステージ（プロジェクター）の少し上を見る
  const stage: Vec3 = [0, floorY + height * 0.3, 0];
  switch (vs.view) {
    // 客席の前寄り、少し横から
    case 'audience': return { pos: [width * 0.12, eye, -d * 0.35], look: stage };
    case 'foh': {
      if (vs.target === 'arena' && room) {
        // アリーナではFOHの卓の後ろに立った目線（卓の台は高さ60cm）
        const L = arenaLayout(room, d);
        return { pos: [0, L.y0 + 0.6 + EYE_HEIGHT, L.fohZ - 0.5], look: stage };
      }
      // 客席の中央、奥行きの6割くらい。1mほどの台の上
      return { pos: [0, eye + 1, -d * 0.6], look: stage };
    }
    case 'side':
      // 会場では、客席の後ろの高い角から全体を見下ろす
      if (room) return { pos: [width * 0.42, floorY + height * 0.85, -d * 0.95], look: [0, floorY + height * 0.2, -d * 0.3] };
      return { pos: [d * 0.55, EYE_HEIGHT, -d * 0.35], look: [0, 0, -d * 0.45] };
    case 'stage':
      return { pos: [0, 1.2, 3], look: [0, 0, -d / 2] };
  }
}
