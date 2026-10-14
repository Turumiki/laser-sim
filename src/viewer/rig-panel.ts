import { el } from '../browser/dom';
import { loadLocal, saveLocal } from '../browser/persist';
import type { ChannelAssign } from './channel-assign';
import {
  LAYOUTS, PLACES, QUALITY, RANGES, RENDER_MODES, VIEWER_KEY, VIEWS,
  type NumKey, type Quality, type ViewerSettings,
} from './settings';
import { ROOMS, TARGETS } from './surfaces';

// 設定の枠で閉じているまとまり
const CLOSED_KEY = 'laser:viewer:closed';
const HIDDEN_KEY = 'laser:viewer:hidden';

// 設定を変えたときに、作り直しが要るものだけ作り直す
export interface RigPanelActions {
  number(key: NumKey): void;
  quality(): void;
  view(): void;
  // 会場を変えた（奥行きはもう会場に合わせてある）
  target(): void;
  projectors(): void;
  eye(): void;
  // 初期値に戻して開き直す
  reset(): void;
}

type Options<T extends string> = readonly { id: T; label: string }[];

// 設定の枠。エディタのインスペクターと同じく、役割ごとのまとまりに分けて開け閉めできるようにする
export function buildRigPanel(panel: HTMLElement, vs: ViewerSettings, assign: ChannelAssign, act: RigPanelActions) {
  const rebuild = () => buildRigPanel(panel, vs, assign, act);
  const save = () => saveLocal(VIEWER_KEY, vs);
  const closed = new Set(loadLocal<string[]>(CLOSED_KEY) ?? []);
  panel.replaceChildren();

  // 見出しと、初期値に戻すボタン。チャンネルの割り当てはそのまま
  const reset = el('button', { class: 'reset', title: '3Dビューアの設定をすべて初期値に戻す（台ごとのチャンネルはそのまま）' }, '初期値に戻す');
  reset.addEventListener('click', () => act.reset());
  panel.append(el('div', { class: 'head' }, el('span', { class: 'title' }, '3Dビューア'), reset));

  const section = (id: string, title: string) => {
    const h = el('h4', {}, title);
    const rows = el('div', { class: 'rows' });
    const box = el('section', { class: closed.has(id) ? 'grp closed' : 'grp' }, h, rows);
    h.addEventListener('click', () => {
      box.classList.toggle('closed');
      if (box.classList.contains('closed')) closed.add(id); else closed.delete(id);
      saveLocal(CLOSED_KEY, [...closed]);
    });
    panel.append(box);
    return rows;
  };
  const row = (parent: HTMLElement, label: string, title: string, ...controls: HTMLElement[]) => {
    const r = el('div', { class: 'row', title }, el('span', { class: 'name' }, label), ...controls);
    parent.append(r);
    return r;
  };
  const select = <T extends string>(parent: HTMLElement, label: string, title: string, options: Options<T>, value: T, set: (v: T) => void) => {
    const sel = el('select');
    for (const o of options) sel.add(new Option(o.label, o.id));
    sel.value = value;
    sel.addEventListener('change', () => {
      const o = options.find(x => x.id === sel.value);
      if (o) set(o.id);
      save();
    });
    return row(parent, label, title, sel);
  };
  // 選択肢が少ないものは、並んだボタンで選ぶ
  const seg = <T extends string>(parent: HTMLElement, label: string, title: string, options: Options<T>, value: T, set: (v: T) => void) => {
    const box = el('div', { class: 'seg' });
    for (const o of options) {
      const b = el('button', o.id === value ? { class: 'on' } : {}, o.label);
      b.addEventListener('click', () => {
        for (const x of box.children) x.classList.toggle('on', x === b);
        set(o.id);
        save();
      });
      box.append(b);
    }
    return row(parent, label, title, box);
  };
  const range = (parent: HTMLElement, key: NumKey, label: string, title: string, unit = '') => {
    const { min, max, step } = RANGES[key];
    const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(vs[key]) });
    const out = el('output');
    const digits = step < 0.1 ? 2 : step < 1 ? 1 : 0;
    const show = () => { out.textContent = vs[key].toFixed(digits) + unit; };
    input.addEventListener('input', () => {
      vs[key] = Number(input.value);
      act.number(key);
      save();
      show();
    });
    show();
    return row(parent, label, title, input, out);
  };
  const check = (parent: HTMLElement, key: 'eye' | 'rolling', label: string, title: string, then: () => void) => {
    const box = el('input', { type: 'checkbox' });
    box.checked = vs[key];
    box.addEventListener('change', () => { vs[key] = box.checked; then(); save(); });
    return row(parent, label, title, box);
  };

  // --- 表示 ---
  const view = section('view', '表示');
  seg(view, '描き方', '点データ: ビームを点データから直接出す（実機に近い）。クッキー: 出力と同じ映像（ポストエフェクトなし）を、スポットライトのクッキーとして投影する（Unityなどで起きることの再現）',
    RENDER_MODES, vs.render, v => { vs.render = v; rebuild(); });
  const qualities = (Object.keys(QUALITY) as Quality[]).map(id => ({ id, label: QUALITY[id].label }));
  seg(view, '画質', '高: 高解像度・アンチエイリアスあり・ヘイズのむらも細かく描く。中: 等倍の解像度で、アンチエイリアスなし。低: 解像度を下げ、ブルームも切って軽くする（スマホ向け）',
    qualities, vs.quality, v => { vs.quality = v; act.quality(); });
  const viewRow = select(view, '視点', '見る位置。FOHは客席の中ほどにある音響・照明の卓の後ろ。ドラッグで動かしたあと「戻す」でこの位置に戻る', VIEWS, vs.view, v => { vs.view = v; act.view(); });
  const back = el('button', { class: 'small' }, '戻す');
  back.addEventListener('click', () => act.view());
  viewRow.append(back);
  viewRow.classList.add('with-button');

  // --- 会場 ---
  const venue = section('venue', '会場');
  select(venue, '投影先', 'ビームが当たる物。会場を選ぶと、奥行きも会場の大きさになる', TARGETS, vs.target, v => {
    vs.target = v;
    // 会場を選んだら、奥行きを合わせる
    const room = ROOMS[v];
    if (room) vs.distance = room.depth;
    act.target();
    rebuild();
  });
  range(venue, 'distance', ROOMS[vs.target] ? '奥行き' : '壁までの距離', 'レーザー機から奥の壁までの距離', ' m');
  range(venue, 'work', '作業灯', '会場の形を見るための明かり。0で本番のような真っ暗');

  // --- レーザー機 ---
  const rigBox = section('rig', 'レーザー機');
  range(rigBox, 'count', '台数', 'レーザー機の台数', ' 台');
  range(rigBox, 'spacing', '間隔', '隣の台との間隔', ' m');
  select(rigBox, '並べ方', '複数台の並べ方。平行: すべて同じ向き / 扇: 外側の台ほど外へ向ける / 左右対称: 右半分を左右反転', LAYOUTS, vs.layout, v => { vs.layout = v; act.projectors(); });
  if (vs.target === 'arena') {
    select(rigBox, '設置場所', 'レーザー機の置き場所。標準は床から5mの高さ。ほかに、ステージ前の床・ステージ上のトラス・上手と下手のタワー・センターステージ', PLACES, vs.place, v => { vs.place = v; act.projectors(); });
  }
  rigBox.append(assign.root);
  assign.render();

  // --- ヘイズ ---
  const haze = section('haze', 'ヘイズ');
  range(haze, 'haze', '濃さ', 'ヘイズの濃さ。濃いほどビームが明るく見える');
  range(haze, 'smoke', 'むら', '濃さのむらの強さ。0で一様');
  range(haze, 'grain', 'むらの細かさ', 'むらの模様の細かさ');
  range(haze, 'flow', '流れ', '空調や送風で流れる速さ。0で止まる');
  range(haze, 'extinction', '減衰', '遠くへ行くほど光が弱まる度合い（ヘイズに吸われ、散らされる）');

  // --- 見え方（目・カメラ） ---
  const look = section('look', '見え方');
  range(look, 'bloom', 'ブルーム', '明るい所のにじみ（カメラやレンズでの光のあふれ）');
  check(look, 'eye', '目の感度', '人の目の色ごとの感度で見る。目は緑に敏感で、同じ出力でも赤や青は暗く見える（一般的なRGB機: 赤638nm・緑520nm・青450nm）', () => act.eye());
  check(look, 'rolling', 'ローリング', 'スマホや一般的なビデオカメラで撮ったときの写り方。画面を上の行から順に時間をずらして撮るので、速く動くレーザーは曲がったり縞になったりして写る。スキャンのチャンネルを「点データ」で描いているときだけ効く', rebuild);
  if (vs.rolling) range(look, 'readout', '読み出し時間', '画面の上から下まで読み出すのにかかる時間。スマホでだいたい10〜30ms', ' ms');
  if (vs.render === 'video') range(look, 'flat', '距離減衰の補正', 'クッキーの描き方で、遠くの減衰を弱める（1で距離に反比例）。Unityのライトの減衰カーブを平らにしたときの見え方');

  panel.append(el('p', { class: 'note' }, 'ドラッグで回転、右ドラッグ（2本指）で移動、ホイール（ピンチ）で拡大。H または右上のボタンでこの枠を隠す'));
}

// 設定の枠を隠す（キーボードのないスマホ用にボタンも置く）
export function setupPanelToggle(panel: HTMLElement, button: HTMLElement) {
  const set = (hidden: boolean) => {
    panel.classList.toggle('hidden', hidden);
    button.textContent = hidden ? '設定' : '隠す';
    saveLocal(HIDDEN_KEY, hidden);
  };
  set(loadLocal<boolean>(HIDDEN_KEY) ?? false);
  button.addEventListener('click', () => set(!panel.classList.contains('hidden')));
  addEventListener('keydown', e => {
    if (e.key === 'h' || e.key === 'H') button.click();
  });
}
