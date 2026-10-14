import { loadLocal, saveLocal } from '../browser/persist';

const KEY = 'laser:bottom-height';
const INITIAL = 172;
// 下の枠の最小の高さと、上のビューアに最低限残す高さ
const MIN = 80;
const KEEP_VIEWER = 120;

// 下の枠（パターン / シーケンス）の上端をドラッグして高さを変える。ダブルクリックで元の高さ
export function attachBottomResize(app: HTMLElement, bottom: HTMLElement) {
  const handle = Object.assign(document.createElement('div'), { className: 'resize-handle', title: 'ドラッグで高さを変える（ダブルクリックで元に戻す）' });
  bottom.prepend(handle);

  const fit = (h: number) => {
    // ツールバーとステータスバーの分を除いた残りから、ビューアの分を残す
    const max = app.clientHeight - 30 - 20 - KEEP_VIEWER;
    return Math.round(Math.max(MIN, Math.min(max, h)));
  };
  const set = (h: number) => {
    app.style.setProperty('--bottom-h', `${fit(h)}px`);
  };
  set(loadLocal<number>(KEY) ?? INITIAL);
  addEventListener('resize', () => set(bottom.offsetHeight));

  handle.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const y0 = e.clientY, h0 = bottom.offsetHeight;
    handle.classList.add('dragging');
    const move = (m: PointerEvent) => set(h0 + (y0 - m.clientY));
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      handle.classList.remove('dragging');
      saveLocal(KEY, bottom.offsetHeight);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
  handle.addEventListener('dblclick', () => {
    set(INITIAL);
    saveLocal(KEY, INITIAL);
  });
}
