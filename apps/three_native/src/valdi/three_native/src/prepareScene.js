"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var prepareScene_exports = {};
__export(prepareScene_exports, {
  createPlatterScene: () => createPlatterScene
});
module.exports = __toCommonJS(prepareScene_exports);
var import_three_core = require("./vendor/three.core");
var import_GLTFLoader = require("./vendor/GLTFLoader");
// Valdi's Hermes runtime does not provide AbortController. Three's loaders
// construct one even when parsing an in-memory GLB with no network requests.
if (typeof globalThis.AbortController === "undefined") {
  globalThis.AbortController = class {
    constructor() {
      this.signal = {
        aborted: false,
        addEventListener() {},
        removeEventListener() {}
      };
    }
    abort() {
      this.signal.aborted = true;
    }
  };
}
async function createPlatterScene(bytes) {
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await new Promise((resolve, reject) => {
    new import_GLTFLoader.GLTFLoader().parse(arrayBuffer, "", resolve, reject);
  });
  const scene = new import_three_core.Scene();
  const model = gltf.scene;
  scene.add(model);
  let mesh = null;
  model.traverse((object) => {
    if (object.isMesh && mesh === null) mesh = object;
  });
  if (!mesh) throw new Error("World OS platter has no mesh");
  if (mesh.geometry.getAttribute("position") === void 0) {
    throw new Error("World OS platter has no position attribute");
  }
  const expanded = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const position = expanded.getAttribute("position");
  const normal = expanded.getAttribute("normal");
  if (!normal) throw new Error("World OS platter has no normal attribute");
  const vertexData = new Float32Array(position.count * 6);
  for (let index = 0; index < position.count; index++) {
    const offset = index * 6;
    vertexData[offset] = position.getX(index);
    vertexData[offset + 1] = position.getY(index);
    vertexData[offset + 2] = position.getZ(index);
    vertexData[offset + 3] = normal.getX(index);
    vertexData[offset + 4] = normal.getY(index);
    vertexData[offset + 5] = normal.getZ(index);
  }
  const bounds = new import_three_core.Box3().setFromObject(model);
  const size = bounds.getSize(new import_three_core.Vector3());
  const center = bounds.getCenter(new import_three_core.Vector3());
  model.position.sub(center);
  model.scale.setScalar(1.5 / Math.max(size.x, size.y, size.z));
  model.rotation.x = -0.55;
  const camera = new import_three_core.PerspectiveCamera(48, 1, 0.01, 100);
  camera.position.set(0, 0.2, 2.45);
  camera.lookAt(0, 0, 0);
  const viewProjection = new import_three_core.Matrix4();
  const modelViewProjection = new import_three_core.Matrix4();
  const transform = new Float32Array(32);
  let angle = 0;
  return {
    scene,
    camera,
    mesh,
    vertexBytes: new Uint8Array(vertexData.buffer),
    get vertexCount() {
      return position.count;
    },
    resize(width, height) {
      camera.aspect = Math.max(1, width) / Math.max(1, height);
      // Keep the whole platter visible on narrow phone screens as it rotates.
      camera.position.z = Math.max(2.45, 0.85 / (Math.tan(24 * Math.PI / 180) * camera.aspect));
      camera.updateProjectionMatrix();
    },
    frame(deltaSeconds, dragYaw = 0) {
      angle += Math.min(Math.max(deltaSeconds, 0), 0.1) * 0.6;
      model.rotation.y = angle + dragYaw;
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      modelViewProjection.multiplyMatrices(viewProjection, mesh.matrixWorld);
      transform.set(modelViewProjection.elements, 0);
      transform.set(mesh.matrixWorld.elements, 16);
      return new Uint8Array(transform.buffer.slice(0));
    },
    dispose() {
      if (expanded !== mesh.geometry) expanded.dispose();
      model.traverse((object) => {
        if (object.isMesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) material == null ? void 0 : material.dispose();
        }
      });
      scene.remove(model);
    }
  };
}
