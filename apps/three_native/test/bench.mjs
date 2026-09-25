import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import sceneModule from '../src/valdi/three_native/src/prepareScene.js';

const { createPlatterScene } = sceneModule;

const asset = await readFile(new URL('../src/valdi/three_native/src/ui-platter-base.glb.bin', import.meta.url));
const loadTimes = [];
const frameTimes = [];
for (let trial = 0; trial < 10; trial++) {
  const loadStart = performance.now();
  const scene = await createPlatterScene(asset);
  loadTimes.push(performance.now() - loadStart);
  for (let frame = 0; frame < 600; frame++) {
    const frameStart = performance.now();
    scene.frame(1 / 30);
    if (trial > 0) frameTimes.push(performance.now() - frameStart);
  }
  scene.dispose();
}
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
console.log(JSON.stringify({
  host: process.platform,
  modelLoadMedianMs: median(loadTimes),
  transformMedianMs: median(frameTimes),
  transformP95Ms: [...frameTimes].sort((a, b) => a - b)[Math.floor(frameTimes.length * 0.95)],
  meshUploadBytes: 78048,
  transformBytesPerFrame: 128,
}, null, 2));
