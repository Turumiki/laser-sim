type Child = Node | string;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...children);
  return e;
}

// iPhoneのSafariは、ダブルタップで画面を拡大する（CSSで止めても効かないことがある）。
// 短い間隔の2回目のタップだけ既定の動きを止める。入力欄は止めない（文字の選択などに使う）
export function preventDoubleTapZoom() {
  let last = 0;
  document.addEventListener('touchend', e => {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select')) return;
    if (e.timeStamp - last < 350) e.preventDefault();
    last = e.timeStamp;
  }, { passive: false });
}
