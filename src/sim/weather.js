// Weather state machine: voyage keyframes + slow perturbation + presets.
import { WEATHER_KEYS } from '../data/voyage.js';
import { clamp, lerp, smoothstep } from './voyageSim.js';

export const WEATHER_PRESETS = {
  auto: null,
  calm:   { sea: 1.2, windKt: 6,  windFrom: 270, cloud: 0.12, cloudType: 0, rain: 0, fog: 0, bolt: 0, label: 'Calm — glassy sea' },
  trade:  { sea: 3.5, windKt: 16, windFrom: 235, cloud: 0.38, cloudType: 0, rain: 0, fog: 0, bolt: 0, label: 'Trade winds — fair cumulus' },
  squall: { sea: 5.0, windKt: 26, windFrom: 230, cloud: 0.75, cloudType: 2, rain: 0.8, fog: 0.05, bolt: 0.6, label: 'Squall — heavy rain' },
  storm:  { sea: 7.5, windKt: 40, windFrom: 55,  cloud: 0.92, cloudType: 2, rain: 1.0, fog: 0.1, bolt: 0.85, label: 'Storm — storm seas, lightning' },
  fog:    { sea: 1.8, windKt: 5,  windFrom: 180, cloud: 0.85, cloudType: 1, rain: 0.05, fog: 0.85, bolt: 0, label: 'Fog — visibility near zero' },
  overcast:{ sea: 3.0, windKt: 12, windFrom: 200, cloud: 0.95, cloudType: 1, rain: 0.15, fog: 0.05, bolt: 0, label: 'Overcast — grey stratus' },
};

// Small deterministic value-noise so Auto weather breathes between keyframes.
function vnoise(x) {
  const i = Math.floor(x), f = x - i;
  const h = (k) => { const s = Math.sin(k * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const u = f * f * (3 - 2 * f);
  return lerp(h(i), h(i + 1), u) * 2 - 1;
}

export function sampleWeather(day, preset = 'auto') {
  if (preset !== 'auto' && WEATHER_PRESETS[preset]) {
    const p = WEATHER_PRESETS[preset];
    // Keep a whisper of the voyage wind direction so presets feel located.
    return { ...p };
  }
  const K = WEATHER_KEYS;
  let i = 0;
  while (i < K.length - 2 && day > K[i + 1].day) i++;
  const a = K[i], b = K[i + 1];
  const t = smoothstep((day - a.day) / Math.max(0.001, b.day - a.day));
  const mixK = (key) => lerp(a[key], b[key], t);
  // Slow perturbations (±), bounded so keyframe story beats survive.
  const wobSea = vnoise(day * 1.7) * 0.45;
  const wobCloud = vnoise(day * 2.3 + 40) * 0.08;
  return {
    sea: clamp(mixK('sea') + wobSea, 0.5, 9),
    windKt: clamp(mixK('windKt') + vnoise(day * 3.1 + 9) * 2.5, 1, 55),
    windFrom: mixK('windFrom'),
    cloud: clamp(mixK('cloud') + wobCloud, 0.02, 1),
    cloudType: t < 0.5 ? a.cloudType : b.cloudType,
    rain: clamp(mixK('rain'), 0, 1),
    fog: clamp(mixK('fog'), 0, 1),
    bolt: clamp(mixK('bolt'), 0, 1),
    label: t < 0.5 ? a.label : b.label,
  };
}

// Deterministic lightning pulse train vs voyage-seconds. Double-flash decay.
// `bolt` 0..1 is storminess; strikes get rarer/dimmer as it drops.
export function lightningPulse(voyageSec, bolt) {
  if (bolt <= 0.02) return 0;
  const period = lerp(26, 7, bolt); // mean seconds between cells (voyage time)
  const cell = Math.floor(voyageSec / period);
  const h1 = hash(cell * 3 + 1), h2 = hash(cell * 3 + 2);
  if (h1 > bolt) return 0;                    // this cell is quiet
  const t0 = (cell + 0.15 + h2 * 0.5) * period; // strike time in cell
  const dt = voyageSec - t0;
  if (dt < 0 || dt > 1.4) return 0;
  const flash = Math.exp(-dt * 18) + 0.7 * Math.exp(-Math.abs(dt - 0.18) * 22) +
    0.35 * Math.exp(-Math.abs(dt - 0.42) * 14);
  return clamp(flash, 0, 1.4) * (0.4 + 0.6 * bolt);
}
function hash(k) { const s = Math.sin(k * 91.17 + 47.31) * 28411.913; return s - Math.floor(s); }
