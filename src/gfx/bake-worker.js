// Bake worker: FFT ocean atlas + cloud noise volume, off the main thread.
import { bakeOceanAtlas } from './fft-core.js';
import { bakeNoiseVolume } from './noise-core.js';

self.onmessage = (e) => {
  if (e.data?.type !== 'bake') return;
  try {
    const fft = bakeOceanAtlas(e.data.fftOpts || {}, (p) =>
      self.postMessage({ type: 'progress', phase: 'FFT ocean spectrum', p: p * 0.72 }));
    const noise = bakeNoiseVolume(128, (p) =>
      self.postMessage({ type: 'progress', phase: 'Cloud volume', p: 0.72 + p * 0.28 }));
    self.postMessage({
      type: 'done',
      fft: {
        size: fft.size, frames: fft.frames, grid: fft.grid, N: fft.N,
        periodSec: fft.periodSec, tileM: fft.tileM, stats: fft.stats,
        buffer: fft.atlas.buffer,
      },
      noise: { size: noise.size, buffer: noise.data.buffer },
    }, [fft.atlas.buffer, noise.data.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.stack || err) });
  }
};
