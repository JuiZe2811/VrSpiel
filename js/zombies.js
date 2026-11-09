import * as THREE from 'three';
import { room, surfacesOf, isOpening } from './room.js?v=18';
import { addDynamic, removeDynamic, localBoxOf, addKinematicBox, setKinematicPose, resizeKinematic, removeBody } from './physics.js?v=18';
import { SFX3D } from './sfx.js?v=18';
import { burst, addDebris, shockwave } from './effects.js?v=18';
import { cachedGeo } from './util.js?v=18';

// =============================================================================
// Zombies: kommen durch Türen und Fenster (reißen erst die Bretter ab),
// laufen um Wände/Tische/Stühle herum zum Spieler und greifen an.
// Trefferzonen: Kopf (x3), Körper, Arme (können abfallen), Beine (Humpeln / Kriechen).
// =============================================================================
let scene, onPlayerHit = () => {}, onBump = () => {}, onStomp = null;
const corpses = [];
export const zombies = [];
const planks = [];
const rand = THREE.MathUtils.randFloat;
const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();

export function initZombies(s, hitCallback, bumpCallback, stompCallback) { scene = s; onPlayerHit = hitCallback; if (bumpCallback) onBump = bumpCallback; if (stompCallback) onStomp = stompCallback; }

// ---- Aussehen -------------------------------------------------------------------
// Alle Formen und Texturen werden geteilt (kein Speicherleck bei vielen Zombies).
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function grime(ctx, w, h, n, blood = 0.25) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = Math.random() < blood ? `rgba(${90 + Math.random() * 60},0,0,${0.4 + Math.random() * 0.5})` : `rgba(0,0,0,${Math.random() * 0.35})`;
    ctx.beginPath();
    ctx.ellipse(Math.random() * w, Math.random() * h, 1 + Math.random() * w / 30, 1 + Math.random() * h / 40, Math.random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
}
const clothTex = (base) => canvasTex(64, 64, (ctx, w, h) => {
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  grime(ctx, w, h, 60, 0.3);
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; // Risse
  for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(Math.random() * w, Math.random() * h); ctx.lineTo(Math.random() * w, Math.random() * h); ctx.stroke(); }
});
const skinTex = (base) => canvasTex(64, 64, (ctx, w, h) => {
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  grime(ctx, w, h, 40, 0.35);
  ctx.strokeStyle = 'rgba(40,20,60,0.45)'; // Adern
  for (let i = 0; i < 6; i++) { ctx.beginPath(); let x = Math.random() * w, y = Math.random() * h; ctx.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (Math.random() - 0.5) * 14; y += Math.random() * 10; ctx.lineTo(x, y); } ctx.stroke(); }
});
// Gesicht auf der Kopfkugel: Mitte vorne liegt bei u = 0.25
function faceTex(base, variant) {
  return canvasTex(256, 128, (ctx, w, h) => {
    ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
    grime(ctx, w, h, 50, 0.3);
    const cx = w * 0.25;
    // Augenhöhlen
    ctx.fillStyle = 'rgba(15,5,5,0.9)';
    for (const sx of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + sx * 11, 52, 7.5, 6, sx * 0.3, 0, Math.PI * 2); ctx.fill(); }
    // Nase (eingefallen)
    ctx.fillStyle = 'rgba(30,5,5,0.8)';
    ctx.beginPath(); ctx.moveTo(cx - 3, 66); ctx.lineTo(cx + 3, 66); ctx.lineTo(cx, 60); ctx.fill();
    // Mund mit Zähnen
    ctx.fillStyle = '#1a0303';
    ctx.beginPath(); ctx.ellipse(cx, 80, 12, variant === 1 ? 9 : 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d8cfa8';
    for (let i = -4; i <= 4; i++) { if (Math.random() < 0.25) continue; ctx.fillRect(cx + i * 2.6 - 1, 74 + Math.random() * 2, 1.8, 3 + Math.random() * 2); }
    // Blut aus dem Mund / Wunden
    ctx.strokeStyle = 'rgba(120,0,0,0.85)'; ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) { const x = cx + (Math.random() - 0.5) * 20; ctx.beginPath(); ctx.moveTo(x, 84); ctx.lineTo(x + (Math.random() - 0.5) * 3, 92 + Math.random() * 18); ctx.stroke(); }
    if (variant === 2) { ctx.fillStyle = 'rgba(110,0,0,0.9)'; ctx.beginPath(); ctx.ellipse(cx + 22, 40, 9, 12, 0.4, 0, Math.PI * 2); ctx.fill(); }
  });
}
const SKIN_COLORS = ['#5f6e4c', '#6c6d55', '#7a7464', '#55654b', '#7d6c60'];
const SKINS = SKIN_COLORS.map(c => new THREE.MeshStandardMaterial({ map: skinTex(c), roughness: 0.75, envMapIntensity: 0.35 }));
const FACES = SKIN_COLORS.map((c, i) => new THREE.MeshStandardMaterial({ map: faceTex(c, i % 3), roughness: 0.75, envMapIntensity: 0.35 }));
const SHIRTS = ['#5b5145', '#3f4d5c', '#6b3b33', '#4c5b3c', '#7a7262', '#2b2b2b', '#8a8a80'].map(c => new THREE.MeshStandardMaterial({ map: clothTex(c), roughness: 0.95, envMapIntensity: 0.3 }));
const PANTS = ['#2c3340', '#3d3226', '#28302a', '#45403a'].map(c => new THREE.MeshStandardMaterial({ map: clothTex(c), roughness: 0.95, envMapIntensity: 0.3 }));
const EYES = [0xffe14a, 0xff2a1a, 0xe8f4ff].map(c => new THREE.MeshBasicMaterial({ color: c, toneMapped: false }));
const hairMat = new THREE.MeshStandardMaterial({ color: 0x1c1712, roughness: 1 });
const mouthMat = new THREE.MeshStandardMaterial({ color: 0x220707, roughness: 1 });
const boneMat = new THREE.MeshStandardMaterial({ color: 0xcfc6a8, roughness: 0.7 });
const woundMat = new THREE.MeshStandardMaterial({ color: 0x5a0606, roughness: 0.5 });
const stumpMat = woundMat;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const capGeo = (r, len) => cachedGeo(`zc${r}|${len}`, () => new THREE.CapsuleGeometry(r, len, 4, 10));
const sphGeo = (r) => cachedGeo(`zs${r}`, () => new THREE.SphereGeometry(r, 16, 12));
const coneGeo = cachedGeo('zclaw', () => new THREE.ConeGeometry(0.008, 0.06, 5));
const hairGeo = cachedGeo('zhair', () => new THREE.SphereGeometry(0.108, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.45));
const stumpGeo = cachedGeo('zstump', () => new THREE.SphereGeometry(0.05, 8, 6));

function mesh(geo, mat, x, y, z, name, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  if (name) m.userData.part = name;
  return m;
}
// Zombie-Typen: Schlurfer, Renner, Brocken, Kriecher
export const TYPES = {
  walker: { name: 'Schlurfer', scale: [0.86, 0.96], width: 1, hp: 100, speed: 1, dmg: 10 },
  runner: { name: 'Renner', scale: [0.84, 0.92], width: 0.85, hp: 70, speed: 1.9, dmg: 8 },
  brute: { name: 'Brocken', scale: [0.97, 1.04], width: 1.35, hp: 220, speed: 0.7, dmg: 18 },
  crawler: { name: 'Kriecher', scale: [0.82, 0.9], width: 0.95, hp: 60, speed: 1.4, dmg: 7 },
  giant: { name: 'Riese', scale: [1.24, 1.3], width: 1.5, hp: 900, speed: 0.62, dmg: 28 }
};
function buildZombie(type) {
  const T = TYPES[type];
  const si = Math.floor(Math.random() * SKINS.length);
  const skin = SKINS[si], face = FACES[si], shirt = pick(SHIRTS), pants = pick(PANTS);
  const sleeves = Math.random() < 0.5 ? shirt : skin; // zerrissene Ärmel
  const root = new THREE.Group();   // steht auf dem Boden, schaut nach +Z
  const body = new THREE.Group();   // für Umfallen / Kriechen
  root.add(body);
  const hips = new THREE.Group();
  hips.position.y = 0.86;
  body.add(hips);
  hips.add(mesh(sphGeo(0.12), pants, 0, 0, 0, 'torso', 1.15 * T.width, 0.8, 0.85));
  const torso = new THREE.Group();
  torso.scale.x = T.width;
  hips.add(torso);
  torso.add(mesh(capGeo(0.105, 0.14), shirt, 0, 0.15, 0, 'torso', 1.05, 1, 0.85));
  torso.add(mesh(capGeo(0.13, 0.12), shirt, 0, 0.35, 0.01, 'torso', 1.3, 1, 0.8));
  // offene Wunde / Rippen auf der Brust
  if (Math.random() < 0.6) {
    const wx = (Math.random() - 0.5) * 0.12;
    torso.add(mesh(sphGeo(0.05), woundMat, wx, 0.3, 0.095, null, 1, 1.2, 0.3));
    for (let k = 0; k < 3; k++) torso.add(mesh(capGeo(0.006, 0.06), boneMat, wx, 0.27 + k * 0.025, 0.11, null).rotateZ(Math.PI / 2));
  }
  const neck = new THREE.Group();
  neck.position.y = 0.5;
  neck.rotation.x = 0.25; // Kopf hängt nach vorne
  torso.add(neck);
  neck.add(mesh(capGeo(0.042, 0.06), skin, 0, 0.03, 0));
  const head = new THREE.Group();
  head.position.y = 0.09;
  neck.add(head);
  const skull = mesh(sphGeo(0.1), face, 0, 0.1, 0, 'head', 0.92, 1.12, 1);
  skull.rotation.y = 0; // Gesicht zeigt nach +Z
  head.add(skull);
  if (Math.random() < 0.6) head.add(mesh(hairGeo, hairMat, 0, 0.115, -0.005, null, 0.95, 1.1, 1.02));
  const eyeMat = type === 'runner' || type === 'giant' ? EYES[1] : pick(EYES);
  for (const sx of [-1, 1]) if (Math.random() > 0.12) head.add(mesh(sphGeo(0.014), eyeMat, sx * 0.034, 0.118, 0.077));
  const jaw = new THREE.Group();
  jaw.position.set(0, 0.06, 0.02);
  head.add(jaw);
  jaw.add(mesh(sphGeo(0.06), skin, 0, -0.02, 0.025, 'head', 1.05, 0.55, 1));
  jaw.add(mesh(sphGeo(0.04), mouthMat, 0, 0.0, 0.05, null, 1.1, 0.5, 0.5));
  const arms = [], legs = [];
  for (const side of [-1, 1]) {
    const name = side < 0 ? 'armL' : 'armR';
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.18, 0.42, 0);
    torso.add(shoulder);
    shoulder.add(mesh(capGeo(0.042, 0.2), sleeves, 0, -0.13, 0, name));
    const elbow = new THREE.Group();
    elbow.position.y = -0.27;
    shoulder.add(elbow);
    elbow.add(mesh(capGeo(0.034, 0.2), skin, 0, -0.12, 0, name));
    const hand = new THREE.Group();
    hand.position.y = -0.26;
    elbow.add(hand);
    hand.add(mesh(sphGeo(0.04), skin, 0, -0.015, 0, name, 0.8, 1.1, 0.55));
    for (let k = -1; k <= 1; k++) { const c = mesh(coneGeo, boneMat, k * 0.016, -0.065, 0.01, name); c.rotation.x = Math.PI; hand.add(c); } // Krallen
    arms.push({ shoulder, elbow, side, name });
    const lname = side < 0 ? 'legL' : 'legR';
    const hip = new THREE.Group();
    hip.position.set(side * 0.085, -0.03, 0);
    hips.add(hip);
    hip.add(mesh(capGeo(0.062, 0.28), pants, 0, -0.2, 0, lname));
    const knee = new THREE.Group();
    knee.position.y = -0.41;
    hip.add(knee);
    knee.add(mesh(capGeo(0.05, 0.28), Math.random() < 0.3 ? skin : pants, 0, -0.19, 0, lname));
    knee.add(mesh(capGeo(0.04, 0.1), Math.random() < 0.5 ? mouthMat : skin, 0, -0.4, 0.04, lname).rotateX(Math.PI / 2));
    legs.push({ hip, knee, side, name: lname });
  }
  // kräftige Typen: dickere Beine und Arme
  const thick = 0.6 + 0.4 * T.width;
  if (thick > 1.01) { for (const l of legs) l.hip.scale.set(thick, 1, thick); for (const a of arms) a.shoulder.scale.z = thick; }
  return { root, body, hips, torso, neck, head, skull, jaw, arms, legs };
}

// ---- Bretter vor Türen und Fenstern -------------------------------------------
const plankMat = [0x8a6239, 0x7a5532, 0x94703f].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }));
const nailMat = new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.8, roughness: 0.4 });
export const openings = () => room.surfaces.filter(isOpening);
const plankCountFor = (o) => (o.type === 'door' ? 5 : 4);
export function makePlankMesh(len) {
  const g = new THREE.Group();
  const board = new THREE.Mesh(cachedGeo(`plank${len.toFixed(2)}`, () => new THREE.BoxGeometry(len, 0.13, 0.025)), pick(plankMat));
  board.userData.plank = true;
  g.add(board);
  for (const sx of [-1, 1]) { const nail = new THREE.Mesh(cachedGeo('nail', () => new THREE.CylinderGeometry(0.006, 0.006, 0.01, 6)), nailMat); nail.rotation.x = Math.PI / 2; nail.position.set(sx * (len / 2 - 0.05), 0, 0.014); g.add(nail); }
  g.userData.board = board;
  return g;
}
// Lage des i-ten Bretts (von unten gezählt)
export function plankSlot(o, i) {
  const lo = o.type === 'door' ? 0.3 : o.bottom + 0.08, hi = o.type === 'door' ? 1.9 : o.top - 0.08;
  const n = plankCountFor(o);
  const pos = o.a.clone().addScaledVector(o.right, o.width / 2).setY(lo + (hi - lo) * (i + 0.5) / n).addScaledVector(o.normal, 0.07);
  const quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(o.right, UP, o.normal));
  return { pos, quat };
}
export const missingPlanks = (o) => plankCountFor(o) - (o.planks ? o.planks.length : 0);
// ein Brett annageln (das nächste fehlende); gibt false zurück, wenn alles vernagelt ist
export function addPlank(o) {
  if (!o.planks) o.planks = [];
  const i = o.planks.length;
  if (i >= plankCountFor(o)) return false;
  const g = makePlankMesh(o.width + 0.18);
  const slot = plankSlot(o, i);
  g.position.copy(slot.pos);
  g.quaternion.copy(slot.quat).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rand(-0.12, 0.12)));
  scene.add(g);
  const p = { opening: o, obj: g, board: g.userData.board };
  o.planks.push(p);
  planks.push(p);
  return true;
}
export function setupPlanks() {
  clearPlanks();
  for (const o of openings()) { o.planks = []; while (addPlank(o)) { /* alle Bretter */ } }
}
export function clearPlanks() {
  for (const p of planks) if (p.obj.parent) p.obj.parent.remove(p.obj);
  planks.length = 0;
  for (const o of openings()) o.planks = [];
}
export const plankMeshes = () => planks.map(p => p.board);
function tearPlank(o, zombiePos) {
  const p = o.planks.pop();
  if (!p) return;
  planks.splice(planks.indexOf(p), 1);
  SFX3D.crack(p.obj.position);
  burst(p.obj.position, 0x8a6239, 10);
  // Brett fliegt nach außen weg (zum Zombie hin)
  const vel = zombiePos.clone().sub(p.obj.position).setY(0).normalize().multiplyScalar(rand(1.5, 2.5)).add(new THREE.Vector3(0, rand(0.5, 1.5), 0));
  addDebris(p.obj, vel, 2.5);
}

// ---- Laufwege: Raster über dem Raum (A*) ----------------------------------------
const nav = { cell: 0.15, minX: 0, minZ: 0, w: 0, h: 0, blocked: null };
const RADIUS = 0.24;
export function buildNav(head) {
  const walls = surfacesOf('wall');
  let minX = head.x - 6, maxX = head.x + 6, minZ = head.z - 6, maxZ = head.z + 6;
  for (const w of walls) {
    const bx = w.a.x + w.right.x * w.width, bz = w.a.z + w.right.z * w.width;
    minX = Math.min(minX, w.a.x, bx); maxX = Math.max(maxX, w.a.x, bx);
    minZ = Math.min(minZ, w.a.z, bz); maxZ = Math.max(maxZ, w.a.z, bz);
  }
  minX = Math.max(minX - 1, head.x - 10); maxX = Math.min(maxX + 1, head.x + 10);
  minZ = Math.max(minZ - 1, head.z - 10); maxZ = Math.min(maxZ + 1, head.z + 10);
  nav.minX = minX; nav.minZ = minZ;
  nav.w = Math.ceil((maxX - minX) / nav.cell);
  nav.h = Math.ceil((maxZ - minZ) / nav.cell);
  nav.blocked = new Uint8Array(nav.w * nav.h);
  const boxes = room.surfaces.filter(s => s.type === 'table' || s.type === 'chair' || s.type === 'bench' || s.type === 'mbox');
  // Türen je Wand vorab als begehbare Abschnitte berechnen
  const wallInfo = walls.map(w => ({
    w, doors: openings().filter(o => o.type === 'door' && Math.abs(o.normal.dot(w.normal)) > 0.9 && Math.abs((o.mid.x - w.mid.x) * w.normal.x + (o.mid.z - w.mid.z) * w.normal.z) < 0.3)
      .map(o => { const u = (o.mid.x - w.a.x) * w.right.x + (o.mid.z - w.a.z) * w.right.z; return [u - o.width / 2 + 0.05, u + o.width / 2 - 0.05]; })
  }));
  for (let j = 0; j < nav.h; j++) for (let i = 0; i < nav.w; i++) {
    const x = minX + (i + 0.5) * nav.cell, z = minZ + (j + 0.5) * nav.cell;
    let blocked = false;
    for (const s of boxes) {
      const dx = x - s.center.x, dz = z - s.center.z;
      if (Math.abs(dx * s.X.x + dz * s.X.z) <= s.hx + RADIUS && Math.abs(dx * s.Z.x + dz * s.Z.z) <= s.hz + RADIUS) { blocked = true; break; }
    }
    if (!blocked) for (const { w, doors } of wallInfo) {
      const u = (x - w.a.x) * w.right.x + (z - w.a.z) * w.right.z;
      const d = (x - w.a.x) * w.normal.x + (z - w.a.z) * w.normal.z;
      if (u < -RADIUS || u > w.width + RADIUS || Math.abs(d) > RADIUS) continue;
      if (!doors.some(([u0, u1]) => u > u0 && u < u1)) { blocked = true; break; }
    }
    nav.blocked[j * nav.w + i] = blocked ? 1 : 0;
  }
}
const cellOf = (x, z) => [Math.floor((x - nav.minX) / nav.cell), Math.floor((z - nav.minZ) / nav.cell)];
const inGrid = (i, j) => i >= 0 && j >= 0 && i < nav.w && j < nav.h;
const isFreeCell = (i, j) => inGrid(i, j) && !nav.blocked[j * nav.w + i];
export function walkable(x, z) { if (!nav.blocked) return true; const [i, j] = cellOf(x, z); return !inGrid(i, j) || !nav.blocked[j * nav.w + i]; }
function nearestFree(i, j) {
  if (isFreeCell(i, j)) return [i, j];
  for (let r = 1; r < 12; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    if (Math.max(Math.abs(di), Math.abs(dj)) === r && isFreeCell(i + di, j + dj)) return [i + di, j + dj];
  }
  return null;
}
// A* mit Binär-Heap (schnell, keine Ruckler)
let gScore, fScore, came, closed, heapArr;
function findPath(from, to) {
  if (!nav.blocked) return [to.clone()];
  const s = nearestFree(...cellOf(from.x, from.z)), g = nearestFree(...cellOf(to.x, to.z));
  if (!s || !g) return [to.clone()];
  const W = nav.w, N = W * nav.h, start = s[1] * W + s[0], goal = g[1] * W + g[0];
  if (!gScore || gScore.length !== N) { gScore = new Float32Array(N); fScore = new Float32Array(N); came = new Int32Array(N); closed = new Uint8Array(N); heapArr = new Int32Array(N * 4); }
  gScore.fill(Infinity); came.fill(-1); closed.fill(0);
  let size = 0;
  const push = (k) => { let i = size++; heapArr[i] = k; while (i > 0) { const p = (i - 1) >> 1; if (fScore[heapArr[p]] <= fScore[heapArr[i]]) break; [heapArr[p], heapArr[i]] = [heapArr[i], heapArr[p]]; i = p; } };
  const pop = () => { const top = heapArr[0]; heapArr[0] = heapArr[--size]; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < size && fScore[heapArr[l]] < fScore[heapArr[m]]) m = l; if (r < size && fScore[heapArr[r]] < fScore[heapArr[m]]) m = r; if (m === i) break; [heapArr[m], heapArr[i]] = [heapArr[i], heapArr[m]]; i = m; } return top; };
  const gx = g[0], gy = g[1];
  gScore[start] = 0; fScore[start] = Math.hypot(s[0] - gx, s[1] - gy); push(start);
  let found = start === goal;
  while (size > 0 && !found) {
    if (size >= heapArr.length - 8) break;
    const cur = pop();
    if (closed[cur]) continue;
    if (cur === goal) { found = true; break; }
    closed[cur] = 1;
    const ci = cur % W, cj = (cur / W) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = ci + di, nj = cj + dj;
      if (!isFreeCell(ni, nj)) continue;
      if (di && dj && (!isFreeCell(ci + di, cj) || !isFreeCell(ci, cj + dj))) continue; // keine Ecken schneiden
      const nk = nj * W + ni;
      if (closed[nk]) continue;
      const ng = gScore[cur] + (di && dj ? 1.414 : 1);
      if (ng < gScore[nk]) { gScore[nk] = ng; fScore[nk] = ng + Math.hypot(ni - gx, nj - gy); came[nk] = cur; push(nk); }
    }
  }
  if (!found) return [to.clone()];
  const path = [];
  for (let k = goal; k !== -1 && k !== start; k = came[k]) path.push(new THREE.Vector3(nav.minX + ((k % W) + 0.5) * nav.cell, 0, nav.minZ + (((k / W) | 0) + 0.5) * nav.cell));
  path.reverse();
  const out = path.filter((_, i) => i % 3 === 2); // glätten
  out.push(to.clone().setY(0));
  return out;
}
let planBudget = 0; // höchstens 2 Wegberechnungen pro Bild

// ---- Zombies erzeugen ------------------------------------------------------------
export function pickType(wave) {
  const r = Math.random();
  if (wave >= 3 && r < 0.12) return 'brute';
  if (wave >= 2 && r < 0.32) return 'runner';
  if (wave >= 2 && r < 0.45) return 'crawler';
  return 'walker';
}
// opts.hp / opts.speed: Faktoren für den Schwierigkeitsgrad
export function spawnZombie(wave, head, type = pickType(wave), opts = {}) {
  const T = TYPES[type];
  const z = buildZombie(type);
  const scale = rand(T.scale[0], T.scale[1]);
  z.root.scale.setScalar(scale);
  const zombie = {
    ...z, type, T, scale, hp: (T.hp + wave * 10) * (opts.hp || 1), maxHp: (T.hp + wave * 10) * (opts.hp || 1), legHp: [60, 60].map(v => v * T.hp / 100), armHp: [45, 45].map(v => v * T.hp / 100), legLost: [false, false], armLost: [false, false],
    state: 'outside', pos: new THREE.Vector3(), yaw: 0, speed: Math.min(1.8, (rand(0.42, 0.58) + wave * 0.04) * T.speed * (opts.speed || 1)), phase: Math.random() * 6, jawT: Math.random() * 6,
    path: null, pathT: 0, attackT: 1, actionT: 0, deadT: 0, hurtT: 0, groanT: rand(1, 4), opening: null, enterT: 0, crawl: false, fallDir: 1, headless: false
  };
  const ops = openings();
  if (ops.length) {
    // Öffnung mit den wenigsten wartenden Zombies
    const busy = (o) => zombies.filter(q => q.opening === o && q.state !== 'walk' && q.state !== 'attack' && q.state !== 'dead').length;
    const o = ops.slice().sort((a, b) => busy(a) - busy(b) + rand(-0.5, 0.5))[0];
    zombie.opening = o;
    zombie.slot = busy(o);
    zombie.pos.copy(o.mid).addScaledVector(o.normal, -rand(2.5, 4)).addScaledVector(o.right, rand(-0.6, 0.6)).setY(0);
  } else {
    // keine Türen/Fenster: steigen aus dem Boden
    zombie.state = 'rise';
    for (let k = 0; k < 30; k++) {
      const a = Math.random() * Math.PI * 2, d = rand(3, 6.5);
      zombie.pos.set(head.x + Math.sin(a) * d, 0, head.z + Math.cos(a) * d);
      if (walkable(zombie.pos.x, zombie.pos.z)) break;
    }
    zombie.root.position.y = -1.9 * scale;
  }
  if (type === 'crawler') { // ohne Beine: kriecht von Anfang an
    zombie.crawl = true;
    zombie.legLost = [true, true];
    for (const l of zombie.legs) l.hip.visible = false;
  }
  zombie.root.position.x = zombie.pos.x;
  zombie.root.position.z = zombie.pos.z;
  zombie.root.traverse(o => { if (o.isMesh && o.userData.part) o.userData.zombie = zombie; });
  // unsichtbarer Körper: geworfene Dinge prallen ab und treffen den Zombie
  zombie.kin = addKinematicBox(new THREE.Vector3(0.2 * T.width * scale, 0.8 * scale, 0.16 * scale), 0.8 * scale, (other, v, p) => bumpZombie(zombie, other, v, p));
  zombie.kinCrawl = false;
  scene.add(zombie.root);
  zombies.push(zombie);
  return zombie;
}
export function clearZombies() {
  for (const z of zombies) {
    if (z.root.parent) z.root.parent.remove(z.root);
    if (z.kin) { removeBody(z.kin); z.kin = null; }
    if (z.phys) { removeDynamic(z.phys); z.phys = null; }
  }
  zombies.length = 0;
  corpses.length = 0;
  for (const l of limbs) { removeDynamic(l.phys); if (l.obj.parent) l.obj.parent.remove(l.obj); }
  limbs.length = 0;
}
export const aliveCount = () => zombies.filter(z => z.state !== 'dead').length;
export function zombieHitMeshes() {
  const out = [];
  for (const z of zombies) {
    if (z.state === 'dead') continue;
    z.root.traverseVisible(o => { if (o.isMesh && o.userData.part) out.push(o); });
  }
  return out;
}
export const zombieHeads = () => zombies.filter(z => z.state !== 'dead' && !z.headless).map(z => z.skull.getWorldPosition(new THREE.Vector3()));

// ---- Schaden ---------------------------------------------------------------------
const limbs = [];
function detach(z, group, kind, sideIndex) {
  // Körperteil fällt ab (Physik), am Rumpf bleibt ein Stumpf
  group.updateWorldMatrix(true, true);
  const stump = new THREE.Mesh(stumpGeo, stumpMat);
  stump.position.copy(group.position);
  group.parent.add(stump);
  scene.attach(group);
  group.traverse(o => { if (o.isMesh) o.userData.part = null; });
  const phys = addDynamic(group, localBoxOf(group), 3, { vel: new THREE.Vector3(rand(-1, 1), 1, rand(-1, 1)), angVel: new THREE.Vector3(rand(-5, 5), rand(-5, 5), rand(-5, 5)) });
  limbs.push({ obj: group, phys, t: 8 });
  if (kind === 'arm') z.armLost[sideIndex] = true;
  else z.legLost[sideIndex] = true;
}
// Trifft ein Projektil ein Körperteil: Ergebnis für Punkte/Anzeige
export function damageZombie(mesh, point, dir, dmg) {
  const z = mesh.userData.zombie;
  const partName = mesh.userData.part;
  if (!z || !partName || z.state === 'dead') return null;
  burst(point, 0x6a0000, 10);
  SFX3D.splat(point);
  z.hurtT = Math.max(z.hurtT, 0.25);
  z.hurtDir = dir.clone();
  // Treffer von der Seite drehen den Oberkörper mit, Kopftreffer reißen den Kopf zurück
  const fwdH = new THREE.Vector3(Math.sin(z.yaw), 0, Math.cos(z.yaw));
  z.hurtTwist = Math.sign(fwdH.x * dir.z - fwdH.z * dir.x) || 1;
  if (partName === 'head') z.headSnap = 0.5;
  // viel Schaden auf einmal (z. B. Schrot aus der Nähe) wirft den Zombie um
  z.recentDmg = (z.recentDmg || 0) + dmg;
  if (z.recentDmg > 75 && !z.knockT && !z.crawl && z.type !== 'brute' && z.type !== 'giant' && (z.state === 'walk' || z.state === 'attack')) {
    z.knockT = 2.2;
    z.knockBack = dir.dot(fwdH) < 0 ? -1 : 1; // nach hinten bzw. vorne umfallen
  }
  // harte Treffer lassen den Zombie taumeln und stoßen ihn zurück (Brocken nicht)
  if (z.type !== 'brute' && z.state !== 'outside' && z.state !== 'tear' && z.state !== 'enter') {
    const push = Math.min(0.12, dmg * 0.0035);
    const nx = z.pos.x + dir.x * push, nz = z.pos.z + dir.z * push;
    if (walkable(nx, nz)) { z.pos.x = nx; z.pos.z = nz; }
    if (dmg >= 30) z.stagger = Math.max(z.stagger || 0, Math.min(0.6, dmg * 0.006));
  }
  let headshot = false;
  if (partName === 'head') { z.hp -= dmg * 3; headshot = true; }
  else if (partName === 'torso') z.hp -= dmg;
  else if (partName.startsWith('arm')) {
    const k = partName === 'armL' ? 0 : 1;
    z.hp -= dmg * 0.5;
    z.armHp[k] -= dmg;
    if (z.armHp[k] <= 0 && !z.armLost[k]) detach(z, z.arms[k].shoulder, 'arm', k);
  } else {
    const k = partName === 'legL' ? 0 : 1;
    z.hp -= dmg * 0.6;
    z.legHp[k] -= dmg;
    if (z.legHp[k] <= 0 && !z.legLost[k]) { detach(z, z.legs[k].hip, 'leg', k); z.crawl = true; }
  }
  const res = { part: partName, headshot, kill: false, limp: z.legHp.some(h => h < 30) && !z.crawl, pos: z.pos.clone(), type: z.type, zombie: z };
  if (z.hp <= 0) {
    res.kill = true;
    if (headshot && dmg * 3 >= 150) { z.head.visible = false; z.headless = true; burst(point, 0x7a0000, 30); }
    kill(z, dir);
  }
  return res;
}
// Atombombe (Power-up): alle Zombies sterben
export function killAll(from) {
  const results = [];
  for (const z of zombies) {
    if (z.state === 'dead') continue;
    const dir = new THREE.Vector3(z.pos.x - from.x, 0, z.pos.z - from.z).normalize();
    z.hp = 0;
    burst(z.skull.getWorldPosition(new THREE.Vector3()), 0x6a0000, 14);
    kill(z, dir);
    results.push({ part: 'torso', headshot: false, kill: true, pos: z.pos.clone(), type: z.type, zombie: z, explosion: true, nuke: true });
  }
  return results;
}
// Explosion (Handgranate): Schaden nimmt mit der Entfernung ab, nahe Treffer reißen Gliedmaßen ab
export function explosionDamage(center, radius, maxDmg) {
  const results = [];
  for (const z of zombies) {
    if (z.state === 'dead') continue;
    const d = Math.hypot(z.pos.x - center.x, z.pos.z - center.z, Math.max(0, center.y - 1.0) * 0.5);
    const f = 1 - d / radius;
    if (f <= 0) continue;
    const dir = new THREE.Vector3(z.pos.x - center.x, 0, z.pos.z - center.z).normalize();
    z.hp -= maxDmg * f;
    z.hurtT = 0.4;
    burst(z.skull.getWorldPosition(new THREE.Vector3()), 0x6a0000, 12);
    if (f > 0.45) {
      for (let k = 0; k < 2; k++) {
        if (Math.random() < f * 0.6 && !z.legLost[k]) { detach(z, z.legs[k].hip, 'leg', k); z.crawl = true; }
        if (Math.random() < f * 0.5 && !z.armLost[k]) detach(z, z.arms[k].shoulder, 'arm', k);
      }
    }
    if (z.state !== 'outside' && z.state !== 'tear' && z.state !== 'enter') {
      const nx = z.pos.x + dir.x * f * 0.8, nz = z.pos.z + dir.z * f * 0.8;
      if (walkable(nx, nz)) { z.pos.x = nx; z.pos.z = nz; }
      z.stagger = 1;
    }
    const res = { part: 'torso', headshot: false, kill: false, pos: z.pos.clone(), type: z.type, zombie: z, explosion: true };
    if (z.hp <= 0) { res.kill = true; kill(z, dir); }
    results.push(res);
  }
  return results;
}
// Ein geworfener Gegenstand trifft den Zombie
// (wird während des Physik-Schritts gemeldet – ausgewertet erst im nächsten Zombie-Update)
function bumpZombie(z, other, v, p) {
  if (z.state === 'dead' || other.isCorpse || (z.bumpT || 0) > 0 || z.pendingBump) return;
  z.pendingBump = { mass: other.mass, v, vel: new THREE.Vector3(other.velocity.x, other.velocity.y, other.velocity.z), p: p.clone() };
}
function applyBump(z) {
  const { mass, v, vel, p } = z.pendingBump;
  z.pendingBump = null;
  if (z.state === 'dead') return;
  z.bumpT = 0.3;
  const other = { mass, velocity: vel };
  const dmg = THREE.MathUtils.clamp(other.mass * v * 5, 8, 70);
  const dir = new THREE.Vector3(other.velocity.x, 0, other.velocity.z);
  if (dir.lengthSq() < 1e-4) dir.set(z.pos.x - p.x, 0, z.pos.z - p.z);
  dir.normalize();
  const res = damageZombie(z.torso.children[1], p, dir, dmg);
  if (res) { res.bump = true; onBump(res, p); }
}
// Leiche: wird zum Physik-Körper und kippt in Fallrichtung um
function makeCorpse(z) {
  // schlanke Körperform (die ausgestreckten Arme würden den Körper sonst zu standfest machen)
  const sc = z.scale, w = z.T.width;
  const lying = z.crawl || Math.abs(z.body.rotation.x) > 0.8; // kriecht oder liegt schon (umgeworfen)
  let box;
  if (lying) { box = localBoxOf(z.root); box.min.multiplyScalar(sc); box.max.multiplyScalar(sc); box.max.y = Math.max(box.max.y, box.min.y + 0.15); }
  else box = new THREE.Box3(new THREE.Vector3(-0.2 * w * sc, 0, -0.13 * sc), new THREE.Vector3(0.2 * w * sc, 1.6 * sc, 0.13 * sc));
  const dir = z.fallVec || new THREE.Vector3(Math.sin(z.yaw), 0, Math.cos(z.yaw));
  const axis = new THREE.Vector3(0, 1, 0).cross(dir).normalize();
  z.phys = addDynamic(z.root, box, 45, {
    vel: dir.clone().multiplyScalar(1.2).add(new THREE.Vector3(0, 0.3, 0)),
    angVel: axis.multiplyScalar(lying ? 0.4 : 3.5),
    linearDamping: 0.15, angularDamping: 0.45,
    onImpact: (iv) => { if (iv > 1.5) SFX3D.bang(z.root.position.clone().setY(0.3)); }
  });
  z.phys.body.isCorpse = true;
  corpses.push(z);
  while (corpses.length > 8) { const old = corpses.shift(); removeCorpse(old); }
}
function removeCorpse(z) {
  if (z.phys) { removeDynamic(z.phys); z.phys = null; }
  if (z.root.parent) z.root.parent.remove(z.root);
  const i = zombies.indexOf(z);
  if (i >= 0) zombies.splice(i, 1);
}
function kill(z, dir) {
  z.state = 'dead';
  z.deadT = 0;
  // nach hinten (vom Schuss weg) umfallen
  const fwd = new THREE.Vector3(Math.sin(z.yaw), 0, Math.cos(z.yaw));
  z.fallDir = dir && dir.dot(fwd) > 0 ? 1 : -1;
  z.fallVec = dir ? new THREE.Vector3(dir.x, 0, dir.z).normalize() : fwd;
  if (!isFinite(z.fallVec.x) || z.fallVec.lengthSq() < 0.5) z.fallVec = fwd;
  if (z.kin) { removeBody(z.kin); z.kin = null; }
}

// ---- Bewegung & Animation ------------------------------------------------------------
function faceTowards(z, target, dt, rate = 6) {
  const want = Math.atan2(target.x - z.pos.x, target.z - z.pos.z);
  const d = Math.atan2(Math.sin(want - z.yaw), Math.cos(want - z.yaw));
  z.yaw += d * Math.min(1, dt * rate);
}
function moveTowards(z, target, speed, dt, checkNav = true) {
  const d = tmpV.copy(target).sub(z.pos).setY(0);
  const len = d.length();
  if (len < 0.01) return true;
  const step = Math.min(len, speed * dt);
  d.multiplyScalar(step / len);
  const nx = z.pos.x + d.x, nz = z.pos.z + d.z;
  if (!checkNav || !walkable(z.pos.x, z.pos.z) || walkable(nx, nz)) { z.pos.x = nx; z.pos.z = nz; }
  else if (walkable(nx, z.pos.z)) z.pos.x = nx;
  else if (walkable(z.pos.x, nz)) z.pos.z = nz;
  return len - step < 0.05;
}
// Gehen / Humpeln / Kriechen
function animateWalk(z, dt, speed) {
  z.phase += dt * speed * 5.5 / z.scale;
  const s = Math.sin(z.phase), c = Math.cos(z.phase);
  const limp = z.legHp.map(h => h < 30);
  if (z.crawl) {
    // liegt auf dem Bauch: Körper nach vorne gekippt, Füße hinter dem Standpunkt
    z.body.rotation.x = THREE.MathUtils.damp(z.body.rotation.x, 1.45, 6, dt);
    z.body.position.y = THREE.MathUtils.damp(z.body.position.y, 0.06, 6, dt);
    z.body.position.z = THREE.MathUtils.damp(z.body.position.z, -0.85, 6, dt);
    z.arms.forEach((a, i) => { a.shoulder.rotation.x = -2.6 + (i ? s : -s) * 0.5; a.elbow.rotation.x = -0.4; });
    z.legs.forEach((l, i) => { l.hip.rotation.x = 0.1 + (i ? -s : s) * 0.15; l.knee.rotation.x = 0.3; });
    return;
  }
  z.body.rotation.x = THREE.MathUtils.damp(z.body.rotation.x, 0.12, 6, dt);
  z.body.position.y = THREE.MathUtils.damp(z.body.position.y, 0, 6, dt);
  z.legs.forEach((l, i) => {
    const ph = i ? -s : s, amp = limp[i] ? 0.15 : 0.5;
    l.hip.rotation.x = ph * amp;
    l.knee.rotation.x = Math.max(0, (i ? c : -c)) * (limp[i] ? 0.2 : 0.7);
  });
  z.hips.position.y = 0.86 - Math.abs(s) * 0.03 - (limp[0] || limp[1] ? Math.max(0, limp[0] ? s : -s) * 0.08 : 0);
  z.body.rotation.z = (limp[0] ? -0.12 : limp[1] ? 0.12 : 0) + s * 0.05;
  if (z.type === 'runner') {
    // Renner: nach vorne gebeugt, Arme pumpen
    z.body.rotation.x = THREE.MathUtils.damp(z.body.rotation.x, 0.38, 6, dt);
    z.arms.forEach((a, i) => { a.shoulder.rotation.x = -0.35 + (i ? -s : s) * 0.9; a.shoulder.rotation.z = a.side * -0.15; a.elbow.rotation.x = -1.2; });
  } else {
    z.arms.forEach((a, i) => { a.shoulder.rotation.x = -1.35 + (i ? s : -s) * 0.12; a.shoulder.rotation.z = (a.side) * -0.08; a.elbow.rotation.x = -0.2; });
  }
  if (z.type === 'brute' || z.type === 'giant') { // schwerfällig: stärkeres Wanken
    z.body.rotation.z += s * 0.08;
    z.hips.position.y -= Math.abs(s) * 0.04;
  }
  z.head.rotation.z = Math.sin(z.phase * 0.5) * 0.15;
  // zufälliges Zucken des Kopfes
  z.twitchT = (z.twitchT ?? Math.random() * 3) - dt;
  if (z.twitchT <= 0) { z.twitchT = 1.5 + Math.random() * 3; z.twitch = (Math.random() - 0.5) * 1.4; }
  z.twitch = (z.twitch || 0) * Math.pow(0.02, dt);
  z.head.rotation.y = z.twitch;
}
function animateTear(z, dt) {
  z.phase += dt * 6;
  const s = Math.sin(z.phase);
  z.body.rotation.x = THREE.MathUtils.damp(z.body.rotation.x, 0.25, 6, dt);
  z.arms.forEach((a, i) => { a.shoulder.rotation.x = -1.6 + (i ? s : -s) * 0.6; a.elbow.rotation.x = -0.3 - Math.max(0, i ? -s : s) * 0.8; });
  z.legs.forEach(l => { l.hip.rotation.x *= 0.9; l.knee.rotation.x *= 0.9; });
}
function animateAttack(z, dt) {
  const t = 1 - Math.max(0, z.attackT) / 1.3; // 0..1 Schlagphase
  const swing = Math.sin(Math.min(1, t * 1.6) * Math.PI);
  if (z.attackVariant === 1 && !z.crawl) {
    // Biss: packt zu und stößt mit dem Kopf nach vorne
    z.arms.forEach(a => { a.shoulder.rotation.x = -1.5; a.shoulder.rotation.z = a.side * 0.35; a.elbow.rotation.x = -0.9; });
    z.body.rotation.x = THREE.MathUtils.damp(z.body.rotation.x, 0.15 + swing * 0.45, 10, dt);
    z.neck.rotation.x = 0.25 + swing * 0.5;
  } else {
    z.arms.forEach((a, i) => { a.shoulder.rotation.x = -1.2 - swing * 1.2 * (i ? 1 : 0.6); a.elbow.rotation.x = -0.6 + swing * 0.5; a.shoulder.rotation.z = 0; });
    z.body.rotation.x = THREE.MathUtils.damp(z.body.rotation.x, z.crawl ? 1.45 : 0.2 + swing * 0.2, 8, dt);
    z.neck.rotation.x = THREE.MathUtils.damp(z.neck.rotation.x, 0.25, 8, dt);
  }
  z.legs.forEach(l => { l.hip.rotation.x *= 0.85; l.knee.rotation.x *= 0.85; });
}

export function updateZombies(dt, head, opts = {}) {
  const player = new THREE.Vector3(head.x, 0, head.z);
  planBudget = 2;
  for (let i = zombies.length - 1; i >= 0; i--) {
    const z = zombies[i];
    if (!z) continue; // Liste kann sich während des Updates ändern
    z.hurtT = Math.max(0, z.hurtT - dt);
    if (z.stagger > 0) z.stagger -= dt;
    if (z.state === 'dead') {
      z.deadT += dt;
      // erschlafft: Arme sinken, Knie knicken, Kopf fällt
      z.arms.forEach(a => { a.shoulder.rotation.x *= 0.9; a.elbow.rotation.x *= 0.9; });
      z.legs.forEach((l, k) => { l.knee.rotation.x = THREE.MathUtils.damp(l.knee.rotation.x, 0.5 + k * 0.3, 4, dt); });
      z.neck.rotation.x = THREE.MathUtils.damp(z.neck.rotation.x, 0.9, 4, dt);
      z.jaw.rotation.x = 0.45;
      if (!z.phys && z.deadT > 0.08 && z.deadT < 6) makeCorpse(z);
      if (z.deadT > 6 && z.phys) { removeDynamic(z.phys); z.phys = null; }
      if (z.deadT > 6) z.root.position.y -= dt * 0.25; // versinkt im Boden
      if (z.deadT > 9.5) { const ci = corpses.indexOf(z); if (ci >= 0) corpses.splice(ci, 1); scene.remove(z.root); zombies.splice(i, 1); }
      continue;
    }
    z.groanT -= dt;
    if (z.groanT <= 0) { z.groanT = rand(2.5, 6); SFX3D.groan(z.skull.getWorldPosition(tmpV2), 1 / z.scale); }
    let speed = z.speed * (z.crawl ? 0.35 : z.legHp.some(h => h < 30) ? 0.55 : 1);
    if (z.stagger > 0 && (z.state === 'walk' || z.state === 'attack')) speed = 0; // taumelt
    const o = z.opening;
    if (z.state === 'rise') {
      z.root.position.y = Math.min(0, z.root.position.y + dt * 0.9);
      faceTowards(z, player, dt);
      z.arms.forEach((a, k) => { a.shoulder.rotation.x = -2.6 + Math.sin(z.phase += dt * 3) * 0.3 * (k ? 1 : -1); });
      if (z.root.position.y >= 0) z.state = 'walk';
    } else if (z.state === 'outside') {
      // vor die Öffnung laufen (außerhalb des Raums)
      const stand = o.mid.clone().addScaledVector(o.normal, -0.45 - z.slot * 0.6).addScaledVector(o.right, (z.slot % 2 ? 0.25 : -0.25) * Math.min(1, z.slot)).setY(0);
      faceTowards(z, stand.clone().addScaledVector(o.normal, 1), dt);
      if (moveTowards(z, stand, speed, dt, false)) {
        z.state = 'tear';
        z.actionT = rand(1.2, 2);
      }
      animateWalk(z, dt, speed);
    } else if (z.state === 'tear') {
      faceTowards(z, z.pos.clone().addScaledVector(o.normal, 1), dt);
      animateTear(z, dt);
      // nur der vorderste reißt Bretter ab, die anderen warten
      const front = !zombies.some(q => q !== z && q.opening === o && q.state === 'tear' && q.slot < z.slot);
      if (!front) {
        const stand = o.mid.clone().addScaledVector(o.normal, -0.45 - z.slot * 0.6).setY(0);
        if (z.slot > 0 && zombies.every(q => q === z || q.opening !== o || q.state !== 'tear' || q.slot >= z.slot - 1)) z.slot = Math.max(0, z.slot - 1);
        moveTowards(z, stand, speed, dt, false);
      } else {
        z.slot = 0;
        moveTowards(z, o.mid.clone().addScaledVector(o.normal, -0.45).setY(0), speed, dt, false);
        z.actionT -= dt;
        if (z.actionT <= 0) {
          if (o.planks && o.planks.length) {
            if (Math.random() < 0.5) SFX3D.bang(o.mid.clone().setY(1.2));
            tearPlank(o, z.pos);
            z.actionT = rand(1.4, 2.4);
          } else {
            z.state = 'enter';
            z.enterT = 0;
            z.enterFrom = z.pos.clone();
          }
        }
      }
    } else if (z.state === 'enter') {
      // durch die Tür gehen bzw. durchs Fenster klettern
      const inside = o.mid.clone().addScaledVector(o.normal, 0.55).setY(0);
      const dur = o.type === 'window' ? 2.2 : 1.2 / Math.max(0.3, speed);
      z.enterT += dt / dur;
      const t = Math.min(1, z.enterT);
      z.pos.lerpVectors(z.enterFrom, inside, t);
      faceTowards(z, inside.clone().addScaledVector(o.normal, 1), dt);
      if (o.type === 'window') {
        z.root.position.y = Math.sin(t * Math.PI) * (o.bottom + 0.05) + Math.max(0, 1 - t * 3) * 0;
        z.body.rotation.x = Math.sin(t * Math.PI) * 1.2;
        z.arms.forEach((a, k) => { a.shoulder.rotation.x = -2.2 + Math.sin(t * 12 + k) * 0.4; });
        z.legs.forEach((l, k) => { l.hip.rotation.x = -Math.sin(t * Math.PI) * 1.2 + k * 0.3; l.knee.rotation.x = 1.0; });
      } else animateWalk(z, dt, speed);
      if (t >= 1) { z.state = 'walk'; z.root.position.y = 0; z.pathT = 0; }
    } else if ((z.state === 'walk' || z.state === 'attack') && z.knockT > 0) {
      // umgeworfen: fällt hin, bleibt kurz liegen, steht wieder auf
      z.knockT -= dt;
      const k = z.knockT;
      const down = k > 1.6 ? (2.2 - k) / 0.6 : k > 0.7 ? 1 : k / 0.7;
      z.body.rotation.x = 1.45 * z.knockBack * THREE.MathUtils.smoothstep(down, 0, 1);
      z.body.position.y = 0.05 * down;
      z.arms.forEach((a, i) => { a.shoulder.rotation.x = -0.4 - (i ? 0.6 : 0.2) * down; a.elbow.rotation.x = -0.3; });
      if (z.knockT <= 0) { z.knockT = 0; z.body.rotation.x = 0.12; }
    } else if (z.state === 'walk' || z.state === 'attack') {
      const dist = Math.hypot(player.x - z.pos.x, player.z - z.pos.z);
      const reach = z.crawl ? 0.7 : 0.8;
      if (dist < reach) {
        z.state = 'attack';
        faceTowards(z, player, dt, 8);
        if (!(z.stagger > 0)) z.attackT -= dt; // taumelnd kein Angriff
        animateAttack(z, dt);
        if (z.attackT <= 0) {
          z.attackT = 1.3;
          z.attackVariant = Math.random() < 0.4 ? 1 : 0;
          SFX3D.swing(z.skull.getWorldPosition(tmpV2));
          const armsLeft = z.armLost.filter(x => !x).length;
          if (!opts.harmless && armsLeft > 0) onPlayerHit(z.T.dmg * (z.crawl ? 0.7 : 1) * (armsLeft === 2 ? 1 : 0.6), z);
        }
      } else {
        z.state = 'walk';
        z.attackT = Math.min(z.attackT, 0.5);
        z.pathT -= dt;
        if ((z.pathT <= 0 || !z.path || !z.path.length) && planBudget > 0) { planBudget--; z.path = findPath(z.pos, player); z.pathT = rand(0.5, 0.9); }
        if (!z.path) z.path = [player.clone()];
        while (z.path.length > 1 && z.path[0].distanceTo(tmpV.set(z.pos.x, 0, z.pos.z)) < 0.2) z.path.shift();
        const next = z.path[0] || player;
        faceTowards(z, next, dt);
        moveTowards(z, next, speed, dt);
        animateWalk(z, dt, speed);
      }
    }
    // Abstand zu anderen Zombies
    if (z.state === 'walk' || z.state === 'attack') {
      for (const q of zombies) {
        if (q === z || q.state === 'dead' || (q.state !== 'walk' && q.state !== 'attack')) continue;
        const dx = z.pos.x - q.pos.x, dz = z.pos.z - q.pos.z, d = Math.hypot(dx, dz);
        if (d > 0.001 && d < 0.5) { const push = (0.5 - d) * 0.5; if (walkable(z.pos.x + dx / d * push, z.pos.z + dz / d * push)) { z.pos.x += dx / d * push; z.pos.z += dz / d * push; } }
      }
    }
    // schwere Schritte (Brocken, Riese) und Stampf-Angriff des Riesen
    if ((z.type === 'brute' || z.type === 'giant') && (z.state === 'walk' || z.state === 'outside' || z.state === 'enter') && !z.crawl) {
      const stepPhase = Math.floor(z.phase / Math.PI);
      if (stepPhase !== z.lastStep) { z.lastStep = stepPhase; SFX3D.step(z.root.position.clone(), z.type === 'giant' ? 1.8 : 1.2); if (z.type === 'giant' && onStomp) onStomp(z, false); }
    }
    if (z.type === 'giant' && (z.state === 'walk' || z.state === 'attack')) {
      z.roarT = (z.roarT ?? 2) - dt;
      if (z.roarT <= 0) { z.roarT = rand(7, 12); SFX3D.roar(z.skull.getWorldPosition(tmpV2)); }
      z.stompT = (z.stompT ?? 4) - dt;
      const dPl = Math.hypot(player.x - z.pos.x, player.z - z.pos.z);
      if (z.stompT <= 0 && dPl < 2.8 && !(z.stagger > 0)) {
        z.stompT = rand(5, 7);
        shockwave(z.root.position.clone().setY(0.1));
        burst(z.root.position.clone().setY(0.1), 0x5a5048, 20);
        SFX3D.bang(z.root.position.clone());
        if (onStomp) onStomp(z, true);
        if (!opts.harmless && dPl < 2.6) onPlayerHit(12, z);
      }
    }
    // Kiefer schnappt auf und zu
    z.jawT += dt * (z.state === 'attack' ? 9 : 2.5);
    z.jaw.rotation.x = 0.15 + Math.max(0, Math.sin(z.jawT)) * (z.state === 'attack' ? 0.6 : 0.35);
    // Treffer-Reaktion: kurz nach hinten zucken
    if (z.hurtT > 0) { z.torso.rotation.x = -z.hurtT * 1.6; z.torso.rotation.y = z.hurtT * 1.4 * (z.hurtTwist || 0); }
    else { z.torso.rotation.x *= 0.8; z.torso.rotation.y *= 0.8; }
    if (z.headSnap > 0) { z.headSnap -= dt; z.head.rotation.x = -Math.max(0, z.headSnap) * 1.6; } else z.head.rotation.x *= 0.8;
    z.recentDmg = Math.max(0, (z.recentDmg || 0) - dt * 120);
    z.bumpT = Math.max(0, (z.bumpT || 0) - dt);
    if (z.pendingBump) applyBump(z);
    if (z.kin) {
      if (z.crawl && !z.kinCrawl) { z.kinCrawl = true; resizeKinematic(z.kin, new THREE.Vector3(0.25, 0.18, 0.5), 0.18); }
      setKinematicPose(z.kin, z.pos.x, z.root.position.y, z.pos.z, z.yaw);
    }
    z.root.position.x = z.pos.x;
    z.root.position.z = z.pos.z;
    z.root.rotation.y = z.yaw;
  }
  for (let i = limbs.length - 1; i >= 0; i--) {
    limbs[i].t -= dt;
    if (limbs[i].t <= 0) { removeDynamic(limbs[i].phys); scene.remove(limbs[i].obj); limbs.splice(i, 1); }
  }
}
