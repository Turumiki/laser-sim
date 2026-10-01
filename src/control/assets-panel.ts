import { assetPattern, forgetAsset, primeAsset, type AssetData, type AssetInfo } from '../core/assets';
import { buildFrame } from '../core/build';
import { Frame } from '../core/frame';
import type { Store } from '../core/store';
import { el } from './dom';

const ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.svg,.ild';
const KIND_LABEL: Record<AssetData['kind'], string> = { vector: '画像', ilda: 'ILDA' };

// パターンの「素材」。画像・SVG・ILDAファイルを読み込んで、サーバーに置く
export function buildAssetsPanel(root: HTMLElement, store: Store) {
  const clips = el('div', { class: 'clips' });
  const colors = el('select', { class: 'tb', title: '画像（PNG・JPGなど）を輪郭にするときの色の数。背景の色は数えない。少ないほど線が減り、ちらつきにくい' });
  for (const n of [1, 2, 3, 4, 6, 8]) colors.add(new Option(`${n}色`, String(n)));
  colors.value = '3';
  const input = el('input', { type: 'file', accept: ACCEPT, hidden: '' });
  const add = el('button', { class: 'clip add', title: 'PNG・JPG（ロゴなど、はっきりした絵）は輪郭をなぞって線にする。SVGは線をそのまま、ILDAファイル（.ild）はコマごとそのまま読む' }, '＋ 読み込み…');
  const note = el('span', { class: 'asset-note' });
  add.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    note.textContent = `${file.name} を読み込み中…`;
    try {
      const data = await convert(file, Number(colors.value));
      const res = await fetch('/api/assets', { method: 'POST', body: JSON.stringify({ name: file.name.replace(/\.[^.]+$/, ''), data }) });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? '保存できませんでした');
      const info = await res.json() as AssetInfo;
      primeAsset({ ...info, data });
      await refresh();
      store.set({ pattern: assetPattern(info.id), colorMode: 'source' });
      note.textContent = budget(data, store);
    } catch (e) {
      note.textContent = `読み込めませんでした: ${(e as Error).message}`;
    }
  });

  root.append(el('h4', {}, '素材'), clips, el('div', { class: 'asset-tools' }, colors, note), input);

  const buttons = new Map<string, HTMLButtonElement>();
  async function refresh() {
    let list: AssetInfo[] = [];
    try { list = await (await fetch('/api/assets')).json(); } catch { /* サーバーが無ければ空 */ }
    clips.replaceChildren();
    buttons.clear();
    for (const a of list) {
      const id = assetPattern(a.id);
      const del = el('span', { class: 'del', title: '削除（もう一度押すと消える）' }, '×');
      // 名前が長くても × が隠れないよう、名前だけを省略する
      const b = el('button', { class: 'clip asset', title: `${a.name}（${KIND_LABEL[a.kind]}）` }, el('span', { class: 'name' }, a.name), del);
      b.addEventListener('click', e => {
        if (e.target === del) return;
        store.set({ pattern: id, colorMode: 'source' });
      });
      // 押し間違いで消えないよう、2回押しで消す
      del.addEventListener('click', async () => {
        if (!del.classList.contains('armed')) {
          del.classList.add('armed');
          del.textContent = '消す';
          setTimeout(() => { del.classList.remove('armed'); del.textContent = '×'; }, 2500);
          return;
        }
        await fetch(`/api/assets/${encodeURIComponent(a.id)}`, { method: 'DELETE' });
        forgetAsset(a.id);
        await refresh();
      });
      buttons.set(id, b);
      clips.append(b);
    }
    clips.append(add);
    mark();
  }

  const mark = () => {
    const cur = store.get().pattern;
    for (const [id, b] of buttons) b.classList.toggle('on', id === cur);
  };
  store.subscribe(ch => { if (ch.pattern !== undefined) mark(); });
  // 別の画面で読み込んだ素材も出す
  addEventListener('focus', () => { if (document.visibilityState === 'visible') refresh(); });
  refresh();
}

async function convert(file: File, colors: number): Promise<AssetData> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.ild')) {
    const { parseIlda } = await import('./import/ilda');
    return parseIlda(await file.arrayBuffer());
  }
  if (name.endsWith('.svg') || file.type === 'image/svg+xml') {
    const { svgToPaths } = await import('./import/svg');
    const paths = svgToPaths(await file.text());
    if (!paths.length) throw new Error('描ける線や図形が見つかりませんでした');
    return { kind: 'vector', paths };
  }
  const { rasterToPaths } = await import('./import/raster');
  const paths = await rasterToPaths(file, colors);
  if (!paths.length) throw new Error('背景以外の色の部分が見つかりませんでした');
  return { kind: 'vector', paths };
}

// 今の設定で描いたときの点の数と、1秒に何回描き直せるか（少ないとちらつく）
function budget(data: AssetData, store: Store) {
  const s = store.get();
  if (data.kind === 'ilda') {
    const max = Math.max(...data.frames.map(f => f.x.length));
    const hz = Math.round(s.pps / max), fps = Number(s.fps);
    const warn = hz < fps ? `。1コマ（1/${fps}秒）に全体が入り切らないコマがある。ppsを上げると良くなる` : '';
    return `${data.frames.length}コマ・最大${max}点（${s.pps / 1000}kppsで約${hz}回/秒${warn}）`;
  }
  const f = new Frame();
  buildFrame(f, s, 0);
  const hz = Math.round(s.pps / Math.max(1, f.length));
  // 映像の1コマの間に全体を描き切れないと、コマごとに一部しか写らない
  const fps = Number(s.fps);
  const warn = hz < fps ? `。1コマ（1/${fps}秒）に全体が入り切らず、一部ずつしか写らない。色数を減らすか、点間隔を広げるか、ppsを上げると良くなる` : '';
  return `${data.paths.length}本・${f.length}点（${s.pps / 1000}kppsで約${hz}回/秒${warn}）`;
}
