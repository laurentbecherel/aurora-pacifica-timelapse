// ULCS container ship built from lofted/extruded forms + instanced boxes.
// Forward = -Z (bow), stern +Z. Waterline y=0, main deck y=22, bridge y~48.
import * as THREE from 'three/webgpu';
import { mulberry32 } from '../sim/traffic.js';

export const SHIP = { len: 330, beam: 60, deckY: 22, bridgeY: 47.5, bridgeZ: 120 };

// ---- Canvas textures -------------------------------------------------------
export function makeContainerTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#c9ccce'; g.fillRect(0, 0, 512, 256);
  // Corrugation: vertical ribs with highlight/shadow pairs.
  for (let x = 6; x < 512; x += 22) {
    g.fillStyle = 'rgba(0,0,0,0.32)'; g.fillRect(x, 8, 7, 240);
    g.fillStyle = 'rgba(255,255,255,0.28)'; g.fillRect(x + 7, 8, 4, 240);
  }
  // Frame, top rail and door locking rods.
  g.strokeStyle = 'rgba(30,32,36,0.55)'; g.lineWidth = 7; g.strokeRect(3, 3, 506, 250);
  g.fillStyle = 'rgba(30,32,36,0.35)';
  for (const x of [60, 190, 320, 450]) g.fillRect(x, 10, 6, 236);
  // Markings: near-white so instance tint reads as weathered livery.
  g.fillStyle = 'rgba(245,247,250,0.92)';
  g.font = 'bold 44px system-ui, sans-serif';
  g.fillText('TRANS-OCEANIC', 26, 64);
  g.font = '24px ui-monospace, monospace';
  g.fillText('TOLU 481 206 7 · 42G1', 26, 104);
  g.font = '18px ui-monospace, monospace';
  g.fillText('MAX GROSS 30480 KG', 26, 222);
  g.fillText('TARE 3750 KG', 26, 242);
  // Rust streaks and grime.
  const rnd = mulberry32(42);
  for (let i = 0; i < 26; i++) {
    const x = rnd() * 512, y = rnd() * 90, len = 30 + rnd() * 120;
    const grad = g.createLinearGradient(0, y, 0, y + len);
    grad.addColorStop(0, 'rgba(122,74,42,0.34)'); grad.addColorStop(1, 'rgba(122,74,42,0)');
    g.fillStyle = grad; g.fillRect(x, y, 3 + rnd() * 5, len);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4; tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makePlateTexture(repeatX = 1, repeatY = 1) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#8f979e'; g.fillRect(0, 0, 256, 256);
  const rnd = mulberry32(7);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(${rnd() > 0.5 ? '255,255,255' : '10,12,14'},${0.05 + rnd() * 0.07})`;
    g.fillRect(rnd() * 256, rnd() * 256, 2 + rnd() * 5, 1 + rnd() * 3);
  }
  g.strokeStyle = 'rgba(20,22,26,0.30)'; g.lineWidth = 2;
  for (let x = 0; x <= 256; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); }
  for (let y = 0; y <= 256; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(repeatX, repeatY);
  return tex;
}

function makeNameTexture(text, sub = '', dark = false) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = sub ? 192 : 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = dark ? 'rgba(24,34,46,0.94)' : 'rgba(240,246,250,0.94)';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '700 72px system-ui, sans-serif';
  g.fillText(text, 512, sub ? 62 : 64);
  if (sub) {
    g.font = '500 42px system-ui, sans-serif';
    g.fillText(sub, 512, 138);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4; tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const CONTAINER_COLORS = [
  0x9db8c4, 0x2e6da4, 0x1f7a4d, 0xb03a2e, 0xd4851a, 0x707b7c,
  0x2456a6, 0x8c2f39, 0x2f4858, 0xc8c2b4, 0x11697a, 0x7a4a21,
].map((h) => new THREE.Color(h));

// Hull plan outline (top view) extruded vertically.
// Shape: bow at +Y, stern at -Y; rotateX(-90 deg) maps shape Y -> world -Z,
// so the bow ends up at -Z (forward) and extrusion depth becomes +Y.
function hullGeometry(yBot, yTop, scaleXZ = 1) {
  const s = new THREE.Shape();
  const hb = (SHIP.beam / 2) * scaleXZ, L = (SHIP.len / 2) * scaleXZ;
  s.moveTo(-hb * 0.62, -L);                   // transom (stern)
  s.lineTo(hb * 0.62, -L);
  s.lineTo(hb, -L * 0.72);
  s.lineTo(hb, L * 0.45);
  s.quadraticCurveTo(hb, L * 0.85, hb * 0.30, L * 0.985);
  s.quadraticCurveTo(0, L * 1.0, -hb * 0.30, L * 0.985); // bow point
  s.quadraticCurveTo(-hb, L * 0.85, -hb, L * 0.45);
  s.lineTo(-hb, -L * 0.72);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: yTop - yBot, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, yBot, 0);
  return geo;
}

export function buildShip() {
  const group = new THREE.Group();
  const plateTex = makePlateTexture(3, 2);
  const hullTex = makePlateTexture(0.018, 0.05);
  const steel = (color, rough = 0.55, metal = 0.35) => new THREE.MeshStandardMaterial({
    color, roughness: rough, metalness: metal, map: plateTex,
  });
  const plain = (color, rough = 0.6, metal = 0.2) => new THREE.MeshStandardMaterial({
    color, roughness: rough, metalness: metal,
  });

  // Hull + red boot-top below the waterline.
  const hullMat = new THREE.MeshStandardMaterial({
    color: 0x3b4f61, roughness: 0.44, metalness: 0.34, map: hullTex,
  });
  const hull = new THREE.Mesh(hullGeometry(-8, SHIP.deckY), hullMat);
  group.add(hull);
  // Ship's name on both bows and across the transom.
  const nameMat = new THREE.MeshStandardMaterial({
    map: makeNameTexture('AURORA PACIFICA'), transparent: true,
    roughness: 0.55, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -2,
  });
  for (const sx of [-30.18, 30.18]) {
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(34, 3.6), nameMat);
    plate.rotation.y = sx < 0 ? -Math.PI / 2 : Math.PI / 2;
    plate.position.set(sx, 16.8, -62);
    group.add(plate);
  }
  const sternName = new THREE.Mesh(new THREE.PlaneGeometry(30, 5.6),
    new THREE.MeshStandardMaterial({
      map: makeNameTexture('AURORA PACIFICA', 'MONROVIA'), transparent: true,
      roughness: 0.55, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -2,
    }));
  sternName.position.set(0, 15.5, 165.25);
  group.add(sternName);
  const boot = new THREE.Mesh(hullGeometry(-8.5, 1.6, 1.012), plain(0x6e2a20, 0.72, 0.1));
  group.add(boot);
  // Deck surface.
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(SHIP.beam - 1.2, 0.5, 272),
    steel(0x3d4a42, 0.8, 0.15));
  deck.position.set(0, SHIP.deckY + 0.2, -14);
  group.add(deck);
  // Forecastle (raised bow deck) + windlass gear.
  const fc = new THREE.Mesh(new THREE.BoxGeometry(34, 2.4, 30), steel(0x36424c, 0.7));
  fc.position.set(0, SHIP.deckY + 1.4, -141);
  group.add(fc);
  for (const sx of [-9, 9]) {
    const winch = new THREE.Mesh(new THREE.BoxGeometry(6, 2.2, 4), plain(0x59636b, 0.6, 0.5));
    winch.position.set(sx, SHIP.deckY + 3.6, -146);
    group.add(winch);
  }
  // Bow mast.
  const mastMat = plain(0xd8dcdf, 0.45, 0.4);
  const bowMast = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 13, 8), mastMat);
  bowMast.position.set(0, SHIP.deckY + 8, -156);
  group.add(bowMast);

  // ---- Containers (instanced) ---------------------------------------------
  const contTex = makeContainerTexture();
  const contMat = new THREE.MeshStandardMaterial({
    map: contTex, roughness: 0.58, metalness: 0.28,
  });
  const contGeo = new THREE.BoxGeometry(2.44, 2.59, 12.19);
  const rnd = mulberry32(20170814);
  const bays = [];
  for (let z = -132; z <= 96; z += 12.9) bays.push(z);
  const rows = [];
  for (let x = -23.4; x <= 23.4; x += 2.92) rows.push(x);
  const placements = [];
  for (const z of bays) {
    const bowTaper = THREE.MathUtils.clamp((z + 150) / 40, 0.35, 1);
    const aftTaper = THREE.MathUtils.clamp(1 - Math.max(0, z - 55) / 110, 0.42, 1);
    for (const x of rows) {
      const edge = 1 - Math.pow(Math.abs(x) / 26, 3) * 0.55;
      const tiers = Math.max(2, Math.round((4 + rnd() * 4.5) * bowTaper * aftTaper * edge));
      for (let t = 0; t < tiers; t++) {
        if (rnd() < 0.07) continue; // empty slot
        placements.push({ x, z: z + (rnd() - 0.5) * 0.12, tier: t, c: Math.floor(rnd() * CONTAINER_COLORS.length) });
      }
    }
  }
  const inst = new THREE.InstancedMesh(contGeo, contMat, placements.length);
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  placements.forEach((p, i) => {
    m4.makeTranslation(p.x, SHIP.deckY + 1.65 + p.tier * 2.62, p.z);
    inst.setMatrixAt(i, m4);
    col.copy(CONTAINER_COLORS[p.c]).multiplyScalar(0.95 + rnd() * 0.28);
    inst.setColorAt(i, col);
  });
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  group.add(inst);

  // Hatch-coaming rails between bays (cheap long boxes).
  for (const sx of [-27.5, 27.5]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 252), plain(0x9aa2a8, 0.55, 0.5));
    rail.position.set(sx, SHIP.deckY + 1.0, -12);
    group.add(rail);
  }
  // Transverse hatch beams in the gaps between bays.
  const hatchMat = steel(0x46545a, 0.75, 0.2);
  for (let i = 0; i < bays.length - 1; i++) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(54, 0.9, 0.55), hatchMat);
    beam.position.set(0, SHIP.deckY + 0.85, (bays[i] + bays[i + 1]) / 2);
    group.add(beam);
  }
  // Bulwarks, stanchions and mooring bollards give the deck edge its rhythm.
  for (const sx of [-29.55, 29.55]) {
    const bulwark = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.7, 272), steel(0x31404d, 0.62, 0.3));
    bulwark.position.set(sx, SHIP.deckY + 1.05, -14);
    group.add(bulwark);
  }
  const stanchion = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.18, 1.5, 0.18), plain(0x8d979f, 0.55, 0.5), 48);
  const bollard = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.42, 0.5, 1.0, 8), plain(0x252c33, 0.6, 0.45), 16);
  {
    let si = 0, bi = 0;
    const m = new THREE.Matrix4();
    for (let i = 0; i < 24; i++) for (const sx of [-29.55, 29.55]) {
      m.makeTranslation(sx, SHIP.deckY + 0.95, -138 + i * 11.5);
      stanchion.setMatrixAt(si++, m);
    }
    for (let i = 0; i < 8; i++) for (const sx of [-27.8, 27.8]) {
      m.makeTranslation(sx, SHIP.deckY + 0.7, -126 + i * 36);
      bollard.setMatrixAt(bi++, m);
    }
    stanchion.instanceMatrix.needsUpdate = true;
    bollard.instanceMatrix.needsUpdate = true;
  }
  group.add(stanchion, bollard);
  // Mushroom ventilators fore and aft.
  for (const [vx, vz] of [[-12, -136], [12, -136], [-14, 112], [14, 112]]) {
    const vent = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 3.2, 10), plain(0xaab3ba, 0.55, 0.35));
    stem.position.y = 1.6;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.55, 1.1, 12), plain(0x8d979f, 0.55, 0.35));
    cap.position.y = 3.6;
    vent.add(stem, cap);
    vent.position.set(vx, SHIP.deckY + 0.4, vz);
    group.add(vent);
  }

  // ---- Superstructure (aft castle) ----------------------------------------
  const white = plain(0xd9dee3, 0.62, 0.08);
  const castle = new THREE.Mesh(new THREE.BoxGeometry(38, 20, 26), white);
  castle.position.set(0, SHIP.deckY + 10, 133);
  group.add(castle);
  const castleTop = new THREE.Mesh(new THREE.BoxGeometry(32, 7, 20), white);
  castleTop.position.set(0, SHIP.deckY + 23.5, 134);
  group.add(castleTop);
  // Bridge deck built from slabs so the bridge camera sits in real space:
  // floor, roof, back wall, wing-tip walls, single-sided glass planes.
  const bFloor = new THREE.Mesh(new THREE.BoxGeometry(59, 0.5, 10.5), white);
  bFloor.position.set(0, SHIP.bridgeY - 1.7, 124);
  group.add(bFloor);
  const bRoof = new THREE.Mesh(new THREE.BoxGeometry(59, 0.6, 10.5), white);
  bRoof.position.set(0, SHIP.bridgeY + 2.9, 124);
  group.add(bRoof);
  const bBack = new THREE.Mesh(new THREE.BoxGeometry(59, 4.6, 0.5), white);
  bBack.position.set(0, SHIP.bridgeY + 0.6, 129);
  group.add(bBack);
  for (const sx of [-29.3, 29.3]) {
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4.6, 10.5), white);
    tip.position.set(sx, SHIP.bridgeY + 0.6, 124);
    group.add(tip);
  }
  const sill = new THREE.Mesh(new THREE.BoxGeometry(59, 0.9, 0.4), white);
  sill.position.set(0, SHIP.bridgeY - 1.15, 119.05);
  group.add(sill);
  // Window band: planes facing outward only (invisible from inside).
  const bridgeGlassMat = new THREE.MeshStandardMaterial({
    color: 0x10161e, roughness: 0.12, metalness: 0.6,
    emissive: 0xffb45e, emissiveIntensity: 0, side: THREE.FrontSide,
  });
  const glassF = new THREE.Mesh(new THREE.PlaneGeometry(58.4, 2.5), bridgeGlassMat);
  glassF.rotation.y = Math.PI;
  glassF.position.set(0, SHIP.bridgeY + 0.55, 119.0);
  group.add(glassF);
  for (const sx of [-29.55, 29.55]) {
    const glassS = new THREE.Mesh(new THREE.PlaneGeometry(10.2, 2.5), bridgeGlassMat);
    glassS.rotation.y = sx < 0 ? -Math.PI / 2 : Math.PI / 2;
    glassS.position.set(sx, SHIP.bridgeY + 0.55, 124);
    group.add(glassS);
  }
  // Accommodation window rows (small emissive-capable strips).
  const cabinMat = new THREE.MeshStandardMaterial({
    color: 0x1a212b, roughness: 0.3, metalness: 0.3,
    emissive: 0xffc98a, emissiveIntensity: 0,
  });
  for (let i = 0; i < 4; i++) {
    const y = SHIP.deckY + 4.5 + i * 4.6;
    const front = new THREE.Mesh(new THREE.BoxGeometry(36, 1.0, 0.25), cabinMat);
    front.position.set(0, y, 119.82);
    group.add(front);
    for (const sx of [-19.12, 19.12]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.0, 22), cabinMat);
      side.position.set(sx, y, 133);
      group.add(side);
    }
  }
  // Roof plant on the bridge top.
  for (const sx of [-10, 10]) {
    const ac = new THREE.Mesh(new THREE.BoxGeometry(5, 1.4, 3), plain(0x9aa2a8, 0.6, 0.3));
    ac.position.set(sx, SHIP.bridgeY + 3.9, 126);
    group.add(ac);
  }
  // Funnel with company band.
  const funnel = new THREE.Mesh(new THREE.BoxGeometry(9, 13, 14), plain(0x2b3440, 0.55, 0.3));
  funnel.position.set(0, SHIP.deckY + 17, 154);
  group.add(funnel);
  const funnelBand = new THREE.Mesh(new THREE.BoxGeometry(9.3, 3.4, 14.3), plain(0x2e6da4, 0.5, 0.2));
  funnelBand.position.set(0, SHIP.deckY + 21.5, 154);
  group.add(funnelBand);
  const funnelCap = new THREE.Mesh(new THREE.BoxGeometry(8.6, 1.0, 13.4), plain(0x11151a, 0.8, 0.1));
  funnelCap.position.set(0, SHIP.deckY + 24.0, 154);
  group.add(funnelCap);
  for (const px of [-2.2, 2.2]) {
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 2.2, 8), plain(0x3a424a, 0.5, 0.5));
    exhaust.position.set(px, SHIP.deckY + 25.2, 154);
    group.add(exhaust);
  }
  // Main mast + rotating radar.
  const mainMast = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 12, 8), mastMat);
  mainMast.position.set(0, SHIP.bridgeY + 8.5, 126);
  group.add(mainMast);
  const radar = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.28, 0.5), mastMat);
  radar.position.set(0, SHIP.bridgeY + 11.6, 126);
  group.add(radar);
  for (const sx of [-3.5, 3.5]) {
    const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 6, 5), mastMat);
    whip.position.set(sx, SHIP.bridgeY + 6, 127);
    group.add(whip);
  }
  // Lifeboats (orange davits blocks).
  for (const sx of [-20.5, 20.5]) {
    const boat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.4, 8.5), plain(0xd4631a, 0.55, 0.1));
    boat.position.set(sx, SHIP.deckY + 15.5, 133);
    group.add(boat);
  }

  // ---- Bridge interior (visible only from the bridge camera) --------------
  const interior = new THREE.Group();
  const darkTrim = plain(0x252c36, 0.85, 0.05);
  for (const px of [-26, -20, -14, -8.5, -3.2, 3.2, 8.5, 14, 20, 26]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.36, 3.4, 0.3), darkTrim);
    pillar.position.set(px, SHIP.bridgeY + 0.55, 119.35);
    interior.add(pillar);
  }
  const header = new THREE.Mesh(new THREE.BoxGeometry(54, 0.85, 0.4), darkTrim);
  header.position.set(0, SHIP.bridgeY + 2.25, 119.35);
  interior.add(header);
  const dash = new THREE.Mesh(new THREE.BoxGeometry(20, 0.9, 1.8), darkTrim);
  dash.position.set(0, SHIP.bridgeY - 1.45, 119.95);
  dash.rotation.x = 0.22;
  interior.add(dash);
  const monitorMat = new THREE.MeshStandardMaterial({
    color: 0x0a141c, roughness: 0.4, emissive: 0x2e7fb8, emissiveIntensity: 0.7,
  });
  for (const mx of [-4.4, -1.5, 1.5, 4.4]) {
    const mon = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 0.14), monitorMat);
    mon.position.set(mx, SHIP.bridgeY - 0.85, 120.05);
    mon.rotation.x = -0.35;
    interior.add(mon);
  }
  interior.visible = false;
  group.add(interior);

  // ---- Navigation lights ---------------------------------------------------
  const navMats = {};
  const addNav = (name, colorHex, x, y, z, s = 0.34) => {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x111111, emissive: colorHex, emissiveIntensity: 0,
    });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(s, 10, 8), mat);
    bulb.position.set(x, y, z);
    group.add(bulb);
    navMats[name] = mat;
  };
  addNav('mastFwd', 0xfff2cf, 0, SHIP.deckY + 14.8, -156);
  addNav('mastMain', 0xfff2cf, 0, SHIP.bridgeY + 14.6, 126);
  addNav('port', 0xff2a1e, -29.8, SHIP.bridgeY + 1.4, 122);
  addNav('stbd', 0x1eff6a, 29.8, SHIP.bridgeY + 1.4, 122);
  addNav('stern', 0xfff2cf, 0, SHIP.deckY + 5.5, 164);
  // Deck floodlight masts: visible poles whose heads carry the night glow,
  // placed where main.js anchors its three warm point lights.
  const floodMat = new THREE.MeshStandardMaterial({
    color: 0x222222, emissive: 0xffd9a0, emissiveIntensity: 0,
  });
  for (const fz of [-95, -25, 45]) {
    for (const sx of [-27, 27]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 12, 6), plain(0x8d979f, 0.55, 0.5));
      pole.position.set(sx, SHIP.deckY + 6.2, fz);
      group.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.45, 0.7), floodMat);
      head.position.set(sx, SHIP.deckY + 12.3, fz);
      group.add(head);
    }
  }

  group.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return {
    group, radar, interior,
    mats: { bridgeGlassMat, cabinMat, monitorMat, floodMat, navMats },
    containerCount: placements.length,
  };
}

