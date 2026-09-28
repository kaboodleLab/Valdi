import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { WORLD_BOOK, createWorldBookRig, stepWorldHomeBook, solveWorldHomeBookPose }
  from '@worldos/world-book-rig';

// The book's live presence belongs to World, not to SPAOS's saved floor rows.
// Browser World uses the same state and pose laws with its printed page shaders.
export function createNativeHomeBookScene({ THREE, root, gridY, makeText,
  tileGeometry, tileMaterial }) {
  const linen = new THREE.MeshStandardMaterial({ color: 0x5b1f22, roughness: .86 });
  const paper = new THREE.MeshStandardMaterial({ color: 0xf7f2e6, roughness: 1,
    side: THREE.DoubleSide });
  const edge = new THREE.MeshLambertMaterial({ color: 0xece2c8 });
  const group = new THREE.Group();
  const tilt = new THREE.Group();
  group.add(tilt);
  const rig = createWorldBookRig(THREE, {
    group: tilt, makeLinenMaterial: () => linen,
    makePageMaterial: () => ({ mat: paper }), edgeMaterial: edge,
    RoundedBoxGeometry,
  });
  const title = makeText('ENCYCLOPEDIA', [214, 178, 108]);
  const titleMesh = new THREE.Mesh(new THREE.PlaneGeometry(.31, .05),
    new THREE.MeshBasicMaterial({ map: title.texture, transparent: true,
      depthWrite: false, toneMapped: false }));
  titleMesh.rotation.x = -Math.PI / 2;
  titleMesh.position.set(WORLD_BOOK.width / 2 + WORLD_BOOK.spineWidth * .4,
    WORLD_BOOK.coverThickness / 2 + .002, 0);
  rig.frontPivot.add(titleMesh);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(.32, 32),
    new THREE.MeshBasicMaterial({ color: 0x211d1b, transparent: true,
      opacity: .28, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  const tileMesh = new THREE.Mesh(tileGeometry, tileMaterial);
  root.add(group, shadow, tileMesh);
  group.visible = shadow.visible = tileMesh.visible = false;
  let tile = null;
  let state = { presence: 0, held: 0, open: 0 };
  return {
    group,
    get tile() { return tile; },
    toggle(nextTile) { tile = tile ? null : nextTile; },
    update(dt) {
      state = stepWorldHomeBook(state, { active: !!tile }, dt);
      if (!tile && state.presence <= .003) {
        group.visible = shadow.visible = tileMesh.visible = false;
        return;
      }
      const at = tile || group.userData.lastTile;
      if (!at) return;
      group.userData.lastTile = at;
      const pose = solveWorldHomeBookPose({ x: at.x, z: at.z, gridY,
        ...state });
      group.position.set(pose.x, pose.y, pose.z);
      group.scale.setScalar(pose.scale);
      tilt.rotation.x = pose.tiltX;
      rig.frontPivot.rotation.z = pose.coverAngle;
      group.visible = pose.visible;
      shadow.visible = pose.shadowVisible;
      shadow.position.set(pose.shadowX, pose.shadowY, pose.shadowZ);
      shadow.scale.set(1.05 * state.presence, .85 * state.presence, 1);
      shadow.material.opacity = Math.min(.4, .28 * pose.shadowOpacity);
      tileMesh.position.set(at.x, 0, at.z);
      tileMesh.visible = pose.visible;
    },
    dispose() {
      root.remove(group, shadow, tileMesh);
      group.traverse(node => node.geometry?.dispose());
      shadow.geometry.dispose();
      title.texture.dispose();
      titleMesh.material.dispose();
      linen.dispose(); paper.dispose(); edge.dispose(); shadow.material.dispose();
    },
  };
}
