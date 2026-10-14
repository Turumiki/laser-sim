import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BPM_RANGE, clampParam, isShared, sanitize } from '../src/core/params.ts';

test('数値は範囲に収め、数でないものは捨てる', () => {
  assert.deepEqual(sanitize({ size: 9, offY: '-3', angle: 'abc' }), { size: 1.5, offY: -1 });
});

test('選択肢にない値と知らないキーは捨てる', () => {
  assert.deepEqual(sanitize({ mode: 'laser', look: 'source', nope: 1 }), { look: 'source' });
});

test('真偽値はURLの書き方も読む', () => {
  assert.deepEqual(sanitize({ clip: '1', head: 'true', showBlank: 'no' }), { clip: true, head: true, showBlank: false });
});

test('色は #rrggbb だけを小文字にして通す', () => {
  assert.deepEqual(sanitize({ color: '#FF00AA' }), { color: '#ff00aa' });
  assert.deepEqual(sanitize({ color: 'red' }), {});
});

test('BPMはシーケンスと同じ範囲', () => {
  assert.equal(clampParam('bpm', 1000), BPM_RANGE.max);
  assert.equal(clampParam('bpm', 0), BPM_RANGE.min);
});

test('見え方・出力・補助表示は全チャンネル共通', () => {
  assert.equal(isShared('glow'), true);
  assert.equal(isShared('fps'), true);
  assert.equal(isShared('pattern'), false);
  assert.equal(isShared('pps'), false);
});
