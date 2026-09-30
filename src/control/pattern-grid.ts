import { listPatterns, type PatternCategory } from '../core/patterns';
import type { Store } from '../core/store';
import { el } from './dom';

const CATEGORIES: { id: PatternCategory; label: string }[] = [
  { id: 'line', label: 'Lines' },
  { id: 'shape', label: 'Shapes' },
  { id: 'test', label: 'Test' },
];

export function buildPatternGrid(root: HTMLElement, store: Store) {
  const buttons = new Map<string, HTMLButtonElement>();
  for (const c of CATEGORIES) {
    const items = listPatterns().filter(p => p.category === c.id);
    if (!items.length) continue;
    const clips = el('div', { class: 'clips' });
    for (const p of items) {
      const b = el('button', { class: 'clip', title: p.id }, p.name);
      b.addEventListener('click', () => store.set({ pattern: p.id }));
      buttons.set(p.id, b);
      clips.append(b);
    }
    root.append(el('h4', {}, c.label), clips);
  }

  const refresh = () => {
    const cur = store.get().pattern;
    for (const [id, b] of buttons) b.classList.toggle('on', id === cur);
  };
  store.subscribe(ch => { if (ch.pattern !== undefined) refresh(); });
  refresh();
}
