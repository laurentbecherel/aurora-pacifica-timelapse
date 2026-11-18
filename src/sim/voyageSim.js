// Voyage kinematics: voyage-day -> lat/lon/heading/speed. Pure functions.
import { WAYPOINTS, TOTAL_DAYS } from '../data/voyage.js';

export const R_EARTH_M = 6371000;
export const NM_M = 1852;
export const rad = (d) => (d * Math.PI) / 180;
export const deg = (r) => (r * 180) / Math.PI;
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

export function haversineM(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.sqrt(a));
}

export function bearingDeg(lat1, lon1, lat2, lon2) {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) -
    Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

// Metres east/north of (lat,lon) relative to origin. Accurate < ~200 km.
export function enuFromLatLon(lat, lon, oLat, oLon) {
  const east = rad(lon - oLon) * R_EARTH_M * Math.cos(rad((lat + oLat) / 2));
  const north = rad(lat - oLat) * R_EARTH_M;
  return { east, north };
}

// Destination lat/lon after travelling distM on courseDeg from (lat,lon).
export function destinationLatLon(lat, lon, courseDeg, distM) {
  const d = distM / R_EARTH_M, br = rad(courseDeg), la = rad(lat), lo = rad(lon);
  const lat2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(br));
  const lon2 = lo + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(la),
    Math.cos(d) - Math.sin(la) * Math.sin(lat2));
  return { lat: deg(lat2), lon: deg(lon2) };
}

const legs = [];
for (let i = 0; i < WAYPOINTS.length - 1; i++) {
  const a = WAYPOINTS[i], b = WAYPOINTS[i + 1];
  legs.push({
    a, b, distM: haversineM(a.lat, a.lon, b.lat, b.lon),
    bearing: bearingDeg(a.lat, a.lon, b.lat, b.lon), days: b.day - a.day,
  });
}
export const TOTAL_DIST_M = legs.reduce((s, l) => s + l.distM, 0);

// Ship state at voyage day t. Heading eases at waypoints via bearing blend on
// the adjacent 0.15-day window so turns feel like a 330 m ship, not a pivot.
export function shipAt(day) {
  day = clamp(day, 0, TOTAL_DAYS);
  let i = legs.length - 1;
  for (let k = 0; k < legs.length; k++) {
    if (day <= legs[k].b.day || k === legs.length - 1) { i = k; break; }
  }
  const L = legs[i];
  const t = L.days > 0 ? clamp((day - L.a.day) / L.days, 0, 1) : 0;
  const lat = lerp(L.a.lat, L.b.lat, t), lon = lerp(L.a.lon, L.b.lon, t);
  // Heading: blend leg bearings near the joint for a gradual turn.
  let heading = L.bearing;
  const blendWin = 0.15; // days
  if (i > 0 && day - L.a.day < blendWin) {
    const prev = legs[i - 1].bearing;
    heading = angleLerp(prev, L.bearing, smoothstep((day - L.a.day) / blendWin));
  }
  if (L.distM < 1) heading = i > 0 ? legs[i - 1].bearing : L.bearing; // berthed
  const speedKn = L.days > 0 ? (L.distM / NM_M) / (L.days * 24) : 0;
  // Distance travelled / remaining.
  let doneM = 0;
  for (let k = 0; k < i; k++) doneM += legs[k].distM;
  doneM += L.distM * t;
  return {
    lat, lon, headingDeg: heading, speedKn: L.distM < 1 ? 0 : speedKn,
    legIndex: i, legName: L.b.leg, nextPort: L.b.name,
    doneM, toGoNm: (TOTAL_DIST_M - doneM) / NM_M,
    atPort: L.distM < 1,
  };
}

export function angleLerp(a, b, t) {
  let d = ((b - a + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}
