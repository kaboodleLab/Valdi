import assert from 'node:assert/strict';
import test from 'node:test';
import { beginReturnFromFloor } from './native_world_return.mjs';

test('dock return tracks the previous preview until a newer one is ready', () => {
  const previews = new Map([[1, 2]]);
  const cards = new Map([[1, { generation: 3 }]]);
  const pending = beginReturnFromFloor(1, null,
    [{ id: 1, active: false, lingering: true }], previews, cards);
  assert.deepEqual(pending, { id: 1, generation: 3 });
  assert.equal(beginReturnFromFloor(1, pending, [], previews, cards), pending);
});

test('ordinary floor changes do not start a return', () => {
  const empty = new Map();
  assert.equal(beginReturnFromFloor(1, null,
    [{ id: 1, active: false, lingering: false }], empty, empty), null);
  assert.equal(beginReturnFromFloor(1, null,
    [{ id: 1, active: true, lingering: false }], empty, empty), null);
});
