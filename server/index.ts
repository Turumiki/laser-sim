import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { isShared, sanitize } from '../src/core/params.ts';
import { AssetStore, validateAsset } from './assets.ts';
import { Clocks } from './clock.ts';
import { ShowPlayer } from './show.ts';
import { StateStore } from './state.ts';
import { serveStatic } from './static.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const DEV = process.argv.includes('--dev');
const PORT = Number(process.env.PORT) || 8765;

const states = new StateStore(path.join(ROOT, '.state.json'));
// 以前のバージョンで保存された、型や範囲が合わない値を掃除する
states.rewrite(d => {
  // 試作版（Python）の形式 {v, data: {...}} だったら中身を取り出す
  const inner = d.data && typeof d.data === 'object' ? d.data as Record<string, unknown> : d;
  return sanitize(inner) as Record<string, unknown>;
});

// 全チャンネル共通の設定は、この名前（チャンネル名としては使えない）で持つ
const SHARED = '*';
const split = (d: Record<string, unknown>) => {
  const shared: Record<string, unknown> = {}, own: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) (isShared(k) ? shared : own)[k] = v;
  return { shared, own };
};
// 以前はチャンネルごとに持っていたので、共通の設定は default（なければ最初のチャンネル）から引き継ぐ
if (!states.keys().includes(SHARED)) {
  const from = states.keys().includes('default') ? 'default' : states.keys()[0];
  states.patch(SHARED, from ? split(states.get(from)).shared : {});
}
for (const ch of states.keys()) {
  if (ch !== SHARED) states.replace(ch, split(states.get(ch)).own);
}
// 画面に渡すのは、共通の設定とそのチャンネルの設定を合わせたもの
const merged = (ch: string) => ({ ...states.get(SHARED), ...states.get(ch) });

// チャンネル名は英数字と _ - だけ。オブジェクトの特別な名前（__proto__ など）は使わせない
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
function channelOf(url: URL) {
  const ch = url.searchParams.get('ch') || 'default';
  return /^[A-Za-z0-9_-]{1,40}$/.test(ch) && !RESERVED.has(ch) ? ch : 'default';
}
const assets = new AssetStore(path.join(ROOT, '.assets'));
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

// 使われているチャンネルの一覧（設定があるもの、カスタムのショーがあるもの、いまつながっているもの）
function channelList() {
  const all = new Set([...states.keys(), ...shows.channels(), ...channels.keys()]);
  all.delete(SHARED);
  return [...all].sort();
}

// 対象のチャンネル。channels に名前の配列があればそれだけ、なければ全部
function targetsOf(msg: Record<string, unknown>) {
  if (!Array.isArray(msg.channels)) return channelList();
  return msg.channels.filter((c): c is string => typeof c === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(c) && !RESERVED.has(c));
}

function showCommand(ch: string, msg: Record<string, unknown>) {
  if (msg.action === 'play') {
    // 頭から始めるときは時間軸も頭に揃える（ビートで動くパターンの拍がショーと合う）
    const t0 = Date.now();
    if (shows.play(ch, msg.id, t0)) {
      clocks.reset(ch, merged(ch), t0);
      broadcast(ch, {}, null, true);
    }
  }
  else if (msg.action === 'stop') shows.stop(ch);
  else if (msg.action === 'save') shows.saveCustom(ch, msg.show);
  else if (msg.action === 'playAll') {
    // 全チャンネル（channels の指定があればそれだけ）を同じ瞬間に始め、アニメーションの時間軸も頭に揃える
    const t0 = Date.now();
    for (const c of targetsOf(msg)) {
      if (!shows.play(c, msg.id, t0)) continue;
      clocks.reset(c, merged(c), t0);
      broadcast(c, {}, null, true);
    }
  } else if (msg.action === 'stopAll') {
    for (const c of targetsOf(msg)) shows.stop(c);
  }
}

function broadcast(ch: string, data: Record<string, unknown>, from: string | null, withClock: boolean) {
  const clock = withClock ? clocks.get(ch, merged(ch)) : undefined;
  const msg = JSON.stringify({ type: 'patch', from, data, clock });
  for (const ws of channels.get(ch) ?? []) if (ws.readyState === ws.OPEN) ws.send(msg);
}

function applyPatch(ch: string, data: unknown, from: string | null) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  // 画面側と同じ決まりで型と範囲を揃え、知らないキーは捨てる
  const patch = sanitize(data as Record<string, unknown>) as Record<string, unknown>;
  if (!Object.keys(patch).length) return true;
  const { shared, own } = split(patch);
  if (Object.keys(shared).length) {
    // 共通の設定は全チャンネルに配る（スローなどは各チャンネルの時間軸にも効く）
    const targets = new Set([...channelList(), ch]);
    const timed = new Set<string>();
    for (const t of targets) if (clocks.update(t, merged(t), shared)) timed.add(t);
    states.patch(SHARED, shared);
    for (const t of targets) broadcast(t, shared, from, timed.has(t));
  }
  if (Object.keys(own).length) {
    const timeChanged = clocks.update(ch, merged(ch), own);
    states.patch(ch, own);
    broadcast(ch, own, from, timeChanged);
  }
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

// limit を超えたら途中で打ち切る（素材は大きいことがあるので、そこだけ上限を上げる）
async function readBody(req: IncomingMessage, limit = 1 << 20) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new Error('too large');
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// HTTP API（curlや他のアプリから操作する用）
async function api(req: IncomingMessage, res: ServerResponse, url: URL) {
  const ch = channelOf(url);
  if (url.pathname === '/api/state') {
    if (req.method === 'GET') return json(res, 200, merged(ch));
    if (req.method === 'POST' || req.method === 'PATCH') {
      try {
        if (applyPatch(ch, JSON.parse(await readBody(req)), null)) return json(res, 200, merged(ch));
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
  if (url.pathname === '/api/assets') {
    if (req.method === 'POST') {
      let body: { name?: unknown; data?: unknown };
      try { body = JSON.parse(await readBody(req, 64 << 20)); } catch { return json(res, 400, { error: 'JSONを送ってください（64MBまで）' }); }
      const data = validateAsset(body?.data);
      if (!data) return json(res, 400, { error: '素材の形が正しくありません' });
      return json(res, 200, assets.add(typeof body.name === 'string' ? body.name : '', data));
    }
    return json(res, 200, assets.list());
  }
  const assetMatch = /^\/api\/assets\/([A-Za-z0-9-]{1,40})$/.exec(url.pathname);
  if (assetMatch) {
    const id = assetMatch[1];
    if (req.method === 'DELETE') return json(res, assets.remove(id) ? 200 : 404, { id });
    const raw = assets.raw(id);
    if (!raw) return json(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(raw);
  }
  if (url.pathname === '/api/info') return json(res, 200, { lan: lanUrls(), port: PORT });
  if (url.pathname === '/api/channels') return json(res, 200, channelList());
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
  const ch = channelOf(url);
  wss.handleUpgrade(req, socket, head, ws => {
    const id = randomUUID();
    let set = channels.get(ch);
    if (!set) channels.set(ch, set = new Set());
    set.add(ws);
    ws.send(JSON.stringify({ type: 'hello', id, data: merged(ch), clock: clocks.get(ch, merged(ch)) }));
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
