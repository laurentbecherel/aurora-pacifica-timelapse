// Sky: analytic atmosphere + sun/moon discs + stars/Milky Way + volumetric
// raymarched clouds (128^3 noise volume). `makeAtmosphereFn` is shared with
// the ocean for reflections, so sea and sky always agree.
import * as THREE from 'three/webgpu';
import {
  Fn, float, vec3, vec4, uniform, texture3D, normalize, dot, cross, mix, clamp,
  smoothstep, pow, exp, max, min, abs, fract, floor, sin, cos, sqrt, length,
  cameraPosition, positionWorld, modelViewProjection, Loop, If, Break, select,
} from 'three/tsl';

export function createSkyUniforms() {
  return {
    sunDir: uniform(new THREE.Vector3(0, 1, 0)),
    sunColor: uniform(new THREE.Color(8, 7.4, 6.4)),   // HDR, CPU-driven
    moonDir: uniform(new THREE.Vector3(0, -1, 0)),
    moonColor: uniform(new THREE.Color(0.12, 0.14, 0.18)),
    ambient: uniform(new THREE.Color(0.25, 0.32, 0.45)), // hemisphere average
    haze: uniform(0.25),
    fogColor: uniform(new THREE.Color(0.55, 0.62, 0.7)),
    fogDensity: uniform(0.000035),
    lightning: uniform(0),
    cloudCover: uniform(0.35),
    cloudBase: uniform(850),       // metres
    cloudThick: uniform(650),
    cloudDark: uniform(0),         // 0 fair .. 1 storm
    cloudSteps: uniform(30),
    cloudProfile: uniform(new THREE.Vector4(0.22, 0.55, 1.0, 0.55)), // bot, top, density, detail
    cloudDrift: uniform(new THREE.Vector3(0, 0, 0)), // world-metres offset in volume space
    starAxis: uniform(new THREE.Vector3(0, 1, 0)),
    starAngle: uniform(0),
    timeSec: uniform(0),
  };
}

// Placeholder 4^3 volume so the sky works before the bake worker returns.
export function makePlaceholderVolume() {
  const s = 4, data = new Uint8Array(s * s * s * 4);
  for (let i = 0; i < data.length; i += 4) {
    const v = 90 + ((i * 7919) % 90);
    data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = v;
  }
  const tex = new THREE.Data3DTexture(data, s, s, s);
  tex.format = THREE.RGBAFormat;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

const V3 = (r, g, b) => vec3(float(r), float(g), float(b));

// Atmosphere colour along `dir`. withDisc>0.5 adds sun/moon discs (dome only).
export function makeAtmosphereFn(U) {
  return Fn(([dir, withDisc]) => {
    const y = dir.y;
    const sunAmt = max(dot(dir, U.sunDir), 0.0);
    const sunEl = U.sunDir.y;
    const dayF = smoothstep(-0.06, 0.28, sunEl);
    const duskF = float(1.0).sub(dayF).mul(smoothstep(-0.28, -0.02, sunEl));
    const nightF = float(1.0).sub(smoothstep(-0.16, 0.03, sunEl));

    // Zenith / horizon palettes (linear HDR-ish).
    const dayZen = V3(0.048, 0.155, 0.52), dayHor = V3(0.47, 0.60, 0.77);
    const goldZen = V3(0.16, 0.20, 0.42);
    const goldHorSun = V3(1.55, 0.52, 0.14), goldHorAway = V3(0.42, 0.33, 0.52);
    const nightZen = V3(0.003, 0.006, 0.016), nightHor = V3(0.016, 0.028, 0.05);

    const horGold = mix(goldHorAway, goldHorSun, pow(sunAmt, 2.0));
    const zen = mix(nightZen, mix(goldZen, dayZen, dayF), float(1.0).sub(nightF));
    const hor = mix(nightHor, mix(horGold, dayHor, dayF), float(1.0).sub(nightF));

    const t = pow(float(1.0).sub(max(y, 0.0)), 2.4);
    let col = mix(zen, hor, t);

    // Mie-ish forward scatter + warm dusk glow.
    const mie = pow(sunAmt, 6.0).mul(0.16).add(pow(sunAmt, 48.0).mul(0.55));
    col = col.add(U.sunColor.mul(mie).mul(float(0.25).add(dayF.mul(0.75))).mul(0.12));
    col = col.add(V3(0.9, 0.30, 0.06).mul(pow(sunAmt, 3.0)).mul(duskF).mul(0.35).mul(clamp(float(1.0).sub(abs(y)), 0.0, 1.0)));

    // Haze whitens toward the horizon colour.
    const hazeAmt = U.haze.mul(pow(float(1.0).sub(max(y, 0.0)), 5.0));
    col = mix(col, U.fogColor, clamp(hazeAmt, 0.0, 1.0));

    // Moon glow (disc only on the dome pass).
    const moonAmt = max(dot(dir, U.moonDir), 0.0);
    col = col.add(U.moonColor.mul(pow(moonAmt, 40.0).mul(0.5).add(pow(moonAmt, 350.0).mul(1.2))).mul(nightF));

    // Discs.
    const sunDisc = smoothstep(0.99988, 0.99997, dot(dir, U.sunDir));
    const moonDisc = smoothstep(0.99993, 0.999985, dot(dir, U.moonDir));
    col = col.add(U.sunColor.mul(sunDisc).mul(6.0).mul(withDisc));
    col = col.add(V3(0.75, 0.80, 0.88).mul(moonDisc).mul(1.6).mul(withDisc).mul(nightF));

    // Below-horizon: settle to fog colour so the far ocean rim blends.
    col = mix(col, U.fogColor.mul(0.92), float(1.0).sub(smoothstep(-0.06, 0.0, y)));
    // Lightning lifts the whole sky briefly.
    col = col.add(V3(0.45, 0.5, 0.65).mul(U.lightning).mul(0.55));
    return col;
  });
}

// ---- Stars + Milky Way (dome only) ----------------------------------------
function makeStarsFn(U, volNode) {
  return Fn(([dir]) => {
    // Rotate around the celestial pole so stars wheel with voyage time.
    const ang = U.starAngle;
    const c = cos(ang), s = sin(ang);
    const axis = U.starAxis;
    const d = dir.mul(c)
      .add(cross(axis, dir).mul(s))
      .add(axis.mul(dot(axis, dir).mul(float(1.0).sub(c))));
    // Cell-hash star field at two densities.
    const cellStar = (p, scale, thresh) => {
      const g = p.mul(scale);
      const id = floor(g);
      const f = fract(g).sub(0.5);
      const h = fract(sin(dot(id, vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
      const star = float(1.0).sub(smoothstep(0.0, 0.16, length(f))).mul(step(thresh, h));
      const tw = float(0.75).add(sin(U.timeSec.mul(2.0).add(h.mul(40.0))).mul(0.25));
      return star.mul(tw).mul(h);
    };
    const stars = cellStar(d, 150.0, 0.985).mul(2.6).add(cellStar(d.add(31.7), 280.0, 0.990).mul(1.5));
    // Milky Way: soft band around a tilted great circle, dust from volume.
    const bandN = normalize(vec3(0.42, 0.75, -0.51));
    const band = exp(abs(dot(d, bandN)).negate().mul(3.4));
    // R channel only: the Worley G/B/A channels read as honeycomb at sky scale.
    const dust = volNode.sample(d.mul(1.6).add(0.31)).r.mul(0.55)
      .add(volNode.sample(d.mul(4.3).add(0.77)).r.mul(0.45));
    const milky = band.mul(dust.mul(0.34).add(0.08)).mul(0.27);
    const nightF = float(1.0).sub(smoothstep(-0.16, 0.02, U.sunDir.y));
    const vis = nightF.mul(smoothstep(-0.02, 0.12, dir.y));
    return V3(0.85, 0.9, 1.0).mul(stars).add(V3(0.62, 0.68, 0.85).mul(milky)).mul(vis);
  });
}

// step() helper via TSL: x >= edge ? 1 : 0  (kept local to avoid name clash)
function step(edge, x) { return select(x.greaterThanEqual(edge), float(1.0), float(0.0)); }

// ---- Volumetric clouds -----------------------------------------------------
function makeCloudsFn(U, volNode) {
  return Fn(([dir]) => {
    const camPos = cameraPosition;
    const base = U.cloudBase, top = U.cloudBase.add(U.cloudThick);
    const safeY = max(dir.y, 0.004);
    const tEnter = max(base.sub(camPos.y).div(safeY), 0.0);
    const tExit = min(top.sub(camPos.y).div(safeY), 55000.0);
    const slabLen = max(tExit.sub(tEnter), 0.0);
    const steps = max(U.cloudSteps, 1.0);
    const dt = slabLen.div(steps);

    const prof = U.cloudProfile; // x bottom soft, y top soft, z density, w detail
    const coverThr = float(1.16).sub(pow(max(U.cloudCover, 0.001), 0.75).mul(0.95));
    const sigma = float(0.0008).mul(prof.z);
    const sunSlant = min(float(1.0).div(max(U.sunDir.y, 0.12)), 4.0);
    const phaseCos = dot(dir, U.sunDir);
    const phase = float(0.55).add(pow(max(phaseCos, 0.0), 3.0).mul(0.8))
      .add(pow(max(phaseCos, 0.0), 24.0).mul(1.6)); // HG-ish two-lobe

    const trans = float(1.0).toVar();
    const colAcc = vec3(0.0).toVar();
    const odAcc = float(0.0).toVar();
    const volScale = float(1.0).div(6200.0);

    Loop(48, ({ i }) => {
      const fi = float(i);
      If(fi.greaterThanEqual(steps), () => { Break(); });
      const t = tEnter.add(dt.mul(fi.add(0.5)));
      const p = camPos.add(dir.mul(t));
      const hf = clamp(p.y.sub(base).div(max(U.cloudThick, 1.0)), 0.0, 1.0);
      const profile = smoothstep(0.0, prof.x, hf)
        .mul(float(1.0).sub(smoothstep(prof.y, 1.0, hf)));
      // Map the volume's third axis to height through the layer. Sampling by
      // absolute altitude/6200 used only a thin slice of the 3D noise and
      // extruded it into flat discs; hf gives the clouds real vertical body.
      const xzBase = p.xz.add(U.cloudDrift.xz).mul(volScale);
      const evolve = U.cloudDrift.y.mul(0.00003);
      const detail = volNode.sample(vec3(
        xzBase.x.mul(3.07).add(0.23), xzBase.y.mul(3.07).add(0.47),
        hf.mul(2.15).add(evolve).add(0.11)));
      const detailVal = detail.g.mul(0.45).add(detail.b.mul(0.32)).add(detail.a.mul(0.23));
      const warpX = detail.g.sub(0.5).mul(0.16);
      const warpY = detail.b.sub(0.5).mul(0.16);
      const baseSmp = volNode.sample(vec3(
        xzBase.x.add(warpX), xzBase.y.add(warpY), hf.mul(0.92).add(evolve)));
      let shape = baseSmp.r;
      shape = shape.sub(detailVal.mul(prof.w).mul(float(1.0).sub(shape)).mul(0.55));
      const dens = smoothstep(coverThr, coverThr.add(0.30), shape).mul(profile);
      const a = float(1.0).sub(exp(dens.mul(dt).mul(sigma).negate()));
      odAcc.addAssign(dens.mul(dt).mul(sigma));
      // Tops catch the sun, bases sit in shade (cheap vertical gradient).
      const sunBeer = exp(odAcc.mul(sunSlant).mul(0.55).negate())
        .mul(pow(hf, 1.5).mul(0.95).add(0.35));
      const powder = float(1.0).sub(exp(odAcc.mul(1.6).negate()));
      const amb = U.ambient.mul(float(1.38).sub(U.cloudDark.mul(1.18)))
        .add(V3(0.55, 0.6, 0.78).mul(U.lightning).mul(2.2));
      const lightCol = U.sunColor.mul(0.30).mul(float(1.0).sub(U.cloudDark.mul(0.5)))
        .mul(sunBeer).mul(phase).mul(powder.mul(0.7).add(0.3))
        .add(amb.mul(hf.mul(0.42).add(0.30)));
      colAcc.addAssign(lightCol.mul(a).mul(trans));
      trans.mulAssign(float(1.0).sub(a));
      If(trans.lessThan(0.015), () => { Break(); });
    });

    // Aerial perspective: distant cloud deck melts into horizon haze.
    const distFade = exp(tEnter.mul(-0.000010));
    const horFade = smoothstep(0.004, 0.16, dir.y);
    const alpha = float(1.0).sub(trans).mul(distFade).mul(horFade)
      .mul(step(0.0001, slabLen));
    const cloudCol = mix(colAcc, U.fogColor.mul(0.85), float(1.0).sub(distFade).mul(0.62));
    return vec4(cloudCol, clamp(alpha, 0.0, 1.0));
  });
}

// ---- Thin cirrus sheet -----------------------------------------------------
function makeCirrusFn(U, volNode) {
  return Fn(([dir]) => {
    const safeY = max(dir.y, 0.02);
    const p = cameraPosition.add(dir.mul(float(7800.0).sub(cameraPosition.y).div(safeY)));
    const uvw = vec3(p.x.mul(0.000016), p.z.mul(0.000016), float(0.37))
      .add(U.cloudDrift.mul(0.00002));
    const wisp = volNode.sample(uvw).g;
    const a = smoothstep(0.52, 0.85, wisp).mul(0.16)
      .mul(smoothstep(0.015, 0.09, dir.y))
      .mul(float(1.0).sub(U.cloudDark).mul(0.8).add(0.2));
    const dayAmt = smoothstep(-0.1, 0.25, U.sunDir.y);
    const colr = mix(V3(0.05, 0.06, 0.09), V3(0.95, 0.97, 1.02), dayAmt)
      .mul(U.ambient.mul(2.2).add(0.04));
    return vec4(colr, clamp(a, 0.0, 1.0));
  });
}

export function createSkyDome(U, volumeTexture) {
  const volNode = texture3D(volumeTexture);
  const atmosphere = makeAtmosphereFn(U);
  const stars = makeStarsFn(U, volNode);
  const clouds = makeCloudsFn(U, volNode);
  const cirrus = makeCirrusFn(U, volNode);

  const material = new THREE.NodeMaterial();
  material.side = THREE.BackSide;
  material.depthWrite = false;
  material.vertexNode = Fn(() => {
    const pos = modelViewProjection;
    pos.z.assign(pos.w); // pin to far plane (SkyMesh pattern)
    return pos;
  })();
  material.colorNode = Fn(() => {
    const dir = normalize(positionWorld.sub(cameraPosition));
    let col = atmosphere(dir, float(1.0));
    const cir = cirrus(dir);
    col = mix(col, cir.rgb, cir.a);
    col = col.add(stars(dir));
    const cl = clouds(dir);
    col = mix(col, cl.rgb, cl.a);
    return vec4(col, 1.0);
  })();

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.scale.setScalar(4000);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return { mesh, volNode, atmosphere };
}

