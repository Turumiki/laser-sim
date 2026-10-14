import type { IncomingMessage, ServerResponse } from 'node:http';
import { isValidChannel } from '../src/core/protocol.ts';
import { validateAsset, type AssetStore } from './assets.ts';
import type { Hub } from './hub.ts';

export function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function channelOf(url: URL) {
  const ch = url.searchParams.get('ch');
  return isValidChannel(ch) ? ch : 'default';
}

class TooLarge extends Error {}

// limit を超えたら途中で打ち切る（素材は大きいことがあるので、そこだけ上限を上げる）
async function readBody(req: IncomingMessage, limit = 1 << 20) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new TooLarge();
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// 本文をJSONとして読む。大きすぎれば 413、読めなければ 400 を返して undefined
async function readJson(req: IncomingMessage, res: ServerResponse, limit?: number): Promise<unknown> {
  try {
    return JSON.parse(await readBody(req, limit));
  } catch (e) {
    if (e instanceof TooLarge) json(res, 413, { error: '送られたデータが大きすぎます' });
    else json(res, 400, { error: 'JSONを送ってください' });
    return undefined;
  }
}

const NOT_FOUND = { error: '見つかりません' };

export interface ApiContext {
  hub: Hub;
  assets: AssetStore;
  info: () => unknown;
}

// HTTP API（curlや他のアプリから操作する用）
export async function handleApi({ hub, assets, info }: ApiContext, req: IncomingMessage, res: ServerResponse, url: URL) {
  const ch = channelOf(url);
  switch (url.pathname) {
    case '/api/state': {
      if (req.method === 'POST' || req.method === 'PATCH') {
        const body = await readJson(req, res);
        if (body === undefined) return;
        if (!hub.applyPatch(ch, body, null)) return json(res, 400, { error: 'JSONのオブジェクトを送ってください' });
      }
      return json(res, 200, hub.merged(ch));
    }
    case '/api/show': {
      if (req.method === 'POST') {
        const body = await readJson(req, res);
        if (body === undefined) return;
        if (body && typeof body === 'object') hub.showCommand(ch, body as Record<string, unknown>);
      }
      return json(res, 200, hub.showInfo(ch));
    }
    case '/api/assets': {
      if (req.method === 'POST') {
        const body = await readJson(req, res, 64 << 20) as { name?: unknown; data?: unknown } | null | undefined;
        if (body === undefined) return;
        const data = validateAsset(body?.data);
        if (!data) return json(res, 400, { error: '素材の形が正しくありません' });
        return json(res, 200, assets.add(typeof body?.name === 'string' ? body.name : '', data));
      }
      return json(res, 200, assets.list());
    }
    case '/api/info': return json(res, 200, info());
    case '/api/channels': return json(res, 200, hub.channelList());
  }
  const assetMatch = /^\/api\/assets\/([A-Za-z0-9-]{1,40})$/.exec(url.pathname);
  if (assetMatch) {
    const id = assetMatch[1];
    if (req.method === 'DELETE') return json(res, assets.remove(id) ? 200 : 404, { id });
    const raw = assets.raw(id);
    if (!raw) return json(res, 404, NOT_FOUND);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(raw);
  }
  json(res, 404, NOT_FOUND);
}
