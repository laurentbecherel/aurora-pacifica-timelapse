// Tessendorf FFT ocean bake: Phillips spectrum -> looping displacement atlas.
// Pure JS (runs in a Web Worker in the page; imported by Node tests too).
// Atlas layout: (grid x grid) tiles of N x N, RGBA float32:
//   R height (m)   G Dx chop (m)   B Dz chop (m)   A Jacobian (foam source)
// Dispersion is quantized to multiples of 2*pi/T so frame FRAMES == frame 0.
import { mulberry32 } from '../sim/traffic.js';

const G_GRAV = 9.81;

function makeBitRev(n) {
  const bits = Math.log2(n), rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0, x = i;
    for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; }
    rev[i] = r;
  }
  return rev;
}

// In-place iterative radix-2 FFT over rows then cols of an N x N complex
// field (re/im Float32Arrays). inverse=true uses +i exponent, unscaled.
function fft2(re, im, N, rev, inverse) {
  const sign = inverse ? 1 : -1;
  const line = (base, stride) => {
    // bit-reverse permute one line via temp copy
    const tr = new Float32Array(N), ti = new Float32Array(N);
    for (let i = 0; i < N; i++) { tr[rev[i]] = re[base + i * stride]; ti[rev[i]] = im[base + i * stride]; }
    for (let len = 2; len <= N; len <<= 1) {
      const half = len >> 1;
      const angBase = (sign * 2 * Math.PI) / len;
      for (let i = 0; i < N; i += len) {
        for (let j = 0; j < half; j++) {
          const ang = angBase * j;
          const wr = Math.cos(ang), wi = Math.sin(ang);
          const a = i + j, b = i + j + half;
          const xr = tr[b] * wr - ti[b] * wi, xi = tr[b] * wi + ti[b] * wr;
          tr[b] = tr[a] - xr; ti[b] = ti[a] - xi;
          tr[a] += xr; ti[a] += xi;
        }
      }
    }
    for (let i = 0; i < N; i++) { re[base + i * stride] = tr[i]; im[base + i * stride] = ti[i]; }
  };
  for (let z = 0; z < N; z++) line(z * N, 1);       // rows (x)
  for (let x = 0; x < N; x++) line(x, N);           // cols (z)
}

// Phillips spectrum with small-wave suppression.
function phillips(kx, kz, windX, windZ, L0, amp, dampL) {
  const k2 = kx * kx + kz * kz;
  if (k2 < 1e-8) return 0;
  const k = Math.sqrt(k2);
  const kL = k * L0;
  const dot = (kx * windX + kz * windZ) / k;
  return amp * (Math.exp(-1 / (kL * kL)) / (k2 * k2)) * dot * dot * Math.exp(-k2 * dampL * dampL);
}

export const FFT_DEFAULTS = {
  N: 128, frames: 64, tileM: 256, periodSec: 16,
  windSpeed: 14, windDirRad: 0.32, chop: 1.4, targetHsM: 3.5, seed: 1337,
};

// Bakes the atlas. onProgress(0..1). Returns {atlas, size, frames, grid, N, stats}.
export function bakeOceanAtlas(opts = {}, onProgress = null) {
  const o = { ...FFT_DEFAULTS, ...opts };
  const { N, frames, tileM, periodSec } = o;
  const grid = Math.ceil(Math.sqrt(frames));
  const size = N * grid;
  const NN = N * N;
  const rnd = mulberry32(o.seed);
  const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) * 1.4142; // ~N(0,1)

  // Wave vectors in FFT index order + h0 spectrum.
  const kxA = new Float32Array(NN), kzA = new Float32Array(NN);
  const h0re = new Float32Array(NN), h0im = new Float32Array(NN);
  const omega = new Float32Array(NN);
  const windX = Math.cos(o.windDirRad), windZ = Math.sin(o.windDirRad);
  const L0 = (o.windSpeed * o.windSpeed) / G_GRAV;
  const w0 = (2 * Math.PI) / periodSec;
  for (let mz = 0; mz < N; mz++) {
    for (let mx = 0; mx < N; mx++) {
      const i = mz * N + mx;
      const kx = ((mx <= N / 2 ? mx : mx - N) * 2 * Math.PI) / tileM;
      const kz = ((mz <= N / 2 ? mz : mz - N) * 2 * Math.PI) / tileM;
      kxA[i] = kx; kzA[i] = kz;
      const p = phillips(kx, kz, windX, windZ, L0, 1.0, 0.45);
      const s = Math.sqrt(p / 2);
      h0re[i] = gauss() * s; h0im[i] = gauss() * s;
      const w = Math.sqrt(G_GRAV * Math.sqrt(kx * kx + kz * kz));
      omega[i] = Math.floor(w / w0) * w0; // quantize -> perfect loop
    }
  }
  const rev = makeBitRev(N);
  const negIdx = (mz, mx) => (((N - mz) % N) * N) + ((N - mx) % N);

  // Per-frame fields, then calibrated so height RMS gives target Hs.
  const heights = new Float32Array(frames * NN);
  const dispsX = new Float32Array(frames * NN);
  const dispsZ = new Float32Array(frames * NN);
  const specRe = new Float32Array(NN), specIm = new Float32Array(NN);
  let sumSq = 0;

  const buildField = (t, kind, out, outOff) => {
    for (let mz = 0; mz < N; mz++) {
      for (let mx = 0; mx < N; mx++) {
        const i = mz * N + mx, j = negIdx(mz, mx);
        const wt = omega[i] * t, c = Math.cos(wt), s = Math.sin(wt);
        // h~(k,t) = h0(k) e^{iwt} + conj(h0(-k)) e^{-iwt}
        let re = (h0re[i] + h0re[j]) * c - (h0im[i] - h0im[j]) * s;
        let im = (h0re[i] - h0re[j]) * s + (h0im[i] + h0im[j]) * c;
        if (kind !== 0) {
          const kx = kxA[i], kz = kzA[i];
          const k = Math.sqrt(kx * kx + kz * kz);
          if (k < 1e-6) { re = 0; im = 0; }
          else {
            // Multiply by -i * (kx|kz)/k :  (a+bi)*(-i*f) = b f - a f i
            const f = (kind === 1 ? kx : kz) / k;
            const nr = im * f, ni = -re * f;
            re = nr; im = ni;
          }
        }
        specRe[i] = re; specIm[i] = im;
      }
    }
    fft2(specRe, specIm, N, rev, true);
    const scale = 1 / NN;
    for (let i = 0; i < NN; i++) out[outOff + i] = specRe[i] * scale;
  };

  for (let f = 0; f < frames; f++) {
    const t = (f / frames) * periodSec;
    buildField(t, 0, heights, f * NN);
    buildField(t, 1, dispsX, f * NN);
    buildField(t, 2, dispsZ, f * NN);
    for (let i = 0; i < NN; i++) { const h = heights[f * NN + i]; sumSq += h * h; }
    if (onProgress) onProgress((f + 1) / frames * 0.85);
  }
  // Calibrate: Hs ~= 4 * sigma(height) for a narrow-band sea.
  const rms = Math.sqrt(sumSq / (frames * NN));
  const hScale = rms > 1e-9 ? (o.targetHsM / 4) / rms : 1;
  const dScale = hScale * o.chop;

  // Pack atlas + Jacobian from displacement gradients.
  const atlas = new Float32Array(size * size * 4);
  const texelM = tileM / N;
  let hMin = 1e9, hMax = -1e9, jMin = 1e9;
  for (let f = 0; f < frames; f++) {
    const tileX = (f % grid) * N, tileY = Math.floor(f / grid) * N;
    const off = f * NN;
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const i = z * N + x;
        const xp = z * N + ((x + 1) % N), xm = z * N + ((x - 1 + N) % N);
        const zp = ((z + 1) % N) * N + x, zm = ((z - 1 + N) % N) * N + x;
        const dDxdx = (dispsX[off + xp] - dispsX[off + xm]) * dScale / (2 * texelM);
        const dDxdz = (dispsX[off + zp] - dispsX[off + zm]) * dScale / (2 * texelM);
        const dDzdx = (dispsZ[off + xp] - dispsZ[off + xm]) * dScale / (2 * texelM);
        const dDzdz = (dispsZ[off + zp] - dispsZ[off + zm]) * dScale / (2 * texelM);
        const jac = (1 + dDxdx) * (1 + dDzdz) - dDxdz * dDzdx;
        const h = heights[off + i] * hScale;
        if (h < hMin) hMin = h; if (h > hMax) hMax = h; if (jac < jMin) jMin = jac;
        const a = ((tileY + z) * size + (tileX + x)) * 4;
        atlas[a] = h;
        atlas[a + 1] = dispsX[off + i] * dScale;
        atlas[a + 2] = dispsZ[off + i] * dScale;
        atlas[a + 3] = Math.max(-2, Math.min(2, jac));
      }
    }
    if (onProgress) onProgress(0.85 + (f + 1) / frames * 0.15);
  }
  return {
    atlas, size, frames, grid, N, periodSec, tileM,
    stats: { rmsBefore: rms, hScale, hMin, hMax, jMin, HsM: o.targetHsM },
  };
}
