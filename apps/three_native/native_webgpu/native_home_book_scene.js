import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { WORLD_BOOK, createWorldHomeBookScene, stepWorldHomeBook, solveWorldHomeBookPose }
  from '@worldos/world-book-rig';

// The book's live presence belongs to World, not to SPAOS's saved floor rows.
// Browser World uses the same state and pose laws with its printed page shaders.
export function createNativeHomeBookScene({ THREE, root, gridY, makeText,
  tileGeometry, tileMaterial }) {
  const linen = new THREE.MeshStandardMaterial({ color: 0x5b1f22, roughness: .86 });
  const paper = new THREE.MeshStandardMaterial({ color: 0xf7f2e6, roughness: 1,
    side: THREE.DoubleSide });
  const edge = new THREE.MeshLambertMaterial({ color: 0xece2c8 });
  const homeBookScene = createWorldHomeBookScene(THREE, {
    root, makeLinenMaterial: () => linen,
    makePageMaterial: () => ({ mat: paper }), edgeMaterial: edge,
    shadowGeometry: new THREE.CircleGeometry(.32, 32),
    shadowMaterial: new THREE.MeshBasicMaterial({ color: 0x211d1b,
      transparent: true, opacity: .28, depthWrite: false }),
    setShadowOpacity: (shadow, opacity) => {
      shadow.material.opacity = Math.min(.4, .28 * opacity);
    },
    RoundedBoxGeometry,
  });
  const { group, rig, shadow } = homeBookScene;
  const title = makeText('ENCYCLOPEDIA', [214, 178, 108]);
  const titleMesh = new THREE.Mesh(new THREE.PlaneGeometry(.31, .05),
    new THREE.MeshBasicMaterial({ map: title.texture, transparent: true,
      depthWrite: false, toneMapped: false }));
  titleMesh.rotation.x = -Math.PI / 2;
  titleMesh.position.set(WORLD_BOOK.width / 2 + WORLD_BOOK.spineWidth * .4,
    WORLD_BOOK.coverThickness / 2 + .002, 0);
  rig.frontPivot.add(titleMesh);
  const tileMesh = new THREE.Mesh(tileGeometry, tileMaterial);
  root.add(tileMesh);
  tileMesh.visible = false;
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
      homeBookScene.applyPose(pose);
      tileMesh.position.set(at.x, 0, at.z);
      tileMesh.visible = pose.visible;
    },
    dispose() {
      homeBookScene.dispose();
      root.remove(tileMesh);
      shadow.geometry.dispose();
      title.texture.dispose();
      titleMesh.material.dispose();
      linen.dispose(); paper.dispose(); edge.dispose(); shadow.material.dispose();
    },
  };
}
