import { meadowHill, meadowMemoryLowland, meadowNoise, meadowRoom,
  meadowSeed } from './native_meadow_math.mjs';

// A bounded native adapter for WorldOS's Rolling meadow. SPAOS still owns the
// floor and tiles. This scene only draws terrain and blades around their cells.
export function createNativeMeadowScene(THREE) {
  const root = new THREE.Group();
  root.name = 'nativeRollingMeadow';
  const occupied = new Set();
  const size = 24, terrainSegments = 160, density = 24, chunkSide = 4;
  // The native grid bed is at y=0; the browser World's bed is 0.5 - TILE.BED.
  // Keep the lowland visible over that bed while its white tiles stand above it.
  const base = .006;
  let holeX = 1, holeZ = 0;
  const field = (x, z) => base + meadowHill(x, z) *
    meadowMemoryLowland(x, z, holeX, holeZ) * meadowRoom(x, z, occupied);

  const geometry = new THREE.PlaneGeometry(size, size, terrainSegments, terrainSegments);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.getAttribute('position');
  const colors = new Float32Array(positions.count * 3);
  const turf = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: .94, metalness: 0, side: THREE.DoubleSide,
  }));
  turf.name = 'meadowHills';
  turf.frustumCulled = false;
  root.add(turf);
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  // The same five-vertex tapered ribbon as production ground-scenes.js.
  const bladeGeometry = new THREE.BufferGeometry();
  bladeGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -.5, 0, 0, .5, 0, 0, -.34, .55, 0, .34, .55, 0, 0, 1, 0,
  ], 3));
  bladeGeometry.setAttribute('normal', new THREE.Float32BufferAttribute([
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
  ], 3));
  bladeGeometry.setAttribute('color', new THREE.Float32BufferAttribute([
    .78, .78, .78, .78, .78, .78, 1.03, 1.03, 1.03,
    1.03, 1.03, 1.03, 1.35, 1.35, 1.35,
  ], 3));
  bladeGeometry.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
  const bladeMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true, side: THREE.DoubleSide, roughness: .86, metalness: 0,
  });
  const chunks = [];
  const bladeWidth = chunkSide * density;
  for (let cz = -size / 2; cz < size / 2; cz += chunkSide) {
    for (let cx = -size / 2; cx < size / 2; cx += chunkSide) {
      const mesh = new THREE.InstancedMesh(bladeGeometry, bladeMaterial,
        bladeWidth * bladeWidth);
      mesh.name = 'meadowGrass';
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx + chunkSide / 2,
        .65, cz + chunkSide / 2), 3.4);
      mesh.frustumCulled = true;
      mesh.castShadow = false;
      root.add(mesh);
      chunks.push({ mesh, cx, cz });
    }
  }
  const transform = new THREE.Object3D();
  const color = new THREE.Color();
  function rebuild() {
    for (let i = 0; i < positions.count; ++i) {
      const x = positions.getX(i), z = positions.getZ(i);
      positions.setY(i, field(x, z));
      const broad = meadowNoise(x * .55, z * .55);
      const fine = meadowNoise(x * 145, z * 145);
      const factor = .83 + .28 * fine;
      colors[i * 3] = (.038 * (1 - broad) + .115 * broad) * factor;
      colors[i * 3 + 1] = (.085 * (1 - broad) + .205 * broad) * factor;
      colors[i * 3 + 2] = (.025 * (1 - broad) + .060 * broad) * factor;
    }
    positions.needsUpdate = true;
    geometry.getAttribute('color').needsUpdate = true;
    geometry.computeVertexNormals();
    for (const { mesh, cx, cz } of chunks) {
      let count = 0;
      for (let iz = 0; iz < bladeWidth; ++iz) for (let ix = 0; ix < bladeWidth; ++ix) {
        const cellX = cx + (ix + .5) / density;
        const cellZ = cz + (iz + .5) / density;
        const seed = meadowSeed(cellX, cellZ);
        const x = cellX + (seed - .5) * .9 / density;
        const z = cellZ + (meadowSeed(cellX + 13.7, cellZ + 13.7) - .5) * .9 / density;
        const room = meadowRoom(x, z, occupied);
        if (room < .08) continue;
        const h = (.045 + .060 * seed) * room;
        transform.position.set(x, field(x, z), z);
        transform.rotation.set(0, seed * 41, 0);
        transform.scale.set(.022 + .018 * seed, h, 1);
        transform.updateMatrix();
        mesh.setMatrixAt(count, transform.matrix);
        const broad = meadowNoise(x * .55, z * .55);
        const shade = (.82 + .4 * seed);
        color.setRGB((.038 * (1 - broad) + .115 * broad) * shade,
          (.085 * (1 - broad) + .205 * broad) * shade,
          (.025 * (1 - broad) + .060 * broad) * shade);
        mesh.setColorAt(count, color);
        ++count;
      }
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
  rebuild();
  return {
    root,
    heightAt: field,
    setOccupiedCells(cells) {
      if (cells.size === occupied.size && [...cells].every(key => occupied.has(key))) return false;
      occupied.clear();
      for (const cell of cells) occupied.add(cell);
      rebuild();
      return true;
    },
    setHole(x, z) {
      if (x === holeX && z === holeZ) return;
      holeX = x; holeZ = z;
      rebuild();
    },
    dispose() {
      turf.material.dispose(); geometry.dispose();
      bladeMaterial.dispose(); bladeGeometry.dispose();
      for (const { mesh } of chunks) mesh.dispose();
    },
    stats: () => ({ blades: chunks.reduce((sum, { mesh }) => sum + mesh.count, 0),
      chunks: chunks.length, terrainVertices: positions.count }),
  };
}
