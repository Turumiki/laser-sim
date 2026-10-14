import { el } from '../browser/dom';
import { getPattern } from '../core/patterns';
import { locate, showLength, type Show } from '../core/show';

// 1拍ぶんのブロックの幅（px）と、ブロックの最小の幅
const PX_PER_BEAT = 14;
const MIN_BLOCK = 88;
// 単色以外（レインボーなど）のステップの色の帯
const RAINBOW = 'linear-gradient(90deg, #f33, #ff3, #3f3, #3ff, #33f, #f3f)';

export const fmtTime = (sec: number) => `${Math.floor(sec / 60)}:${(sec % 60).toFixed(1).padStart(4, '0')}`;
export const patternName = (id: string | undefined) => (id ? getPattern(id).name : '');

// 再生開始から t 秒のときの位置。at はショーの頭からの秒（ループするなら1周の中で）
export function playhead(show: Show, t: number) {
  const total = showLength(show);
  return { total, pos: locate(show, t), at: show.loop ? t % total : Math.min(t, total) };
}

// タイムライン: 拍数に比例した長さのブロックを並べる。再生中はどのステップの何割まで来たかを塗る
export class Timeline {
  readonly root = el('div', { class: 'strip' });

  // onPick: i 番目のブロックを押した
  constructor(private onPick: (i: number) => void) {}

  render(show: Show | null, selected: number, emptyText: string) {
    this.root.replaceChildren();
    if (!show?.steps.length) {
      this.root.append(el('p', { class: 'empty' }, emptyText));
      return;
    }
    show.steps.forEach((st, i) => {
      const name = patternName(st.values.pattern) || '—';
      const bar = el('span', { class: 'bar' });
      bar.style.background = st.values.colorMode && st.values.colorMode !== 'single' ? RAINBOW : st.values.color ?? '#888';
      const b = el('button', { class: 'block', title: `${i + 1}. ${name}・${st.beats}拍` },
        bar,
        el('span', { class: 'no' }, String(i + 1)),
        el('span', { class: 'name' }, name),
        el('small', {}, `${st.beats}拍`),
        el('span', { class: 'fill' }),
      );
      b.style.width = `${Math.max(MIN_BLOCK, st.beats * PX_PER_BEAT)}px`;
      b.classList.toggle('sel', i === selected);
      b.addEventListener('click', () => this.onPick(i));
      this.root.append(b);
    });
  }

  // 再生位置を塗る。t: 再生開始からの秒（止まっていれば null）
  progress(show: Show, t: number | null) {
    const strip = this.root;
    const blocks = strip.querySelectorAll<HTMLElement>('.block');
    const fillOf = (b: HTMLElement) => b.lastChild as HTMLElement;
    if (t === null) {
      blocks.forEach(b => { b.classList.remove('now'); fillOf(b).style.width = '0'; });
      return;
    }
    const { pos, at } = playhead(show, t);
    const i = pos?.index ?? -1;
    blocks.forEach((b, k) => {
      // 再生中のステップが見えていなければ、タイムラインをそこまで送る
      if (k === i && !b.classList.contains('now')) {
        const left = b.offsetLeft - strip.offsetLeft, right = left + b.offsetWidth;
        if (left < strip.scrollLeft || right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = left - 16;
      }
      b.classList.toggle('now', k === i);
      const len = show.steps[k].beats * 60 / show.bpm;
      fillOf(b).style.width = k === i && pos ? `${Math.min(100, (at - pos.start) / len * 100)}%` : '0';
    });
  }
}
