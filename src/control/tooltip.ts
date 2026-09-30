// ブラウザ標準のツールチップは出るまで1秒ほどかかるので、title を読んで自前で早めに出す。
// タッチ操作では出さない
export function fastTooltips(delay = 250) {
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  document.body.append(tip);

  let timer = 0;
  let target: HTMLElement | null = null;

  const hide = () => {
    clearTimeout(timer);
    tip.hidden = true;
    target = null;
  };

  document.addEventListener('pointerover', e => {
    if (e.pointerType === 'touch') return;
    const t = (e.target as Element).closest<HTMLElement>('[title], [data-tip]');
    if (!t || t === target) return;
    hide();
    // 標準のツールチップと二重に出ないよう、title は data-tip に移す（あとで title が書き換わってもここで拾い直す）
    if (t.hasAttribute('title')) {
      t.dataset.tip = t.title;
      t.removeAttribute('title');
    }
    if (!t.dataset.tip) return;
    target = t;
    timer = window.setTimeout(() => {
      if (target !== t) return;
      tip.textContent = t.dataset.tip!;
      tip.hidden = false;
      const r = t.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
      const x = Math.min(Math.max(4, r.left), innerWidth - w - 4);
      const below = r.bottom + 6 + h < innerHeight;
      tip.style.left = `${x}px`;
      tip.style.top = `${below ? r.bottom + 6 : r.top - h - 6}px`;
    }, delay);
  });
  document.addEventListener('pointerout', e => {
    if (target && !target.contains(e.relatedTarget as Node)) hide();
  });
  document.addEventListener('pointerdown', hide);
}
