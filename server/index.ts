import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { handleApi, json } from './api.ts';
import { AssetStore } from './assets.ts';
import { Hub } from './hub.ts';
import { serveStatic } from './static.ts';
import { attachSync } from './sync.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const DEV = process.argv.includes('--dev');
const PORT = Number(process.env.PORT) || 8765;

const hub = new Hub(path.join(ROOT, '.state.json'), path.join(ROOT, '.shows.json'));
const assets = new AssetStore(path.join(ROOT, '.assets'));

function lanUrls() {
  return Object.values(networkInterfaces()).flat()
    .filter(a => a?.family === 'IPv4' && !a.internal)
    .map(a => `http://${a?.address}:${PORT}`);
}

const server = createServer();
let vite: import('vite').ViteDevServer | null = null;
if (DEV) {
  const { createServer: createVite } = await import('vite');
  vite = await createVite({
    root: ROOT,
    appType: 'mpa',
    server: { middlewareMode: true, hmr: { server } },
  });
}

const api = { hub, assets, info: () => ({ lan: lanUrls(), port: PORT }) };
server.on('request', (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    handleApi(api, req, res, url).catch(() => json(res, 500, { error: 'サーバーの中でエラーが起きました' }));
    return;
  }
  if (vite) vite.middlewares(req, res);
  else serveStatic(path.join(ROOT, 'dist'), url.pathname, res);
});
attachSync(server, hub);

// すでに起動しているときなどは、英語の長いエラーではなく、何が起きたかだけを出す
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`ポート ${PORT} はほかで使われています。すでに起動している場合は、http://localhost:${PORT}/ を開けばそのまま使えます。`);
    console.error('別のポートで起動する場合は、環境変数 PORT で指定してください（例: PORT=8766）。');
  } else {
    console.error(`起動できませんでした: ${e.message}`);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`ILDA Laser Sim ${DEV ? '(dev)' : ''}`);
  console.log(`  操作画面   http://localhost:${PORT}/`);
  console.log(`  OBS用出力  http://localhost:${PORT}/output.html`);
  console.log(`  3Dビューア http://localhost:${PORT}/viewer.html`);
  for (const u of lanUrls()) console.log(`  LAN        ${u}/`);
});

const shutdown = () => { hub.flush(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
