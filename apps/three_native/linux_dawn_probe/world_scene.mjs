import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as nodes from 'three/webgpu';
import * as tsl from 'three/tsl';

// The native host imports WorldOS's own scene factories. No shader or geometry
// source is parsed, copied, or evaluated in this renderer.

export async function createWorldScene({ THREE, scene, renderer, model, width, height }) {
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
  camera.position.set(5.3, 7.2, 8.1);
  camera.lookAt(0, 0, 0);
  function resize(pixelWidth, pixelHeight) {
    const extent = 3.8;
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
  for (const [x, z] of [[0, 0], [-2, -1], [2, 1], [1, -2]]) {
    const tile = new THREE.Mesh(tileGeometry, tileMaterial);
    tile.position.set(x, 0, z);
    scene.add(tile);
  }
  model.position.set(0, .43, 0);
  model.rotation.set(-.65, .35, 0);
  model.scale.setScalar(2.2);

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
      model.rotation.z = Math.sin(phase) * .12;
      camera.position.set(5.3 * Math.cos(orbit) - 8.1 * Math.sin(orbit),
        7.2, 5.3 * Math.sin(orbit) + 8.1 * Math.cos(orbit));
      camera.lookAt(0, 0, 0);
      uniforms.uCamPos.value.copy(camera.position);
    },
    dispose() {
      grid.geometry.dispose(); tileMaterial.dispose(); worldGrid.dispose();
    },
  };
}
