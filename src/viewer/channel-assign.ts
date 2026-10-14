import { el } from '../browser/dom';

// 台ごとのチャンネルを選ぶ欄。選択肢はサーバーで使われているチャンネルの一覧
export class ChannelAssign {
  readonly root = el('div', { class: 'assign' });
  private known: string[] = [];

  // names: 今の割り当て（台の順） / onChange: i 台目を ch にした
  constructor(private names: () => string[], private onChange: (i: number, ch: string) => void) {
    // 触ろうとしたとき（開く前）と、ときどき一覧を取り直す
    this.root.addEventListener('pointerenter', () => this.refresh());
    setInterval(() => this.refresh(), 10000);
    this.refresh();
  }

  render() {
    const names = this.names();
    const head = el('div', { class: 'assign-head', title: '左の台から順。出力や操作画面と同じチャンネル名のものが連動する' }, '台ごとのチャンネル');
    const rows = names.map((name, i) => {
      const sel = el('select');
      this.fill(sel, names);
      sel.value = name;
      sel.addEventListener('change', () => this.onChange(i, sel.value));
      return el('label', { class: 'wide' }, `${i + 1}台目`, sel);
    });
    this.root.replaceChildren(head, ...rows);
  }

  private refresh() {
    fetch('/api/channels').then(r => r.json()).then((list: unknown) => {
      if (!Array.isArray(list)) return;
      this.known = list.filter((c): c is string => typeof c === 'string');
      const names = this.names();
      for (const sel of this.root.querySelectorAll('select')) {
        if (document.activeElement !== sel) this.fill(sel, names);
      }
    }).catch(() => { /* サーバーにつながらないときは、今の選択肢のまま */ });
  }

  // 一覧を取り直しても欄は作り直さず、選択肢だけ入れ替える（開いている選択肢が閉じないように）
  private fill(sel: HTMLSelectElement, names: string[]) {
    const want = [...new Set([...this.known, ...names])];
    const have = [...sel.options].map(o => o.value);
    if (want.join() === have.join()) return;
    const value = sel.value;
    sel.replaceChildren(...want.map(c => new Option(c, c)));
    sel.value = value;
  }
}
