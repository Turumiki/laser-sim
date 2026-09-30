import { locate, type Show } from '../src/core/show.ts';
import { BUILTIN_SHOWS } from '../src/core/shows.ts';
import { StateStore } from './state.ts';

export interface ShowState {
  playing: boolean;
  id: string | null;
  index: number;
  // 再生を始めたサーバーの時刻（ms）
  startedAt: number;
}

// ショーの再生はサーバーで行う。全部の画面が同じ瞬間に切り替わり、操作画面を閉じても続く
export class ShowPlayer {
  private custom: StateStore;
  private states = new Map<string, ShowState>();
  private apply: (ch: string, values: Record<string, unknown>) => void;
  private notify: (ch: string) => void;

  constructor(file: string, apply: ShowPlayer['apply'], notify: ShowPlayer['notify']) {
    this.custom = new StateStore(file);
    this.apply = apply;
    this.notify = notify;
    setInterval(() => this.tick(), 10).unref();
  }

  state(ch: string): ShowState {
    return this.states.get(ch) ?? { playing: false, id: null, index: -1, startedAt: 0 };
  }

  channels(): string[] {
    return this.custom.keys();
  }

  customOf(ch: string): Show | null {
    return (this.custom.get(ch).show as Show | undefined) ?? null;
  }

  private find(ch: string, id: string | null): Show | null {
    if (id === 'custom') return this.customOf(ch);
    return BUILTIN_SHOWS.find(s => s.id === id) ?? null;
  }

  // startedAt を揃えて渡すと、複数のチャンネルが同じ瞬間に切り替わる
  play(ch: string, id: unknown, startedAt = Date.now()) {
    if (typeof id !== 'string' || !this.find(ch, id)) return false;
    this.states.set(ch, { playing: true, id, index: -1, startedAt });
    this.tick();
    return true;
  }

  stop(ch: string) {
    const st = this.states.get(ch);
    if (!st?.playing) return;
    st.playing = false;
    this.notify(ch);
  }

  saveCustom(ch: string, input: unknown) {
    const show = validate(input);
    if (!show) return;
    this.custom.patch(ch, { show });
    this.notify(ch);
  }

  flush() {
    this.custom.flush();
  }

  private tick() {
    for (const [ch, st] of this.states) {
      if (!st.playing) continue;
      const show = this.find(ch, st.id);
      const pos = show && locate(show, (Date.now() - st.startedAt) / 1000);
      if (!show || !pos) {
        st.playing = false;
        this.notify(ch);
        continue;
      }
      if (pos.index !== st.index) {
        st.index = pos.index;
        this.apply(ch, show.steps[pos.index].values as Record<string, unknown>);
        this.notify(ch);
      }
    }
  }
}

// 外から来たショーの形を確かめる（中身の値は各画面の sanitize で揃える）
function validate(v: unknown): Show | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.steps) || o.steps.length > 500) return null;
  const steps = o.steps
    .filter((s): s is { beats: unknown; values: unknown } => !!s && typeof s === 'object')
    .map(s => ({
      beats: Math.min(256, Math.max(0.25, Number(s.beats) || 4)),
      values: s.values && typeof s.values === 'object' ? s.values as Record<string, unknown> : {},
    }));
  return {
    id: 'custom',
    name: typeof o.name === 'string' ? o.name.slice(0, 60) : 'カスタム',
    bpm: Math.min(300, Math.max(20, Number(o.bpm) || 120)),
    loop: o.loop !== false,
    steps,
  };
}
