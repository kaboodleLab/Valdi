import { readFileSync, writeFileSync } from 'node:fs';
import { create, globals } from 'webgpu';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

Object.assign(globalThis, globals);
globalThis.self = { requestAnimationFrame() { return 0; }, cancelAnimationFrame() {} };
const gpu = create(['backend=vulkan']);
Object.defineProperty(globalThis, 'navigator', {
  value: { gpu, userAgent: 'NativeLinux' }, configurable: true,
});

const size = 256;
const stream = process.argv.includes('--stream');
let device;
let currentTexture;
let textureFormat;
const context = {
  configure(config) {
    device = config.device;
    textureFormat = config.format;
    if (stream && textureFormat !== 'bgra8unorm') {
      throw new Error(`SDL viewer expects bgra8unorm, got ${textureFormat}`);
    }
    currentTexture = device.createTexture({
      size: [size, size],
      format: textureFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
  },
  getCurrentTexture() { return currentTexture; },
  unconfigure() { currentTexture?.destroy(); },
};
const canvas = {
  width: size, height: size, style: {},
  addEventListener() {}, removeEventListener() {},
  getContext(kind) { if (kind !== 'webgpu') throw new Error(kind); return context; },
};

const adapter = await gpu.requestAdapter();
if (!adapter) throw new Error('No Vulkan WebGPU adapter');
console.error('Dawn Vulkan adapter:', adapter.info.vendor, adapter.info.device);
device = await adapter.requestDevice();

const renderer = new THREE.WebGPURenderer({ canvas, context, device, antialias: false, alpha: false });
renderer.setSize(size, size, false);
await renderer.init();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101827);
const asset = readFileSync(new URL('../src/valdi/three_native/src/ui-platter-base.glb.bin', import.meta.url));
const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(
  asset.buffer.slice(asset.byteOffset, asset.byteOffset + asset.byteLength), '', resolve, reject));
const model = gltf.scene;
const bounds = new THREE.Box3().setFromObject(model);
const extent = bounds.getSize(new THREE.Vector3());
model.position.sub(bounds.getCenter(new THREE.Vector3()));
model.scale.setScalar(1.5 / Math.max(extent.x, extent.y, extent.z));
model.rotation.set(-0.55, 0.5, 0);
scene.add(model);
scene.add(new THREE.AmbientLight(0xffffff, 1.2));
const light = new THREE.DirectionalLight(0xffffff, 2.5);
light.position.set(-2, 3, 4);
scene.add(light);
const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 10);
camera.position.z = 3;

const rowBytes = size * 4;
const readback = device.createBuffer({ size: rowBytes * size,
  usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
process.stdout.on('error', () => process.exit(0));

async function renderFrame(angle) {
  model.rotation.y = angle;
  renderer.render(scene, camera);
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer({ texture: currentTexture },
    { buffer: readback, bytesPerRow: rowBytes }, [size, size]);
  device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const bytes = Buffer.from(new Uint8Array(readback.getMappedRange()));
  readback.unmap();
  return bytes;
}

if (stream) {
  let frame = 0;
  while (true) {
    const bytes = await renderFrame(frame++ * 0.025);
    if (!process.stdout.write(bytes)) await new Promise(resolve => process.stdout.once('drain', resolve));
    await new Promise(resolve => setTimeout(resolve, 33));
  }
} else {
  const bytes = await renderFrame(0.5);
  const rgb = Buffer.alloc(size * size * 3);
  const bgra = textureFormat.startsWith('bgra');
  for (let index = 0; index < size * size; index++) {
    rgb[index * 3] = bytes[index * 4 + (bgra ? 2 : 0)];
    rgb[index * 3 + 1] = bytes[index * 4 + 1];
    rgb[index * 3 + 2] = bytes[index * 4 + (bgra ? 0 : 2)];
  }
  const path = 'linux-dawn-platter.ppm';
  writeFileSync(path, Buffer.concat([Buffer.from(`P6\n${size} ${size}\n255\n`), rgb]));
  console.error(`Rendered ${path} with Three.js ${THREE.REVISION}, ${textureFormat}`);
  readback.destroy();
  renderer.dispose();
  currentTexture.destroy();
  process.exit(0);
}
