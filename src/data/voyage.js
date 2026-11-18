// Voyage data: JeffHK "30 Days Timelapse at Sea" route, Red Sea -> Hong Kong.
// Waypoint `day` = voyage day at arrival. Duplicated coordinates = port dwell.

export const VOYAGE_START_UTC = Date.UTC(2017, 7, 14, 0, 0, 0); // 2017-08-14
export const TOTAL_DAYS = 30;

export const WAYPOINTS = [
  { name: 'Red Sea',            lat: 22.0,  lon: 38.2,   day: 0.0,  leg: 'Red Sea' },
  { name: 'Bab el-Mandeb',      lat: 12.6,  lon: 43.4,   day: 2.2,  leg: 'Red Sea' },
  { name: 'Gulf of Aden',       lat: 12.2,  lon: 47.5,   day: 3.4,  leg: 'Gulf of Aden' },
  { name: 'Arabian Sea',        lat: 11.0,  lon: 54.0,   day: 4.8,  leg: 'Arabian Sea' },
  { name: 'Indian Ocean',       lat: 7.5,   lon: 65.0,   day: 7.6,  leg: 'Indian Ocean' },
  { name: 'Indian Ocean',       lat: 6.2,   lon: 75.0,   day: 9.8,  leg: 'Indian Ocean' },
  { name: 'Colombo',            lat: 6.96,  lon: 79.82,  day: 11.2, leg: 'Colombo', port: true },
  { name: 'Colombo (berthed)',  lat: 6.96,  lon: 79.82,  day: 12.0, leg: 'Colombo', port: true },
  { name: 'Dondra Head',        lat: 5.85,  lon: 80.65,  day: 12.4, leg: 'Indian Ocean' },
  { name: 'Bay of Bengal S.',   lat: 5.95,  lon: 88.0,   day: 14.3, leg: 'Indian Ocean' },
  { name: 'Aceh / Malacca In',  lat: 5.8,   lon: 95.2,   day: 16.0, leg: 'Malacca Strait' },
  { name: 'Malacca Strait',     lat: 3.8,   lon: 99.3,   day: 17.1, leg: 'Malacca Strait' },
  { name: 'Singapore',          lat: 1.24,  lon: 103.82, day: 18.1, leg: 'Singapore', port: true },
  { name: 'Singapore (berthed)',lat: 1.24,  lon: 103.82, day: 19.0, leg: 'Singapore', port: true },
  { name: 'South China Sea',    lat: 3.6,   lon: 106.8,  day: 20.2, leg: 'South China Sea' },
  { name: 'South China Sea',    lat: 9.5,   lon: 109.8,  day: 22.6, leg: 'South China Sea' },
  { name: 'Off Vietnam',        lat: 15.8,  lon: 112.2,  day: 25.2, leg: 'South China Sea' },
  { name: 'Hong Kong Approach', lat: 21.4,  lon: 114.4,  day: 27.8, leg: 'Hong Kong Approach' },
  { name: 'Hong Kong',          lat: 22.31, lon: 114.16, day: 28.6, leg: 'Hong Kong', port: true },
  { name: 'Hong Kong (berthed)',lat: 22.31, lon: 114.16, day: 30.0, leg: 'Hong Kong', port: true },
];

// Traffic density 0..1 per leg name (AIS-like encounter rate).
export const LEG_TRAFFIC = {
  'Red Sea': 0.35, 'Gulf of Aden': 0.3, 'Arabian Sea': 0.18,
  'Indian Ocean': 0.07, 'Colombo': 0.55, 'Malacca Strait': 1.0,
  'Singapore': 1.0, 'South China Sea': 0.4, 'Hong Kong Approach': 0.85,
  'Hong Kong': 0.9,
};

// Weather keyframes over the voyage. Interpolated smoothly; a slow seeded
// perturbation is added in weather.js. cloudType: 0 cumulus, 1 stratus, 2 storm.
export const WEATHER_KEYS = [
  { day: 0.0,  sea: 2.0, windKt: 10, windFrom: 320, cloud: 0.18, cloudType: 0, rain: 0.0,  fog: 0.02, bolt: 0.0, label: 'Red Sea — clear, following breeze' },
  { day: 2.0,  sea: 2.5, windKt: 14, windFrom: 300, cloud: 0.22, cloudType: 0, rain: 0.0,  fog: 0.05, bolt: 0.0, label: 'Bab el-Mandeb — hazy heat' },
  { day: 4.0,  sea: 3.5, windKt: 18, windFrom: 240, cloud: 0.35, cloudType: 0, rain: 0.0,  fog: 0.03, bolt: 0.0, label: 'Arabian Sea — SW monsoon freshening' },
  { day: 7.0,  sea: 5.0, windKt: 24, windFrom: 235, cloud: 0.5,  cloudType: 0, rain: 0.08, fog: 0.0,  bolt: 0.05, label: 'Indian Ocean — long monsoon swell' },
  { day: 9.2,  sea: 5.5, windKt: 28, windFrom: 230, cloud: 0.78, cloudType: 2, rain: 0.75, fog: 0.05, bolt: 0.7, label: 'Squall line — torrential rain' },
  { day: 10.2, sea: 4.0, windKt: 18, windFrom: 240, cloud: 0.45, cloudType: 0, rain: 0.1,  fog: 0.0,  bolt: 0.05, label: 'Clearing behind the squall' },
  { day: 11.5, sea: 1.5, windKt: 8,  windFrom: 260, cloud: 0.3,  cloudType: 0, rain: 0.0,  fog: 0.08, bolt: 0.0, label: 'Colombo — calm, port operations' },
  { day: 13.2, sea: 6.0, windKt: 32, windFrom: 225, cloud: 0.85, cloudType: 2, rain: 0.9,  fog: 0.08, bolt: 0.9, label: 'Thunderstorm at sea' },
  { day: 14.8, sea: 4.5, windKt: 20, windFrom: 240, cloud: 0.55, cloudType: 0, rain: 0.15, fog: 0.0,  bolt: 0.1, label: 'Storm easing, heavy swell remains' },
  { day: 16.5, sea: 2.0, windKt: 9,  windFrom: 180, cloud: 0.6,  cloudType: 1, rain: 0.05, fog: 0.22, bolt: 0.0, label: 'Malacca Strait — humid haze, dense traffic' },
  { day: 18.5, sea: 1.0, windKt: 7,  windFrom: 160, cloud: 0.5,  cloudType: 0, rain: 0.1,  fog: 0.1,  bolt: 0.15, label: 'Singapore — equatorial towers building' },
  { day: 20.5, sea: 3.5, windKt: 16, windFrom: 220, cloud: 0.3,  cloudType: 0, rain: 0.0,  fog: 0.0,  bolt: 0.0, label: 'South China Sea — trade cumulus' },
  { day: 23.0, sea: 3.0, windKt: 14, windFrom: 215, cloud: 0.08, cloudType: 0, rain: 0.0,  fog: 0.0,  bolt: 0.0, label: 'Crystal night — Milky Way overhead' },
  { day: 25.8, sea: 7.0, windKt: 38, windFrom: 60,  cloud: 0.9,  cloudType: 2, rain: 0.95, fog: 0.12, bolt: 0.8, label: 'Typhoon fringe — storm seas' },
  { day: 27.5, sea: 4.0, windKt: 18, windFrom: 80,  cloud: 0.4,  cloudType: 0, rain: 0.1,  fog: 0.02, bolt: 0.05, label: 'Storm passing astern' },
  { day: 28.6, sea: 1.5, windKt: 9,  windFrom: 90,  cloud: 0.25, cloudType: 0, rain: 0.0,  fog: 0.15, bolt: 0.0, label: 'Hong Kong — dawn arrival' },
  { day: 30.0, sea: 1.0, windKt: 8,  windFrom: 90,  cloud: 0.3,  cloudType: 0, rain: 0.0,  fog: 0.05, bolt: 0.0, label: 'Hong Kong — berthed' },
];

// Land & port features anchored in lat/lon. `len` along `orient` (deg from N).
export const FEATURES = [
  { type: 'port',  name: 'Colombo',   lat: 6.9616, lon: 79.82, orient: 82, len: 2600 },
  { type: 'ridge', name: 'Sri Lanka', lat: 7.1,   lon: 80.05,  orient: 150, len: 34000, h: 900 },
  { type: 'ridge', name: 'Sumatra',   lat: 4.6,   lon: 97.6,   orient: 135, len: 52000, h: 1100 },
  { type: 'ridge', name: 'Malaysia',  lat: 4.35,  lon: 100.3,  orient: 135, len: 52000, h: 800 },
  { type: 'port',  name: 'Singapore', lat: 1.24115, lon: 103.82115, orient: 125, len: 3400 },
  { type: 'ridge', name: 'Singapore', lat: 1.33,  lon: 103.85, orient: 95,  len: 26000, h: 220 },
  { type: 'port',  name: 'Hong Kong', lat: 22.3094, lon: 114.1584, orient: 346, len: 3200 },
  { type: 'ridge', name: 'Lantau',    lat: 22.25, lon: 113.95, orient: 80,  len: 22000, h: 850 },
  { type: 'ridge', name: 'Hong Kong I.', lat: 22.27, lon: 114.24, orient: 85, len: 18000, h: 650 },
];
