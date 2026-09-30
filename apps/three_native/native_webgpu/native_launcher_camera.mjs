// An orthographic adaptation of WorldOS's spatial launcher camera flight.
// The scene owns the camera; the launcher supplies only a world cell and the
// browser's spring progress. Keeping the pose calculation pure lets input and
// resize paths restore the exact view captured before the launcher opened.
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = value => Math.max(0, Math.min(1, value));

export function launcherCameraPose(base, tile, progress, turn) {
  const k = clamp01(progress);
  const dx = base.position.x - base.target.x;
  const dy = base.position.y - base.target.y;
  const dz = base.position.z - base.target.z;
  const distance = Math.hypot(dx, dy, dz);
  const azimuth = Math.atan2(dx, dz) + turn * k;
  const elevation = lerp(Math.asin(dy / distance),
    Math.max(Math.asin(dy / distance), Math.PI * .31), k);
  const target = {
    x: lerp(base.target.x, tile.x, k),
    y: lerp(base.target.y, tile.y, k),
    z: lerp(base.target.z, tile.z, k),
  };
  return {
    target,
    position: {
      x: target.x + distance * Math.cos(elevation) * Math.sin(azimuth),
      y: target.y + distance * Math.sin(elevation),
      z: target.z + distance * Math.cos(elevation) * Math.cos(azimuth),
    },
    // The browser changes its perspective lens. Native Home keeps its
    // orthographic lens and eases the scale slightly outward to fit the tile.
    zoom: base.zoom * lerp(1, .95, k),
  };
}
