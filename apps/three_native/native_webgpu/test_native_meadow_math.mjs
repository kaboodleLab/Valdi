import assert from 'node:assert/strict';
import test from 'node:test';
import { meadowHill, meadowMemoryLowland, meadowNoise, meadowRoom,
  meadowSeed } from './native_meadow_math.mjs';

test('native meadow keeps tile footprints clear and a lowland around the jar', () => {
  const occupied = new Set(['1,0']);
  assert.equal(meadowRoom(1, 0, occupied), 0);
  assert.equal(meadowRoom(1.5, 0, occupied), 0);
  assert.equal(meadowRoom(2.2, 0, occupied), 1);
  assert.equal(meadowMemoryLowland(1, 0), 0);
  assert.equal(meadowMemoryLowland(7, 0), 1);
});

test('authored field samples are deterministic and bounded', () => {
  for (const [x, z] of [[0, 0], [-4.25, 7.5], [11, -3]]) {
    assert.ok(meadowHill(x, z) >= .035 * 1.6);
    assert.ok(meadowHill(x, z) <= .755 * 1.6);
    assert.ok(meadowSeed(x, z) >= 0 && meadowSeed(x, z) < 1);
    assert.ok(meadowNoise(x, z) >= 0 && meadowNoise(x, z) <= 1);
  }
});
