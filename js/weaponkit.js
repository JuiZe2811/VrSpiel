import * as THREE from 'three';
import { MAT, prof, box, cylZ, cylY, cylX, sphere, cachedGeo } from './util.js?v=18';
import { WEAPON_DEFS, WEAPON_ORDER, BUILDERS, scopeKit, makeCartridge } from './weapons.js?v=18';

// =============================================================================
// Waffen-Baukasten: 12 weitere Waffen aus Parametern + Sondermodelle
// (Design-Koordinaten wie in weapons.js: s = vorwärts, y = oben, Griff ungefähr bei s = 0)
// =============================================================================
const M = {
  od: new THREE.MeshStandardMaterial({ color: 0x4b5134, roughness: 0.75, metalness: 0.1 }),
  fde: new THREE.MeshStandardMaterial({ color: 0x9a8662, roughness: 0.8, metalness: 0.05 }),
  gray: new THREE.MeshStandardMaterial({ color: 0x3b3f45, roughness: 0.55, metalness: 0.5 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xcfd4da, roughness: 0.12, metalness: 1.0 }),
  darkwood: new THREE.MeshStandardMaterial({ color: 0x5a3418, roughness: 0.5 }),
  white: new THREE.MeshStandardMaterial({ color: 0xe8ecef, roughness: 0.35, metalness: 0.2 }),
  glow: new THREE.MeshStandardMaterial({ color: 0x2aff6a, emissive: 0x22ff66, emissiveIntensity: 1.6, roughness: 0.3, toneMapped: false })
};
export const KIT_MATERIALS = M;

// ---- Magazine -----------------------------------------------------------------
function cartridgeOnTop(g, y = 0.003) {
  const c = makeCartridge();
  c.rotation.x = -Math.PI / 2;
  c.position.set(0, y, 0);
  g.add(c);
}
// gerades Magazin: Ursprung = Oberkante
function straightMag(w, h, d, mat = MAT.steel, base = MAT.polymer) {
  const g = new THREE.Group();
  g.add(box(w, h, d, mat, 0, -h / 2));
  g.add(box(w + 0.004, 0.01, d + 0.006, base, 0, -h - 0.004));
  cartridgeOnTop(g);
  return g;
}
// gebogenes Magazin aus drei schräg gesetzten Teilen
function curvedMag(w, h, d, mat = MAT.steel) {
  const g = new THREE.Group();
  const seg = h / 3;
  let y = 0, s = 0;
  for (let i = 0; i < 3; i++) {
    const p = box(w, seg + 0.004, d, mat, s, y - seg / 2);
    p.rotation.x = -0.12 * i;
    g.add(p);
    y -= seg * Math.cos(0.12 * i);
    s += seg * Math.sin(0.12 * i);
  }
  g.add(box(w + 0.004, 0.01, d + 0.006, MAT.polymer, s + 0.01, y - 0.004));
  cartridgeOnTop(g);
  return g;
}
// Trommel: kurzer Hals + runde Trommel
function drumMag() {
  const g = new THREE.Group();
  g.add(box(0.022, 0.05, 0.032, MAT.steel, 0, -0.025));
  const drum = cylX(0.055, 0.045, MAT.black, 0, -0.095, 0, 24);
  g.add(drum);
  g.add(cylX(0.02, 0.05, M.gray, 0, -0.095, 0, 16));
  cartridgeOnTop(g);
  return g;
}
// Munitionskasten des MG
function boxMag() {
  const g = new THREE.Group();
  g.add(box(0.03, 0.03, 0.05, MAT.steel, 0, -0.015));
  g.add(box(0.075, 0.1, 0.13, M.od, 0, -0.08));
  g.add(box(0.077, 0.012, 0.132, MAT.black, 0, -0.035));
  cartridgeOnTop(g);
  return g;
}
// Energiezelle des Plasmawerfers
function cellMag() {
  const g = new THREE.Group();
  g.add(cylY(0.018, 0.018, 0.09, M.glow, 0, -0.05, 0, 16));
  g.add(cylY(0.021, 0.021, 0.012, MAT.steel, 0, -0.004, 0, 16));
  g.add(cylY(0.021, 0.021, 0.012, MAT.steel, 0, -0.098, 0, 16));
  return g;
}

// ---- Langwaffen-Bauplan -------------------------------------------------------
// o: { recLen, hgLen, barrel, bore, body, furniture, hg: 'rail'|'wood'|'tube'|'pump', stock: 'fixed'|'wood'|'folding'|'none',
//      sight: 'iron'|'reddot'|'scope'|'bead', action: 'charge'|'bolt'|'pump', vgrip, bipod, carry, magS }
function longGun(m, P, sock, o) {
  const body = o.body || MAT.steel, furn = o.furniture || MAT.polymer;
  const r0 = -0.11, r1 = o.recLen ?? 0.2;
  const by = o.bore ?? 0.05;
  const magS = o.magS ?? 0.1;
  // Gehäuse
  m.add(prof([[r0, 0.022], [r1, 0.022], [r1, 0.072], [r0 + 0.02, 0.072], [r0, 0.062]], 0.042, body, 0.002));
  m.add(prof([[magS - 0.05, 0.024], [magS + 0.035, 0.024], [magS + 0.035, -0.004], [magS - 0.03, -0.004], [magS - 0.05, 0.01]], 0.038, furn, 0.002));
  m.add(box(0.003, 0.016, 0.05, MAT.black, 0.04, 0.05, 0.0215)); // Auswurffenster
  if (o.rail !== false) {
    m.add(box(0.022, 0.006, r1 - r0 - 0.03, MAT.steel, (r0 + r1) / 2, 0.075));
    for (let s = r0 + 0.02; s < r1 - 0.02; s += 0.016) m.add(box(0.0225, 0.003, 0.004, MAT.black, s, 0.077));
  }
  // Griff, Abzug, Bügel
  m.add(prof([[-0.032, 0.024], [0.012, 0.024], [0.0, -0.078], [-0.048, -0.072], [-0.046, -0.01]], 0.03, o.gripMat || MAT.grip, 0.003));
  m.add(box(0.012, 0.004, 0.06, MAT.polymer, 0.028, -0.006));
  const trig = box(0.006, 0.018, 0.005, MAT.steel, 0.03, 0.008);
  trig.rotation.x = 0.25;
  m.add(trig);
  // Handschutz bzw. Pumpe
  const h0 = r1, h1 = r1 + (o.hgLen ?? 0.2);
  const hgGroup = new THREE.Group();
  m.add(hgGroup);
  if (o.hg === 'wood' || o.hg === 'pump') {
    hgGroup.add(prof([[h0, 0.016], [h1, 0.02], [h1, 0.068], [h0, 0.072]], 0.046, o.hg === 'pump' ? MAT.wood : furn === MAT.wood ? MAT.wood : M.darkwood, 0.007));
  } else if (o.hg === 'tube') {
    hgGroup.add(cylZ(0.022, 0.022, h1 - h0, furn, (h0 + h1) / 2, by, 0, 14));
    for (let s = h0 + 0.02; s < h1 - 0.02; s += 0.03) hgGroup.add(box(0.046, 0.008, 0.012, MAT.black, s, by));
  } else {
    hgGroup.add(prof([[h0, 0.018], [h1, 0.02], [h1, 0.068], [h0, 0.072]], 0.04, furn, 0.003));
    for (let s = h0 + 0.025; s < h1 - 0.02; s += 0.035) hgGroup.add(box(0.0405, 0.008, 0.02, MAT.black, s, 0.045));
    hgGroup.add(box(0.02, 0.006, h1 - h0 - 0.02, MAT.steel, (h0 + h1) / 2, 0.071));
  }
  // Lauf + Mündung
  const bl = o.barrel ?? 0.12;
  m.add(cylZ(0.009, 0.01, bl, MAT.steel, h1 + bl / 2, by, 0, 16));
  m.add(cylZ(0.013, 0.013, 0.04, MAT.blued, h1 + bl + 0.02, by, 0, 6));
  m.add(cylZ(0.006, 0.006, 0.041, MAT.black, h1 + bl + 0.02, by));
  const muzzleS = h1 + bl + 0.042;
  // Schaft
  if (o.stock === 'fixed' || o.stock === 'wood') {
    const mat = o.stock === 'wood' ? MAT.wood : furn;
    m.add(prof([[r0, 0.07], [r0, 0.02], [r0 - 0.04, 0.0], [r0 - 0.29, -0.025], [r0 - 0.31, -0.025], [r0 - 0.31, 0.072], [r0 - 0.05, 0.075]], 0.04, mat, 0.005));
    m.add(box(0.042, 0.1, 0.014, MAT.rubber, r0 - 0.317, 0.024));
  } else if (o.stock === 'folding') {
    for (const x of [0.014, -0.014]) m.add(cylZ(0.005, 0.005, 0.2, MAT.steel, r0 - 0.1, 0.05, x, 10));
    m.add(cylZ(0.005, 0.005, 0.2, MAT.steel, r0 - 0.1, 0.02, 0, 10));
    m.add(prof([[r0 - 0.215, 0.075], [r0 - 0.195, 0.075], [r0 - 0.195, -0.005], [r0 - 0.215, -0.005]], 0.045, furn, 0.004));
  }
  // Tragegriff (MG)
  if (o.carry) { m.add(box(0.012, 0.04, 0.012, MAT.steel, r1 - 0.06, 0.095)); m.add(box(0.012, 0.012, 0.1, MAT.black, r1 - 0.06, 0.115)); }
  // Zweibein
  if (o.bipod) { for (const x of [0.012, -0.012]) m.add(cylZ(0.004, 0.004, 0.16, MAT.steel, h1 - 0.08, 0.008, x, 8)); }
  // Vordergriff
  const fgS = (h0 + h1) / 2;
  if (o.vgrip) { m.add(cylY(0.015, 0.017, 0.08, MAT.grip, fgS, -0.02)); m.add(box(0.02, 0.008, 0.035, MAT.steel, fgS, 0.017)); }
  // Visier
  const sightY = 0.092;
  if (o.sight === 'scope') {
    m.add(box(0.02, 0.025, 0.012, MAT.steel, (r0 + r1) / 2 - 0.05, 0.085));
    m.add(box(0.02, 0.025, 0.012, MAT.steel, (r0 + r1) / 2 + 0.08, 0.085));
    scopeKit(m, P, sock, (r0 + r1) / 2 + 0.02, 0.105);
  } else if (o.sight === 'reddot') {
    const s0 = (r0 + r1) / 2;
    m.add(box(0.02, 0.014, 0.04, MAT.steel, s0, 0.083));
    m.add(cylZ(0.019, 0.019, 0.055, new THREE.MeshStandardMaterial({ color: 0x1d2330, metalness: 0.9, roughness: 0.3, side: THREE.DoubleSide }), s0, 0.106, 0, 28, true));
    m.add(cylZ(0.0195, 0.0195, 0.006, MAT.black, s0 - 0.025, 0.106, 0, 28, true));
    m.add(cylZ(0.0195, 0.0195, 0.006, MAT.black, s0 + 0.025, 0.106, 0, 28, true));
    const lens = new THREE.Mesh(cachedGeo('dotlens', () => new THREE.CircleGeometry(0.0175, 28)), MAT.glass);
    lens.position.set(0, 0.106, -(s0 + 0.026));
    m.add(lens);
    sock('sightRear', s0 - 0.03, 0.106);
    sock('sightFront', s0 + 0.03, 0.106);
    sock('dotLens', s0 + 0.026, 0.106);
  } else {
    // Kimme und Korn (bzw. Perlkorn)
    m.add(box(0.005, 0.012, 0.008, MAT.black, r0 + 0.03, sightY - 0.006, 0.005));
    m.add(box(0.005, 0.012, 0.008, MAT.black, r0 + 0.03, sightY - 0.006, -0.005));
    m.add(box(0.004, 0.024, 0.006, MAT.black, h1 - 0.01, by + 0.024));
    m.add(sphere(0.0025, o.sight === 'bead' ? MAT.dotOrange : MAT.dotGreen, h1 - 0.012, sightY + 0.002));
    sock('sightRear', r0 + 0.03, sightY + 0.003);
    sock('sightFront', h1 - 0.01, sightY + 0.003);
  }
  // Verschluss
  const ch = new THREE.Group();
  m.add(ch);
  P.charger = o.action === 'pump' ? hgGroup : ch;
  if (o.action === 'bolt') {
    ch.add(cylZ(0.011, 0.011, 0.1, MAT.bright, 0.0, 0.05, 0, 14));
    const lever = box(0.04, 0.006, 0.008, MAT.bright, -0.03, 0.042, 0.034);
    lever.rotation.z = -0.45;
    ch.add(lever);
    ch.add(sphere(0.009, MAT.black, -0.03, 0.03, 0.054));
    sock('chargerGrab', -0.03, 0.03, 0.054);
  } else if (o.action === 'pump') {
    sock('chargerGrab', fgS, 0.03);
  } else {
    ch.add(box(0.012, 0.008, 0.03, MAT.steel, r0 + 0.005, 0.066));
    ch.add(box(0.05, 0.01, 0.012, MAT.steel, r0 - 0.01, 0.066));
    sock('chargerGrab', r0 - 0.01, 0.066);
  }
  // Feuerwahlhebel
  const sel = new THREE.Group();
  sel.position.set(-0.0225, 0.038, 0.005);
  sel.add(box(0.003, 0.004, 0.02, MAT.bright, -0.008, 0));
  m.add(sel);
  P.selector = sel;
  sock('muzzle', muzzleS, by);
  sock('eject', 0.04, 0.056, 0.024);
  sock('foregrip', fgS, o.vgrip ? -0.02 : 0.02);
  const seat = sock('magSeat', magS, 0.024);
  seat.rotation.x = o.magTilt ?? 0.12;
  sock('magwell', magS + 0.004, -0.012);
  if (o.loadPort) sock('loadPort', magS, 0.0);
}

// ---- Sondermodelle --------------------------------------------------------------
function revolver(m, P, sock) {
  m.add(prof([[-0.035, 0.028], [0.07, 0.028], [0.07, 0.078], [-0.03, 0.078], [-0.045, 0.062]], 0.026, M.chrome, 0.002));
  m.add(cylZ(0.0095, 0.0095, 0.17, M.chrome, 0.155, 0.066, 0, 16));
  m.add(box(0.012, 0.012, 0.17, M.chrome, 0.155, 0.078));
  m.add(cylZ(0.006, 0.006, 0.171, MAT.black, 0.155, 0.066));
  // Trommel (dreht sich bei jedem Schuss)
  const cyl = new THREE.Group();
  cyl.position.set(0, 0.053, -0.02);
  cyl.add(cylZ(0.02, 0.02, 0.045, MAT.steel, 0, 0, 0, 18));
  for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; cyl.add(cylZ(0.0045, 0.0045, 0.046, MAT.black, 0, Math.cos(a) * 0.012, Math.sin(a) * 0.012, 8)); }
  m.add(cyl);
  P.spin = cyl;
  m.add(prof([[-0.04, 0.036], [0.004, 0.03], [-0.008, -0.07], [-0.05, -0.072], [-0.06, 0.0]], 0.03, MAT.wood, 0.005));
  const guard = new THREE.Mesh(cachedGeo('revguard', () => new THREE.TorusGeometry(0.018, 0.003, 6, 16, Math.PI)), M.chrome);
  guard.rotation.set(Math.PI, Math.PI / 2, 0);
  guard.position.set(0, 0.026, -0.02);
  m.add(guard);
  m.add(box(0.005, 0.018, 0.005, MAT.steel, 0.02, 0.015));
  const hammer = new THREE.Group();
  hammer.add(box(0.008, 0.02, 0.012, MAT.steel, -0.036, 0.083));
  m.add(hammer);
  P.charger = hammer;
  m.add(box(0.004, 0.01, 0.006, MAT.black, 0.235, 0.084));
  m.add(box(0.012, 0.004, 0.006, MAT.black, -0.028, 0.082));
  sock('sightRear', -0.028, 0.087);
  sock('sightFront', 0.235, 0.087);
  sock('muzzle', 0.245, 0.066);
  sock('eject', 0.02, 0.06, 0.02);
  sock('chargerGrab', -0.036, 0.083);
  sock('loadPort', 0.02, 0.053, 0.025);
}
function doubleBarrel(m, P, sock) {
  m.add(prof([[-0.07, 0.015], [0.08, 0.015], [0.08, 0.07], [-0.05, 0.072], [-0.07, 0.062]], 0.04, MAT.blued, 0.002));
  for (const x of [0.012, -0.012]) m.add(cylZ(0.0115, 0.0115, 0.5, MAT.blued, 0.33, 0.05, x, 20));
  m.add(box(0.008, 0.006, 0.5, MAT.steel, 0.33, 0.064));
  m.add(prof([[0.08, 0.012], [0.32, 0.016], [0.32, 0.042], [0.08, 0.04]], 0.05, MAT.wood, 0.008));
  m.add(prof([[-0.07, 0.022], [-0.032, 0.022], [-0.045, -0.078], [-0.092, -0.072], [-0.088, -0.01]], 0.031, MAT.wood, 0.004));
  m.add(prof([[-0.07, 0.064], [-0.07, 0.02], [-0.1, 0.0], [-0.36, -0.03], [-0.37, -0.03], [-0.37, 0.058], [-0.12, 0.066]], 0.036, MAT.wood, 0.004));
  m.add(box(0.012, 0.004, 0.06, MAT.steel, 0.0, -0.012));
  m.add(box(0.006, 0.018, 0.005, MAT.bright, 0.0, 0.002));
  const lever = new THREE.Group(); // Öffnungshebel
  lever.add(box(0.01, 0.006, 0.03, MAT.bright, -0.05, 0.075));
  m.add(lever);
  P.charger = lever;
  m.add(sphere(0.003, MAT.dotOrange, 0.575, 0.071));
  sock('sightRear', -0.05, 0.073);
  sock('sightFront', 0.575, 0.073);
  sock('muzzle', 0.585, 0.05);
  sock('eject', 0.07, 0.06, 0.02);
  sock('chargerGrab', -0.05, 0.075);
  sock('foregrip', 0.2, 0.02);
  sock('loadPort', 0.07, 0.06);
}
function plasma(m, P, sock) {
  m.add(prof([[-0.12, 0.02], [0.2, 0.02], [0.24, 0.05], [0.2, 0.085], [-0.08, 0.09], [-0.12, 0.07]], 0.055, M.white, 0.006));
  for (let i = 0; i < 4; i++) m.add(cylZ(0.03, 0.03, 0.012, M.glow, 0.24 + i * 0.035, 0.052, 0, 20)); // Spulen
  m.add(cylZ(0.012, 0.016, 0.16, MAT.steel, 0.29, 0.052, 0, 16));
  m.add(cylZ(0.022, 0.022, 0.02, M.glow, 0.37, 0.052, 0, 16));
  for (const x of [0.028, -0.028]) m.add(box(0.004, 0.012, 0.2, M.glow, 0.05, 0.06, x)); // Leuchtstreifen
  m.add(prof([[-0.032, 0.024], [0.012, 0.024], [0.0, -0.078], [-0.048, -0.072], [-0.046, -0.01]], 0.032, MAT.grip, 0.003));
  m.add(box(0.012, 0.004, 0.06, MAT.polymer, 0.03, -0.006));
  m.add(box(0.006, 0.018, 0.005, MAT.steel, 0.03, 0.008));
  m.add(prof([[-0.12, 0.08], [-0.12, 0.03], [-0.3, 0.0], [-0.32, 0.0], [-0.32, 0.08]], 0.042, M.white, 0.006));
  m.add(box(0.034, 0.04, 0.05, M.gray, 0.1, 0.0)); // Zellenschacht
  const ch = new THREE.Group(); m.add(ch); P.charger = ch;
  // Holo-Visier
  const s0 = 0.0;
  m.add(box(0.02, 0.014, 0.04, MAT.steel, s0, 0.096));
  m.add(cylZ(0.019, 0.019, 0.05, new THREE.MeshStandardMaterial({ color: 0x9aa4ad, metalness: 0.7, roughness: 0.3, side: THREE.DoubleSide }), s0, 0.12, 0, 28, true));
  sock('sightRear', s0 - 0.03, 0.12);
  sock('sightFront', s0 + 0.03, 0.12);
  sock('dotLens', s0 + 0.024, 0.12);
  sock('muzzle', 0.385, 0.052);
  sock('eject', 0.05, 0.06, 0.03);
  sock('chargerGrab', -0.1, 0.08);
  sock('foregrip', 0.17, 0.02);
  const seat = sock('magSeat', 0.1, 0.02);
  seat.rotation.x = 0;
  sock('magwell', 0.1, -0.03);
}

// ---- Registrierung ---------------------------------------------------------------
const base = (o) => Object.assign({
  twoHand: true, feed: 'mag', action: 'charge', autoCycle: true, holdOpen: true, modes: ['safe', 'semi', 'auto'], startMode: 2,
  spread: 0.003, pellets: 1, recoil: { back: 0.018, rise: 0.1, jitter: 0.04 }, travel: 0.065, sight: 'iron', range: [3, 8],
  scoreMult: 1, grip: [-0.022, -0.025], snd: { cut: 3200, thump: 110, vol: 0.8 }, mass: 3
}, o);
const lg = (opts) => (m, P, sock) => longGun(m, P, sock, opts);

// bestehende Waffen: Schaden, Preis, Stufe
Object.assign(WEAPON_DEFS.pistol, { dmg: 34, price: 0, tier: 0, mass: 0.9 });
Object.assign(WEAPON_DEFS.smg, { dmg: 24, price: 1000, tier: 1, mass: 2.6 });
Object.assign(WEAPON_DEFS.shotgun, { dmg: 15, price: 1100, tier: 1, mass: 3.3 });
Object.assign(WEAPON_DEFS.sniper, { dmg: 150, price: 1800, tier: 2, mass: 5.5 });

const NEW = {
  revolver: base({ name: 'Revolver .357', desc: '6 Schuss · Trommel einzeln laden', twoHand: false, feed: 'tube', ammo: 'round', action: 'none', capacity: 5, holdOpen: false, noEject: true,
    modes: ['semi'], startMode: 0, rpm: 220, recoil: { back: 0.05, rise: 0.5, jitter: 0.02 }, travel: 0.005, grip: [-0.03, -0.025], snd: { cut: 3600, thump: 120, vol: 1.0 }, dmg: 70, price: 900, tier: 1, mass: 1.2 }),
  magnum: base({ name: 'Magnum M50', desc: '7 Schuss · sehr stark · verchromt', builder: 'pistol', magBuilder: 'pistol', scale: 1.15, twoHand: false, capacity: 7, action: 'slide', modes: ['semi'], startMode: 0,
    rpm: 260, recoil: { back: 0.05, rise: 0.55, jitter: 0.03 }, travel: 0.05, grip: [-0.028, -0.03], snd: { cut: 3000, thump: 120, vol: 1.0 }, dmg: 80, price: 1100, tier: 1, mass: 1.5, chrome: true }),
  mpk: base({ name: 'Maschinenpistole K', desc: '25 Schuss · sehr schnell · einhändig', builder: 'pistol', magBuilder: 'mpk', twoHand: false, capacity: 25, action: 'slide',
    rpm: 1000, spread: 0.005, recoil: { back: 0.015, rise: 0.12, jitter: 0.06 }, travel: 0.045, grip: [-0.028, -0.03], snd: { cut: 3800, thump: 130, vol: 0.7 }, dmg: 22, price: 700, tier: 1, mass: 1.3 }),
  drum: base({ name: 'Trommel-MP', desc: '50 Schuss · Trommelmagazin', builder: 'drum', capacity: 50, rpm: 900, sight: 'iron', dmg: 22, price: 1500, tier: 2, mass: 3.4 }),
  ar: base({ name: 'Sturmgewehr AR-5', desc: '30 Schuss · Rotpunkt · vielseitig', builder: 'ar', capacity: 30, rpm: 750, sight: 'reddot', recoil: { back: 0.02, rise: 0.12, jitter: 0.035 }, dmg: 38, price: 1400, tier: 2, mass: 3.5 }),
  kg: base({ name: 'Kampfgewehr KG-7', desc: '20 Schuss · großes Kaliber', builder: 'kg', capacity: 20, rpm: 560, startMode: 1, sight: 'iron', recoil: { back: 0.03, rise: 0.2, jitter: 0.04 }, snd: { cut: 2800, thump: 90, vol: 1.0 }, dmg: 55, price: 1600, tier: 2, mass: 4.3 }),
  carbine: base({ name: 'Karabiner K-1', desc: '30 Schuss · leicht & schnell', builder: 'carbine', capacity: 30, rpm: 700, sight: 'iron', dmg: 32, price: 1200, tier: 1, mass: 3.0 }),
  lmg: base({ name: 'MG-100', desc: '100 Schuss · Dauerfeuer · schwer', builder: 'lmg', capacity: 100, rpm: 650, sight: 'iron', spread: 0.006, holdOpen: false, recoil: { back: 0.025, rise: 0.12, jitter: 0.06 }, snd: { cut: 2600, thump: 100, vol: 1.0 }, dmg: 36, price: 2200, tier: 3, mass: 8.5, boxOnly: true }),
  autoshot: base({ name: 'Auto-Schrotflinte AS-8', desc: '8 Schuss · Halbautomat · Schrot', builder: 'autoshot', capacity: 8, modes: ['safe', 'semi'], startMode: 1, rpm: 300, pellets: 8, spread: 0.045, sight: 'bead', recoil: { back: 0.05, rise: 0.3, jitter: 0.04 }, snd: { cut: 2200, thump: 90, vol: 1.0 }, dmg: 13, price: 1700, tier: 2, mass: 4.2 }),
  dbl: base({ name: 'Doppelflinte', desc: '2 Schuss · verheerend aus der Nähe', builder: 'dbl', feed: 'tube', ammo: 'shell', action: 'none', capacity: 1, holdOpen: false, noEject: true, modes: ['semi'], startMode: 0, rpm: 300, pellets: 10, spread: 0.05,
    sight: 'bead', recoil: { back: 0.07, rise: 0.5, jitter: 0.03 }, travel: 0.005, grip: [-0.062, -0.028], snd: { cut: 2000, thump: 80, vol: 1.1 }, dmg: 16, price: 900, tier: 1, mass: 3.2 }),
  dmr: base({ name: 'Präzisionsgewehr P-10', desc: '10 Schuss · Halbautomat · Zielfernrohr', builder: 'dmr', capacity: 10, modes: ['safe', 'semi'], startMode: 1, rpm: 240, spread: 0.0006, sight: 'scope', recoil: { back: 0.035, rise: 0.18, jitter: 0.01 }, snd: { cut: 2800, thump: 80, vol: 1.0 }, dmg: 95, price: 1900, tier: 3, mass: 4.6, range: [6, 14] }),
  plasma: base({ name: 'Plasmawerfer', desc: 'Wunderwaffe · Plasmakugeln mit Flächenschaden', builder: 'plasma', magBuilder: 'plasma', capacity: 20, action: 'none', modes: ['semi'], startMode: 0, holdOpen: false, noEject: true, rpm: 300, sight: 'reddot', projectile: 'plasma',
    recoil: { back: 0.02, rise: 0.15, jitter: 0.02 }, travel: 0.005, snd: { cut: 5000, thump: 200, vol: 0.9 }, dmg: 160, price: 0, tier: 4, mass: 4.0, boxOnly: true })
};
Object.assign(WEAPON_DEFS, NEW);
WEAPON_ORDER.push(...Object.keys(NEW));

// Baupläne
Object.assign(BUILDERS, {
  drum: lg({ recLen: 0.16, hgLen: 0.12, barrel: 0.06, stock: 'folding', hg: 'tube', furniture: MAT.polymer, magS: 0.09, vgrip: false }),
  drumMag: drumMag,
  ar: lg({ recLen: 0.2, hgLen: 0.22, barrel: 0.14, stock: 'fixed', hg: 'rail', sight: 'reddot', furniture: M.fde, vgrip: true }),
  arMag: () => curvedMag(0.022, 0.16, 0.034),
  kg: lg({ recLen: 0.22, hgLen: 0.24, barrel: 0.2, stock: 'wood', hg: 'wood', furniture: MAT.wood, body: MAT.blued, rail: false }),
  kgMag: () => straightMag(0.024, 0.12, 0.05),
  carbine: lg({ recLen: 0.2, hgLen: 0.18, barrel: 0.12, stock: 'folding', hg: 'tube', furniture: M.od }),
  carbineMag: () => curvedMag(0.022, 0.17, 0.034, M.gray),
  lmg: lg({ recLen: 0.26, hgLen: 0.3, barrel: 0.2, stock: 'fixed', hg: 'rail', furniture: M.od, body: M.gray, carry: true, bipod: true, magS: 0.08, magTilt: 0 }),
  lmgMag: boxMag,
  autoshot: lg({ recLen: 0.22, hgLen: 0.22, barrel: 0.22, stock: 'fixed', hg: 'rail', sight: 'bead', furniture: MAT.polymer, body: MAT.blued, bore: 0.05 }),
  autoshotMag: () => straightMag(0.04, 0.13, 0.07, MAT.polymer, MAT.black),
  dmr: lg({ recLen: 0.22, hgLen: 0.26, barrel: 0.26, stock: 'fixed', hg: 'rail', sight: 'scope', furniture: M.fde, rail: false }),
  dmrMag: () => straightMag(0.024, 0.09, 0.05),
  revolver, dbl: doubleBarrel, plasma,
  plasmaMag: cellMag,
  mpkMag: () => { const g = new THREE.Group(); g.add(box(0.021, 0.18, 0.03, MAT.steel, 0, -0.09)); g.add(box(0.025, 0.012, 0.037, MAT.polymer, -0.002, -0.184)); cartridgeOnTop(g); return g; }
});

// Magnum: verchromter Schlitten + Mündungsbremse; MP-K: Dauerfeuer (Pistolen-Bauplan)
const pistolBuild = BUILDERS.pistol;
BUILDERS.pistol = function (m, P, sock, def) {
  pistolBuild(m, P, sock);
  if (def && def.chrome) {
    P.charger.traverse(o => { if (o.isMesh && o.material === MAT.steel) o.material = M.chrome; });
    P.charger.add(box(0.03, 0.03, 0.03, MAT.black, 0.17, 0.05));
    sock('muzzle', 0.19, 0.05);
  }
};
