import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { channelOf } from './api.ts';
import type { Hub } from './hub.ts';

// 各画面との同期（WebSocket の /sync）
export function attachSync(server: Server, hub: Hub) {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    // それ以外（ViteのHMR）は Vite 側が受け持つ
    if (url.pathname !== '/sync') return;
    const ch = channelOf(url);
    wss.handleUpgrade(req, socket, head, ws => {
      const id = randomUUID();
      hub.join(ch, ws);
      ws.send(JSON.stringify({ type: 'hello', id, data: hub.merged(ch), clock: hub.clock(ch) }));
      ws.send(JSON.stringify({ type: 'show', ...hub.showInfo(ch) }));
      ws.on('message', raw => {
        // 壊れたメッセージは無視する（1つの画面のせいでサーバーが落ちないように）
        try {
          const m = JSON.parse(String(raw)) as unknown;
          if (!m || typeof m !== 'object') return;
          const msg = m as Record<string, unknown>;
          if (msg.type === 'patch') hub.applyPatch(ch, msg.data, id);
          else if (msg.type === 'show') hub.showCommand(ch, msg);
          // 各画面がサーバーとの時計のずれを測る用
          else if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong', t: msg.t, server: Date.now() }));
        } catch { /* 上のとおり */ }
      });
    });
  });
}
