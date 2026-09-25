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
  fs.writeFileSync(path.join(outputRoot, 'manifest.json'), JSON.stringify(manifest));
}

prepare().catch(error => { console.error(error); process.exitCode = 1; });
