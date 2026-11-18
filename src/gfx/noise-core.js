// Tileable 3D noise volume for volumetric clouds (baked in the FFT worker).
// R: Perlin-Worley base shape  G/B/A: Worley at 8/16/32 cells (erosion detail).
// Lattice values and Worley feature points are precomputed once per scale.
function hash3(x, y, z, salt) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177) ^ Math.imul(salt, 974634321);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const sCurve = (t) => t * t * (3 - 2 * t);

function makeLattice(cells, salt) {
  const a = new Float32Array(cells * cells * cells);
  for (let z = 0; z < cells; z++) for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++)
    a[(z * cells + y) * cells + x] = hash3(x, y, z, salt);
  return a;
}
function sampleLattice(a, cells, x, y, z) {
  const xi = Math.floor(x * cells), yi = Math.floor(y * cells), zi = Math.floor(z * cells);
  const xf = sCurve(x * cells - xi), yf = sCurve(y * cells - yi), zf = sCurve(z * cells - zi);
  const W = (v) => ((v % cells) + cells) % cells;
  const c = (dx, dy, dz) => a[(W(zi + dz) * cells + W(yi + dy)) * cells + W(xi + dx)];
  const x00 = c(0, 0, 0) + (c(1, 0, 0) - c(0, 0, 0)) * xf;
  const x10 = c(0, 1, 0) + (c(1, 1, 0) - c(0, 1, 0)) * xf;
  const x01 = c(0, 0, 1) + (c(1, 0, 1) - c(0, 0, 1)) * xf;
  const x11 = c(0, 1, 1) + (c(1, 1, 1) - c(0, 1, 1)) * xf;
  const y0 = x00 + (x10 - x00) * yf, y1 = x01 + (x11 - x01) * yf;
  return y0 + (y1 - y0) * zf;
}
function makeWorleyPoints(cells, salt) {
  const a = new Float32Array(cells * cells * cells * 3);
  for (let z = 0; z < cells; z++) for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
    const i = ((z * cells + y) * cells + x) * 3;
    a[i] = hash3(x, y, z, salt); a[i + 1] = hash3(x, y, z, salt + 7); a[i + 2] = hash3(x, y, z, salt + 13);
  }
  return a;
}
function sampleWorley(pts, cells, x, y, z) {
  const xi = Math.floor(x * cells), yi = Math.floor(y * cells), zi = Math.floor(z * cells);
  let f1 = 8;
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = xi + dx, cy = yi + dy, cz = zi + dz;
    const wx = ((cx % cells) + cells) % cells, wy = ((cy % cells) + cells) % cells, wz = ((cz % cells) + cells) % cells;
    const i = ((wz * cells + wy) * cells + wx) * 3;
    const ddx = (cx + pts[i]) / cells - x;
    const ddy = (cy + pts[i + 1]) / cells - y;
    const ddz = (cz + pts[i + 2]) / cells - z;
    const d = ddx * ddx + ddy * ddy + ddz * ddz;
    if (d < f1) f1 = d;
  }
  return Math.sqrt(f1) * cells * 0.55;
}

export function bakeNoiseVolume(size = 128, onProgress = null) {
  const data = new Uint8Array(size * size * size * 4);
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const lat4 = makeLattice(4, 1), lat8 = makeLattice(8, 2), lat16 = makeLattice(16, 3);
  const wor4 = makeWorleyPoints(4, 11), wor8 = makeWorleyPoints(8, 21);
  const wor16 = makeWorleyPoints(16, 31), wor32 = makeWorleyPoints(32, 41);
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size, v = y / size, w = z / size;
        const fbm = sampleLattice(lat4, 4, u, v, w) * 0.55 +
          sampleLattice(lat8, 8, u, v, w) * 0.28 + sampleLattice(lat16, 16, u, v, w) * 0.17;
        const base = clamp01(((fbm * 0.72 + (1 - clamp01(sampleWorley(wor4, 4, u, v, w))) * 0.5) - 0.28) * 1.7);
        const idx = ((z * size + y) * size + x) * 4;
        data[idx] = Math.round(base * 255);
        data[idx + 1] = Math.round(clamp01(sampleWorley(wor8, 8, u, v, w)) * 255);
        data[idx + 2] = Math.round(clamp01(sampleWorley(wor16, 16, u, v, w)) * 255);
        data[idx + 3] = Math.round(clamp01(sampleWorley(wor32, 32, u, v, w)) * 255);
      }
    }
    if (onProgress && z % 12 === 0) onProgress(z / size);
  }
  if (onProgress) onProgress(1);
  return { data, size };
}
