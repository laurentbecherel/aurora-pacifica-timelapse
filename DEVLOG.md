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
