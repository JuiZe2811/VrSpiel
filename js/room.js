import * as THREE from 'three';
import { addStaticBox, removeStatic } from './physics.js';

// Raum-Modell: echte Wände, Tische und Stühle des Spielers.
// Jede Fläche bekommt eine sichtbare Vorschau (im Einrichtungsmodus), einen unsichtbaren
// "Verdecker" (echte Möbel verdecken virtuelle Dinge dahinter) und einen statischen Physik-Körper.

export const WALL_HEIGHT = 2.5;
export const room = { surfaces: [], group: new THREE.Group(), edit: false, desktop: false };

const COLORS = { wall: 0x3a8bff, table: 0xff9d2e, chair: 0x46d17a, bench: 0x8a6a45 };
const NAMES = { wall: 'Wand', table: 'Tisch', chair: 'Stuhl', bench: 'Waffentisch' };
export const surfaceName = (t) => NAMES[t];
const occluderMat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
const UP = new THREE.Vector3(0, 1, 0);
const rand = (a, b) => a + Math.random() * (b - a);

function visualMaterial(type) {
  if (type === 'bench') return new THREE.MeshStandardMaterial({ color: COLORS.bench, roughness: 0.7 });
  return new THREE.MeshBasicMaterial({ color: COLORS[type], transparent: true, opacity: room.desktop ? 0.55 : 0.28, depthWrite: false, side: THREE.DoubleSide });
}

function buildSurface(s) {
  const g = new THREE.Group();
  let geo, basisQ;
  if (s.type === 'wall') {
    geo = new THREE.PlaneGeometry(s.width, s.height);
    basisQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(s.right, UP, s.normal));
    g.position.copy(s.center);
  } else {
    geo = new THREE.BoxGeometry(s.hx * 2, s.height, s.hz * 2);
    basisQ = new THREE.Quaternion().setFromAxisAngle(UP, s.yaw);
    g.position.set(s.center.x, s.height / 2, s.center.z);
  }
  g.quaternion.copy(basisQ);
  const visual = new THREE.Mesh(geo, visualMaterial(s.type));
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: COLORS[s.type] }));
  const occ = new THREE.Mesh(geo, occluderMat);
  occ.renderOrder = -10;
  occ.userData.surface = s;
  g.add(occ, visual, edges);
  s.visual = visual;
  s.edges = edges;
  s.occluder = occ;
  s.group = g;
  room.group.add(g);
  // Physik
  if (s.type === 'wall') {
    s.body = addStaticBox(s.center.clone().addScaledVector(s.normal, -0.15), new THREE.Vector3(s.width / 2, s.height / 2, 0.15), basisQ);
  } else {
    s.body = addStaticBox(g.position, new THREE.Vector3(s.hx, s.height / 2, s.hz), basisQ);
  }
  applyMode(s);
}
function applyMode(s) {
  const show = room.edit || room.desktop || s.type === 'bench';
  s.visual.visible = show;
  s.edges.visible = room.edit || (room.desktop && s.type !== 'bench');
}
function destroySurface(s) {
  room.group.remove(s.group);
  s.visual.geometry.dispose();
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
    if (s.type === 'wall') continue;
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
  planes.forEach((plane) => {
    const pose = frame.getPose(plane.planeSpace, refSpace);
    if (!pose || !plane.polygon || plane.polygon.length < 3) return;
    const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
    const label = (plane.semanticLabel || '').toLowerCase();
    const normal = new THREE.Vector3(0, 1, 0).transformDirection(m);
    const pts = plane.polygon.map(p => new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(m));
    if (Math.abs(normal.y) < 0.3) {
      if (label && label !== 'wall') return; // Türen/Fenster liegen ohnehin in Wänden
      const nH = new THREE.Vector3(normal.x, 0, normal.z).normalize();
      const t = new THREE.Vector3(-nH.z, 0, nH.x);
      let min = Infinity, max = -Infinity, top = 0;
      for (const p of pts) { const u = p.clone().sub(pts[0]).dot(t); min = Math.min(min, u); max = Math.max(max, u); top = Math.max(top, p.y); }
      const A = pts[0].clone().addScaledVector(t, min), B = pts[0].clone().addScaledVector(t, max);
      const mid = A.clone().add(B).multiplyScalar(0.5);
      if (addWall(A, B, mid.addScaledVector(nH, 1), Math.max(1.2, top))) n++;
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
  return n;
}

// Speichern / Laden (Koordinaten relativ zum Startpunkt der VR-Sitzung)
const KEY = 'vrspiel-raum';
export function saveRoom() {
  const data = room.surfaces.map(s => s.type === 'wall'
    ? { type: 'wall', a: s.a.toArray(), b: s.a.clone().addScaledVector(s.right, s.width).toArray(), height: s.height, inside: s.mid.clone().add(s.normal).toArray() }
    : { type: s.type, p1: s.p1.toArray(), p2: s.p2.toArray(), yaw: s.yaw });
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* ignorieren */ }
}
export function hasSavedRoom() {
  try { return !!localStorage.getItem(KEY); } catch { return false; }
}
export function loadRoom() {
  let data;
  try { data = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return 0; }
  clearRoom();
  const v = (a) => new THREE.Vector3().fromArray(a);
  for (const d of data) {
    if (d.type === 'wall') addWall(v(d.a), v(d.b), v(d.inside), d.height);
    else addBox(d.type, v(d.p1), v(d.p2), d.yaw);
  }
  return data.length;
}
