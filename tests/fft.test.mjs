// Node tests for the FFT ocean bake. Run: node tests/fft.test.mjs
import assert from 'node:assert';
import { bakeOceanAtlas } from '../src/gfx/fft-core.js';
import { bakeNoiseVolume } from '../src/gfx/noise-core.js';

let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; console.log('  ok -', m); };

console.log('fft bake (small):');
const small = bakeOceanAtlas({ N: 32, frames: 8, tileM: 256, seed: 7 });
ok(small.atlas.length === small.size * small.size * 4, `atlas sized ${small.size}x${small.size}`);
ok(small.atlas.every(Number.isFinite), 'all texels finite');
let sumSq = 0, jacMin = 10, hMaxAbs = 0, count = 0;
for (let f = 0; f < small.frames; f++) {
  const tx = (f % small.grid) * small.N, ty = Math.floor(f / small.grid) * small.N;
  for (let z = 0; z < small.N; z++) for (let x = 0; x < small.N; x++) {
    const a = ((ty + z) * small.size + (tx + x)) * 4;
    const h = small.atlas[a];
    sumSq += h * h; count++;
    hMaxAbs = Math.max(hMaxAbs, Math.abs(h));
    jacMin = Math.min(jacMin, small.atlas[a + 3]);
  }
}
const sigma = Math.sqrt(sumSq / count);
console.log(`  sigma(h)=${sigma.toFixed(3)} m -> Hs~${(4 * sigma).toFixed(2)} m, max|h|=${hMaxAbs.toFixed(2)} m, Jmin=${jacMin.toFixed(2)}`);
ok(Math.abs(4 * sigma - 3.5) < 0.12, 'calibrated Hs = 3.5 m');
ok(hMaxAbs > 1.2 && hMaxAbs < 4.5, 'crest heights plausible for Hs 3.5');
ok(jacMin < 0.8, 'displacement compression present (foam source, coarse grid)');

const again = bakeOceanAtlas({ N: 32, frames: 8, tileM: 256, seed: 7 });
let checksum = 0, checksum2 = 0;
for (let i = 0; i < small.atlas.length; i += 37) { checksum += small.atlas[i]; checksum2 += again.atlas[i]; }
ok(Math.abs(checksum - checksum2) < 1e-6, 'same seed -> identical bake (deterministic)');

console.log('fft bake (full size, timed):');
const t0 = performance.now();
const full = bakeOceanAtlas({});
const dt = (performance.now() - t0) / 1000;
console.log(`  128x128 x 64 frames baked in ${dt.toFixed(2)} s, atlas ${full.size}px, h range [${full.stats.hMin.toFixed(2)}, ${full.stats.hMax.toFixed(2)}] m`);
ok(dt < 25, `bake fast enough for a loading overlay (${dt.toFixed(1)} s here)`);
ok(full.stats.hMax > 1.5 && full.stats.hMin < -1.5, 'full bake has real swell both ways');
console.log(`  full-bake Jmin=${full.stats.jMin.toFixed(2)}`);
ok(full.stats.jMin < 0.55, 'full-res wave folding present (storm scaling folds further in shader)');

console.log('noise volume (full 128^3, timed):');
const t1 = performance.now();
const nv = bakeNoiseVolume(128);
const ndt = (performance.now() - t1) / 1000;
ok(nv.data.length === 128 ** 3 * 4, 'volume sized');
let lo = 255, hi = 0;
for (let i = 0; i < nv.data.length; i += 4) { lo = Math.min(lo, nv.data[i]); hi = Math.max(hi, nv.data[i]); }
ok(lo < 60 && hi > 200, `base channel spans range (${lo}..${hi})`);
console.log(`  128^3 baked in ${ndt.toFixed(2)} s`);
ok(ndt < 8, 'noise bake fast enough for worker loading');

console.log(`\nALL ${passed} CHECKS PASSED`);
