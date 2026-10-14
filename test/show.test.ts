import assert from 'node:assert/strict';
import { test } from 'node:test';
import { locate, showLength, type Show } from '../src/core/show.ts';
import { validate } from '../server/show.ts';

// 120BPM なので1拍0.5秒。4拍（2秒）+ 2拍（1秒）
const show = (loop: boolean): Show => ({
  id: 'custom', name: 't', bpm: 120, loop,
  steps: [{ beats: 4, values: {} }, { beats: 2, values: {} }],
});

test('ショーの長さは拍数とBPMから出す', () => {
  assert.equal(showLength(show(true)), 3);
});

test('再生位置からステップを探す', () => {
  assert.deepEqual(locate(show(false), 0), { index: 0, start: 0 });
  assert.deepEqual(locate(show(false), 2.5), { index: 1, start: 2 });
});

test('ループするショーは頭に戻り、しないショーは終わったら null', () => {
  assert.deepEqual(locate(show(true), 3.5), { index: 0, start: 0 });
  assert.equal(locate(show(false), 3), null);
});

test('ステップがないショーは null', () => {
  assert.equal(locate({ ...show(true), steps: [] }, 0), null);
});

test('送られてきたショーの範囲を揃える', () => {
  const v = validate({ name: 'x'.repeat(100), bpm: 999, steps: [{ beats: 0, values: { pattern: 'star' } }, null, 'x'] });
  assert.ok(v);
  assert.equal(v.name.length, 60);
  assert.equal(v.bpm, 300);
  // beats: 0 は既定の4拍、壊れたステップは捨てる
  assert.deepEqual(v.steps, [{ beats: 4, values: { pattern: 'star' } }]);
});

test('ショーの形でなければ null', () => {
  assert.equal(validate(null), null);
  assert.equal(validate({ steps: 'no' }), null);
  assert.equal(validate({ steps: new Array(501).fill({ beats: 1, values: {} }) }), null);
});
