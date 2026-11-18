// Shared configuration: quality tiers & default experience state.
export const QUALITY = {
  cinematic:   { label: 'Cinematic (3080 · 4K)', renderScale: 1.0,  cloudSteps: 32, bloom: true,  rainCount: 7000 },
  balanced:    { label: 'Balanced',              renderScale: 0.75, cloudSteps: 22, bloom: true,  rainCount: 4500 },
  performance: { label: 'Performance',           renderScale: 0.55, cloudSteps: 14, bloom: false, rainCount: 2500 },
};

export const DEFAULT_STATE = {
  playing: true,
  timeScale: 1200,          // sim-seconds per real second (timelapse)
  voyageDay: 0.155,         // first Red Sea dawn, near the start of the route (verified in tests)
  camera: 'bridge',
  preset: 'auto',
  manual: { sea: null, cloud: null, windKt: null },
  waveScale: 1.0,           // user multiplier on significant wave height
  foam: 1.0,
  exposure: 1.05,
  stabilize: 0.2,           // 0 ship-fixed horizon .. 1 fully level
  fov: 58,
  quality: 'cinematic',
  bloom: true,
  traffic: true,
  rainFx: true,
  linkSeaClock: false,      // true: waves also race in timelapse
  audio: false,
};

// Cloud look per weather cloudType: base/thickness (m) + profile vector
// (bottomSoft, topSoft, densityMul, detailAmt).
export const CLOUD_TYPES = [
  { base: 820,  thick: 1250, profile: [0.08, 0.84, 1.05, 0.65] }, // cumulus
  { base: 620,  thick: 330,  profile: [0.18, 0.58, 0.9, 0.25] },  // stratus
  { base: 480,  thick: 2100, profile: [0.06, 0.82, 1.3, 0.75] },  // storm towers
];
