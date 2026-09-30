import { sanitize } from '../core/params';
import { getPattern } from '../core/patterns';
import { loadLocal, saveLocal } from '../core/persist';
import { locate, showLength, stepFrom, type Show } from '../core/show';
import { BUILTIN_SHOWS } from '../core/shows';
import type { Store } from '../core/store';
import type { ShowInfo } from '../sync/client';
import { el } from './dom';
import { attachExport } from './export-button';

type Send = (msg: Record<string, unknown>) => void;

const SEQ_KEY = 'laser:sequence';
const ALL_KEY = 'laser:sequence:all';

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${(sec % 60).toFixed(1).padStart(4, '0')}`;

// シーケンス（ショー）のタブ。
// 1行目: 再生まわり / 2行目: 編集（カスタムのときだけ） / タイムライン: 拍数に比例した長さのブロック
export function buildSequence(root: HTMLElement, store: Store, send: Send, serverNow: () => number) {
  let info: ShowInfo | null = null;
  let selected = loadLocal<string>(SEQ_KEY) ?? BUILTIN_SHOWS[0].id;
  let selStep = -1;

  const current = (): Show | null =>
    selected === 'custom' ? info?.custom ?? null : BUILTIN_SHOWS.find(s => s.id === selected) ?? null;
  const playing = () => !!info?.state.playing && info.state.id === selected;
  const saveCustom = (show: Show) => send({ action: 'save', show });
  const editable = () => selected === 'custom';

  // --- 1行目: 再生 ---
  const pick = el('select', { class: 'tb', title: 'ショー' });
  for (const s of BUILTIN_SHOWS) pick.add(new Option(s.name, s.id));
  pick.add(new Option('カスタム', 'custom'));
  pick.addEventListener('change', () => {
    selected = pick.value;
    selStep = -1;
    saveLocal(SEQ_KEY, selected);
    render();
  });

  const play = el('button', { class: 'tb play' });
  const all = el('input', { type: 'checkbox' });
  all.checked = loadLocal<boolean>(ALL_KEY) ?? false;
  all.addEventListener('change', () => saveLocal(ALL_KEY, all.checked));
  play.addEventListener('click', () => {
    if (playing()) send({ action: all.checked ? 'stopAll' : 'stop' });
    else send({ action: all.checked ? 'playAll' : 'play', id: selected });
  });

  const status = el('span', { class: 'seq-status' });
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

  const transport = el('div', { class: 'seq-row' },
    pick, play,
    el('label', { class: 'mini', title: '全部のチャンネルを同じ瞬間に始める（動きの位置も頭に揃える）。カスタムは各チャンネルのカスタムを流す' }, all, '全チャンネル'),
    el('span', { class: 'grow' }),
    status, exp,
  );

  // --- 2行目: 編集 ---
  const bpm = el('input', { class: 'num', type: 'number', min: '20', max: '300', step: '1' });
  bpm.addEventListener('change', () => {
    const show = current();
    if (show && editable()) saveCustom({ ...show, bpm: Number(bpm.value) || show.bpm });
  });
  const loop = el('input', { type: 'checkbox' });
  loop.addEventListener('change', () => {
    const show = current();
    if (show && editable()) saveCustom({ ...show, loop: loop.checked });
  });

  const add = el('button', { class: 'tb', title: '今の絵柄を、選んだステップの後ろ（選んでいなければ最後）に追加する' }, '＋ 今の設定を追加');
  add.addEventListener('click', () => {
    const show = current() ?? { id: 'custom', name: 'カスタム', bpm: 128, loop: true, steps: [] };
    const steps = [...show.steps];
    const at = selStep >= 0 ? selStep + 1 : steps.length;
    steps.splice(at, 0, stepFrom(store.get(), 8));
    selStep = at;
    saveCustom({ ...show, steps });
  });

  const beats = el('input', { class: 'num', type: 'number', min: '0.25', max: '256', step: '1' });
  beats.addEventListener('change', () => {
    const show = current();
    if (!show || selStep < 0) return;
    const steps = show.steps.map((s, i) => (i === selStep ? { ...s, beats: Number(beats.value) || s.beats } : s));
    saveCustom({ ...show, steps });
  });
  const del = el('button', { class: 'tb' }, '削除');
  del.addEventListener('click', () => {
    const show = current();
    if (!show || selStep < 0) return;
    saveCustom({ ...show, steps: show.steps.filter((_, i) => i !== selStep) });
    selStep = Math.min(selStep, show.steps.length - 2);
  });
  const stepLabel = el('span', { class: 'seq-label' });
  const stepTools = el('span', { class: 'seq-group' }, stepLabel, el('label', { class: 'mini' }, beats, '拍'), del);

  const customTools = el('div', { class: 'seq-row' },
    el('label', { class: 'mini' }, 'BPM', bpm),
    el('label', { class: 'mini' }, loop, 'ループ'),
    el('span', { class: 'sep' }),
    add,
    el('span', { class: 'sep' }),
    stepTools,
  );

  const copy = el('button', { class: 'tb' }, '複製して編集');
  copy.addEventListener('click', () => {
    const show = current();
    if (!show) return;
    saveCustom({ ...structuredClone(show), id: 'custom', name: 'カスタム' });
    selected = 'custom';
    saveLocal(SEQ_KEY, selected);
  });
  const builtinTools = el('div', { class: 'seq-row' },
    el('span', { class: 'seq-note' }, '組み込みのショーはそのままでは編集できません。'), copy);

  const strip = el('div', { class: 'strip' });
  root.append(transport, customTools, builtinTools, strip);

  function render() {
    const show = current();
    pick.value = selected;
    play.textContent = playing() ? '■ 停止' : '▶ 再生';
    play.classList.toggle('on', playing());
    play.disabled = exp.disabled = !show?.steps.length;

    customTools.hidden = !editable();
    builtinTools.hidden = editable();
    bpm.value = String(show?.bpm ?? 128);
    loop.checked = show?.loop ?? true;
    const step = show?.steps[selStep];
    stepTools.hidden = !step;
    if (step) {
      stepLabel.textContent = `ステップ ${selStep + 1}:`;
      beats.value = String(step.beats);
    }

    strip.replaceChildren();
    if (!show?.steps.length) {
      strip.append(el('p', { class: 'empty' }, editable()
        ? '絵柄を決めてから「＋ 今の設定を追加」を押すと、ステップとして並んでいきます。'
        : 'ステップがありません。'));
    } else {
      show.steps.forEach((st, i) => {
        const name = st.values.pattern ? getPattern(st.values.pattern).name : '—';
        const bar = el('span', { class: 'bar' });
        bar.style.background = st.values.colorMode && st.values.colorMode !== 'single'
          ? 'linear-gradient(90deg, #f33, #ff3, #3f3, #3ff, #33f, #f3f)'
          : st.values.color ?? '#888';
        const b = el('button', { class: 'block', title: `${i + 1}. ${name}・${st.beats}拍` },
          bar,
          el('span', { class: 'no' }, String(i + 1)),
          el('span', { class: 'name' }, name),
          el('small', {}, `${st.beats}拍`),
          el('span', { class: 'fill' }),
        );
        b.style.width = `${Math.max(88, st.beats * 14)}px`;
        b.classList.toggle('sel', i === selStep);
        // 止まっている間は、クリックでそのキューを出して確認できる
        b.addEventListener('click', () => {
          selStep = i;
          if (!playing()) store.set(sanitize(st.values));
          render();
        });
        strip.append(b);
      });
    }
    tick();
  }

  // 再生中の位置（どのステップの何割まで来たか）を表示する
  function tick() {
    const show = current();
    const blocks = strip.querySelectorAll<HTMLElement>('.block');
    if (!show?.steps.length) { status.textContent = ''; return; }
    const total = showLength(show);
    if (!playing() || !info) {
      blocks.forEach(b => { b.classList.remove('now'); (b.lastChild as HTMLElement).style.width = '0'; });
      status.textContent = `${show.bpm} BPM · ${show.steps.length}ステップ · ${fmt(total)}`;
      return;
    }
    const t = (serverNow() - info.state.startedAt) / 1000;
    const pos = locate(show, t);
    const i = pos?.index ?? -1;
    const at = show.loop ? t % total : Math.min(t, total);
    blocks.forEach((b, k) => {
      // 再生中のステップが見えていなければ、タイムラインをそこまで送る
      if (k === i && !b.classList.contains('now')) {
        const left = b.offsetLeft - strip.offsetLeft, right = left + b.offsetWidth;
        if (left < strip.scrollLeft || right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = left - 16;
      }
      b.classList.toggle('now', k === i);
      const fill = b.lastChild as HTMLElement;
      const len = show.steps[k].beats * 60 / show.bpm;
      fill.style.width = k === i && pos ? `${Math.min(100, (at - pos.start) / len * 100)}%` : '0';
    });
    const p = i >= 0 ? show.steps[i].values.pattern : undefined;
    status.textContent = `${i + 1}/${show.steps.length} ${p ? getPattern(p).name : ''} · ${fmt(at)} / ${fmt(total)}`;
  }
  setInterval(tick, 100);

  render();
  return {
    onShow(next: ShowInfo) {
      info = next;
      render();
    },
  };
}
