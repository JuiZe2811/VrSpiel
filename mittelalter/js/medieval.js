import * as THREE from 'three';
import { MAT, prof, box, cylZ, cylY, sphere, cachedGeo } from './util.js?v=2';
import { WEAPON_DEFS, WEAPON_ORDER, BUILDERS, fromTemplate } from './weapons.js?v=2';

// =============================================================================
// Mittelalter-Waffen: Schwerter, Äxte, Hämmer, Stangenwaffen, Flegel, Bögen, Armbrust und Schilde.
// Design-Koordinaten: s = vorwärts (Klinge zeigt nach vorne), y = oben, die Hand hält bei s = 0.
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

// gemeinsame Anker: Treffer-Linie (hitA → muzzle) und zweiter Griff
function common(m, P, sock, hitA, tip, fore) {
  sock('hitA', hitA[0], hitA[1], hitA[2] || 0);
  sock('muzzle', tip[0], tip[1], tip[2] || 0);
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

// ---- weitere Nahkampfwaffen ---------------------------------------------------------------
BUILDERS.kurzschwert = (m, P, sock, def) => {
  hilt(m, -0.06, 0.08, 0.015);
  m.add(sphere(0.022, M.iron, -0.08, 0));
  m.add(box(0.012, 0.14, 0.024, M.iron, 0.095, 0));
  blade(m, 0.1, 0.62, 0.028, 0.022, 0.007, def.bladeMat ? M[def.bladeMat] : M.blade, 0.06);
  common(m, P, sock, [0.16, 0], [0.6, 0]);
};
BUILDERS.falchion = (m, P, sock, def) => { // einschneidig, vorne breiter, leicht gebogen
  hilt(m, -0.07, 0.09, 0.016, M.redLeather);
  m.add(sphere(0.024, M.gold, -0.09, 0));
  m.add(box(0.012, 0.16, 0.026, M.gold, 0.105, 0));
  m.add(prof([[0.11, -0.02], [0.45, -0.03], [0.66, -0.045], [0.78, 0.0], [0.6, 0.022], [0.11, 0.02]], 0.007, def.bladeMat ? M[def.bladeMat] : M.blade, 0.001));
  common(m, P, sock, [0.2, -0.01], [0.74, -0.02]);
};
BUILDERS.rapier = (m, P, sock, def) => {
  hilt(m, -0.07, 0.07, 0.013);
  m.add(sphere(0.024, M.gold, -0.09, 0));
  const ring = new THREE.Mesh(cachedGeo('rapring', () => new THREE.TorusGeometry(0.06, 0.006, 6, 16)), M.gold); // Korb
  ring.position.set(0, 0, -0.06); m.add(ring);
  m.add(box(0.008, 0.18, 0.016, M.gold, 0.085, 0));
  blade(m, 0.09, 1.0, 0.009, 0.006, 0.006, def.bladeMat ? M[def.bladeMat] : M.edge, 0.12);
  common(m, P, sock, [0.3, 0], [0.98, 0]);
};
BUILDERS.streitkolben = (m, P, sock, def) => {
  m.add(cylZ(0.016, 0.018, 0.55, M.iron, 0.13, 0, 0, 10));
  m.add(cylZ(0.021, 0.021, 0.13, M.leather, -0.02, 0, 0, 10));
  m.add(cylZ(0.035, 0.035, 0.12, def.bladeMat ? M[def.bladeMat] : M.iron, 0.44, 0, 0, 10));
  for (let k = 0; k < 6; k++) { // Schlagblätter
    const f = prof([[0.38, 0], [0.42, 0.075], [0.5, 0.075], [0.53, 0]], 0.012, M.blade, 0.001);
    const g = new THREE.Group(); g.add(f); g.rotation.z = k * Math.PI / 3; m.add(g);
  }
  m.add(cylZ(0.006, 0.02, 0.04, M.iron, 0.55, 0, 0, 8));
  common(m, P, sock, [0.3, 0], [0.47, 0.07]);
};
BUILDERS.kriegshammer = (m, P, sock, def) => {
  m.add(cylZ(0.016, 0.018, 0.85, M.darkHaft, 0.27, 0, 0, 10));
  m.add(cylZ(0.021, 0.021, 0.14, M.leather, -0.02, 0, 0, 10));
  m.add(box(0.05, 0.09, 0.06, def.bladeMat ? M[def.bladeMat] : M.iron, 0.66, -0.06)); // Hammerkopf (nach unten)
  m.add(box(0.06, 0.02, 0.07, M.iron, 0.66, -0.11));
  const pick = new THREE.Mesh(cachedGeo('hpick', () => new THREE.ConeGeometry(0.02, 0.14, 6)), M.iron); // Dorn nach oben
  pick.position.set(0, 0.06, -0.66); m.add(pick);
  const top = new THREE.Mesh(cachedGeo('hspike', () => new THREE.ConeGeometry(0.014, 0.1, 6)), M.iron);
  top.rotation.x = -Math.PI / 2; top.position.set(0, 0, -0.74); m.add(top);
  common(m, P, sock, [0.45, -0.04], [0.66, -0.12], 0.32);
};
BUILDERS.hellebarde = (m, P, sock, def) => {
  m.add(cylZ(0.016, 0.017, 1.9, M.haft, 0.45, 0, 0, 10));
  m.add(cylZ(0.019, 0.019, 0.14, M.leather, 0, 0, 0, 10));
  m.add(cylZ(0.019, 0.019, 0.14, M.leather, 0.5, 0, 0, 10));
  const mat = def.bladeMat ? M[def.bladeMat] : M.blade;
  m.add(prof([[1.18, -0.01], [1.32, -0.01], [1.36, -0.17], [1.24, -0.16], [1.12, -0.19]], 0.01, mat, 0.001)); // Beil
  m.add(prof([[1.24, 0.01], [1.3, 0.01], [1.27, 0.1], [1.21, 0.12]], 0.008, M.iron, 0.001)); // Haken
  m.add(prof([[1.38, 0], [1.42, -0.025], [1.62, 0], [1.42, 0.025]], 0.008, mat, 0.001)); // Spitze
  common(m, P, sock, [1.15, -0.08], [1.6, 0], 0.5);
  sock('hitB', 1.32, -0.17);
};
BUILDERS.flegel = (m, P, sock, def) => { // Kriegsflegel: Kugel an der Kette schwingt frei
  m.add(cylZ(0.018, 0.02, 0.45, M.darkHaft, 0.1, 0, 0, 10));
  m.add(cylZ(0.022, 0.022, 0.12, M.leather, -0.03, 0, 0, 10));
  m.add(cylZ(0.024, 0.02, 0.04, M.iron, 0.33, 0, 0, 10));
  sock('chainA', 0.35, 0);
  const ball = new THREE.Group();
  ball.add(new THREE.Mesh(cachedGeo('flball', () => new THREE.SphereGeometry(0.05, 12, 8)), def.bladeMat ? M[def.bladeMat] : M.iron));
  const sg = cachedGeo('mspike', () => new THREE.ConeGeometry(0.012, 0.05, 5));
  for (let i = 0; i < 10; i++) { const y = 1 - (i + 0.5) / 5, r = Math.sqrt(Math.max(0, 1 - y * y)), a = i * 2.4, d = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r); const c = new THREE.Mesh(sg, M.edge); c.position.copy(d).multiplyScalar(0.058); c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d); ball.add(c); }
  ball.position.set(0, -0.3, -0.35);
  m.add(ball);
  const chain = new THREE.Mesh(cachedGeo('flchain', () => new THREE.CylinderGeometry(0.006, 0.006, 1, 5).translate(0, 0.5, 0)), M.iron);
  chain.position.set(0, 0, -0.35); m.add(chain);
  P.ball = ball; P.chain = chain;
  common(m, P, sock, [0.35, 0], [0.35, 0]);
};
// ---- Armbrust: Sehne mit der zweiten Hand spannen, dann mit dem Abzug schießen ---------------
BUILDERS.armbrust = (m, P, sock, def) => {
  m.add(box(0.045, 0.05, 0.62, M.haft, 0.16, -0.01)); // Säule
  m.add(box(0.04, 0.09, 0.14, M.darkHaft, -0.12, -0.04)); // Kolben
  m.add(box(0.012, 0.03, 0.04, M.iron, 0.02, -0.045)); // Abzug
  const prod = new THREE.Mesh(cachedGeo('xprod', () => new THREE.TorusGeometry(0.38, 0.012, 5, 14, Math.PI * 0.62)), def.bladeMat ? M[def.bladeMat] : M.iron);
  prod.rotation.set(Math.PI / 2, 0, Math.PI * 0.19 + Math.PI); // Bogen quer, Spitzen nach hinten
  prod.position.set(0, 0.02, -0.06);
  m.add(prod);
  m.add(box(0.006, 0.006, 0.4, M.iron, 0.25, 0.018)); // Bolzenrinne
  const a = Math.PI * 0.31, tipX = Math.sin(a) * 0.38, tipS = 0.06 + Math.cos(a) * 0.38; // Spitzen des Querbogens
  sock('limbTop', tipS, 0.02, -tipX); sock('limbBot', tipS, 0.02, tipX);
  sock('nock', tipS - 0.005, 0.03);
  common(m, P, sock, [0, 0], [0.5, 0.03]);
};
// ---- Schilde: Gesicht zeigt nach vorne (−z), Griff in der Hand -------------------------------
function shieldGeo(key, shape, depth) {
  return cachedGeo(key, () => { const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.006, bevelSegments: 1, curveSegments: 10 }); g.translate(0, 0, -depth); return g; });
}
function roundShape(r) { const s = new THREE.Shape(); s.absarc(0, 0, r, 0, Math.PI * 2, false); return s; }
function kiteShape(w, h) { const s = new THREE.Shape(); s.moveTo(-w / 2, h * 0.38); s.quadraticCurveTo(0, h * 0.5, w / 2, h * 0.38); s.quadraticCurveTo(w / 2, -h * 0.05, 0, -h * 0.5); s.quadraticCurveTo(-w / 2, -h * 0.05, -w / 2, h * 0.38); return s; }
function heaterShape(w, h) { const s = new THREE.Shape(); s.moveTo(-w / 2, h / 2); s.lineTo(w / 2, h / 2); s.lineTo(w / 2, 0); s.quadraticCurveTo(w / 2, -h * 0.35, 0, -h / 2); s.quadraticCurveTo(-w / 2, -h * 0.35, -w / 2, 0); s.closePath(); return s; }
const crestTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128; const ctx = c.getContext('2d');
  ctx.fillStyle = '#1f3566'; ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#d4ab45'; ctx.fillRect(56, 0, 16, 128); ctx.fillRect(0, 50, 128, 16);
  ctx.font = 'bold 44px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#d4ab45'; ctx.fillText('♛', 34, 28);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
M.crest = new THREE.MeshStandardMaterial({ map: crestTex, roughness: 0.7 });
M.planks = new THREE.MeshStandardMaterial({ color: 0x8a6239, roughness: 0.85 });
M.paintRed = new THREE.MeshStandardMaterial({ color: 0x8a1f1a, roughness: 0.75 });
M.paintBlue = new THREE.MeshStandardMaterial({ color: 0x24407a, roughness: 0.75 });
function shieldBuilder(kind) {
  return (m, P, sock, def) => {
    const face = { holz: M.planks, rund: M.paintRed, drache: M.paintBlue, turm: M.planks, wappen: M.crest }[kind];
    let geo, size;
    if (kind === 'holz') { geo = shieldGeo('sh_holz', roundShape(0.24), 0.025); size = 0.24; }
    else if (kind === 'rund') { geo = shieldGeo('sh_rund', roundShape(0.3), 0.025); size = 0.3; }
    else if (kind === 'drache') { geo = shieldGeo('sh_kite', kiteShape(0.46, 0.85), 0.025); size = 0.36; }
    else if (kind === 'turm') { geo = shieldGeo('sh_turm', heaterShape(0.55, 1.0), 0.035); size = 0.45; }
    else { geo = shieldGeo('sh_heater', heaterShape(0.46, 0.6), 0.025); size = 0.3; }
    const plate = new THREE.Mesh(geo, face);
    plate.position.z = -0.05;
    m.add(plate);
    if (kind === 'holz' || kind === 'turm') for (let k = -2; k <= 2; k++) m.add(box(0.004, size * 1.7, 0.003, M.darkHaft, 0.076, 0, k * size * 0.38)); // Bretterfugen
    if (kind !== 'holz') { const rim = new THREE.Mesh(cachedGeo('rim' + kind, () => new THREE.TorusGeometry(size * 0.98, 0.01, 4, 24)), M.iron); rim.position.z = -0.075; if (kind === 'rund') m.add(rim); }
    const boss = new THREE.Mesh(cachedGeo('shboss', () => new THREE.SphereGeometry(0.055, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)), kind === 'wappen' ? M.gold : M.iron);
    boss.rotation.x = -Math.PI / 2; boss.position.z = -0.077; m.add(boss);
    m.add(box(0.03, 0.12, 0.03, M.leather, 0.03, 0)); // Griff
    sock('face', 0.077, 0);
    common(m, P, sock, [0.08, 0, -size * 0.8], [0.08, 0, size * 0.8]);
    P.size = size;
  };
}
BUILDERS.holzschild = shieldBuilder('holz');
BUILDERS.rundschild = shieldBuilder('rund');
BUILDERS.drachenschild = shieldBuilder('drache');
BUILDERS.turmschild = shieldBuilder('turm');
BUILDERS.wappenschild = shieldBuilder('wappen');

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
// melee: minSpeed = nötiges Tempo der Spitze (m/s) · cleave = Gegner pro Schwung · head = Kopftreffer-Faktor
//        thrust = nur Stöße · stun = betäubt (s) · armor = durchschlägt Ritter-Schilde · burn/chain = Feuer/Blitz
const MELEE_BASE = { twoHand: false, grip: [0, 0], range: [1, 2], snd: { cut: 1200, thump: 90, vol: 0.6 } };
const BOW_BASE = Object.assign({}, MELEE_BASE, { range: [5, 14], tilt: 0 });
const SHIELD_BASE = Object.assign({}, MELEE_BASE, { tilt: 0 });
const NEW = {
  langschwert: { name: 'Langschwert', desc: 'Zuverlässige Klinge · Hieb & Stich', dmg: 48, mass: 1.3, price: 0, tier: 0, tilt: 0.45,
    melee: { minSpeed: 1.6, cleave: 2, head: 1.6 } },
  kurzschwert: { name: 'Kurzschwert', desc: 'Leicht und schnell · ideal mit Schild', dmg: 40, mass: 0.9, price: 600, tier: 1, tilt: 0.45,
    melee: { minSpeed: 1.3, cleave: 1, head: 1.7 } },
  falchion: { name: 'Falchion', desc: 'Schwere Hiebklinge · trifft 2 Gegner', dmg: 62, mass: 1.5, price: 900, tier: 1, tilt: 0.45,
    melee: { minSpeed: 1.7, cleave: 2, head: 1.5 } },
  rapier: { name: 'Rapier', desc: 'Schnelle Stiche · hohe Kopftreffer', dmg: 58, mass: 0.9, price: 1100, tier: 1, tilt: 0.3,
    melee: { minSpeed: 1.2, thrust: true, cleave: 1, head: 2.5 } },
  axt: { name: 'Streitaxt', desc: 'Wuchtige Hiebe · spaltet Schilde', dmg: 80, mass: 2.0, price: 1200, tier: 1, tilt: 0.45,
    melee: { minSpeed: 1.9, cleave: 1, head: 1.8, armor: true } },
  streitkolben: { name: 'Streitkolben', desc: 'Zertrümmert Rüstungen · betäubt', dmg: 70, mass: 1.8, price: 1000, tier: 1, tilt: 0.45,
    melee: { minSpeed: 1.8, cleave: 1, head: 2, stun: 0.8, armor: true } },
  morgenstern: { name: 'Morgenstern', desc: 'Betäubt getroffene Gegner', dmg: 66, mass: 2.2, price: 1000, tier: 1, tilt: 0.45,
    melee: { minSpeed: 1.8, cleave: 2, head: 2, stun: 1.2 } },
  flegel: { name: 'Kriegsflegel', desc: 'Kugel an der Kette · schwer zu blocken', dmg: 85, mass: 2.0, price: 1500, tier: 2, tilt: 0.2, flail: { len: 0.3 },
    melee: { minSpeed: 3.0, cleave: 2, head: 2, stun: 0.6, armor: true } },
  kriegshammer: { name: 'Kriegshammer', desc: 'Durchschlägt jede Rüstung · wirft um', dmg: 95, mass: 2.6, price: 1600, tier: 2, tilt: 0.45, twoHand: true,
    melee: { minSpeed: 1.9, cleave: 1, head: 1.8, armor: true, knock: true } },
  speer: { name: 'Speer', desc: 'Stoßen! · durchbohrt 3 Gegner · große Reichweite', dmg: 85, mass: 1.6, price: 900, tier: 1, tilt: 0.1, twoHand: true,
    melee: { minSpeed: 1.3, thrust: true, cleave: 3, head: 2 } },
  hellebarde: { name: 'Hellebarde', desc: 'Stangenwaffe · Hieb und Stoß · trifft 3', dmg: 92, mass: 2.8, price: 1800, tier: 2, tilt: 0.15, twoHand: true,
    melee: { minSpeed: 1.6, cleave: 3, head: 1.8, armor: true } },
  zweihaender: { name: 'Zweihänder', desc: 'Riesige Klinge · trifft mehrere Gegner', dmg: 82, mass: 3.0, price: 1600, tier: 2, tilt: 0.45, twoHand: true,
    melee: { minSpeed: 1.7, cleave: 4, head: 1.6 } },
  kurzbogen: Object.assign({}, BOW_BASE, { name: 'Kurzbogen', desc: 'Sehne mit der anderen Hand spannen', dmg: 70, mass: 0.8, price: 1000, tier: 1,
    bow: { drawLen: 0.5, speed: 38, quiver: 30 } }),
  langbogen: Object.assign({}, BOW_BASE, { name: 'Langbogen', desc: 'Weit, schnell, tödlich · durchschlägt 2', dmg: 125, mass: 1.1, price: 2000, tier: 2,
    bow: { drawLen: 0.62, speed: 55, quiver: 24, pierce: 2 } }),
  armbrust: Object.assign({}, BOW_BASE, { name: 'Armbrust', desc: 'Spannen, dann mit dem Abzug schießen · durchschlägt 2', dmg: 150, mass: 2.4, price: 1700, tier: 2, xbow: true,
    bow: { drawLen: 0.2, speed: 62, quiver: 16, pierce: 2 } }),
  // Schilde (in der zweiten Hand): blocken Angriffe von vorne, zerbrechen nach einigen Treffern; Stoß betäubt
  holzschild: Object.assign({}, SHIELD_BASE, { name: 'Holzschild', desc: 'Hält ein paar Schläge aus', dmg: 14, mass: 1.6, price: 0, tier: 0,
    shield: { hp: 5, size: 0.24 }, melee: { minSpeed: 2.2, cleave: 2, head: 1, stun: 0.9 } }),
  rundschild: Object.assign({}, SHIELD_BASE, { name: 'Rundschild', desc: 'Bemalt, mit Eisenrand · 8 Treffer', dmg: 18, mass: 2.0, price: 500, tier: 1,
    shield: { hp: 8, size: 0.3 }, melee: { minSpeed: 2.2, cleave: 2, head: 1, stun: 1.0 } }),
  drachenschild: Object.assign({}, SHIELD_BASE, { name: 'Drachenschild', desc: 'Langer Normannenschild · 11 Treffer', dmg: 18, mass: 2.6, price: 900, tier: 1,
    shield: { hp: 11, size: 0.36 }, melee: { minSpeed: 2.2, cleave: 2, head: 1, stun: 1.0 } }),
  turmschild: Object.assign({}, SHIELD_BASE, { name: 'Turmschild', desc: 'Riesig und schwer · 16 Treffer', dmg: 22, mass: 4.0, price: 1400, tier: 2,
    shield: { hp: 16, size: 0.45 }, melee: { minSpeed: 2.0, cleave: 3, head: 1, stun: 1.3 } }),
  wappenschild: Object.assign({}, SHIELD_BASE, { name: 'Wappenschild', desc: 'Ritterschild · 13 Treffer · Stoß wirft um', dmg: 30, mass: 2.4, price: 0, tier: 3, boxOnly: true,
    shield: { hp: 13, size: 0.3 }, melee: { minSpeed: 2.0, cleave: 3, head: 1, stun: 1.6, knock: true } }),
  // nur aus der Truhe
  flammenschwert: { name: 'Flammenschwert', desc: 'Setzt Gegner in Brand', dmg: 70, mass: 1.4, price: 0, tier: 3, boxOnly: true, tilt: 0.45, builder: 'langschwert', bladeMat: 'fire',
    melee: { minSpeed: 1.5, cleave: 3, head: 1.6, burn: 14 } },
  donnerhammer: { name: 'Donnerhammer', desc: 'Blitze springen auf Gegner über', dmg: 110, mass: 3.2, price: 0, tier: 3, boxOnly: true, tilt: 0.45, twoHand: true,
    melee: { minSpeed: 1.8, cleave: 2, head: 1.5, chain: 3, stun: 0.8, armor: true } },
  frostbogen: Object.assign({}, BOW_BASE, { name: 'Frostbogen', desc: 'Pfeile frieren Gegner ein', dmg: 100, mass: 1.0, price: 0, tier: 3, boxOnly: true, bladeMat: 'frost',
    bow: { drawLen: 0.55, speed: 48, quiver: 24, freeze: 3 } }),
  frostaxt: { name: 'Frostaxt', desc: 'Friert getroffene Gegner ein', dmg: 90, mass: 2.0, price: 0, tier: 3, boxOnly: true, tilt: 0.45, builder: 'axt', bladeMat: 'frost',
    melee: { minSpeed: 1.8, cleave: 2, head: 1.8, freeze: 2.5, armor: true } }
};
for (const [id, d] of Object.entries(NEW)) WEAPON_DEFS[id] = Object.assign({}, MELEE_BASE, d, { id });
WEAPON_ORDER.length = 0;
WEAPON_ORDER.push(...Object.keys(NEW));
export const STARTER = 'langschwert';
export const STARTER_SHIELD = 'holzschild';
