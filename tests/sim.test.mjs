// Node sanity tests for the simulation backend. Run: node tests/sim.test.mjs
import assert from 'node:assert';
import { shipAt, TOTAL_DIST_M, NM_M, enuFromLatLon } from '../src/sim/voyageSim.js';
import { sunPosition, moonPosition } from '../src/sim/solar.js';
import { sampleWeather, lightningPulse } from '../src/sim/weather.js';
import { buildTraffic, trafficAt } from '../src/sim/traffic.js';
import { motionAt, significantHeightM } from '../src/sim/shipMotion.js';
import { VOYAGE_START_UTC, WAYPOINTS } from '../src/data/voyage.js';

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ok -', msg); };

console.log('voyage:');
const totalNm = TOTAL_DIST_M / NM_M;
console.log(`  total route: ${totalNm.toFixed(0)} nm over 30 days`);
ok(totalNm > 4200 && totalNm < 6500, `route length sane (${totalNm.toFixed(0)} nm)`);
const s0 = shipAt(0);
ok(Math.abs(s0.lat - WAYPOINTS[0].lat) < 1e-9, 'day 0 at first waypoint');
const sMid = shipAt(17);
ok(sMid.speedKn > 5 && sMid.speedKn < 26, `Malacca speed sane (${sMid.speedKn.toFixed(1)} kn)`);
ok(shipAt(11.6).atPort === true && shipAt(11.6).speedKn === 0, 'Colombo dwell: berthed, 0 kn');
const sEnd = shipAt(30);
ok(Math.abs(sEnd.lat - 22.31) < 0.01, 'day 30 in Hong Kong');
const enu = enuFromLatLon(22.31, 114.16, 22.31, 113.16);
ok(Math.abs(enu.east - 103000) < 4000 && Math.abs(enu.north) < 1, 'ENU: 1 deg lon ~103 km east at HK');

console.log('solar:');
const noonUtc = Date.UTC(2017, 8, 23, 12, 0); // equinox-ish
const sunEq = sunPosition(noonUtc, 0, 0);
ok(sunEq.elevationDeg > 75, `equator noon sun high (${sunEq.elevationDeg.toFixed(1)} deg)`);
const sunNight = sunPosition(Date.UTC(2017, 8, 23, 0, 0), 0, 0);
ok(sunNight.elevationDeg < -40, `equator midnight sun down (${sunNight.elevationDeg.toFixed(1)} deg)`);
const sunHK = sunPosition(Date.UTC(2017, 5, 21, 4, 30), 22.3, 114.16); // ~12:30 HK summer
ok(sunHK.elevationDeg > 65, `HK summer midday high (${sunHK.elevationDeg.toFixed(1)} deg)`);
const moon = moonPosition(Date.UTC(2017, 8, 6, 18, 0), 10, 80); // near full (Sep 6 2017)
ok(moon.illum > 0.9, `full-moon illumination (${moon.illum.toFixed(2)})`);

console.log('weather:');
for (let d = 0; d <= 30; d += 0.5) {
  const w = sampleWeather(d);
  assert.ok(w.sea >= 0.5 && w.sea <= 9 && w.cloud >= 0 && w.cloud <= 1, `bounds day ${d}`);
}
ok(true, 'auto weather in bounds across voyage');
ok(sampleWeather(13.2).bolt > 0.6, 'day-13 thunderstorm has lightning');
ok(sampleWeather(23).cloud < 0.3, 'day-23 Milky Way night is clear');
ok(sampleWeather(5, 'storm').sea > 7, 'storm preset overrides');
let maxPulse = 0;
for (let t = 0; t < 4000; t += 0.05) maxPulse = Math.max(maxPulse, lightningPulse(t, 0.9));
ok(maxPulse > 0.5 && lightningPulse(100, 0) === 0, `lightning pulses fire in storm, silent when calm (max ${maxPulse.toFixed(2)})`);

console.log('traffic:');
const v1 = buildTraffic(42), v2 = buildTraffic(42);
ok(v1.length === v2.length && v1.length > 60, `deterministic fleet (${v1.length} vessels)`);
// Sample a full day in each zone: Malacca must actually show traffic.
function trafficStats(dayFrom) {
  let sum = 0, max = 0, n = 0;
  for (let d = dayFrom; d < dayFrom + 1; d += 0.02) {
    const c = trafficAt(v1, d, shipAt(d)).length;
    sum += c; max = Math.max(max, c); n++;
  }
  return { avg: sum / n, max };
}
const mal = trafficStats(16.6), ind = trafficStats(8.0);
console.log(`  active avg/max: Malacca ${mal.avg.toFixed(2)}/${mal.max}, Indian Ocean ${ind.avg.toFixed(2)}/${ind.max}`);
ok(mal.max >= 2 && mal.avg > 0.4, 'Malacca visibly busy across a day');
ok(mal.avg > ind.avg * 2, 'open ocean much emptier than Malacca');
const sampleActive = trafficAt(v1, 17, shipAt(17));
ok(sampleActive.every((v) => Number.isFinite(v.east) && v.range <= 45000), 'active vessels finite + in range');

console.log('ship motion:');
const calm = motionAt(100, 1.5), storm = motionAt(100, 8);
ok(Math.abs(storm.rollDeg) > Math.abs(calm.rollDeg), 'roll grows with sea state');
let maxRoll = 0;
for (let t = 0; t < 600; t += 0.25) maxRoll = Math.max(maxRoll, Math.abs(motionAt(t, 8).rollDeg));
ok(maxRoll > 3 && maxRoll < 7.5, `storm roll bounded for ULCS (max ${maxRoll.toFixed(1)} deg)`);
ok(significantHeightM(6) > significantHeightM(3), 'Hs monotonic in sea state');

console.log('opening frame check (configured start day):');
const { DEFAULT_STATE } = await import('../src/config.js');
const openDay = DEFAULT_STATE.voyageDay;
const openMs = VOYAGE_START_UTC + openDay * 86400000;
const openShip = shipAt(openDay);
const openSun = sunPosition(openMs, openShip.lat, openShip.lon);
const relAz = Math.abs(((openSun.azimuthDeg - openShip.headingDeg + 540) % 360) - 180);
console.log(`  day ${openDay} ship ${openShip.lat.toFixed(2)}N ${openShip.lon.toFixed(2)}E hdg ${openShip.headingDeg.toFixed(0)} | sun el ${openSun.elevationDeg.toFixed(1)} az ${openSun.azimuthDeg.toFixed(0)} (off bow ${relAz.toFixed(0)} deg)`);
ok(openDay < 1, 'opening drops in on the first day of the voyage');
ok(openSun.elevationDeg > 1 && openSun.elevationDeg < 16, 'opening is golden hour, not midday/night');
ok(relAz < 85, 'opening sun is forward of the beam (morning light ahead)');

console.log(`\nALL ${passed} CHECKS PASSED`);
