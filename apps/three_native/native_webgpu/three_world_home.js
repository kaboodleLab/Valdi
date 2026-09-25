import * as THREE from 'three/webgpu';
import * as tsl from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createNativeGridScene } from '@worldos/native-grid-scene';

function nativeIconLoader(name, manifest) {
  const loader = new GLTFLoader();
  loader.register(parser => ({
    name: 'EXT_texture_webp',
    async loadTexture(index) {
      const definition = parser.json.textures[index];
      const sourceIndex = definition.source ?? definition.extensions?.EXT_texture_webp?.source;
      const image = manifest[name].images[sourceIndex];
      if (!image) return null;
      const pixels = new Uint8Array(__nativeReadAsset(image.file));
      const texture = new THREE.DataTexture(pixels, image.width, image.height, THREE.RGBAFormat);
      texture.flipY = false;
      texture.needsUpdate = true;
      const sampler = parser.json.samplers?.[definition.sampler] ?? {};
      texture.magFilter = sampler.magFilter === 9728 ? THREE.NearestFilter : THREE.LinearFilter;
      texture.minFilter = {
        9728: THREE.NearestFilter, 9729: THREE.LinearFilter,
        9984: THREE.NearestMipmapNearestFilter, 9985: THREE.LinearMipmapNearestFilter,
        9986: THREE.NearestMipmapLinearFilter, 9987: THREE.LinearMipmapLinearFilter,
      }[sampler.minFilter] ?? THREE.LinearMipmapLinearFilter;
      texture.wrapS = sampler.wrapS === 33071 ? THREE.ClampToEdgeWrapping :
        sampler.wrapS === 33648 ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
      texture.wrapT = sampler.wrapT === 33071 ? THREE.ClampToEdgeWrapping :
        sampler.wrapT === 33648 ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
      return texture;
    },
  }));
  return loader;
}

// Bundle with the WorldOS native-grid-scene.js factory as an esbuild alias.
// This is the real WorldOS grid material and tile geometry, hosted by Valdi.
async function render() {
  globalThis.self = globalThis;
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.navigator = { gpu: RNWebGPU.gpu, userAgent: 'Valdi Linux' };
  if (typeof globalThis.AbortController === 'undefined') {
    globalThis.AbortController = class {
      constructor() {
        this.signal = { aborted: false, addEventListener() {}, removeEventListener() {} };
      }
      abort() { this.signal.aborted = true; }
    };
  }

  const adapter = await RNWebGPU.gpu.requestAdapter();
  if (!adapter) throw new Error('No Dawn/Vulkan adapter');
  const device = await adapter.requestDevice();
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
  await renderer.init();
  __webgpuSurfaceStage('Three/WebGPU renderer ready');

  const scene = new THREE.Scene();
  const worldGrid = createNativeGridScene({ THREE, nodes: THREE, tsl });
  const { core, uniforms, material, tileGeometry } = worldGrid;
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), material);
  grid.rotation.x = -Math.PI / 2;
  grid.position.y = -.002;
  scene.add(grid);
  renderer.toneMapping = THREE.NoToneMapping;
  scene.background = core.COL_BG;
  scene.add(new THREE.AmbientLight(0xffffff, 1.2));
  const light = new THREE.DirectionalLight(0xffffff, 2.5);
  light.position.set(-2, 3, 4);
  scene.add(light);

  const camera = new THREE.OrthographicCamera(-5.8, 5.8, 5.8, -5.8, .1, 100);
  const center = new THREE.Vector3(-1.5, 0, -2.2);
  camera.position.copy(center).add(new THREE.Vector3(5.3, 7.2, 8.1));
  camera.lookAt(center);
  uniforms.uCamPos.value.copy(camera.position);
  uniforms.uFlatK.value = 0;
  uniforms.uTiles3D.value = 1;
  uniforms.uNight.value = .78;
  uniforms.uSunLum.value = .38;
  uniforms.uSunAmt.value = .7;
  uniforms.uSunTintA.value.setRGB(.48, .57, .81);
  uniforms.uSunTintB.value.setRGB(.72, .53, .77);

  const tileMaterial = new THREE.MeshPhysicalMaterial({
    color: core.COL_GRID_FILL.clone(), roughness: core.TILE.ROUGH,
    metalness: 0, clearcoat: core.TILE.CLEARCOAT, vertexColors: true,
  });
  const homeIcons = [
    { name: 'weather', x: -4, z: -2 },
    { name: 'calendar', x: -1, z: -5 },
    { name: 'mail', x: 0, z: -5 },
    { name: 'notes', x: -4, z: -1 },
    { name: 'whatsapp', x: 0, z: -4 },
    { name: 'browser', x: -2, z: 0 },
    { name: 'files', x: 1, z: -1, size: .68 },
  ];
  for (const [x, z] of [...homeIcons.map(({ x, z }) => [x, z]), [1, 0]]) {
    const tile = new THREE.Mesh(tileGeometry, tileMaterial);
    tile.position.set(x, 0, z);
    scene.add(tile);
  }
  __webgpuSurfaceStage('WorldOS grid and home tiles ready');

  const manifest = JSON.parse(__nativeReadTextAsset('manifest.json'));
  for (const { name, x, z, size = .55 } of homeIcons) {
    const glb = __nativeReadAsset(`${name}.glb`);
    const loader = nativeIconLoader(name, manifest);
    const gltf = await new Promise((resolve, reject) => loader.parse(glb, '', resolve, reject));
    const icon = gltf.scene;
    const bounds = new THREE.Box3().setFromObject(icon);
    const extent = bounds.getSize(new THREE.Vector3());
    icon.scale.setScalar(size / Math.max(extent.x, extent.y, extent.z));
    const fitted = new THREE.Box3().setFromObject(icon);
    const iconCenter = fitted.getCenter(new THREE.Vector3());
    icon.position.set(x - iconCenter.x, core.TILE.H + .015 - fitted.min.y, z - iconCenter.z);
    scene.add(icon);
    __webgpuSurfaceStage(`WorldOS icon loaded: ${name}`);
  }

  // Profile and placement from WorldOS engine/04-home-and-occupancy.js. The
  // production jar uses live-scene refraction; this native slice uses Three's
  // physical transmission until that shader's scene texture path is ported.
  const jarProfile = [
    [0, .020], [.110, .014], [.190, .022], [.228, .044],
    [.240, .095], [.240, .330], [.238, .475], [.231, .515],
    [.247, .545], [.252, .572], [.247, .596], [.233, .605],
    [.219, .597], [.214, .560], [.214, .125], [.192, .066],
    [.100, .054], [0, .056],
  ];
  const jar = new THREE.Mesh(
    new THREE.LatheGeometry(jarProfile.map(([r, y]) => new THREE.Vector2(r, y)), 96),
    new THREE.MeshPhysicalMaterial({
      color: 0xf0f8f8, side: THREE.DoubleSide, transmission: .9,
      roughness: .09, metalness: 0, thickness: .045, ior: 1.46,
      clearcoat: 1, clearcoatRoughness: .05, transparent: true,
      opacity: .5, depthWrite: false,
    }),
  );
  jar.position.set(1, core.TILE.H + .16, 0);
  jar.rotation.z = THREE.MathUtils.degToRad(11);
  scene.add(jar);
  __webgpuSurfaceStage('WorldOS jar profile ready');

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const hit = new THREE.Vector3();
  const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), .002);
  let frame = 0;
  let stopped = false;
  let waveX = 0, waveZ = 0, waveStart = 0;
  globalThis.__nativeStop = () => { stopped = true; };
  globalThis.__worldPointer = (x, y, clicked) => {
    pointerNdc.set(x / 720 * 2 - 1, 1 - y / 720 * 2);
    raycaster.setFromCamera(pointerNdc, camera);
    if (raycaster.ray.intersectPlane(floor, hit)) {
      const cx = Math.round(hit.x), cz = Math.round(hit.z);
      uniforms.uHoverCell.value.set(cx, cz);
      uniforms.uHasHover.value = 1;
      if (clicked) { waveX = cx; waveZ = cz; waveStart = frame; }
    }
  };

  async function draw() {
    if (stopped) return;
    uniforms.uWave.value.set(waveX, waveZ,
      ((frame - waveStart) * .018 * 1.4) % 9.7, .46);
    uniforms.uWaveK.value.set(.42, .1, 1.25, 0);
    jar.rotation.y = frame * .004;
    renderer.render(scene, camera);
    let pixel = null;
    if (frame === 0) {
      const texture = context.getCurrentTexture();
      const stride = Math.ceil(720 * 4 / 256) * 256;
      const readback = device.createBuffer({
        size: stride * 720, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer(
        { texture, origin: { x: 0, y: 0, z: 0 } },
        { buffer: readback, bytesPerRow: stride },
        { width: 720, height: 720, depthOrArrayLayers: 1 },
      );
      device.queue.submit([encoder.finish()]);
      context.present();
      await readback.mapAsync(GPUMapMode.READ);
      const mapped = readback.getMappedRange();
      if (typeof __nativeSaveFrame === 'function') {
        __nativeSaveFrame(mapped, 720, 720, stride, RNWebGPU.gpu.getPreferredCanvasFormat());
      }
      const offset = 360 * stride + 360 * 4;
      pixel = Array.from(new Uint8Array(mapped).slice(offset, offset + 4));
      readback.unmap();
      readback.destroy();
    } else {
      context.present();
    }
    frame++;
    if (frame === 1 && __nativeFrameLimit === 0) {
      __webgpuSurfaceDone(pixel[3] === 255,
        `WorldOS home via Three r${THREE.REVISION}; center GPU pixel ${pixel.join(',')}`);
    }
    if (__nativeFrameLimit > 0 && frame >= __nativeFrameLimit) {
      __webgpuSurfaceDone(frame > 1 || pixel[3] === 255,
        `WorldOS home via Three r${THREE.REVISION}; ${frame} frames` +
        (pixel ? `; center GPU pixel ${pixel.join(',')}` : ''));
      return;
    }
    if (frame % 120 === 0) __webgpuSurfaceStage(`WorldOS frames presented: ${frame}`);
    setTimeout(() => draw().catch(error => {
      stopped = true;
      __webgpuSurfaceDone(false, String(error?.stack || error));
    }), 16);
  }

  await draw();
}

render().catch(error => __webgpuSurfaceDone(false, String(error?.stack || error)));
