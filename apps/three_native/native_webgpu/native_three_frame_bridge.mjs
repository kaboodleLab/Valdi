// Three advances node-frame state (including skinning) from its internal
// requestAnimationFrame callback. Native surfaces own their draw cadence, so
// deliver queued callbacks immediately before each native draw.
export function installNativeThreeFrameBridge(target = globalThis) {
  let nextId = 0;
  let pending = new Map();
  target.requestAnimationFrame = callback => {
    const id = ++nextId;
    pending.set(id, callback);
    return id;
  };
  target.cancelAnimationFrame = id => pending.delete(id);
  return time => {
    const callbacks = pending;
    pending = new Map();
    for (const callback of callbacks.values()) callback(time);
  };
}
