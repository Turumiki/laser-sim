import { outputSize } from '../core/params';
import type { Store } from '../core/store';
import { el } from './dom';

// ビューア。プレビューを枠に収め、マウスで位置・サイズ・角度を動かす
export function attachViewer(root: HTMLElement, canvas: HTMLCanvasElement, store: Store) {
  const guide = el('div', { class: 'guide' });
  root.append(guide);

  const fit = () => {
    const [w, h] = outputSize(store.get());
    const k = Math.min(root.clientWidth / w, root.clientHeight / h);
    const cw = w * k, ch = h * k, side = Math.min(cw, ch);
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    // レーザーが描ける範囲（中央の正方形）
    Object.assign(guide.style, {
      width: `${side}px`,
      height: `${side}px`,
      left: `${(root.clientWidth - side) / 2}px`,
      top: `${(root.clientHeight - side) / 2}px`,
    });
  };
  new ResizeObserver(fit).observe(root);
  store.subscribe(ch => { if (ch.output) fit(); });
  fit();

  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  const wrap = (a: number) => ((a % 360) + 360) % 360;
  // 画面上のpx → 位置の単位（正方形の半分が1）
  const perPx = () => {
    const [w, h] = outputSize(store.get());
    return (w / canvas.clientWidth) / (Math.min(w, h) / 2);
  };

  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('dragging');
    let x = e.clientX, y = e.clientY;
    const rotate = e.shiftKey;
    const move = (m: PointerEvent) => {
      const dx = m.clientX - x, dy = m.clientY - y;
      x = m.clientX;
      y = m.clientY;
      const s = store.get();
      if (rotate) store.set({ angle: wrap(s.angle + dx * 0.3) });
      else store.set({
        offX: clamp(s.offX + dx * perPx(), -1.78, 1.78),
        offY: clamp(s.offY - dy * perPx(), -1, 1),
      });
    };
    const up = () => {
      canvas.classList.remove('dragging');
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    // MacではShift+ホイールが横スクロール（deltaX）になる
    const d = e.deltaY || e.deltaX;
    const s = store.get();
    if (e.shiftKey) store.set({ angle: wrap(s.angle + d * 0.1) });
    else store.set({ size: clamp(s.size * Math.exp(-d * 0.0015), 0.05, 1.5) });
  }, { passive: false });

  canvas.addEventListener('dblclick', () => store.set({ offX: 0, offY: 0 }));
}
