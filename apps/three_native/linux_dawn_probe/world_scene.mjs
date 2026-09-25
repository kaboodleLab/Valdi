import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as nodes from 'three/webgpu';
import * as tsl from 'three/tsl';

// This adapts the existing WorldOS painted-grid fixture to a native window.
// The factory and uniforms come from the user's WorldOS checkout at runtime;
// no copied shader is maintained in the Valdi probe.
function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`WorldOS source changed: ${start} / ${end}`);
  return source.slice(from, to);
}

function template(source, marker) {
  const start = source.indexOf(marker);
  const begin = source.indexOf('`', start);
  const end = source.indexOf('`;', begin);
  if (start < 0 || begin < 0 || end < 0) throw new Error(`WorldOS template changed: ${marker}`);
  return source.slice(begin, end + 1);
}

export async function createWorldScene({ THREE, scene, renderer, model, width, height }) {
  if (!process.env.WORLD_OS_ROOT) {
    throw new Error('Set WORLD_OS_ROOT to the WorldOS desktop/world_os directory');
  }
  const root = resolve(process.env.WORLD_OS_ROOT);
  const engine = join(root, 'kernel/engine');
  const source01 = readFileSync(join(engine, '01-light-and-state.js'), 'utf8');
  const source03 = readFileSync(join(engine, '03-ground.js'), 'utf8');
  const fromEngine = name => import(pathToFileURL(join(engine, name)).href);
  const [{ createGridMaterial }, { createGroupFootprint }, { createGroupGardenReveal }] = await Promise.all([
    fromEngine('grid-material.js'), fromEngine('tile-drag-footprint.js'),
    fromEngine('group-garden-reveal.js'),
  ]);

  const tileSource = section(source01, 'W.core.TILE = {', '\n  };');
  const tile = Function(`return (${tileSource.slice(tileSource.indexOf('{'))}\n})`)();
  const exposure = tile.EXPOSURE;
  const W = { core: {
    TILE: tile, CELL: 1, PLANE: 600,
    FADE_START: 4.6, FADE_END: 9.6,
    KEY_DIR: new THREE.Vector3(.66, .62, .42).normalize(),
    NIGHT_K: { value: 0 },
    SUN_TINT: { value: new THREE.Color(1, 1, 1) },
    SUN_TINT_A: { value: new THREE.Color(1, 1, 1) },
    SUN_TINT_B: { value: new THREE.Color(1, 1, 1) },
    SUN_LUM: { value: 1 }, SUN_AMT: { value: 0 },
    SUN_GRAD_DIR: { value: new THREE.Vector2(1, 0) },
    SUN_GRID: { value: new THREE.Vector2() },
    SUN_POOL: { value: 0 }, SUN_SPLIT: { value: 0 },
  }, grid: {
    groupFootprint: createGroupFootprint(THREE),
    groupGardenReveal: createGroupGardenReveal(THREE),
  } };
  for (const name of ['COL_BG', 'COL_GRID_FILL', 'COL_GRID', 'COL_HOVER', 'COL_PLUS']) {
    const color = source01.match(new RegExp(`const ${name}\\s*= new THREE.Color\\('([^']+)'\\)`));
    if (!color) throw new Error(`WorldOS ${name} color is absent`);
    W.core[name] = new THREE.Color(color[1]);
  }
  W.core.TONE_GLSL = Function('W', `return ${template(source01, 'W.core.TONE_GLSL =')}`)(W);
  W.core.GLOSS_GLSL = Function('W', `return ${template(source01, 'const GLOSS_GLSL =')}`)(W);

  const bag = section(source03, 'const gridUniforms =', '\n  W.grid.uniforms =');
  const object = bag.slice(bag.indexOf('{')).trim().replace(/;$/, '');
  const uniforms = Function('THREE', 'W', `return (${object})`)(THREE, W);
  const transition = section(source03, 'const sceneUniforms =', '  W.grid.sceneTransition =');
  const sceneRevealGLSL = Function('THREE', 'W', 'gridUniforms',
    `${transition}\nreturn sceneRevealGLSL`)(THREE, W, uniforms);
  const fragmentShader = Function('W', 'sceneRevealGLSL',
    `return W.core.TONE_GLSL + ${template(source03, 'const GRID_FRAG =')}`)(W, sceneRevealGLSL);

  // Exactly the production painted-grid node material and shader declarations.
  const material = createGridMaterial({
    THREE, nodes, tsl, uniforms, fragmentShader, exposure,
  });
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), material);
  grid.rotation.x = -Math.PI / 2;
  grid.position.y = -.002;
  scene.add(grid);
  // Keep the swapchain's native sRGB output policy. Forcing LinearSRGB here
  // makes Three copy the canvas to convert it, but this addon only exposes
  // RenderAttachment usage for acquired surface textures.
  renderer.toneMapping = THREE.NoToneMapping;
  scene.background = W.core.COL_BG;

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

  // Reuse the exact rounded tile geometry and baked vertex color from engine03.
  // The material here remains a simple physical stand-in for its much larger
  // node lighting/shadow owner.
  const bake = section(source03, 'function tileBakeShade(', '  W.grid =');
  const geometrySource = section(source03, 'const CS = 6, FSEG = 1, DRAFT = 3;',
    '    const mat = new THREE.MeshPhysicalMaterial');
  const tileGeometry = Function('THREE', 'W',
    `${bake}\nconst T = W.core.TILE;\n${geometrySource}\nreturn tileGeometry();`)(THREE, W);
  const tileMaterial = new THREE.MeshPhysicalMaterial({
    color: W.core.COL_GRID_FILL.clone(), roughness: tile.ROUGH,
    metalness: 0, clearcoat: tile.CLEARCOAT, vertexColors: true,
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
      grid.geometry.dispose(); material.dispose(); tileGeometry.dispose(); tileMaterial.dispose();
      W.grid.groupFootprint.uniforms.uDragGroupMap.value.dispose();
      W.grid.groupGardenReveal.dispose();
    },
  };
}
