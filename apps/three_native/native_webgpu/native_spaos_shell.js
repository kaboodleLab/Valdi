import * as THREE from 'three/webgpu';
import { PROTOCOL_VERSION } from '@spaos/shell-protocol';
import { createNativeText } from './native_shell_hud.js';
import { createNativeSpaosShellProtocol } from './native_spaos_shell_protocol.mjs';

// SPAOS remains the compositor and owns all window and space operations.
// This scene presents its snapshots and requests in a bounded floating dock.
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
  let drag = null;
  let lastGripClick = 0;

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
  function roundedRectangle(x, y, w, h, radius, color, opacity = 1) {
    const r = Math.min(radius, h / 2, w / 2);
    const shape = new THREE.Shape();
    shape.moveTo(r, 0);
    shape.lineTo(w - r, 0);
    shape.quadraticCurveTo(w, 0, w, r);
    shape.lineTo(w, h - r);
    shape.quadraticCurveTo(w, h, w - r, h);
    shape.lineTo(r, h);
    shape.quadraticCurveTo(0, h, 0, h - r);
    shape.lineTo(0, r);
    shape.quadraticCurveTo(0, 0, r, 0);
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape),
      new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity,
        depthTest: false, depthWrite: false, toneMapped: false }));
    mesh.position.set(x - width / 2, height / 2 - y - h, 0);
    mesh.renderOrder = shapes.length;
    scene.add(mesh);
    shapes.push(mesh);
    return mesh;
  }
  function mark(x, y, radius = 1.4) {
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 8),
      new THREE.MeshBasicMaterial({ color: 0xd9e2ed, transparent: true, opacity: .76,
        depthTest: false, depthWrite: false, toneMapped: false }));
    mesh.position.set(x - width / 2, height / 2 - y, .02);
    mesh.renderOrder = shapes.length;
    scene.add(mesh);
    shapes.push(mesh);
  }
  function closeMark(x, y) {
    for (const angle of [-Math.PI / 4, Math.PI / 4]) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(11, 1.7),
        new THREE.MeshBasicMaterial({ color: 0xe9eef6, transparent: true, opacity: .9,
          depthTest: false, depthWrite: false, toneMapped: false }));
      mesh.position.set(x - width / 2, height / 2 - y, .02);
      mesh.rotation.z = angle;
      mesh.renderOrder = shapes.length;
      scene.add(mesh);
      shapes.push(mesh);
    }
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
  function rebuild() {
    clearShapes();
    const dock = shell.dockLayout();
    if (!dock) return;
    roundedRectangle(dock.x, dock.y, dock.w, dock.h, 24, 0x1e2631, .83);
    for (const button of dock.buttons) {
      const y = dock.y + 8;
      if (button.kind === 'grip') {
        for (const dx of [8, 15]) for (const dy of [15, 23, 31])
          mark(button.x + dx, dock.y + dy);
        continue;
      }
      const focused = button.kind === 'window' &&
        state.windows.some(window => window.id === button.id && window.focused);
      roundedRectangle(button.x, y, button.width, 32, 16,
        focused ? 0x67798e : 0x344356, focused ? .76 : .48);
      text(button.label.slice(0, button.kind === 'world' ? 5 : 14),
        button.x + 11, y + 9, 14);
      if (button.kind === 'world') {
        hits.push({ x: button.x, y, w: button.width, h: 32,
          action: () => shell.switchSpace(0) });
      } else {
        closeMark(button.x + button.width - 14, y + 16);
        hits.push({ x: button.x + button.width - 28, y, w: 28, h: 32,
          action: () => shell.close(button.id) });
        hits.push({ x: button.x, y, w: button.width - 28, h: 32,
          action: () => shell.focus(button.id) });
      }
    }
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
  globalThis.__worldPointer = (x, y, clicked, released) => {
    if (released && drag) {
      if (drag.moved) {
        shell.setDockPosition({ x: x - drag.dx, y: y - drag.dy });
        lastGripClick = 0;
      }
      drag = null;
      dirty = true;
      return;
    }
    if (drag && !clicked) {
      if (Math.hypot(x - drag.startX, y - drag.startY) > 3) drag.moved = true;
      if (drag.moved && shell.setDockPosition({ x: x - drag.dx, y: y - drag.dy }, false))
        dirty = true;
      return;
    }
    if (!clicked) return;
    const dock = shell.dockLayout();
    const grip = dock?.buttons[0];
    if (grip && x >= grip.x && x < grip.x + grip.width &&
        y >= dock.y && y < dock.y + dock.h) {
      const now = performance.now();
      if (now - lastGripClick < 350) shell.setDockPosition(null);
      else drag = { dx: x - dock.x, dy: y - dock.y,
        startX: x, startY: y, moved: false };
      lastGripClick = now;
      dirty = true;
      return;
    }
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
      const dock = shell.dockLayout();
      const dockAlpha = rgba[(dock.y + Math.floor(dock.h / 2)) * stride +
        (dock.x + Math.floor(dock.w / 2)) * 4 + 3];
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
    if (state.ready && !announced) {
      announced = true;
      if (!__nativeShellSend(JSON.stringify({ type: 'lifecycle_ready' })))
        throw new Error('Could not report native Space UI readiness');
      __webgpuSurfaceStage(`Native SPAOS Space UI via Three r${THREE.REVISION}; handshake ready`);
      if (__nativeFrameLimit === 0)
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
    }), drag ? 16 : 33);
  }
  await draw();
}

run().catch(error => __webgpuSurfaceDone(false, String(error?.stack || error)));
