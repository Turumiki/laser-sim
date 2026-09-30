import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import type { ServerResponse } from 'node:http';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

export function serveStatic(root: string, pathname: string, res: ServerResponse) {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    // 壊れた % 表記のURL。例外で落ちないよう、ここで断る
    res.writeHead(400).end();
    return;
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(root, path.normalize(rel));
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if (!statSync(file).isFile()) throw new Error();
  } catch {
    const missing = pathname === '/' || pathname.endsWith('.html');
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(missing ? 'ビルドされていません。npm run build を実行してください。' : 'not found');
    return;
  }
  const ext = path.extname(file);
  // assets/ 以下はファイル名にハッシュが付くので長くキャッシュしてよい
  const cache = rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { 'Content-Type': TYPES[ext] ?? 'application/octet-stream', 'Cache-Control': cache });
  createReadStream(file).pipe(res);
}
