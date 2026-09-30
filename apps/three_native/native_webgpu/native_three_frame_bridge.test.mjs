import assert from 'node:assert/strict';
import test from 'node:test';
import { installNativeThreeFrameBridge } from './native_three_frame_bridge.mjs';

test('native draws advance Three callbacks once and defer the next request', () => {
  const target = {};
  const advance = installNativeThreeFrameBridge(target);
  const seen = [];
  target.requestAnimationFrame(time => {
    seen.push(['first', time]);
    target.requestAnimationFrame(nextTime => seen.push(['next', nextTime]));
  });
  const cancelled = target.requestAnimationFrame(() => seen.push(['cancelled']));
  target.cancelAnimationFrame(cancelled);

  advance(10);
  assert.deepEqual(seen, [['first', 10]]);
  advance(20);
  assert.deepEqual(seen, [['first', 10], ['next', 20]]);
  advance(30);
  assert.equal(seen.length, 2);
});
