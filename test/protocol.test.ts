import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isValidChannel, parseServerMessage } from '../src/core/protocol.ts';

test('チャンネル名は英数字と _ - だけ', () => {
  assert.equal(isValidChannel('arena-l_2'), true);
  assert.equal(isValidChannel(''), false);
  assert.equal(isValidChannel('a b'), false);
  assert.equal(isValidChannel('x'.repeat(41)), false);
  assert.equal(isValidChannel(3), false);
});

test('オブジェクトの特別な名前はチャンネル名に使えない', () => {
  assert.equal(isValidChannel('__proto__'), false);
  assert.equal(isValidChannel('constructor'), false);
});

test('サーバーからのメッセージの形を確かめる', () => {
  assert.equal(parseServerMessage('{broken'), null);
  assert.equal(parseServerMessage('null'), null);
  assert.equal(parseServerMessage('{"type":"patch","data":[1]}'), null);
  assert.equal(parseServerMessage('{"type":"other"}'), null);
  assert.deepEqual(parseServerMessage('{"type":"pong","t":1,"server":2}'), { type: 'pong', t: 1, server: 2 });
});
