import * as THREE from 'three';
import { addStaticBox, removeStatic } from './physics.js?v=2';
import { mergeStatic } from './util.js?v=2';

// Raum-Modell: echte Wände, Tische und Stühle des Spielers.
// Jede Fläche bekommt eine sichtbare Vorschau (im Einrichtungsmodus), einen unsichtbaren
// "Verdecker" (echte Möbel verdecken virtuelle Dinge dahinter) und einen statischen Physik-Körper.

export const WALL_HEIGHT = 2.5;
export const room = { surfaces: [], group: new THREE.Group(), edit: false, desktop: false };

const COLORS = { wall: 0x3a8bff, table: 0xff9d2e, chair: 0x46d17a, bench: 0x8a6a45, door: 0xc0702a, window: 0x4dd0ff, wallbuy: 0xffd21f, mbox: 0xb26bff, perk: 0xff4fa0, upgrade: 0x9a5cff, trap: 0xff5a1f };
const NAMES = { wall: 'Wand', table: 'Tisch', chair: 'Stuhl', bench: 'Waffenständer', door: 'Tür', window: 'Fenster', wallbuy: 'Wandkauf', mbox: 'Glückskiste', perk: 'Automat', upgrade: 'Aufrüster', trap: 'Falle' };
// an der Wand angebrachte Plätze (Position + Wandrichtung)
export const isWallMount = (s) => s.type === 'wallbuy' || s.type === 'perk' || s.type === 'upgrade' || s.type === 'trap';
const MARKER_SIZE = { wallbuy: [0.8, 0.35, 1.35], perk: [0.44, 1.23, 0.62], upgrade: [0.63, 0.84, 0.42], trap: [1.4, 1.4, 0.01] };
export const isOpening = (s) => s.type === 'door' || s.type === 'window';
export const surfaceName = (t) => NAMES[t];
const occluderMat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
const UP = new THREE.Vector3(0, 1, 0);
const rand = (a, b) => a + Math.random() * (b - a);

function visualMaterial(type) {
  if (type === 'bench') return new THREE.MeshStandardMaterial({ color: COLORS.bench, roughness: 0.7 });
  return new THREE.MeshBasicMaterial({ color: COLORS[type], transparent: true, opacity: room.desktop ? 0.55 : 0.28, depthWrite: false, side: THREE.DoubleSide });
}

// Öffnungen (Türen/Fenster), die in einer Wand liegen – als Rechtecke in Wand-Koordinaten
function holesFor(w) {
  const holes = [];
  for (const o of room.surfaces) {
    if (!isOpening(o)) continue;
    if (Math.abs(o.normal.dot(w.normal)) < 0.9) continue;
    if (Math.abs(o.mid.clone().sub(w.mid).dot(w.normal)) > 0.3) continue;
    const u0 = o.a.clone().sub(w.a).dot(w.right), u1 = o.a.clone().addScaledVector(o.right, o.width).sub(w.a).dot(w.right);
    const a = Math.max(0.01, Math.min(u0, u1)), b = Math.min(w.width - 0.01, Math.max(u0, u1));
    const lo = Math.max(0.01, o.bottom), hi = Math.min(w.height - 0.01, o.top);
    if (b - a > 0.05 && hi - lo > 0.05) holes.push([a - w.width / 2, b - w.width / 2, lo - w.height / 2, hi - w.height / 2]);
  }
  return holes;
}
function wallGeometry(w) {
  const hw = w.width / 2, hh = w.height / 2;
  const shape = new THREE.Shape([new THREE.Vector2(-hw, -hh), new THREE.Vector2(hw, -hh), new THREE.Vector2(hw, hh), new THREE.Vector2(-hw, hh)]);
  for (const [x0, x1, y0, y1] of holesFor(w)) {
    shape.holes.push(new THREE.Path([new THREE.Vector2(x0, y0), new THREE.Vector2(x0, y1), new THREE.Vector2(x1, y1), new THREE.Vector2(x1, y0)]));
  }
  return new THREE.ShapeGeometry(shape);
}

function buildMarker(s) {
  // Wandkauf-Platz: gelbe Markierung an der Wand (nur im Einrichtungsmodus sichtbar)
  const g = new THREE.Group();
  const [mw, mh, my] = MARKER_SIZE[s.type];
  const geo = new THREE.PlaneGeometry(mw, mh);
  g.position.copy(s.pos).addScaledVector(s.normal, 0.01);
  if (s.type !== 'wallbuy') g.position.y = my;
  g.lookAt(g.position.clone().add(s.normal));
  if (s.type === 'trap') { g.position.copy(s.pos).setY(0.012); g.rotation.set(-Math.PI / 2, 0, Math.atan2(s.normal.x, s.normal.z)); }
  const visual = new THREE.Mesh(geo, visualMaterial(s.type));
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: COLORS[s.type] }));
  g.add(visual, edges);
  Object.assign(s, { visual, edges, group: g, occluder: null, body: null });
  room.group.add(g);
  applyMode(s);
}
export function addWallbuy(pos, normal, type = 'wallbuy', kind = null) {
  const s = { type, kind, pos: pos.clone(), normal: new THREE.Vector3(normal.x, 0, normal.z).normalize() };
  s.center = s.pos;
  room.surfaces.push(s);
  buildMarker(s);
  return s;
}
function buildSurface(s) {
  if (isWallMount(s)) { buildMarker(s); return; }
  const g = new THREE.Group();
  let geo, basisQ;
  const vertical = s.type === 'wall' || isOpening(s);
  if (vertical) {
    basisQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(s.right, UP, s.normal));
    g.position.copy(s.center);
    geo = s.type === 'wall' ? wallGeometry(s) : new THREE.PlaneGeometry(s.width, s.top - s.bottom);
  } else {
    geo = new THREE.BoxGeometry(s.hx * 2, s.height, s.hz * 2);
    basisQ = new THREE.Quaternion().setFromAxisAngle(UP, s.yaw);
    g.position.set(s.center.x, s.height / 2, s.center.z);
  }
  g.quaternion.copy(basisQ);
  const visual = new THREE.Mesh(geo, visualMaterial(s.type));
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: COLORS[s.type] }));
  g.add(visual, edges);
  s.occluder = null;
  if (!isOpening(s) && s.type !== 'mbox') { // die Glückskiste ist virtuell – kein echtes Möbelstück
    const occ = new THREE.Mesh(geo, occluderMat);
    occ.renderOrder = -10;
    occ.userData.surface = s;
    g.add(occ);
    s.occluder = occ;
  }
  if (isOpening(s)) buildBackdrop(s, g);
  s.visual = visual;
  s.edges = edges;
  s.group = g;
  room.group.add(g);
  // Physik
  s.body = null;
  if (s.type === 'wall') {
    s.body = addStaticBox(s.center.clone().addScaledVector(s.normal, -0.15), new THREE.Vector3(s.width / 2, s.height / 2, 0.15), basisQ);
  } else if (!isOpening(s)) {
    s.body = addStaticBox(g.position, new THREE.Vector3(s.hx, s.height / 2, s.hz), basisQ);
  }
  applyMode(s);
}
// ---- Hintergrund hinter Türen/Fenstern: dunkler Flur bzw. Nacht draußen ----------------
function gradientTex(top, bottom, fog) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, top); g.addColorStop(1, bottom);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 300; i++) { // Schmutz/Struktur
    ctx.fillStyle = `rgba(${fog},${Math.random() * 0.08})`;
    ctx.fillRect(Math.random() * 64, Math.random() * 256, 1 + Math.random() * 4, 1 + Math.random() * 6);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const BACKDROP = {
  door: new THREE.MeshBasicMaterial({ map: gradientTex('#1a1a1c', '#070708', '120,120,130'), side: THREE.BackSide, fog: false }),
  window: new THREE.MeshBasicMaterial({ map: gradientTex('#0d1626', '#04060a', '150,170,200'), side: THREE.BackSide, fog: false })
};
const corridorFloor = new THREE.MeshBasicMaterial({ color: 0x141210 });
const lampMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false });
// kahle Bäume als Silhouette vor dem Nachthimmel (sichtbar vor allem bei Blitzen)
const treeTex = (() => {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#000'; ctx.fillStyle = '#000'; ctx.lineCap = 'round';
  const branch = (x, y, len, ang, wdt, depth) => {
    if (depth <= 0 || len < 4) return;
    const x2 = x + Math.cos(ang) * len, y2 = y - Math.sin(ang) * len;
    ctx.lineWidth = wdt; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
    const n = 2 + (Math.random() < 0.4 ? 1 : 0);
    for (let i = 0; i < n; i++) branch(x2, y2, len * (0.6 + Math.random() * 0.2), ang + (Math.random() - 0.5) * 1.3, wdt * 0.65, depth - 1);
  };
  for (let i = 0; i < 6; i++) branch(30 + i * 90 + Math.random() * 40, 256, 50 + Math.random() * 40, Math.PI / 2 + (Math.random() - 0.5) * 0.3, 9, 6);
  ctx.beginPath(); ctx.moveTo(0, 256); // Horizont/Hügel
  for (let x = 0; x <= 512; x += 16) ctx.lineTo(x, 232 + Math.sin(x * 0.02) * 10 + Math.random() * 4);
  ctx.lineTo(512, 256); ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const treeMat = new THREE.MeshBasicMaterial({ map: treeTex, transparent: true, depthWrite: false, fog: false });
// Stimmung: Flackerlicht im Flur (doorK) und Blitze draußen vor dem Fenster (windowK), jeweils 0..1+
export function setAtmosphere(doorK, windowK) {
  BACKDROP.door.color.setRGB(1 + doorK * 1.6, 1 + doorK * 0.4, 1 + doorK * 0.3);
  corridorFloor.color.setRGB(0.08 + doorK * 0.25, 0.07 + doorK * 0.04, 0.06 + doorK * 0.03);
  lampMat.color.setRGB(0.3 + doorK * 0.7, 0.04 + doorK * 0.12, 0.02);
  BACKDROP.window.color.setRGB(1 + windowK * 12, 1 + windowK * 13, 1 + windowK * 15);
  mistMat.opacity = 0.55 - windowK * 0.35;
}
const mistMat = new THREE.MeshBasicMaterial({ color: 0x0a0c10, transparent: true, opacity: 0.55, depthWrite: false });
const frameMat = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.8 });
const DEPTH = 5;
function buildBackdrop(s, g) {
  const h = s.top - s.bottom, w = s.width;
  const back = new THREE.Group();
  // Tunnel nach hinten (Innenseiten sichtbar)
  const box = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, h + 0.4, DEPTH), BACKDROP[s.type]);
  box.position.set(0, 0, -DEPTH / 2 - 0.01);
  back.add(box);
  if (s.type === 'door') {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.6, DEPTH), corridorFloor);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -h / 2 + 0.002, -DEPTH / 2);
    back.add(floor);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.08), lampMat); // Notlicht an der Flurdecke
    lamp.position.set(0, h / 2 + 0.15, -2.2);
    back.add(lamp);
  }
  if (s.type === 'window') {
    const trees = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.6, h + 0.4), treeMat);
    trees.position.z = -DEPTH + 0.05;
    back.add(trees);
  }
  // Nebel-Schichten für Tiefe
  for (let i = 1; i <= 3; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.6, h + 0.4), mistMat);
    m.position.z = -i * DEPTH / 4;
    back.add(m);
  }
  // unsichtbarer Rand: der Hintergrund ist nur durch die Öffnung zu sehen
  const hw = w / 2, hh = h / 2, M = 1.2;
  const shape = new THREE.Shape([new THREE.Vector2(-hw - M, -hh - M), new THREE.Vector2(hw + M, -hh - M), new THREE.Vector2(hw + M, hh + M), new THREE.Vector2(-hw - M, hh + M)]);
  shape.holes.push(new THREE.Path([new THREE.Vector2(-hw, -hh), new THREE.Vector2(-hw, hh), new THREE.Vector2(hw, hh), new THREE.Vector2(hw, -hh)]));
  const ring = new THREE.Mesh(new THREE.ShapeGeometry(shape), occluderMat);
  ring.renderOrder = -10;
  ring.position.z = -0.01; // knapp hinter der Wandebene (kein Flimmern)
  back.add(ring);
  // Rahmen (Tür-/Fensterrahmen) und Fensterbank
  const t = 0.06, d = 0.1;
  const piece = (bw, bh, x, y) => { const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, d), frameMat); m.position.set(x, y, -d / 2 + 0.03); back.add(m); };
  piece(t, h + t, -hw - t / 2, t / 2);
  piece(t, h + t, hw + t / 2, t / 2);
  piece(w + 2 * t, t, 0, hh + t / 2);
  if (s.type === 'window') { piece(w + 2 * t + 0.08, t, 0, -hh - t / 2); }
  mergeStatic(back, null); // Leistung: feste Teile zusammenfassen
  g.add(back);
  s.backdrop = back;
}

// Wände neu aufbauen (z. B. wenn eine Tür dazukommt, bekommt die Wand ein Loch)
function rebuildWalls() {
  for (const w of room.surfaces) if (w.type === 'wall') { destroySurface(w); buildSurface(w); }
}
export const roomOccluders = () => room.surfaces.filter(s => s.occluder).map(s => s.occluder);
function applyMode(s) {
  const show = room.edit || (room.desktop && !isOpening(s) && !isWallMount(s) && s.type !== 'mbox') || s.type === 'bench';
  s.visual.visible = show;
  s.edges.visible = room.edit || (room.desktop && s.type !== 'bench' && !isWallMount(s) && s.type !== 'mbox');
}
function destroySurface(s) {
  room.group.remove(s.group);
  if (s.backdrop) s.backdrop.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  s.visual.geometry.dispose();
  s.edges.geometry.dispose();
  if (s.body) removeStatic(s.body);
}

export function setEditMode(on) {
  room.edit = on;
  room.surfaces.forEach(applyMode);
}

// Wand aus zwei berührten Punkten (Höhe egal) – die Vorderseite zeigt zum Spieler
export function makeWall(a, b, insidePoint, height = WALL_HEIGHT) {
  const A = new THREE.Vector3(a.x, 0, a.z), B = new THREE.Vector3(b.x, 0, b.z);
  const width = A.distanceTo(B);
  if (width < 0.25) return null;
  const dir = B.clone().sub(A).normalize();
  const normal = new THREE.Vector3(-dir.z, 0, dir.x);
  const mid = A.clone().add(B).multiplyScalar(0.5);
  if (insidePoint && normal.dot(insidePoint.clone().sub(mid)) < 0) normal.negate();
  const right = UP.clone().cross(normal);
  return {
    type: 'wall', width, height, normal, right, mid,
    a: mid.clone().addScaledVector(right, -width / 2),
    center: mid.clone().addScaledVector(UP, height / 2)
  };
}
export function addWall(a, b, insidePoint, height) {
  const s = makeWall(a, b, insidePoint, height);
  if (!s) return null;
  room.surfaces.push(s);
  buildSurface(s);
  return s;
}

// Tür/Fenster: Breite auf dem Boden (zwei Punkte), Unter- und Oberkante
export function makeOpening(type, a, b, insidePoint, bottom, top) {
  const w = makeWall(a, b, insidePoint, top);
  if (!w) return null;
  return Object.assign(w, { type, bottom, top, height: top, center: w.mid.clone().setY((bottom + top) / 2) });
}
export function addOpening(type, a, b, insidePoint, bottom, top) {
  const s = makeOpening(type, a, b, insidePoint, bottom, top);
  if (!s) return null;
  room.surfaces.push(s);
  buildSurface(s);
  rebuildWalls();
  return s;
}

// Tisch/Stuhl aus zwei diagonal gegenüberliegenden Ecken der Oberfläche + Drehung
export function makeBox(type, p1, p2, yaw) {
  const height = (p1.y + p2.y) / 2;
  const X = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const Z = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const d = new THREE.Vector3(p2.x - p1.x, 0, p2.z - p1.z);
  const hx = Math.max(0.1, Math.abs(d.dot(X)) / 2), hz = Math.max(0.1, Math.abs(d.dot(Z)) / 2);
  const center = new THREE.Vector3((p1.x + p2.x) / 2, height, (p1.z + p2.z) / 2);
  return { type, p1: p1.clone(), p2: p2.clone(), yaw, height, hx, hz, center, X, Z };
}
export function addBox(type, p1, p2, yaw) {
  const s = makeBox(type, p1, p2, yaw);
  if (s.height < 0.12) return null;
  room.surfaces.push(s);
  buildSurface(s);
  return s;
}
export function rotateBox(s, yaw) {
  destroySurface(s);
  Object.assign(s, makeBox(s.type, s.p1, s.p2, yaw));
  buildSurface(s);
}
export function removeSurface(s) {
  destroySurface(s);
  room.surfaces.splice(room.surfaces.indexOf(s), 1);
  if (isOpening(s)) rebuildWalls();
}
export function clearRoom(keepBench = false) {
  for (const s of [...room.surfaces]) if (!(keepBench && s.type === 'bench')) removeSurface(s);
}
export const surfacesOf = (...types) => room.surfaces.filter(s => types.includes(s.type));

// Wahrscheinlichste Ausrichtung für neue Möbel: parallel zur nächsten Wand
export function suggestYaw(point, fallbackYaw) {
  let best = null, bd = Infinity;
  for (const w of surfacesOf('wall')) {
    const d = Math.abs(point.clone().sub(w.mid).dot(w.normal));
    if (d < bd) { bd = d; best = w; }
  }
  return best ? Math.atan2(-best.right.z, best.right.x) : fallbackYaw;
}

// Höhe der obersten Fläche an einer Stelle (für liegende Hülsen etc.)
export function heightAt(x, z) {
  let h = 0;
  for (const s of room.surfaces) {
    if (s.type === 'wall' || isOpening(s) || isWallMount(s)) continue;
    const dx = x - s.center.x, dz = z - s.center.z;
    if (Math.abs(dx * s.X.x + dz * s.X.z) <= s.hx && Math.abs(dx * s.Z.x + dz * s.Z.z) <= s.hz) h = Math.max(h, s.height);
  }
  return h;
}

// Zufällige Stelle auf einer Wand bzw. auf einer Oberfläche
export function wallSpot(s, margin = 0.35) {
  const u = s.width > margin * 2 ? rand(margin, s.width - margin) : s.width / 2;
  const y = rand(0.75, Math.max(0.8, Math.min(2.1, s.height - 0.3)));
  return { surface: s, u, y, pos: s.a.clone().addScaledVector(s.right, u).setY(y).addScaledVector(s.normal, 0.012), normal: s.normal.clone() };
}
export function topSpot(s, inset = 0.1) {
  const lx = s.hx > inset ? rand(-s.hx + inset, s.hx - inset) : 0;
  const lz = s.hz > inset ? rand(-s.hz + inset, s.hz - inset) : 0;
  return { surface: s, pos: s.center.clone().addScaledVector(s.X, lx).addScaledVector(s.Z, lz) };
}

// Raum aus der Quest-Raumeinrichtung übernehmen (WebXR Plane Detection)
export function importDetectedPlanes(frame, refSpace) {
  const planes = frame && frame.detectedPlanes;
  if (!planes || !refSpace) return -1;
  let n = 0;
  const openings = [];
  planes.forEach((plane) => {
    const pose = frame.getPose(plane.planeSpace, refSpace);
    if (!pose || !plane.polygon || plane.polygon.length < 3) return;
    const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
    const label = (plane.semanticLabel || '').toLowerCase();
    const normal = new THREE.Vector3(0, 1, 0).transformDirection(m);
    const pts = plane.polygon.map(p => new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(m));
    if (Math.abs(normal.y) < 0.3) {
      const kind = label === 'door frame' ? 'door' : label === 'window frame' ? 'window' : (!label || label === 'wall') ? 'wall' : null;
      if (!kind) return;
      const nH = new THREE.Vector3(normal.x, 0, normal.z).normalize();
      const t = new THREE.Vector3(-nH.z, 0, nH.x);
      let min = Infinity, max = -Infinity, top = 0, bottom = Infinity;
      for (const p of pts) { const u = p.clone().sub(pts[0]).dot(t); min = Math.min(min, u); max = Math.max(max, u); top = Math.max(top, p.y); bottom = Math.min(bottom, p.y); }
      const A = pts[0].clone().addScaledVector(t, min), B = pts[0].clone().addScaledVector(t, max);
      const mid = A.clone().add(B).multiplyScalar(0.5);
      const inside = mid.clone().addScaledVector(nH, 1);
      if (kind === 'wall') { if (addWall(A, B, inside, Math.max(1.2, top))) n++; }
      else openings.push([kind, A, B, inside, kind === 'door' ? 0 : Math.max(0.2, bottom), top]);
    } else if (normal.y > 0.7) {
      const h = pts[0].y;
      if (label === 'floor' || label === 'ceiling' || h < 0.2 || h > 1.4) return;
      const type = ['couch', 'bed', 'chair', 'seat'].includes(label) ? 'chair' : 'table';
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const p of plane.polygon) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
      const P1 = new THREE.Vector3(minX, 0, minZ).applyMatrix4(m), P2 = new THREE.Vector3(maxX, 0, maxZ).applyMatrix4(m);
      const xAxis = new THREE.Vector3(1, 0, 0).transformDirection(m);
      if (addBox(type, P1.setY(h), P2.setY(h), Math.atan2(-xAxis.z, xAxis.x))) n++;
    }
  });
  // Türen/Fenster erst nach den Wänden (damit die Wände Löcher bekommen)
  for (const o of openings) if (addOpening(...o)) n++;
  return n;
}

// Speichern / Laden (Koordinaten relativ zum Startpunkt der VR-Sitzung)
const KEY = 'vrspiel-raum';
export function serializeRoom() {
  return room.surfaces.map(s => isOpening(s)
    ? { type: s.type, a: s.a.toArray(), b: s.a.clone().addScaledVector(s.right, s.width).toArray(), inside: s.mid.clone().add(s.normal).toArray(), bottom: s.bottom, top: s.top }
    : s.type === 'wall'
    ? { type: 'wall', a: s.a.toArray(), b: s.a.clone().addScaledVector(s.right, s.width).toArray(), height: s.height, inside: s.mid.clone().add(s.normal).toArray() }
    : isWallMount(s)
    ? { type: s.type, kind: s.kind, pos: s.pos.toArray(), normal: s.normal.toArray() }
    : { type: s.type, p1: s.p1.toArray(), p2: s.p2.toArray(), yaw: s.yaw });
}
// Raum aus Daten aufbauen; optional gedreht (um pivot, Winkel um die Hochachse) und verschoben
export function deserializeRoom(data, angle = 0, pivot = new THREE.Vector3(), offset = new THREE.Vector3()) {
  clearRoom();
  const q = new THREE.Quaternion().setFromAxisAngle(UP, angle);
  const P = (a) => new THREE.Vector3().fromArray(a).sub(pivot).applyQuaternion(q).add(pivot).add(offset);
  const D = (a) => new THREE.Vector3().fromArray(a).applyQuaternion(q);
  const walls = [], rest = [];
  for (const d of data) (d.type === 'door' || d.type === 'window' ? rest : walls).push(d);
  for (const d of walls) {
    if (d.type === 'wall') addWall(P(d.a), P(d.b), P(d.inside), d.height);
    else if (d.type === 'wallbuy' || d.type === 'perk' || d.type === 'upgrade' || d.type === 'trap') addWallbuy(P(d.pos), D(d.normal), d.type, d.kind || null);
    else addBox(d.type, P(d.p1), P(d.p2), d.yaw + angle);
  }
  for (const d of rest) addOpening(d.type, P(d.a), P(d.b), P(d.inside), d.bottom, d.top);
  return data.length;
}
export function saveRoom() {
  try { localStorage.setItem(KEY, JSON.stringify(serializeRoom())); } catch { /* ignorieren */ }
}
// mehrere Speicherplätze
const SLOTS_KEY = 'vrspiel-raeume';
export function roomSlots() {
  try { const v = JSON.parse(localStorage.getItem(SLOTS_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function saveRoomSlot(i) {
  const slots = roomSlots();
  while (slots.length <= i) slots.push(null);
  const data = serializeRoom();
  slots[i] = { data, date: Date.now(), count: data.length };
  try { localStorage.setItem(SLOTS_KEY, JSON.stringify(slots)); } catch { /* ignorieren */ }
}
export function loadRoomSlot(i) {
  const slot = roomSlots()[i];
  if (!slot) return 0;
  return deserializeRoom(slot.data);
}
export function hasSavedRoom() {
  try { return !!localStorage.getItem(KEY); } catch { return false; }
}
export function loadRoom() {
  let data;
  try { data = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return 0; }
  return deserializeRoom(data);
}

// ---- Wände automatisch zu einem geschlossenen Raum verbinden ---------------------------------
// Lücken zwischen Wandenden werden geschlossen: Ecken werden bis zum Schnittpunkt verlängert,
// Enden nahe an einer anderen Wand rasten dort ein (T-Stoß), sonst entsteht eine Verbindungswand.
const END_EPS = 0.03;
function wallEndsInfo() {
  const out = [];
  for (const w of surfacesOf('wall')) {
    const A = w.a.clone().setY(0), B = w.a.clone().addScaledVector(w.right, w.width).setY(0);
    out.push({ w, which: 'a', p: A, other: B }, { w, which: 'b', p: B, other: A });
  }
  return out;
}
function onOtherWall(e) {
  for (const w of surfacesOf('wall')) {
    if (w === e.w) continue;
    const rel = e.p.clone().sub(w.a);
    const u = rel.dot(w.right);
    if (u > -END_EPS && u < w.width + END_EPS && Math.abs(rel.dot(w.normal)) < 0.02) return true;
  }
  return false;
}
function freeEnds(ends) {
  return ends.filter(e => !ends.some(o => o.w !== e.w && o.p.distanceTo(e.p) < END_EPS) && !onOtherWall(e));
}
function replaceWall(w, A, B) {
  const inside = w.mid.clone().add(w.normal), h = w.height;
  removeSurface(w);
  return addWall(A, B, inside, h);
}
// Schnittpunkt zweier Geraden (p1 + t*d1, p2 + s*d2) in der Bodenebene
function lineIntersect(p1, d1, p2, d2) {
  const den = d1.x * d2.z - d1.z * d2.x;
  if (Math.abs(den) < 1e-6) return null;
  const t = ((p2.x - p1.x) * d2.z - (p2.z - p1.z) * d2.x) / den;
  return new THREE.Vector3(p1.x + d1.x * t, 0, p1.z + d1.z * t);
}
// Mittelpunkt aller Wände ≈ Raummitte (für die Innenseite neuer Wände)
function roomCenter() { const ws = surfacesOf('wall'); const c = new THREE.Vector3(); for (const w of ws) c.add(w.mid); return ws.length ? c.divideScalar(ws.length).setY(0) : c; }
const dirOf = (e) => e.p.clone().sub(e.other).setY(0).normalize(); // zeigt aus der Wand heraus
// Ein freies Ende auf einen Punkt setzen (Wand wird verlängert bzw. gekürzt)
function moveEnd(e, P) {
  if (P.distanceTo(e.other) < 0.25) return null;
  return replaceWall(e.w, e.which === 'a' ? P : e.other, e.which === 'a' ? e.other : P);
}
export function closeRoomGaps(maxGap = 0.9) {
  let fixed = 0;
  for (let iter = 0; iter < 40; iter++) {
    const ends = wallEndsInfo();
    const free = freeEnds(ends);
    let best = null, bd = maxGap;
    // 1) zwei freie Enden nahe beieinander
    for (let i = 0; i < free.length; i++) for (let j = i + 1; j < free.length; j++) {
      const a = free[i], b = free[j];
      if (a.w === b.w) continue;
      const d = a.p.distanceTo(b.p);
      if (d < bd) { bd = d; best = { kind: 'pair', a, b }; }
    }
    // 2) freies Ende nahe an einer anderen Wand (T-Stoß)
    if (!best) {
      for (const e of free) for (const w of surfacesOf('wall')) {
        if (w === e.w) continue;
        const rel = e.p.clone().sub(w.a);
        const u = rel.dot(w.right), off = Math.abs(rel.dot(w.normal));
        if (u > 0.05 && u < w.width - 0.05 && off > 0.01 && off < Math.min(maxGap, 0.45) && off < bd) { bd = off; best = { kind: 'tee', e, w }; }
      }
    }
    if (!best) break;
    if (best.kind === 'tee') {
      const X = lineIntersect(best.e.p, dirOf(best.e), best.w.a, best.w.right);
      if (!X || !moveEnd(best.e, X)) break;
      fixed++;
      continue;
    }
    const { a, b } = best;
    const da = dirOf(a), db = dirOf(b);
    if (a.p.distanceTo(b.p) < END_EPS) break;
    let ok = false;
    if (Math.abs(da.dot(db)) < 0.96) {
      // Ecke: beide Wände bis zum Schnittpunkt verlängern/kürzen
      const X = lineIntersect(a.p, da, b.p, db);
      if (X && X.distanceTo(a.p) < maxGap * 1.6 && X.distanceTo(b.p) < maxGap * 1.6) {
        const bw = b.w, bWhich = b.which, bOther = b.other;
        if (moveEnd(a, X)) {
          const nb = surfacesOf('wall').find(w => w === bw);
          if (nb) replaceWall(nb, bWhich === 'a' ? X : bOther, bWhich === 'a' ? bOther : X);
          ok = true;
        }
      }
    }
    if (!ok) {
      // (fast) parallel oder kein sinnvoller Schnittpunkt: Ende an das andere Ende setzen bzw. Verbindungswand
      const perp = Math.abs(b.p.clone().sub(a.p).dot(new THREE.Vector3(-da.z, 0, da.x)));
      if (perp < 0.12 && Math.abs(da.dot(db)) > 0.96) ok = !!moveEnd(a, b.p.clone());
      if (!ok) ok = !!addWall(a.p.clone(), b.p.clone(), roomCenter(), a.w.height);
    }
    if (!ok) break;
    fixed++;
  }
  return fixed;
}
// Raum ganz schließen: bleiben genau zwei offene Enden, werden sie mit einer Wand verbunden
export function closeRoom() {
  let n = closeRoomGaps(1.2);
  const free = freeEnds(wallEndsInfo());
  if (free.length === 2 && free[0].w !== free[1].w && free[0].p.distanceTo(free[1].p) < 8) {
    const a = free[0], b = free[1];
    // Wenn die beiden Wände senkrecht zueinander stehen: über eine Ecke schließen (zwei Wände)
    const X = lineIntersect(a.p, dirOf(a), b.p, dirOf(b));
    const forwardA = X && X.clone().sub(a.p).dot(dirOf(a)) > 0.2, forwardB = X && X.clone().sub(b.p).dot(dirOf(b)) > 0.2;
    if (X && forwardA && forwardB && Math.abs(dirOf(a).dot(dirOf(b))) < 0.3) {
      const ins = roomCenter();
      if (addWall(a.p.clone(), X, ins, a.w.height)) n++;
      if (addWall(X, b.p.clone(), ins, a.w.height)) n++;
    } else if (addWall(a.p.clone(), b.p.clone(), roomCenter(), a.w.height)) n++;
    n += closeRoomGaps(0.3);
  }
  return n;
}
export const openWallEnds = () => freeEnds(wallEndsInfo()).length;
