// Regression tests for field-reported defects (2026-11-18 follow-up):
// 1) `Cannot read properties of null (reading 'depthTexture')` crash.
//    three r180 ShadowNode starts with `shadowMap = null` until its first
//    setup; toggling `light.castShadow` at runtime (we did it every frame
//    on an intensity threshold) recreates that node and can reach
//    `shadowMap.depthTexture` while it is still null on real GPUs.
//    Pin: the sun light's castShadow is assigned exactly once (at creation).
// 2) Ship not riding the visible swell: ship motion must sample the same
//    swell train the ocean shader displaces with (shared src/sim/swell.js).
// Run: node tests/regressions.test.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { swellHeight, SWELL_WAVES } from '../src/sim/swell.js';

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ok -', msg); };

console.log('depthTexture crash guard:');
const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const toggles = mainSrc.match(/sunLight\.castShadow\s*=/g) || [];
ok(toggles.length === 1, `sunLight.castShadow assigned once at creation, never toggled per frame (found ${toggles.length})`);
ok(/sunLight\.shadow\.autoUpdate\s*=\s*false/.test(mainSrc),
  'shadow cost is gated via shadow.autoUpdate/needsUpdate instead of castShadow');

console.log('shared swell (ship rides the shader swell):');
ok(SWELL_WAVES.length >= 3 && SWELL_WAVES.every((w) => w.wl > 60 && w.amp > 0),
  'swell train has ship-scale components');
const h0 = swellHeight(0, 0, 0);
const hT = swellHeight(0, 0, 6.5);
ok(Number.isFinite(h0) && Number.isFinite(hT) && Math.abs(hT - h0) > 0.05,
  `swell height evolves with time (${h0.toFixed(2)} -> ${hT.toFixed(2)} m at unit amp)`);
// Bow and stern must not move in lockstep: at some time in a minute they are
// on opposite sides of the mean, which is what produces visible pitching.
let opposite = false, maxDiff = 0;
for (let t = 0; t < 60; t += 0.25) {
  const bow = swellHeight(0, 140, t), stern = swellHeight(0, -140, t);
  if (bow * stern < 0) opposite = true;
  maxDiff = Math.max(maxDiff, Math.abs(bow - stern));
}
ok(opposite && maxDiff > 0.25, `bow/stern see opposite swell phases (max diff ${maxDiff.toFixed(2)} m)`);
let maxAbs = 0;
for (let t = 0; t < 120; t += 0.2) for (const x of [-120, 0, 120])
  maxAbs = Math.max(maxAbs, Math.abs(swellHeight(x, x * 0.7, t)));
ok(maxAbs > 0.35 && maxAbs < 1.2, `unit-amp swell crest sane before Hs scaling (max ${maxAbs.toFixed(2)} m)`);

console.log(`\nALL ${passed} CHECKS PASSED`);
