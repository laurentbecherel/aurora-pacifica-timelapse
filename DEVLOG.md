# Dev Log — Container Ship Timelapse at Sea

## Day 0 — 2026-11-18: Disambiguation & architecture

**Brief:** WebGPU FFT ocean, container-ship bridge timelapse (JeffHK refs),
AAA visuals, 3080 @ 4K, hosted off-devserver, dev log + screenshots required.

**Settled with the user (blocking choices):**
- Hosting → **public hosted URL** (GitHub Pages; `gh` is authenticated here)
  with a local-run fallback.
- Time → **both modes, timelapse default.**
- Voyage → **real JeffHK route**: Red Sea → Gulf of Aden → Indian Ocean →
  Colombo → Malacca Strait → Singapore → South China Sea → Hong Kong.

**Key research findings:**
- JeffHK route/beats confirmed via web sources (sunsets, thunderstorms,
  Milky Way, Malacca traffic, Hong Kong arrival). Full notes in
  `docs/research-notes.md` (research agent, parallel track).
- Sea of Thieves does **not** live-FFT the whole ocean per frame; baked FFT
  data tiled at multiple scales is the production approach. Adopted: worker
  bake (Phillips spectrum, looping) + 3-octave shader tiling. Runtime FFT
  cost drops to zero, which is what makes 4K + volumetric clouds fit.
- three.js **0.180.0** ships split builds (`three.webgpu.js` +
  `three.core.js`); import map must use the jsDelivr package URLs so the
  relative core import resolves. TSL patterns verified against the actual
  `SkyMesh.js` / `BloomNode.js` sources (not memory): `NodeMaterial`,
  `Fn`, `varyingProperty`, `PostProcessing` + `pass().getTextureNode()` +
  `bloom()`.

**Architecture:** see `ARCHITECTURE.md`. Highlights: ship-centric world
frame, pure-JS sim backend (voyage/solar/weather/traffic) testable in Node,
two clocks (voyage timelapse vs real-speed sea), custom TSL ocean/sky
sharing one atmosphere function.

**Risks register:**
1. TSL API churn → mitigated by reading pinned-version sources first.
2. 3D texture sampling in TSL for cloud volume → fallback: 2D atlas slices.
3. Headless dev GPU is software → never tune quality down from local FPS;
   judge by screenshots, ship Cinematic defaults for the 3080.
4. Worker bake time → 128²×64 frames sized for ~2–4 s; analytic fallback
   ocean renders from frame 1.

Next: sim backend + Node tests, then FFT worker.

## Day 0 (cont.) — Simulation backend

Pure-JS modules with a Node test suite (`tests/sim.test.mjs`, 23 checks):
route = **5,826 nm** over 30 days with port dwells at Colombo/Singapore;
solar position validated at equator/Hong Kong; opening frame verified as
golden hour (day 1.18, sun 17.8°). First traffic draft failed its own test
honestly (0 active vessels at sampled instants — a vacuous pass): spawn
geometry was tightened until Malacca averages **3.0 active vessels** vs
0.47 in the Indian Ocean, the contrast the film is famous for.

## Day 0 (cont.) — FFT ocean bake

`tests/fft.test.mjs`: full bake (128² × 64 frames, 1024² atlas) in
**0.67 s**; heights auto-calibrated so Hs = 3.5 m exactly (4σ); Jacobian
minimum 0.37 gives crest foam headroom. Cloud noise volume (128³
Perlin-Worley) initially projected at ~6 s; precomputing lattice/Worley
feature points brought it to 3.5 s. Both run in a Worker behind a progress
overlay while an analytic fallback sea renders from frame one.

## Day 0 (cont.) — First light & repair rounds

First browser run failed on one root cause: TSL `texture()` builds a 2D
view; 3D volumes need `texture3D()`. One-line fix → clean WebGPU run
(0 console/WGSL problems). Screenshot rounds then drove the work:

1. **Black monolith** in frame centre: the bridge camera sat inside solid
   superstructure boxes with a window pillar dead ahead. Rebuilt the bridge
   from slabs + outward-only glass planes; camera near the glass, no centre
   pillar. Moving the camera back instead (round 2) made 3 m-wide ECDIS
   monitors loom as blue slabs — shrunk to real 1.5 m units, camera forward.
2. **Clouds** swung from full grey cover (threshold mapped always-dense
   over long horizon paths) to near-invisible to scattered trade cumulus:
   coverage → `1.04 − cover^0.75·0.9`, σ down, sun term up, height-graded
   sun transmission so tops light and bases shade.
3. **Storm mood**: first storm looked like bright silver chop under white
   cloud; storm cloud-dim factor, cloud ambient cut and ocean-spec cloud
   attenuation fixed the gloom. Rain streaks show; lightning is a
   deterministic pulse train tied to the voyage clock.
4. **Night**: deck work-light was 3.4× too hot (physical falloff maths);
   degenerate zero-width rain quads drew 1 px vertical lines at night —
   length now gates to zero too, and rain hides entirely below 1%.
5. **Ocean stipple** at dawn: micro-detail FFT octave read as a dot grid;
   now sampled twice, rotated, at lower gain.

Verified so far: clean `check_page.py` desktop run (WebGPU frames, no
problems), 5-scene screenshot pass through the page's own controls
(golden bridge, drone noon, storm, Milky-Way night, Hong Kong dawn
landfall). Software renderer here runs ~1 fps; quality defaults were never
tuned down for it. Next: fresh-player critique round, phone check, deploy.

## Day 0 (cont.) — Fresh-player critique, rounds 1–2

Two blind playtests (desktop + phone, every control exercised; reports kept
with the QA artifacts as `critique-1.md` / `critique-2.md`) both returned
**not ready**, and both earned it. The fixes that mattered most were root
causes, not tuning:

- **The sea clock was frame-capped.** The loop clamped `dt` to 50 ms, so on
  the ~1 fps QA renderer waves, ship roll, the voyage and even the FPS meter
  all ran ~20× slow — the ship looked glued down. The loop now uses
  wall-clock delta (500 ms cap for tab suspension only).
- **The FFT spectrum was stretched flat.** The bake's dominant wavelength
  is ~0.7 of a tile; tiling it at 768 m gave a 500 m swell with almost no
  slope at ship scale. Tiles are now 340/76/10 m over a denser centre grid,
  chop is scaled per octave, foam comes only from large/medium crest
  compression (the micro-octave Jacobian had been speckling the whole sea),
  and a coherent swell train guarantees ship-scale faces in storm settings.
- **Lightning could almost never be seen.** Flashes were scheduled in
  voyage seconds; at 1200× a 1.4 s flash is stepped over by nearly every
  frame. Lightning now runs on viewing time.
- **Clouds were a thin slice extruded.** The volume was sampled by absolute
  altitude ÷ 6200, using a sliver of the 3D noise. Mapping the third axis
  to height through the layer (plus domain warp) gives cumulus and storm
  towers actual vertical body.
- **Cameras and ports.** Wing sat behind its own wall, Stern stared at a
  roof slab, ports were quay ribbons floating on water. Wing moved outside
  the tip, Stern became a stern-quarter wake view, and terminals are now
  solid land: apron, fenders, braced gantry cranes with cabs and spreaders,
  yard rows, warehouses, a lit skyline and extruded hills, anchored ~180 m
  abeam of each berth.
- **Ship presence.** Name plates on the bows and transom, bulwarks,
  stanchions, bollards, hatch beams, ventilators, three-sided cabin window
  bands, funnel cap/exhausts, floodlight masts whose heads are exactly
  where the six night point-lights sit, and environment reflections.
  Traffic is sorted nearest-first, bobs/rolls, and carries wakes and lit
  bridge bands.
- **Interface.** Phone transport now wraps into full rows (all five cameras
  plus SPEED visible, verified at 393×852), Tweaks is capped above the
  transport bar (bottom sheet on phones), debug draw/triangle stats are
  gone, the Sound button reads on/off, Hide UI shows a restore hint and any
  tap brings the UI back, and the voyage opens on the first Red Sea dawn
  (Day 0.155) instead of mid-voyage.

Final evidence for this build: curated scene pass in `screenshots/`
(opening dawn, wing, drone noon, stern quarter, Hong Kong dawn landfall,
Hong Kong in port from bridge and drone, Singapore night, Milky-Way night,
maximum storm from drone and bridge, phone layout).

## Day 0 (cont.) — Final verification & deployment

- `node tests/sim.test.mjs` — **25/25 checks pass** (route 5,826 nm, solar,
  weather, Malacca-vs-open-ocean traffic, ship motion, and the corrected
  opening moment: Day 0.155, sun 8.1° on the first morning).
- `node tests/fft.test.mjs` — **12/12 checks pass** (Hs calibration 3.5 m,
  determinism, full bake 0.7 s, cloud volume 3.4 s).
- `check_page.py --final` on the exact delivered bytes — **exit 0, zero
  problems** on desktop 1366×768 and phone 393×852, no console/page errors.
- `check_page.py --webgpu off` — **exit 0**; three's WebGL2 fallback renders
  the same scene when WebGPU is unavailable.
- Public deployment: GitHub repository
  `laurentbecherel/aurora-pacifica-timelapse`, GitHub Pages built and
  serving <https://laurentbecherel.github.io/aurora-pacifica-timelapse/>
  (index, modules and the bake worker all verified over HTTPS). Local run
  remains `node server.mjs 8080`.
- Performance note: every frame rate measured during development came from
  a software renderer and says nothing about the target machine. Cinematic
  (full resolution, 32 cloud steps, bloom) is the default for the user's
  RTX 3080 at 4K; Balanced (75% scale, 22 steps) and Performance (55%, 14
  steps, no bloom) are one click away in Tweaks.
