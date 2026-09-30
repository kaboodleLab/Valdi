// Placement is a World action, not a rendering decision. A launcher raised on
// empty ground keeps that tile; the button without a tile gets a nearby free one.
export function chooseLaunchTile(preferred, occupied, center, maxRadius = 64) {
  const valid = tile => tile && Number.isInteger(tile.x) && Number.isInteger(tile.z) &&
    Math.abs(tile.x) <= 10000 && Math.abs(tile.z) <= 10000;
  const free = tile => valid(tile) && !occupied.has(`${tile.x},${tile.z}`);
  if (free(preferred)) return { x: preferred.x, z: preferred.z };

  const x0 = Math.round(center.x) + 2;
  const z0 = Math.round(center.z);
  for (let radius = 0; radius <= maxRadius; ++radius) {
    for (let dz = -radius; dz <= radius; ++dz) {
      for (let dx = -radius; dx <= radius; ++dx) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const tile = { x: x0 + dx, z: z0 + dz };
        if (free(tile)) return tile;
      }
    }
  }
  return null;
}
