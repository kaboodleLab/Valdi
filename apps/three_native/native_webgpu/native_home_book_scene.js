import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { WORLD_BOOK, createWorldHomeBookScene, stepWorldHomeBook, solveWorldHomeBookPose }
  from '@worldos/world-book-rig';
import { paginateWorldBookArticle } from '@worldos/world-book-action';

// The book's live presence belongs to World, not to SPAOS's saved floor rows.
// Browser World uses the same state and pose laws with its printed page shaders.
export function createNativeHomeBookScene({ THREE, root, gridY, makeText,
  tileGeometry, tileMaterial }) {
  const linen = new THREE.MeshStandardMaterial({ color: 0x5b1f22, roughness: .86 });
  const paper = new THREE.MeshBasicMaterial({ color: 0xf7f2e6,
    side: THREE.DoubleSide, toneMapped: false });
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
  let focused = false;
  let pages = [];
  let pageIndex = 0;
  const print = [];
  const topPage = rig.pages[rig.pages.length - 1].mesh;
  function clearPrint() {
    for (const { mesh, texture } of print) {
      topPage.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
      texture.dispose();
    }
    print.length = 0;
  }
  function printLine(value, line, height, color) {
    const { texture, width, height: pixelsHigh } = makeText(value, color);
    const planeWidth = Math.min(.35, width / pixelsHigh * height);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(planeWidth, height),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true,
        depthWrite: false, toneMapped: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(.027 + planeWidth / 2, .002, -.205 + line * .052);
    topPage.add(mesh);
    print.push({ mesh, texture });
  }
  function printPage() {
    clearPrint();
    if (!pages.length) return;
    const lines = pages[pageIndex];
    lines.forEach((line, i) => {
      if (line) printLine(line, i, i === 0 && pageIndex === 0 ? .036 : .024,
        i === 0 && pageIndex === 0 ? [55, 24, 24] : [28, 25, 23]);
    });
    printLine(`${pageIndex + 1} / ${pages.length}`, 8, .018, [70, 64, 55]);
  }
  let state = { presence: 0, held: 0, open: 0 };
  return {
    group,
    get tile() { return tile; },
    get focused() { return focused; },
    get page() { return pageIndex + 1; },
    get pageCount() { return pages.length; },
    toggle(nextTile) {
      tile = tile ? null : nextTile;
      focused = false;
      if (!tile) { pages = []; pageIndex = 0; clearPrint(); }
    },
    open({ tile: nextTile, subject, article }) {
      tile = nextTile;
      pages = paginateWorldBookArticle({ subject, article });
      pageIndex = 0;
      focused = true;
      printPage();
    },
    setFocused(value) {
      if (focused && !value && pages.length) {
        pageIndex = 0;
        printPage();
      }
      focused = !!tile && !!value;
    },
    nextPage() {
      if (pageIndex + 1 >= pages.length) return false;
      ++pageIndex;
      printPage();
      return true;
    },
    update(dt) {
      state = stepWorldHomeBook(state, { active: !!tile,
        focus: focused ? 1 : 0 }, dt);
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
      clearPrint();
      homeBookScene.dispose();
      root.remove(tileMesh);
      shadow.geometry.dispose();
      title.texture.dispose();
      titleMesh.material.dispose();
      linen.dispose(); paper.dispose(); edge.dispose(); shadow.material.dispose();
    },
  };
}
