import { el } from '../browser/dom';
import { loadLocal, saveLocal } from '../browser/persist';
import { BPM_RANGE, DEFAULTS, sanitize } from '../core/params';
import type { ShowInfo } from '../core/protocol';
import { showLength, STEP_BEATS, STEP_KEYS, stepFrom, type Show } from '../core/show';
import { BUILTIN_SHOWS } from '../core/shows';
import type { Store } from '../core/store';
import { attachExport } from './export-button';
import { fmtTime, patternName, playhead, Timeline } from './sequence-timeline';

type Send = (msg: Record<string, unknown>) => void;

const SEQ_KEY = 'laser:sequence';
const ALL_KEY = 'laser:sequence:all';

// 「＋ 今の設定を追加」で足すステップの長さ（拍）
const NEW_STEP_BEATS = 8;

// シーケンス（ショー）のタブ。
// 1行目: 再生まわり / 2行目: 編集（カスタムのときだけ） / タイムライン: 拍数に比例した長さのブロック
// onEdit: 設定パネルで編集しているステップ（なければ null）
export function buildSequence(root: HTMLElement, store: Store, send: Send, serverNow: () => number, onEdit: (label: string | null) => void = () => {}) {
  let info: ShowInfo | null = null;
  let selected = loadLocal<string>(SEQ_KEY) ?? BUILTIN_SHOWS[0].id;
  let selStep = -1;
  // ステップを呼び出しているところ（設定の変更をそのステップに書き戻さない）
  let loading = false;

  const current = (): Show | null =>
    selected === 'custom' ? info?.custom ?? null : BUILTIN_SHOWS.find(s => s.id === selected) ?? null;
  const playing = () => !!info?.state.playing && info.state.id === selected;
  const saveCustom = (show: Show) => send({ action: 'save', show });
  const editable = () => selected === 'custom';

  // --- 1行目: 再生 ---
  const pick = el('select', { class: 'tb', title: 'シーケンス' });
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
  const exp = el('button', { class: 'tb', title: 'シーケンスの頭から終わりまでをMP4に書き出す（ループはしない）' }, '書き出し');
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
  const bpm = el('input', { class: 'num', type: 'number', min: String(BPM_RANGE.min), max: String(BPM_RANGE.max), step: '1' });
  bpm.addEventListener('change', () => {
    const show = current();
    if (show && editable()) saveCustom({ ...show, bpm: Number(bpm.value) || show.bpm });
  });
  const loop = el('input', { type: 'checkbox' });
  loop.addEventListener('change', () => {
    const show = current();
    if (show && editable()) saveCustom({ ...show, loop: loop.checked });
  });

  const add = el('button', { class: 'tb', title: '今の設定（絵柄とレーザー機）を、選んだステップの後ろ（選んでいなければ最後）に追加する' }, '＋ 今の設定を追加');
  add.addEventListener('click', () => {
    const show = current() ?? { id: 'custom', name: 'カスタム', bpm: DEFAULTS.bpm, loop: true, steps: [] };
    const steps = [...show.steps];
    const at = selStep >= 0 ? selStep + 1 : steps.length;
    steps.splice(at, 0, stepFrom(store.get(), NEW_STEP_BEATS));
    selStep = at;
    saveCustom({ ...show, steps });
  });

  const beats = el('input', { class: 'num', type: 'number', min: String(STEP_BEATS.min), max: String(STEP_BEATS.max), step: '1' });
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
    el('span', { class: 'seq-note' }, '組み込みのシーケンスはそのままでは編集できません。'), copy);

  // 止まっている間は、クリックでそのキューを出す。カスタムなら、選んでいる間の設定の変更はそのステップに入る。
  // もう一度クリックで選択を外す
  const timeline = new Timeline(i => {
    selStep = selStep === i ? -1 : i;
    const st = current()?.steps[selStep];
    if (st && !info?.state.playing) {
      loading = true;
      store.set(sanitize(st.values));
      loading = false;
    }
    render();
  });
  root.append(transport, customTools, builtinTools, timeline.root);

  function render() {
    const show = current();
    pick.value = selected;
    play.textContent = playing() ? '■ 停止' : '▶ 再生';
    play.classList.toggle('on', playing());
    play.disabled = exp.disabled = !show?.steps.length;

    customTools.hidden = !editable();
    builtinTools.hidden = editable();
    bpm.value = String(show?.bpm ?? DEFAULTS.bpm);
    loop.checked = show?.loop ?? true;
    const step = show?.steps[selStep];
    stepTools.hidden = !step;
    if (step) {
      stepLabel.textContent = editable() ? `ステップ ${selStep + 1} を編集中:` : `ステップ ${selStep + 1}:`;
      beats.value = String(step.beats);
    }

    const editing = editable() && step && !info?.state.playing;
    const name = patternName(step?.values.pattern);
    onEdit(editing ? `ステップ ${selStep + 1}${name ? '：' + name : ''}` : null);

    timeline.render(show, selStep, editable()
      ? '絵柄を決めてから「＋ 今の設定を追加」を押すと、ステップとして並んでいきます。'
      : 'ステップがありません。');
    tick();
  }

  // ステップを選んでいる間は、設定パネルやパターンでの変更をそのステップに書き込む。
  // 自分の操作だけ（再生で切り替わった値や、他の画面からの同期は入れない）。送るのは少しまとめてから
  const stepKeys = new Set<string>(STEP_KEYS as readonly string[]);
  let pending = 0;
  store.subscribe((changed, origin) => {
    if (loading || origin !== 'local' || !editable() || selStep < 0 || info?.state.playing) return;
    if (!Object.keys(changed).some(k => stepKeys.has(k))) return;
    const at = selStep;
    clearTimeout(pending);
    pending = window.setTimeout(() => {
      const show = current();
      if (!show?.steps[at]) return;
      const steps = show.steps.map((s, i) => (i === at ? stepFrom(store.get(), s.beats) : s));
      saveCustom({ ...show, steps });
    }, 300);
  });

  // 再生中の位置（どのステップの何割まで来たか）を表示する
  function tick() {
    const show = current();
    if (!show?.steps.length) { status.textContent = ''; return; }
    if (!playing() || !info) {
      timeline.progress(show, null);
      status.textContent = `${show.bpm} BPM · ${show.steps.length}ステップ · ${fmtTime(showLength(show))}`;
      return;
    }
    const t = (serverNow() - info.state.startedAt) / 1000;
    timeline.progress(show, t);
    const { total, pos, at } = playhead(show, t);
    const i = pos?.index ?? -1;
    status.textContent = `${i + 1}/${show.steps.length} ${patternName(show.steps[i]?.values.pattern)} · ${fmtTime(at)} / ${fmtTime(total)}`;
  }
  setInterval(tick, 100);

  // 選んでいるショーに関係なく、このチャンネルで今流れているショー（タブの外に出す表示用）
  function nowPlaying(): string | null {
    if (!info?.state.playing) return null;
    const id = info.state.id;
    const show = id === 'custom' ? info.custom : BUILTIN_SHOWS.find(s => s.id === id);
    if (!show?.steps.length) return null;
    const { pos, at } = playhead(show, (serverNow() - info.state.startedAt) / 1000);
    const name = pos ? patternName(show.steps[pos.index].values.pattern) : '';
    return `${show.name} ${pos ? pos.index + 1 : '-'}/${show.steps.length}${name ? ' ' + name : ''} · ${fmtTime(at)}`;
  }

  render();
  return {
    onShow(next: ShowInfo) {
      info = next;
      render();
    },
    nowPlaying,
  };
}
