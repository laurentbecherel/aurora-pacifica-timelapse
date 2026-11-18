# AURORA PACIFICA — 30 Days Timelapse at Sea

A WebGPU container-ship timelapse from the bridge of a 330 m ULCS, recreating
JeffHK's 30-day voyage: **Red Sea → Gulf of Aden → Indian Ocean → Colombo →
Malacca Strait → Singapore → South China Sea → Hong Kong**.

FFT ocean (Phillips spectrum, baked Tessendorf atlas tiled at three scales —
the Sea of Thieves approach), physical sun/moon from the ship's real
lat/lon, volumetric raymarched clouds, voyage-driven weather with storms,
rain and lightning, AIS-like traffic, ports and landfall, day/night cycle
with stars and the Milky Way. Timelapse by default (30 days ≈ 36 min),
real-time at one click.

![Bridge at golden hour](screenshots/01-bridge-golden.png)

## Run it

**Hosted:** open the GitHub Pages URL from the repo's About section
(Chrome/Edge with WebGPU recommended; a 3080 runs the Cinematic tier at 4K).

**Locally:**

```bash
node server.mjs 8080        # then open http://localhost:8080
```

No build step and no dependencies; three.js 0.180.0 loads from jsDelivr.

## Controls

| Input | Action |
|---|---|
| Space / ▶ | Play · pause the voyage |
| Scrub bar | Jump anywhere in the 30 days |
| Speed slider / Real-time | 1× … 20000× (timelapse default 1200×) |
| 1–5 or camera buttons | Bridge · Wing · Bow · Stern · Drone |
| Drag | Look around (double-click re-centres) |
| Wheel | Zoom (FOV) |
| ⚙ Tweaks | Weather presets or manual sea/cloud/wind, wave height, foam, stabilisation, exposure, quality tier, bloom/traffic/rain toggles |
| ♪ Sound | Procedural swell, wind, rain and thunder |
| H / ◐ | Hide the interface · F fullscreen |

## How it works

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full system breakdown and
[DEVLOG.md](DEVLOG.md) for the build journal. In one paragraph: a pure-JS
simulation backend (`src/sim` — voyage, solar, weather, traffic, ship
motion; unit-tested with `node tests/sim.test.mjs`) drives a three.js
WebGPU/TSL renderer; a Web Worker bakes the FFT ocean atlas and cloud noise
volume at load (`node tests/fft.test.mjs` validates the bake in ~4 s).

## Tests

```bash
node tests/sim.test.mjs   # route, solar, weather, traffic, motion
node tests/fft.test.mjs   # FFT calibration (Hs), determinism, bake timing
```
