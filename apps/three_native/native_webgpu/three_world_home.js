import * as THREE from 'three/webgpu';
import * as tsl from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createNativeGridScene } from '@worldos/native-grid-scene';
import { createNativeShellHud } from './native_shell_hud.js';

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
  let surfaceWidth = 720;
  let surfaceHeight = 720;
  const context = RNWebGPU.MakeWebGPUCanvasContext(7, surfaceWidth, surfaceHeight);
  const canvas = {
    width: surfaceWidth, height: surfaceHeight, style: {},
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
  renderer.setSize(surfaceWidth, surfaceHeight, false);
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

  const liveShell = typeof __nativeReadShellState === 'function' ||
    typeof __nativeReadShellFloor === 'function';
  const extent = liveShell ? 3.8 : 5.8;
  const camera = new THREE.OrthographicCamera(-extent, extent, extent, -extent, .1, 100);
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
  const tileByName = new Map();
  for (const { name, x, z } of [...homeIcons, { name: 'jar', x: 1, z: 0 }]) {
    const tile = new THREE.Mesh(tileGeometry, tileMaterial);
    tile.position.set(x, 0, z);
    scene.add(tile);
    tileByName.set(name, tile);
  }
  __webgpuSurfaceStage('WorldOS grid and home tiles ready');

  const manifest = JSON.parse(__nativeReadTextAsset('manifest.json'));
  const iconByName = new Map();
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
    const offset = new THREE.Vector3(-iconCenter.x, core.TILE.H + .015 - fitted.min.y,
      -iconCenter.z);
    icon.position.set(x + offset.x, offset.y, z + offset.z);
    scene.add(icon);
    iconByName.set(name, { icon, offset });
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

  const layoutKey = {
    weather: 'weathersun', calendar: 'calendar', mail: 'mail',
    notes: 'ib:notes', whatsapp: 'ib:whatsapp', browser: 'ib:browser',
    files: 'stack',
  };
  const extraByName = new Map();
  const cardBySpace = new Map();
  const floorTileBySpace = new Map();
  const nativeApps = new Map();
  let spaceAtCell = new Map();
  let appAtCell = new Map();
  let occupiedCells = new Set();
  let activeSpace = null;
  let previewGenerationBySpace = new Map();
  let returningSpace = null;
  let seenRevision = null;
  let seenFloorRevision = null;
  let seenCatalogSignature = null;
  let pendingPreview = false;
  const hud = createNativeShellHud({ THREE, scene, camera, manifest,
    readAsset: name => __nativeReadAsset(name),
    stage: message => __webgpuSurfaceStage(message),
    onBack: () => globalThis.__worldBack(),
    onOpen: key => {
      if (typeof __nativeWorldOpen !== 'function' || !nativeApps.has(key)) return;
      const baseX = Math.round(center.x) + 2;
      const baseZ = Math.round(center.z);
      for (let radius = 0; radius < 10; ++radius) {
        for (let dz = -radius; dz <= radius; ++dz) {
          for (let dx = -radius; dx <= radius; ++dx) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
            const x = baseX + dx;
            const z = baseZ + dz;
            if (occupiedCells.has(`${x},${z}`)) continue;
            if (__nativeWorldOpen(key, x, z))
              __webgpuSurfaceStage(`WorldOS launcher asked SPAOS to open ${key} at (${x},${z})`);
            return;
          }
        }
      }
    },
  });
  hud.resize(surfaceWidth, surfaceHeight, extent);
  function isCell(value) {
    return Array.isArray(value) && value.length === 2 &&
      Number.isInteger(value[0]) && Number.isInteger(value[1]);
  }
  function pollWorldChannel() {
    if (typeof __nativeWorldPoll !== 'function') return;
    const incoming = __nativeWorldPoll();
    if (!incoming) return;
    for (const line of incoming.split('\n')) {
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message.type === 'apps' && Array.isArray(message.apps)) {
        const signature = JSON.stringify(message.apps.map(app => [
          app.key, app.name, app.hidden, app.world, app.icon,
        ]));
        if (signature === seenCatalogSignature) continue;
        seenCatalogSignature = signature;
        nativeApps.clear();
        for (const app of message.apps) {
          if (typeof app?.key === 'string' && !app.hidden) nativeApps.set(app.key, app);
        }
        hud.setApps([...nativeApps.values()]);
        __webgpuSurfaceStage(`WorldOS app catalog received: ${nativeApps.size} visible apps`);
      }
    }
  }
  function applyLiveState() {
    if (!liveShell) return;
    let state = { layout: {}, props: [] };
    let floor = null;
    let floorRevision = null;
    try {
      if (typeof __nativeReadShellState === 'function') {
        state = JSON.parse(__nativeReadShellState());
      }
      if (typeof __nativeReadShellFloor === 'function') {
        const raw = __nativeReadShellFloor();
        floor = JSON.parse(raw);
        floorRevision = floor.rev ?? floor.revision ?? raw;
      }
    }
    catch (error) {
      __webgpuSurfaceStage(`WorldOS state or floor read failed: ${String(error)}`);
      return;
    }
    if (state.rev === seenRevision && floorRevision === seenFloorRevision && !pendingPreview) return;
    const layout = state.layout || {};
    const props = Array.isArray(state.props) ? state.props : [];
    const spaces = Array.isArray(floor?.spaces) ? floor.spaces :
      (Array.isArray(floor) ? floor : []);
    const positions = new Map();
    const addPosition = (name, cell) => {
      const cells = positions.get(name) || [];
      if (!cells.some(existing => existing[0] === cell[0] && existing[1] === cell[1])) {
        cells.push(cell);
        positions.set(name, cells);
      }
    };
    for (const item of homeIcons) {
      const cell = layout[layoutKey[item.name]];
      if (isCell(cell)) addPosition(item.name, cell);
    }
    // Saved SPAOS rows are the person's app placement, even in a fresh
    // compositor before that app has a window. A live preview replaces the
    // icon once the floor reports a window at the same tile.
    for (const prop of props) {
      if (prop?.kind !== 'spaos' || typeof prop.app !== 'string') continue;
      const app = prop.app.split('.').pop().toLowerCase();
      if (iconByName.has(app) && Number.isInteger(prop.tx) && Number.isInteger(prop.tz)) {
        addPosition(app, [prop.tx, prop.tz]);
      }
    }
    for (const space of spaces) {
      if (!Number.isInteger(space?.at?.x) || !Number.isInteger(space?.at?.z)) continue;
      const app = String(space.apps?.[0] || space.pending || '').split('.').pop().toLowerCase();
      if (iconByName.has(app)) addPosition(app, [space.at.x, space.at.z]);
    }
    const cardCells = new Set();
    const currentSpaces = new Set();
    const nextSpaceAtCell = new Map();
    const nextAppAtCell = new Map();
    const nextPreviewGenerationBySpace = new Map();
    const nextOccupiedCells = new Set();
    for (const cell of Object.values(layout)) {
      if (isCell(cell)) nextOccupiedCells.add(`${cell[0]},${cell[1]}`);
    }
    for (const prop of props) {
      if (Number.isInteger(prop?.tx) && Number.isInteger(prop?.tz))
        nextOccupiedCells.add(`${prop.tx},${prop.tz}`);
    }
    activeSpace = null;
    pendingPreview = false;
    for (const space of spaces) {
      if (!Number.isInteger(space?.id) || space.id < 1 ||
          !Number.isInteger(space?.at?.x) || !Number.isInteger(space?.at?.z)) continue;
      currentSpaces.add(space.id);
      if (space.active) activeSpace = space.id;
      nextPreviewGenerationBySpace.set(space.id, space.preview_generation || 0);
      const cellKey = `${space.at.x},${space.at.z}`;
      nextOccupiedCells.add(cellKey);
      nextSpaceAtCell.set(cellKey, space.id);
      const shot = Array.isArray(space.previews) ? space.previews.find(p =>
        Number.isInteger(p?.window) && p.window > 0 &&
        Number.isInteger(p?.generation) && p.generation > 0 &&
        Number.isInteger(p?.width) && p.width > 0 && p.width <= 4096 &&
        Number.isInteger(p?.height) && p.height > 0 && p.height <= 4096) : null;
      let card = cardBySpace.get(space.id);
      if (shot && typeof __nativeReadShellPreview === 'function' &&
          (!card || card.generation !== shot.generation || card.window !== shot.window)) {
        try {
          const pixels = new Uint8Array(__nativeReadShellPreview(
            space.id, shot.window, shot.width, shot.height));
          const texture = new THREE.DataTexture(pixels, shot.width, shot.height, THREE.RGBAFormat);
          texture.flipY = false;
          texture.needsUpdate = true;
          if (!card) {
            const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
              new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true,
                depthWrite: false, toneMapped: false }));
            scene.add(mesh);
            card = { mesh, generation: 0, window: 0, width: shot.width, height: shot.height };
            cardBySpace.set(space.id, card);
          } else {
            card.mesh.material.map?.dispose();
          }
          card.mesh.material.map = texture;
          card.mesh.material.needsUpdate = true;
          card.generation = shot.generation;
          card.window = shot.window;
          card.width = shot.width;
          card.height = shot.height;
          __webgpuSurfaceStage(`WorldOS preview updated: space ${space.id}, generation ${shot.generation}`);
        } catch (error) {
          pendingPreview = true;
          __webgpuSurfaceStage(`WorldOS preview pending: space ${space.id}: ${String(error)}`);
        }
      }
      if (card && shot) {
        const ratio = card.width / card.height;
        const width = ratio > 1.55 ? .62 : .40 * ratio;
        const height = ratio > 1.55 ? .62 / ratio : .40;
        card.mesh.scale.set(width, height, 1);
        card.mesh.position.set(space.at.x, core.TILE.H + .12 + height / 2, space.at.z);
        card.mesh.visible = true;
        cardCells.add(cellKey);
      } else if (card) {
        card.mesh.visible = false;
      }
      if (returningSpace?.id === space.id && !space.active &&
          card?.generation > returningSpace.generation &&
          typeof __nativeWorldRelease === 'function' &&
          __nativeWorldRelease(space.id)) {
        __webgpuSurfaceStage(`WorldOS released space ${space.id} after preview update`);
        returningSpace = null;
      }
      let floorTile = floorTileBySpace.get(space.id);
      if (!floorTile) {
        floorTile = new THREE.Mesh(tileGeometry, tileMaterial);
        scene.add(floorTile);
        floorTileBySpace.set(space.id, floorTile);
      }
      floorTile.position.set(space.at.x, 0, space.at.z);
      const jarAtCell = isCell(layout.jar) && layout.jar[0] === space.at.x &&
        layout.jar[1] === space.at.z;
      floorTile.visible = !jarAtCell && ![...positions.values()].some(cells =>
        cells.some(cell => cell[0] === space.at.x && cell[1] === space.at.z));
    }
    for (const [id, card] of cardBySpace) {
      if (!currentSpaces.has(id)) card.mesh.visible = false;
    }
    for (const [id, tile] of floorTileBySpace) {
      if (!currentSpaces.has(id)) tile.visible = false;
    }
    for (const { name } of homeIcons) {
      const cells = positions.get(name) || [];
      for (const cell of cells) nextAppAtCell.set(`${cell[0]},${cell[1]}`, name);
      const { icon, offset } = iconByName.get(name);
      const tile = tileByName.get(name);
      const extras = extraByName.get(name) || [];
      for (let index = extras.length + 1; index < cells.length; ++index) {
        const extra = { icon: icon.clone(true), tile: new THREE.Mesh(tileGeometry, tileMaterial) };
        scene.add(extra.icon, extra.tile);
        extras.push(extra);
      }
      extraByName.set(name, extras);
      for (let index = 0; index <= extras.length; ++index) {
        const target = index === 0 ? { icon, tile } : extras[index - 1];
        const cell = cells[index];
        target.icon.visible = !!cell && !cardCells.has(`${cell[0]},${cell[1]}`);
        target.tile.visible = !!cell;
        if (cell) {
          target.tile.position.set(cell[0], 0, cell[1]);
          target.icon.position.set(cell[0] + offset.x, offset.y, cell[1] + offset.z);
        }
      }
    }
    const jarCell = isCell(layout.jar) ? layout.jar :
      (props.find(p => p?.kind === 'jar' && Number.isInteger(p.tx) &&
        Number.isInteger(p.tz)) || null);
    const jarX = Array.isArray(jarCell) ? jarCell[0] : jarCell?.tx;
    const jarZ = Array.isArray(jarCell) ? jarCell[1] : jarCell?.tz;
    jar.visible = tileByName.get('jar').visible = Number.isInteger(jarX) && Number.isInteger(jarZ);
    if (jar.visible) {
      jar.position.set(jarX, core.TILE.H + .16, jarZ);
      tileByName.get('jar').position.set(jarX, 0, jarZ);
    }
    const allCells = [...positions.values()].flat();
    for (const space of spaces) {
      if (Number.isInteger(space?.at?.x) && Number.isInteger(space?.at?.z)) {
        const cell = [space.at.x, space.at.z];
        if (!allCells.some(existing => existing[0] === cell[0] && existing[1] === cell[1])) {
          allCells.push(cell);
        }
      }
    }
    if (jar.visible) allCells.push([jarX, jarZ]);
    if (allCells.length) {
      center.set(allCells.reduce((sum, cell) => sum + cell[0], 0) / allCells.length,
        0, allCells.reduce((sum, cell) => sum + cell[1], 0) / allCells.length);
      camera.position.copy(center).add(new THREE.Vector3(5.3, 7.2, 8.1));
      camera.lookAt(center);
      uniforms.uCamPos.value.copy(camera.position);
    }
    for (const card of cardBySpace.values()) card.mesh.lookAt(camera.position);
    seenRevision = state.rev;
    seenFloorRevision = floorRevision;
    spaceAtCell = nextSpaceAtCell;
    appAtCell = nextAppAtCell;
    previewGenerationBySpace = nextPreviewGenerationBySpace;
    occupiedCells = nextOccupiedCells;
    __webgpuSurfaceStage(`WorldOS live state rev ${state.rev ?? 'none'}, floor ${floorRevision ?? 'none'}: ${allCells.length - Number(jar.visible)} app cells, jar ${jar.visible}`);
  }

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const hit = new THREE.Vector3();
  const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), .002);
  let frame = 0;
  let stopped = false;
  let waveX = 0, waveZ = 0, waveStart = 0;
  globalThis.__nativeStop = () => { stopped = true; };
  globalThis.__worldBack = () => {
    if (hud.isOpen()) { hud.close(); return; }
    if (typeof __nativeWorldLeave === 'function' && __nativeWorldLeave()) {
      if (activeSpace !== null) returningSpace = {
        id: activeSpace,
        generation: Math.max(previewGenerationBySpace.get(activeSpace) || 0,
          cardBySpace.get(activeSpace)?.generation || 0),
      };
      __webgpuSurfaceStage('WorldOS asked SPAOS to leave the current space');
    }
  };
  globalThis.__worldResize = (width, height) => {
    if (!Number.isInteger(width) || !Number.isInteger(height) ||
        width < 1 || height < 1 || width > 8192 || height > 8192 ||
        (width === surfaceWidth && height === surfaceHeight)) return;
    surfaceWidth = width;
    surfaceHeight = height;
    context.canvas.width = width;
    context.canvas.height = height;
    renderer.setSize(width, height, false);
    camera.left = -extent * width / height;
    camera.right = extent * width / height;
    camera.top = extent;
    camera.bottom = -extent;
    camera.updateProjectionMatrix();
    hud.resize(width, height, extent);
    __webgpuSurfaceStage(`WorldOS surface resized: ${width}x${height}`);
  };
  globalThis.__worldPointer = (x, y, clicked) => {
    if (hud.pointer(x, y, clicked) || hud.isOpen()) return;
    pointerNdc.set(x / surfaceWidth * 2 - 1, 1 - y / surfaceHeight * 2);
    raycaster.setFromCamera(pointerNdc, camera);
    if (raycaster.ray.intersectPlane(floor, hit)) {
      const cx = Math.round(hit.x), cz = Math.round(hit.z);
      uniforms.uHoverCell.value.set(cx, cz);
      uniforms.uHasHover.value = 1;
      if (clicked) {
        waveX = cx; waveZ = cz; waveStart = frame;
        const cellKey = `${cx},${cz}`;
        if (spaceAtCell.has(cellKey) && typeof __nativeWorldEnter === 'function') {
          if (__nativeWorldEnter(cx, cz))
            __webgpuSurfaceStage(`WorldOS asked SPAOS to enter (${cx},${cz})`);
        } else {
          const app = appAtCell.get(cellKey);
          if (app && nativeApps.has(app) && typeof __nativeWorldOpen === 'function') {
            if (__nativeWorldOpen(app, cx, cz))
              __webgpuSurfaceStage(`WorldOS asked SPAOS to open ${app} at (${cx},${cz})`);
          }
        }
      }
    }
  };

  async function draw() {
    if (stopped) return;
    pollWorldChannel();
    if (frame % 60 === 0) applyLiveState();
    if (frame % 60 === 0) hud.tick();
    uniforms.uWave.value.set(waveX, waveZ,
      ((frame - waveStart) * .018 * 1.4) % 9.7, .46);
    uniforms.uWaveK.value.set(.42, .1, 1.25, 0);
    jar.rotation.y = frame * .004;
    renderer.render(scene, camera);
    let pixel = null;
    if (frame === 0) {
      const frameWidth = surfaceWidth;
      const frameHeight = surfaceHeight;
      const texture = context.getCurrentTexture();
      const stride = Math.ceil(frameWidth * 4 / 256) * 256;
      const readback = device.createBuffer({
        size: stride * frameHeight, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer(
        { texture, origin: { x: 0, y: 0, z: 0 } },
        { buffer: readback, bytesPerRow: stride },
        { width: frameWidth, height: frameHeight, depthOrArrayLayers: 1 },
      );
      device.queue.submit([encoder.finish()]);
      context.present();
      await readback.mapAsync(GPUMapMode.READ);
      const mapped = readback.getMappedRange();
      if (typeof __nativeSaveFrame === 'function') {
        __nativeSaveFrame(mapped, frameWidth, frameHeight, stride,
          RNWebGPU.gpu.getPreferredCanvasFormat());
      }
      const offset = Math.floor(frameHeight / 2) * stride + Math.floor(frameWidth / 2) * 4;
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
