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

export function buildVessel(type, lengthM) {
  const g = new THREE.Group();
  const beam = Math.max(14, lengthM * 0.14);
  const colors = { container: 0x27384a, bulk: 0x4a2e28, tanker: 0x333a40 };
  g.add(hullMesh(lengthM, beam, lengthM * 0.09, colors[type] || 0x2a3440));
  const white = new THREE.MeshStandardMaterial({ color: 0xdfe4e8, roughness: 0.55, metalness: 0.15 });
  const castle = new THREE.Mesh(new THREE.BoxGeometry(beam * 0.8, lengthM * 0.075, lengthM * 0.09), white);
  castle.position.set(0, lengthM * 0.07, lengthM * 0.38);
  g.add(castle);
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
  addL(0xfff2cf, 0, lengthM * 0.13, -lengthM * 0.42);
  addL(0xfff2cf, 0, lengthM * 0.16, lengthM * 0.38);
  addL(0xff2a1e, -beam * 0.42, lengthM * 0.1, lengthM * 0.36);
  addL(0x1eff6a, beam * 0.42, lengthM * 0.1, lengthM * 0.36);
  g.userData.lights = lights;
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
  // items: [{x, z, rotY, type, lengthM}] in ship frame.
  update(items, nightF) {
    for (let i = 0; i < this.pool.length; i++) {
      const mesh = this.pool[i], it = items[i];
      if (!it) { mesh.visible = false; continue; }
      mesh.visible = true;
      mesh.position.set(it.x, 0, it.z);
      mesh.rotation.y = it.rotY;
      const s = it.lengthM / (180 + (i % 5) * 30);
      mesh.scale.setScalar(s);
      for (const m of mesh.userData.lights) m.emissiveIntensity = nightF * 6;
    }
  }
}

// Distant land ridge: a jagged silhouette wall that fog melts into the sky.
export function buildRidge(len, height, seed = 5) {
  const SEG = 90;
  const geo = new THREE.PlaneGeometry(len, 1, SEG, 1);
  const posA = geo.getAttribute('position');
  let h = 0.4;
  const heights = [];
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  for (let i = 0; i <= SEG; i++) {
    h = THREE.MathUtils.clamp(h + (rnd() - 0.48) * 0.35, 0.08, 1);
    const endFade = Math.min(1, Math.min(i, SEG - i) / 7);
    heights.push(h * endFade);
  }
  for (let i = 0; i <= SEG; i++) {
    posA.setY(i, heights[i] * height);                    // top row
    posA.setY(i + SEG + 1, -40);                          // bottom row under sea
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0x2c3e4a, roughness: 1, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.material.side = THREE.DoubleSide;
  return mesh;
}

// Container terminal: quay + ship-to-shore gantry cranes + box stacks + glow.
export function buildPort(len = 3000) {
  const g = new THREE.Group();
  const quay = new THREE.Mesh(new THREE.BoxGeometry(len, 7, 190),
    new THREE.MeshStandardMaterial({ color: 0x4b5152, roughness: 0.9 }));
  quay.position.y = 2.5;
  g.add(quay);
  const craneMat = new THREE.MeshStandardMaterial({ color: 0xb9c1c9, roughness: 0.5, metalness: 0.5 });
  const n = Math.floor(len / 420);
  for (let i = 0; i < n; i++) {
    const cx = -len / 2 + 260 + i * 420;
    const crane = new THREE.Group();
    for (const [lx, lz] of [[-22, -18], [22, -18], [-22, 18], [22, 18]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(2.6, 68, 2.6), craneMat);
      leg.position.set(lx, 34, lz);
      crane.add(leg);
    }
    const boom = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.2, 130), craneMat);
    boom.position.set(0, 66, -40);
    crane.add(boom);
    const apex = new THREE.Mesh(new THREE.BoxGeometry(4, 22, 4), craneMat);
    apex.position.set(0, 76, 8);
    crane.add(apex);
    crane.position.x = cx;
    g.add(crane);
  }
  // Yard stacks.
  const cols = [0x2e6da4, 0x1f7a4d, 0xb03a2e, 0xd4851a, 0x707b7c, 0x8c2f39];
  for (let i = 0; i < 26; i++) {
    const w = 60 + (i % 4) * 22;
    const stack = new THREE.Mesh(new THREE.BoxGeometry(w, 8 + (i % 3) * 3.2, 14),
      new THREE.MeshStandardMaterial({ color: cols[i % cols.length], roughness: 0.65 }));
    stack.position.set(-len / 2 + 120 + i * (len - 200) / 26, 9, 55 + (i % 3) * 26);
    g.add(stack);
  }
  // Sodium floodlight dots (emissive at night via shared material).
  const glowMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffb45e, emissiveIntensity: 0 });
  for (let i = 0; i < 20; i++) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(1.6, 6, 5), glowMat);
    dot.position.set(-len / 2 + 80 + i * (len - 140) / 20, 24 + (i % 3) * 5, -40);
    g.add(dot);
  }
  g.userData.glowMat = glowMat;
  return g;
}
