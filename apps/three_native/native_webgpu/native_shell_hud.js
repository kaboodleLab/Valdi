// WorldOS's two authored shell controls over the native Three scene. The
// browser World supplies its DOM chrome; Hermes has no DOM or canvas, so this
// small camera-fixed layer draws text into RGBA textures and uses the real
// WorldOS control artwork prepared alongside the GLBs.
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
  const letters = String(text).toUpperCase().slice(0, 34);
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

export function createNativeText(THREE, manifest, readAsset) {
  const font = manifest.font ? { entry: manifest.font,
    pixels: new Uint8Array(readAsset(manifest.font.file)) } : null;
  return (value, color) => textTexture(THREE, value, color, font);
}

export function createNativeShellHud({ THREE, scene, camera, manifest, readAsset,
  onBack, onPeople, onOpen, onSelectPerson, onFindPerson, onPausePeople,
  stage, makeText = createNativeText(THREE, manifest, readAsset) }) {
  const root = new THREE.Group();
  camera.add(root);
  scene.add(camera);
  const rows = [];
  let apps = [];
  let width = 720;
  let height = 720;
  let units = 1;
  let open = false;
  let selectedTile = null;
  let selectedApp = 0;
  let page = 0;
  let minute = -1;
  let clock = null;
  const pageSize = 10;
  const panelWidth = 316;
  const rowHeight = 31;
  let panelHeight = 60 + rowHeight + 12;
  let view = 'home';
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
  const launcherPlate = roundPlate(48);
  const back = artwork('back', 36);
  if (back) back.scale.x = -back.scale.x;
  const launcher = artwork('launcher', 38);
  const peopleText = label('PEOPLE', 0, 0, 12, [50, 49, 54], 'center');
  const peopleMark = label('SAMPLE PEOPLE', 0, 0, 10, [86, 84, 82], 'center');
  peopleMark.visible = false;
  const panel = plane(panelWidth, panelHeight, solid(0xf8f5f2, .94), 1001);
  const selectionPlate = plane(panelWidth - 24, rowHeight - 2,
    solid(0xdde4ec, .9), 1005);
  let header = label('APPS', 0, 0, 15);
  let pageMark = label('1/1', 0, 0, 11);
  panel.visible = header.visible = pageMark.visible = false;
  const peoplePanel = plane(peopleWidth, 100, solid(0xf8f5f2, .97), 1001);
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
    add('PEOPLE', left + 20, peopleTop + 30, 24);
    add(peopleSample ? 'SAMPLE' : 'LIVE', left + peopleWidth - 96,
      peopleTop + 30, 13, peopleSample ? [122, 93, 70] : [52, 119, 90]);
    add(peopleSample ? 'Simulated presence' : 'Present now',
      left + 20, peopleTop + 56, 14, [99, 98, 96]);
    for (let index = 0; index < shown.length; ++index) {
      const row = shown[index];
      add(row.name || row.id, left + 24,
        peopleTop + 84 + index * peopleRowHeight, 19);
      add('HERE', left + peopleWidth - 68,
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
    add(peoplePaused ? 'RESUME WANDERING' : 'PAUSE WANDERING',
      left + 30, footer, 14);
    add('FIND ON GRID', left + 30, footer + 34, 14);
    if (pages > 1) add(`${peoplePage + 1}/${pages}  NEXT`,
      left + peopleWidth - 109, footer + 34, 13);
    peoplePanel.visible = peopleOpen;
    pausePlate.visible = findPlate.visible = peopleOpen;
  }

  function redrawRows() {
    while (rows.length) removeLabel(rows.pop());
    removeLabel(header);
    header = label(selectedTile ? `APPS - ${selectedTile.x}/${selectedTile.z}` : 'APPS',
      0, 0, 15);
    header.visible = open;
    panelHeight = 60 + Math.max(1, Math.min(pageSize, apps.length)) * rowHeight +
      (apps.length > pageSize ? 34 : 12);
    panel.scale.y = panelHeight * units;
    const count = Math.max(1, Math.ceil(apps.length / pageSize));
    page = Math.max(0, Math.min(page, count - 1));
    removeLabel(pageMark);
    pageMark = label(`${page + 1}/${count}`, 0, 0, 11);
    pageMark.visible = open && apps.length > pageSize;
    const x = width - 22 - panelWidth;
    const top = height - 22 - 48 - 12 - panelHeight;
    place(panel, x + panelWidth / 2, top + panelHeight / 2);
    place(header, x + 22 + header.scale.x / units / 2, top + 29);
    place(pageMark, x + panelWidth - 50, top + panelHeight - 17);
    for (let index = 0; index < pageSize; ++index) {
      const app = apps[page * pageSize + index];
      if (!app) break;
      const name = typeof app.name === 'string' && app.name ? app.name : app.key;
      const item = label(name.slice(0, 28), x + 23,
        top + 62 + index * rowHeight, 15);
      item.visible = open;
      rows.push(item);
    }
    const selectedRow = selectedApp - page * pageSize;
    selectionPlate.visible = open && apps.length > 0 &&
      selectedRow >= 0 && selectedRow < rows.length;
    if (selectionPlate.visible)
      place(selectionPlate, x + panelWidth / 2, top + 62 + selectedRow * rowHeight);
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
    place(peopleMark, width / 2, 62);
    place(launcherPlate, width - 46, height - 46);
    if (back) place(back, 41, 39);
    if (launcher) place(launcher, width - 46, height - 46);
    if (clock) place(clock, width / 2, 37);
    redrawRows();
    redrawPeople();
  }
  function setApps(next) {
    apps = next.filter(app => typeof app.key === 'string' && !app.hidden)
      .sort((a, b) => (a.name || a.key).localeCompare(b.name || b.key));
    selectedApp = Math.min(selectedApp, Math.max(0, apps.length - 1));
    redrawRows();
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
    open = next;
    if (!open) {
      selectedTile = null;
      redrawRows();
    }
    panel.visible = header.visible = open;
    pageMark.visible = open && apps.length > pageSize;
    selectionPlate.visible = open && apps.length > 0;
    for (const row of rows) row.visible = open;
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
      onPeople?.();
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
    const left = width - 22 - panelWidth;
    const top = height - 22 - 48 - 12 - panelHeight;
    if (x < left || x > left + panelWidth || y < top || y > top + panelHeight) {
      show(false);
      return true;
    }
    const row = Math.floor((y - top - 46) / rowHeight);
    if (row >= 0 && row < pageSize) {
      const app = apps[page * pageSize + row];
      if (app) {
        selectedApp = page * pageSize + row;
        onOpen(app.key, selectedTile);
        show(false);
      }
    } else if (y >= top + panelHeight - 35 && apps.length > pageSize) {
      page = (page + 1) % Math.ceil(apps.length / pageSize);
      selectedApp = page * pageSize;
      redrawRows();
    }
    return true;
  }
  resize(width, height, 5.8);
  tick();
  function key(kind) {
    if (!open) return false;
    if (kind === 'enter') {
      const app = apps[selectedApp];
      if (app) onOpen(app.key, selectedTile);
      show(false);
      return true;
    }
    if (kind === 'up' || kind === 'down') {
      if (apps.length) selectedApp = (selectedApp + (kind === 'down' ? 1 : -1) +
        apps.length) % apps.length;
      page = Math.floor(selectedApp / pageSize);
    } else if (kind === 'left' || kind === 'right') {
      const pageCount = Math.max(1, Math.ceil(apps.length / pageSize));
      page = (page + (kind === 'right' ? 1 : -1) + pageCount) % pageCount;
      selectedApp = page * pageSize;
    } else if (kind === 'home') {
      page = selectedApp = 0;
    } else {
      return false;
    }
    redrawRows();
    return true;
  }
  return { resize, setApps, tick, pointer, key, close: () => show(false),
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
      if (view !== 'people') return;
      peopleOpen = !peopleOpen;
      redrawPeople();
      stage(peopleOpen ? 'WorldOS native People panel opened' :
        'WorldOS native People panel closed');
    },
    closePeoplePanel() { peopleOpen = false; redrawPeople(); },
    setView(nextView, sample = true) {
      view = nextView;
      if (view !== 'people') peopleOpen = false;
      peopleSample = sample;
      peoplePlate.material.opacity = view === 'people' ? .8 : .38;
      peopleMark.visible = view === 'people' && sample;
      redrawPeople();
    },
    isOpen: () => open,
    openAt(x, z) {
      selectedTile = { x, z };
      page = selectedApp = 0;
      redrawRows();
      show(true);
      stage(`WorldOS native launcher tile: (${x},${z})`);
    },
  };
}
