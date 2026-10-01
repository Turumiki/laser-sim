import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Asset, AssetData, AssetInfo } from '../src/core/assets.ts';

// 読み込んだ素材の置き場。1つ1ファイル（JSON）。一覧は起動時に読んで持っておく
export class AssetStore {
  private dir: string;
  private infos = new Map<string, AssetInfo>();

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const a = JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as Asset;
        this.infos.set(a.id, { id: a.id, name: a.name, kind: a.kind });
      } catch { /* 壊れたファイルは飛ばす */ }
    }
  }

  list(): AssetInfo[] {
    return [...this.infos.values()];
  }

  // ファイルの中身をそのまま返す（大きいことがあるので、読み直して渡す）
  raw(id: string): string | null {
    if (!this.infos.has(id)) return null;
    try { return readFileSync(this.file(id), 'utf8'); } catch { return null; }
  }

  add(name: string, data: AssetData): AssetInfo {
    const id = randomUUID().slice(0, 8);
    const info: AssetInfo = { id, name: name.slice(0, 60) || '素材', kind: data.kind };
    writeFileSync(this.file(id), JSON.stringify({ ...info, data }));
    this.infos.set(id, info);
    return info;
  }

  remove(id: string) {
    if (!this.infos.delete(id)) return false;
    rmSync(this.file(id), { force: true });
    return true;
  }

  private file(id: string) {
    return path.join(this.dir, `${id}.json`);
  }
}

const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const numbers = (v: unknown, max: number) => Array.isArray(v) && v.length <= max && v.every(finite);

// 送られてきた素材の形を確かめる。おかしければ null
export function validateAsset(v: unknown): AssetData | null {
  if (!v || typeof v !== 'object') return null;
  const d = v as Record<string, unknown>;
  if (d.kind === 'vector' && Array.isArray(d.paths) && d.paths.length <= 5000) {
    let total = 0;
    for (const p of d.paths as Record<string, unknown>[]) {
      if (!p || !numbers(p.pts, 200000) || (p.pts as number[]).length % 2 || !numbers(p.rgb, 3) || (p.rgb as number[]).length !== 3) return null;
      total += (p.pts as number[]).length;
    }
    return total <= 400000 ? (d as AssetData) : null;
  }
  if (d.kind === 'ilda' && finite(d.fps) && Array.isArray(d.frames) && d.frames.length <= 20000) {
    for (const f of d.frames as Record<string, unknown>[]) {
      if (!f || !numbers(f.x, 70000) || !numbers(f.y, 70000) || !numbers(f.c, 70000)) return null;
    }
    return d as AssetData;
  }
  return null;
}
