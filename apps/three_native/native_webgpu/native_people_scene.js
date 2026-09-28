import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { TEAM } from '@worldos/people-roster';
import { createCharacterWorld } from '@worldos/character-world';

// A separate WorldOS scene lane. Keep its assets, visibility and camera state
// behind one boundary so the home floor can keep receiving SPAOS updates while
// People is open. A live roster can replace the sample rows through setPeople.
const SAMPLE_POSITIONS = {
  will: [-2.1, .6], matt: [.75, -1.45], moritz: [.4, 1.65],
  andrew: [-4.2, -.8], brian: [2.35, .6], charlie: [-1.45, 1.65],
  dwayne: [1.8, -.15], kylie: [4.2, 1.65], ben: [-3.05, .35],
  sandy: [3.05, -2.05], ahmad: [.9, 2.25],
};
const SAMPLE_PEOPLE = TEAM.map(person => ({
  id: person.id, name: person.name,
  model: `person-${['will', 'matt', 'moritz', 'andrew', 'brian', 'ahmad'].includes(person.id)
    ? person.id : 'worker'}`,
  x: SAMPLE_POSITIONS[person.id][0], z: SAMPLE_POSITIONS[person.id][1],
}));

// WorldOS's custom character rigs retarget the worker's authored animation
// onto each person's bind pose. This narrow port uses the same quaternion and
// hip-position alignment for StandingIdle and Walk. The movement simulation
// itself is WorldOS's character-world.js, bundled without its browser shell.
function retargetClip(THREE, source, target, clipName) {
  const clip = source.animations.find(item => item.name === clipName);
  if (!clip) throw new Error(`WorldOS worker has no ${clipName} clip`);
  const bones = root => {
    const found = new Map();
    root.traverse(object => { if (object.isBone) found.set(object.name, object); });
    return found;
  };
  const from = bones(source.scene);
  const to = bones(target);
  const tracks = [];
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    const name = track.name.slice(0, dot);
    const property = track.name.slice(dot + 1);
    const a = from.get(name), b = to.get(name);
    if (!a || !b) continue;
    const alignment = b.quaternion.clone().multiply(a.quaternion.clone().invert());
    if (property === 'quaternion') {
      const values = new Float32Array(track.values.length);
      const q = new THREE.Quaternion();
      for (let i = 0; i < values.length; i += 4)
        q.fromArray(track.values, i).premultiply(alignment).normalize().toArray(values, i);
      tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`,
        track.times, values, track.getInterpolation()));
    } else if (property === 'position' && name === 'mixamorigHips') {
      const values = new Float32Array(track.values.length);
      const p = new THREE.Vector3();
      const ratio = b.position.length() / Math.max(a.position.length(), 1e-6);
      for (let i = 0; i < values.length; i += 3)
        p.fromArray(track.values, i).sub(a.position).multiplyScalar(ratio)
          .applyQuaternion(alignment).add(b.position).toArray(values, i);
      tracks.push(new THREE.VectorKeyframeTrack(`${name}.position`,
        track.times, values, track.getInterpolation()));
    }
  }
  if (!tracks.length) throw new Error(`WorldOS character has no matching ${clipName} skeleton`);
  return new THREE.AnimationClip(clipName, clip.duration, tracks);
}

// SkeletonUtils gives each skinned mesh its own palette even when all clothing
// meshes use the same bones. WorldOS's shareCharacterSkeletons makes one
// palette per equivalent bind, avoiding duplicate GPU updates per avatar.
function shareSkeletonPalettes(root) {
  const palettes = [];
  let shared = 0;
  root.traverse(mesh => {
    const skin = mesh.skeleton;
    if (!mesh.isSkinnedMesh || !skin) return;
    const same = palettes.find(other => other.bones.length === skin.bones.length &&
      other.boneInverses.length === skin.boneInverses.length &&
      other.bones.every((bone, index) => bone === skin.bones[index] &&
        other.boneInverses[index].equals(skin.boneInverses[index])));
    if (same) { mesh.skeleton = same; shared++; }
    else palettes.push(skin);
  });
  return shared;
}

export function createNativePeopleScene({ THREE, scene, camera, tileGeometry,
  makeText, loadModel, stage, onFocus }) {
  const root = new THREE.Group();
  root.name = 'WorldOS People';
  root.visible = false;
  scene.add(root);
  const actors = new Map();
  const models = new Map();
  const loading = new Map();
  const portalLabels = [];
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120),
    new THREE.MeshBasicMaterial({ color: 0xf0efed, toneMapped: false }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -.09;
  root.add(floor);

  const white = new THREE.MeshPhysicalMaterial({ color: 0xfafaf8, roughness: .22,
    metalness: 0, clearcoat: .75, clearcoatRoughness: .18 });
  const hole = new THREE.MeshBasicMaterial({ color: 0xc6c8c8, toneMapped: false });
  function portal(x, z, title, memory = false) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    root.add(group);
    const tile = new THREE.Mesh(tileGeometry, white);
    tile.scale.set(1.13, 1, 1.13);
    group.add(tile);
    if (memory) {
      const well = new THREE.Mesh(new THREE.CircleGeometry(.34, 48), hole);
      well.rotation.x = -Math.PI / 2;
      well.position.y = .025;
      group.add(well);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(.34, .055, 16, 64), white);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = .03;
      group.add(rim);
    }
    const tag = makeLabel(title, x, .07, z + .72, true);
    root.add(tag);
    portalLabels.push(tag);
    return group;
  }
  function makeLabel(value, x, y, z, dark = false) {
    const { texture, width, height } = makeText(value, dark ? [71, 73, 75] : [77, 79, 80]);
    const label = new THREE.Group();
    const size = .15;
    const w = Math.min(.95, size * width / height);
    const plate = new THREE.Mesh(new THREE.CircleGeometry(.5, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true,
        opacity: dark ? .82 : .66, depthWrite: false, toneMapped: false }));
    plate.scale.set(w + .18, size + .075, 1);
    const letters = new THREE.Mesh(new THREE.PlaneGeometry(w, size),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true,
        depthWrite: false, toneMapped: false }));
    letters.position.z = .002;
    label.add(plate, letters);
    label.position.set(x, y, z);
    label.userData.texture = texture;
    label.lookAt(camera.position);
    return label;
  }
  const library = portal(-.15, -.18, 'BOOKS');
  portal(.25, 1.35, 'MEMORIES', true);
  // A narrow native model of the closed book in 20-holes-and-labels.js. Its
  // readable pages, curling shader and interactions still belong to WorldOS.
  const book = new THREE.Group();
  book.rotation.y = -.18;
  library.add(book);
  const cover = new THREE.MeshStandardMaterial({ color: 0x46513b, roughness: .82 });
  const spine = new THREE.MeshStandardMaterial({ color: 0x354131, roughness: .88 });
  const pages = new THREE.MeshStandardMaterial({ color: 0xece2c8, roughness: 1 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xbba376, roughness: .62,
    metalness: .16 });
  function bookBox(w, h, d, y, material, x = 0) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, 0);
    book.add(mesh);
    return mesh;
  }
  bookBox(.52, .025, .64, .055, cover);
  bookBox(.49, .07, .61, .102, pages);
  bookBox(.52, .025, .64, .15, cover);
  bookBox(.045, .125, .64, .103, spine, -.26);
  const crest = new THREE.Mesh(new THREE.RingGeometry(.065, .08, 32), gold);
  crest.rotation.x = -Math.PI / 2;
  crest.position.y = .164;
  book.add(crest);

  function modelFor(name) {
    if (models.has(name)) return Promise.resolve(models.get(name));
    if (loading.has(name)) return loading.get(name);
    const pending = loadModel(name).then(model => {
      models.set(name, model);
      loading.delete(name);
      return model;
    }).catch(error => { loading.delete(name); throw error; });
    loading.set(name, pending);
    return pending;
  }
  let open = false;
  let source = 'sample';
  let currentRows = SAMPLE_PEOPLE;
  let selectedId = null;
  let visualQueue = Promise.resolve();
  const desired = new Map();
  const present = new Map();
  const departures = new Map();
  function disposeLabel(label) {
    root.remove(label);
    label.userData.texture?.dispose();
    label.traverse(object => {
      object.geometry?.dispose();
      object.material?.dispose();
    });
  }
  function updateName(id, row) {
    const actor = actors.get(id);
    const name = row.name || id;
    if (!actor || actor.name === name) return;
    disposeLabel(actor.label);
    actor.label = makeLabel(name, actor.group.position.x, .045,
      actor.group.position.z + .31);
    actor.label.children[0].material.opacity = id === selectedId ? .94 : .66;
    actor.label.visible = actor.group.visible;
    root.add(actor.label);
    actor.name = name;
  }
  function createVisual({ id, asset }) {
    // WorldOS's mock arrivals load one person at a time. Keep the same limit
    // so eleven GLBs do not all parse and upload during a single draw.
    const pending = visualQueue.then(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
      const [model, worker] = await Promise.all([modelFor(asset), modelFor('person-worker')]);
      const body = cloneSkeleton(model.scene);
      const palettesShared = shareSkeletonPalettes(body);
      const idleClip = model.animations.find(clip => clip.name === 'StandingIdle') ||
        retargetClip(THREE, worker, body, 'StandingIdle');
      const walkClip = model.animations.find(clip => clip.name === 'Walk') ||
        (model.animations.length === 1 ? model.animations[0] : null) ||
        retargetClip(THREE, worker, body, 'Walk');
      const mixer = new THREE.AnimationMixer(body);
      const idle = mixer.clipAction(idleClip), walk = mixer.clipAction(walkClip);
      idle.play();
      mixer.update(0);
      const bounds = new THREE.Box3().setFromObject(body);
      const size = bounds.getSize(new THREE.Vector3());
      body.scale.setScalar(1.12 / size.y);
      const fitted = new THREE.Box3().setFromObject(body);
      body.position.set(-(fitted.min.x + fitted.max.x) / 2, -.065 - fitted.min.y,
        -(fitted.min.z + fitted.max.z) / 2);
      const group = new THREE.Group();
      group.add(body);
      const shadow = new THREE.Mesh(new THREE.CircleGeometry(.24, 32),
        new THREE.MeshBasicMaterial({ color: 0x353539, transparent: true,
          opacity: .18, depthWrite: false, toneMapped: false }));
      shadow.rotation.x = -Math.PI / 2;
      shadow.scale.y = .42;
      shadow.position.y = -.075;
      group.add(shadow);
      const name = desired.get(id)?.name || id;
      const actor = { group, label: makeLabel(name, 0, .045, 0), name };
      group.visible = actor.label.visible = false;
      root.add(group, actor.label);
      actors.set(id, actor);
      actor.label.children[0].material.opacity = id === selectedId ? .94 : .66;
      stage(`WorldOS People model loaded: ${name} (${asset})`);
      if (globalThis.__nativePeopleDiagnostics)
        stage(`WorldOS People skeleton palettes shared: ${name} ${palettesShared}`);
      let action = idle;
      return {
        update(state, dt) {
          group.position.set(state.x, 0, state.z);
          group.rotation.y = state.heading;
          actor.label.position.set(state.x, .045, state.z + .31);
          group.visible = actor.label.visible = state.alpha > .03;
          const next = state.speed > .02 ? walk : idle;
          if (next !== action) {
            next.reset().fadeIn(.18).play();
            action.fadeOut(.18);
            action = next;
          }
          if (next === walk) walk.timeScale = Math.max(.2, state.speed / .38);
          mixer.update(dt);
        },
        dispose() {
          root.remove(group);
          disposeLabel(actor.label);
          shadow.geometry.dispose();
          shadow.material.dispose();
          mixer.stopAllAction();
          mixer.uncacheRoot(body);
          if (actors.get(id) === actor) actors.delete(id);
        },
      };
    });
    visualQueue = pending.then(() => {}, () => {});
    return pending;
  }
  const world = createCharacterWorld({
    createVisual,
    getObstacles: () => [{ x: -.15, z: -.18, half: .65 },
      { x: .25, z: 1.35, half: .65 }],
    getVisibility: () => open ? 1 : 0,
    canMove: () => open,
    withinView: point => Math.abs(point.x) < 4.8 && Math.abs(point.z) < 3.3,
  });
  function setPeople(rows, { sample = false } = {}) {
    source = sample ? 'sample' : 'live';
    currentRows = rows;
    desired.clear();
    for (const row of rows) {
      if (typeof row?.id !== 'string' || typeof row?.model !== 'string' ||
          !Number.isFinite(row.x) || !Number.isFinite(row.z)) continue;
      desired.set(row.id, row);
    }
    if (selectedId && !desired.has(selectedId)) select(null);
    if (!open) return;
    for (const [id, row] of desired) {
      const leaving = departures.get(id);
      if (leaving) {
        clearTimeout(leaving.timer);
        departures.delete(id);
        if (leaving.model !== row.model) world.remove(id);
      }
      const previous = present.get(id);
      if (previous === row.model) { updateName(id, row); continue; }
      if (previous) world.remove(id);
      present.set(id, row.model);
      world.setOnline(id, true, { asset: row.model, x: row.x, z: row.z });
    }
    for (const [id, model] of present) {
      if (desired.has(id)) continue;
      world.setOnline(id, false);
      present.delete(id);
      const timer = setTimeout(() => {
        departures.delete(id);
        if (!desired.has(id)) world.remove(id);
      }, 9000);
      departures.set(id, { timer, model });
    }
  }
  function useSample() { setPeople(SAMPLE_PEOPLE, { sample: true }); }
  function select(id) {
    selectedId = id && desired.has(id) ? id : null;
    for (const [key, actor] of actors)
      actor.label.children[0].material.opacity = key === selectedId ? .94 : .66;
    return selectedId;
  }
  function focus(id) {
    const row = desired.get(id);
    if (!row) return false;
    select(id);
    const state = world.snapshot().find(item => item.id === id);
    onFocus?.(state?.x ?? row.x, state?.z ?? row.z);
    stage(`WorldOS People focused: ${row.name || id}`);
    return true;
  }
  function pick(raycaster) {
    let nearest = null;
    for (const [id, actor] of actors) {
      if (!actor.group.visible) continue;
      const hits = raycaster.intersectObjects([actor.group, actor.label], true);
      if (hits.length && (!nearest || hits[0].distance < nearest.distance))
        nearest = { id, distance: hits[0].distance };
    }
    return nearest?.id ?? null;
  }
  function enter() {
    if (open) return;
    open = root.visible = true;
    setPeople(currentRows, { sample: source === 'sample' });
    stage(`WorldOS People ${source} opened`);
  }
  function leave() { open = root.visible = false; }
  function faceCamera() {
    for (const actor of actors.values()) actor.label.lookAt(camera.position);
    for (const tag of portalLabels) tag.lookAt(camera.position);
  }
  let ticks = 0;
  function tick(dt) {
    if (!open) return;
    world.tick(performance.now(), dt);
    if (globalThis.__nativePeopleDiagnostics && ++ticks % 120 === 0) {
      const states = world.snapshot();
      stage(`WorldOS People simulation: ${states.filter(row => row.moving).length} walking, ` +
        `${states.filter(row => row.phase === 'online').length} online`);
    }
  }
  return { root, enter, leave, isOpen: () => open, setPeople, useSample,
    rows: () => [...desired.values()], source: () => source, select, focus, pick,
    setPaused: value => world.setPaused(value), isPaused: () => world.isPaused(),
    faceCamera, tick };
}
