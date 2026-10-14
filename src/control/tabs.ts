import { loadLocal, saveLocal } from '../browser/persist';

const KEY = 'laser:tab';

// 下の枠のタブ（パターン / シーケンス）
export function buildTabs(root: HTMLElement) {
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('.tabs button')];
  const show = (id: string) => {
    for (const b of buttons) {
      b.classList.toggle('on', b.dataset.tab === id);
      document.getElementById(b.dataset.tab!)!.hidden = b.dataset.tab !== id;
    }
    saveLocal(KEY, id);
  };
  for (const b of buttons) b.addEventListener('click', () => show(b.dataset.tab!));
  show(loadLocal<string>(KEY) ?? 'patterns');
}
