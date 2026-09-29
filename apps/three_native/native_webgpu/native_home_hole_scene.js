import { WORLD_HOLE_BELL, createWorldHoleBellGeometry }
  from '@worldos/world-hole-bell';
import { worldHomeHoleAperture, worldHomeHoleVisible }
  from '@worldos/world-home-hole-appearance';

// Native's tile adapter cuts the shared mouth out of the authored tile top.
// The bell profile, rim normals and depth shade come from browser WorldOS.
function holedTileGeometry(THREE, tileGeometry, tileH) {
  const original = tileGeometry;
  const src = original.attributes;
  const oldCount = src.position.count;
  const indices = Array.from(original.index.array);
  const center = oldCount - 1;
  const topTriangles = indices.filter(index => index === center).length;
  if (topTriangles < 12 || indices.slice(-topTriangles * 3)
    .filter(index => index === center).length !== topTriangles)
    throw new Error('WorldOS tile top fan changed; cannot cut the hole safely');
  const top = center - topTriangles;
  const count = oldCount + topTriangles;
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const color = new Float32Array(count * 3);
  const bed = new Float32Array(count);
  position.set(src.position.array);
  normal.set(src.normal.array);
  color.set(src.color.array);
  bed.set(src.aBed.array);
  for (let i = 0; i < topTriangles; i++) {
    const x = src.position.getX(top + i), z = src.position.getZ(top + i);
    const theta = Math.atan2(z, x);
    const p = (oldCount + i) * 3;
    position[p] = WORLD_HOLE_BELL.R * Math.cos(theta);
    position[p + 1] = tileH;
    position[p + 2] = WORLD_HOLE_BELL.R * Math.sin(theta);
    normal[p + 1] = 1;
    color[p] = color[p + 1] = color[p + 2] = 1;
  }
  indices.length -= topTriangles * 3;
  for (let i = 0; i < topTriangles; i++) {
    const next = (i + 1) % topTriangles;
    const outer = top + i, outerNext = top + next;
    const inner = oldCount + i, innerNext = oldCount + next;
    indices.push(outer, inner, outerNext, outerNext, inner, innerNext);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
  geometry.setAttribute('aBed', new THREE.BufferAttribute(bed, 1));
  geometry.setIndex(indices);
  return geometry;
}

export function createNativeHomeHoleScene({ THREE, root, tileGeometry,
  tileMaterial, tileH }) {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(holedTileGeometry(THREE, tileGeometry, tileH),
    tileMaterial);
  const bellMaterial = tileMaterial.clone();
  bellMaterial.side = THREE.DoubleSide;
  const bell = new THREE.Mesh(createWorldHoleBellGeometry(THREE), bellMaterial);
  bell.position.y = tileH + .0005;
  const throatMaterial = new THREE.MeshBasicMaterial({ color: 0x19191d,
    side: THREE.BackSide });
  const throat = new THREE.Mesh(new THREE.CylinderGeometry(
    WORLD_HOLE_BELL.rT, WORLD_HOLE_BELL.rT, .62, 56, 1, true), throatMaterial);
  throat.position.y = tileH - WORLD_HOLE_BELL.D - .31;
  const floorMaterial = new THREE.MeshBasicMaterial({ color: 0x101014 });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(WORLD_HOLE_BELL.rT, 56),
    floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = tileH - WORLD_HOLE_BELL.D - .62;
  group.add(ring, bell, throat, floor);
  group.visible = false;
  root.add(group);
  return {
    group, ring,
    set(x, z, appearance) {
      const aperture = worldHomeHoleAperture(appearance);
      group.position.set(x, 0, z);
      group.visible = worldHomeHoleVisible(aperture);
      return aperture;
    },
    dispose() {
      root.remove(group);
      ring.geometry.dispose(); bell.geometry.dispose();
      throat.geometry.dispose(); floor.geometry.dispose();
      bellMaterial.dispose(); throatMaterial.dispose(); floorMaterial.dispose();
    },
  };
}
