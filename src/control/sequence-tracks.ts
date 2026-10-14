import { el } from '../browser/dom';
import { isValidChannel, type ShowInfo } from '../core/protocol';
import type { Show } from '../core/show';
import { BUILTIN_SHOWS } from '../core/shows';
import { switchChannel } from './channel';
import { patternName, playhead } from './sequence-timeline';

// 全体を見渡す表示なので、時間は秒に比例させて小さめに描く
const PX_PER_SEC = 10;
const RAINBOW = 'linear-gradient(90deg, #f33, #ff3, #3f3, #3ff, #33f, #f3f)';
// ほかのチャンネルの様子を取り直す間隔（ms）
const POLL = 2000;

interface Track {
  ch: string;
  info: ShowInfo;
}

// そのチャンネルで流れているショー。止まっていればカスタム
function showOf({ info }: Track): Show | null {
  const { state, custom } = info;
  if (state.playing) return state.id === 'custom' ? custom : BUILTIN_SHOWS.find(s => s.id === state.id) ?? null;
  return custom;
}

// チャンネルごとのシーケンスを1行ずつ並べる。行を押すと、そのチャンネルに切り替える。
// チャンネルが1つだけのときは出さない
export class SequenceTracks {
  readonly root = el('div', { class: 'tracks' });
  private tracks: Track[] = [];
  private heads = new Map<string, HTMLElement>();

  constructor(private channel: string, private serverNow: () => number) {
    this.root.hidden = true;
    setInterval(() => this.poll(), POLL);
    setInterval(() => this.tick(), 100);
    this.poll();
  }

  // このチャンネルのショーが変わったときなど、すぐに取り直す
  refresh() {
    this.poll();
  }

  private async poll() {
    // タブを開いていないときは取りに行かない
    if (!this.root.isConnected || (this.root.parentElement?.offsetParent ?? null) === null) return;
    try {
      const list: unknown = await fetch('/api/channels').then(r => r.json());
      const names = Array.isArray(list) ? list.filter(isValidChannel) : [];
      if (!names.includes(this.channel)) names.push(this.channel);
      names.sort();
      this.tracks = await Promise.all(names.map(async ch => ({
        ch,
        info: await fetch(`/api/show?ch=${encodeURIComponent(ch)}`).then(r => r.json()) as ShowInfo,
      })));
    } catch { return; /* サーバーにつながらないときは前の表示のまま */ }
    this.render();
  }

  private render() {
    this.root.hidden = this.tracks.length < 2;
    this.heads.clear();
    const rows = this.tracks.map(t => {
      const show = showOf(t);
      const playing = t.info.state.playing;
      const status = !show?.steps.length ? '—' : `${playing ? '▶ ' : ''}${show.name}`;
      const label = el('span', { class: 'track-label' }, el('span', { class: 'track-ch' }, t.ch), el('small', {}, status));
      const lane = el('span', { class: 'track-lane' });
      if (show?.steps.length) {
        const beat = 60 / show.bpm;
        let x = 0;
        show.steps.forEach((st, i) => {
          const w = st.beats * beat * PX_PER_SEC;
          const block = el('span', { class: 'track-step', title: `${i + 1}. ${patternName(st.values.pattern) || '—'}・${st.beats}拍` });
          block.style.left = `${x}px`;
          block.style.width = `${Math.max(2, w - 1)}px`;
          block.style.background = st.values.colorMode && st.values.colorMode !== 'single' ? RAINBOW : st.values.color ?? '#888';
          lane.append(block);
          x += w;
        });
        lane.style.width = `${x}px`;
        if (playing) {
          const head = el('span', { class: 'track-head' });
          lane.append(head);
          this.heads.set(t.ch, head);
        }
      }
      const row = el('div', {
        class: t.ch === this.channel ? 'track current' : 'track',
        title: t.ch === this.channel ? 'このチャンネル' : `ch: ${t.ch} に切り替える`,
      }, label, lane);
      if (t.ch !== this.channel) row.addEventListener('click', () => switchChannel(t.ch));
      return row;
    });
    this.root.replaceChildren(...rows);
    this.tick();
  }

  // 再生中のトラックに、今の位置の線を引く
  private tick() {
    for (const t of this.tracks) {
      const head = this.heads.get(t.ch), show = showOf(t);
      if (!head || !show) continue;
      const { at } = playhead(show, (this.serverNow() - t.info.state.startedAt) / 1000);
      head.style.left = `${at * PX_PER_SEC}px`;
    }
  }
}
