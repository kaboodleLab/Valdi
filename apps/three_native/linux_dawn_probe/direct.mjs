import { readFileSync } from 'node:fs';
import dawn from '@kmamal/gpu';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// SDL owns an X11 window (Xwayland in a GNOME Wayland session). Dawn renders
// directly into its swapchain, without a per-frame CPU readback or upload.
// @kmamal/gpu 0.2.0's SDL interop assumes Xlib handles, so select X11 before
// SDL initializes even when this process inherits a Wayland desktop session.
process.env.SDL_VIDEODRIVER = 'x11';
const sdl = (await import('@kmamal/sdl')).default;
Object.assign(globalThis, dawn);
globalThis.self = {
  requestAnimationFrame(callback) { return setTimeout(() => callback(performance.now()), 16); },
  cancelAnimationFrame(handle) { clearTimeout(handle); },
};
const gpu = dawn.create(['backend=vulkan']);
Object.defineProperty(globalThis, 'navigator', {
  value: { gpu, userAgent: 'NativeLinux' }, configurable: true,
});

const width = 720;
const height = 720;
const window = sdl.video.createWindow({
  title: 'WorldOS native Three.js + Dawn/Vulkan',
  width, height, resizable: true, webgpu: true,
});
let renderer;
let device;
let surface;
let sceneState;
const heldSurfaceTextures = [];
let stopped = false;
let frame = 0;
let yaw = 0;
let dragging = false;
let lastX = 0;
const maxFramesArg = process.argv.find(arg => arg.startsWith('--frames='));
// Until this pinned addon releases surface textures safely, end the demo
// after a bounded session instead of retaining their wrappers indefinitely.
const maxFrames = maxFramesArg ? Number(maxFramesArg.slice(9)) : 36000;
if (!Number.isSafeInteger(maxFrames) || maxFrames <= 0) {
  throw new Error('--frames must be a positive integer');
}
const worldScene = process.argv.includes('--world-scene');
const worldGlass = process.argv.includes('--world-glass') || worldScene;
const readbackTest = process.argv.includes('--readback-test');

function stop(code = 0) {
  if (stopped) return;
  stopped = true;
  sceneState?.dispose();
  renderer?.dispose();
  device?.destroy();
  dawn.destroy(gpu);
  if (!window.destroyed) window.destroy();
  process.exit(code);
}

window.on('close', () => stop());
window.on('keyDown', event => { if (event.key === 'Escape' || event.scancode === 41) stop(); });
window.on('mouseButtonDown', event => {
  dragging = true; lastX = event.x;
  sceneState?.pointer(event.x, event.y);
  sceneState?.click(frame);
});
window.on('mouseButtonUp', () => { dragging = false; });
window.on('mouseMove', event => {
  if (dragging) { yaw += (event.x - lastX) * 0.01; lastX = event.x; }
  else sceneState?.pointer(event.x, event.y);
});

try {
  const adapter = await gpu.requestAdapter();
  if (!adapter) throw new Error('No Dawn/Vulkan adapter');
  console.log('Dawn adapter:', adapter.info.vendor, adapter.info.device);
  device = await adapter.requestDevice();
  // The 0.2.0 Node binding rejects Three's onuncapturederror assignment.
  // Shadow its accessor until the runtime uses the current Dawn binding.
  Object.defineProperty(device, 'onuncapturederror', {
    value: null, writable: true, configurable: true,
  });
  surface = dawn.renderGPUDeviceToWindow({ device, window, presentMode: 'fifo' });
  const format = surface.getPreferredFormat();
  gpu.getPreferredCanvasFormat = () => format;
  console.log('Direct GPU swapchain format:', format);
  const context = {
    configure(config) {
      if (config.device !== device || config.format !== format) {
        throw new Error(`Unexpected canvas configuration: ${config.format}`);
      }
    },
    getCurrentTexture() {
      // The 0.2.0 addon wraps an acquired swapchain texture without retaining
      // it. Keep wrappers alive until exit to avoid its premature finalizer.
      const texture = surface.getCurrentTexture();
      heldSurfaceTextures.push(texture);
      return texture;
    },
    unconfigure() {},
  };
  const canvas = {
    width: window.pixelWidth, height: window.pixelHeight, style: {},
    addEventListener() {}, removeEventListener() {},
    getContext(kind) { if (kind !== 'webgpu') throw new Error(kind); return context; },
  };
  renderer = new THREE.WebGPURenderer({ canvas, context, device, antialias: false, alpha: false });
  renderer._getFallback = error => { throw error; };
  renderer.setSize(canvas.width, canvas.height, false);
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
  if (worldGlass) {
    // Material values from WorldOS engine/15-banner-and-calculator.js. Its
    // glass uses Three's transmission render pass and mipmapped refraction.
    const platterMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xf7f5f2, transmission: 0.80, roughness: 0.42,
      metalness: 0, thickness: 0.09, ior: 1.44,
      attenuationDistance: 0.55, clearcoat: 1,
      clearcoatRoughness: 0.10, envMapIntensity: 1,
      transparent: true, opacity: 1,
    });
    model.traverse(object => {
      if (object.isMesh) object.material = platterMaterial;
    });

    if (!worldScene) {
      // A small texture-backed stage makes the refraction visible and exercises
      // typed-array upload without requiring a DOM canvas/image decoder.
      const pixels = new Uint8Array(64 * 64 * 4);
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        const index = (y * 64 + x) * 4;
        const bright = ((x >> 3) + (y >> 3)) % 2 === 0;
        pixels[index] = bright ? 235 : 25;
        pixels[index + 1] = bright ? 160 : 65;
        pixels[index + 2] = bright ? 75 : 145;
        pixels[index + 3] = 255;
      }
      const backdrop = new THREE.DataTexture(pixels, 64, 64);
      backdrop.colorSpace = THREE.SRGBColorSpace;
      backdrop.needsUpdate = true;
      const stage = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.8),
        new THREE.MeshBasicMaterial({ map: backdrop, toneMapped: false }));
      stage.position.z = -0.4;
      scene.add(stage);
    }
  }
  scene.add(model);
  scene.add(new THREE.AmbientLight(0xffffff, 1.2));
  const light = new THREE.DirectionalLight(0xffffff, 2.5);
  light.position.set(-2, 3, 4);
  scene.add(light);
  let camera;
  if (worldScene) {
    const { createWorldScene } = await import('./world_scene.mjs');
    sceneState = await createWorldScene({
      THREE, scene, renderer, model, width: canvas.width, height: canvas.height,
    });
    camera = sceneState.camera;
  } else {
    camera = new THREE.PerspectiveCamera(48, canvas.width / canvas.height, 0.1, 10);
    camera.position.z = 3;
  }

  window.on('resize', event => {
    if (!surface || stopped || !event.pixelWidth || !event.pixelHeight) return;
    surface.resize();
    canvas.width = event.pixelWidth;
    canvas.height = event.pixelHeight;
    renderer.setSize(canvas.width, canvas.height, false);
    if (sceneState) sceneState.resize(canvas.width, canvas.height);
    else { camera.aspect = canvas.width / canvas.height; camera.updateProjectionMatrix(); }
  });

  if (readbackTest) {
    const target = new THREE.RenderTarget(32, 32, {
      type: THREE.UnsignedByteType, format: THREE.RGBAFormat,
    });
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    const bytes = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 32, 32);
    const stride = Math.ceil(32 * 4 / 256) * 256;
    if (!(bytes instanceof Uint8Array) || bytes.length !== 31 * stride + 32 * 4) {
      throw new Error('WorldOS-style RGBA8 readback failed');
    }
    const redValues = new Set();
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      redValues.add(bytes[y * stride + x * 4]);
    }
    if (redValues.size < 2) throw new Error('WorldOS-style readback is a flat image');
    console.log('One targeted WorldOS-style render-target readback:',
      bytes.length, 'bytes;', redValues.size, 'distinct red values');
    target.dispose();
  }

  function draw() {
    if (stopped) return;
    if (sceneState) sceneState.tick(frame, yaw);
    else model.rotation.y = frame * 0.012 + yaw;
    renderer.render(scene, camera);
    surface.swap();
    frame += 1;
    if (frame >= maxFrames) { console.log(`Presented ${frame} direct frames`); stop(); return; }
    setTimeout(draw, 16);
  }
  draw();
} catch (error) {
  console.error(error);
  stop(1);
}
