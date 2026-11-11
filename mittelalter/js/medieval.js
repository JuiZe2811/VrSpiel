import * as THREE from 'three';
import { MAT, prof, box, cylZ, cylY, sphere, cachedGeo } from './util.js?v=50';
import { WEAPON_DEFS, WEAPON_ORDER, BUILDERS, fromTemplate } from './weapons.js?v=50';

// =============================================================================
// Mittelalter-Waffen: Schwerter, Axt, Morgenstern, Speer und Bögen.
// Gleiche Design-Koordinaten wie die Schusswaffen: s = vorwärts (Klinge zeigt nach vorne), y = oben,
// die Hand hält bei s = 0. Die Schusswaffen bleiben in WEAPON_DEFS (der Boss braucht ein paar Daten),
// tauchen aber nirgends mehr im Spiel auf: WEAPON_ORDER enthält nur noch die Mittelalter-Waffen.
// =============================================================================
const M = {
  blade: new THREE.MeshStandardMaterial({ color: 0xd5dbe2, metalness: 0.6, roughness: 0.3 }),
  edge: new THREE.MeshStandardMaterial({ color: 0xeef2f6, metalness: 0.6, roughness: 0.2 }),
  iron: new THREE.MeshStandardMaterial({ color: 0x3a3c40, metalness: 0.85, roughness: 0.45 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xd4ab45, metalness: 0.55, roughness: 0.35 }),
  leather: new THREE.MeshStandardMaterial({ color: 0x4a2c17, roughness: 0.85 }),
  redLeather: new THREE.MeshStandardMaterial({ color: 0x6e1a14, roughness: 0.8 }),
  haft: new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.7 }),
  darkHaft: new THREE.MeshStandardMaterial({ color: 0x3e2614, roughness: 0.75 }),
  feather: new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.9, side: THREE.DoubleSide }),
  featherRed: new THREE.MeshStandardMaterial({ color: 0xb2241c, roughness: 0.9, side: THREE.DoubleSide }),
  fire: new THREE.MeshStandardMaterial({ color: 0xff5a1a, emissive: 0xff3a00, emissiveIntensity: 1.6, roughness: 0.4, toneMapped: false }),
  frost: new THREE.MeshStandardMaterial({ color: 0x9fe4ff, emissive: 0x3aa8ff, emissiveIntensity: 1.2, roughness: 0.2, metalness: 0.4, toneMapped: false }),
  thunder: new THREE.MeshStandardMaterial({ color: 0x8fd8ff, emissive: 0x3a9cff, emissiveIntensity: 1.4, roughness: 0.3, metalness: 0.6, toneMapped: false })
};
export const MEDIEVAL_MATERIALS = M;

// gemeinsame Anker: Treffer-Linie (hitA → muzzle), leere Visier-Anker, Dummy-Verschluss
function common(m, P, sock, hitA, tip, fore) {
  P.charger = new THREE.Group(); m.add(P.charger);
  sock('hitA', hitA[0], hitA[1]);
  sock('muzzle', tip[0], tip[1]);
  sock('sightRear', 0, 0.06); sock('sightFront', 0, 0.06); // gleiche Stelle → kein Visier
  sock('chargerGrab', -0.05, 0); sock('magwell', -0.05, -0.05); sock('loadPort', -0.05, -0.05);
  if (fore != null) sock('foregrip', fore, 0);
}
// Klinge als flaches Profil (Schneiden oben/unten), Spitze vorne
function blade(m, s0, s1, w0, w1, thick, mat = M.blade, tipLen = 0.08) {
  m.add(prof([[s0, -w0], [s1 - tipLen, -w1], [s1, 0], [s1 - tipLen, w1], [s0, w0]], thick, mat, 0.001));
  m.add(box(thick + 0.001, 0.006, (s1 - tipLen - s0) * 0.8, M.iron, s0 + (s1 - tipLen - s0) * 0.42, 0)); // Hohlkehle
}
function hilt(m, s0, s1, r, mat = M.leather) {
  m.add(cylZ(r, r, s1 - s0, mat, (s0 + s1) / 2, 0, 0, 10));
  for (let s = s0 + 0.02; s < s1; s += 0.035) m.add(cylZ(r + 0.002, r + 0.002, 0.008, M.darkHaft, s, 0, 0, 10)); // Wicklung
}

BUILDERS.langschwert = (m, P, sock, def) => {
  hilt(m, -0.08, 0.1, 0.016);
  m.add(sphere(0.027, M.gold, -0.105, 0));
  m.add(box(0.012, 0.2, 0.026, M.gold, 0.12, 0)); // Parierstange (quer zur Schneide)
  m.add(sphere(0.014, M.gold, 0.12, 0.1)); m.add(sphere(0.014, M.gold, 0.12, -0.1));
  blade(m, 0.13, 0.95, 0.024, 0.019, 0.007, def.bladeMat ? M[def.bladeMat] : M.blade);
  common(m, P, sock, [0.2, 0], [0.92, 0], 0.07);
};
BUILDERS.zweihaender = (m, P, sock, def) => {
  hilt(m, -0.1, 0.2, 0.018, M.redLeather);
  m.add(sphere(0.032, M.iron, -0.13, 0));
  m.add(box(0.014, 0.32, 0.03, M.iron, 0.22, 0));
  for (const y of [0.16, -0.16]) m.add(sphere(0.018, M.iron, 0.22, y));
  m.add(box(0.012, 0.05, 0.05, M.iron, 0.26, 0.03)); m.add(box(0.012, 0.05, 0.05, M.iron, 0.26, -0.03)); // Parierhaken
  blade(m, 0.23, 1.3, 0.03, 0.024, 0.008, def.bladeMat ? M[def.bladeMat] : M.blade, 0.1);
  common(m, P, sock, [0.3, 0], [1.27, 0], 0.15);
};
BUILDERS.axt = (m, P, sock, def) => {
  m.add(cylZ(0.017, 0.019, 0.8, M.haft, 0.25, 0, 0, 10));
  m.add(cylZ(0.021, 0.021, 0.12, M.leather, -0.02, 0, 0, 10));
  m.add(cylZ(0.024, 0.024, 0.02, M.iron, -0.14, 0, 0, 10));
  // Kopf: Schneide nach unten (Hiebrichtung), Dorn nach oben
  m.add(box(0.03, 0.06, 0.08, M.iron, 0.58, 0));
  m.add(prof([[0.55, -0.02], [0.62, -0.02], [0.69, -0.16], [0.6, -0.15], [0.48, -0.17]], 0.012, def.bladeMat ? M[def.bladeMat] : M.blade, 0.001));
  m.add(prof([[0.47, -0.168], [0.6, -0.152], [0.695, -0.162], [0.69, -0.172], [0.6, -0.162], [0.47, -0.178]], 0.006, M.edge, 0.0008));
  const spike = new THREE.Mesh(cachedGeo('axespike', () => new THREE.ConeGeometry(0.014, 0.09, 6)), M.iron);
  spike.position.set(0, 0.07, -0.58); m.add(spike);
  common(m, P, sock, [0.35, -0.05], [0.58, -0.17], 0.3);
};
BUILDERS.morgenstern = (m, P, sock, def) => {
  m.add(cylZ(0.018, 0.02, 0.55, M.darkHaft, 0.13, 0, 0, 10));
  m.add(cylZ(0.022, 0.022, 0.12, M.leather, -0.02, 0, 0, 10));
  m.add(cylZ(0.028, 0.02, 0.05, M.iron, 0.4, 0, 0, 10));
  const mat = def.bladeMat ? M[def.bladeMat] : M.iron;
  m.add(sphere(0.055, mat, 0.48, 0));
  const g = cachedGeo('mspike', () => new THREE.ConeGeometry(0.012, 0.05, 5));
  const dirs = [];
  for (let i = 0; i < 14; i++) { const y = 1 - (i + 0.5) / 7, r = Math.sqrt(Math.max(0, 1 - y * y)), a = i * 2.4; dirs.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r)); }
  for (const d of dirs) { const c = new THREE.Mesh(g, M.edge); c.position.set(d.x * 0.065, d.y * 0.065, -0.48 + d.z * 0.065); c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d); m.add(c); }
  common(m, P, sock, [0.3, 0], [0.5, 0], 0.18);
};
BUILDERS.speer = (m, P, sock, def) => {
  m.add(cylZ(0.015, 0.016, 1.7, M.haft, 0.25, 0, 0, 10));
  m.add(cylZ(0.019, 0.019, 0.14, M.leather, 0, 0, 0, 10));
  m.add(cylZ(0.019, 0.019, 0.12, M.leather, 0.45, 0, 0, 10));
  m.add(cylZ(0.02, 0.016, 0.06, M.iron, 1.12, 0, 0, 10));
  m.add(prof([[1.14, 0], [1.2, -0.035], [1.38, 0], [1.2, 0.035]], 0.008, def.bladeMat ? M[def.bladeMat] : M.blade, 0.001));
  common(m, P, sock, [1.0, 0], [1.37, 0], 0.45);
};
// Bogen: Griff bei s = 0, Wurfarme oben/unten, Sehne hinten (Richtung Spieler)
function bowCurve(len, depth) {
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12, y = t * len;
    // Wurfarm biegt sich zum Schützen (−s), Spitzen leicht nach vorne zurück (Reflex)
    const s = -depth * Math.sin(t * Math.PI * 0.85) + (t > 0.85 ? (t - 0.85) * 0.25 * depth / 0.15 : 0);
    pts.push(new THREE.Vector3(0, y, -s)); // Design → Modellraum (z = −s)
  }
  return new THREE.CatmullRomCurve3(pts);
}
function bowBuilder(len, depth, r, mat, fletch) {
  return (m, P, sock, def) => {
    const key = `bowlimb${len}|${depth}|${r}`;
    const geo = cachedGeo(key, () => new THREE.TubeGeometry(bowCurve(len, depth), 14, r, 6, false));
    const top = new THREE.Mesh(geo, def.bladeMat ? M[def.bladeMat] : mat); m.add(top);
    const bot = new THREE.Mesh(geo, def.bladeMat ? M[def.bladeMat] : mat); bot.scale.y = -1; m.add(bot);
    m.add(cylY(r * 1.5, r * 1.5, 0.12, M.leather, 0, 0, 0, 8)); // Griff
    m.add(box(0.008, 0.012, 0.02, M.leather, 0.0, 0.03, -0.012)); // Pfeilauflage
    const tipS = -bowCurve(len, depth).getPoint(1).z;
    sock('limbTop', tipS, len); sock('limbBot', tipS, -len);
    sock('nock', tipS - 0.005, 0.03);
    common(m, P, sock, [0, 0], [0.02, 0.03]);
    P.fletch = fletch;
  };
}
BUILDERS.kurzbogen = bowBuilder(0.5, 0.09, 0.011, M.haft, 'feather');
BUILDERS.langbogen = bowBuilder(0.78, 0.07, 0.013, M.darkHaft, 'feather');
BUILDERS.frostbogen = bowBuilder(0.62, 0.1, 0.012, M.frost, 'feather');
BUILDERS.donnerhammer = (m, P, sock, def) => {
  m.add(cylZ(0.02, 0.022, 0.75, M.darkHaft, 0.22, 0, 0, 10));
  m.add(cylZ(0.024, 0.024, 0.14, M.redLeather, 0, 0, 0, 10));
  m.add(box(0.1, 0.24, 0.11, M.thunder, 0.6, 0)); // Kopf quer zum Stiel
  for (const y of [-0.08, 0.08]) m.add(box(0.11, 0.014, 0.12, M.gold, 0.6, y));
  m.add(box(0.06, 0.02, 0.06, M.iron, 0.6, 0.13)); m.add(box(0.06, 0.02, 0.06, M.iron, 0.6, -0.13));
  common(m, P, sock, [0.4, 0], [0.62, -0.08], 0.25);
};

// Pfeil (Holzschaft, Eisenspitze, Federn) – Ursprung in der Mitte, Spitze nach −z
export function makeBowArrow(kind = 'feather') {
  return fromTemplate('bowarrow:' + kind, () => {
    const g = new THREE.Group();
    g.add(cylZ(0.0035, 0.0035, 0.72, M.haft, 0, 0, 0, 6));
    const tip = new THREE.Mesh(cachedGeo('bowarrowtip', () => new THREE.ConeGeometry(0.009, 0.05, 4)), kind === 'fire' ? M.fire : kind === 'frost' ? M.frost : M.iron);
    tip.rotation.x = -Math.PI / 2; tip.position.z = -0.38; g.add(tip);
    const fg = cachedGeo('fletch', () => new THREE.PlaneGeometry(0.018, 0.08));
    for (let k = 0; k < 3; k++) {
      const f = new THREE.Mesh(fg, k === 0 ? M.featherRed : M.feather);
      f.rotation.y = Math.PI / 2; f.position.set(0, 0.009, 0.3);
      const p = new THREE.Group(); p.add(f); p.rotation.z = k * Math.PI * 2 / 3; g.add(p);
    }
    return g;
  });
}

// ---- Daten ------------------------------------------------------------------------------
const MELEE_BASE = {
  twoHand: false, capacity: 1, feed: 'tube', action: 'none', autoCycle: true, holdOpen: false,
  modes: ['semi'], startMode: 0, rpm: 60, spread: 0, pellets: 1, noEject: true,
  recoil: { back: 0, rise: 0, jitter: 0 }, travel: 0.01, sight: 'none', range: [1, 2], scoreMult: 1, grip: [0, 0],
  snd: { cut: 1200, thump: 90, vol: 0.6 }
};
const BOW_BASE = Object.assign({}, MELEE_BASE, { range: [5, 14], tilt: 0 });
const NEW = {
  langschwert: { name: 'Langschwert', desc: 'Zuverlässige Klinge · Hieb & Stich', dmg: 48, mass: 1.3, price: 0, tier: 0, tilt: 0.45,
    melee: { minSpeed: 1.6, cleave: 2, head: 1.6 } },
  axt: { name: 'Streitaxt', desc: 'Wuchtige Hiebe · spaltet Rüstungen', dmg: 80, mass: 2.0, price: 1200, tier: 1, tilt: 0.45,
    melee: { minSpeed: 1.9, cleave: 1, head: 1.8 } },
  morgenstern: { name: 'Morgenstern', desc: 'Betäubt getroffene Gegner', dmg: 66, mass: 2.2, price: 1000, tier: 1, tilt: 0.45,
    melee: { minSpeed: 1.8, cleave: 2, head: 2, stun: 1.2 } },
  speer: { name: 'Speer', desc: 'Stoßen! · durchbohrt 3 Gegner · große Reichweite', dmg: 85, mass: 1.6, price: 900, tier: 1, tilt: 0.1, twoHand: true,
    melee: { minSpeed: 1.3, thrust: true, cleave: 3, head: 2 } },
  zweihaender: { name: 'Zweihänder', desc: 'Riesige Klinge · trifft mehrere Gegner', dmg: 82, mass: 3.0, price: 1600, tier: 2, tilt: 0.45, twoHand: true,
    melee: { minSpeed: 1.7, cleave: 4, head: 1.6 } },
  kurzbogen: Object.assign({}, BOW_BASE, { name: 'Kurzbogen', desc: 'Sehne mit der anderen Hand spannen', dmg: 70, mass: 0.8, price: 1000, tier: 1,
    bow: { drawLen: 0.5, speed: 38, quiver: 30 } }),
  langbogen: Object.assign({}, BOW_BASE, { name: 'Langbogen', desc: 'Weit, schnell, tödlich · durchschlägt 2', dmg: 125, mass: 1.1, price: 2000, tier: 2,
    bow: { drawLen: 0.62, speed: 55, quiver: 24, pierce: 2 } }),
  // nur aus der Truhe
  flammenschwert: { name: 'Flammenschwert', desc: 'Setzt Gegner in Brand', dmg: 70, mass: 1.4, price: 0, tier: 3, boxOnly: true, tilt: 0.45, builder: 'langschwert', bladeMat: 'fire',
    melee: { minSpeed: 1.5, cleave: 3, head: 1.6, burn: 14 } },
  donnerhammer: { name: 'Donnerhammer', desc: 'Blitze springen auf Gegner über', dmg: 110, mass: 3.2, price: 0, tier: 3, boxOnly: true, tilt: 0.45, twoHand: true,
    melee: { minSpeed: 1.8, cleave: 2, head: 1.5, chain: 3, stun: 0.8 } },
  frostbogen: Object.assign({}, BOW_BASE, { name: 'Frostbogen', desc: 'Pfeile frieren Gegner ein', dmg: 100, mass: 1.0, price: 0, tier: 3, boxOnly: true, bladeMat: 'frost',
    bow: { drawLen: 0.55, speed: 48, quiver: 24, freeze: 3 } })
};
for (const [id, d] of Object.entries(NEW)) WEAPON_DEFS[id] = Object.assign({}, d.bow ? {} : MELEE_BASE, d, { id });
WEAPON_ORDER.length = 0;
WEAPON_ORDER.push(...Object.keys(NEW));
export const STARTER = 'langschwert';
