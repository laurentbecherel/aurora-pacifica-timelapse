# Container Ship Timelapse — Architecture

**Experience:** Bridge view of a ULCS container ship on JeffHK's 30-day route
(Red Sea → Hong Kong). Timelapse by default, real-time on toggle. Full-screen,
WebGPU, built for an RTX 3080 at 4K.

## Decisions (settled with user, 2026-11-18)

| Choice | Decision |
|---|---|
| Access | Public hosted URL (GitHub Pages) + one-command local run |
| Time | Both modes; **timelapse is the default** (30 days ≈ 35 min at 1× timelapse) |
| Voyage | **Real JeffHK route** with waypoints, legs, port calls, traffic zones |

## Rendering path

- **three.js 0.180.0 `WebGPURenderer`** (pinned, jsDelivr import map). Falls back
  to WebGL2 inside three when no WebGPU adapter exists.
- Custom shading in **TSL/WGSL** node materials (ocean, sky, clouds, rain).
  Ship/port/vessels use PBR node materials lit by the same sun.
- Post: HDR → `PostProcessing` + `BloomNode` → ACES filmic output.

## Ocean — genuine FFT, Sea-of-Thieves style tiling

Sea of Thieves does not run a live FFT per frame for the whole sea; it bakes
FFT wave data and tiles it at multiple scales. We do the same:

1. `src/gfx/fft-worker.js` — Web Worker bakes a **Phillips-spectrum Tessendorf
   ocean**: Gaussian `h0(k)`, quantized dispersion `ω(k)` for a perfectly
   looping 16 s cycle, 64 frames × 128×128 IFFT (height + horizontal chop
   displacement + Jacobian foam term), packed into a 1024×1024 RGBA float atlas.
2. `src/gfx/ocean.js` — TSL material samples the atlas in the vertex stage at
   **three tiling octaves** (≈700 m / 90 m / 11 m) with frame interpolation,
   derives normals by finite differences, adds per-pixel detail normals,
   Jacobian-driven foam, sun glitter (GGX), sky reflection and depth tint.
   Vertex displacement fades with distance; fragment detail carries to the
   300 km horizon disc. Cost at runtime is texture fetches only — no FFT in
   the frame loop — which is what makes 4K viable.
3. Until the bake finishes (or if Workers fail), an analytic 8-wave fallback
   runs in the same shader (`uFFTBlend` cross-fades). The page is never blank.

Sea state scales baked displacement and chop; wind rotates octave sampling.

## Simulation backend (pure JS, no three.js, unit-tested in Node)

| Module | Owns |
|---|---|
| `src/data/voyage.js` | Waypoints (lat/lon), legs, port dwells, weather keyframes, land/port features |
| `src/sim/voyageSim.js` | Day → distance (haversine legs), position/heading/speed at any voyage time |
| `src/sim/solar.js` | Sun azimuth/elevation (NOAA), moon position/phase from date + lat/lon |
| `src/sim/weather.js` | Weather state machine: voyage timeline + smooth noise + manual presets |
| `src/sim/traffic.js` | Seeded AIS-like traffic: density per leg, reciprocal/parallel courses |
| `src/sim/shipMotion.js` | Heave/pitch/roll response vs sea state (real-speed, cinematic) |

**World frame:** ship-centric. The ship sits at the origin heading −Z; ocean
sampling, traffic and land are transformed from ENU (east/north metres
relative to the ship's lat/lon) into ship frame every frame. The sun comes
from the ship's true lat/lon and voyage clock, so sunrises happen at the
right bearing for the leg you are on.

**Two clocks:** the *voyage clock* (timelapse, drives sun, route, weather
evolution, cloud drift) and the *sea clock* (real-speed waves and ship
motion, so the sea still feels heavy in timelapse — the look of the JeffHK
film, where the ship rolls in real time under a racing sky). A tweak links
them for true-timelapse strobing if wanted.

## Sky, clouds, weather FX

- Sky dome (custom TSL): analytic Rayleigh+Mie atmosphere, sun disc, moon,
  hash star field + Milky Way band, horizon haze. One shared
  `skyColor(dir)` TSL function is reused for ocean reflections.
- **Volumetric clouds:** raymarched slab (quality-scaled step count) through a
  baked 128³ RGBA noise volume (Perlin-Worley base + Worley detail).
  Uniforms select cumulus / stratus / storm profiles; silver-lining powder
  term; dark storm bases. Cheap 2D cirrus sheet above.
- Rain: GPU-instanced streaks cycled in-shader around the camera, wind-slanted.
  Lightning: weather-driven flash uniform (sky + scene light + bloom) and a
  procedural thunder burst when audio is on.
- Ambient audio (opt-in toggle): procedural WebAudio — swell, wind, rain.

## Ship & environment (forms before effects)

- Lofted hull sections, deck, forecastle, bow mast; **instanced 40 ft
  containers** (≈900) with canvas-baked corrugation/livery/rust and
  per-instance colour; superstructure with lit bridge windows, bridge wings,
  rotating radar, funnel; navigation lights (emissive + bloom).
- Cameras: Bridge (default, JeffHK framing), Bridge Wing, Bow, Stern/Wake,
  Drone orbit. Drag-look + wheel FOV on all; ship motion applies to onboard
  cameras with a stabilisation slider.
- Ports/land: lat/lon-anchored ridges, breakwaters, gantry cranes and city
  glow that appear on approach to Colombo, Singapore and Hong Kong.
- Traffic: three vessel archetypes with correct night lights.

## Performance budget (3080 @ 4K, Cinematic tier)

Ocean 1 draw (~150 k verts), sky 1, containers 1 instanced draw, hull/deck
<10, traffic ≤ 20 small groups, rain 1 instanced draw, bloom half-res chain.
Quality tiers scale render resolution and cloud steps only; no tier is ever
chosen from dev-machine frame times.

## Layout

```
index.html            HUD DOM + import map + boot
src/main.js           renderer, loop, cameras, wiring
src/config.js         quality tiers, defaults
src/data|sim|gfx|ui|audio/   modules above
server.mjs            zero-dependency local server
tests/sim.test.mjs    Node checks for the sim backend
DEVLOG.md             progress log (deliverable)
docs/research-notes.md  reference research
```
