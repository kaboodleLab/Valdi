// Clock-to-floor lighting from WorldOS apps/sun/sun.js. Keep this arithmetic
// independent of Three so the native renderer can use the same grade on any GPU.
const RISE = 6;
const SET = 20.5;
const DAY = SET - RISE;
const NIGHT = 24 - DAY;
const SPAN = 9.8;
const KEYS = [
  [0, 0x7f859c, 0x8e94a6],
  [.16, 0xa7a6b4, 0xe0b394],
  [.5, 0xdcdcdd, 0xf4dcc4],
  [1, 0xecedeb, 0xf7f2e8],
];

const clamp01 = x => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};
const mix = (a, b, k) => a + (b - a) * k;
const linear = byte => {
  const s = byte / 255;
  return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
};
const rgb = hex => [linear((hex >>> 16) & 255), linear((hex >>> 8) & 255),
  linear(hex & 255)];
const mixRgb = (a, b, k) => a.map((component, i) => mix(component, b[i], k));

export function worldSunGrade(hour, cameraX = 5.3, cameraZ = 8.1) {
  if (!Number.isFinite(hour)) throw new TypeError('WorldOS hour must be finite');
  const h = ((hour % 24) + 24) % 24;
  const moon = h < RISE || h >= SET;
  const eff = moon ? (h >= SET ? h - SET : h + 24 - SET) / NIGHT :
    (h - RISE) / DAY;
  const elevation = Math.sin(Math.PI * eff);
  const sunElevation = moon ? 0 : elevation;
  let key = 0;
  while (key < KEYS.length - 2 && sunElevation > KEYS[key + 1][0]) ++key;
  const from = KEYS[key], to = KEYS[key + 1];
  const k = smooth(from[0], to[0], sunElevation);
  let tintA = mixRgb(rgb(from[1]), rgb(to[1]), k);
  let tintB = mixRgb(rgb(from[2]), rgb(to[2]), k);
  let lum = .60 + .46 * smooth(0, .85, sunElevation);
  if (moon) {
    const horizon = smooth(0, .06, elevation) * (1 - smooth(.06, .34, elevation));
    tintA = mixRgb(tintA, rgb(0xa4948e), .60 * horizon);
    tintB = mixRgb(tintB, rgb(0xc9a68d), .80 * horizon);
    tintA = mixRgb(tintA, rgb(0x8b93ab), .25 * elevation);
    tintB = mixRgb(tintB, rgb(0xa5b1c9), .45 * elevation);
    lum += -.085 * smooth(.05, .5, elevation) + .045 * elevation;
  }
  // WorldOS anchors its sun at (0,0), with its arc perpendicular to the view.
  const bearingLength = Math.hypot(cameraX, cameraZ) || 1;
  const rightX = cameraZ / bearingLength;
  const rightZ = -cameraX / bearingLength;
  const off = (eff - .5) * SPAN;
  const body = moon ? .55 : 1;
  return {
    moon, elevation, tintA, tintB, lum, amount: .92,
    night: 1 - smooth(.74, .90, lum),
    direction: off >= 0 ? [rightX, rightZ] : [-rightX, -rightZ],
    sunGrid: [rightX * off, rightZ * off],
    split: .17 * clamp01(Math.abs(off) / (SPAN * .5)) * body,
    pool: (.05 + .16 * (1 - elevation)) * body,
  };
}
