import { listPatterns, type PatternCategory } from '../core/patterns';
import type { Store } from '../core/store';
import { buildAssetsPanel } from './assets-panel';
import { el } from '../browser/dom';

const CATEGORIES: { id: PatternCategory; label: string }[] = [
  { id: 'line', label: '線' },
  { id: 'shape', label: '図形' },
  { id: 'beam', label: 'ビーム演出' },
  { id: 'test', label: 'テスト' },
];

export function buildPatternGrid(root: HTMLElement, store: Store) {
  const buttons = new Map<string, HTMLButtonElement>();
  for (const c of CATEGORIES) {
    const items = listPatterns().filter(p => p.category === c.id);
    if (!items.length) continue;
    const clips = el('div', { class: 'clips' });
    for (const p of items) {
      const b = el('button', { class: 'clip', title: p.hint ?? p.name }, p.name);
      b.addEventListener('click', () => store.set({ pattern: p.id }));
      buttons.set(p.id, b);
      clips.append(b);
    }
    root.append(el('h4', {}, c.label), clips);
  }

  buildAssetsPanel(root, store);

  const refresh = () => {
    const cur = store.get().pattern;
    for (const [id, b] of buttons) b.classList.toggle('on', id === cur);
  };
  store.subscribe(ch => { if (ch.pattern !== undefined) refresh(); });
  refresh();
}
