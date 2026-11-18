// FFT-tiled ocean. Baked Tessendorf atlas sampled at three world scales
// (Sea-of-Thieves style), custom TSL lighting sharing the sky atmosphere.
import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, uniform, texture, normalize, dot, mix, clamp,
  smoothstep, pow, exp, max, sin, cos, sqrt, length, fract, floor, abs,
  positionLocal, positionWorld, cameraPosition, varyingProperty, select,
} from 'three/tsl';

export const ATLAS_N = 128, ATLAS_FRAMES = 64, ATLAS_GRID = 8, ATLAS_PERIOD = 16;
// The bake's dominant wavelength is ~0.7 of a tile. These world tile sizes put
// the main swell at ship scale (~240 m) with a steep ~55 m wind sea over it,
// instead of stretching the same spectrum into a nearly flat 500 m swell.
const OCTAVE_TILES = [340, 76, 10];
const OCTAVE_WEIGHTS = [1.05, 0.50, 0.08];
const OCTAVE_DISP = [0.95, 0.32, 0.045];
const OCTAVE_FADES = [4200, 1500, 260]; // vertex-displacement fade distances (m)

export function createOceanUniforms() {
  return {
    framePhase: uniform(0),                    // 0..64 atlas frame (fractional)
    fftBlend: uniform(0),                      // 0 analytic -> 1 FFT
    amp: uniform(1),                           // Hs scale vs bake (3.5 m)
    rough: uniform(0.13),
    rotCS: uniform(new THREE.Vector2(1, 0)),   // sampled-space rotation
    off0: uniform(new THREE.Vector2(0, 0)),
    off1: uniform(new THREE.Vector2(0, 0)),
    off2: uniform(new THREE.Vector2(0, 0)),
    deepColor: uniform(new THREE.Color(0.008, 0.045, 0.075)),
    scatterColor: uniform(new THREE.Color(0.02, 0.16, 0.16)),
    foamAmt: uniform(1),
    wakeAmt: uniform(1),
    seaTime: uniform(0),
  };
}

export function makePlaceholderAtlas() {
  const s = 64;
  const data = new Uint16Array(s * s * 4); // half-float zeros
  const tex = new THREE.DataTexture(data, s, s, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

// Concentric geometry: dense centre grid + polar rings to a 320 km horizon.
export function buildOceanGeometry() {
  const pos = [], idx = [];
  const pushGrid = () => {
    const SEG = 320, SIZE = 2100, half = SIZE / 2, base = pos.length / 3;
    for (let j = 0; j <= SEG; j++) for (let i = 0; i <= SEG; i++)
      pos.push(-half + (i / SEG) * SIZE, 0, -half + (j / SEG) * SIZE);
    for (let j = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) {
      const a = base + j * (SEG + 1) + i, b = a + 1, c = a + SEG + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  };
  const pushRing = (r0, r1, radial, angular, yBias) => {
    const base = pos.length / 3;
    for (let j = 0; j <= radial; j++) {
      const r = r0 * Math.pow(r1 / r0, j / radial);
      for (let i = 0; i <= angular; i++) {
        const a = (i / angular) * Math.PI * 2;
        pos.push(Math.cos(a) * r, yBias, Math.sin(a) * r);
      }
    }
    for (let j = 0; j < radial; j++) for (let i = 0; i < angular; i++) {
      const a = base + j * (angular + 1) + i, b = a + 1, c = a + angular + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  };
  pushGrid();
  pushRing(1000, 19000, 20, 160, -0.35);
  pushRing(18000, 320000, 8, 96, -1.4);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const nrm = new Float32Array(pos.length);
  for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  geo.setIndex(idx);
  return geo;
}

const modf = (a, b) => a.sub(b.mul(floor(a.div(b))));

export function createOcean(skyU, atmosphereFn, atlasTexture) {
  const U = createOceanUniforms();
  const atlasNode = texture(atlasTexture);
  const tiles = OCTAVE_TILES.map((t) => float(t));
  const offs = [U.off0, U.off1, U.off2];

  // Sample one atlas frame with tile-inset UVs (no cross-tile bleed).
  const sampleFrame = Fn(([sxz, tileM, frame]) => {
    const col = modf(frame, float(ATLAS_GRID));
    const row = floor(frame.div(ATLAS_GRID));
    const local = fract(sxz.div(tileM)).mul(ATLAS_N - 1).add(0.5).div(ATLAS_N);
    const uvA = vec2(col, row).add(local).div(ATLAS_GRID);
    return atlasNode.sample(uvA);
  });
  // Frame-interpolated sample -> (h, Dx, Dz, J) in bake metres.
  const sampleFFT = Fn(([sxz, tileM]) => {
    const f0 = floor(U.framePhase);
    const f1 = modf(f0.add(1.0), float(ATLAS_FRAMES));
    const fr = fract(U.framePhase);
    return mix(sampleFrame(sxz, tileM, f0), sampleFrame(sxz, tileM, f1), fr);
  });

  // Ship-frame xz -> sampled space (x east-ish, y forward), per octave.
  const toSampled = (xz, oct) => {
    const fwd = vec2(xz.x, xz.y.negate()); // (starboard, forward)
    const c = U.rotCS.x, s = U.rotCS.y;
    const r = vec2(fwd.x.mul(c).sub(fwd.y.mul(s)), fwd.x.mul(s).add(fwd.y.mul(c)));
    return r.add(offs[oct]);
  };
  const sampledVecToShip = (v) => {
    const c = U.rotCS.x, s = U.rotCS.y;
    const fwd = vec2(v.x.mul(c).add(v.y.mul(s)), v.x.mul(s).negate().add(v.y.mul(c)));
    return vec2(fwd.x, fwd.y.negate()); // back to (x, z)
  };

  // Analytic fallback sea (also the pre-bake state): 5 directional sines.
  const analytic = Fn(([sxz]) => {
    const dirs = [[1, 0.3, 190, 0.75], [0.8, -0.5, 97, 0.5], [-0.4, 1, 53, 0.3],
      [0.2, 0.9, 23, 0.16], [1, -0.9, 11, 0.08]];
    let h = float(0.0).toVar(), gx = float(0.0).toVar(), gz = float(0.0).toVar();
    for (const [dx, dz, wl, a] of dirs) {
      const k = (2 * Math.PI) / wl, w = Math.sqrt(9.81 * k);
      const ph = sxz.x.mul(dx * k).add(sxz.y.mul(dz * k)).sub(U.seaTime.mul(w));
      h.addAssign(sin(ph).mul(a));
      gx.addAssign(cos(ph).mul(a * k * dx));
      gz.addAssign(cos(ph).mul(a * k * dz));
    }
    return vec4(h, gx, gz, float(1.0)); // h, slopeX, slopeZ, J=1
  });

  const vNorm = varyingProperty('vec3');
  const vFoamJ = varyingProperty('float');
  const vH = varyingProperty('float');

  const material = new THREE.MeshBasicNodeMaterial();
  material.positionNode = Fn(() => {
    const local = positionLocal;
    const dist = length(local.xz);
    let dispS = vec2(0.0).toVar();       // sampled-space chop
    let hSum = float(0.0).toVar();
    let slope = vec2(0.0).toVar();
    let minJ = float(2.0).toVar();
    for (let o = 0; o < 3; o++) {
      const fade = float(1.0).div(float(1.0).add(pow(dist.div(OCTAVE_FADES[o]), 2.0)));
      const w = float(OCTAVE_WEIGHTS[o]).mul(fade).mul(U.fftBlend);
      const sxz = toSampled(local.xz, o);
      const smp = sampleFFT(sxz, tiles[o]);
      hSum.addAssign(smp.r.mul(w));
      dispS.addAssign(smp.gb.mul(float(OCTAVE_DISP[o]).mul(fade).mul(U.fftBlend)));
      if (o < 2) minJ.assign(select(smp.a.lessThan(minJ), smp.a, minJ));
      if (o < 2) {
        const eps = float(OCTAVE_TILES[o] / ATLAS_N * 1.5);
        const hx = sampleFFT(sxz.add(vec2(eps, 0.0)), tiles[o]);
        const hz = sampleFFT(sxz.add(vec2(0.0, eps)), tiles[o]);
        slope.addAssign(vec2(hx.r.sub(smp.r), hz.r.sub(smp.r)).div(eps).mul(w));
      }
    }
    // Analytic fallback, cross-faded by fftBlend.
    const an = analytic(toSampled(local.xz, 0));
    const anW = float(1.0).sub(U.fftBlend);
    hSum.addAssign(an.r.mul(anW).mul(0.5));
    slope.addAssign(an.gb.mul(anW));

    // A coherent long swell train guarantees ship-scale faces and a moving
    // horizon silhouette even where the broad FFT octave is gentle. It is
    // part of the sea in both paths (reduced while the fallback is visible).
    const swellScale = float(0.45).add(U.fftBlend.mul(0.55))
      .mul(float(1.0).div(float(1.0).add(pow(dist.div(1800.0), 2.0))));
    const swellCoords = toSampled(local.xz, 0);
    const swellWaves = [
      [0.98, -0.20, 265, 0.34], [0.91, 0.42, 171, 0.21], [0.76, -0.65, 108, 0.12],
    ];
    for (const [dx, dz, wl, a] of swellWaves) {
      const k = (2 * Math.PI) / wl, w = Math.sqrt(9.81 * k);
      const ph = swellCoords.x.mul(dx * k).add(swellCoords.y.mul(dz * k)).sub(U.seaTime.mul(w));
      hSum.addAssign(sin(ph).mul(a).mul(swellScale));
      slope.addAssign(vec2(cos(ph).mul(a * k * dx), cos(ph).mul(a * k * dz)).mul(swellScale));
      dispS.addAssign(vec2(dx, dz).mul(cos(ph).mul(a * 0.55).mul(swellScale)));
    }

    const h = hSum.mul(U.amp);
    const dispShip = sampledVecToShip(dispS.mul(U.amp));
    const nS = normalize(vec3(slope.x.mul(U.amp).negate(), 1.0, slope.y.mul(U.amp).negate()));
    const nShip2 = sampledVecToShip(vec2(nS.x, nS.z));
    vNorm.assign(normalize(vec3(nShip2.x, nS.y, nShip2.y)));
    vFoamJ.assign(minJ);
    vH.assign(h);
    return vec3(local.x.add(dispShip.x), local.y.add(h), local.z.add(dispShip.y));
  })();

  material.colorNode = Fn(() => {
    const wp = positionWorld;
    const viewVec = cameraPosition.sub(wp);
    const dist = length(viewVec);
    const V = normalize(viewVec);

    // Per-pixel micro detail from the smallest FFT octave, sampled twice
    // (rotated) so tiling never reads as a regular dot/stipple pattern.
    const sxz = toSampled(wp.xz, 2);
    const epsD = float(0.45);
    const hc = sampleFFT(sxz, tiles[2]);
    const hx = sampleFFT(sxz.add(vec2(epsD, 0.0)), tiles[2]);
    const hz = sampleFFT(sxz.add(vec2(0.0, epsD)), tiles[2]);
    const sxzR = vec2(sxz.y, sxz.x.negate()).mul(1.37).add(vec2(31.7, 11.3));
    const hcR = sampleFFT(sxzR, tiles[2]);
    const hxR = sampleFFT(sxzR.add(vec2(epsD, 0.0)), tiles[2]);
    const hzR = sampleFFT(sxzR.add(vec2(0.0, epsD)), tiles[2]);
    const slopeA = vec2(hx.r.sub(hc.r), hz.r.sub(hc.r)).div(epsD);
    const slopeB = vec2(hzR.r.sub(hcR.r), hxR.r.sub(hcR.r).negate()).div(epsD);
    const mSlopeS = slopeA.add(slopeB.mul(0.8))
      .mul(OCTAVE_WEIGHTS[2] * 1.7).mul(U.amp).mul(U.fftBlend);
    const mSlope = sampledVecToShip(mSlopeS);
    const detFade = float(1.0).div(float(1.0).add(dist.div(300.0)));
    const N = normalize(vNorm.add(vec3(
      mSlope.x.negate().mul(detFade), 0.0, mSlope.y.negate().mul(detFade))));

    const L = skyU.sunDir;
    const NdotV = clamp(dot(N, V), 0.0, 1.0);
    const NdotL = clamp(dot(N, L), 0.0, 1.0);
    const Hv = normalize(L.add(V));
    const NdotH = clamp(dot(N, Hv), 0.0, 1.0);

    // GGX sun glitter.
    const a = U.rough.mul(U.rough);
    const a2 = a.mul(a);
    const denom = NdotH.mul(NdotH).mul(a2.sub(1.0)).add(1.0);
    const Dggx = a2.div(float(Math.PI).mul(denom).mul(denom));
    const fres = float(0.02).add(float(0.98).mul(pow(float(1.0).sub(NdotV), 5.0)));
    const spec = skyU.sunColor.mul(Dggx).mul(fres).mul(NdotL).mul(2.4)
      .mul(float(1.0).sub(skyU.cloudCover.mul(0.45)));
    // Moon glitter, dimmer and broader.
    const Hm = normalize(skyU.moonDir.add(V));
    const moonSpec = skyU.moonColor.mul(pow(clamp(dot(N, Hm), 0.0, 1.0), 90.0)).mul(0.6);

    // Sky reflection through the shared atmosphere.
    const reflRaw = N.mul(NdotV.mul(2.0)).sub(V);
    const refl = normalize(vec3(reflRaw.x, abs(reflRaw.y), reflRaw.z));
    let skyCol = atmosphereFn(refl, float(0.0));
    skyCol = mix(skyCol, skyU.ambient.mul(1.25), skyU.cloudCover.mul(0.38));

    // Water body: deep colour + forward-scatter glow through crests.
    // Normalise by the current amplitude so "crest" means the top of this
    // sea, not an absolute height that saturates as soon as amp rises.
    const crest = clamp(vH.div(max(U.amp.mul(2.8), 0.45)).mul(0.5).add(0.5), 0.0, 1.0);
    const backlit = pow(clamp(dot(V, L).mul(-0.5).add(0.5), 0.0, 1.0), 3.0);
    const scatter = U.scatterColor.mul(backlit).mul(crest)
      .mul(skyU.sunColor.r.mul(0.10).add(0.08));
    let col = U.deepColor.mul(float(1.0).sub(fres)).mul(NdotL.mul(0.7).add(0.45))
      .add(skyCol.mul(fres)).add(spec).add(moonSpec).add(scatter);

    // ---- Foam: Jacobian folding + crest breakup (wind-stretched) --------
    const hcF = sampleFFT(vec2(sxz.x.mul(0.6), sxz.y.mul(0.22)), tiles[2]);
    const noiseBreak = clamp(hcF.r.mul(0.34).add(hcR.r.mul(0.14)).add(0.5), 0.0, 1.15);
    // Baked J assumes unit amplitude; compression deepens as chop is scaled.
    const jEff = float(1.0).sub(float(1.0).sub(vFoamJ).mul(clamp(U.amp, 0.15, 2.4)));
    const jFoam = float(1.0).sub(smoothstep(-0.05, 0.45, jEff));
    const crestFoam = smoothstep(0.78, 0.98, crest.mul(noiseBreak));
    let foam = clamp(jFoam.mul(1.05).add(crestFoam.mul(0.55)), 0.0, 1.0)
      .mul(smoothstep(0.30, 0.68, noiseBreak)).mul(U.foamAmt).mul(U.fftBlend);

    // ---- Hull + wake foam (ship: 330 m, bow z=-165, stern z=+165) -------
    const hxAbs = abs(wp.x);
    const wz = wp.z.sub(162.0); // >0 astern
    const wakeWidth = float(15.0).add(max(wz, 0.0).mul(0.15));
    const inWake = float(1.0).sub(smoothstep(wakeWidth.mul(0.5), wakeWidth, hxAbs));
    const wakeDecay = exp(max(wz, 0.0).negate().mul(0.0022));
    const arm = float(1.0).sub(smoothstep(2.0, 14.0,
      abs(hxAbs.sub(float(9.0).add(max(wz, 0.0).mul(0.20))))));
    // Wake turbulence is sampled in ship coordinates and streamed astern,
    // so the wash churns backward instead of being painted on the water.
    const wakeCoord = vec2(wp.x.mul(0.075), max(wz, 0.0).mul(0.045).sub(U.seaTime.mul(0.55)));
    const wakeN1 = sampleFFT(wakeCoord, tiles[1]).r;
    const wakeN2 = sampleFFT(wakeCoord.mul(2.7).add(vec2(17.0, U.seaTime.mul(-0.8))), tiles[2]).r;
    const wakeNoise = clamp(wakeN1.mul(0.38).add(wakeN2.mul(0.22)).add(0.55), 0.05, 1.1);
    const astern = smoothstep(0.0, 18.0, wz);
    const propWash = exp(max(wz, 0.0).mul(-0.012))
      .mul(float(1.0).sub(smoothstep(18.0, 34.0, hxAbs)));
    const wake = inWake.mul(0.72).add(arm.mul(0.5)).add(propWash.mul(0.7))
      .mul(wakeDecay).mul(astern).mul(wakeNoise);
    const hullBand = smoothstep(24.0, 31.0, hxAbs)
      .mul(float(1.0).sub(smoothstep(31.0, 44.0, hxAbs)))
      .mul(smoothstep(-178.0, -150.0, wp.z)).mul(float(1.0).sub(smoothstep(150.0, 178.0, wp.z)));
    // Bow spray fan, driven by speed and sea height (amp).
    const bowDist = length(wp.xz.sub(vec2(0.0, -158.0)));
    const spray = exp(bowDist.mul(-0.020)).mul(U.wakeAmt)
      .mul(clamp(U.amp.mul(0.55), 0.1, 1.1)).mul(clamp(wakeNoise, 0.3, 1.1));
    foam = clamp(foam.add(wake.mul(U.wakeAmt)).add(hullBand.mul(U.wakeAmt).mul(0.85))
      .add(spray.mul(0.8)), 0.0, 1.0);

    const foamCol = skyU.ambient.mul(1.5).add(skyU.sunColor.mul(0.05).mul(NdotL))
      .add(vec3(0.5, 0.55, 0.7).mul(skyU.lightning).mul(0.8));
    col = mix(col, foamCol.mul(vec3(0.92, 0.96, 1.0)), foam.mul(0.9));

    // ---- Fog to the horizon ----------------------------------------------
    const fogF = float(1.0).sub(exp(skyU.fogDensity.mul(dist).negate()));
    col = mix(col, skyU.fogColor, clamp(fogF, 0.0, 1.0));
    return vec4(col, 1.0);
  })();

  const mesh = new THREE.Mesh(buildOceanGeometry(), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -5;
  return { mesh, uniforms: U, atlasNode };
}

