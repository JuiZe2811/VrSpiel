import * as THREE from 'three';
import { MAT } from './util.js';
import { addDynamic, removeDynamic, applyImpulse, localBoxOf } from './physics.js';
import { room, surfacesOf, wallSpot, topSpot } from './room.js';
import { SFX } from './sfx.js';
import { burst, bulletHole } from './effects.js';

// Zieltypen:
//  paper   – Ringscheibe (an der Wand, auf Ständer auf Tisch/Stuhl/Boden oder schwebend)
//  popper  – Stahlplatte auf Ständer, kippt bei Treffer um
//  can     – Dose auf Tisch/Stuhl, fliegt bei Treffer weg
//  bonus   – kleine Goldscheibe: viele Punkte + Zeitbonus, verschwindet schnell
//  noshoot – blaue "Nicht schießen"-Scheibe: Punktabzug

export const RING_POINTS = [10, 8, 6, 4, 2];
export const TARGET_RADIUS = 0.22;
export const targets = [];
let scene;
const raycaster = new THREE.Raycaster();
export function initTargets(s) { scene = s; }

const rand = THREE.MathUtils.randFloat;
const UP = new THREE.Vector3(0, 1, 0);

// ---- Texturen -------------------------------------------------------------
function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const paperTex = canvasTex(512, (ctx, size) => {
  const colors = ['#ffd21f', '#e0261b', '#ffffff', '#e0261b', '#ffffff'];
  for (let i = RING_POINTS.length - 1; i >= 0; i--) {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, (size / 2) * (i + 1) / RING_POINTS.length - 2, 0, Math.PI * 2);
    ctx.fillStyle = colors[i];
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#222';
    ctx.stroke();
  }
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 1; i < RING_POINTS.length; i++) {
    ctx.fillStyle = colors[i] === '#ffffff' ? '#222' : '#fff';
    ctx.fillText(RING_POINTS[i], size / 2, size / 2 - (size / 2) * (i + 0.5) / RING_POINTS.length);
  }
});
const noShootTex = canvasTex(512, (ctx, s) => {
  ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2 - 4, 0, Math.PI * 2); ctx.fillStyle = '#1d5fd6'; ctx.fill();
  ctx.lineWidth = 14; ctx.strokeStyle = '#fff'; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '170px system-ui, sans-serif'; ctx.fillText('✋', s / 2, s * 0.42);
  ctx.font = 'bold 50px system-ui, sans-serif'; ctx.fillText('NICHT', s / 2, s * 0.72); ctx.fillText('SCHIESSEN', s / 2, s * 0.82);
});
const bonusTex = canvasTex(256, (ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, 10, s / 2, s / 2, s / 2);
  g.addColorStop(0, '#fff6b0'); g.addColorStop(0.6, '#ffc21a'); g.addColorStop(1, '#b07800');
  ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2 - 3, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
  ctx.fillStyle = '#5a3a00'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 90px system-ui, sans-serif'; ctx.fillText('★', s / 2, s * 0.42);
  ctx.font = 'bold 44px system-ui, sans-serif'; ctx.fillText('+3 s', s / 2, s * 0.76);
});
const canTex = ['#d82020', '#1f9a3c', '#1d64d8', '#e0a010'].map(col => canvasTex(128, (ctx, s) => {
  ctx.fillStyle = col; ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(0, s * 0.38, s, s * 0.22);
  ctx.fillStyle = col; ctx.font = 'bold 22px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('COLA', s / 2, s * 0.49);
}));

const faceGeo = new THREE.CircleGeometry(TARGET_RADIUS, 48);
const paperMat = new THREE.MeshStandardMaterial({ map: paperTex, roughness: 0.85 });
const noShootMat = new THREE.MeshStandardMaterial({ map: noShootTex, roughness: 0.8 });
const bonusMat = new THREE.MeshStandardMaterial({ map: bonusTex, roughness: 0.3, metalness: 0.5, emissive: 0x332200 });
const backMat = new THREE.MeshStandardMaterial({ color: 0x5b4a36, roughness: 0.9 });
const steelMat = new THREE.MeshStandardMaterial({ color: 0x8d949b, metalness: 0.9, roughness: 0.35 });
const standMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.6 });

// ---- Bausteine ------------------------------------------------------------
function makeDisc(mat, radius, withBack = true) {
  const g = new THREE.Group();
  const face = new THREE.Mesh(faceGeo, mat);
  face.scale.setScalar(radius / TARGET_RADIUS);
  g.add(face);
  if (withBack) {
    const back = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.04, radius * 1.04, 0.012, 40), backMat);
    back.rotation.x = Math.PI / 2;
    back.position.z = -0.007;
    g.add(back);
  }
  return { g, face };
}
// Ständer: Fuß + Pfosten, oben sitzt die Scheibe
function makeStand(height) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.014, 0.1), standMat);
  base.position.y = 0.007;
  g.add(base);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, height, 8), standMat);
  post.position.y = height / 2;
  g.add(post);
  return g;
}

function newTarget(kind, group, hitMeshes, extra = {}) {
  const t = Object.assign({ kind, group, hitMeshes, hittable: true, dying: false, dieTime: 0, age: 0, life: Infinity, required: true, motion: null, phys: null, removeAt: Infinity, popIn: true }, extra);
  for (const m of hitMeshes) m.userData.target = t;
  group.scale.setScalar(0.01);
  scene.add(group);
  targets.push(t);
  return t;
}

// Ausrichtung: an der Wand flach, sonst zum Spieler gedreht
function orient(group, spot, head) {
  if (spot.normal) group.lookAt(group.position.clone().add(spot.normal));
  else group.rotation.y = Math.atan2(head.x - group.position.x, head.z - group.position.z);
}

// ---- Zieltypen ------------------------------------------------------------
function createPaper(spot, head, difficulty, kind = 'paper') {
  const mat = kind === 'noshoot' ? noShootMat : kind === 'bonus' ? bonusMat : paperMat;
  const radius = kind === 'bonus' ? 0.1 : spot.mount === 'top' ? 0.15 : THREE.MathUtils.lerp(0.22, 0.16, difficulty);
  const outer = new THREE.Group();
  const holder = new THREE.Group(); // dreht sich bei Wendescheiben
  const { g: disc, face } = makeDisc(mat, radius, kind !== 'bonus');
  holder.add(disc);
  outer.add(holder);
  outer.position.copy(spot.pos);
  if (spot.mount === 'top' || spot.mount === 'floor') {
    const h = spot.mount === 'floor' ? rand(0.7, 1.3) : 0.12;
    outer.add(makeStand(h));
    holder.position.y = h + radius;
  }
  orient(outer, spot, head);
  const t = newTarget(kind, outer, [face], { spot, radius, holder });
  if (kind === 'bonus') { t.life = 3.5; t.required = false; }
  if (kind === 'noshoot') { t.life = 4.5; t.required = false; }
  // Bewegung
  if (kind !== 'noshoot' && Math.random() < 0.12 + difficulty * 0.5) {
    if (spot.mount === 'wall') {
      const s = spot.surface, room0 = Math.min(spot.u - 0.3, s.width - 0.3 - spot.u, 0.9);
      if (room0 > 0.15) t.motion = { type: 'wall', amp: room0, speed: rand(0.6, 1.0 + difficulty), phase: Math.random() * 6 };
    } else if (spot.mount === 'float') {
      t.motion = { type: 'float', amp: rand(0.4, 1.0), ampY: Math.random() < 0.4 ? rand(0.1, 0.3) : 0, speed: rand(0.6, 1.0 + difficulty * 1.2), phase: Math.random() * 6, base: spot.pos.clone() };
    } else if (Math.random() < 0.7) {
      t.motion = { type: 'turn', speed: rand(0.8, 1.4), phase: Math.random() * 6 }; // Wendescheibe
    }
  }
  t.onHit = (hit) => {
    const local = hit.object.worldToLocal(hit.point.clone());
    const r = Math.hypot(local.x, local.y) / TARGET_RADIUS; // Geometrie ist skaliert
    if (kind === 'bonus') return { pts: 25, timeBonus: 3, label: '★ +25 / +3 s', color: '#ffd21f', sound: 'bonus' };
    if (kind === 'noshoot') return { pts: -25, penalty: true, label: '✋ −25', color: '#ff5050', sound: 'buzz' };
    bulletHole(hit.object, local);
    const ring = Math.floor(Math.min(0.999, r) * RING_POINTS.length);
    return { pts: RING_POINTS[ring] + (t.motion ? 2 : 0), ring, color: ring === 0 ? '#ffd21f' : '#ffffff' };
  };
  return t;
}

function createPopper(spot, head) {
  const outer = new THREE.Group();
  const h = spot.mount === 'floor' ? rand(0.5, 0.9) : 0.1;
  outer.add(makeStand(h));
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.012, 32), steelMat);
  plate.rotation.x = Math.PI / 2;
  plate.position.y = h + 0.1;
  outer.add(plate);
  outer.position.copy(spot.pos);
  orient(outer, spot, head);
  const t = newTarget('popper', outer, [plate], { spot });
  t.onHit = (hit, dir) => {
    if (!t.phys) {
      // kippt um: wird zum Physik-Körper
      t.group.scale.setScalar(1);
      t.phys = addDynamic(t.group, localBoxOf(t.group), 2.0, { onImpact: (v) => SFX.thud(Math.min(0.5, v * 0.1)) });
      t.removeAt = t.age + 3.5;
      t.popIn = false;
    }
    applyImpulse(t.phys, dir.clone().multiplyScalar(3), hit.point);
    return t.scored ? null : (t.scored = true, { pts: 8, label: '+8 ⚙', color: '#d0e4ff', sound: 'clang' });
  };
  return t;
}

const canGeo = new THREE.CylinderGeometry(0.033, 0.033, 0.122, 20);
const canTopMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 0.9, roughness: 0.3 });
function createCan(spot, head) {
  const g = new THREE.Group();
  const tex = canTex[Math.floor(Math.random() * canTex.length)];
  const can = new THREE.Mesh(canGeo, [new THREE.MeshStandardMaterial({ map: tex, metalness: 0.6, roughness: 0.35 }), canTopMat, canTopMat]);
  can.position.y = 0.061;
  g.add(can);
  g.position.copy(spot.pos);
  g.rotation.y = Math.random() * 6.28;
  const t = newTarget('can', g, [can], { spot });
  t.onHit = (hit, dir) => {
    if (!t.phys) {
      t.group.scale.setScalar(1);
      t.phys = addDynamic(t.group, localBoxOf(t.group), 0.25, { cylinder: { r: 0.033, h: 0.122 }, onImpact: (v) => SFX.click(1600, Math.min(0.4, v * 0.08), 0.05) });
      t.popIn = false;
      t.removeAt = t.age + 4;
    }
    applyImpulse(t.phys, dir.clone().multiplyScalar(0.9).add(new THREE.Vector3(0, 0.6, 0)), hit.point);
    return t.scored ? null : (t.scored = true, { pts: 6, label: '+6 🥫', color: '#ffffff', sound: 'can' });
  };
  return t;
}

// ---- Treffer verarbeiten ----------------------------------------------------
export function hittableMeshes() {
  const out = [];
  for (const t of targets) if (t.hittable) out.push(...t.hitMeshes);
  return out;
}
// liefert das Ergebnis eines Treffers (Punkte etc.) oder null
export function hitTarget(t, hit, dir) {
  if (!t.hittable) return null;
  const res = t.onHit(hit, dir);
  if (res && res.sound) SFX[res.sound]();
  if (t.kind === 'paper' || t.kind === 'bonus' || t.kind === 'noshoot') kill(t);
  if (res) {
    burst(hit.point, res.penalty ? 0x3070ff : res.ring === 0 ? 0xffd21f : t.kind === 'paper' ? 0xff4433 : 0xcccccc, res.ring === 0 ? 28 : 14);
    t.done = true;
  }
  return res;
}
function kill(t) {
  t.hittable = false;
  t.dying = true;
  t.dieTime = 0;
  t.spin = (Math.random() < 0.5 ? -1 : 1) * rand(6, 10);
}
export function removeTarget(t) {
  if (t.phys) removeDynamic(t.phys);
  if (t.group.parent) t.group.parent.remove(t.group);
  targets.splice(targets.indexOf(t), 1);
}
export function clearTargets() { while (targets.length) removeTarget(targets[0]); }
// alle verbleibenden Ziele verschwinden lassen
export function dismissTargets() { for (const t of targets) if (!t.phys) kill(t); else t.removeAt = Math.min(t.removeAt, t.age + 0.5); }
export const remainingRequired = () => targets.filter(t => t.required && !t.done && !t.dying).length;

// ---- Erzeugen ----------------------------------------------------------------
const occluders = () => room.surfaces.map(s => s.occluder);
function visible(head, pos) {
  const d = pos.clone().sub(head);
  const len = d.length();
  raycaster.set(head, d.normalize());
  raycaster.far = len - 0.08;
  return raycaster.intersectObjects(occluders(), false).length === 0;
}
function angleFromView(head, yaw, pos) {
  const a = Math.atan2(-(pos.x - head.x), -(pos.z - head.z));
  return Math.abs(Math.atan2(Math.sin(a - yaw), Math.cos(a - yaw)));
}

// Sucht eine Stelle für ein Ziel. mounts: erlaubte Befestigungen
function findSpot(mounts, opts) {
  const { head, yaw, range } = opts;
  const walls = surfacesOf('wall'), tops = surfacesOf('table', 'chair');
  const options = [];
  if (mounts.includes('wall') && walls.length) options.push('wall', 'wall', 'wall');
  if (mounts.includes('top') && tops.length) options.push('top', 'top');
  // Boden-Ständer und schwebende Ziele nur, wenn es keine passenden echten Flächen gibt
  if (!options.length && mounts.includes('floor')) options.push('floor');
  if (!options.length && mounts.includes('float')) options.push('float', 'float');
  if (!options.length) return null;
  let best = null, bestScore = Infinity;
  for (let i = 0; i < 14; i++) {
    const mount = options[Math.floor(Math.random() * options.length)];
    let spot;
    if (mount === 'wall') {
      // größere Wände häufiger wählen
      const total = walls.reduce((a, w) => a + w.width, 0);
      let r = Math.random() * total, w = walls[0];
      for (const x of walls) { r -= x.width; if (r <= 0) { w = x; break; } }
      spot = wallSpot(w);
    } else if (mount === 'top') {
      spot = topSpot(tops[Math.floor(Math.random() * tops.length)]);
    } else {
      const a = yaw + rand(-1.0, 1.0), d = rand(range[0], range[1]);
      const p = new THREE.Vector3(head.x - Math.sin(a) * d, mount === 'float' ? Math.max(0.6, head.y + rand(-0.6, 0.7)) : 0, head.z - Math.cos(a) * d);
      spot = { pos: p };
    }
    spot.mount = mount;
    const dist = Math.hypot(spot.pos.x - head.x, spot.pos.z - head.z);
    const checkPos = spot.pos.clone().setY(Math.max(spot.pos.y, 0.3) + (mount === 'wall' ? 0 : 0.2));
    let score = Math.random() * 0.5;
    if (dist < 1.0) score += 20;
    if (dist < range[0]) score += (range[0] - dist) * 0.6;
    if (angleFromView(head, yaw, spot.pos) > 1.9) score += 4;
    if (targets.some(t => !t.dying && t.group.position.distanceTo(spot.pos) < 0.45)) score += 30;
    if (!visible(head, checkPos)) score += 12;
    if (score < bestScore) { bestScore = score; best = spot; }
  }
  return bestScore < 20 ? best : null;
}

export function spawnTarget(opts) {
  const d = opts.difficulty;
  const tops = surfacesOf('table', 'chair');
  const pool = [['paper', 6], ['popper', 2], ['bonus', 0.5 + d], ['noshoot', 0.3 + d * 1.4]];
  if (tops.length) pool.push(['can', 2.5]);
  if (opts.onlyRequired) pool.splice(2, 2);
  let r = Math.random() * pool.reduce((a, p) => a + p[1], 0), kind = 'paper';
  for (const [k, w] of pool) { r -= w; if (r <= 0) { kind = k; break; } }
  if (opts.kind) kind = opts.kind;
  const mounts = { paper: ['wall', 'top', 'floor', 'float'], popper: ['top', 'floor'], can: ['top'], bonus: ['wall', 'float', 'top'], noshoot: ['wall', 'top', 'float'] }[kind];
  const spot = findSpot(mounts, opts);
  if (!spot) return null;
  if (kind === 'popper') return createPopper(spot, opts.head);
  if (kind === 'can') {
    // kleine Reihe Dosen
    const n = Math.random() < 0.6 ? 3 : 1;
    const side = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    let first = null;
    for (let i = 0; i < n; i++) {
      const p = spot.pos.clone().addScaledVector(side, (i - (n - 1) / 2) * 0.09);
      const s = spot.surface;
      const dx = p.x - s.center.x, dz = p.z - s.center.z;
      if (Math.abs(dx * s.X.x + dz * s.X.z) > s.hx - 0.04 || Math.abs(dx * s.Z.x + dz * s.Z.z) > s.hz - 0.04) continue;
      const t = createCan({ ...spot, pos: p }, opts.head);
      first = first || t;
    }
    return first;
  }
  return createPaper(spot, opts.head, d, kind);
}

// ---- Animation ------------------------------------------------------------------
const tmpV = new THREE.Vector3();
export function updateTargets(dt) {
  for (let i = targets.length - 1; i >= 0; i--) {
    const t = targets[i];
    t.age += dt;
    if (t.age >= t.removeAt) { removeTarget(t); continue; }
    if (t.phys) continue;
    if (t.dying) {
      t.dieTime += dt;
      t.group.rotateY(t.spin * dt);
      t.group.position.y -= dt * t.dieTime * 3;
      t.group.scale.setScalar(Math.max(0.001, 1 - t.dieTime * 2.2));
      if (t.dieTime > 0.45) removeTarget(t);
      continue;
    }
    if (t.age > t.life) { kill(t); t.done = true; continue; }
    if (t.popIn) {
      const pop = Math.min(1, t.age * 4);
      t.group.scale.setScalar(1 - Math.pow(1 - pop, 3) + Math.sin(pop * Math.PI) * 0.15);
      if (pop >= 1) t.popIn = false;
    }
    // Blinken kurz vor dem Verschwinden
    if (t.life < Infinity) t.group.visible = t.life - t.age > 1 || Math.floor(t.age * 10) % 2 === 0;
    const m = t.motion;
    if (!m) continue;
    const s = Math.sin(t.age * m.speed + m.phase);
    if (m.type === 'wall') {
      const sf = t.spot.surface;
      t.group.position.copy(sf.a).addScaledVector(sf.right, t.spot.u + s * m.amp).setY(t.spot.y).addScaledVector(sf.normal, 0.012);
    } else if (m.type === 'float') {
      tmpV.set(1, 0, 0).applyQuaternion(t.group.quaternion);
      t.group.position.copy(m.base).addScaledVector(tmpV, s * m.amp);
      t.group.position.y = Math.max(0.4, m.base.y + Math.cos(t.age * m.speed * 1.3 + m.phase) * m.ampY);
    } else if (m.type === 'turn') {
      // dreht sich weg (Kante zum Spieler) und wieder zurück
      t.holder.rotation.y = Math.max(0, Math.sin(t.age * m.speed + m.phase)) * Math.PI / 2;
    }
  }
}
