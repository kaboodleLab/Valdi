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

const homeNames = ['weather', 'calendar', 'mail', 'notes', 'whatsapp', 'browser', 'files'];
// Keep the native People scene on the same authored models as WorldOS. These
// are decoded only at build time; Hermes still loads their original GLBs.
const peopleModels = {
  'person-matt': 'props/matt-rigged.glb',
  'person-andrew': 'props/andrew-rigged.glb',
  'person-moritz': 'props/moritz-rigged.glb',
  'person-brian': 'props/brian-rigged.glb',
  'person-ahmad': 'props/ahmad-rigged.glb',
  'person-will': 'props/character-will.glb',
  'person-worker': 'props/worker.glb',
};
const iconDirectory = path.join(sourceRoot, 'assets/media/appicons');
const names = [...new Set([...homeNames,
  ...fs.readdirSync(iconDirectory).filter(file => /^[a-z0-9_-]+\.glb$/.test(file))
    .map(file => file.slice(0, -4)), ...Object.keys(peopleModels)])];
const manifest = {};
const controls = {
  back: 'ui/app-back.png',
  launcher: 'app-launcher-spheres.png',
};
fs.mkdirSync(outputRoot, { recursive: true });

// Hermes's GLTFLoader receives the decoded images from nativeIconLoader. Keep
// the GLB's geometry, skins and animation views byte-for-byte, but replace its
// unused embedded image views with valid one-pixel images of the same MIME
// type. The source WorldOS GLB is never changed. This avoids shipping each
// high-resolution image twice (encoded in the GLB and decoded as RGBA).
const blankImages = new Map();
async function blankImage(mime) {
  if (!blankImages.has(mime)) {
    if (!['image/webp', 'image/jpeg', 'image/png'].includes(mime))
      throw new Error(`Unsupported embedded image type: ${mime}`);
    const format = mime === 'image/webp' ? 'webp' :
      mime === 'image/jpeg' ? 'jpeg' : 'png';
    const image = sharp({ create: { width: 1, height: 1, channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 } } });
    blankImages.set(mime, await image[format]().toBuffer());
  }
  return blankImages.get(mime);
}
async function packNativeGlb(json, binary, imageViews) {
  if (json.buffers?.length !== 1 || json.buffers[0].uri)
    throw new Error('Native asset pack requires a single GLB binary buffer');
  const chunks = [];
  let length = 0;
  for (const [index, view] of json.bufferViews.entries()) {
    if (view.buffer !== 0) throw new Error(`Buffer view ${index} is not in the GLB`);
    const original = binary.subarray(view.byteOffset || 0,
      (view.byteOffset || 0) + view.byteLength);
    if (original.length !== view.byteLength)
      throw new Error(`Buffer view ${index} exceeds the GLB binary chunk`);
    const mime = imageViews.get(index);
    const contents = mime ? await blankImage(mime) : original;
    const padding = (4 - length % 4) % 4;
    if (padding) { chunks.push(Buffer.alloc(padding)); length += padding; }
    view.byteOffset = length;
    view.byteLength = contents.length;
    chunks.push(contents);
    length += contents.length;
  }
  json.buffers[0].byteLength = length;
  const jsonText = Buffer.from(JSON.stringify(json));
  const jsonPadding = (4 - jsonText.length % 4) % 4;
  const jsonChunk = Buffer.concat([jsonText, Buffer.alloc(jsonPadding, 0x20)]);
  const binaryPadding = (4 - length % 4) % 4;
  const binaryChunk = Buffer.concat([...chunks, Buffer.alloc(binaryPadding)]);
  const output = Buffer.alloc(12 + 8 + jsonChunk.length + 8 + binaryChunk.length);
  output.write('glTF', 0, 'ascii');
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(jsonChunk.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(output, 20);
  const binaryHeader = 20 + jsonChunk.length;
  output.writeUInt32LE(binaryChunk.length, binaryHeader);
  output.writeUInt32LE(0x004e4942, binaryHeader + 4);
  binaryChunk.copy(output, binaryHeader + 8);
  return output;
}

async function prepare() {
  for (const name of names) {
    const relative = peopleModels[name] ||
      (name === 'files' ? 'town/Box.glb' : `appicons/${name}.glb`);
    const source = path.join(sourceRoot, 'assets/media', relative);
    const glb = fs.readFileSync(source);
    if (glb.toString('ascii', 0, 4) !== 'glTF' || glb.readUInt32LE(4) !== 2)
      throw new Error(`Unsupported ${name} GLB`);
    const jsonLength = glb.readUInt32LE(12);
    const json = JSON.parse(glb.toString('utf8', 20, 20 + jsonLength));
    const binaryStart = 20 + jsonLength + 8;
    const binaryLength = glb.readUInt32LE(binaryStart - 8);
    const binary = glb.subarray(binaryStart, binaryStart + binaryLength);
    const imageViews = new Map();
    const images = {};
    for (const [index, image] of (json.images || []).entries()) {
      if (image.bufferView === undefined) continue;
      const view = json.bufferViews[image.bufferView];
      imageViews.set(image.bufferView, image.mimeType || 'image/png');
      const encoded = glb.subarray(binaryStart + (view.byteOffset || 0),
        binaryStart + (view.byteOffset || 0) + view.byteLength);
      const limit = peopleModels[name] ? 512 : 256;
      const { data, info } = await sharp(encoded).resize({ width: limit, height: limit,
        fit: 'inside', withoutEnlargement: true }).ensureAlpha().raw()
        .toBuffer({ resolveWithObject: true });
      if (info.channels !== 4) throw new Error(`${name} image ${index}: expected RGBA`);
      const file = `${name}-image-${index}.rgba`;
      fs.writeFileSync(path.join(outputRoot, file), data);
      images[index] = { file, width: info.width, height: info.height };
    }
    const packed = await packNativeGlb(json, binary, imageViews);
    fs.writeFileSync(path.join(outputRoot, `${name}.glb`), packed);
    manifest[name] = { images };
    console.log(`${name}: ${glb.length} source bytes -> ${packed.length} native GLB bytes, ${Object.keys(images).length} decoded images`);
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
