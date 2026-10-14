import { readFileSync, renameSync, writeFileSync } from 'node:fs';

type Data = Record<string, unknown>;

// チャンネルごとの設定。変更はまとめて1秒ごとにファイルへ書く
export class StateStore {
  private data: Record<string, Data> = {};
  private dirty = false;
  private file: string;

  constructor(file: string) {
    this.file = file;
    try {
      const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
      // チャンネルごとにオブジェクトのものだけを使う（手で書き換えたり壊れたりしたファイルでも起動できるように）
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [ch, d] of Object.entries(raw)) {
          if (d && typeof d === 'object' && !Array.isArray(d)) this.data[ch] = d as Data;
        }
      }
    } catch { /* 無いか壊れていれば空から始める */ }
    setInterval(() => this.flush(), 1000).unref();
  }

  // 全チャンネルの中身を作り直す（読み込んだ古いデータの掃除用）
  rewrite(fn: (d: Data) => Data) {
    for (const ch of Object.keys(this.data)) this.data[ch] = fn(this.data[ch]);
    this.dirty = true;
  }

  keys(): string[] {
    return Object.keys(this.data);
  }

  get(ch: string): Data {
    return this.data[ch] ?? {};
  }

  replace(ch: string, data: Data) {
    this.data[ch] = data;
    this.dirty = true;
  }

  patch(ch: string, patch: Data) {
    this.data[ch] = { ...this.data[ch], ...patch };
    this.dirty = true;
  }

  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.file);
  }
}
