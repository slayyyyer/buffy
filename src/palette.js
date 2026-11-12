/**
 * Seeded palette + shape variant. Shared by the daemon (persisted with the companion)
 * and the overlay renderer (draws the placeholder sprite).
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function paletteFromSeed(seed) {
  const rand = mulberry32(seed);
  const hue = Math.floor(rand() * 360);
  const hue2 = (hue + 40 + Math.floor(rand() * 80)) % 360;
  const variant = Math.floor(rand() * 3);
  return { hue, hue2, variant };
}
