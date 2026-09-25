import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// @kmamal/gpu 0.2.0 patches Dawn's Node binding at build time. The surface
// wrapper borrows _wgpuDevice from the renderer, so its GPUTexture must AddRef
// that device. Acquire takes an existing reference and causes a second Release
// when the texture wrapper is collected.
const require = createRequire(import.meta.url);
const packageRoot = dirname(dirname(require.resolve('@kmamal/gpu')));
const packageInfo = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
if (packageInfo.name !== '@kmamal/gpu' || packageInfo.version !== '0.2.0') {
  throw new Error('This ownership fix is only verified against @kmamal/gpu 0.2.0');
}

const patchPath = join(packageRoot, 'dawn.patch');
const patch = await readFile(patchPath, 'utf8');
const borrowedDevice = '+            wgpu::Device::Acquire(_wgpuDevice),';
const retainedDevice = '+            wgpu::Device(_wgpuDevice),';
const count = patch.split(borrowedDevice).length - 1;
if (count === 0 && patch.includes(retainedDevice)) {
  console.log('Dawn surface device reference fix already applied');
} else if (count === 1 && !patch.includes(retainedDevice)) {
  await writeFile(patchPath, patch.replace(borrowedDevice, retainedDevice));
  console.log('Patched @kmamal/gpu 0.2.0 Dawn source for correct device ownership');
} else {
  throw new Error('The Dawn patch changed; inspect its surface texture wrapper');
}
