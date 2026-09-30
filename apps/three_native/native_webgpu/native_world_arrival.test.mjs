import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeArrivalReveal } from './native_world_arrival.mjs';

test('native World reveals only after an active space has a mapped window', () => {
  const update = createNativeArrivalReveal();
  const calls = [];
  const reveal = id => { calls.push(id); return true; };
  assert.equal(update([{ id: 1, active: true, windows: 0 }], reveal), null);
  assert.equal(update([{ id: 1, active: true, windows: 1 }], reveal), 1);
  assert.equal(update([{ id: 1, active: true, windows: 1 }], reveal), null);
  assert.deepEqual(calls, [1]);
  assert.equal(update([{ id: 1, active: false, windows: 1 }], reveal), null);
  assert.equal(update([{ id: 1, active: true, windows: 1 }], reveal), 1);
  assert.deepEqual(calls, [1, 1]);
});

test('native World retries a failed send and rejects incomplete floor rows', () => {
  const update = createNativeArrivalReveal();
  assert.equal(update([{ id: 2, active: true, windows: 1 }], () => false), null);
  assert.equal(update([{ id: 2, active: true, windows: 1 }], () => true), 2);
  assert.equal(update([{ id: -1, active: true, windows: 1 }], () => true), null);
  assert.equal(update([{ id: 3, active: true }], () => true), null);
});
