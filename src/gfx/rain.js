// GPU rain: instanced streaks cycling in a box around the camera.
// All motion is in the vertex shader (seed attribute + time), zero CPU cost.
import * as THREE from 'three/webgpu';
import {
  Fn, float, vec3, vec4, uniform, attribute, cameraPosition, positionLocal, positionWorld,
  fract, normalize, cross, smoothstep, length,
} from 'three/tsl';

export function createRain(skyU, maxCount = 7000) {
  const U = {
    amt: uniform(0),          // 0..1 rain intensity
    slant: uniform(new THREE.Vector2(0.12, 0.05)), // wind slant xz
    timeSec: uniform(0),
    count: uniform(maxCount),
  };
  const geo = new THREE.InstancedBufferGeometry();
  const base = new THREE.PlaneGeometry(1, 1);
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('normal', base.getAttribute('normal'));
  geo.setAttribute('uv', base.getAttribute('uv'));
  const seeds = new Float32Array(maxCount * 4);
  let s = 1234567;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  for (let i = 0; i < maxCount * 4; i++) seeds[i] = rnd();
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  geo.instanceCount = maxCount;

  const mat = new THREE.MeshBasicNodeMaterial();
  mat.transparent = true;
  mat.depthWrite = false;
  mat.side = THREE.DoubleSide;
  const BOX = 70; // metres around camera
  mat.positionNode = Fn(() => {
    const seed = attribute('aSeed', 'vec4');
    const speed = float(23.0).add(seed.w.mul(9.0));
    const fall = fract(seed.y.add(U.timeSec.mul(speed).div(BOX)));
    const px = fract(seed.x.add(U.slant.x.mul(fall).mul(2.2))).sub(0.5).mul(BOX);
    const pz = fract(seed.z.add(U.slant.y.mul(fall).mul(2.2))).sub(0.5).mul(BOX);
    const py = float(0.5).sub(fall).mul(BOX);
    const center = cameraPosition.add(vec3(px, py, pz));
    // Cylindrical billboard: width axis faces camera, length along fall dir.
    const vel = normalize(vec3(U.slant.x.mul(14.0), -23.0, U.slant.y.mul(14.0)));
    const toCam = normalize(cameraPosition.sub(center));
    const side = normalize(cross(vel, toCam));
    const len = float(0.34).add(seed.w.mul(0.34));
    const camDist = length(cameraPosition.sub(center));
    const nearFade = smoothstep(1.2, 4.5, camDist);
    const gate = seed.w.lessThan(U.amt);
    const wScale = gate.select(0.008, 0.0).mul(nearFade);
    const lScale = gate.select(1.0, 0.0); // zero length too: no 1px line artifacts
    return center
      .add(side.mul(positionLocal.x).mul(wScale))
      .add(vel.mul(positionLocal.y).mul(len).mul(lScale));
  })();
  mat.colorNode = Fn(() => {
    const col = skyU.ambient.mul(1.7).add(vec3(0.5, 0.55, 0.7).mul(skyU.lightning).mul(1.5));
    const dist = length(cameraPosition.sub(positionWorld));
    const alpha = smoothstep(1.2, 4.5, dist)
      .mul(float(1.0).sub(smoothstep(48.0, 70.0, dist))).mul(0.20);
    return vec4(col, alpha);
  })();

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 20;
  return { mesh, uniforms: U, setCount: (n) => { geo.instanceCount = Math.min(n, maxCount); } };
}
