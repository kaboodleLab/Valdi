// Port of the hill, blade seed and color noise arithmetic in WorldOS
// kernel/engine/ground-scenes.js. Keep the source coefficients aligned there.
const fract = value => value - Math.floor(value);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const smoothstep = (low, high, value) => {
  const t = clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
};

export function meadowSeed(x, z) {
  return fract(Math.sin(x * 127.1 + z * 311.7) * 43758.5453);
}

export function meadowHill(x, z, height = 1.6) {
  const n = Math.sin(x * .70 + .35 * Math.sin(z * .41)) * Math.sin(z * .76 + .6) +
    .42 * Math.sin(x * 1.17 + z * .51 + 1.4) +
    .18 * Math.cos(z * 1.83 - x * .57);
  return (.035 + .72 * Math.pow(clamp(.50 + n * .28, 0, 1), 1.65)) * height;
}

export function meadowNoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  let fx = fract(x), fz = fract(z);
  fx = fx * fx * (3 - 2 * fx);
  fz = fz * fz * (3 - 2 * fz);
  const a = meadowSeed(ix, iz) * (1 - fx) + meadowSeed(ix + 1, iz) * fx;
  const b = meadowSeed(ix, iz + 1) * (1 - fx) + meadowSeed(ix + 1, iz + 1) * fx;
  return a * (1 - fz) + b * fz;
}

export function meadowRoom(x, z, occupied) {
  let distance = Infinity;
  const cx = Math.round(x), cz = Math.round(z);
  for (let dz = -1; dz <= 1; ++dz) for (let dx = -1; dx <= 1; ++dx) {
    if (!occupied.has(`${cx + dx},${cz + dz}`)) continue;
    distance = Math.min(distance, Math.max(Math.abs(x - cx - dx), Math.abs(z - cz - dz)));
  }
  return smoothstep(.54, .86, distance);
}

export function meadowMemoryLowland(x, z, holeX = 1, holeZ = 0) {
  return smoothstep(1.3, 4.1, Math.hypot(x - holeX, z - holeZ));
}
