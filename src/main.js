// AURORA PACIFICA — bridge timelapse simulator. Boot, simulation loop,
// camera rigs and UI wiring. Systems live in src/sim, src/gfx, src/audio.
import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

import { QUALITY, DEFAULT_STATE, CLOUD_TYPES } from './config.js';
import { VOYAGE_START_UTC, TOTAL_DAYS, FEATURES, WAYPOINTS } from './data/voyage.js';
import { shipAt, enuFromLatLon, clamp, lerp, rad, smoothstep } from './sim/voyageSim.js';
import { sunPosition, moonPosition, enuDirToShipFrame, enuOffsetToShipFrame } from './sim/solar.js';
import { sampleWeather, lightningPulse } from './sim/weather.js';
import { buildTraffic, trafficAt } from './sim/traffic.js';
import { motionAt, significantHeightM, BAKE_HS_M } from './sim/shipMotion.js';
import { createSkyUniforms, createSkyDome, makePlaceholderVolume } from './gfx/sky.js';
import { createOcean, makePlaceholderAtlas, ATLAS_FRAMES, ATLAS_PERIOD } from './gfx/ocean.js';
import { buildShip, SHIP } from './gfx/ship.js';
import { VesselPool, buildRidge, buildPort } from './gfx/vessels.js';
import { createRain } from './gfx/rain.js';
import { AmbientAudio } from './audio/ambient.js';

const state = structuredClone(DEFAULT_STATE);
const $ = (id) => document.getElementById(id);
const errBox = $('errBox');
function showError(msg) {
  errBox.hidden = false;
  errBox.textContent = '⚠ ' + msg;
  console.error(msg);
}
window.addEventListener('error', (e) => showError(e.message || 'unknown error'));
window.addEventListener('unhandledrejection', (e) => showError(String(e.reason?.message || e.reason)));

// ---------- renderer / scene ----------
const app = $('app');
const renderer = new THREE.WebGPURenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = state.exposure;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x8fa8bc, 0.00006);
const camera = new THREE.PerspectiveCamera(state.fov, 16 / 9, 0.6, 900000);
scene.add(camera);

const sunLight = new THREE.DirectionalLight(0xffffff, 3);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
Object.assign(sunLight.shadow.camera, { left: -210, right: 210, top: 210, bottom: -210, near: 50, far: 1800 });
sunLight.shadow.bias = -0.0006;
sunLight.shadow.normalBias = 1.2;
scene.add(sunLight, sunLight.target);
const hemi = new THREE.HemisphereLight(0xbdd6ea, 0x1c2f3d, 0.7);
scene.add(hemi);
const flashLight = new THREE.DirectionalLight(0xaFC4ff, 0);
flashLight.position.set(300, 800, -500);
scene.add(flashLight, flashLight.target);
// Warm work-lights anchored at the visible floodlight masts along the deck.
const deckLights = [-95, -25, 45].flatMap((z) => [-27, 27].map((x) => {
  const light = new THREE.PointLight(0xffc98a, 0, 150, 2);
  light.position.set(x, 34.5, z);
  scene.add(light);
  return light;
}));

// ---------- sky / ocean / ship ----------
const skyU = createSkyUniforms();
const sky = createSkyDome(skyU, makePlaceholderVolume());
scene.add(sky.mesh);
const ocean = createOcean(skyU, sky.atmosphere, makePlaceholderAtlas());
scene.add(ocean.mesh);
const ship = buildShip();
ship.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
ship.interior.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
scene.add(ship.group);
const rain = createRain(skyU);
scene.add(rain.mesh);
const vessels = new VesselPool(scene);
const fleet = buildTraffic();

// Land & ports (lat/lon anchored, positioned per frame).
const featureObjs = FEATURES.map((f) => {
  const obj = f.type === 'port' ? buildPort(f.len) : buildRidge(f.len, f.h, 11 + f.len % 97);
  obj.visible = false;
  scene.add(obj);
  return { f, obj };
});

// ---------- post ----------
const post = new THREE.PostProcessing(renderer);
const scenePass = pass(scene, camera);
const sceneColor = scenePass.getTextureNode('output');
const bloomNode = bloom(sceneColor, 0.5, 0.55, 0.82);
post.outputNode = sceneColor.add(bloomNode);

// ---------- bake worker (FFT atlas + cloud volume) ----------
let fftReady = false;

function applyBake(fft, noise) {
  // Float32 atlas -> HalfFloat (filterable on every WebGPU adapter).
  const src = new Float32Array(fft.buffer);
  const half = new Uint16Array(src.length);
  const toHalf = THREE.DataUtils.toHalfFloat;
  for (let i = 0; i < src.length; i++) half[i] = toHalf(src[i]);
  const atlasTex = new THREE.DataTexture(half, fft.size, fft.size, THREE.RGBAFormat, THREE.HalfFloatType);
  atlasTex.magFilter = atlasTex.minFilter = THREE.LinearFilter;
  atlasTex.wrapS = atlasTex.wrapT = THREE.ClampToEdgeWrapping;
  atlasTex.needsUpdate = true;
  ocean.atlasNode.value = atlasTex;

  const volTex = new THREE.Data3DTexture(new Uint8Array(noise.buffer), noise.size, noise.size, noise.size);
  volTex.format = THREE.RGBAFormat;
  volTex.magFilter = volTex.minFilter = THREE.LinearFilter;
  volTex.wrapS = volTex.wrapT = volTex.wrapR = THREE.RepeatWrapping;
  volTex.needsUpdate = true;
  sky.volNode.value = volTex;
  fftReady = true;
  console.info('[bake] FFT stats', fft.stats);
}

function startBake() {
  const phase = $('loadPhase'), bar = $('loadBar');
  const progress = (label, p) => {
    void label;
    if (phase) phase.textContent = `${p < 0.72 ? 'Preparing the ocean' : 'Preparing the sky'} — ${Math.round(p * 100)}%`;
    if (bar) bar.style.width = `${Math.round(p * 100)}%`;
  };
  try {
    const worker = new Worker(new URL('./gfx/bake-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      if (e.data.type === 'progress') progress(e.data.phase, e.data.p);
      else if (e.data.type === 'done') { applyBake(e.data.fft, e.data.noise); worker.terminate(); }
      else if (e.data.type === 'error') { console.error(e.data.message); fallbackBake(progress); }
    };
    worker.onerror = () => fallbackBake(progress);
    worker.postMessage({ type: 'bake' });
  } catch (err) {
    console.warn('Worker unavailable, baking on main thread', err);
    fallbackBake(progress);
  }
}
let fallbackStarted = false;
async function fallbackBake(progress) {
  if (fallbackStarted || fftReady) return;
  fallbackStarted = true;
  progress('FFT ocean spectrum (main thread)', 0.05);
  await new Promise((r) => setTimeout(r, 60));
  const { bakeOceanAtlas } = await import('./gfx/fft-core.js');
  const { bakeNoiseVolume } = await import('./gfx/noise-core.js');
  const fft = bakeOceanAtlas({}, (p) => progress('FFT ocean spectrum', p * 0.72));
  const noise = bakeNoiseVolume(128, (p) => progress('Cloud volume', 0.72 + p * 0.28));
  applyBake(
    { ...fft, buffer: fft.atlas.buffer },
    { size: noise.size, buffer: noise.data.buffer });
}

// ---------- CPU sky palette (drives lights, fog, water body) ----------
const C = (r, g, b) => new THREE.Color(r, g, b);
const PAL = {
  sunWarm: C(1.0, 0.42, 0.16), sunNoon: C(1.0, 0.96, 0.9),
  fogDay: C(0.55, 0.66, 0.79), fogDusk: C(0.42, 0.30, 0.30), fogNight: C(0.014, 0.023, 0.04),
  ambDay: C(0.30, 0.40, 0.55), ambDusk: C(0.24, 0.20, 0.28), ambNight: C(0.012, 0.02, 0.038),
  deepDay: C(0.007, 0.042, 0.072), deepNight: C(0.0012, 0.004, 0.010),
  scatterDay: C(0.03, 0.20, 0.19),
};
const _c1 = new THREE.Color(), _c2 = new THREE.Color();
function paletteAt(sunElDeg) {
  const dayF = smoothstep(clamp((sunElDeg + 2) / 14, 0, 1));
  const duskF = (1 - dayF) * smoothstep(clamp((sunElDeg + 13) / 11, 0, 1));
  const nightF = 1 - smoothstep(clamp((sunElDeg + 9) / 9.5, 0, 1));
  return { dayF, duskF, nightF };
}
function mix3(out, night, dusk, day, p) {
  out.copy(night).lerp(dusk, clamp(p.duskF * 1.6, 0, 1)).lerp(day, p.dayF);
  return out;
}

// ---------- camera rigs ----------
const CAMS = {
  bridge: { pos: new THREE.Vector3(0, SHIP.bridgeY + 0.4, 120.55), tgt: new THREE.Vector3(0, 42, -220), interior: true },
  wing:   { pos: new THREE.Vector3(31.2, SHIP.bridgeY + 1.1, 120.2), tgt: new THREE.Vector3(95, 6, -430), interior: false },
  bow:    { pos: new THREE.Vector3(-16, 34, -127), tgt: new THREE.Vector3(18, 14, -520), interior: false },
  stern:  { pos: new THREE.Vector3(92, 36, 252), tgt: new THREE.Vector3(-10, 10, 150), interior: false },
  drone:  { pos: null, tgt: new THREE.Vector3(0, 22, 0), interior: false },
};
const look = { yaw: 0, pitch: 0 };
let droneAngle = 0.7, droneHeight = 135, draggingLook = false;

const audio = new AmbientAudio();
const oceanOff = [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()];
const OCT_TILES_JS = [340, 76, 10];
let smoothedSea = 3, smoothedLightning = 0, lastThunderPulse = 0;
let seaTime = 0, elapsed = 0, fftBlendStart = -1;

// ENU direction of a compass course -> ship-frame rotation helpers.
function courseRotY(courseDeg, headingDeg) {
  const r = rad(courseDeg);
  const d = enuDirToShipFrame(Math.sin(r), 0, Math.cos(r), headingDeg);
  return Math.atan2(-d.x, -d.z);
}
function axisRotY(orientDeg, headingDeg) {
  const r = rad(orientDeg);
  const d = enuDirToShipFrame(Math.sin(r), 0, Math.cos(r), headingDeg);
  return Math.atan2(-d.z, d.x);
}

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();

function updateWorld(dt) {
  // Clocks.
  const voyDtSec = state.playing ? dt * state.timeScale : 0;
  if (state.playing) {
    state.voyageDay = (state.voyageDay + voyDtSec / 86400) % TOTAL_DAYS;
  }
  const seaDt = state.linkSeaClock && state.playing ? dt * Math.min(state.timeScale, 60) : dt;
  seaTime += seaDt;
  elapsed += dt;
  // Released look-drag eases back toward the bow.
  if (!draggingLook) {
    const k = 1 - Math.exp(-dt * 0.7);
    look.yaw += (0 - look.yaw) * k;
    look.pitch += (0 - look.pitch) * k;
  }

  const day = state.voyageDay;
  const shipState = shipAt(day);
  const utcMs = VOYAGE_START_UTC + day * 86400000;
  const wxRaw = sampleWeather(day, state.preset);
  const wx = {
    ...wxRaw,
    sea: state.manual.sea ?? wxRaw.sea,
    cloud: state.manual.cloud ?? wxRaw.cloud,
    windKt: state.manual.windKt ?? wxRaw.windKt,
  };
  smoothedSea = lerp(smoothedSea, wx.sea, 1 - Math.exp(-dt * 0.5));

  // Sun & moon in ship frame.
  const sun = sunPosition(utcMs, shipState.lat, shipState.lon);
  const moon = moonPosition(utcMs, shipState.lat, shipState.lon);
  const sd = enuDirToShipFrame(sun.east, sun.up, sun.north, shipState.headingDeg);
  const md = enuDirToShipFrame(moon.east, moon.up, moon.north, shipState.headingDeg);
  skyU.sunDir.value.set(sd.x, sd.y, sd.z).normalize();
  skyU.moonDir.value.set(md.x, md.y, md.z).normalize();
  const pal = paletteAt(sun.elevationDeg);
  const sunVis = clamp(Math.sin(rad(sun.elevationDeg)), 0, 1);
  const cloudDim = 1 - wx.cloud * (wx.cloudType === 2 ? 0.78 : 0.42);

  // Shader sun (HDR) + CPU lights agree.
  _c1.copy(PAL.sunWarm).lerp(PAL.sunNoon, clamp(sunVis * 2.2, 0, 1));
  const sunHDR = (Math.pow(sunVis, 0.55) * 8.5 + pal.duskF * 0.5) * cloudDim;
  skyU.sunColor.value.copy(_c1).multiplyScalar(Math.max(sunHDR, 0.0001));
  const moonI = moon.illum * clamp(Math.sin(rad(moon.elevationDeg)) * 3, 0, 1);
  skyU.moonColor.value.setRGB(0.55, 0.62, 0.78).multiplyScalar(0.55 * moonI + 0.001);
  mix3(skyU.ambient.value, PAL.ambNight, PAL.ambDusk, PAL.ambDay, pal)
    .multiplyScalar(1 - wx.cloud * 0.18);
  mix3(skyU.fogColor.value, PAL.fogNight, PAL.fogDusk, PAL.fogDay, pal);
  if (wx.fog > 0.3) skyU.fogColor.value.lerp(_c2.setRGB(0.42, 0.46, 0.5), (wx.fog - 0.3) * pal.dayF);
  skyU.fogColor.value.multiplyScalar(1 - wx.cloud * 0.13 - wx.rain * 0.20);
  skyU.fogDensity.value = 0.000026 + wx.fog * 0.0034 + wx.rain * 0.00010;
  skyU.haze.value = 0.18 + wx.fog * 0.7 + wx.cloud * 0.12;
  scene.fog.color.copy(skyU.fogColor.value);
  scene.fog.density = Math.sqrt(skyU.fogDensity.value / 8000);

  const useMoon = sun.elevationDeg < -1 && moon.elevationDeg > 2;
  const keyDir = useMoon ? skyU.moonDir.value : skyU.sunDir.value;
  sunLight.position.copy(keyDir).multiplyScalar(900);
  sunLight.color.copy(useMoon ? _c2.setRGB(0.62, 0.7, 0.9) : _c1);
  sunLight.intensity = useMoon ? 0.35 * moonI + 0.02
    : (Math.pow(sunVis, 0.7) * 3.1 + pal.duskF * 0.25) * cloudDim;
  sunLight.castShadow = sunLight.intensity > 0.04;
  hemi.color.copy(skyU.ambient.value).multiplyScalar(2.4);
  hemi.groundColor.copy(skyU.fogColor.value).multiplyScalar(0.7);
  hemi.intensity = 0.35 + pal.dayF * 0.7 + pal.nightF * 0.05;
  scene.environmentIntensity = 0.05 + pal.dayF * 0.22 + pal.duskF * 0.08;
  for (const light of deckLights) light.intensity = pal.nightF * 130;

  // Stars wheel with sidereal time around the celestial pole.
  const pole = enuDirToShipFrame(0, Math.sin(rad(shipState.lat)), Math.cos(rad(shipState.lat)), shipState.headingDeg);
  skyU.starAxis.value.set(pole.x, pole.y, pole.z).normalize();
  skyU.starAngle.value = (utcMs / 1000 * 7.2921159e-5) % (Math.PI * 2);
  skyU.timeSec.value = elapsed;

  // Clouds from weather.
  const ct = CLOUD_TYPES[wx.cloudType];
  skyU.cloudCover.value = wx.cloud;
  skyU.cloudBase.value = ct.base;
  skyU.cloudThick.value = ct.thick;
  skyU.cloudProfile.value.set(...ct.profile);
  skyU.cloudDark.value = clamp((wx.cloudType === 2 ? 0.65 : 0.1) + wx.rain * 0.35, 0, 1);
  const windToward = rad(wx.windFrom + 180);
  const windShip = enuOffsetToShipFrame(Math.sin(windToward), Math.cos(windToward), shipState.headingDeg);
  const windMS = wx.windKt * 0.514;
  const driftScale = state.playing ? Math.sqrt(Math.max(state.timeScale, 1)) : 0;
  const speedMS = shipState.speedKn * 0.514;
  skyU.cloudDrift.value.x -= windShip.x * windMS * driftScale * dt;
  skyU.cloudDrift.value.z -= (windShip.z * windMS + speedMS) * driftScale * dt;
  skyU.cloudDrift.value.y += dt * 6 * (state.playing ? Math.min(driftScale, 8) : 0);

  // Lightning runs on viewing time, not voyage time: at 1200x a one-second
  // voyage-time flash would almost never land between rendered frames.
  const pulse = lightningPulse(elapsed, wx.bolt);
  smoothedLightning = lerp(smoothedLightning, pulse, 1 - Math.exp(-dt * 30));
  skyU.lightning.value = smoothedLightning;
  flashLight.intensity = smoothedLightning * 2.6;
  if (pulse > 0.55 && lastThunderPulse <= 0.55 && state.audio) audio.thunder(0.8 + Math.random() * 1.6, pulse);
  lastThunderPulse = pulse;

  // Ocean.
  const oU = ocean.uniforms;
  oU.seaTime.value = seaTime;
  oU.framePhase.value = ((seaTime / ATLAS_PERIOD) * ATLAS_FRAMES) % ATLAS_FRAMES;
  if (fftReady && fftBlendStart < 0) fftBlendStart = elapsed;
  oU.fftBlend.value = fftReady ? smoothstep(clamp((elapsed - fftBlendStart) / 2.5, 0, 1)) : 0;
  const hs = significantHeightM(smoothedSea) * state.waveScale;
  oU.amp.value = clamp(hs / BAKE_HS_M, 0.03, 3.4);
  oU.rough.value = clamp(0.055 + wx.windKt * 0.0042 + wx.rain * 0.05, 0.05, 0.34);
  oU.foamAmt.value = state.foam * clamp((smoothedSea - 1.5) / 6, 0.08, 1.6);
  oU.wakeAmt.value = clamp(shipState.speedKn / 12, 0, 1.2);
  mix3(oU.deepColor.value, PAL.deepNight, PAL.deepNight, PAL.deepDay, pal);
  oU.scatterColor.value.copy(PAL.scatterDay).multiplyScalar(pal.dayF * cloudDim);
  // Sampled-space rotation aligns baked wind (0.32 rad) with world wind.
  const windStbd = windShip.x, windFwd = -windShip.z;
  const phi = 0.32 - Math.atan2(windFwd, windStbd);
  oU.rotCS.value.set(Math.cos(phi), Math.sin(phi));
  for (let o = 0; o < 3; o++) {
    oceanOff[o].y = (oceanOff[o].y + speedMS * seaDt) % OCT_TILES_JS[o];
    oU[['off0', 'off1', 'off2'][o]].value.copy(oceanOff[o]);
  }

  // Ship motion on the sea clock; the user's wave-height scale rides along.
  const motionSea = clamp(smoothedSea * (0.8 + 0.3 * state.waveScale), 0, 9.5);
  const mot = motionAt(seaTime, motionSea, shipState.speedKn);
  ship.group.rotation.set(rad(mot.pitchDeg), rad(mot.yawDeg), rad(mot.rollDeg));
  ship.group.position.y = mot.heaveM;
  ship.radar.rotation.y = seaTime * 1.4;
  ship.group.updateMatrixWorld(true);

  // Night lighting on the ship.
  const nf = pal.nightF;
  ship.mats.bridgeGlassMat.emissiveIntensity = nf * 1.1;
  ship.mats.cabinMat.emissiveIntensity = nf * 1.6;
  ship.mats.floodMat.emissiveIntensity = nf * 2.4;
  ship.mats.monitorMat.emissiveIntensity = 0.35 + nf * 0.8;
  for (const k in ship.mats.navMats) ship.mats.navMats[k].emissiveIntensity = nf * 6.5;
  bloomNode.strength.value = state.bloom ? 0.38 + nf * 0.35 : 0;

  // Rain.
  rain.uniforms.amt.value = state.rainFx ? Math.pow(wx.rain, 1.6) : 0;
  rain.mesh.visible = rain.uniforms.amt.value > 0.05;
  rain.uniforms.timeSec.value = seaTime;
  rain.uniforms.slant.value.set(windShip.x * windMS * 0.02, windShip.z * windMS * 0.02);

  // Traffic + features in ship frame.
  if (state.traffic) {
    const act = trafficAt(fleet, day, shipState).sort((a, b) => a.range - b.range).slice(0, 14);
    vessels.update(act.map((v) => {
      const p = enuOffsetToShipFrame(v.east, v.north, shipState.headingDeg);
      return { x: p.x, z: p.z, rotY: courseRotY(v.courseDeg, shipState.headingDeg), lengthM: v.lengthM, seed: v.seed };
    }), nf, seaTime, smoothedSea);
  } else vessels.update([], 0, seaTime, smoothedSea);
  let nearestPortGlow = null;
  for (const { f, obj } of featureObjs) {
    const enu = enuFromLatLon(f.lat, f.lon, shipState.lat, shipState.lon);
    const range = Math.hypot(enu.east, enu.north);
    const vis = range < 95000;
    obj.visible = vis;
    if (!vis) continue;
    const p = enuOffsetToShipFrame(enu.east, enu.north, shipState.headingDeg);
    obj.position.set(p.x, 0, p.z);
    obj.rotation.y = axisRotY(f.orient, shipState.headingDeg);
    if (obj.userData.glowMat) { obj.userData.glowMat.emissiveIntensity = nf * 5; nearestPortGlow = obj; }
    if (obj.userData.cityMat) obj.userData.cityMat.emissiveIntensity = nf * 1.35;
  }

  updateCamera(dt, shipState);
  sky.mesh.position.copy(camera.position);
  return { shipState, wx, sun, pal };
}

function updateCamera(dt, shipState) {
  const camDef = CAMS[state.camera];
  ship.interior.visible = !!camDef.interior;
  camera.fov = camera.aspect < 0.8 ? Math.min(82, state.fov * 1.35) : state.fov;
  camera.updateProjectionMatrix();
  if (state.camera === 'drone') {
    droneAngle += dt * 0.018;
    const r = 430;
    camera.position.set(Math.cos(droneAngle) * r, droneHeight + Math.sin(elapsed * 0.05) * 10, Math.sin(droneAngle) * r);
    camera.up.set(0, 1, 0);
    _v1.copy(camDef.tgt); _v1.y += ship.group.position.y;
    applyLook(camera.position, _v1, camera.up);
    return;
  }
  _v1.copy(camDef.pos).applyMatrix4(ship.group.matrixWorld);
  _v2.copy(camDef.tgt).applyMatrix4(ship.group.matrixWorld);
  camera.position.copy(_v1);
  // Up vector: ship up blended to world up by the stabilisation setting.
  _v3.set(0, 1, 0).applyQuaternion(ship.group.quaternion);
  _v3.lerp(new THREE.Vector3(0, 1, 0), state.stabilize).normalize();
  camera.up.copy(_v3);
  applyLook(_v1, _v2, _v3);
}

const _ld = new THREE.Vector3(), _lr = new THREE.Vector3(), _lt = new THREE.Vector3();
function applyLook(pos, tgt, up) {
  const dir = _ld.copy(tgt).sub(pos).normalize();
  _q1.setFromAxisAngle(up, look.yaw);
  dir.applyQuaternion(_q1);
  const right = _lr.crossVectors(dir, up).normalize();
  _q1.setFromAxisAngle(right, look.pitch);
  dir.applyQuaternion(_q1);
  camera.lookAt(_lt.copy(pos).add(dir));
}

// ---------- UI wiring ----------
const fmtLatLon = (lat, lon) =>
  `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} · ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
let lastTimelapse = state.timeScale, scrubbing = false;

function speedLabel(ts) {
  if (ts <= 1.01) return '1× real-time';
  if (window.innerWidth <= 760) return `${Math.round(ts)}×`;
  if (ts < 90) return `${Math.round(ts)}×`;
  if (ts < 3600) return `${Math.round(ts)}× (${(ts / 60).toFixed(ts < 600 ? 1 : 0)} min/s)`;
  return `${Math.round(ts)}× (${(ts / 3600).toFixed(1)} h/s)`;
}
function syncSpeedUI() {
  const v = Math.round((Math.log(Math.max(state.timeScale, 1)) / Math.log(20000)) * 100);
  $('speedSlider').value = v;
  $('speedOut').textContent = speedLabel(state.timeScale);
  $('rtBtn').classList.toggle('on', state.timeScale <= 1.01);
  $('rtBtn').textContent = state.timeScale <= 1.01 ? 'Timelapse' : 'Real-time';
}
function setCamera(name) {
  state.camera = name;
  look.yaw = 0; look.pitch = 0;
  document.querySelectorAll('#camBtns button').forEach((b) => {
    b.classList.toggle('on', b.dataset.cam === name);
    b.blur();
  });
}
function applyQuality() {
  const q = QUALITY[state.quality];
  skyU.cloudSteps.value = q.cloudSteps;
  rain.setCount(q.rainCount);
  state.bloom = q.bloom && $('bloomChk').checked;
  onResize();
}
function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  const scale = QUALITY[state.quality].renderScale;
  renderer.setPixelRatio(1);
  renderer.setSize(Math.max(2, Math.round(w * scale)), Math.max(2, Math.round(h * scale)), false);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function initUI() {
  // Leg ticks under the scrub bar (curated so labels never collide).
  const ticks = $('legTicks');
  for (const [d, label] of [[1, 'Red Sea'], [7, 'Indian Ocean'], [11.6, 'Colombo'],
    [16.6, 'Malacca'], [18.6, 'Singapore'], [23, 'S. China Sea'], [28.4, 'Hong Kong']]) {
    const el = document.createElement('i');
    el.style.left = `${(d / TOTAL_DAYS) * 100}%`;
    el.textContent = label;
    ticks.appendChild(el);
  }
  $('playBtn').addEventListener('click', () => {
    state.playing = !state.playing;
    $('playBtn').textContent = state.playing ? 'Pause' : 'Play';
  });
  $('scrub').addEventListener('pointerdown', () => { scrubbing = true; });
  window.addEventListener('pointerup', () => { scrubbing = false; });
  $('scrub').addEventListener('input', (e) => { state.voyageDay = parseFloat(e.target.value); });
  $('speedSlider').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value) / 100;
    state.timeScale = Math.exp(v * Math.log(20000));
    if (state.timeScale > 1.5) lastTimelapse = state.timeScale;
    syncSpeedUI();
  });
  $('rtBtn').addEventListener('click', () => {
    if (state.timeScale <= 1.01) state.timeScale = lastTimelapse;
    else { lastTimelapse = state.timeScale; state.timeScale = 1; }
    syncSpeedUI();
  });
  document.querySelectorAll('#camBtns button').forEach((b) =>
    b.addEventListener('click', () => setCamera(b.dataset.cam)));
  $('tweakBtn').addEventListener('click', () => { $('tweaks').hidden = !$('tweaks').hidden; });
  $('hideBtn').addEventListener('click', () => document.body.classList.toggle('uiHidden'));
  $('fsBtn').addEventListener('click', toggleFullscreen);
  $('audioBtn').addEventListener('click', () => {
    state.audio = !state.audio;
    $('audioBtn').classList.toggle('on', state.audio);
    $('audioBtn').textContent = state.audio ? 'Sound on' : 'Sound off';
    $('audioBtn').setAttribute('aria-pressed', String(state.audio));
    if (state.audio) audio.start(); else audio.stop();
  });
  $('presetSel').addEventListener('change', (e) => { state.preset = e.target.value; });
  $('qualitySel').addEventListener('change', (e) => { state.quality = e.target.value; applyQuality(); });
  $('bloomChk').addEventListener('change', (e) => { state.bloom = e.target.checked; });
  $('trafficChk').addEventListener('change', (e) => { state.traffic = e.target.checked; });
  $('rainChk').addEventListener('change', (e) => { state.rainFx = e.target.checked; });
  $('linkChk').addEventListener('change', (e) => { state.linkSeaClock = e.target.checked; });

  const bindSlider = (id, outId, fn, fmt) => {
    $(id).addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      fn(v);
      if (outId) $(outId).textContent = fmt(v);
    });
  };
  bindSlider('waveSlider', 'waveOut', (v) => { state.waveScale = v; }, (v) => `${v.toFixed(2)}×`);
  bindSlider('foamSlider', 'foamOut', (v) => { state.foam = v; }, (v) => `${v.toFixed(2)}×`);
  bindSlider('stabSlider', 'stabOut', (v) => { state.stabilize = v; }, (v) => `${Math.round(v * 100)}%`);
  bindSlider('expSlider', 'expOut', (v) => { state.exposure = v; renderer.toneMappingExposure = v; }, (v) => v.toFixed(2));
  bindSlider('fovSlider', 'fovOut', (v) => { state.fov = v; }, (v) => `${Math.round(v)}°`);

  // Weather sliders: dragging switches that channel to manual; AUTO tag resets.
  const manualBind = (sliderId, outId, tagId, key, fmt) => {
    $(sliderId).addEventListener('input', (e) => {
      state.manual[key] = parseFloat(e.target.value);
      $(outId).textContent = fmt(state.manual[key]);
      const tag = $(tagId); tag.textContent = 'MANUAL'; tag.classList.add('manual');
    });
    $(tagId).addEventListener('click', () => {
      state.manual[key] = null;
      const tag = $(tagId); tag.textContent = 'AUTO'; tag.classList.remove('manual');
    });
  };
  manualBind('seaSlider', 'seaOut', 'seaAuto', 'sea', (v) => v.toFixed(1));
  manualBind('cloudSlider', 'cloudOut', 'cloudAuto', 'cloud', (v) => `${Math.round(v * 100)}%`);
  manualBind('windSlider', 'windOut', 'windAuto', 'windKt', (v) => `${Math.round(v)} kn`);

  // Pointer look + wheel zoom (on the canvas only; UI stays interactive).
  let lastX = 0, lastY = 0;
  const el = renderer.domElement;
  el.addEventListener('pointerdown', (e) => {
    if (document.body.classList.contains('uiHidden')) {
      document.body.classList.remove('uiHidden'); // any tap brings the UI back
      return;
    }
    draggingLook = true; lastX = e.clientX; lastY = e.clientY;
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!draggingLook) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    if (state.camera === 'drone') {
      droneAngle -= dx * 0.005;
      droneHeight = clamp(droneHeight + dy * 0.5, 45, 340);
    } else {
      look.yaw = clamp(look.yaw - dx * 0.0032, -2.4, 2.4);
      look.pitch = clamp(look.pitch - dy * 0.0028, -0.9, 0.9);
    }
    lastX = e.clientX; lastY = e.clientY;
  });
  const endDrag = () => { draggingLook = false; };
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);
  window.addEventListener('pointermove', (e) => {
    if (document.body.classList.contains('uiHidden') && e.clientY > window.innerHeight - 12)
      document.body.classList.remove('uiHidden');
  });
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    state.fov = clamp(state.fov + e.deltaY * 0.03, 24, 80);
    $('fovSlider').value = state.fov;
    $('fovOut').textContent = `${Math.round(state.fov)}°`;
  }, { passive: false });
  el.addEventListener('dblclick', () => {
    look.yaw = 0; look.pitch = 0;
    droneAngle = 0.7; droneHeight = 135;
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); $('playBtn').click(); }
    else if (e.code === 'KeyH') document.body.classList.toggle('uiHidden');
    else if (e.code === 'KeyF') toggleFullscreen();
    else if (e.code === 'KeyT') { $('tweaks').hidden = !$('tweaks').hidden; }
    else if (e.code === 'KeyC') { look.yaw = 0; look.pitch = 0; droneAngle = 0.7; droneHeight = 135; }
    else if (['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].includes(e.code)) {
      setCamera(['bridge', 'wing', 'bow', 'stern', 'drone'][Number(e.code.slice(-1)) - 1]);
    }
  });
  window.addEventListener('resize', onResize);
  syncSpeedUI();
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}

// ---------- HUD text (4 Hz) ----------
let hudTimer = 0, fpsEMA = 60;
function updateHUD(dt, frame) {
  fpsEMA = lerp(fpsEMA, 1 / Math.max(dt, 1e-4), 0.04);
  hudTimer -= dt;
  if (hudTimer > 0) return;
  hudTimer = 0.25;
  const { shipState, wx, sun } = frame;
  const utc = new Date(VOYAGE_START_UTC + state.voyageDay * 86400000);
  const hh = String(utc.getUTCHours()).padStart(2, '0'), mm = String(utc.getUTCMinutes()).padStart(2, '0');
  $('hudLeg').textContent = shipState.atPort ? `${shipState.legName} — in port` : shipState.legName;
  $('hudMeta').innerHTML =
    `${fmtLatLon(shipState.lat, shipState.lon)}<br>` +
    `Day ${Math.floor(state.voyageDay) + 1}/30 · ${hh}:${mm} UTC · ☀ ${sun.elevationDeg.toFixed(0)}°<br>` +
    `${shipState.speedKn.toFixed(1)} kn · hdg ${String(Math.round(shipState.headingDeg)).padStart(3, '0')}° · ${shipState.toGoNm.toFixed(0)} nm to Hong Kong`;
  $('hudWx').textContent = wx.label;
  $('dayReadout').textContent = `Day ${(state.voyageDay).toFixed(1)} · ${hh}:${mm} UTC`;
  if (!scrubbing) $('scrub').value = state.voyageDay;
  // Reflect auto weather in sliders (manual ones keep the user's value).
  if (state.manual.sea === null) { $('seaSlider').value = wx.sea; $('seaOut').textContent = wx.sea.toFixed(1); }
  if (state.manual.cloud === null) { $('cloudSlider').value = wx.cloud; $('cloudOut').textContent = `${Math.round(wx.cloud * 100)}%`; }
  if (state.manual.windKt === null) { $('windSlider').value = wx.windKt; $('windOut').textContent = `${Math.round(wx.windKt)} kn`; }
  const isGPU = renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2 (fallback)';
  $('stats').innerHTML =
    `${fpsEMA.toFixed(0)} fps · ${isGPU} · ${QUALITY[state.quality].label}<br>` +
    `Sea state ${smoothedSea.toFixed(1)} · Hs ${(significantHeightM(smoothedSea) * state.waveScale).toFixed(1)} m · ${wx.windKt.toFixed(0)} kn wind`;
  if (state.audio) audio.update(wx);
}

// ---------- boot + main loop ----------
let lastT = performance.now(), firstFrames = 0;
function loop(now) {
  requestAnimationFrame(loop);
  // Wall-clock delta (generous cap only for tab suspension). A tight 50 ms
  // cap made waves, roll and the voyage itself run ~20x slow at low fps.
  const dt = clamp((now - lastT) / 1000, 0.0005, 0.5);
  lastT = now;
  const frame = updateWorld(dt);
  updateHUD(dt, frame);
  post.render();
  // Loader stays until the FFT bake lands (hides the fallback-sea swap),
  // with a hard cap so a failed bake never traps the user on it.
  if (firstFrames < 10000) {
    firstFrames++;
    if (firstFrames >= 3 && ((fftReady && ocean.uniforms.fftBlend.value > 0.88) || elapsed > 20)) {
      firstFrames = 10000;
      $('loader').classList.add('done');
      setTimeout(() => $('loader')?.remove(), 1200);
    }
  }
}

async function boot() {
  initUI();
  applyQuality();
  startBake();
  await renderer.init();
  try {
    const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.3;
  } catch (err) {
    console.warn('Environment reflections unavailable', err);
  }
  try {
    renderer.backend?.device?.addEventListener?.('uncapturederror', (e) =>
      console.error('[WebGPU]', e.error?.message));
  } catch { /* diagnostics only */ }
  requestAnimationFrame(loop);
}
boot().catch((e) => showError('Failed to start: ' + (e?.message || e)));


