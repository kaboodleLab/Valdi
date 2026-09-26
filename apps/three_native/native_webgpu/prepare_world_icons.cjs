#!/usr/bin/env node
// Decode embedded WorldOS GLB images into small RGBA files for Hermes, which
// has no DOM ImageBitmap or image codec. GLTFLoader still parses the GLB.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const [sourceRoot, outputRoot] = process.argv.slice(2);
if (!sourceRoot || !outputRoot) {
  console.error('Usage: prepare_world_icons.cjs /path/to/world_os /path/to/output-assets');
  process.exit(2);
}

const names = ['weather', 'calendar', 'mail', 'notes', 'whatsapp', 'browser', 'files'];
const manifest = {};
const controls = {
  back: 'ui/app-back.png',
  launcher: 'app-launcher-spheres.png',
};
fs.mkdirSync(outputRoot, { recursive: true });

async function prepare() {
  for (const name of names) {
    const source = name === 'files' ?
      path.join(sourceRoot, 'assets/media/town/Box.glb') :
      path.join(sourceRoot, 'assets/media/appicons', `${name}.glb`);
    const glb = fs.readFileSync(source);
    if (glb.toString('ascii', 0, 4) !== 'glTF' || glb.readUInt32LE(4) !== 2)
      throw new Error(`Unsupported ${name} GLB`);
    const jsonLength = glb.readUInt32LE(12);
    const json = JSON.parse(glb.toString('utf8', 20, 20 + jsonLength));
    const binaryStart = 20 + jsonLength + 8;
    const images = {};
    for (const [index, image] of (json.images || []).entries()) {
      if (image.bufferView === undefined) continue;
      const view = json.bufferViews[image.bufferView];
      const encoded = glb.subarray(binaryStart + (view.byteOffset || 0),
        binaryStart + (view.byteOffset || 0) + view.byteLength);
      const { data, info } = await sharp(encoded).resize({ width: 256, height: 256,
        fit: 'inside', withoutEnlargement: true }).ensureAlpha().raw()
        .toBuffer({ resolveWithObject: true });
      if (info.channels !== 4) throw new Error(`${name} image ${index}: expected RGBA`);
      const file = `${name}-image-${index}.rgba`;
      fs.writeFileSync(path.join(outputRoot, file), data);
      images[index] = { file, width: info.width, height: info.height };
    }
    fs.writeFileSync(path.join(outputRoot, `${name}.glb`), glb);
    manifest[name] = { images };
    console.log(`${name}: ${glb.length} GLB bytes, ${Object.keys(images).length} decoded images`);
  }
  manifest.controls = {};
  for (const [name, relative] of Object.entries(controls)) {
    const source = path.join(sourceRoot, 'assets/media', relative);
    const { data, info } = await sharp(source).resize(96, 96, { fit: 'inside',
      withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.channels !== 4) throw new Error(`${name}: expected RGBA`);
    const file = `control-${name}.rgba`;
    fs.writeFileSync(path.join(outputRoot, file), data);
    manifest.controls[name] = { file, width: info.width, height: info.height };
    console.log(`${name}: ${info.width}x${info.height} shell artwork`);
  }
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 :.-/';
  const fontfile = path.join(sourceRoot, 'assets/media/SF-Pro-Display-Medium.otf');
  const cellWidth = 32;
  const cellHeight = 40;
  const columns = 8;
  const atlasWidth = columns * cellWidth;
  const atlasHeight = Math.ceil(characters.length / columns) * cellHeight;
  const atlas = Buffer.alloc(atlasWidth * atlasHeight * 4);
  const glyphs = {};
  for (const [index, character] of [...characters].entries()) {
    if (character === ' ') {
      glyphs[character] = { x: 0, y: 0, width: 0, height: 0, advance: 9 };
      continue;
    }
    const { data, info } = await sharp({ text: {
      text: character, font: 'SF Pro Display Medium 30', fontfile, rgba: true,
    } }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.channels !== 4 || info.width > cellWidth || info.height > cellHeight - 4)
      throw new Error(`Font glyph ${character} does not fit its atlas cell`);
    const x = index % columns * cellWidth;
    const y = Math.floor(index / columns) * cellHeight;
    for (let row = 0; row < info.height; ++row) {
      data.copy(atlas, ((y + row) * atlasWidth + x) * 4,
        row * info.width * 4, (row + 1) * info.width * 4);
    }
    glyphs[character] = { x, y, width: info.width, height: info.height,
      advance: Math.min(cellWidth, info.width + 3) };
  }
  fs.writeFileSync(path.join(outputRoot, 'font-atlas.rgba'), atlas);
  manifest.font = { file: 'font-atlas.rgba', width: atlasWidth,
    height: atlasHeight, cellHeight, glyphs };
  console.log(`shell font: ${characters.length} glyphs from WorldOS SF Pro Display`);
  fs.writeFileSync(path.join(outputRoot, 'manifest.json'), JSON.stringify(manifest));
}

prepare().catch(error => { console.error(error); process.exitCode = 1; });
