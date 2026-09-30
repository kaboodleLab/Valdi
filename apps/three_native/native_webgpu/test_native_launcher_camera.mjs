import assert from 'node:assert/strict';
import test from 'node:test';
import { launcherCameraPose } from './native_launcher_camera.mjs';

const base = {
  position: { x: 7, y: 8, z: 9 },
  target: { x: 1, y: .35, z: 2 },
  zoom: 1,
};
const tile = { x: 3, y: .97, z: -2 };

test('launcher camera starts at the captured Home view and ends over the chosen cell', () => {
  const start = launcherCameraPose(base, tile, 0, -Math.PI / 4);
  assert.deepEqual(start.target, base.target);
  for (const axis of ['x', 'y', 'z'])
    assert.ok(Math.abs(start.position[axis] - base.position[axis]) < 1e-12);
  assert.equal(start.zoom, 1);

  const end = launcherCameraPose(base, tile, 1, -Math.PI / 4);
  assert.deepEqual(end.target, { x: 3, y: .97, z: -2 });
  assert.equal(end.zoom, .95);
  assert.ok(Math.abs(Math.hypot(
    end.position.x - end.target.x,
    end.position.y - end.target.y,
    end.position.z - end.target.z,
  ) - Math.hypot(6, 7.65, 7)) < 1e-12);
});

test('launcher camera clamps spring overshoot and reverses without changing its base', () => {
  const half = launcherCameraPose(base, tile, .5, -Math.PI / 4);
  assert.equal(half.target.x, 2);
  assert.equal(half.target.z, 0);
  assert.deepEqual(launcherCameraPose(base, tile, 1.02, -Math.PI / 4),
    launcherCameraPose(base, tile, 1, -Math.PI / 4));
  assert.deepEqual(launcherCameraPose(base, tile, -.02, -Math.PI / 4),
    launcherCameraPose(base, tile, 0, -Math.PI / 4));
});
