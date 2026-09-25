import {
  Box3,
  Matrix4,
  PerspectiveCamera,
  Scene,
  Vector3
} from "./vendor/three.core.js";
import { GLTFLoader } from "./vendor/GLTFLoader.js";
async function createPlatterScene(bytes) {
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await new Promise((resolve, reject) => {
    new GLTFLoader().parse(arrayBuffer, "", resolve, reject);
  });
  const scene = new Scene();
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
  const bounds = new Box3().setFromObject(model);
  const size = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  model.position.sub(center);
  model.scale.setScalar(1.5 / Math.max(size.x, size.y, size.z));
  model.rotation.x = -0.55;
  const camera = new PerspectiveCamera(48, 1, 0.01, 100);
  camera.position.set(0, 0.2, 2.45);
  camera.lookAt(0, 0, 0);
  const viewProjection = new Matrix4();
  const modelViewProjection = new Matrix4();
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
export {
  createPlatterScene
};
