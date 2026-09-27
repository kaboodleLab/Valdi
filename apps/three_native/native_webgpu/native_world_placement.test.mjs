import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseLaunchTile } from './native_world_placement.mjs';

test('a free tile chosen on the floor is the app destination', () => {
  assert.deepEqual(chooseLaunchTile({ x: -7, z: 4 }, new Set(), { x: 0, z: 0 }),
    { x: -7, z: 4 });
});

test('an occupied selection is rechecked when an app is picked', () => {
  const occupied = new Set(['-7,4', '2,0']);
  assert.deepEqual(chooseLaunchTile({ x: -7, z: 4 }, occupied, { x: 0, z: 0 }),
    { x: 1, z: -1 });
});

test('the launcher button uses nearby free ground and never an occupied tile', () => {
  assert.deepEqual(chooseLaunchTile(null, new Set(['2,0']), { x: 0, z: 0 }),
    { x: 1, z: -1 });
});

test('placement refuses invalid and exhausted coordinates', () => {
  assert.equal(chooseLaunchTile({ x: 10001, z: 0 }, new Set(),
    { x: 10000, z: 10000 }, 0), null);
});
