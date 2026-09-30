import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { sanitize } from '../src/core/params.ts';
import { Clocks } from './clock.ts';
import { ShowPlayer } from './show.ts';
import { StateStore } from './state.ts';
import { serveStatic } from './static.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const DEV = process.argv.includes('--dev');
const PORT = Number(process.env.PORT) || 8765;

const states = new StateStore(path.join(ROOT, '.state.json'));
// 以前のバージョンで保存された、型や範囲が合わない値を掃除する
states.rewrite(d => sanitize(d) as Record<string, unknown>);
const channels = new Map<string, Set<WebSocket>>();
const clocks = new Clocks();
const shows = new ShowPlayer(path.join(ROOT, '.shows.json'), (ch, values) => applyPatch(ch, values, null), broadcastShow);

function showMessage(ch: string) {
  return JSON.stringify({ type: 'show', state: shows.state(ch), custom: shows.customOf(ch) });
}

function broadcastShow(ch: string) {
  const msg = showMessage(ch);
  for (const ws of channels.get(ch) ?? []) if (ws.readyState === ws.OPEN) ws.send(msg);
}

function showCommand(ch: string, msg: Record<string, unknown>) {
  if (msg.action === 'play') shows.play(ch, msg.id);
  else if (msg.action === 'stop') shows.stop(ch);
  else if (msg.action === 'save') shows.saveCustom(ch, msg.show);
}

function broadcast(ch: string, data: Record<string, unknown>, from: string | null, withClock: boolean) {
  const clock = withClock ? clocks.get(ch, states.get(ch)) : undefined;
  const msg = JSON.stringify({ type: 'patch', from, data, clock });
  for (const ws of channels.get(ch) ?? []) if (ws.readyState === ws.OPEN) ws.send(msg);
}

function applyPatch(ch: string, data: unknown, from: string | null) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  // 画面側と同じ決まりで型と範囲を揃え、知らないキーは捨てる
  const patch = sanitize(data as Record<string, unknown>) as Record<string, unknown>;
  if (!Object.keys(patch).length) return true;
  const timeChanged = clocks.update(ch, states.get(ch), patch);
  states.patch(ch, patch);
  broadcast(ch, patch, from, timeChanged);
  return true;
}

function lanUrls() {
  return Object.values(networkInterfaces()).flat()
    .filter(a => a && a.family === 'IPv4' && !a.internal)
    .map(a => `http://${a!.address}:${PORT}`);
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

// HTTP API（curlや他のアプリから操作する用）
async function api(req: IncomingMessage, res: ServerResponse, url: URL) {
  const ch = url.searchParams.get('ch') || 'default';
  if (url.pathname === '/api/state') {
    if (req.method === 'GET') return json(res, 200, states.get(ch));
    if (req.method === 'POST' || req.method === 'PATCH') {
      try {
        if (applyPatch(ch, JSON.parse(await readBody(req)), null)) return json(res, 200, states.get(ch));
      } catch { /* 下で400を返す */ }
      return json(res, 400, { error: 'JSONのオブジェクトを送ってください' });
    }
  }
  if (url.pathname === '/api/show') {
    if (req.method === 'POST') {
      try { showCommand(ch, JSON.parse(await readBody(req))); } catch { return json(res, 400, { error: 'JSONを送ってください' }); }
    }
    return json(res, 200, { state: shows.state(ch), custom: shows.customOf(ch) });
  }
  if (url.pathname === '/api/info') return json(res, 200, { lan: lanUrls(), port: PORT });
  json(res, 404, { error: 'not found' });
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

server.on('request', (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    api(req, res, url).catch(() => json(res, 500, { error: 'internal error' }));
    return;
  }
  if (vite) vite.middlewares(req, res);
  else serveStatic(path.join(ROOT, 'dist'), url.pathname, res);
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  // それ以外（ViteのHMR）は Vite 側が受け持つ
  if (url.pathname !== '/sync') return;
  const ch = url.searchParams.get('ch') || 'default';
  wss.handleUpgrade(req, socket, head, ws => {
    const id = randomUUID();
    let set = channels.get(ch);
    if (!set) channels.set(ch, set = new Set());
    set.add(ws);
    ws.send(JSON.stringify({ type: 'hello', id, data: states.get(ch), clock: clocks.get(ch, states.get(ch)) }));
    ws.send(showMessage(ch));
    ws.on('message', raw => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg?.type === 'patch') applyPatch(ch, msg.data, id);
        if (msg?.type === 'show') showCommand(ch, msg);
        // 各画面がサーバーとの時計のずれを測る用
        if (msg?.type === 'ping') ws.send(JSON.stringify({ type: 'pong', t: msg.t, server: Date.now() }));
      } catch { /* 壊れたメッセージは無視 */ }
    });
    ws.on('close', () => set.delete(ws));
  });
});

server.listen(PORT, () => {
  console.log(`ILDA Laser Sim ${DEV ? '(dev)' : ''}`);
  console.log(`  操作画面   http://localhost:${PORT}/`);
  console.log(`  OBS用出力  http://localhost:${PORT}/output.html`);
  for (const u of lanUrls()) console.log(`  LAN        ${u}/`);
});

const shutdown = () => { states.flush(); shows.flush(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
