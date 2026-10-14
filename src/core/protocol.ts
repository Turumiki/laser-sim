import type { Show } from './show.ts';

// サーバーと各画面のやり取り（WebSocket の /sync と HTTP の /api/show）で使う形

// チャンネル名は英数字と _ - だけ。オブジェクトの特別な名前（__proto__ など）は使わせない
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
export const isValidChannel = (ch: unknown): ch is string =>
  typeof ch === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(ch) && !RESERVED.has(ch);

export interface Clock {
  // この時刻（サーバーのms）に
  t0: number;
  // アニメーション時間がこの値で
  anim: number;
  // 1秒あたりこれだけ進む
  rate: number;
}

export interface ShowState {
  playing: boolean;
  id: string | null;
  index: number;
  // 再生を始めたサーバーの時刻（ms）
  startedAt: number;
}

export interface ShowInfo {
  state: ShowState;
  custom: Show | null;
}

// サーバー → 画面
export type ServerMessage =
  | { type: 'hello'; id: string; data: Record<string, unknown>; clock: Clock }
  | { type: 'patch'; from: string | null; data: Record<string, unknown>; clock?: Clock }
  | { type: 'pong'; t: number; server: number }
  | ({ type: 'show' } & ShowInfo)
  // 素材のILDAのコマの速さが変わった（全チャンネルに届く）
  | { type: 'assetFps'; id: string; fps: number };

// 届いたメッセージの形を確かめる。中身の値は受け取る側で sanitize する
export function parseServerMessage(raw: string): ServerMessage | null {
  let m: unknown;
  try { m = JSON.parse(raw); } catch { return null; }
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  const isObj = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v);
  switch (o.type) {
    case 'hello': return typeof o.id === 'string' && isObj(o.data) && isObj(o.clock) ? o as ServerMessage : null;
    case 'patch': return isObj(o.data) ? o as ServerMessage : null;
    case 'pong': return typeof o.t === 'number' && typeof o.server === 'number' ? o as ServerMessage : null;
    case 'show': return isObj(o.state) ? o as ServerMessage : null;
    case 'assetFps': return typeof o.id === 'string' && typeof o.fps === 'number' ? o as ServerMessage : null;
  }
  return null;
}
