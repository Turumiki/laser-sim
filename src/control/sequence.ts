import { sanitize } from '../core/params';
import { getPattern } from '../core/patterns';
import { loadLocal, saveLocal } from '../core/persist';
import { showLength, stepFrom, type Show } from '../core/show';
import { BUILTIN_SHOWS } from '../core/shows';
import type { Store } from '../core/store';
import type { ShowInfo } from '../sync/client';
import { el } from './dom';
import { attachExport } from './export-button';

type Send = (msg: Record<string, unknown>) => void;

const SEQ_KEY = 'laser:sequence';

// シーケンス（ショー）のタブ。拍数に比例した長さのブロックを並べたタイムラインで見せる
export function buildSequence(root: HTMLElement, store: Store, send: Send) {
  let info: ShowInfo | null = null;
  let selected = loadLocal<string>(SEQ_KEY) ?? BUILTIN_SHOWS[0].id;
  let selStep = -1;

  const current = (): Show | null =>
    selected === 'custom' ? info?.custom ?? null : BUILTIN_SHOWS.find(s => s.id === selected) ?? null;
  const playing = () => !!info?.state.playing && info.state.id === selected;
  const saveCustom = (show: Show) => send({ action: 'save', show });
  const editable = () => selected === 'custom';

  // --- 操作列 ---
  const pick = el('select', { class: 'tb', title: 'ショー' });
  for (const s of BUILTIN_SHOWS) pick.add(new Option(s.name, s.id));
  pick.add(new Option('カスタム', 'custom'));
  pick.addEventListener('change', () => {
    selected = pick.value;
    selStep = -1;
    saveLocal(SEQ_KEY, selected);
    render();
  });

  const play = el('button', { class: 'tb' });
  play.addEventListener('click', () => send(playing() ? { action: 'stop' } : { action: 'play', id: selected }));

  const bpm = el('input', { class: 'num', type: 'number', min: '20', max: '300', step: '1', title: 'BPM' });
  bpm.addEventListener('change', () => {
    const show = current();
    if (show && editable()) saveCustom({ ...show, bpm: Number(bpm.value) || show.bpm });
  });
  const loop = el('input', { type: 'checkbox', title: '最後まで行ったら頭に戻る' });
  loop.addEventListener('change', () => {
    const show = current();
    if (show && editable()) saveCustom({ ...show, loop: loop.checked });
  });

  const copy = el('button', { class: 'tb', title: 'このショーをカスタムに写して編集できるようにする' }, '複製して編集');
  copy.addEventListener('click', () => {
    const show = current();
    if (!show) return;
    saveCustom({ ...structuredClone(show), id: 'custom', name: 'カスタム' });
    selected = 'custom';
    pick.value = 'custom';
    saveLocal(SEQ_KEY, selected);
  });

  const add = el('button', { class: 'tb', title: '今の絵柄の設定を、選んだステップの後ろに追加する' }, '＋ 今の設定を追加');
  add.addEventListener('click', () => {
    const show = current() ?? { id: 'custom', name: 'カスタム', bpm: 128, loop: true, steps: [] };
    const steps = [...show.steps];
    const at = selStep >= 0 ? selStep + 1 : steps.length;
    steps.splice(at, 0, stepFrom(store.get(), 8));
    selStep = at;
    saveCustom({ ...show, steps });
  });

  const beats = el('input', { class: 'num', type: 'number', min: '0.25', max: '256', step: '1', title: '選んだステップの拍数' });
  beats.addEventListener('change', () => {
    const show = current();
    if (!show || selStep < 0) return;
    const steps = show.steps.map((s, i) => (i === selStep ? { ...s, beats: Number(beats.value) || s.beats } : s));
    saveCustom({ ...show, steps });
  });
  const del = el('button', { class: 'tb', title: '選んだステップを消す' }, '削除');
  del.addEventListener('click', () => {
    const show = current();
    if (!show || selStep < 0) return;
    saveCustom({ ...show, steps: show.steps.filter((_, i) => i !== selStep) });
    selStep = Math.min(selStep, show.steps.length - 2);
  });

  const exp = el('button', { class: 'tb', title: 'ショーの頭から終わりまでをMP4に書き出す（ループはしない）' }, '書き出し');
  attachExport(exp, () => {
    const show = current()!;
    return {
      settings: { ...store.get(), ...sanitize(show.steps[0]?.values ?? {}) },
      seconds: showLength(show),
      name: `laser_show_${show.id}`,
      show: { ...show, loop: false },
    };
  });

  const info1 = el('span', { class: 'seq-info' });
  const editTools = el('span', { class: 'seq-tools' }, add, el('label', { class: 'mini' }, '拍', beats), del);
  const bar = el('div', { class: 'seq-bar' },
    pick, play,
    el('label', { class: 'mini' }, 'BPM', bpm),
    el('label', { class: 'mini' }, loop, 'ループ'),
    el('span', { class: 'sep' }),
    copy, editTools,
    el('span', { class: 'grow' }),
    info1, exp,
  );
  const strip = el('div', { class: 'strip' });
  root.append(bar, strip);

  function render() {
    const show = current();
    pick.value = selected;
    play.textContent = playing() ? '■ 停止' : '▶ 再生';
    play.classList.toggle('on', playing());
    play.disabled = !show?.steps.length;
    exp.disabled = !show?.steps.length;
    bpm.value = String(show?.bpm ?? 128);
    loop.checked = show?.loop ?? true;
    bpm.disabled = loop.disabled = !editable();
    copy.hidden = editable();
    editTools.hidden = !editable();
    beats.disabled = del.disabled = selStep < 0 || !show?.steps[selStep];
    if (show?.steps[selStep]) beats.value = String(show.steps[selStep].beats);
    const len = show ? showLength(show) : 0;
    info1.textContent = show?.steps.length ? `${show.steps.length}ステップ · ${len.toFixed(1)}秒` : '';

    strip.replaceChildren();
    if (!show?.steps.length) {
      strip.append(el('p', { class: 'empty' }, editable()
        ? '「＋ 今の設定を追加」で、今の絵柄をステップとして並べていきます。'
        : 'ステップがありません。'));
      return;
    }
    show.steps.forEach((step, i) => {
      const name = step.values.pattern ? getPattern(step.values.pattern).name : '—';
      const b = el('button', { class: 'block', title: `${name}・${step.beats}拍` },
        el('span', { class: 'swatch' }), el('span', {}, name), el('small', {}, `${step.beats}`));
      b.style.width = `${Math.max(44, step.beats * 9)}px`;
      const sw = b.firstChild as HTMLElement;
      sw.style.background = step.values.colorMode && step.values.colorMode !== 'single'
        ? 'linear-gradient(90deg, #f33, #ff3, #3f3, #3ff, #33f, #f3f)'
        : step.values.color ?? '#888';
      b.classList.toggle('sel', i === selStep);
      b.classList.toggle('now', playing() && info!.state.index === i);
      // 止まっている間は、クリックでそのキューを出して確認できる
      b.addEventListener('click', () => {
        selStep = i;
        if (!playing()) store.set(sanitize(step.values));
        render();
      });
      strip.append(b);
    });
  }

  render();
  return {
    onShow(next: ShowInfo) {
      info = next;
      render();
    },
  };
}
