'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('../public/homography.js');
const { sanitizeWindow, sanitizeState } = require('../server/state.js');

test('homography maps rect corners onto the quad', () => {
  const quad = [[100, 80], [620, 120], [580, 400], [60, 360]];
  const m = H.fromRect(640, 360, quad);
  const src = [[0, 0], [640, 0], [640, 360], [0, 360]];
  src.forEach(([x, y], i) => {
    const [X, Y] = H.apply(m, x, y);
    assert.ok(Math.abs(X - quad[i][0]) < 1e-6 && Math.abs(Y - quad[i][1]) < 1e-6);
  });
});

test('identity-ish quad yields translation only', () => {
  const m = H.fromRect(100, 50, [[10, 20], [110, 20], [110, 70], [10, 70]]);
  const [X, Y] = H.apply(m, 50, 25);
  assert.ok(Math.abs(X - 60) < 1e-9 && Math.abs(Y - 45) < 1e-9);
});

test('degenerate quad returns none', () => {
  assert.strictEqual(H.matrix3d(100, 100, [[0, 0], [0, 0], [0, 0], [0, 0]]), 'none');
});

test('sanitizeWindow clamps and defaults', () => {
  const w = sanitizeWindow({ id: 'x', volume: 9, rate: 'abc', fit: 'bogus', quad: [[1, 2]] });
  assert.strictEqual(w.volume, 1);
  assert.strictEqual(w.rate, 1);
  assert.strictEqual(w.fit, 'cover');
  assert.strictEqual(w.quad.length, 4);
});

test('sanitizeState tolerates garbage', () => {
  const s = sanitizeState({ canvas: { w: 'x' }, windows: 5 });
  assert.deepStrictEqual(s.windows, []);
  assert.strictEqual(s.canvas.w, 1920);
});

test('scenes capture playback but not geometry, and apply by id or name', () => {
  const { captureScene, applyScene, findScene, sanitizeState, defaultWindow } = require('../server/state.js');
  const a = { ...defaultWindow(1), id: 'a', playlist: ['x.mp4'] };
  let st = sanitizeState({ windows: [a] });
  const sc = captureScene(st, 'Spooky', 's1');
  assert.ok(!('quad' in sc.windows.a) && !('name' in sc.windows.a));
  st.scenes = [sc];
  // change playlist + geometry, then apply the scene
  st.windows[0] = { ...st.windows[0], playlist: ['y.mp4'], quad: [[0, 0], [9, 0], [9, 9], [0, 9]] };
  const out = applyScene(st, findScene(st, 'spooky'));
  assert.deepStrictEqual(out[0].playlist, ['x.mp4']);
  assert.deepStrictEqual(out[0].quad, [[0, 0], [9, 0], [9, 9], [0, 9]]);
  assert.strictEqual(findScene(st, 's1').name, 'Spooky');
});
