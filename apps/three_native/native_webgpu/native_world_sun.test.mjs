import assert from 'node:assert/strict';
import test from 'node:test';
import { worldSunGrade } from './native_world_sun.mjs';

test('WorldOS clock crosses night, dawn, noon and dusk continuously', () => {
  const night = worldSunGrade(0);
  const dawn = worldSunGrade(6);
  const noon = worldSunGrade(13.25);
  const dusk = worldSunGrade(20.5);
  assert.equal(night.moon, true);
  assert.equal(night.night, 1);
  assert.equal(dawn.moon, false);
  assert.equal(dawn.lum, dusk.lum);
  assert.deepEqual(dawn.tintA, dusk.tintA);
  assert.equal(noon.elevation, 1);
  assert.equal(noon.lum, 1.06);
  assert.equal(noon.night, 0);
  assert.equal(noon.split, 0);
  assert.ok(noon.tintB[0] > night.tintB[0]);
});

test('clock wraps and the sun footprint follows the camera-relative arc', () => {
  assert.deepEqual(worldSunGrade(-1), worldSunGrade(23));
  assert.deepEqual(worldSunGrade(25), worldSunGrade(1));
  const dawn = worldSunGrade(6, 0, 10);
  assert.deepEqual(dawn.direction, [-1, 0]);
  assert.ok(dawn.sunGrid[0] < 0);
  assert.equal(dawn.sunGrid[1], 0);
  assert.ok(dawn.split > 0);
});
