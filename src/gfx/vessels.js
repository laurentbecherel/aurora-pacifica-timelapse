// Traffic vessel meshes + lat/lon-anchored land/port features.
// All positions are computed in ship frame each frame by main.js helpers.
import * as THREE from 'three/webgpu';

function hullMesh(len, beam, depth, color) {
  const s = new THREE.Shape();
  const hb = beam / 2, L = len / 2;
  s.moveTo(-hb * 0.7, -L); s.lineTo(hb * 0.7, -L);
  s.lineTo(hb, -L * 0.6); s.lineTo(hb, L * 0.45);
  s.quadraticCurveTo(hb, L * 0.88, 0, L);
  s.quadraticCurveTo(-hb, L * 0.88, -hb, L * 0.45);
  s.lineTo(-hb, -L * 0.6); s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2); geo.translate(0, -depth * 0.35, 0);
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color, roughness: 0.62, metalness: 0.3,
  }));
}

let wakeTexture = null;
function makeWakeTexture() {
  if (wakeTexture) return wakeTexture;
  const c = document.createElement('canvas'); c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(255,255,255,0.92)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.42)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(54, 0); g.lineTo(74, 0); g.lineTo(126, 256); g.lineTo(2, 256); g.closePath(); g.fill();
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 260; i++) {
    const y = Math.random() * 256, w = 8 + (y / 256) * 52;
    g.fillStyle = `rgba(0,0,0,${0.16 + Math.random() * 0.35})`;
    g.fillRect(64 - w / 2 + (Math.random() - 0.5) * w, y, 2 + Math.random() * 14, 1 + Math.random() * 3);
  }
  wakeTexture = new THREE.CanvasTexture(c);
  return wakeTexture;
}

function rodBetween(a, b, radius, material) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 6), material);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

export function buildVessel(type, lengthM) {
  const g = new THREE.Group();
  const beam = Math.max(14, lengthM * 0.14);
  const colors = { container: 0x27384a, bulk: 0x4a2e28, tanker: 0x333a40 };
  g.add(hullMesh(lengthM, beam, lengthM * 0.09, colors[type] || 0x2a3440));
  const white = new THREE.MeshStandardMaterial({ color: 0xdfe4e8, roughness: 0.55, metalness: 0.15 });
  const castle = new THREE.Mesh(new THREE.BoxGeometry(beam * 0.8, lengthM * 0.075, lengthM * 0.09), white);
  castle.position.set(0, lengthM * 0.07, lengthM * 0.38);
  g.add(castle);
  // Forecastle, funnel, masts and a lit bridge band make traffic read underway.
  const forecastle = new THREE.Mesh(new THREE.BoxGeometry(beam * 0.72, lengthM * 0.025, lengthM * 0.09), white);
  forecastle.position.set(0, lengthM * 0.055, -lengthM * 0.41);
  g.add(forecastle);
  const funnel = new THREE.Mesh(new THREE.BoxGeometry(beam * 0.28, lengthM * 0.055, lengthM * 0.045),
    new THREE.MeshStandardMaterial({ color: 0x27313d, roughness: 0.6, metalness: 0.25 }));
  funnel.position.set(0, lengthM * 0.105, lengthM * 0.44);
  g.add(funnel);
  const mastMat = new THREE.MeshStandardMaterial({ color: 0xc8cfd6, roughness: 0.5, metalness: 0.4 });
  for (const mz of [-0.42, 0.38]) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(lengthM * 0.0025, lengthM * 0.004, lengthM * 0.11, 5), mastMat);
    mast.position.set(0, lengthM * 0.115, lengthM * mz);
    g.add(mast);
  }
  const bridgeBandMat = new THREE.MeshStandardMaterial({
    color: 0x141c24, emissive: 0xffc98a, emissiveIntensity: 0, roughness: 0.35,
  });
  const bridgeBand = new THREE.Mesh(new THREE.BoxGeometry(beam * 0.82, lengthM * 0.016, lengthM * 0.092), bridgeBandMat);
  bridgeBand.position.set(0, lengthM * 0.098, lengthM * 0.38);
  g.add(bridgeBand);
  if (type === 'container') {
    const cols = [0x2e6da4, 0x1f7a4d, 0xb03a2e, 0xd4851a, 0x707b7c];
    for (let i = 0; i < 5; i++) {
      const stack = new THREE.Mesh(
        new THREE.BoxGeometry(beam * 0.86, lengthM * 0.045, lengthM * 0.11),
        new THREE.MeshStandardMaterial({ color: cols[i % cols.length], roughness: 0.6, metalness: 0.2 }));
      stack.position.set(0, lengthM * 0.065, -lengthM * 0.28 + i * lengthM * 0.13);
      g.add(stack);
    }
  } else if (type === 'tanker') {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(beam * 0.05, beam * 0.05, lengthM * 0.7, 6),
      new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.5, metalness: 0.5 }));
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(0, lengthM * 0.055, -lengthM * 0.05);
    g.add(pipe);
  } else {
    for (let i = 0; i < 4; i++) {
      const hatch = new THREE.Mesh(new THREE.BoxGeometry(beam * 0.8, lengthM * 0.02, lengthM * 0.13),
        new THREE.MeshStandardMaterial({ color: 0x5d5148, roughness: 0.8 }));
      hatch.position.set(0, lengthM * 0.052, -lengthM * 0.3 + i * lengthM * 0.17);
      g.add(hatch);
    }
  }
  // Navigation lights: masthead whites + sidelights (night storytelling).
  const lightMat = (c) => new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: c, emissiveIntensity: 0 });
  const lights = [];
  const addL = (c, x, y, z) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.5, lengthM * 0.004), 6, 5), lightMat(c));
    m.position.set(x, y, z); g.add(m); lights.push(m.material);
  };
  addL(0xfff2cf, 0, lengthM * 0.175, -lengthM * 0.42);
  addL(0xfff2cf, 0, lengthM * 0.175, lengthM * 0.38);
  addL(0xff2a1e, -beam * 0.42, lengthM * 0.1, lengthM * 0.36);
  addL(0x1eff6a, beam * 0.42, lengthM * 0.1, lengthM * 0.36);
  lights.push(bridgeBandMat);
  g.userData.lights = lights;
  // Flat churned wake card astern (bright at the stern, fading away).
  const wake = new THREE.Mesh(
    new THREE.PlaneGeometry(beam * 2.7, lengthM * 1.85),
    new THREE.MeshBasicMaterial({
      map: makeWakeTexture(), transparent: true, depthWrite: false, opacity: 0.42,
      color: 0xdff4ff, polygonOffset: true, polygonOffsetFactor: -1,
    }));
  wake.rotation.x = -Math.PI / 2;
  wake.position.set(0, 0.35, lengthM * 0.5 + lengthM * 0.925 - 2);
  wake.renderOrder = 1;
  g.add(wake);
  return g;
}

export class VesselPool {
  constructor(scene, max = 14) {
    this.pool = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    for (let i = 0; i < max; i++) {
      const v = buildVessel(['container', 'bulk', 'tanker'][i % 3], 180 + (i % 5) * 30);
      v.visible = false;
      this.group.add(v);
      this.pool.push(v);
    }
  }
  // items: [{x, z, rotY, type, lengthM, seed}] in ship frame.
  update(items, nightF, seaTime = 0, seaState = 3) {
    const motion = Math.min(1, Math.max(0.12, (seaState - 1) / 7));
    for (let i = 0; i < this.pool.length; i++) {
      const mesh = this.pool[i], it = items[i];
      if (!it) { mesh.visible = false; continue; }
      mesh.visible = true;
      const seed = (it.seed ?? 0.37) * 37;
      mesh.position.set(it.x,
        (Math.sin(seaTime * 0.62 + seed) * 0.45 + Math.sin(seaTime * 1.07 + seed * 1.7) * 0.22) * motion,
        it.z);
      mesh.rotation.set(
        Math.sin(seaTime * 0.54 + seed) * 0.010 * motion,
        it.rotY,
        Math.sin(seaTime * 0.43 + seed * 2.1) * 0.016 * motion);
      const s = it.lengthM / (180 + (i % 5) * 30);
      mesh.scale.setScalar(s);
      for (const m of mesh.userData.lights) m.emissiveIntensity = nightF * 5;
    }
  }
}

function makeCityTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#202a34'; g.fillRect(0, 0, 128, 256);
  let s = 987654;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  for (let y = 10; y < 246; y += 11) for (let x = 7; x < 120; x += 10) {
    if (rnd() < 0.48) continue;
    g.fillStyle = rnd() < 0.82 ? 'rgba(255,196,112,0.95)' : 'rgba(190,220,255,0.9)';
    g.fillRect(x, y, 5, 6);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Solid extruded ridge: a jagged top profile with real depth and side faces,
// so land reads as a mass in fog instead of a vertical cardboard sheet.
function solidRidge(len, height, depth, seed, color) {
  const SEG = 72;
  let s = seed * 7919 + 17;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  let h = 0.42;
  const shape = new THREE.Shape();
  shape.moveTo(-len / 2, -60);
  for (let i = 0; i <= SEG; i++) {
    h = THREE.MathUtils.clamp(h + (rnd() - 0.48) * 0.34, 0.08, 1);
    const endFade = Math.min(1, Math.min(i, SEG - i) / 8);
    shape.lineTo(-len / 2 + (i / SEG) * len, h * endFade * height);
  }
  shape.lineTo(len / 2, -60);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.translate(0, 0, -depth / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color, roughness: 1, metalness: 0, flatShading: true,
  }));
  return mesh;
}

// Layered landmass with a low shore shelf and sparse settlement lights.
export function buildRidge(len, height, seed = 5) {
  const group = new THREE.Group();
  const shore = new THREE.Mesh(new THREE.BoxGeometry(len * 1.05, 9, 2600),
    new THREE.MeshStandardMaterial({ color: 0x2f403a, roughness: 1 }));
  shore.position.y = -2;
  group.add(shore);
  const main = solidRidge(len, height, 2300, seed, 0x2b3f4c);
  group.add(main);
  const back = solidRidge(len * 1.28, height * 1.38, 1700, seed + 31, 0x354b5a);
  back.position.set(len * 0.07, 0, -2300);
  group.add(back);
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0x181d22, emissive: 0xffc98a, emissiveIntensity: 0, roughness: 0.8,
  });
  let s = seed * 104729 + 5;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  for (let i = 0; i < 30; i++) {
    const hut = new THREE.Mesh(new THREE.BoxGeometry(18 + rnd() * 30, 6 + rnd() * 9, 14), glowMat);
    hut.position.set(-len * 0.46 + rnd() * len * 0.92, 6, (rnd() < 0.5 ? -1 : 1) * (1180 + rnd() * 70));
    group.add(hut);
  }
  group.userData.glowMat = glowMat;
  return group;
}

// Container terminal on solid land. Local frame: quay length along X,
// water/ship toward +Z, land, yards, city and hills toward -Z.
export function buildPort(len = 3000) {
  const g = new THREE.Group();
  const land = new THREE.Mesh(new THREE.BoxGeometry(len * 1.25, 10, 1250),
    new THREE.MeshStandardMaterial({ color: 0x35423b, roughness: 1 }));
  land.position.set(0, 1, -690);
  g.add(land);
  const quay = new THREE.Mesh(new THREE.BoxGeometry(len, 10, 235),
    new THREE.MeshStandardMaterial({ color: 0x4b5152, roughness: 0.9 }));
  quay.position.set(0, 3, -20);
  g.add(quay);
  const quayWall = new THREE.Mesh(new THREE.BoxGeometry(len, 14, 8),
    new THREE.MeshStandardMaterial({ color: 0x394047, roughness: 0.95 }));
  quayWall.position.set(0, 0, 100);
  g.add(quayWall);
  const fenderMat = new THREE.MeshStandardMaterial({ color: 0x171b1f, roughness: 0.9 });
  for (let i = 0; i < 24; i++) {
    const fender = new THREE.Mesh(new THREE.BoxGeometry(4, 9, 3), fenderMat);
    fender.position.set(-len / 2 + 70 + i * (len - 140) / 23, 2, 105);
    g.add(fender);
  }
  const hills = solidRidge(len * 1.45, 330, 850, Math.round(len / 37), 0x304654);
  hills.position.set(0, 0, -1320);
  g.add(hills);
  // City skyline between the terminal yards and the hills.
  const cityTex = makeCityTexture();
  const cityMat = new THREE.MeshStandardMaterial({
    color: 0x778492, map: cityTex, emissive: 0xffc98a,
    emissiveMap: cityTex, emissiveIntensity: 0, roughness: 0.85,
  });
  let cs = Math.round(len * 13 + 7);
  const crnd = () => { cs = (cs * 16807) % 2147483647; return (cs - 1) / 2147483646; };
  for (let i = 0; i < 72; i++) {
    const bh = 18 + Math.pow(crnd(), 1.7) * 105;
    const b = new THREE.Mesh(new THREE.BoxGeometry(18 + crnd() * 34, bh, 18 + crnd() * 24), cityMat);
    b.position.set(-len * 0.56 + crnd() * len * 1.12, bh / 2 + 4, -590 - crnd() * 270);
    g.add(b);
  }
  g.userData.cityMat = cityMat;
  // Low warehouses behind the container yards.
  const shedMat = new THREE.MeshStandardMaterial({ color: 0x7d8891, roughness: 0.8, metalness: 0.15 });
  for (let i = 0; i < 6; i++) {
    const shed = new THREE.Mesh(new THREE.BoxGeometry(120 + (i % 3) * 35, 15, 42), shedMat);
    shed.position.set(-len / 2 + 220 + i * (len - 380) / 5, 11, -475);
    g.add(shed);
  }
  const craneMat = new THREE.MeshStandardMaterial({ color: 0xb9c1c9, roughness: 0.5, metalness: 0.5 });
  const n = Math.floor(len / 420);
  for (let i = 0; i < n; i++) {
    const cx = -len / 2 + 260 + i * 420;
    const crane = new THREE.Group();
    for (const [lx, lz] of [[-22, -18], [22, -18], [-22, 18], [22, 18]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(3.4, 68, 3.4), craneMat);
      leg.position.set(lx, 34, lz);
      crane.add(leg);
    }
    for (const lz of [-18, 18]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(48, 4, 4), craneMat);
      beam.position.set(0, 68, lz);
      crane.add(beam);
    }
    for (const lx of [-22, 22]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 40), craneMat);
      beam.position.set(lx, 68, 0);
      crane.add(beam);
      crane.add(rodBetween(new THREE.Vector3(lx, 8, -18), new THREE.Vector3(lx, 62, 18), 0.55, craneMat));
      crane.add(rodBetween(new THREE.Vector3(lx, 8, 18), new THREE.Vector3(lx, 62, -18), 0.55, craneMat));
    }
    const boom = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3.4, 142), craneMat);
    boom.position.set(0, 67, 42);
    crane.add(boom);
    const backreach = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.2, 58), craneMat);
    backreach.position.set(0, 67, -45);
    crane.add(backreach);
    const apex = new THREE.Mesh(new THREE.BoxGeometry(4.4, 24, 4.4), craneMat);
    apex.position.set(0, 79, -8);
    crane.add(apex);
    crane.add(rodBetween(new THREE.Vector3(0, 90, -8), new THREE.Vector3(0, 68, 106), 0.45, craneMat));
    crane.add(rodBetween(new THREE.Vector3(0, 90, -8), new THREE.Vector3(0, 68, -70), 0.45, craneMat));
    const machine = new THREE.Mesh(new THREE.BoxGeometry(16, 10, 18), craneMat);
    machine.position.set(0, 74, -4);
    crane.add(machine);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(5, 4, 5),
      new THREE.MeshStandardMaterial({ color: 0x18212b, roughness: 0.35, metalness: 0.3 }));
    cab.position.set(0, 62, 52);
    crane.add(cab);
    crane.add(rodBetween(new THREE.Vector3(0, 65, 52), new THREE.Vector3(0, 31, 52), 0.16, craneMat));
    const spreader = new THREE.Mesh(new THREE.BoxGeometry(12, 1.5, 2.6), craneMat);
    spreader.position.set(0, 30, 52);
    crane.add(spreader);
    crane.position.set(cx, 6, 42);
    g.add(crane);
  }
  // Yard stacks in rows on the landward apron.
  const cols = [0x2e6da4, 0x1f7a4d, 0xb03a2e, 0xd4851a, 0x707b7c, 0x8c2f39];
  let ys = Math.round(len * 29 + 3);
  const yrnd = () => { ys = (ys * 16807) % 2147483647; return (ys - 1) / 2147483646; };
  for (let i = 0; i < 62; i++) {
    const row = i % 4;
    const w = 48 + yrnd() * 72;
    const hgt = 7 + yrnd() * 11;
    const stack = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, 14),
      new THREE.MeshStandardMaterial({ color: cols[i % cols.length], roughness: 0.65 }));
    stack.position.set(-len / 2 + 100 + yrnd() * (len - 200), 7 + hgt / 2, -150 - row * 62 - yrnd() * 18);
    g.add(stack);
  }
  // Floodlight poles with emissive heads: visible sources for the night glow.
  const glowMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffb45e, emissiveIntensity: 0 });
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x59636b, roughness: 0.6, metalness: 0.45 });
  for (let i = 0; i < 16; i++) {
    const x = -len / 2 + 80 + i * (len - 160) / 15;
    const z = i % 2 ? -125 : 58;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 28, 6), poleMat);
    pole.position.set(x, 20, z);
    g.add(pole);
    const head = new THREE.Mesh(new THREE.SphereGeometry(1.7, 6, 5), glowMat);
    head.position.set(x, 34.5, z);
    g.add(head);
  }
  g.userData.glowMat = glowMat;
  return g;
}
