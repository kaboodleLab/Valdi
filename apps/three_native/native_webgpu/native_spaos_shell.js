import * as THREE from 'three/webgpu';
import { PROTOCOL_VERSION } from '@spaos/shell-protocol';
import { createNativeText } from './native_shell_hud.js';
import { createNativeSpaosShellProtocol } from './native_spaos_shell_protocol.mjs';

// A first native Space UI. SPAOS remains the compositor and owns all window
// and space operations. This scene only presents its snapshots and requests.
async function run() {
  globalThis.self = globalThis;
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.navigator = { gpu: RNWebGPU.gpu, userAgent: 'Valdi Linux shell' };

  const adapter = await RNWebGPU.gpu.requestAdapter();
  if (!adapter) throw new Error('No Dawn/Vulkan adapter for native shell');
  const device = await adapter.requestDevice();
  let width = 720;
  let height = 720;
  const context = RNWebGPU.MakeWebGPUCanvasContext(7, width, height);
  const canvas = { width, height, style: {}, addEventListener() {}, removeEventListener() {},
    getContext(kind) {
      if (kind !== 'webgpu') throw new Error(`Unsupported canvas context ${kind}`);
      return context;
    } };
  const renderer = new THREE.WebGPURenderer({ canvas, context, device,
    antialias: false, alpha: true });
  renderer._getFallback = error => { throw error; };
  renderer.setSize(width, height, false);
  renderer.toneMapping = THREE.NoToneMapping;
  await renderer.init();
  __webgpuSurfaceStage('Native Space UI Three/WebGPU renderer ready');

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-width / 2, width / 2,
    height / 2, -height / 2, .1, 10);
  camera.position.z = 2;
  camera.lookAt(0, 0, 0);
  scene.add(camera);
  const manifest = JSON.parse(__nativeReadTextAsset('manifest.json'));
  const makeText = createNativeText(THREE, manifest, name => __nativeReadAsset(name));
  const shapes = [];
  const hits = [];
  let state = { output: null, windows: [], spaces: [], ready: false };
  let dirty = true;
  let stopped = false;
  let frame = 0;
  let announced = false;
  let captured = false;

  function clearShapes() {
    for (const mesh of shapes) {
      scene.remove(mesh);
      mesh.material.map?.dispose();
      mesh.material.dispose();
      mesh.geometry.dispose();
    }
    shapes.length = 0;
    hits.length = 0;
  }
  function rectangle(x, y, w, h, color, opacity = 1) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity,
        depthTest: false, depthWrite: false, toneMapped: false }));
    mesh.position.set(x + w / 2 - width / 2, height / 2 - y - h / 2, 0);
    mesh.renderOrder = shapes.length;
    scene.add(mesh);
    shapes.push(mesh);
    return mesh;
  }
  function text(value, x, y, size = 15, color = [236, 240, 247]) {
    const { texture, width: tw, height: th } = makeText(String(value).slice(0, 25), color);
    const w = size * tw / th;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, size),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true,
        depthTest: false, depthWrite: false, toneMapped: false }));
    mesh.position.set(x + w / 2 - width / 2, height / 2 - y - size / 2, .01);
    mesh.renderOrder = shapes.length;
    scene.add(mesh);
    shapes.push(mesh);
    return w;
  }
  function button(x, y, w, label, active, action) {
    rectangle(x, y, w, 42, active ? 0x4f6587 : 0x27374d, .96);
    text(label, x + 12, y + 13, 14);
    hits.push({ x, y, w, h: 42, action });
  }
  function rebuild() {
    clearShapes();
    const y = height - 64;
    rectangle(0, y, width, 64, 0x121a27, .88);
    rectangle(0, y, width, 1, 0x8ba1be, .6);
    button(12, y + 11, 112, 'WORLD', !state.spaces.some(s => s.active),
      () => shell.switchSpace(0));
    let x = 136;
    for (const space of state.spaces.slice(0, 5)) {
      const label = space.name || `SPACE ${space.id}`;
      const w = Math.min(150, Math.max(86, label.length * 10 + 24));
      if (x + w > width - 120) break;
      button(x, y + 11, w, label, !!space.active, () => shell.switchSpace(space.id));
      x += w + 8;
    }
    for (const window of state.windows.slice(0, 5)) {
      const label = window.title || window.app_id || `WINDOW ${window.id}`;
      const w = Math.min(180, Math.max(90, label.length * 8 + 22));
      if (x + w > width - 110) break;
      button(x, y + 11, w, label, !!window.focused, () => shell.focus(window.id));
      x += w + 8;
    }
    const now = new Date();
    text(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      width - 76, y + 23, 15);
    dirty = false;
  }
  function resize(nextWidth, nextHeight) {
    if (!Number.isInteger(nextWidth) || !Number.isInteger(nextHeight) ||
        nextWidth < 1 || nextHeight < 1 || nextWidth > 8192 || nextHeight > 8192 ||
        (nextWidth === width && nextHeight === height)) return;
    width = nextWidth;
    height = nextHeight;
    context.canvas.width = width;
    context.canvas.height = height;
    renderer.setSize(width, height, false);
    camera.left = -width / 2;
    camera.right = width / 2;
    camera.top = height / 2;
    camera.bottom = -height / 2;
    camera.updateProjectionMatrix();
    dirty = true;
    __webgpuSurfaceStage(`Native Space UI resized: ${width}x${height}`);
  }
  const shell = createNativeSpaosShellProtocol({ protocolVersion: PROTOCOL_VERSION,
    send: line => __nativeShellSend(line),
    onState: next => { state = next; dirty = true; if (next.output) resize(next.output.width,
      next.output.height); },
    onQuit: () => { stopped = true; __nativeRequestQuit(); } });
  globalThis.__worldResize = resize;
  globalThis.__worldPointer = (x, y, clicked) => {
    if (!clicked) return;
    for (const hit of hits) {
      if (x >= hit.x && x < hit.x + hit.w && y >= hit.y && y < hit.y + hit.h) {
        hit.action();
        return;
      }
    }
  };
  globalThis.__nativeStop = () => { stopped = true; clearShapes(); renderer.dispose(); };

  async function draw() {
    if (stopped) return;
    const lines = __nativeShellPoll();
    if (lines) {
      if (!state.ready) __webgpuSurfaceStage(`Native Space UI received ${lines.length} shell bytes`);
      shell.ingest(lines);
    }
    if (!__nativeShellConnected()) throw new Error('SPAOS shell channel closed');
    if (dirty || frame % 1800 === 0) rebuild();
    renderer.render(scene, camera);
    if (state.ready && frame >= 30 && !captured && typeof __nativeSaveFrame === 'function') {
      captured = true;
      const texture = context.getCurrentTexture();
      const stride = Math.ceil(width * 4 / 256) * 256;
      const readback = device.createBuffer({ size: stride * height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer({ texture, origin: { x: 0, y: 0, z: 0 } },
        { buffer: readback, bytesPerRow: stride },
        { width, height, depthOrArrayLayers: 1 });
      device.queue.submit([encoder.finish()]);
      context.present();
      await readback.mapAsync(GPUMapMode.READ);
      const pixels = readback.getMappedRange();
      const rgba = new Uint8Array(pixels);
      const centerAlpha = rgba[Math.floor(height / 2) * stride +
        Math.floor(width / 2) * 4 + 3];
      const dockAlpha = rgba[(height - 32) * stride + Math.floor(width / 2) * 4 + 3];
      __nativeSaveFrame(pixels, width, height, stride,
        RNWebGPU.gpu.getPreferredCanvasFormat());
      readback.unmap();
      readback.destroy();
      __webgpuSurfaceStage(`Native Space UI GPU frame captured with ${shapes.length} meshes; alpha ${centerAlpha}/${dockAlpha}`);
    } else {
      context.present();
    }
    ++frame;
    if (frame === 1) __webgpuSurfaceStage('Native Space UI first frame presented');
    if (frame % 120 === 0) __webgpuSurfaceStage(`Native Space UI frames presented: ${frame}, hello ${state.ready}`);
    if (state.ready && !announced && __nativeFrameLimit === 0) {
      announced = true;
      __webgpuSurfaceStage(`Native SPAOS Space UI via Three r${THREE.REVISION}; handshake ready`);
      __webgpuSurfaceDone(true, `Native SPAOS Space UI via Three r${THREE.REVISION}`);
    }
    if (__nativeFrameLimit > 0 && frame >= __nativeFrameLimit) {
      __webgpuSurfaceDone(state.ready, `Native SPAOS Space UI: ${frame} frames, handshake ${state.ready}`);
      return;
    }
    setTimeout(() => draw().catch(error => {
      stopped = true;
      __webgpuSurfaceDone(false, String(error?.stack || error));
      __nativeRequestQuit();
    }), 33);
  }
  await draw();
}

run().catch(error => __webgpuSurfaceDone(false, String(error?.stack || error)));
