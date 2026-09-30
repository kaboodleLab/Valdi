import * as THREE from 'three/webgpu';

// This entry is bundled as an IIFE for Valdi's Hermes runtime. It uses the
// same Dawn device and native Wayland surface as the direct WebGPU probe.
async function render() {
  __webgpuSurfaceStage('bundle running');
  globalThis.self = globalThis;
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.navigator = { gpu: RNWebGPU.gpu, userAgent: 'Valdi Linux' };

  const adapter = await RNWebGPU.gpu.requestAdapter();
  __webgpuSurfaceStage('adapter ready');
  if (!adapter) throw new Error('No Dawn/Vulkan adapter');
  const device = await adapter.requestDevice();
  __webgpuSurfaceStage('device ready');
  const context = RNWebGPU.MakeWebGPUCanvasContext(7, 720, 720);
  const canvas = {
    width: 720, height: 720, style: {},
    addEventListener() {}, removeEventListener() {},
    getContext(kind) {
      if (kind !== 'webgpu') throw new Error(`Unsupported canvas context ${kind}`);
      return context;
    },
  };

  const renderer = new THREE.WebGPURenderer({
    canvas, context, device, antialias: false, alpha: false,
  });
  renderer._getFallback = error => { throw error; };
  renderer.setSize(720, 720, false);
  __webgpuSurfaceStage('renderer initialized');
  const initBackend = renderer.backend.init.bind(renderer.backend);
  renderer.backend.init = async (...args) => {
    __webgpuSurfaceStage('backend.init start');
    try {
      const value = await initBackend(...args);
      __webgpuSurfaceStage('backend.init done');
      return value;
    } catch (error) {
      __webgpuSurfaceStage(`backend.init error: ${String(error?.stack || error)}`);
      throw error;
    }
  };
  await renderer.init();
  __webgpuSurfaceStage('renderer.init complete');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x18243b);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshStandardMaterial({ color: 0xe9b44c, roughness: 0.38 }),
  );
  mesh.rotation.set(0.35, 0.55, 0.1);
  scene.add(mesh);
  const light = new THREE.DirectionalLight(0xffffff, 3);
  light.position.set(2, 4, 5);
  scene.add(light);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.z = 6;

  renderer.render(scene, camera);
  __webgpuSurfaceStage('Three render complete');
  const texture = context.getCurrentTexture();
  const readback = device.createBuffer({
    size: 512, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer(
    { texture, origin: { x: 360, y: 360, z: 0 } },
    { buffer: readback, offset: 0, bytesPerRow: 256 },
    { width: 1, height: 1, depthOrArrayLayers: 1 },
  );
  encoder.copyTextureToBuffer(
    { texture, origin: { x: 32, y: 32, z: 0 } },
    { buffer: readback, offset: 256, bytesPerRow: 256 },
    { width: 1, height: 1, depthOrArrayLayers: 1 },
  );
  device.queue.submit([encoder.finish()]);
  context.present();
  await readback.mapAsync(GPUMapMode.READ);
  const pixels = new Uint8Array(readback.getMappedRange());
  const center = Array.from(pixels.slice(0, 4));
  const corner = Array.from(pixels.slice(256, 260));
  const delta = center.slice(0, 3).reduce((sum, channel, i) => sum + Math.abs(channel - corner[i]), 0);
  readback.unmap();
  __webgpuSurfaceDone(delta > 80 && center[3] === 255,
    `Three.js r${THREE.REVISION} GPU pixels center ${center.join(',')} corner ${corner.join(',')}`);
}

render().catch(error => __webgpuSurfaceDone(false, String(error?.stack || error)));
