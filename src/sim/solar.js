// Sun & moon position from UTC time + lat/lon (NOAA-grade approximations,
// ~0.3 deg sun / few-deg moon: ample for lighting and sky placement).
import { rad, deg } from './voyageSim.js';

function julianDay(msUtc) { return msUtc / 86400000 + 2440587.5; }

// Returns ENU unit vector {east, up, north} + azimuth/elevation degrees.
export function sunPosition(msUtc, lat, lon) {
  const jd = julianDay(msUtc);
  const n = jd - 2451545.0; // days since J2000.0
  const L = (280.460 + 0.9856474 * n) % 360;         // mean longitude
  const g = rad((357.528 + 0.9856003 * n) % 360);    // mean anomaly
  const lambda = rad(L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)); // ecliptic long
  const eps = rad(23.439 - 0.0000004 * n);           // obliquity
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  // Greenwich mean sidereal time (deg), then local hour angle.
  const gmst = (280.46061837 + 360.98564736629 * n) % 360;
  let ha = rad(((gmst + lon - deg(ra)) % 360 + 360) % 360);
  if (ha > Math.PI) ha -= 2 * Math.PI;
  return altAz(ha, dec, rad(lat));
}

export function moonPosition(msUtc, lat, lon) {
  const jd = julianDay(msUtc);
  const n = jd - 2451545.0;
  // Simplified lunar elements (Meeus low-precision).
  const Lm = rad((218.316 + 13.176396 * n) % 360);   // mean longitude
  const Mm = rad((134.963 + 13.064993 * n) % 360);   // mean anomaly
  const F = rad((93.272 + 13.229350 * n) % 360);     // argument of latitude
  const lambda = Lm + rad(6.289) * Math.sin(Mm);
  const beta = rad(5.128) * Math.sin(F);
  const eps = rad(23.439 - 0.0000004 * n);
  const ra = Math.atan2(
    Math.sin(lambda) * Math.cos(eps) - Math.tan(beta) * Math.sin(eps),
    Math.cos(lambda));
  const dec = Math.asin(Math.sin(beta) * Math.cos(eps) +
    Math.cos(beta) * Math.sin(eps) * Math.sin(lambda));
  const gmst = (280.46061837 + 360.98564736629 * n) % 360;
  let ha = rad(((gmst + lon - deg(ra)) % 360 + 360) % 360);
  if (ha > Math.PI) ha -= 2 * Math.PI;
  const pos = altAz(ha, dec, rad(lat));
  // Phase: synodic age from known new moon 2000-01-06 18:14 UTC.
  const synodic = 29.53058867;
  const age = ((jd - 2451550.1) % synodic + synodic) % synodic;
  pos.phase = age / synodic;                          // 0 new, 0.5 full
  pos.illum = 0.5 * (1 - Math.cos(2 * Math.PI * pos.phase));
  return pos;
}

function altAz(ha, dec, latR) {
  const alt = Math.asin(Math.sin(dec) * Math.sin(latR) +
    Math.cos(dec) * Math.cos(latR) * Math.cos(ha));
  const az = Math.atan2(Math.sin(ha),
    Math.cos(ha) * Math.sin(latR) - Math.tan(dec) * Math.cos(latR)) + Math.PI;
  const azDeg = (deg(az) + 360) % 360; // from north, clockwise
  const elDeg = deg(alt);
  const c = Math.cos(alt);
  return {
    azimuthDeg: azDeg, elevationDeg: elDeg,
    east: c * Math.sin(rad(azDeg)), up: Math.sin(alt), north: c * Math.cos(rad(azDeg)),
  };
}

// Convert an ENU direction into ship-frame three.js coords.
// Ship frame: forward = -Z, starboard = +X, up = +Y. Heading deg from north.
export function enuDirToShipFrame(east, up, north, headingDeg) {
  const h = rad(headingDeg);
  // World ENU -> "north-up" frame (x east, z south = three-style if heading 0 faces -Z=north)
  // Ship forward vector in ENU: (sin h, cos h) in (east, north).
  const fwdE = Math.sin(h), fwdN = Math.cos(h);
  const stbdE = Math.cos(h), stbdN = -Math.sin(h);
  const along = east * fwdE + north * fwdN;   // + ahead
  const across = east * stbdE + north * stbdN; // + starboard
  return { x: across, y: up, z: -along };
}

export function enuOffsetToShipFrame(east, north, headingDeg) {
  const v = enuDirToShipFrame(east, 0, north, headingDeg);
  return { x: v.x, z: v.z };
}
