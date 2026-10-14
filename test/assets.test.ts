import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateAsset } from '../server/assets.ts';

const path = { pts: [0, 0, 1, 1], rgb: [255, 0, 0], closed: false };

test('線の素材', () => {
  assert.ok(validateAsset({ kind: 'vector', paths: [path] }));
  // 座標が奇数個、色が3つでない、closed がない
  assert.equal(validateAsset({ kind: 'vector', paths: [{ ...path, pts: [0, 0, 1] }] }), null);
  assert.equal(validateAsset({ kind: 'vector', paths: [{ ...path, rgb: [1, 2] }] }), null);
  assert.equal(validateAsset({ kind: 'vector', paths: [{ pts: path.pts, rgb: path.rgb }] }), null);
});

test('ILDAの素材は1点ごとに x・y・色が揃っていること', () => {
  const frame = { x: [0, 1], y: [0, 1], c: [0xff0000, -1] };
  assert.ok(validateAsset({ kind: 'ilda', fps: 30, frames: [frame] }));
  assert.equal(validateAsset({ kind: 'ilda', fps: 30, frames: [{ ...frame, y: [0] }] }), null);
  assert.equal(validateAsset({ kind: 'ilda', fps: 30, frames: [{ ...frame, c: [0, Number.NaN] }] }), null);
});

test('知らない種類は null', () => {
  assert.equal(validateAsset({ kind: 'image' }), null);
  assert.equal(validateAsset('x'), null);
});

test('ILDAのコマの速さは 1〜120fps', () => {
  const frames = [{ x: [0], y: [0], c: [0] }];
  assert.ok(validateAsset({ kind: 'ilda', fps: 15, frames }));
  assert.equal(validateAsset({ kind: 'ilda', fps: 0, frames }), null);
  assert.equal(validateAsset({ kind: 'ilda', fps: 500, frames }), null);
});
