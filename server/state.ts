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
      this.data = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      this.data = {};
    }
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
