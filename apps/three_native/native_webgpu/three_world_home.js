import * as THREE from 'three/webgpu';
import * as tsl from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createNativeGridScene } from '@worldos/native-grid-scene';
import { createNativeShellHud, createNativeText } from './native_shell_hud.js';
import { createNativeConversationHud } from './native_conversation_hud.js';
import { createNativeMeadowScene } from './native_meadow_scene.js';
import { createNativePeopleScene } from './native_people_scene.js';
import { projectPeopleRoster } from './native_people_roster.mjs';
import { chooseLaunchTile } from './native_world_placement.mjs';
import { createNativeWorldLifecycle } from './native_world_lifecycle.mjs';

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
  const homeRoot = new THREE.Group();
  scene.add(homeRoot);
  const worldGrid = createNativeGridScene({ THREE, nodes: THREE, tsl });
  const { core, uniforms, material, tileGeometry } = worldGrid;
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(128, 128), material);
  grid.rotation.x = -Math.PI / 2;
  grid.position.y = -.002;
  homeRoot.add(grid);
  const meadow = globalThis.__nativeWorldGround === 'meadow' ?
    createNativeMeadowScene(THREE) : null;
  if (meadow) {
    homeRoot.add(meadow.root);
    __webgpuSurfaceStage(`WorldOS native meadow prepared: ${JSON.stringify(meadow.stats())}`);
  }
  renderer.toneMapping = THREE.NoToneMapping;
  const homeBackground = meadow ? new THREE.Color(0x13210e) : core.COL_BG;
  scene.background = homeBackground;
  scene.add(new THREE.AmbientLight(0xffffff, 1.2));
  const light = new THREE.DirectionalLight(0xffffff, 2.5);
  light.position.set(-2, 3, 4);
  scene.add(light);

  const liveShell = typeof __nativeReadShellState === 'function' ||
    typeof __nativeReadShellFloor === 'function' || typeof __nativeWorldPoll === 'function';
  let extent = liveShell ? 3.8 : 5.8;
  const camera = new THREE.OrthographicCamera(-extent, extent, extent, -extent, .1, 100);
  const center = new THREE.Vector3(-1.5, 0, -2.2);
  const cameraOffset = new THREE.Vector3(5.3, 7.2, 8.1);
  let cameraManuallyPlaced = false;
  camera.position.copy(center).add(cameraOffset);
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
    homeRoot.add(tile);
    tileByName.set(name, tile);
  }
  __webgpuSurfaceStage('WorldOS grid and home tiles ready');

  const manifest = JSON.parse(__nativeReadTextAsset('manifest.json'));
  const makeText = createNativeText(THREE, manifest, name => __nativeReadAsset(name));
  async function loadIcon(name, size = .55) {
    const glb = __nativeReadAsset(`${name}.glb`);
    const loader = nativeIconLoader(name, manifest);
    const gltf = await new Promise((resolve, reject) => loader.parse(glb, '', resolve, reject));
    const icon = gltf.scene;
    const bounds = new THREE.Box3().setFromObject(icon);
    const dimensions = bounds.getSize(new THREE.Vector3());
    icon.scale.setScalar(size / Math.max(dimensions.x, dimensions.y, dimensions.z));
    const fitted = new THREE.Box3().setFromObject(icon);
    const iconCenter = fitted.getCenter(new THREE.Vector3());
    const offset = new THREE.Vector3(-iconCenter.x, core.TILE.H + .015 - fitted.min.y,
      -iconCenter.z);
    return { icon, offset };
  }
  const iconByName = new Map();
  for (const { name, x, z, size = .55 } of homeIcons) {
    const { icon, offset } = await loadIcon(name, size);
    icon.position.set(x + offset.x, offset.y, z + offset.z);
    homeRoot.add(icon);
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
  homeRoot.add(jar);
  __webgpuSurfaceStage('WorldOS jar profile ready');

  const layoutKey = {
    weather: 'weathersun', calendar: 'calendar', mail: 'mail',
    notes: 'ib:notes', whatsapp: 'ib:whatsapp', browser: 'ib:browser',
    files: 'stack',
  };
  const extraByName = new Map();
  const cardBySpace = new Map();
  const previewRetryBySpace = new Map();
  const floorTileByFloorObject = new Map();
  const modelByName = new Map();
  const modelLoadByName = new Map();
  const modelByFloorObject = new Map();
  const labelByFloorObject = new Map();
  const nativeApps = new Map();
  let channelFloor = null;
  let channelFloorRevision = 0;
  let spaceAtCell = new Map();
  let appAtCell = new Map();
  let occupiedCells = new Set();
  let activeSpace = null;
  // A click can enter a space before the next floor snapshot reaches us.
  let requestedSpace = null;
  let previewGenerationBySpace = new Map();
  let returningSpace = null;
  let seenRevision = null;
  let seenFloorRevision = null;
  let seenCatalogSignature = null;
  let pendingPreview = false;
  let nextPreviewRetryAt = Infinity;
  let pendingIconRefresh = false;
  let cachedState = { layout: {}, props: [] };
  let cachedFileFloor = null;
  let cachedFileFloorRevision = null;
  function requestModel(name) {
    if (!manifest[name]?.images || modelByName.has(name) || modelLoadByName.has(name)) return;
    modelLoadByName.set(name, loadIcon(name).then(model => {
      modelByName.set(name, model);
      pendingIconRefresh = true;
      __webgpuSurfaceStage(`WorldOS floor icon loaded: ${name}`);
    }).catch(error => {
      __webgpuSurfaceStage(`WorldOS floor icon unavailable: ${name}: ${String(error)}`);
    }));
  }
  function removeFloorLabel(id) {
    const entry = labelByFloorObject.get(id);
    if (!entry) return;
    homeRoot.remove(entry.mesh);
    entry.mesh.material.map.dispose();
    entry.mesh.material.dispose();
    entry.mesh.geometry.dispose();
    labelByFloorObject.delete(id);
  }
  function floorLabel(id, name, x, z) {
    let entry = labelByFloorObject.get(id);
    if (entry?.name !== name) {
      removeFloorLabel(id);
      const { texture, width, height } = makeText(name.slice(0, 18), [49, 48, 54]);
      const labelHeight = Math.min(.14, .78 * height / width);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide,
          depthWrite: false, toneMapped: false }));
      mesh.scale.set(labelHeight * width / height, labelHeight, 1);
      homeRoot.add(mesh);
      entry = { name, mesh };
      labelByFloorObject.set(id, entry);
    }
    entry.mesh.position.set(x, core.TILE.H + .18, z);
    entry.mesh.lookAt(camera.position);
  }
  function syncFloorStandIn(id, appName, x, z, visible) {
    let floorModel = modelByFloorObject.get(id);
    if (floorModel && (floorModel.name !== appName || !visible)) {
      homeRoot.remove(floorModel.icon);
      modelByFloorObject.delete(id);
      floorModel = null;
    }
    if (visible && appName && manifest[appName]?.images) {
      requestModel(appName);
      const model = modelByName.get(appName);
      if (model && !floorModel) {
        floorModel = { name: appName, icon: model.icon.clone(true) };
        homeRoot.add(floorModel.icon);
        modelByFloorObject.set(id, floorModel);
      }
    }
    if (floorModel) {
      const offset = modelByName.get(appName).offset;
      floorModel.icon.position.set(x + offset.x, offset.y, z + offset.z);
      removeFloorLabel(id);
    } else if (visible) {
      floorLabel(id, appName || `SPACE ${id}`, x, z);
    } else {
      removeFloorLabel(id);
    }
  }
  function syncFloorTile(id, x, z, visible) {
    let tile = floorTileByFloorObject.get(id);
    if (!tile) {
      tile = new THREE.Mesh(tileGeometry, tileMaterial);
      homeRoot.add(tile);
      floorTileByFloorObject.set(id, tile);
    }
    tile.position.set(x, 0, z);
    tile.visible = visible;
  }
  const people = createNativePeopleScene({ THREE, scene, camera, tileGeometry, makeText,
    loadModel: name => new Promise((resolve, reject) => {
      const loader = nativeIconLoader(name, manifest);
      loader.parse(__nativeReadAsset(`${name}.glb`), '',
        resolve, reject);
    }),
    stage: message => __webgpuSurfaceStage(message),
    onFocus: (x, z) => {
      camera.position.set(x, 5.2, z + 7.8);
      camera.lookAt(x, 0, z);
      people.faceCamera();
    },
  });
  let peopleSource = 'sample';
  let rosterSignature = '';
  function pollPeopleRoster() {
    let rows = null;
    try {
      const value = JSON.parse(__nativeReadPeopleRoster());
      if (Number.isFinite(value.receivedAt) && Date.now() - value.receivedAt < 12000)
        rows = projectPeopleRoster(value.snapshot);
    } catch {}
    const signature = rows === null ? 'sample' : JSON.stringify(rows);
    if (signature === rosterSignature) return;
    rosterSignature = signature;
    if (rows === null) {
      peopleSource = 'sample';
      people.useSample();
    } else {
      peopleSource = 'live';
      people.setPeople(rows);
    }
    hud.setPeopleRows(people.rows(), peopleSource === 'sample');
    hud.setView(people.isOpen() ? 'people' : 'home', peopleSource === 'sample');
    __webgpuSurfaceStage(`WorldOS People source: ${peopleSource}${rows ? ` (${rows.length} present)` : ''}`);
  }
  let homeExtent = extent;
  function setPeopleOpen(open) {
    if (open === people.isOpen()) return;
    if (open) {
      homeExtent = extent;
      extent = 3.2;
      homeRoot.visible = false;
      scene.background = new THREE.Color(0xf0efed);
      camera.position.set(0, 5.2, 7.8);
      camera.lookAt(0, 0, 0);
      people.enter();
      hud.setPeopleRows(people.rows(), peopleSource === 'sample');
    } else {
      extent = homeExtent;
      people.leave();
      homeRoot.visible = true;
      scene.background = homeBackground;
      camera.position.copy(center).add(cameraOffset);
      camera.lookAt(center);
      uniforms.uCamPos.value.copy(camera.position);
    }
    camera.left = -extent * surfaceWidth / surfaceHeight;
    camera.right = extent * surfaceWidth / surfaceHeight;
    camera.top = extent;
    camera.bottom = -extent;
    camera.updateProjectionMatrix();
    hud.resize(surfaceWidth, surfaceHeight, extent);
    conversation.resize(surfaceWidth, surfaceHeight, extent);
    hud.setView(open ? 'people' : 'home', peopleSource === 'sample');
    people.faceCamera();
  }
  const hud = createNativeShellHud({ THREE, scene, camera, manifest,
    readAsset: name => __nativeReadAsset(name),
    makeText,
    stage: message => __webgpuSurfaceStage(message),
    onBack: () => globalThis.__worldBack(),
    onPeople: () => {
      if (people.isOpen()) hud.togglePeoplePanel();
      else setPeopleOpen(true);
    },
    onSelectPerson: id => people.select(id),
    onFindPerson: id => people.focus(id),
    onPausePeople: paused => people.setPaused(paused),
    onOpen: (key, selectedTile) => {
      if (typeof __nativeWorldOpen !== 'function' || !nativeApps.has(key)) return;
      const tile = chooseLaunchTile(selectedTile, occupiedCells, center);
      if (!tile) return;
      if (__nativeWorldOpen(key, tile.x, tile.z))
        __webgpuSurfaceStage(`WorldOS launcher asked SPAOS to open ${key} at (${tile.x},${tile.z})`);
    },
  });
  hud.resize(surfaceWidth, surfaceHeight, extent);
  const sendAgent = value => typeof __nativeAgentSend === 'function' &&
    __nativeAgentSend(JSON.stringify(value));
  const conversation = createNativeConversationHud({ THREE, scene, camera, makeText,
    onSubmit: text => {
      const inputId = `native-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
      return sendAgent({ type: 'utterance', text, inputId }) ? inputId : null;
    },
  });
  conversation.resize(surfaceWidth, surfaceHeight, extent);
  const agentVerbs = new Set();
  const agentServices = new Set();
  const pendingAgentCalls = new Set();
  let seenAgentStatus = '';
  function pollAgentChannel() {
    if (typeof __nativeAgentPoll !== 'function') return;
    const incoming = __nativeAgentPoll();
    if (!incoming) {
      if (typeof __nativeAgentConnected === 'function' && !__nativeAgentConnected())
        conversation.setReady(false);
      return;
    }
    for (const line of incoming.split('\n')) {
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message?.type === 'agent_status') {
        conversation.setReady(message.ready === true);
        const status = `${message.connected === true ? 'connected' : 'disconnected'}/` +
          `${message.ready === true ? 'ready' : 'offline'}`;
        if (status !== seenAgentStatus) {
          seenAgentStatus = status;
          __webgpuSurfaceStage(`WorldOS mind status: ${status}`);
        }
      } else if (message?.type === 'agent_frame') {
        if (message.frame?.t === 'say' && typeof message.frame.text === 'string') {
          conversation.say(message.frame.text);
          __webgpuSurfaceStage(`WorldOS mind replied: ${message.frame.text.slice(0, 160)}`);
        } else if (message.frame?.t === 'say-delta') {
          conversation.delta(message.frame.delta, message.frame.inputId);
        } else if (message.frame?.t === 'status') {
          conversation.status(message.frame.state);
        }
      } else if (message?.type === 'agent_call') {
        const call = message.call;
        if (!call || typeof call.callId !== 'string' || typeof call.verb !== 'string') continue;
        const result = error => sendAgent({ type: 'result', callId: call.callId,
          result: { ok: false, verb: call.verb, error: { code: 'not-found', message: error } } });
        if (!agentVerbs.has(call.verb) && !agentServices.has(call.verb)) {
          result('This verb is not in the native World catalog');
          continue;
        }
        let sent = false;
        try {
          sent = typeof __nativeWorldCall === 'function' &&
            __nativeWorldCall(call.verb, JSON.stringify(call.args || {}),
              call.callId, agentServices.has(call.verb));
        } catch (error) {
          result(String(error));
          continue;
        }
        if (sent) pendingAgentCalls.add(call.callId);
        else result('The SPAOS World channel could not send this verb');
      }
    }
  }
  if (globalThis.__nativeWorldStartView === 'people') pollPeopleRoster();
  if (globalThis.__nativeWorldStartView === 'people') setPeopleOpen(true);
  function isCell(value) {
    return Array.isArray(value) && value.length === 2 &&
      Number.isInteger(value[0]) && Number.isInteger(value[1]);
  }
  function appIconName(value) {
    let name = String(value || '').toLowerCase();
    if (name.endsWith('.desktop')) name = name.slice(0, -8);
    return name.split('.').pop();
  }
  function pollWorldChannel() {
    if (typeof __nativeWorldPoll !== 'function') return false;
    const incoming = __nativeWorldPoll();
    if (!incoming) return false;
    let floorChanged = false;
    for (const line of incoming.split('\n')) {
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (!message || typeof message !== 'object') continue;
      if (lifecycle.onMessage(message)) continue;
      if (message.type === 'apps' && Array.isArray(message.apps)) {
        const signature = JSON.stringify(message.apps.map(app => [
          app.key, app.name, app.hidden, app.world, app.icon, app.verbs,
        ]).concat([message.harness, message.catalogGeneration]));
        if (signature === seenCatalogSignature) continue;
        seenCatalogSignature = signature;
        agentVerbs.clear();
        for (const app of message.apps) {
          if (app?.world && Array.isArray(app.verbs))
            for (const verb of app.verbs) if (typeof verb?.name === 'string')
              agentVerbs.add(verb.name);
        }
        for (const verb of message.harness || [])
          if (typeof verb?.name === 'string') agentVerbs.add(verb.name);
        sendAgent({ type: 'catalog', apps: message.apps,
          harness: message.harness || [], generation: message.catalogGeneration });
        nativeApps.clear();
        for (const app of message.apps) {
          if (typeof app?.key === 'string' && !app.hidden) nativeApps.set(app.key, app);
        }
        hud.setApps([...nativeApps.values()]);
        __webgpuSurfaceStage(`WorldOS app catalog received: ${nativeApps.size} visible apps`);
      } else if (message.type === 'spaces' && Array.isArray(message.spaces)) {
        // The authenticated World channel is the floor's authority. The file
        // snapshot remains a standalone-probe fallback, not a second live feed.
        channelFloor = { spaces: message.spaces };
        ++channelFloorRevision;
        floorChanged = true;
      } else if (message.type === 'services' && Array.isArray(message.services)) {
        agentServices.clear();
        for (const service of message.services)
          for (const verb of service?.verbs || [])
            if (typeof verb?.name === 'string') agentServices.add(verb.name);
      } else if (message.type === 'call_result' &&
                 pendingAgentCalls.delete(message.callId)) {
        sendAgent({ type: 'result', callId: message.callId, result: message.result });
      }
    }
    return floorChanged;
  }
  function applyLiveState(readVolume = false) {
    if (!liveShell) return;
    let floor = channelFloor || cachedFileFloor;
    let floorRevision = channelFloor ? channelFloorRevision : cachedFileFloorRevision;
    try {
      if (readVolume && typeof __nativeReadShellState === 'function') {
        cachedState = JSON.parse(__nativeReadShellState());
      }
      if (!channelFloor && readVolume && typeof __nativeReadShellFloor === 'function') {
        const raw = __nativeReadShellFloor();
        cachedFileFloor = JSON.parse(raw);
        cachedFileFloorRevision = cachedFileFloor.rev ?? cachedFileFloor.revision ?? raw;
        floor = cachedFileFloor;
        floorRevision = cachedFileFloorRevision;
      }
    }
    catch (error) {
      __webgpuSurfaceStage(`WorldOS state or floor read failed: ${String(error)}`);
      return;
    }
    const state = cachedState;
    if (state.rev === seenRevision && floorRevision === seenFloorRevision &&
        !pendingPreview && !pendingIconRefresh) return;
    const snapshotChanged = state.rev !== seenRevision ||
      floorRevision !== seenFloorRevision;
    pendingIconRefresh = false;
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
      const app = appIconName(prop.app);
      if (iconByName.has(app) && Number.isInteger(prop.tx) && Number.isInteger(prop.tz)) {
        addPosition(app, [prop.tx, prop.tz]);
      }
    }
    for (const space of spaces) {
      if (!Number.isInteger(space?.at?.x) || !Number.isInteger(space?.at?.z)) continue;
      const app = appIconName(space.apps?.[0] || space.pending);
      if (iconByName.has(app)) addPosition(app, [space.at.x, space.at.z]);
    }
    const homeIconCells = new Set();
    for (const cells of positions.values()) {
      for (const cell of cells) homeIconCells.add(`${cell[0]},${cell[1]}`);
    }
    const cardCells = new Set();
    const currentSpaces = new Set();
    const currentFloorObjects = new Set();
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
    nextPreviewRetryAt = Infinity;
    const now = performance.now();
    for (const space of spaces) {
      if (!Number.isInteger(space?.id) || space.id < 1 ||
          !Number.isInteger(space?.at?.x) || !Number.isInteger(space?.at?.z)) continue;
      currentSpaces.add(space.id);
      currentFloorObjects.add(space.id);
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
      if (!shot) previewRetryBySpace.delete(space.id);
      if (shot && typeof __nativeReadShellPreview === 'function' &&
          (!card || card.generation !== shot.generation || card.window !== shot.window)) {
        const previousRetry = previewRetryBySpace.get(space.id);
        const sameRetry = previousRetry?.window === shot.window &&
          previousRetry?.generation === shot.generation;
        if (sameRetry && now < previousRetry.at) {
          pendingPreview = true;
          nextPreviewRetryAt = Math.min(nextPreviewRetryAt, previousRetry.at);
        } else {
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
              homeRoot.add(mesh);
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
            previewRetryBySpace.delete(space.id);
            __webgpuSurfaceStage(`WorldOS preview updated: space ${space.id}, generation ${shot.generation}`);
          } catch (error) {
            const delay = sameRetry ? Math.min(previousRetry.delay * 2, 5000) : 150;
            const at = now + delay;
            previewRetryBySpace.set(space.id,
              { window: shot.window, generation: shot.generation, delay, at });
            pendingPreview = true;
            nextPreviewRetryAt = Math.min(nextPreviewRetryAt, at);
            if (!sameRetry)
              __webgpuSurfaceStage(`WorldOS preview pending: space ${space.id}: ${String(error)}`);
          }
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
      const appName = appIconName(space.apps?.[0] || space.pending);
      const showStandIn = !cardCells.has(cellKey) && !homeIconCells.has(cellKey);
      syncFloorStandIn(space.id, appName, space.at.x, space.at.z, showStandIn);
      if (returningSpace?.id === space.id && !space.active &&
          card?.generation > returningSpace.generation &&
          typeof __nativeWorldRelease === 'function' &&
          __nativeWorldRelease(space.id)) {
        __webgpuSurfaceStage(`WorldOS released space ${space.id} after preview update`);
        returningSpace = null;
      }
      const jarAtCell = isCell(layout.jar) && layout.jar[0] === space.at.x &&
        layout.jar[1] === space.at.z;
      syncFloorTile(space.id, space.at.x, space.at.z,
        !jarAtCell && !homeIconCells.has(cellKey));
    }
    // Saved app props persist after their windows close. Give every app with
    // a saved tile the same lazy icon and label path as a live space.
    for (const prop of props) {
      if (prop?.kind !== 'spaos' || typeof prop.app !== 'string' ||
          !Number.isInteger(prop.tx) || !Number.isInteger(prop.tz)) continue;
      const cellKey = `${prop.tx},${prop.tz}`;
      if (nextSpaceAtCell.has(cellKey) || homeIconCells.has(cellKey)) continue;
      const id = `prop:${cellKey}`;
      currentFloorObjects.add(id);
      nextAppAtCell.set(cellKey, prop.app);
      syncFloorStandIn(id, appIconName(prop.app), prop.tx, prop.tz, true);
      syncFloorTile(id, prop.tx, prop.tz, true);
    }
    for (const [id, card] of cardBySpace) {
      if (currentSpaces.has(id)) continue;
      homeRoot.remove(card.mesh);
      card.mesh.material.map?.dispose();
      card.mesh.material.dispose();
      card.mesh.geometry.dispose();
      cardBySpace.delete(id);
    }
    for (const id of previewRetryBySpace.keys()) {
      if (!currentSpaces.has(id)) previewRetryBySpace.delete(id);
    }
    for (const [id, tile] of floorTileByFloorObject) {
      if (currentFloorObjects.has(id)) continue;
      homeRoot.remove(tile);
      floorTileByFloorObject.delete(id);
    }
    for (const [id, model] of modelByFloorObject) {
      if (currentFloorObjects.has(id)) continue;
      homeRoot.remove(model.icon);
      modelByFloorObject.delete(id);
    }
    for (const id of labelByFloorObject.keys()) {
      if (!currentFloorObjects.has(id)) removeFloorLabel(id);
    }
    if (activeSpace !== null && activeSpace === requestedSpace) requestedSpace = null;
    for (const { name } of homeIcons) {
      const cells = positions.get(name) || [];
      for (const cell of cells) nextAppAtCell.set(`${cell[0]},${cell[1]}`, name);
      const { icon, offset } = iconByName.get(name);
      const tile = tileByName.get(name);
      const extras = extraByName.get(name) || [];
      for (let index = extras.length + 1; index < cells.length; ++index) {
        const extra = { icon: icon.clone(true), tile: new THREE.Mesh(tileGeometry, tileMaterial) };
        homeRoot.add(extra.icon, extra.tile);
        extras.push(extra);
      }
      while (extras.length > Math.max(0, cells.length - 1)) {
        const extra = extras.pop();
        homeRoot.remove(extra.icon, extra.tile);
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
    const allCells = [];
    const allCellKeys = new Set();
    const includeCell = (x, z) => {
      const key = `${x},${z}`;
      if (allCellKeys.has(key)) return;
      allCellKeys.add(key);
      allCells.push([x, z]);
    };
    for (const cells of positions.values()) {
      for (const cell of cells) includeCell(cell[0], cell[1]);
    }
    for (const space of spaces) {
      if (Number.isInteger(space?.at?.x) && Number.isInteger(space?.at?.z)) {
        includeCell(space.at.x, space.at.z);
      }
    }
    for (const prop of props) {
      if (prop?.kind === 'spaos' && Number.isInteger(prop.tx) &&
          Number.isInteger(prop.tz)) includeCell(prop.tx, prop.tz);
    }
    if (jar.visible) includeCell(jarX, jarZ);
    if (allCells.length && !cameraManuallyPlaced) {
      center.set(allCells.reduce((sum, cell) => sum + cell[0], 0) / allCells.length,
        0, allCells.reduce((sum, cell) => sum + cell[1], 0) / allCells.length);
      grid.position.x = center.x;
      grid.position.z = center.z;
      if (!people.isOpen()) {
        camera.position.copy(center).add(cameraOffset);
        camera.lookAt(center);
        uniforms.uCamPos.value.copy(camera.position);
      }
    }
    for (const card of cardBySpace.values()) card.mesh.lookAt(camera.position);
    for (const label of labelByFloorObject.values()) label.mesh.lookAt(camera.position);
    seenRevision = state.rev;
    seenFloorRevision = floorRevision;
    spaceAtCell = nextSpaceAtCell;
    appAtCell = nextAppAtCell;
    previewGenerationBySpace = nextPreviewGenerationBySpace;
    occupiedCells = nextOccupiedCells;
    if (meadow) {
      if (meadow.setOccupiedCells(nextOccupiedCells))
        __webgpuSurfaceStage(`WorldOS meadow cleared ${nextOccupiedCells.size} floor cells; ` +
          `${meadow.stats().blades} blades remain`);
      if (jar.visible) meadow.setHole(jarX, jarZ);
    }
    if (snapshotChanged)
      __webgpuSurfaceStage(`WorldOS live state rev ${state.rev ?? 'none'}, floor ${floorRevision ?? 'none'}: ${allCells.length - Number(jar.visible)} app cells, jar ${jar.visible}`);
  }

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const hit = new THREE.Vector3();
  const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), .002);
  let frame = 0;
  let stopped = false;
  const lifecycle = createNativeWorldLifecycle({
    sendStatus: typeof __nativeWorldLifecycleStatus === 'function' ?
      id => __nativeWorldLifecycleStatus(id) : null,
    sendRestart: typeof __nativeWorldLifecycleRestart === 'function' ?
      (id, session, requestId) => __nativeWorldLifecycleRestart(id, session, requestId) : null,
    requestQuit: () => {
      stopped = true;
      if (typeof __nativeRequestQuit === 'function') __nativeRequestQuit();
    },
    stage: message => __webgpuSurfaceStage(message),
  });
  globalThis.__worldRestart = () => lifecycle.restart();
  // A bundle prefix can select the previous post-draw timer for comparison.
  // Otherwise pace start-to-start so rendering time does not add to the wait.
  const framePacing = globalThis.__worldFramePacing === 'legacy' ? 'legacy' : 'deadline';
  const requestedPeriod = globalThis.__worldFramePeriodMs;
  const framePeriodMs = Number.isFinite(requestedPeriod) &&
    requestedPeriod >= 8 && requestedPeriod <= 100 ? requestedPeriod : 1000 / 60;
  const frameTiming = globalThis.__worldFrameTiming === true;
  const timingSamples = [];
  let previousStart = null;
  let scheduledFor = null;
  let inputSequence = 0;
  const pendingInputs = [];
  function reportFrameTiming() {
    const fields = ['interval', 'wakeLate', 'update', 'render', 'present', 'work'];
    const report = { mode: framePacing, periodMs: framePacing === 'deadline' ? framePeriodMs : 16,
      frames: timingSamples.length };
    for (const field of fields) {
      const sorted = timingSamples.map(sample => sample[field])
        .filter(Number.isFinite).sort((a, b) => a - b);
      if (sorted.length) report[`${field}Ms`] = {
        p50: Math.round(sorted[Math.ceil(sorted.length * .5) - 1] * 100) / 100,
        p95: Math.round(sorted[Math.ceil(sorted.length * .95) - 1] * 100) / 100,
        max: Math.round(sorted[sorted.length - 1] * 100) / 100,
      };
    }
    __webgpuSurfaceStage(`WorldOS frame timing ${JSON.stringify(report)}`);
    timingSamples.length = 0;
  }
  // Keep motion at the legacy scene's observed ~38-fps speed while draw
  // cadence changes. Frame numbers still count presents and poll intervals.
  const animationStart = performance.now();
  const waveUnitsPerMs = .018 * 1.4 * 38 / 1000;
  const jarRadiansPerMs = .004 * 38 / 1000;
  let waveX = 0, waveZ = 0, waveStart = animationStart;
  globalThis.__nativeStop = () => { stopped = true; };
  globalThis.__worldBack = () => {
    if (conversation.blur()) return;
    if (hud.isOpen()) { hud.close(); return; }
    if (people.isOpen()) { setPeopleOpen(false); return; }
    if (typeof __nativeWorldLeave === 'function' && __nativeWorldLeave()) {
      const leavingSpace = activeSpace ?? requestedSpace;
      if (leavingSpace !== null) returningSpace = {
        id: leavingSpace,
        generation: Math.max(previewGenerationBySpace.get(leavingSpace) || 0,
          cardBySpace.get(leavingSpace)?.generation || 0),
      };
      requestedSpace = null;
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
    conversation.resize(width, height, extent);
    __webgpuSurfaceStage(`WorldOS surface resized: ${width}x${height}`);
  };
  globalThis.__worldNavigate = (kind, amount = 1) => {
    if (kind === 'restart') { lifecycle.restart(); return; }
    if (hud.key(kind === 'recenter' ? 'home' : kind)) return;
    if (conversation.key(kind)) return;
    if (kind === 'zoom' && conversation.scroll(amount)) return;
    if (people.isOpen()) {
      if (kind === 'recenter') setPeopleOpen(false);
      return;
    }
    if (kind === 'recenter') {
      cameraManuallyPlaced = false;
      seenRevision = null;
      seenFloorRevision = null;
      applyLiveState();
      return;
    }
    if (kind === 'zoom') {
      extent = THREE.MathUtils.clamp(extent * (amount > 0 ? .88 : 1.12), 1.2, 24);
      camera.left = -extent * surfaceWidth / surfaceHeight;
      camera.right = extent * surfaceWidth / surfaceHeight;
      camera.top = extent;
      camera.bottom = -extent;
      camera.updateProjectionMatrix();
      hud.resize(surfaceWidth, surfaceHeight, extent);
      conversation.resize(surfaceWidth, surfaceHeight, extent);
    } else {
      const forward = new THREE.Vector3(-cameraOffset.x, 0, -cameraOffset.z).normalize();
      const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
      const step = Math.max(.25, extent * .25);
      if (kind === 'left' || kind === 'right')
        center.addScaledVector(right, step * (kind === 'right' ? 1 : -1));
      else if (kind === 'up' || kind === 'down')
        center.addScaledVector(forward, step * (kind === 'up' ? 1 : -1));
      else return;
      camera.position.copy(center).add(cameraOffset);
      camera.lookAt(center);
      grid.position.x = center.x;
      grid.position.z = center.z;
      uniforms.uCamPos.value.copy(camera.position);
      for (const card of cardBySpace.values()) card.mesh.lookAt(camera.position);
      for (const label of labelByFloorObject.values()) label.mesh.lookAt(camera.position);
    }
    cameraManuallyPlaced = true;
  };
  globalThis.__worldTextInput = text => hud.text(text) || conversation.text(text);
  globalThis.__worldPointer = (x, y, clicked) => {
    if (clicked && frameTiming) pendingInputs.push({
      sequence: ++inputSequence, at: performance.now(), afterFrame: frame,
    });
    if (hud.pointer(x, y, clicked) || hud.isOpen()) return;
    if (conversation.pointer(x, y, clicked)) return;
    if (people.isOpen()) {
      if (!clicked) return;
      pointerNdc.set(x / surfaceWidth * 2 - 1, 1 - y / surfaceHeight * 2);
      raycaster.setFromCamera(pointerNdc, camera);
      const person = people.pick(raycaster);
      if (person) {
        people.select(person);
        hud.selectPerson(person);
        hud.togglePeoplePanel();
      }
      return;
    }
    pointerNdc.set(x / surfaceWidth * 2 - 1, 1 - y / surfaceHeight * 2);
    raycaster.setFromCamera(pointerNdc, camera);
    // The meadow can stand well above the flat grid plane. Pick the visible
    // authored tile before falling back to that plane, including Space tiles
    // published after the renderer's first frame.
    const tileHit = clicked ? raycaster.intersectObjects([
      ...tileByName.values(), ...floorTileByFloorObject.values(),
      ...[...extraByName.values()].flatMap(entries => entries.map(entry => entry.tile)),
    ].filter(tile => tile.visible), false)[0] : null;
    if (tileHit || raycaster.ray.intersectPlane(floor, hit)) {
      const cx = Math.round(tileHit ? tileHit.object.position.x : hit.x);
      const cz = Math.round(tileHit ? tileHit.object.position.z : hit.z);
      uniforms.uHoverCell.value.set(cx, cz);
      uniforms.uHasHover.value = 1;
      if (clicked) {
        waveX = cx; waveZ = cz; waveStart = performance.now();
        const cellKey = `${cx},${cz}`;
        if (spaceAtCell.has(cellKey) && typeof __nativeWorldEnter === 'function') {
          if (__nativeWorldEnter(cx, cz)) {
            requestedSpace = spaceAtCell.get(cellKey);
            __webgpuSurfaceStage(`WorldOS asked SPAOS to enter (${cx},${cz})`);
          }
        } else {
          const app = appAtCell.get(cellKey);
          if (app && nativeApps.has(app) && typeof __nativeWorldOpen === 'function') {
            if (__nativeWorldOpen(app, cx, cz))
              __webgpuSurfaceStage(`WorldOS asked SPAOS to open ${app} at (${cx},${cz})`);
          } else if (!occupiedCells.has(cellKey) && nativeApps.size) {
            hud.openAt(cx, cz);
          }
        }
      }
    }
  };

  async function draw() {
    if (stopped) return;
    const startedAt = performance.now();
    const interval = previousStart === null ? null : startedAt - previousStart;
    const wakeLate = scheduledFor === null ? null : startedAt - scheduledFor;
    previousStart = startedAt;
    people.tick(Math.min(.1, (interval ?? 16) / 1000));
    if (frame % 60 === 0) pollPeopleRoster();
    const floorChanged = pollWorldChannel();
    pollAgentChannel();
    if (floorChanged || pendingIconRefresh || frame % 60 === 0 ||
        (pendingPreview && startedAt >= nextPreviewRetryAt))
      applyLiveState(frame % 60 === 0);
    if (frame % 60 === 0) hud.tick();
    uniforms.uWave.value.set(waveX, waveZ,
      ((startedAt - waveStart) * waveUnitsPerMs) % 9.7, .46);
    uniforms.uWaveK.value.set(.42, .1, 1.25, 0);
    jar.rotation.y = (startedAt - animationStart) * jarRadiansPerMs;
    const updateEnd = frameTiming ? performance.now() : 0;
    renderer.render(scene, camera);
    const renderEnd = frameTiming ? performance.now() : 0;
    let pixel = null;
    let presentEnd = 0;
    // An opt-in later capture lets visual probes inspect assets that load after
    // the first frame without changing production presentation cadence.
    if (frame === 0 || frame === globalThis.__worldCaptureFrame) {
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
      if (frameTiming) presentEnd = performance.now();
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
      if (frameTiming) presentEnd = performance.now();
    }
    frame++;
    if (frameTiming && pendingInputs.length) {
      for (const input of pendingInputs) {
        __webgpuSurfaceStage(`WorldOS input to present ${JSON.stringify({
          sequence: input.sequence, frame, framesLater: frame - input.afterFrame,
          ms: Math.round((presentEnd - input.at) * 100) / 100,
        })}`);
      }
      pendingInputs.length = 0;
    }
    // The first draw reads back a GPU pixel; the next interval includes that
    // one-off wait, so start steady timing with the third presented frame.
    if (frameTiming && frame > 2) {
      timingSamples.push({ interval, wakeLate, update: updateEnd - startedAt,
        render: renderEnd - updateEnd, present: presentEnd - renderEnd,
        work: presentEnd - startedAt });
      if (timingSamples.length === 120) reportFrameTiming();
    }
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
    const afterDraw = performance.now();
    const delay = framePacing === 'deadline' ?
      Math.max(0, framePeriodMs - (afterDraw - startedAt)) : 16;
    scheduledFor = afterDraw + delay;
    setTimeout(() => draw().catch(error => {
      stopped = true;
      __webgpuSurfaceDone(false, String(error?.stack || error));
    }), delay);
  }

  await draw();
}

render().catch(error => __webgpuSurfaceDone(false, String(error?.stack || error)));
