import type { Group, PerspectiveCamera, Vector3, WebGLRenderer } from 'three';
import { EYE_HEIGHT } from './camera-views';

// ヘッドセットの床の高さが会場の床に合うように、選んでいる視点の位置に立つ。顔は見る先の方へ向ける
// VRでは頭の位置が player の上で動く。普段は原点のままで何もしない
export function standAt(player: Group, camera: PerspectiveCamera, look: Vector3) {
  const p = camera.position.clone();
  // 普段の視点の高さは目の高さなので、足もとに直す
  player.position.set(p.x, p.y - EYE_HEIGHT, p.z);
  player.rotation.set(0, Math.atan2(-(look.x - p.x), -(look.z - p.z)), 0);
  camera.position.set(0, EYE_HEIGHT, 0);
  camera.rotation.set(0, 0, 0);
}

interface XrOptions {
  renderer: WebGLRenderer;
  player: Group;
  button: HTMLButtonElement;
  // 視点の位置にカメラを置き直す（VR中なら standAt まで行う）
  placeCamera: () => void;
  // コントローラのトリガーを引いた
  onSelect: () => void;
  onEnd: () => void;
}

export function setupXr({ renderer, player, button, placeCamera, onSelect, onEnd }: XrOptions) {
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  for (const i of [0, 1]) renderer.xr.getController(i).addEventListener('select', onSelect);

  const xr = navigator.xr;
  // VRの機器がつながっていて、https で開いているときだけボタンを出す
  if (!xr) return;
  xr.isSessionSupported('immersive-vr').then(ok => { button.hidden = !ok; }).catch(() => { /* 出さないまま */ });

  let session: XRSession | null = null;
  button.addEventListener('click', async () => {
    if (session) { await session.end(); return; }
    try {
      const s = await xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
      session = s;
      await renderer.xr.setSession(s);
      // OrbitControls は VR 中は止まるので、視点の位置を計算し直してそこに立つ
      placeCamera();
      button.textContent = 'VRを終える';
      s.addEventListener('end', () => {
        session = null;
        button.textContent = 'VRで見る';
        player.position.set(0, 0, 0);
        player.rotation.set(0, 0, 0);
        onEnd();
      });
    } catch (e) {
      button.textContent = 'VRに入れませんでした';
      console.warn(e);
    }
  });
}
