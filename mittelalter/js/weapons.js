import * as THREE from 'three';
import { MAT, prof, box, cylZ, cylY, sphere, cachedGeo, mergeStatic } from './util.js?v=2';

// Waffen-Grundgerüst: Daten (werden in medieval.js eingetragen), Modellbau, Dolch und Brandbombe.
// Keine Schusswaffen, Magazine oder Visiere mehr – nur noch Mittelalter.
export const WEAPON_ORDER = [];
export const WEAPON_DEFS = {};
export const BUILDERS = {};

// Vorlagen: Modelle, die oft neu erzeugt werden (Magazine, Granaten, Messer), nur einmal bauen und danach klonen.
// Klone teilen sich Geometrie und Material → keine neuen GPU-Puffer pro Exemplar (sonst wächst der Speicher mit jedem Nachladen/Wurf).
const _tpl = {};
export function fromTemplate(key, build) {
  if (!_tpl[key]) { _tpl[key] = build(); _tpl[key].traverse(o => { if (o.geometry) o.geometry.userData.shared = true; }); } // geteilt: nie freigeben
  return _tpl[key].clone();
}
export const makeKnife = () => fromTemplate('knife', buildKnife);
function buildKnife() { // Dolch
  const g = new THREE.Group();
  const leather = new THREE.MeshStandardMaterial({ color: 0x4a2c17, roughness: 0.85 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4ab45, metalness: 0.55, roughness: 0.35 });
  g.add(cylZ(0.011, 0.012, 0.085, leather, -0.015, 0, 0, 8));
  g.add(sphere(0.016, gold, -0.062, 0));
  g.add(box(0.012, 0.075, 0.014, gold, 0.034, 0));
  g.add(prof([[0.04, 0.014], [0.14, 0.009], [0.178, 0.0], [0.14, -0.009], [0.04, -0.014]], 0.005, MAT.bright, 0.001));
  mergeStatic(g, null); // Leistung: gleiche Materialien zu einem Mesh
  return g;
}
// Farbton für Waffen-Varianten (z. B. blaue Schock-Flinte): getönte Material-Kopien, zwischengespeichert
const _tinted = new Map();
function tintModel(model, tint) {
  const col = new THREE.Color(tint);
  model.traverse(o => {
    if (!o.isMesh || o.userData.sight || !o.material || !o.material.isMeshStandardMaterial || o.material.transparent) return;
    const key = o.material.uuid + ':' + tint;
    let m = _tinted.get(key);
    if (!m) { m = o.material.clone(); m.color.lerp(col, 0.5); _tinted.set(key, m); }
    o.material = m;
  });
}
export function buildWeapon(id) {
  const def = WEAPON_DEFS[id];
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const model = new THREE.Group();
  body.add(model);
  const parts = {}, sockets = {};
  const sock = (name, s, y, x = 0) => {
    const o = new THREE.Object3D();
    o.position.set(x, y, -s);
    model.add(o);
    sockets[name] = o;
    return o;
  };
  BUILDERS[def.builder || id](model, parts, sock, def);
  if (def.tint) tintModel(model, def.tint);
  mergeStatic(model, parts);
  const sc = def.scale || 1;
  model.scale.setScalar(sc);
  model.position.set(0, -def.grip[1] * sc, def.grip[0] * sc);
  if (def.tilt) model.rotation.x = def.tilt; // Klinge leicht nach oben (natürliche Schwerthaltung)
  // Ruhe-Positionen der Anker relativ zur Wurzel (für Zweihand-Griff und Desktop-Zielen)
  root.updateMatrixWorld(true);
  const rest = (name) => sockets[name] ? root.worldToLocal(sockets[name].getWorldPosition(new THREE.Vector3())) : null;
  let foreQ = null;
  if (sockets.foregrip) foreQ = new THREE.Quaternion().setFromUnitVectors(rest('foregrip').normalize(), new THREE.Vector3(0, 0, -1));
  // Kollisionsform für die Physik: Bounding-Box im Koordinatensystem der Wurzel
  root.updateMatrixWorld(true);
  const localBox = new THREE.Box3().setFromObject(root);
  return { root, body, model, parts, sockets, def, foreQ, restSightRear: rest('sightRear'), localBox };
}

// Handgranate (Ursprung = Mitte des Körpers)
const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.5, metalness: 0.6 });
export function makeGrenade() {
  const g = fromTemplate('grenade', buildGrenade);
  g.userData.ring = g.getObjectByName('ring');
  return g;
}
function buildGrenade() { // Brandbombe: Eisenkugel mit Lunte
  const g = new THREE.Group();
  const body = new THREE.Mesh(cachedGeo('gren', () => new THREE.SphereGeometry(0.036, 14, 10)), grenadeMat);
  g.add(body);
  g.add(cylY(0.011, 0.013, 0.016, MAT.steel, 0, 0.038));
  const ring = new THREE.Mesh(cachedGeo('grenfuse', () => new THREE.CylinderGeometry(0.0025, 0.0025, 0.035, 5)), fuseMat);
  ring.position.set(0.004, 0.06, 0);
  ring.rotation.z = -0.3;
  g.add(ring);
  ring.name = 'ring';
  mergeStatic(g, { ring });
  return g;
}
const fuseMat = new THREE.MeshStandardMaterial({ color: 0xc8b48a, roughness: 0.9 });
export const MASS = new Proxy({}, { get: (t, k) => (WEAPON_DEFS[k] && WEAPON_DEFS[k].mass) ?? 2 });

// Vollständige Waffe mit Spielzustand
export function createWeapon(id) {
  const w = buildWeapon(id);
  Object.assign(w, { id, holder: -1, phys: null, cooldown: 0, twoHanding: false, desktopBusy: false, reserve: 0, loaded: false });
  if (w.def.shield) w.shieldHp = w.def.shield.hp;
  return w;
}
export function refillWeapon(w) {
  if (w.def.shield) w.shieldHp = w.def.shield.hp;
}
