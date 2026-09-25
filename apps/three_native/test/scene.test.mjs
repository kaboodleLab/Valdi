import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import sceneModule from '../src/valdi/three_native/src/prepareScene.js';

const { createPlatterScene } = sceneModule;

test('the World OS platter loads in Three and yields animated GPU input', async () => {
  const asset = await readFile(new URL('../src/valdi/three_native/src/ui-platter-base.glb.bin', import.meta.url));
  const scene = await createPlatterScene(asset);
  try {
    assert.equal(scene.vertexCount, 3252);
    assert.equal(scene.vertexBytes.byteLength, scene.vertexCount * 6 * 4);
    const vertices = new Float32Array(scene.vertexBytes.buffer);
    assert.ok(vertices.every(Number.isFinite));

    const first = scene.frame(0);
    const second = scene.frame(1 / 30);
    assert.equal(first.byteLength, 128);
    assert.notDeepEqual(first, second);

    scene.resize(640, 360);
    const wide = scene.frame(0);
    scene.resize(360, 640);
    const tall = scene.frame(0);
    assert.notDeepEqual(wide, tall);
  } finally {
    scene.dispose();
  }
});
