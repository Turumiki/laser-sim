import { outputSize } from '../core/params';
import type { Store } from '../core/store';
import { el } from './dom';

// ビューア。プレビューを枠に収め、マウスで位置・サイズ・角度を動かす
export function attachViewer(root: HTMLElement, canvas: HTMLCanvasElement, store: Store) {
  // 出力の範囲（キャンバス）と、レーザーが描ける範囲（中央の正方形）が分かるように枠と表示を付ける
  const frameLabel = el('span', { class: 'frame-label' });
  const guideLabel = el('span', { class: 'guide-label' });
  const guide = el('div', { class: 'guide' }, guideLabel);
  root.append(frameLabel, guide);
  const PAD = 14;

  const fit = () => {
    const s = store.get();
    const [w, h] = outputSize(s);
    const k = Math.min((root.clientWidth - PAD * 2) / w, (root.clientHeight - PAD * 2) / h);
    const cw = w * k, ch = h * k, side = Math.min(cw, ch);
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    const left = (root.clientWidth - cw) / 2, top = (root.clientHeight - ch) / 2;
    frameLabel.textContent = `出力 ${w} × ${h}`;
    Object.assign(frameLabel.style, { left: `${left}px`, top: `${top - 13}px` });
    Object.assign(guide.style, {
      width: `${side}px`,
      height: `${side}px`,
      left: `${(root.clientWidth - side) / 2}px`,
      top: `${(root.clientHeight - side) / 2}px`,
    });
    guideLabel.textContent = `描画範囲（最大走査角 ${Math.round(s.scanAngle)}°）`;
  };
  new ResizeObserver(fit).observe(root);
  store.subscribe(ch => { if (ch.output || ch.scanAngle !== undefined) fit(); });
  fit();

  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  const wrap = (a: number) => ((a % 360) + 360) % 360;
  // 画面上のpx → 位置の単位（正方形の半分が1）
  const perPx = () => {
    const [w, h] = outputSize(store.get());
    return (w / canvas.clientWidth) / (Math.min(w, h) / 2);
  };

  // 1本指（マウス）: 移動、Shift+ドラッグで回転 / 2本指: ピンチでサイズ、ひねりで角度、中点の移動で位置
  const pointers = new Map<number, { x: number; y: number }>();
  let rotate = false;
  let pinch: { dist: number; ang: number; size: number; angle: number } | null = null;

  const two = () => {
    const [a, b] = [...pointers.values()];
    return {
      dist: Math.hypot(b.x - a.x, b.y - a.y),
      ang: Math.atan2(b.y - a.y, b.x - a.x),
      mx: (a.x + b.x) / 2,
      my: (a.y + b.y) / 2,
    };
  };

  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('dragging');
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    rotate = e.shiftKey;
    if (pointers.size === 2) {
      const g = two(), s = store.get();
      pinch = { dist: g.dist, ang: g.ang, size: s.size, angle: s.angle };
    }
  });

  canvas.addEventListener('pointermove', e => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const before = pointers.size === 2 ? two() : null;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    const s = store.get();

    if (pinch && before) {
      const g = two();
      store.set({
        size: clamp(pinch.size * g.dist / Math.max(1, pinch.dist), 0.05, 1.5),
        // 画面はy下向きなので、見た目の時計回りが角度のマイナスになる
        angle: wrap(pinch.angle - (g.ang - pinch.ang) * 180 / Math.PI),
        offX: clamp(s.offX + (g.mx - before.mx) * perPx(), -1.78, 1.78),
        offY: clamp(s.offY - (g.my - before.my) * perPx(), -1, 1),
      });
    } else if (pointers.size === 1) {
      if (rotate) store.set({ angle: wrap(s.angle + dx * 0.3) });
      else store.set({
        offX: clamp(s.offX + dx * perPx(), -1.78, 1.78),
        offY: clamp(s.offY - dy * perPx(), -1, 1),
      });
    }
  });

  const release = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) canvas.classList.remove('dragging');
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

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
