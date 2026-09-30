import sharp from 'sharp';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as THREE from 'three/webgpu';

// Node has no ImageBitmap or DOM canvas. Decode the embedded images from a
// WorldOS GLB into WebGPU-uploadable DataTextures, leaving GLTFLoader in charge
// of geometry, materials, animation and the rest of the asset format.
export function createNativeGLTFLoader() {
  const loader = new GLTFLoader();
  loader.register(parser => ({
    // Replace Three's browser-only WebP plugin as well as its ordinary image
    // path. WorldOS mixes EXT_texture_webp and regular embedded JPEG images.
    name: 'EXT_texture_webp',
    async loadTexture(index) {
      const definition = parser.json.textures[index];
      const sourceIndex = definition.source ?? definition.extensions?.EXT_texture_webp?.source;
      const source = parser.json.images[sourceIndex];
      if (source?.bufferView === undefined) return null;

      const encoded = await parser.getDependency('bufferView', source.bufferView);
      const { data, info } = await sharp(Buffer.from(encoded))
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      if (info.channels !== 4) throw new Error(`Unexpected native image channel count: ${info.channels}`);
      const texture = new THREE.DataTexture(new Uint8Array(data), info.width, info.height, THREE.RGBAFormat);
      texture.flipY = false;
      texture.needsUpdate = true;
      const sampler = parser.json.samplers?.[definition.sampler] ?? {};
      texture.magFilter = sampler.magFilter === 9728 ? THREE.NearestFilter : THREE.LinearFilter;
      texture.minFilter = {
        9728: THREE.NearestFilter,
        9729: THREE.LinearFilter,
        9984: THREE.NearestMipmapNearestFilter,
        9985: THREE.LinearMipmapNearestFilter,
        9986: THREE.NearestMipmapLinearFilter,
        9987: THREE.LinearMipmapLinearFilter,
      }[sampler.minFilter] ?? THREE.LinearMipmapLinearFilter;
      texture.wrapS = sampler.wrapS === 33071 ? THREE.ClampToEdgeWrapping :
        sampler.wrapS === 33648 ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
      texture.wrapT = sampler.wrapT === 33071 ? THREE.ClampToEdgeWrapping :
        sampler.wrapT === 33648 ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
      return texture;
    },
  }));
  return loader;
}
