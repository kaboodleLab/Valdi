// WorldOS's two authored shell controls over the native Three scene. The
// browser World supplies its DOM chrome; Hermes has no DOM or canvas, so this
// small camera-fixed layer draws text into RGBA textures and uses the real
// WorldOS control artwork prepared alongside the GLBs.
import { WORLD_THEMES, worldTheme } from './native_world_themes.mjs';
const GLYPHS = {
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '-': [0, 0, 0, 31, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 12, 12],
  ':': [0, 12, 12, 0, 12, 12, 0],
  '/': [1, 2, 4, 8, 16, 0, 0],
  '0': [14, 17, 19, 21, 25, 17, 14],
  '1': [4, 12, 4, 4, 4, 4, 14],
  '2': [14, 17, 1, 2, 4, 8, 31],
  '3': [30, 1, 1, 14, 1, 1, 30],
  '4': [2, 6, 10, 18, 31, 2, 2],
  '5': [31, 16, 16, 30, 1, 1, 30],
  '6': [14, 16, 16, 30, 17, 17, 14],
  '7': [31, 1, 2, 4, 8, 8, 8],
  '8': [14, 17, 17, 14, 17, 17, 14],
  '9': [14, 17, 17, 15, 1, 1, 14],
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [28, 18, 17, 17, 17, 18, 28],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 18, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 19, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 21, 10],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
};

function textTexture(THREE, text, color, font) {
  const letters = String(text).toUpperCase().slice(0, 64);
  const glyphs = font?.entry.glyphs;
  const glyphWidth = character => glyphs?.[character]?.advance || 6;
  const width = Math.max(1, font ? [...letters].reduce((sum, c) => sum + glyphWidth(c), 0) :
    letters.length * 6 - 1);
  const height = font ? font.entry.cellHeight : 7;
  const pixels = new Uint8Array(width * height * 4);
  let pen = 0;
  for (const letter of letters) {
    if (font) {
      const glyph = glyphs[letter] || glyphs[' '];
      const top = height - glyph.height - 4;
      for (let y = 0; y < glyph.height; ++y) {
        for (let x = 0; x < glyph.width; ++x) {
          const source = ((glyph.y + y) * font.entry.width + glyph.x + x) * 4;
          const target = ((top + y) * width + pen + x) * 4;
          pixels[target] = color[0];
          pixels[target + 1] = color[1];
          pixels[target + 2] = color[2];
          pixels[target + 3] = font.pixels[source + 3];
        }
      }
      pen += glyph.advance;
      continue;
    }
    const rows = GLYPHS[letter] || GLYPHS[' '];
    for (let y = 0; y < 7; ++y) {
      for (let x = 0; x < 5; ++x) {
        if (!(rows[y] & (16 >> x))) continue;
        const offset = (y * width + pen + x) * 4;
        pixels[offset] = color[0];
        pixels[offset + 1] = color[1];
        pixels[offset + 2] = color[2];
        pixels[offset + 3] = 255;
      }
    }
    pen += 6;
  }
  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat);
  texture.flipY = true;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return { texture, width, height };
}

function nativeTextTexture(THREE, text, color) {
  const rendered = globalThis.__nativeRasterizeText(String(text).slice(0, 256));
  const { width, height } = rendered;
  const alpha = new Uint8Array(rendered.alpha);
  if (width < 1 || height < 1 || alpha.length !== width * height)
    throw new Error('Invalid native text bitmap');
  const pixels = new Uint8Array(width * height * 4);
  for (let index = 0; index < alpha.length; ++index) {
    const offset = index * 4;
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
    pixels[offset + 3] = alpha[index];
  }
  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat);
  texture.flipY = true;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return { texture, width, height };
}

export function createNativeText(THREE, manifest, readAsset) {
  const font = manifest.font ? { entry: manifest.font,
    pixels: new Uint8Array(readAsset(manifest.font.file)) } : null;
  const draw = (value, color) => typeof globalThis.__nativeRasterizeText === 'function' ?
    nativeTextTexture(THREE, value, color) : textTexture(THREE, value, color, font);
  const measured = new Map();
  draw.measure = (value, size) => {
    const text = String(value);
    if (!text) return 0;
    let ratio = measured.get(text);
    if (ratio === undefined) {
      if (typeof globalThis.__nativeMeasureText === 'function') {
        const letters = [...text];
        let pixels = 4, height = 1;
        for (let start = 0; start < letters.length; start += 200) {
          const metrics = globalThis.__nativeMeasureText(letters.slice(start, start + 200).join(''));
          pixels += Math.max(0, metrics.width - 4);
          height = metrics.height;
        }
        ratio = pixels / height;
      } else ratio = [...text].length * .55;
      if (measured.size >= 512) measured.clear();
      measured.set(text, ratio);
    }
    return ratio * size;
  };
  return draw;
}

export function createNativeShellHud({ THREE, scene, camera, manifest, readAsset,
  onBack, onPeople, onBook, onOpen, onSelectPerson, onFindPerson, onPausePeople,
  allowHomePeoplePanel = false, iconForApp, initialTheme = 'classic', onTheme, stage,
  makeText = createNativeText(THREE, manifest, readAsset) }) {
  const root = new THREE.Group();
  camera.add(root);
  scene.add(camera);
  const rows = [];
  const appCards = [];
  const appIcons = [];
  let allApps = [];
  let apps = [];
  let query = '';
  let width = 720;
  let height = 720;
  let units = 1;
  let open = false;
  let selectedTile = null;
  let selectedApp = 0;
  let page = 0;
  let minute = -1;
  let clock = null;
  let columns = 5;
  let pageRows = 3;
  let pageSize = columns * pageRows;
  let panelWidth = 820;
  let panelHeight = 486;
  let panelLeft = 0;
  let panelTop = 0;
  let cardWidth = 0;
  const cardHeight = 108;
  const cardPitchY = 120;
  let view = 'home';
  let themeOpen = false;
  let themeIndex = Math.max(0, WORLD_THEMES.findIndex(theme =>
    theme.key === worldTheme(initialTheme)));
  let peopleOpen = false;
  let peopleRows = [];
  let peopleSample = true;
  let peoplePaused = false;
  let peopleSelected = null;
  let peoplePage = 0;
  let peoplePageSize = 11;
  let peopleTop = 70;
  let peopleHeight = 0;
  const peopleWidth = 360;
  const peopleRowHeight = 34;
  const peopleLabels = [];
  const appName = app => typeof app.name === 'string' && app.name ? app.name : app.key;
  const matchesApp = app => appName(app).toLowerCase().includes(query) ||
    app.key.toLowerCase().includes(query);

  function plane(w, h, material, order = 1000) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.scale.set(w * units, h * units, 1);
    mesh.renderOrder = order;
    mesh.userData.previousUnits = units;
    root.add(mesh);
    return mesh;
  }
  function roundPlate(size) {
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(.5, 32), solid(0xffffff, .38));
    mesh.scale.set(size * units, size * units, 1);
    mesh.userData.previousUnits = units;
    mesh.renderOrder = 1000;
    root.add(mesh);
    return mesh;
  }
  function place(mesh, x, y) {
    mesh.position.set((x - width / 2) * units, (height / 2 - y) * units, -1);
  }
  function material(texture, opacity = 1) {
    return new THREE.MeshBasicMaterial({ map: texture, transparent: true,
      opacity, depthTest: false, depthWrite: false, toneMapped: false });
  }
  function solid(color, opacity) {
    return new THREE.MeshBasicMaterial({ color, transparent: true,
      opacity, depthTest: false, depthWrite: false, toneMapped: false });
  }
  function artwork(name, size) {
    const entry = manifest.controls?.[name];
    if (!entry) return null;
    const pixels = new Uint8Array(readAsset(entry.file));
    const texture = new THREE.DataTexture(pixels, entry.width, entry.height, THREE.RGBAFormat);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    const mesh = plane(size, size, material(texture), 1010);
    return mesh;
  }
  function label(value, x, y, size, color = [50, 49, 54], align = 'left') {
    const { texture, width: pixels, height: pixelsHigh } = makeText(value, color);
    const pixelScale = size / pixelsHigh;
    const labelWidth = pixels * pixelScale;
    const mesh = plane(labelWidth, size, material(texture), 1020);
    place(mesh, align === 'center' ? x : x + labelWidth / 2, y);
    mesh.userData.texture = texture;
    return mesh;
  }
  function removeLabel(mesh) {
    if (!mesh) return;
    root.remove(mesh);
    mesh.userData.texture?.dispose();
    mesh.material.dispose();
    mesh.geometry.dispose();
  }
  const backPlate = roundPlate(42);
  const peoplePlate = roundPlate(48);
  const themeButtonPlate = roundPlate(48);
  const bookPlate = roundPlate(48);
  const launcherPlate = roundPlate(48);
  const back = artwork('back', 36);
  if (back) back.scale.x = -back.scale.x;
  const launcher = artwork('launcher', 38);
  const peopleText = label('People', 0, 0, 12, [50, 49, 54], 'center');
  const themeButtonText = label('Theme', 0, 0, 12, [50, 49, 54], 'center');
  const bookText = label('Book', 0, 0, 12, [50, 49, 54], 'center');
  const peopleMark = label('Sample people', 0, 0, 10, [86, 84, 82], 'center');
  peopleMark.visible = false;
  const panel = plane(panelWidth, panelHeight, solid(0xf8f5f2, .97), 1001);
  const selectionPlate = plane(1, cardHeight,
    solid(0xdce6f0, .97), 1006);
  let header = label('Apps', 0, 0, 24);
  let searchMark = label('Search apps', 0, 0, 15, [103, 101, 99]);
  let pageMark = label('1/1', 0, 0, 14);
  panel.visible = header.visible = pageMark.visible = false;
  searchMark.visible = false;
  const peoplePanel = plane(peopleWidth, 100, solid(0xf8f5f2, .97), 1001);
  const themeWidth = 254;
  const themeHeight = 318;
  const themePanel = plane(themeWidth, themeHeight, solid(0xf8f5f2, .98), 1001);
  const themeSelection = plane(themeWidth - 24, 47, solid(0xdce6f0, .96), 1005);
  const themeLabels = [];
  const themeSwatches = [];
  themePanel.visible = themeSelection.visible = false;
  let themeTop = 0;
  function redrawTheme() {
    while (themeLabels.length) removeLabel(themeLabels.pop());
    themeTop = Math.max(70, height - themeHeight - 94);
    place(themePanel, 18 + themeWidth / 2, themeTop + themeHeight / 2);
    const title = label('Choose environment', 39, themeTop + 30, 19);
    title.visible = themeOpen;
    themeLabels.push(title);
    WORLD_THEMES.forEach((theme, index) => {
      const y = themeTop + 76 + index * 47;
      const name = label(theme.label, 89, y, 17);
      name.visible = themeOpen;
      themeLabels.push(name);
      let swatch = themeSwatches[index];
      if (!swatch) {
        swatch = new THREE.Mesh(new THREE.SphereGeometry(.5, 24, 16),
          new THREE.MeshBasicMaterial({ color: theme.color, transparent: true,
            depthTest: false, depthWrite: false, toneMapped: false }));
        swatch.renderOrder = 1010;
        root.add(swatch);
        themeSwatches[index] = swatch;
      }
      swatch.scale.setScalar(32 * units);
      swatch.userData.previousUnits = units;
      place(swatch, 59, y);
      swatch.position.z = -.94;
      swatch.visible = themeOpen;
    });
    place(themeSelection, 18 + themeWidth / 2, themeTop + 76 + themeIndex * 47);
    themePanel.visible = themeSelection.visible = themeOpen;
  }
  function showTheme(next) {
    if (next && open) show(false);
    themeOpen = next;
    redrawTheme();
    stage(`WorldOS native theme picker ${next ? 'opened' : 'closed'}`);
  }
  function selectTheme(index) {
    themeIndex = (index + WORLD_THEMES.length) % WORLD_THEMES.length;
    onTheme?.(WORLD_THEMES[themeIndex].key);
    showTheme(false);
  }
  const peopleSelection = plane(peopleWidth - 24, 31, solid(0xdde4ec, .92), 1005);
  const pausePlate = plane(176, 29, solid(0xe6e9e5, .94), 1005);
  const findPlate = plane(142, 29, solid(0xe6e9e5, .94), 1005);
  peoplePanel.visible = peopleSelection.visible = false;
  pausePlate.visible = findPlate.visible = false;

  function redrawPeople() {
    while (peopleLabels.length) removeLabel(peopleLabels.pop());
    peoplePageSize = Math.max(3, Math.min(11,
      Math.floor((height - 260) / peopleRowHeight)));
    const pages = Math.max(1, Math.ceil(peopleRows.length / peoplePageSize));
    peoplePage = Math.min(peoplePage, pages - 1);
    const shown = peopleRows.slice(peoplePage * peoplePageSize,
      (peoplePage + 1) * peoplePageSize);
    peopleHeight = 80 + Math.max(1, shown.length) * peopleRowHeight + 100;
    peopleTop = Math.max(54, Math.min(86, height - peopleHeight - 20));
    const left = Math.max(10, width - peopleWidth - 22);
    peoplePanel.scale.y = peopleHeight * units;
    place(peoplePanel, left + peopleWidth / 2, peopleTop + peopleHeight / 2);
    const add = (value, x, y, size = 14, color = [50, 49, 54]) => {
      const item = label(value, x, y, size, color);
      item.visible = peopleOpen;
      peopleLabels.push(item);
    };
    add('People', left + 20, peopleTop + 30, 24);
    add(peopleSample ? 'Sample' : 'Live', left + peopleWidth - 96,
      peopleTop + 30, 13, peopleSample ? [122, 93, 70] : [52, 119, 90]);
    add(peopleSample ? 'Simulated presence' : 'Present now',
      left + 20, peopleTop + 56, 14, [99, 98, 96]);
    for (let index = 0; index < shown.length; ++index) {
      const row = shown[index];
      add(row.name || row.id, left + 24,
        peopleTop + 84 + index * peopleRowHeight, 19);
      add('Here', left + peopleWidth - 68,
        peopleTop + 84 + index * peopleRowHeight, 12, [73, 99, 73]);
    }
    const selected = shown.findIndex(row => row.id === peopleSelected);
    peopleSelection.visible = peopleOpen && selected >= 0;
    if (selected >= 0)
      place(peopleSelection, left + peopleWidth / 2,
        peopleTop + 84 + selected * peopleRowHeight);
    const footer = peopleTop + peopleHeight - 68;
    place(pausePlate, left + 108, footer);
    place(findPlate, left + 91, footer + 34);
    add(peoplePaused ? 'Resume wandering' : 'Pause wandering',
      left + 30, footer, 14);
    add('Find on grid', left + 30, footer + 34, 14);
    if (pages > 1) add(`${peoplePage + 1}/${pages}  Next`,
      left + peopleWidth - 109, footer + 34, 13);
    peoplePanel.visible = peopleOpen;
    pausePlate.visible = findPlate.visible = peopleOpen;
  }

  function redrawRows() {
    while (rows.length) removeLabel(rows.pop());
    while (appCards.length) removeLabel(appCards.pop());
    while (appIcons.length) {
      const icon = appIcons.pop();
      root.remove(icon);
      icon.traverse(object => {
        if (object.isMesh) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) material?.dispose();
        }
      });
    }
    removeLabel(header);
    removeLabel(searchMark);
    removeLabel(pageMark);
    columns = width < 620 ? 2 : width < 900 ? 3 : 5;
    pageRows = height < 850 ? 2 : 3;
    pageSize = columns * pageRows;
    panelWidth = Math.min(width - 56, columns === 2 ? 500 :
      columns === 3 ? 660 : 820);
    const count = Math.max(1, Math.ceil(apps.length / pageSize));
    page = Math.max(0, Math.min(page, count - 1));
    const shown = Math.min(pageSize, Math.max(0, apps.length - page * pageSize));
    panelHeight = 110 + Math.max(1, Math.ceil(shown / columns)) * cardPitchY + 40;
    panelLeft = (width - panelWidth) / 2;
    panelTop = Math.max(75, (height - panelHeight) / 2 - 18);
    const gap = 14;
    cardWidth = (panelWidth - 56 - (columns - 1) * gap) / columns;
    const pitchX = cardWidth + gap;
    panel.scale.set(panelWidth * units, panelHeight * units, 1);
    selectionPlate.scale.set((cardWidth + 2) * units, (cardHeight + 2) * units, 1);
    place(panel, width / 2, panelTop + panelHeight / 2);
    header = label('Apps', panelLeft + 28, panelTop + 34, 27);
    searchMark = label(query ? `Search: ${query}` : 'Search apps…',
      panelLeft + 28, panelTop + 72, 16, [103, 101, 99]);
    header.visible = searchMark.visible = open;
    pageMark = label(`${page + 1} / ${count}    Prev  ·  Next`,
      panelLeft + panelWidth - 180, panelTop + panelHeight - 22, 14);
    pageMark.visible = open && count > 1;
    for (let index = 0; index < pageSize; ++index) {
      const app = apps[page * pageSize + index];
      if (!app) break;
      const column = index % columns;
      const row = Math.floor(index / columns);
      const centerX = panelLeft + 28 + cardWidth / 2 + column * pitchX;
      const centerY = panelTop + 108 + cardHeight / 2 + row * cardPitchY;
      const card = plane(cardWidth, cardHeight, solid(0xffffff, .79), 1004);
      place(card, centerX, centerY);
      card.visible = open;
      appCards.push(card);
      const icon = open ? iconForApp?.(app) : null;
      if (icon) {
        icon.rotation.y = -.32;
        const bounds = new THREE.Box3().setFromObject(icon);
        const extent = bounds.getSize(new THREE.Vector3());
        const longest = Math.max(extent.x, extent.y, extent.z);
        if (longest > 0) icon.scale.multiplyScalar(58 * units / longest);
        const fitted = new THREE.Box3().setFromObject(icon);
        const center = fitted.getCenter(new THREE.Vector3());
        icon.position.set((centerX - width / 2) * units - center.x,
          (height / 2 - centerY + 11) * units - center.y, -.87 - center.z);
        icon.traverse(object => {
          if (!object.isMesh) return;
          object.renderOrder = 1015;
          const convert = material => {
            const copy = material.clone();
            copy.transparent = true;
            copy.depthTest = false;
            copy.depthWrite = false;
            return copy;
          };
          object.material = Array.isArray(object.material) ?
            object.material.map(convert) : convert(object.material);
        });
        root.add(icon);
        icon.visible = open;
        appIcons.push(icon);
      } else {
        const initials = appName(app).split(/\s+/).map(word => word[0] || '').join('').slice(0, 2);
        const badge = label(initials || '?', centerX,
          centerY - 11, 30, [103, 103, 110], 'center');
        badge.visible = open;
        rows.push(badge);
      }
      const item = label(appName(app), centerX, centerY + 35, 17,
        [50, 49, 54], 'center');
      item.scale.x = Math.min(item.scale.x, (cardWidth - 12) * units);
      item.visible = open;
      rows.push(item);
    }
    if (query && !apps.length) {
      const empty = label('No matching apps', width / 2,
        panelTop + panelHeight / 2, 20, [98, 97, 96], 'center');
      empty.visible = open;
      rows.push(empty);
    }
    const selectedRow = selectedApp - page * pageSize;
    selectionPlate.visible = open && apps.length > 0 &&
      selectedRow >= 0 && selectedRow < pageSize;
    if (selectionPlate.visible) {
      const column = selectedRow % columns;
      const row = Math.floor(selectedRow / columns);
      place(selectionPlate, panelLeft + 28 + cardWidth / 2 + column * pitchX,
        panelTop + 108 + cardHeight / 2 + row * cardPitchY);
    }
  }
  function resize(nextWidth, nextHeight, extent) {
    width = nextWidth;
    height = nextHeight;
    units = 2 * extent / height;
    for (const mesh of root.children) {
      mesh.scale.x /= mesh.userData.previousUnits || 1;
      mesh.scale.y /= mesh.userData.previousUnits || 1;
      mesh.scale.x *= units;
      mesh.scale.y *= units;
      mesh.userData.previousUnits = units;
    }
    place(backPlate, 41, 39);
    place(peoplePlate, 46, height - 46);
    place(peopleText, 46, height - 46);
    place(themeButtonPlate, 108, height - 46);
    place(themeButtonText, 108, height - 46);
    place(bookPlate, width - 108, height - 46);
    place(bookText, width - 108, height - 46);
    place(peopleMark, width / 2, 62);
    place(launcherPlate, width - 46, height - 46);
    if (back) place(back, 41, 39);
    if (launcher) place(launcher, width - 46, height - 46);
    if (clock) place(clock, width / 2, 37);
    redrawRows();
    redrawPeople();
    redrawTheme();
  }
  function setApps(next) {
    allApps = next.filter(app => typeof app.key === 'string' && !app.hidden)
      .sort((a, b) => appName(a).localeCompare(appName(b)));
    apps = allApps.filter(matchesApp);
    selectedApp = Math.min(selectedApp, Math.max(0, apps.length - 1));
    redrawRows();
  }
  function setQuery(next) {
    const value = [...next].slice(0, 24).join('').toLowerCase();
    if (value === query) return;
    query = value;
    apps = allApps.filter(matchesApp);
    page = selectedApp = 0;
    redrawRows();
    stage(`WorldOS native launcher search: ${query || 'all'} (${apps.length} apps)`);
  }
  function tick() {
    const now = new Date();
    const stamp = now.getHours() * 60 + now.getMinutes();
    if (stamp === minute) return;
    minute = stamp;
    removeLabel(clock);
    const hours = now.getHours() % 12 || 12;
    const value = `${hours}:${String(now.getMinutes()).padStart(2, '0')} ${now.getHours() < 12 ? 'AM' : 'PM'}`;
    clock = label(value, width / 2, 37, 17, [48, 46, 44], 'center');
  }
  function show(next) {
    if (next === open) return;
    open = next;
    if (!open) selectedTile = null;
    query = '';
    apps = allApps;
    page = selectedApp = 0;
    redrawRows();
    panel.visible = header.visible = searchMark.visible = open;
    pageMark.visible = open && apps.length > pageSize;
    selectionPlate.visible = open && apps.length > 0;
    for (const row of rows) row.visible = open;
    for (const card of appCards) card.visible = open;
    for (const icon of appIcons) icon.visible = open;
    stage(open ? `WorldOS native launcher opened: ${apps.length} apps` :
      'WorldOS native launcher closed');
  }
  function pointer(x, y, clicked) {
    if (!clicked) return false;
    if (x >= 18 && x <= 64 && y >= 16 && y <= 64) {
      if (open) show(false);
      else onBack();
      return true;
    }
    if (x >= 18 && x <= 74 && y >= height - 74 && y <= height - 18) {
      if (open) show(false);
      if (themeOpen) showTheme(false);
      onPeople?.();
      return true;
    }
    if (view !== 'people' && x >= 80 && x <= 136 &&
        y >= height - 74 && y <= height - 18) {
      showTheme(!themeOpen);
      return true;
    }
    if (x >= width - 138 && x <= width - 78 &&
        y >= height - 74 && y <= height - 18) {
      if (open) show(false);
      if (themeOpen) showTheme(false);
      onBook?.();
      return true;
    }
    if (themeOpen) {
      if (x >= 18 && x <= 18 + themeWidth &&
          y >= themeTop && y <= themeTop + themeHeight) {
        const index = Math.floor((y - themeTop - 52) / 47);
        if (index >= 0 && index < WORLD_THEMES.length) selectTheme(index);
      } else showTheme(false);
      return true;
    }
    if (peopleOpen) {
      const left = Math.max(10, width - peopleWidth - 22);
      if (x < left || x > left + peopleWidth ||
          y < peopleTop || y > peopleTop + peopleHeight) {
        peopleOpen = false;
        redrawPeople();
        return true;
      }
      const index = Math.floor((y - peopleTop - 67) / peopleRowHeight);
      if (index >= 0 && index < peoplePageSize &&
          y < peopleTop + 67 + (index + 1) * peopleRowHeight) {
        const person = peopleRows[peoplePage * peoplePageSize + index];
        if (person) {
          peopleSelected = person.id;
          redrawPeople();
          onSelectPerson?.(person.id);
        }
        return true;
      }
      const footer = peopleTop + peopleHeight - 68;
      if (y >= footer - 16 && y < footer + 16) {
        peoplePaused = !peoplePaused;
        onPausePeople?.(peoplePaused);
        redrawPeople();
      } else if (y >= footer + 18 && y < footer + 50) {
        if (x > left + peopleWidth - 115 && peopleRows.length > peoplePageSize) {
          peoplePage = (peoplePage + 1) % Math.ceil(peopleRows.length / peoplePageSize);
          redrawPeople();
        } else if (peopleSelected) {
          onFindPerson?.(peopleSelected);
          peopleOpen = false;
          redrawPeople();
        }
      }
      return true;
    }
    if (x >= width - 72 && x <= width - 18 && y >= height - 72 && y <= height - 18) {
      if (!open) {
        selectedTile = null;
        redrawRows();
      }
      show(!open);
      return true;
    }
    if (!open) return false;
    if (x < panelLeft || x > panelLeft + panelWidth ||
        y < panelTop || y > panelTop + panelHeight) {
      show(false);
      return true;
    }
    const column = Math.floor((x - panelLeft - 28) / (cardWidth + 14));
    const row = Math.floor((y - panelTop - 108) / cardPitchY);
    if (column >= 0 && column < columns && row >= 0 && row < pageRows &&
        y >= panelTop + 108 + row * cardPitchY &&
        y <= panelTop + 108 + row * cardPitchY + cardHeight) {
      const index = page * pageSize + row * columns + column;
      const app = apps[index];
      if (app) {
        selectedApp = index;
        onOpen(app.key, selectedTile);
        show(false);
      }
    } else if (y >= panelTop + panelHeight - 44 && apps.length > pageSize) {
      const count = Math.ceil(apps.length / pageSize);
      page = (page + (x < panelLeft + panelWidth - 90 ? -1 : 1) + count) % count;
      selectedApp = page * pageSize;
      redrawRows();
    }
    return true;
  }
  resize(width, height, 5.8);
  tick();
  function key(kind) {
    if (themeOpen) {
      if (kind === 'enter') selectTheme(themeIndex);
      else if (kind === 'up' || kind === 'left') {
        themeIndex = (themeIndex - 1 + WORLD_THEMES.length) % WORLD_THEMES.length;
        redrawTheme();
      } else if (kind === 'down' || kind === 'right') {
        themeIndex = (themeIndex + 1) % WORLD_THEMES.length;
        redrawTheme();
      } else if (kind === 'home') {
        themeIndex = 0;
        redrawTheme();
      } else return false;
      return true;
    }
    if (!open) return false;
    if (kind === 'backspace') {
      setQuery([...query].slice(0, -1).join(''));
      return true;
    }
    if (kind === 'enter') {
      const app = apps[selectedApp];
      if (app) onOpen(app.key, selectedTile);
      show(false);
      return true;
    }
    if (kind === 'up' || kind === 'down' || kind === 'left' || kind === 'right') {
      const step = kind === 'up' ? -columns : kind === 'down' ? columns :
        kind === 'left' ? -1 : 1;
      if (apps.length) selectedApp = (selectedApp + step + apps.length) % apps.length;
      page = Math.floor(selectedApp / pageSize);
    } else if (kind === 'home') {
      page = selectedApp = 0;
    } else {
      return false;
    }
    redrawRows();
    return true;
  }
  return { resize, setApps, tick, pointer, key,
    close() { if (themeOpen) showTheme(false); else show(false); },
    text(input) {
      if (!open || typeof input !== 'string') return false;
      const printable = input.replace(/[\r\n\t]/g, '');
      if (printable) setQuery(query + printable);
      return true;
    },
    setPeopleRows(rows, sample = true) {
      peopleRows = rows;
      peopleSample = sample;
      if (peopleSelected && !rows.some(row => row.id === peopleSelected))
        peopleSelected = null;
      redrawPeople();
    },
    selectPerson(id) {
      peopleSelected = peopleRows.some(row => row.id === id) ? id : null;
      redrawPeople();
    },
    togglePeoplePanel() {
      if (view !== 'people' && !allowHomePeoplePanel) return;
      peopleOpen = !peopleOpen;
      redrawPeople();
      stage(peopleOpen ? 'WorldOS native People panel opened' :
        'WorldOS native People panel closed');
    },
    hasPeoplePanel: () => peopleOpen,
    closePeoplePanel() { peopleOpen = false; redrawPeople(); },
    setView(nextView, sample = true) {
      view = nextView;
      if (view !== 'people' && !allowHomePeoplePanel) peopleOpen = false;
      if (view === 'people' && themeOpen) showTheme(false);
      peopleSample = sample;
      peoplePlate.material.opacity = view === 'people' ? .8 : .38;
      peopleMark.visible = view === 'people' && sample;
      themeButtonPlate.visible = themeButtonText.visible = view !== 'people';
      redrawPeople();
    },
    isOpen: () => open || themeOpen,
    refreshApps() { if (open) redrawRows(); },
    openAt(x, z) {
      selectedTile = { x, z };
      if (open) { setQuery(''); redrawRows(); }
      else show(true);
      stage(`WorldOS native launcher tile: (${x},${z})`);
    },
  };
}
