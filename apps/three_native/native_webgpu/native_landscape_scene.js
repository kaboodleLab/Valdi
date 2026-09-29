import { meadowNoise, meadowRoom } from './native_meadow_math.mjs';
import { createNativeMeadowScene } from './native_meadow_scene.js';

// Each environment lives outside SPAOS's tile and floor authority. A switch
// replaces only scenery; the World channel continues to own occupied cells.
export function createNativeLandscapeScene(THREE, kind) {
  if (kind === 'classic') return null;
  if (kind === 'meadow') return createNativeMeadowScene(THREE);

  const root = new THREE.Group();
  root.name = `native-${kind}-landscape`;
  const occupied = new Set();
  let holeX = 1, holeZ = 0;
  const geometry = new THREE.PlaneGeometry(32, 32, 160, 160);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.getAttribute('position');
  const colors = new Float32Array(positions.count * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.MeshBasicMaterial({ vertexColors: true,
    toneMapped: false, side: THREE.DoubleSide });
  const surface = new THREE.Mesh(geometry, material);
  surface.frustumCulled = false;
  root.add(surface);

  const craters = Array.from({ length: 36 }, (_, index) => {
    const turn = index * 2.39996323;
    const radius = 1.2 + Math.sqrt(index / 36) * 13;
    return { x: Math.cos(turn) * radius, z: Math.sin(turn) * radius,
      radius: .4 + .8 * meadowNoise(index * 4.1, index * 9.7) };
  });
  const smooth = (low, high, value) => {
    const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
    return t * t * (3 - 2 * t);
  };
  function elevation(x, z) {
    if (kind === 'desert') {
      const dunes = Math.sin(x * .52 + Math.sin(z * .38) * 1.7) *
        Math.cos(z * .37 - x * .08);
      const ripples = Math.sin(x * 7.3 + z * 2.1) * .012;
      return .035 + .18 * (.5 + .5 * dunes) + ripples;
    }
    if (kind === 'tropical') {
      const radius = Math.hypot(x * .88, z * 1.1);
      const island = Math.max(0, 1 - radius / 6);
      return .008 + island * island * (.25 + .08 * meadowNoise(x * .8, z * .8));
    }
    let height = .018 + .035 * meadowNoise(x * .7, z * .7);
    for (const crater of craters) {
      const distance = Math.hypot(x - crater.x, z - crater.z) / crater.radius;
      if (distance > 1.5) continue;
      height += crater.radius * (-.18 * Math.exp(-distance * distance * 3.8) +
        .07 * Math.exp(-Math.pow((distance - 1) * 7, 2)));
    }
    return height;
  }
  const field = (x, z) => .006 + elevation(x, z) *
    meadowRoom(x, z, occupied) *
    Math.min(1, .6 + .4 * Math.hypot(x - holeX, z - holeZ));
  function rebuild() {
    for (let index = 0; index < positions.count; ++index) {
      const x = positions.getX(index), z = positions.getZ(index);
      const height = field(x, z);
      positions.setY(index, height);
      const grain = .82 + .28 * meadowNoise(x * 8.7, z * 8.7);
      let red, green, blue;
      if (kind === 'desert') {
        red = .66 * grain; green = .48 * grain; blue = .28 * grain;
      } else if (kind === 'tropical') {
        const island = Math.max(0, 1 - Math.hypot(x * .88, z * 1.1) / 6);
        const shore = smooth(.16, .30, island);
        const vegetation = smooth(.36, .50, island);
        red = (.02 * (1 - shore) + .69 * shore * (1 - vegetation) +
          .08 * vegetation) * grain;
        green = (.30 * (1 - shore) + .57 * shore * (1 - vegetation) +
          .25 * vegetation) * grain;
        blue = (.40 * (1 - shore) + .33 * shore * (1 - vegetation) +
          .09 * vegetation) * grain;
      } else {
        red = .37 * grain; green = .39 * grain; blue = .42 * grain;
      }
      colors[index * 3] = red;
      colors[index * 3 + 1] = green;
      colors[index * 3 + 2] = blue;
    }
    positions.needsUpdate = true;
    geometry.getAttribute('color').needsUpdate = true;
    geometry.computeVertexNormals();
  }
  rebuild();
  return {
    root,
    heightAt: field,
    setOccupiedCells(cells) {
      if (cells.size === occupied.size && [...cells].every(key => occupied.has(key)))
        return false;
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
    stats: () => ({ terrainVertices: positions.count, blades: 0 }),
    dispose() { geometry.dispose(); material.dispose(); },
  };
}
