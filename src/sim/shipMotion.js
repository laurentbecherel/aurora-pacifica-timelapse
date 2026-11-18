// Ship motion response: a 330 m ULCS is a slow, heavy oscillator.
// Amplitudes scale with Douglas sea state; motion runs on the sea clock
// (real seconds) so the ship rolls believably even during timelapse.
import { clamp } from './voyageSim.js';

// Sea state -> motion scale (0 calm .. 1 storm). Non-linear: big ships
// barely notice sea 3, then motion grows fast in head seas.
export function seaMotionScale(seaState) {
  const s = clamp((seaState - 1.5) / 7, 0, 1);
  return s * s * 0.7 + s * 0.3;
}

export function motionAt(tSec, seaState, speedKn = 18) {
  const m = seaMotionScale(seaState);
  const underway = clamp(speedKn / 6, 0.25, 1); // berthed: near-still
  const w = (period, phase) => Math.sin((2 * Math.PI * tSec) / period + phase);
  const pitchDeg = underway * m * (1.55 * w(11.0, 0.0) + 0.7 * w(17.3, 1.7) + 0.35 * w(7.1, 4.0)) + 0.06 * w(13.0, 0.5);
  const rollDeg = underway * m * (4.4 * w(21.0, 0.8) + 1.7 * w(31.0, 2.9) + 0.7 * w(12.7, 5.1)) + 0.15 * w(24.0, 1.2);
  const heaveM = underway * m * (1.9 * w(10.2, 2.2) + 0.8 * w(16.4, 0.3)) + 0.05 * w(11.0, 1.0);
  const yawDeg = underway * (0.35 * w(27.0, 3.3) + 0.2 * w(41.0, 0.9)) * (0.4 + m);
  return { pitchDeg, rollDeg, heaveM, yawDeg };
}

// Significant wave height (m) for Douglas sea state, for scaling the
// baked FFT displacement (baked at Hs ~ 3.5 m).
const HS_TABLE = [0.05, 0.2, 0.6, 1.25, 2.0, 3.0, 4.5, 6.5, 9.0, 12.0];
export function significantHeightM(seaState) {
  const s = clamp(seaState, 0, 9);
  const i = Math.floor(s), f = s - i;
  return HS_TABLE[i] * (1 - f) + HS_TABLE[Math.min(9, i + 1)] * f;
}
export const BAKE_HS_M = 3.5;
