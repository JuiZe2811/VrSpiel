import * as THREE from 'three';
import { room, surfacesOf, isOpening } from './room.js';
import { addDynamic, removeDynamic, localBoxOf } from './physics.js';
import { SFX3D } from './sfx.js';
import { burst, addDebris } from './effects.js';

// =============================================================================
// Zombies: kommen durch Türen und Fenster (reißen erst die Bretter ab),
// laufen um Wände/Tische/Stühle herum zum Spieler und greifen an.
// Trefferzonen: Kopf (x3), Körper, Arme (können abfallen), Beine (Humpeln / Kriechen).
// =============================================================================
let scene, onPlayerHit = () => {};
export const zombies = [];
const planks = [];
const rand = THREE.MathUtils.randFloat;
const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();

export function initZombies(s, hitCallback) { scene = s; onPlayerHit = hitCallback; }

// ---- Aussehen -----------------------------------------------------------------
function clothTex(base) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = base; ctx.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 90; i++) { // Dreck, Risse, Blut
    ctx.fillStyle = Math.random() < 0.25 ? 'rgba(90,0,0,0.6)' : `rgba(0,0,0,${Math.random() * 0.35})`;
    ctx.fillRect(Math.random() * 64, Math.random() * 64, 1 + Math.random() * 6, 1 + Math.random() * 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const SKINS = [0x7f9a6c, 0x8d9c7a, 0x9aa38a, 0x6f8a68].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }));
const SHIRTS = ['#5b5145', '#3f4d5c', '#6b3b33', '#4c5b3c', '#7a7262'].map(c => new THREE.MeshStandardMaterial({ map: clothTex(c), roughness: 0.95 }));
const PANTS = ['#2c3340', '#3d3226', '#28302a'].map(c => new THREE.MeshStandardMaterial({ map: clothTex(c), roughness: 0.95 }));
const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffe14a, toneMapped: false });
const mouthMat = new THREE.MeshStandardMaterial({ color: 0x220707, roughness: 1 });
const stumpMat = new THREE.MeshStandardMaterial({ color: 0x5a0606, roughness: 0.6 });
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function part(w, h, d, mat, y, name, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(0, y, z);
  if (name) m.userData.part = name;
  return m;
}
function buildZombie() {
  const skin = pick(SKINS), shirt = pick(SHIRTS), pants = pick(PANTS);
  const root = new THREE.Group();   // steht auf dem Boden, schaut nach +Z
  const body = new THREE.Group();   // für Umfallen / Kriechen
  root.add(body);
  const hips = new THREE.Group();
  hips.position.y = 0.95;
  body.add(hips);
  hips.add(part(0.36, 0.16, 0.22, pants, -0.02, 'torso'));
  const torso = new THREE.Group();
  hips.add(torso);
  torso.add(part(0.4, 0.58, 0.24, shirt, 0.31, 'torso'));
  const neck = new THREE.Group();
  neck.position.y = 0.6;
  torso.add(neck);
  neck.add(part(0.1, 0.08, 0.1, skin, 0.03));
  const head = new THREE.Group();
  head.position.y = 0.06;
  neck.add(head);
  const skull = part(0.22, 0.26, 0.24, skin, 0.13, 'head');
  head.add(skull);
  for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), eyeMat); e.position.set(sx * 0.055, 0.16, 0.121); head.add(e); }
  head.add(part(0.12, 0.05, 0.02, mouthMat, 0.06, null, 0.121));
  const arms = [], legs = [];
  for (const side of [-1, 1]) {
    const name = side < 0 ? 'armL' : 'armR';
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.25, 0.54, 0);
    torso.add(shoulder);
    shoulder.add(part(0.11, 0.32, 0.11, shirt, -0.16, name));
    const elbow = new THREE.Group();
    elbow.position.y = -0.32;
    shoulder.add(elbow);
    elbow.add(part(0.09, 0.3, 0.09, skin, -0.15, name));
    elbow.add(part(0.08, 0.1, 0.05, skin, -0.34, name));
    arms.push({ shoulder, elbow, side, name });
    const lname = side < 0 ? 'legL' : 'legR';
    const hip = new THREE.Group();
    hip.position.set(side * 0.1, -0.06, 0);
    hips.add(hip);
    hip.add(part(0.15, 0.46, 0.16, pants, -0.23, lname));
    const knee = new THREE.Group();
    knee.position.y = -0.44;
    hip.add(knee);
    knee.add(part(0.13, 0.44, 0.13, pants, -0.22, lname));
    knee.add(part(0.13, 0.07, 0.24, mouthMat, -0.45, lname, 0.05));
    legs.push({ hip, knee, side, name: lname });
  }
  return { root, body, hips, torso, neck, head, skull, arms, legs };
}

// ---- Bretter vor Türen und Fenstern -------------------------------------------
const plankMat = [0x8a6239, 0x7a5532, 0x94703f].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }));
const nailMat = new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.8, roughness: 0.4 });
export const openings = () => room.surfaces.filter(isOpening);
export function setupPlanks() {
  clearPlanks();
  for (const o of openings()) {
    o.planks = [];
    const lo = o.type === 'door' ? 0.3 : o.bottom + 0.08, hi = o.type === 'door' ? 1.9 : o.top - 0.08;
    const n = o.type === 'door' ? 5 : 4;
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(o.right, UP, o.normal));
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group();
      const len = o.width + 0.18;
      const board = new THREE.Mesh(new THREE.BoxGeometry(len, rand(0.11, 0.15), 0.025), pick(plankMat));
      board.userData.plank = true;
      g.add(board);
      for (const sx of [-1, 1]) { const nail = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.01, 6), nailMat); nail.rotation.x = Math.PI / 2; nail.position.set(sx * (len / 2 - 0.05), 0, 0.014); g.add(nail); }
      g.position.copy(o.a).addScaledVector(o.right, o.width / 2).setY(lo + (hi - lo) * (i + 0.5) / n).addScaledVector(o.normal, 0.03);
      g.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rand(-0.12, 0.12)));
      scene.add(g);
      const p = { opening: o, obj: g, board };
      o.planks.push(p);
      planks.push(p);
    }
  }
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
    const b = w.a.clone().addScaledVector(w.right, w.width);
    minX = Math.min(minX, w.a.x, b.x); maxX = Math.max(maxX, w.a.x, b.x);
    minZ = Math.min(minZ, w.a.z, b.z); maxZ = Math.max(maxZ, w.a.z, b.z);
  }
  minX = Math.max(minX - 1, head.x - 12); maxX = Math.min(maxX + 1, head.x + 12);
  minZ = Math.max(minZ - 1, head.z - 12); maxZ = Math.min(maxZ + 1, head.z + 12);
  nav.minX = minX; nav.minZ = minZ;
  nav.w = Math.ceil((maxX - minX) / nav.cell);
  nav.h = Math.ceil((maxZ - minZ) / nav.cell);
  nav.blocked = new Uint8Array(nav.w * nav.h);
  const boxes = room.surfaces.filter(s => s.type === 'table' || s.type === 'chair' || s.type === 'bench');
  const ops = openings();
  for (let j = 0; j < nav.h; j++) for (let i = 0; i < nav.w; i++) {
    const x = minX + (i + 0.5) * nav.cell, z = minZ + (j + 0.5) * nav.cell;
    let blocked = false;
    for (const s of boxes) {
      const dx = x - s.center.x, dz = z - s.center.z;
      if (Math.abs(dx * s.X.x + dz * s.X.z) <= s.hx + RADIUS && Math.abs(dx * s.Z.x + dz * s.Z.z) <= s.hz + RADIUS) { blocked = true; break; }
    }
    if (!blocked) for (const w of walls) {
      const u = (x - w.a.x) * w.right.x + (z - w.a.z) * w.right.z;
      const d = (x - w.a.x) * w.normal.x + (z - w.a.z) * w.normal.z;
      if (u < -RADIUS || u > w.width + RADIUS || Math.abs(d) > RADIUS) continue;
      // Türen sind begehbar
      const inDoor = ops.some(o => o.type === 'door' && Math.abs(o.mid.clone().sub(w.mid).dot(w.normal)) < 0.3 &&
        Math.abs((x - o.mid.x) * o.right.x + (z - o.mid.z) * o.right.z) < o.width / 2 - 0.05);
      if (!inDoor) { blocked = true; break; }
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
function findPath(from, to) {
  if (!nav.blocked) return [to.clone()];
  const s = nearestFree(...cellOf(from.x, from.z)), g = nearestFree(...cellOf(to.x, to.z));
  if (!s || !g) return [to.clone()];
  const W = nav.w, N = W * nav.h, start = s[1] * W + s[0], goal = g[1] * W + g[0];
  const gScore = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const open = [start];
  const h = (k) => Math.hypot((k % W) - g[0], Math.floor(k / W) - g[1]);
  const f = new Float32Array(N).fill(Infinity);
  gScore[start] = 0; f[start] = h(start);
  let iter = 0;
  while (open.length && iter++ < 6000) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
    const cur = open[bi];
    open[bi] = open[open.length - 1]; open.pop();
    if (cur === goal) break;
    closed[cur] = 1;
    const ci = cur % W, cj = Math.floor(cur / W);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = ci + di, nj = cj + dj;
      if (!isFreeCell(ni, nj)) continue;
      if (di && dj && (!isFreeCell(ci + di, cj) || !isFreeCell(ci, cj + dj))) continue; // keine Ecken schneiden
      const nk = nj * W + ni;
      if (closed[nk]) continue;
      const ng = gScore[cur] + (di && dj ? 1.414 : 1);
      if (ng < gScore[nk]) { gScore[nk] = ng; f[nk] = ng + h(nk); came[nk] = cur; if (!open.includes(nk)) open.push(nk); }
    }
  }
  if (came[goal] < 0 && goal !== start) return [to.clone()];
  const path = [];
  for (let k = goal; k !== -1 && k !== start; k = came[k]) path.push(new THREE.Vector3(nav.minX + ((k % W) + 0.5) * nav.cell, 0, nav.minZ + (Math.floor(k / W) + 0.5) * nav.cell));
  path.reverse();
  // Glätten: nur jeden 3. Punkt + Ziel
  const out = path.filter((_, i) => i % 3 === 2);
  out.push(to.clone().setY(0));
  return out;
}

// ---- Zombies erzeugen ------------------------------------------------------------
export function spawnZombie(wave, head) {
  const z = buildZombie();
  const scale = rand(0.92, 1.08);
  z.root.scale.setScalar(scale);
  const zombie = {
    ...z, scale, hp: 100 + wave * 10, maxHp: 100 + wave * 10, legHp: [60, 60], armHp: [45, 45], legLost: [false, false], armLost: [false, false],
    state: 'outside', pos: new THREE.Vector3(), yaw: 0, speed: Math.min(1.25, rand(0.45, 0.6) + wave * 0.05), phase: Math.random() * 6,
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
  zombie.root.position.x = zombie.pos.x;
  zombie.root.position.z = zombie.pos.z;
  zombie.root.traverse(o => { if (o.isMesh && o.userData.part) o.userData.zombie = zombie; });
  scene.add(zombie.root);
  zombies.push(zombie);
  return zombie;
}
export function clearZombies() {
  for (const z of zombies) { if (z.root.parent) z.root.parent.remove(z.root); }
  zombies.length = 0;
  for (const l of limbs) { removeDynamic(l.phys); if (l.obj.parent) l.obj.parent.remove(l.obj); }
  limbs.length = 0;
}
export const aliveCount = () => zombies.filter(z => z.state !== 'dead').length;
export function zombieHitMeshes() {
  const out = [];
  for (const z of zombies) {
    if (z.state === 'dead') continue;
    z.root.traverse(o => { if (o.isMesh && o.userData.part && o.visible) out.push(o); });
  }
  return out;
}
export const zombieHeads = () => zombies.filter(z => z.state !== 'dead' && !z.headless).map(z => z.skull.getWorldPosition(new THREE.Vector3()));

// ---- Schaden ---------------------------------------------------------------------
const limbs = [];
function detach(z, group, kind, sideIndex) {
  // Körperteil fällt ab (Physik), am Rumpf bleibt ein Stumpf
  group.updateWorldMatrix(true, true);
  const stump = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.1), stumpMat);
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
  z.hurtT = 0.25;
  z.hurtDir = dir.clone();
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
  const res = { part: partName, headshot, kill: false, limp: z.legHp.some(h => h < 30) && !z.crawl };
  if (z.hp <= 0) {
    res.kill = true;
    if (headshot && dmg * 3 >= 150) { z.head.visible = false; z.headless = true; burst(point, 0x7a0000, 30); }
    kill(z, dir);
  }
  return res;
}
function kill(z, dir) {
  z.state = 'dead';
  z.deadT = 0;
  // nach hinten (vom Schuss weg) umfallen
  const fwd = new THREE.Vector3(Math.sin(z.yaw), 0, Math.cos(z.yaw));
  z.fallDir = dir && dir.dot(fwd) > 0 ? 1 : -1;
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
    z.body.position.z = THREE.MathUtils.damp(z.body.position.z, -1.0, 6, dt);
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
  z.hips.position.y = 0.95 - Math.abs(s) * 0.03 - (limp[0] || limp[1] ? Math.max(0, limp[0] ? s : -s) * 0.08 : 0);
  z.body.rotation.z = (limp[0] ? -0.12 : limp[1] ? 0.12 : 0) + s * 0.05;
  z.arms.forEach((a, i) => { a.shoulder.rotation.x = -1.35 + (i ? s : -s) * 0.12; a.shoulder.rotation.z = (a.side) * -0.08; a.elbow.rotation.x = -0.2; });
  z.head.rotation.z = Math.sin(z.phase * 0.5) * 0.15;
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
  z.arms.forEach((a, i) => { a.shoulder.rotation.x = -1.2 - swing * 1.2 * (i ? 1 : 0.6); a.elbow.rotation.x = -0.6 + swing * 0.5; });
  z.body.rotation.x = THREE.MathUtils.damp(z.body.rotation.x, z.crawl ? 1.45 : 0.2 + swing * 0.2, 8, dt);
  z.legs.forEach(l => { l.hip.rotation.x *= 0.85; l.knee.rotation.x *= 0.85; });
}

export function updateZombies(dt, head, opts = {}) {
  const player = new THREE.Vector3(head.x, 0, head.z);
  for (let i = zombies.length - 1; i >= 0; i--) {
    const z = zombies[i];
    z.hurtT = Math.max(0, z.hurtT - dt);
    if (z.state === 'dead') {
      z.deadT += dt;
      const k = Math.min(1, z.deadT / 0.7);
      z.body.rotation.x = THREE.MathUtils.lerp(z.body.rotation.x, (z.crawl ? 1.5 : 1.5 * z.fallDir), k * 0.2);
      z.body.position.y = THREE.MathUtils.lerp(z.body.position.y, z.crawl ? 0.05 : 0.1, k * 0.2);
      z.arms.forEach(a => { a.shoulder.rotation.x *= 0.95; });
      if (z.deadT > 5) z.root.position.y -= dt * 0.3; // versinkt
      if (z.deadT > 8) { scene.remove(z.root); zombies.splice(i, 1); }
      continue;
    }
    z.groanT -= dt;
    if (z.groanT <= 0) { z.groanT = rand(2.5, 6); SFX3D.groan(z.skull.getWorldPosition(tmpV2), 1 / z.scale); }
    let speed = z.speed * (z.crawl ? 0.35 : z.legHp.some(h => h < 30) ? 0.55 : 1);
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
    } else if (z.state === 'walk' || z.state === 'attack') {
      const dist = Math.hypot(player.x - z.pos.x, player.z - z.pos.z);
      const reach = z.crawl ? 0.7 : 0.8;
      if (dist < reach) {
        z.state = 'attack';
        faceTowards(z, player, dt, 8);
        z.attackT -= dt;
        animateAttack(z, dt);
        if (z.attackT <= 0) {
          z.attackT = 1.3;
          SFX3D.swing(z.skull.getWorldPosition(tmpV2));
          const armsLeft = z.armLost.filter(x => !x).length;
          if (!opts.harmless && armsLeft > 0) onPlayerHit((z.crawl ? 6 : 10) * (armsLeft === 2 ? 1 : 0.6), z);
        }
      } else {
        z.state = 'walk';
        z.attackT = Math.min(z.attackT, 0.5);
        z.pathT -= dt;
        if (z.pathT <= 0 || !z.path || !z.path.length) { z.path = findPath(z.pos, player); z.pathT = rand(0.5, 0.9); }
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
    // Treffer-Reaktion: kurz nach hinten zucken
    if (z.hurtT > 0) z.torso.rotation.x = -z.hurtT * 1.6; else z.torso.rotation.x *= 0.8;
    z.root.position.x = z.pos.x;
    z.root.position.z = z.pos.z;
    z.root.rotation.y = z.yaw;
  }
  for (let i = limbs.length - 1; i >= 0; i--) {
    limbs[i].t -= dt;
    if (limbs[i].t <= 0) { removeDynamic(limbs[i].phys); scene.remove(limbs[i].obj); limbs.splice(i, 1); }
  }
}
