import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import * as nodes from 'three/webgpu';
import * as tsl from 'three/tsl';
import { createNativeGLTFLoader } from './native_gltf.mjs';

// The native host imports WorldOS's own scene factories. No shader or geometry
// source is parsed, copied, or evaluated in this renderer.

export async function createWorldScene({ THREE, scene, renderer, model, width, height, homeScene = false }) {
  if (!process.env.WORLD_OS_ROOT) {
    throw new Error('Set WORLD_OS_ROOT to the WorldOS desktop/world_os directory');
  }
  const root = resolve(process.env.WORLD_OS_ROOT);
  const engine = join(root, 'kernel/engine');
  const { createNativeGridScene } = await import(pathToFileURL(join(engine, 'native-grid-scene.js')).href);
  const worldGrid = createNativeGridScene({ THREE, nodes, tsl });
  const { core, uniforms, material, tileGeometry } = worldGrid;
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), material);
  grid.rotation.x = -Math.PI / 2;
  grid.position.y = -.002;
  scene.add(grid);
  // Keep the swapchain's native sRGB output policy. Forcing LinearSRGB here
  // makes Three copy the canvas to convert it, but this addon only exposes
  // RenderAttachment usage for acquired surface textures.
  renderer.toneMapping = THREE.NoToneMapping;
  scene.background = core.COL_BG;

  const camera = new THREE.OrthographicCamera();
  const center = homeScene ? new THREE.Vector3(-1.5, 0, -2.2) : new THREE.Vector3();
  camera.position.copy(center).add(new THREE.Vector3(5.3, 7.2, 8.1));
  camera.lookAt(center);
  function resize(pixelWidth, pixelHeight) {
    const extent = homeScene ? 5.8 : 3.8;
    const aspect = pixelWidth / pixelHeight;
    camera.left = -extent * aspect;
    camera.right = extent * aspect;
    camera.top = extent;
    camera.bottom = -extent;
    camera.updateProjectionMatrix();
  }
  resize(width, height);
  uniforms.uCamPos.value.copy(camera.position);
  uniforms.uFlatK.value = 0;
  uniforms.uTiles3D.value = 1;
  uniforms.uNight.value = .78;
  uniforms.uSunLum.value = .38;
  uniforms.uSunAmt.value = .7;
  uniforms.uSunTintA.value.setRGB(.48, .57, .81);
  uniforms.uSunTintB.value.setRGB(.72, .53, .77);

  // Reuse the exact rounded tile geometry and baked vertex color shared with engine03.
  // The material here remains a simple physical stand-in for its much larger
  // node lighting/shadow owner.
  const tileMaterial = new THREE.MeshPhysicalMaterial({
    color: core.COL_GRID_FILL.clone(), roughness: core.TILE.ROUGH,
    metalness: 0, clearcoat: core.TILE.CLEARCOAT, vertexColors: true,
  });
  // Current WorldOS home defaults from engine/19-memory-and-persistence.js
  // (world_os 631663cb1), plus the jar's engine/08 seat. This validation
  // scene will read live layout through a shell seam when that host is ported.
  const homeIcons = [
    { name: 'weather', x: -4, z: -2 },
    { name: 'calendar', x: -1, z: -5 },
    { name: 'mail', x: 0, z: -5 },
    { name: 'notes', x: -4, z: -1 },
    { name: 'whatsapp', x: 0, z: -4 },
    { name: 'browser', x: -2, z: 0 },
    { name: 'files', x: 1, z: -1, size: .68 },
  ];
  const homeTiles = [...homeIcons.map(({ x, z }) => [x, z]), [1, 0]];
  for (const [x, z] of homeScene ? homeTiles : [[0, 0], [-2, -1], [2, 1], [1, -2]]) {
    const tile = new THREE.Mesh(tileGeometry, tileMaterial);
    tile.position.set(x, 0, z);
    scene.add(tile);
  }
  const loadedIcons = [];
  if (homeScene) {
    model.visible = false;
    const assetRoot = resolve(process.env.WORLD_OS_ASSET_ROOT || root);
    const loader = createNativeGLTFLoader();
    for (const { name, x, z, size = .55 } of homeIcons) {
      const path = join(assetRoot, 'assets/media/appicons', `${name}.glb`);
      const bytes = readFileSync(path);
      const gltf = await new Promise((done, fail) => loader.parse(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '', done, fail));
      const icon = gltf.scene;
      let texturedMeshes = 0;
      icon.traverse(object => {
        if (object.isMesh && (Array.isArray(object.material) ? object.material : [object.material])
          .some(material => material?.map?.isDataTexture)) texturedMeshes++;
      });
      if (texturedMeshes === 0) throw new Error(`WorldOS ${name} icon has no decoded native textures`);
      const bounds = new THREE.Box3().setFromObject(icon);
      const extent = bounds.getSize(new THREE.Vector3());
      icon.scale.setScalar(size / Math.max(extent.x, extent.y, extent.z));
      const fitted = new THREE.Box3().setFromObject(icon);
      const iconCenter = fitted.getCenter(new THREE.Vector3());
      icon.position.set(x - iconCenter.x, core.TILE.H + .015 - fitted.min.y, z - iconCenter.z);
      scene.add(icon);
      loadedIcons.push(icon);
    }
    console.log('WorldOS home GLB models loaded:', loadedIcons.length, 'from', assetRoot);
  } else {
    model.position.set(0, .43, 0);
    model.rotation.set(-.65, .35, 0);
    model.scale.setScalar(2.2);
  }

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const hit = new THREE.Vector3();
  const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), .002);
  let pixelWidth = width, pixelHeight = height;
  let waveOriginX = 0, waveOriginZ = 0, waveStartFrame = 0;
  console.log('WorldOS painted-grid node material loaded from:', engine);
  return {
    camera,
    resize(w, h) { pixelWidth = w; pixelHeight = h; resize(w, h); },
    pointer(x, y) {
      pointerNdc.set(x / pixelWidth * 2 - 1, 1 - y / pixelHeight * 2);
      raycaster.setFromCamera(pointerNdc, camera);
      if (raycaster.ray.intersectPlane(floor, hit)) {
        const cx = Math.round(hit.x), cz = Math.round(hit.z);
        uniforms.uHoverCell.value.set(cx, cz);
        uniforms.uHasHover.value = 1;
      }
    },
    click(frame) {
      waveOriginX = uniforms.uHoverCell.value.x;
      waveOriginZ = uniforms.uHoverCell.value.y;
      waveStartFrame = frame;
    },
    tick(frame, orbit) {
      const phase = frame * .013;
      const radius = 9.7;
      uniforms.uWave.value.set(waveOriginX, waveOriginZ,
        ((frame - waveStartFrame) * .018 * 1.4) % radius, .46);
      uniforms.uWaveK.value.set(.42, .1, 1.25, 0);
      if (!homeScene) model.rotation.z = Math.sin(phase) * .12;
      camera.position.copy(center).add(new THREE.Vector3(
        5.3 * Math.cos(orbit) - 8.1 * Math.sin(orbit),
        7.2, 5.3 * Math.sin(orbit) + 8.1 * Math.cos(orbit)));
      camera.lookAt(center);
      uniforms.uCamPos.value.copy(camera.position);
    },
    dispose() {
      grid.geometry.dispose(); tileMaterial.dispose(); worldGrid.dispose();
      for (const icon of loadedIcons) icon.traverse(object => {
        if (!object.isMesh) return;
        object.geometry?.dispose();
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          material?.map?.dispose();
          material?.normalMap?.dispose();
          material?.dispose();
        }
      });
    },
  };
}
