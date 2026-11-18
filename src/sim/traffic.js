// AIS-like traffic: deterministic function of voyage day (scrub-safe).
// Vessels spawn offset from the ship's route position, mostly on reciprocal
// or parallel courses in a two-lane scheme, like real TSS lanes.
import { LEG_TRAFFIC } from '../data/voyage.js';
import { shipAt, destinationLatLon, enuFromLatLon, clamp } from './voyageSim.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TYPES = ['container', 'bulk', 'tanker'];

export function buildTraffic(seed = 20170814) {
  const rnd = mulberry32(seed);
  const vessels = [];
  const stepDays = 0.03;
  for (let day = 0.2; day < 29.8; day += stepDays) {
    const ship = shipAt(day);
    const density = LEG_TRAFFIC[ship.legName] ?? 0.1;
    if (rnd() > density * 0.5) continue;
    const kind = rnd();
    let course, lateralNm, aheadNm, speedKn;
    if (kind < 0.55) {          // reciprocal lane (oncoming, port-to-port)
      course = (ship.headingDeg + 180 + (rnd() - 0.5) * 12 + 360) % 360;
      lateralNm = 0.4 + rnd() * 1.9; aheadNm = 5 + rnd() * 7;
      speedKn = 10 + rnd() * 9;
    } else if (kind < 0.85) {   // same direction, overtaken / overtaking
      course = (ship.headingDeg + (rnd() - 0.5) * 8 + 360) % 360;
      lateralNm = (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 2.4);
      aheadNm = -3 + rnd() * 9;
      speedKn = clamp(ship.speedKn + (rnd() - 0.55) * 7, 6, 24);
    } else {                    // crossing / local traffic near ports
      course = rnd() * 360;
      lateralNm = (rnd() - 0.5) * 7; aheadNm = (rnd() - 0.5) * 8;
      speedKn = 5 + rnd() * 9;
    }
    // Spawn position: ahead of ship then offset laterally (starboard +).
    let p = destinationLatLon(ship.lat, ship.lon, ship.headingDeg, aheadNm * 1852);
    p = destinationLatLon(p.lat, p.lon, (ship.headingDeg + 90) % 360, lateralNm * 1852);
    vessels.push({
      id: vessels.length, type: TYPES[Math.floor(rnd() * TYPES.length)],
      spawnDay: day, lifeDays: 0.55 + rnd() * 0.5,
      lat0: p.lat, lon0: p.lon, courseDeg: course, speedKn,
      lengthM: 140 + rnd() * 200, seed: rnd(),
    });
  }
  return vessels;
}

// Active vessels at `day`, with ENU offset to the ship and range filtering.
export function trafficAt(vessels, day, ship, maxRangeM = 45000) {
  const out = [];
  for (const v of vessels) {
    const age = day - v.spawnDay;
    if (age < 0 || age > v.lifeDays) continue;
    const distM = v.speedKn * 1852 * 24 * age;
    const p = destinationLatLon(v.lat0, v.lon0, v.courseDeg, distM);
    const enu = enuFromLatLon(p.lat, p.lon, ship.lat, ship.lon);
    const range = Math.hypot(enu.east, enu.north);
    if (range > maxRangeM) continue;
    out.push({ ...v, lat: p.lat, lon: p.lon, east: enu.east, north: enu.north, range });
  }
  return out;
}
