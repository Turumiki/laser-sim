import { DEFAULTS, GROUPS, PARAMS, PRESETS, SHARED_GROUPS, type NumberParam, type ParamDef, type Settings } from '../core/params';
import { loadLocal, saveLocal } from '../core/persist';
import type { Store } from '../core/store';
import { el } from './dom';

type Updater = (s: Readonly<Settings>) => void;

const CLOSED_KEY = 'laser:inspector:closed';
// ツールバーに出しているもの
const IN_TOOLBAR = new Set<string>(['mode', 'output']);

export function buildInspector(root: HTMLElement, store: Store, channel: string) {
  const updaters: Updater[] = [];
  const closed = new Set(loadLocal<string[]>(CLOSED_KEY) ?? []);

  const resetAll = el('button', { class: 'tb', title: 'パターンと出力サイズ以外をすべて初期値に戻す' }, 'すべて初期値に戻す');
  resetAll.addEventListener('click', () => {
    const { pattern, output, ...rest } = DEFAULTS;
    store.set(rest);
  });
  root.append(el('div', { class: 'inspector-head' }, resetAll));

  // このレーザー（チャンネル）の設定と、全チャンネル共通の設定を分けて見せる
  let lastShared: boolean | null = null;
  for (const g of GROUPS) {
    const shared = SHARED_GROUPS.includes(g.id);
    if (shared !== lastShared) {
      lastShared = shared;
      root.append(shared
        ? el('div', { class: 'section-head', title: 'どのチャンネルで変えても、全部のチャンネルに効く' }, '全体', el('small', {}, '全チャンネル共通'))
        : el('div', { class: 'section-head', title: 'このチャンネルのレーザーだけの設定' }, 'このレーザー', el('small', {}, `ch: ${channel}`)));
    }
    const rows = el('div', { class: 'rows' });
    const head = el('h3', {}, g.label);
    const section = el('section', { class: closed.has(g.id) ? 'group closed' : 'group' }, head, rows);
    head.addEventListener('click', () => {
      section.classList.toggle('closed');
      if (section.classList.contains('closed')) closed.add(g.id); else closed.delete(g.id);
      saveLocal(CLOSED_KEY, [...closed]);
    });

    if (g.id === 'debug') rows.append(presetRow(store));
    for (const p of PARAMS.filter(p => p.group === g.id && !IN_TOOLBAR.has(p.key))) {
      const [row, update] = paramRow(p, store);
      // 初期値から変えた項目には印を付け、名前のダブルクリックで戻せるようにする
      row.querySelector('label')!.addEventListener('dblclick', () => store.set({ [p.key]: DEFAULTS[p.key] } as Partial<Settings>));
      rows.append(row);
      updaters.push(st => {
        update(st);
        row.classList.toggle('changed', !isDefault(p, st));
        row.classList.toggle('inactive', !!p.inactive?.(st));
      });
    }
    root.append(section);
  }

  const refresh = () => { const s = store.get(); for (const u of updaters) u(s); };
  store.subscribe(refresh);
  refresh();
}

function presetRow(store: Store) {
  const row = el('div', { class: 'presets' });
  for (const p of Object.values(PRESETS)) {
    const b = el('button', { class: 'tb', title: p.title }, p.label);
    b.addEventListener('click', () => store.set(p.values));
    row.append(b);
  }
  return row;
}

function paramRow(p: ParamDef, store: Store): [HTMLElement, Updater] {
  const label = el('label', { title: `${p.hint ? p.hint + '\n' : ''}ダブルクリックで初期値に戻す` }, p.label);
  const set = (v: unknown) => store.set({ [p.key]: v } as Partial<Settings>);

  switch (p.kind) {
    case 'number':
      return numberRow(p, label, store);
    case 'enum': {
      const sel = el('select');
      for (const o of p.options) sel.append(new Option(o.label, o.value));
      sel.addEventListener('change', () => set(sel.value));
      return [el('div', { class: 'row' }, label, sel), s => { sel.value = s[p.key]; }];
    }
    case 'bool': {
      const box = el('input', { type: 'checkbox' });
      box.addEventListener('change', () => set(box.checked));
      return [el('div', { class: 'row' }, label, el('div', {}, box)), s => { box.checked = s[p.key]; }];
    }
    case 'color': {
      const input = el('input', { type: 'color' });
      input.addEventListener('input', () => set(input.value));
      return [el('div', { class: 'row' }, label, input), s => { input.value = s[p.key]; }];
    }
  }
}

function numberRow(p: NumberParam, label: HTMLElement, store: Store): [HTMLElement, Updater] {
  const input = el('input', { type: 'text', inputmode: 'decimal', spellcheck: 'false' });
  const bar = el('div', { class: 'bar' });
  const field = el('div', { class: 'field numfield' }, input);
  if (p.unit) field.append(el('span', { class: 'unit' }, p.unit));
  field.append(bar);
  label.classList.add('scrub');

  const clamp = (v: number) => Math.min(p.max, Math.max(p.min, v));
  const round = (v: number) => Number(v.toFixed(Math.max(p.digits, 2)));
  const frac = (v: number) => p.log ? Math.log(v / p.min) / Math.log(p.max / p.min) : (v - p.min) / (p.max - p.min);
  const set = (v: number) => store.set({ [p.key]: round(clamp(v)) } as Partial<Settings>);

  // 項目名を左右にドラッグして値を変える。Shiftで細かく
  label.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    label.setPointerCapture(e.pointerId);
    const x0 = e.clientX, v0 = store.get()[p.key];
    const move = (m: PointerEvent) => {
      const dx = (m.clientX - x0) * (m.shiftKey ? 0.1 : 1);
      set(p.log ? v0 * Math.pow(p.max / p.min, dx / 300) : v0 + dx * (p.max - p.min) / 300);
    };
    // タッチでスクロールに切り替わったときなどは pointerup が来ないので、取り消しでも終える
    const up = () => {
      label.removeEventListener('pointermove', move);
      label.removeEventListener('pointerup', up);
      label.removeEventListener('pointercancel', up);
      label.removeEventListener('lostpointercapture', up);
    };
    label.addEventListener('pointermove', move);
    label.addEventListener('pointerup', up);
    label.addEventListener('pointercancel', up);
    label.addEventListener('lostpointercapture', up);
  });

  input.addEventListener('focus', () => input.select());
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = store.get()[p.key].toFixed(p.digits); input.blur(); }
  });
  input.addEventListener('change', () => {
    const v = parseFloat(input.value);
    if (Number.isFinite(v)) set(v);
    else input.value = store.get()[p.key].toFixed(p.digits);
  });

  return [el('div', { class: 'row' }, label, field), s => {
    const v = s[p.key];
    if (document.activeElement !== input) input.value = v.toFixed(p.digits);
    bar.style.width = `${Math.max(0, Math.min(1, frac(v))) * 100}%`;
  }];
}

function isDefault(p: ParamDef, s: Readonly<Settings>) {
  const v = s[p.key], d = DEFAULTS[p.key];
  // 数値は表示している桁で比べる（ドラッグで丸めた値と初期値の小さなずれは同じとみなす）
  if (p.kind === 'number') return Math.abs((v as number) - (d as number)) < 0.5 * 10 ** -p.digits;
  return v === d;
}
