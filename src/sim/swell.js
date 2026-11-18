// Coherent swell train shared by the ocean shader (src/gfx/ocean.js builds
// its TSL loop from SWELL_WAVES) and the CPU ship-motion coupling in
// src/main.js, so the ship rides the same waves the player sees.
// Coordinates are sampled space: x = starboard-ish, y = forward (metres).
export const SWELL_WAVES = [
  { dx: 0.98, dz: -0.20, wl: 265, amp: 0.34 },
  { dx: 0.91, dz: 0.42, wl: 171, amp: 0.21 },
  { dx: 0.76, dz: -0.65, wl: 108, amp: 0.12 },
];

const G = 9.81;

// Swell height (metres, at unit ocean amplitude) at sampled point (sx, sy).
export function swellHeight(sx, sy, tSec) {
  let h = 0;
  for (const w of SWELL_WAVES) {
    const k = (2 * Math.PI) / w.wl;
    h += w.amp * Math.sin((w.dx * sx + w.dz * sy) * k - Math.sqrt(G * k) * tSec);
  }
  return h;
}
