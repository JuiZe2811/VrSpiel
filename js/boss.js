// Boss-Runde (jede 5. Welle): ein einzelner, menschlicher Boss (eigenes 3D-Modell) mit wechselnden Angriffen.
// Jede Stufe eine bessere Schusswaffe (Pistole → Revolver → MP → Flinte → Sturmgewehr → MG → Panzerbüchse → Minigun),
// dazu Nahkampf: Sturmangriff + Stampfer, ab Stufe 3 Teleport + Wut-Modus, ab Stufe 4 Wirbelwind, ab Stufe 5 ab und zu Granaten.
// Er wird wie ein Zombie in die Zombie-Liste eingetragen – alle Waffen, Fallen, Granaten treffen ihn ganz normal.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { zombies, walkable, registerBoss } from './zombies.js?v=33';
import { burst, shockwave, puff, sparks } from './effects.js?v=33';
import { SFX, SFX3D } from './sfx.js?v=33';
import { makePanel } from './util.js?v=33';
import { buildWeapon, makeGrenade, WEAPON_DEFS } from './weapons.js?v=33';
import './weaponkit.js?v=33';
import { roomOccluders } from './room.js?v=33';

let scene = null, cb = { playerHit: () => {}, pulse: () => {}, speak: () => {} };
let template = null;
export const bossReady = () => !!template;
export function initBoss(s, callbacks) {
  scene = s;
  Object.assign(cb, callbacks);
  new GLTFLoader().load('models/boss.glb', (g) => {
    template = g.scene;
    template.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; if (o.material) o.material.envMapIntensity = 0.5; } });
  }, undefined, () => { template = null; });
  registerBoss({ update: updateBoss, clear: clearBoss });
}

const UP = new THREE.Vector3(0, 1, 0), AX = new THREE.Vector3(1, 0, 0), AZ = new THREE.Vector3(0, 0, 1);
const ANIM_BONES = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftUpLeg', 'LeftLeg', 'RightUpLeg', 'RightLeg', 'LeftArm', 'LeftForeArm', 'RightArm', 'RightForeArm'];
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _qr = new THREE.Quaternion();
// Knochen um eine Achse im Boss-Koordinatensystem drehen (unabhängig von der Knochen-Ausrichtung im Modell)
function setBone(B, name, q) {
  const b = B.bones[name];
  if (!b) return;
  b.parent.updateWorldMatrix(true, false);
  _q1.copy(B.rootQInv).multiply(b.parent.getWorldQuaternion(_q2)); // Eltern-Ausrichtung relativ zum Boss
  b.quaternion.copy(_q1).invert().multiply(q).multiply(_q1).multiply(B.base[name]);
}
const rot = (axis, a) => new THREE.Quaternion().setFromAxisAngle(axis, a);
const comb = (...qs) => qs.reduce((acc, q) => acc.multiply(q), new THREE.Quaternion());

// ---- Erzeugen ------------------------------------------------------------------------
let boss = null, projectiles = [], rings = [], bar = null;
export const currentBoss = () => boss;
export function spawnBoss(level, head, diffHp = 1) {
  if (!template) return null;
  const model = cloneSkinned(template);
  // eigene Material-Kopien (für die rote Wut-Färbung)
  const mats = [];
  model.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); mats.push(o.material); } });
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  body.add(model);
  const S = 1.05 + Math.min(0.25, level * 0.04); // mit jeder Stufe etwas größer
  model.scale.setScalar(S);
  const bones = {};
  model.traverse(o => { if (o.isBone) bones[o.name] = o; });
  const B = { bones, base: {}, rootQInv: new THREE.Quaternion() };
  root.updateMatrixWorld(true);
  for (const n of ANIM_BONES) if (bones[n]) B.base[n] = bones[n].quaternion.clone();
  // Grundhaltung: Arme aus der T-Pose nach unten
  setBone(B, 'LeftArm', rot(AZ, -1.2)); B.base.LeftArm = bones.LeftArm.quaternion.clone();
  setBone(B, 'RightArm', rot(AZ, 1.2)); B.base.RightArm = bones.RightArm.quaternion.clone();
  // Platz: ca. 3 m vor dem Spieler, möglichst frei
  const pos = new THREE.Vector3();
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2, d = 2.6 + (k % 3) * 0.4;
    pos.set(head.x + Math.sin(a) * d, 0, head.z - Math.cos(a) * d);
    if (walkable(pos.x, pos.z)) break;
  }
  const hp = 2500 * (1 + 0.8 * (level - 1)) * diffHp;
  const z = {
    type: 'boss', T: { boss: true, width: 1, hp, speed: 1, dmg: 20, name: 'Boss' }, scale: S, level,
    root, body, hips: bones.Hips, torso: bones.Spine1, neck: bones.Neck, head: bones.Head, skull: bones.Head, jaw: new THREE.Object3D(),
    arms: [], legs: [], legLost: [false, false], armLost: [false, false], legHp: [999, 999], armHp: [999, 999],
    hp, maxHp: hp, state: 'intro', pos: pos.clone(), yaw: 0, speed: 0.75 + 0.08 * level, phase: 0, hurtT: 0, deadT: 0,
    B, mats, mode: 'intro', t: 0, cool: 2.5, last: null, attackHit: false, rage: false, aimPt: head.clone(), flashT: 0
  };
  // Waffe(n) – ab Stufe 9 wechselt er zwischen mehreren
  z.guns = gunsFor(level).map(def => { const w = buildWeapon(def.id); w.root.scale.setScalar(S); w.root.visible = false; scene.add(w.root); return { def, w }; });
  z.gun = z.guns[0];
  z.gun.w.root.visible = true;
  z.gunName = bossGunName(level);
  z.yaw = Math.atan2(head.x - pos.x, head.z - pos.z);
  root.position.copy(pos);
  root.rotation.y = z.yaw;
  // Treffer: Kopf oder Körper je nach Höhe des Treffers
  const proxies = {};
  for (const [name, bone] of [['head', bones.Head], ['torso', bones.Spine1]]) { const o = new THREE.Object3D(); o.userData = { part: name, zombie: z, proxy: true }; bone.add(o); proxies[name] = o; }
  z.proxies = proxies;
  z.hitTorso = proxies.torso;
  model.traverse(o => {
    if (!o.isSkinnedMesh) return;
    o.userData.part = 'skinned';
    o.userData.zombie = z;
    o.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.4);
    const orig = THREE.SkinnedMesh.prototype.raycast;
    o.raycast = function (rc, out) {
      const start = out.length;
      orig.call(this, rc, out);
      for (let i = start; i < out.length; i++) {
        const local = root.worldToLocal(out[i].point.clone());
        out[i].object = local.y > 1.5 * S ? proxies.head : proxies.torso;
      }
    };
  });
  // Lebensbalken über dem Kopf
  bar = { p: makePanel(0.7, 0.1, 900), last: -1 };
  bar.p.mesh.renderOrder = 55;
  bar.p.mesh.material.depthTest = false;
  scene.add(bar.p.mesh);
  scene.add(root);
  zombies.push(z);
  boss = z;
  // Auftritt: Rauch, Brüllen
  burst(pos.clone().setY(0.8), 0x3a3a3a, 40);
  puff(pos.clone().setY(0.2), 0x555555, 0.6, 1.4, 0.6, 0.7);
  shockwave(pos.clone().setY(0.05));
  SFX3D.roar(pos.clone().setY(1.6));
  return z;
}
export function clearBoss() {
  if (boss && boss.root.parent) boss.root.parent.remove(boss.root);
  if (boss) { for (const m of boss.mats) m.dispose(); for (const g of boss.guns) scene.remove(g.w.root); if (boss.laser) { scene.remove(boss.laser); boss.laser.material.dispose(); } }
  boss = null;
  for (const p of projectiles) removeProjectile(p);
  projectiles = [];
  for (const r of rings) { scene.remove(r.obj); r.obj.geometry.dispose(); r.obj.material.dispose(); }
  rings = [];
  if (bar) { scene.remove(bar.p.mesh); bar.p.mesh.material.map.dispose(); bar.p.mesh.material.dispose(); bar.p.mesh.geometry.dispose(); bar = null; }
}

// ---- Waffen des Bosses ------------------------------------------------------------------
// Jede Boss-Runde eine bessere Waffe. Kugeln sind leuchtende Leuchtspuren – man sieht sie kommen und kann ausweichen
// (oder sich hinter Möbeln verstecken: Wände und Möbel halten sie auf).
const GUNS = [
  { id: 'pistol', name: 'Pistole', shots: 3, rate: 0.5, dmg: 7, speed: 8.5, spread: 0.025, aim: 1.0 },
  { id: 'revolver', name: 'Revolver', shots: 3, rate: 0.65, dmg: 12, speed: 9.5, spread: 0.02, aim: 0.95 },
  { id: 'mpk', name: 'Maschinenpistole', shots: 9, rate: 0.12, dmg: 5, speed: 10.5, spread: 0.05, aim: 0.9 },
  { id: 'shotgun', name: 'Pump-Flinte', shots: 2, rate: 1.0, pellets: 6, dmg: 5, speed: 11, spread: 0.1, aim: 0.85, near: true },
  { id: 'ar', name: 'Sturmgewehr', shots: 8, rate: 0.11, burst: 4, dmg: 6, speed: 12.5, spread: 0.04, aim: 0.8 },
  { id: 'lmg', name: 'Maschinengewehr', shots: 16, rate: 0.09, dmg: 5, speed: 13.5, spread: 0.06, aim: 0.9 },
  { id: 'antimat', name: 'Panzerbüchse', shots: 2, rate: 1.4, dmg: 32, speed: 24, spread: 0, aim: 1.6, laser: true },
  { id: 'minigun', name: 'Minigun', shots: 30, rate: 0.06, dmg: 4, speed: 14.5, spread: 0.075, aim: 1.4 }
];
export const GRENADE_LEVEL = 5; // ab Stufe 5 (Welle 25) wirft er ab und zu Granaten
const gunsFor = (level) => (level <= GUNS.length ? [GUNS[level - 1]] : GUNS.slice(-3)); // danach wechselt er zwischen den drei stärksten
export const bossGunName = (level) => (level <= GUNS.length ? GUNS[level - 1].name : 'Waffen-Arsenal');
// Stärke nach der letzten neuen Waffe: jede weitere Stufe mehr Schaden und schnellere Kugeln
const gunPower = (level) => 1 + Math.max(0, level - GUNS.length) * 0.12;

const tracerGeo = new THREE.BoxGeometry(0.018, 0.018, 0.3);
const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffc040, toneMapped: false });
const laserGeo = new THREE.CylinderGeometry(0.003, 0.003, 1, 4, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.5);
const _seg = new THREE.Vector3(), _cp = new THREE.Vector3();
function segDist(a, b, p) { // Abstand Punkt p zur Strecke a–b
  _seg.subVectors(b, a);
  const l2 = _seg.lengthSq();
  const t = l2 > 0 ? Math.max(0, Math.min(1, _cp.subVectors(p, a).dot(_seg) / l2)) : 0;
  return _cp.copy(a).addScaledVector(_seg, t).distanceTo(p);
}
const ray = new THREE.Raycaster();
function freeDist(from, to) { // wie weit fliegt eine Kugel, bevor eine Wand/ein Möbel sie stoppt?
  const dir = to.clone().sub(from), d = dir.length();
  ray.set(from, dir.normalize());
  ray.far = 30;
  const h = ray.intersectObjects(roomOccluders(), false)[0];
  return h ? h.distance : 30;
}
function muzzlePos(z) { return z.gun.w.sockets.muzzle.getWorldPosition(new THREE.Vector3()); }
function fireGun(z, head) {
  const g = z.gun.def, pw = gunPower(z.level);
  const from = muzzlePos(z);
  const n = g.pellets || 1;
  for (let i = 0; i < n; i++) {
    const dir = z.aimPt.clone().sub(from).normalize();
    dir.add(new THREE.Vector3().randomDirection().multiplyScalar(g.spread * (0.4 + Math.random()))).normalize();
    const obj = new THREE.Mesh(tracerGeo, tracerMat);
    obj.position.copy(from);
    obj.lookAt(from.clone().add(dir));
    scene.add(obj);
    projectiles.push({ kind: 'bullet', obj, vel: dir.multiplyScalar(g.speed * (1 + (pw - 1) * 0.5)), dmg: g.dmg * pw * (z.rage ? 1.2 : 1), left: freeDist(from, from.clone().add(dir)), whiz: false });
  }
  const w = z.gun.w;
  w.parts.flash.visible = true;
  w.parts.flash.rotation.z = Math.random() * 6;
  z.flashT = 0.05;
  SFX.shot({ ...WEAPON_DEFS[g.id], snd: { ...WEAPON_DEFS[g.id].snd, vol: WEAPON_DEFS[g.id].snd.vol * 0.75 }, upgraded: false });
  puff(from, 0xcccccc, 0.06, 0.4, 0.2, 0.3);
}
function throwGrenade(z, player) {
  const hand = z.B.bones.LeftHand ? z.B.bones.LeftHand.getWorldPosition(new THREE.Vector3()) : z.root.position.clone().setY(1.5);
  const a = Math.random() * Math.PI * 2, r = 0.3 + Math.random() * 0.7;
  const target = player.clone().add(new THREE.Vector3(Math.sin(a) * r, 0.05, Math.cos(a) * r));
  const T = 0.9 + hand.distanceTo(target) * 0.08;
  const vel = target.clone().sub(hand).divideScalar(T);
  vel.y += 0.5 * 9.8 * T;
  const obj = makeGrenade();
  obj.scale.setScalar(1.3);
  obj.position.copy(hand);
  const blink = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff2010, toneMapped: false }));
  blink.position.y = 0.06;
  obj.add(blink);
  scene.add(obj);
  const warn = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 40), new THREE.MeshBasicMaterial({ color: 0xff2a10, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
  warn.rotation.x = -Math.PI / 2;
  warn.scale.setScalar(GRENADE_R);
  warn.visible = false;
  scene.add(warn);
  projectiles.push({ kind: 'grenade', obj, vel, blink, warn, fuse: 2.2, landed: false, dmg: 30 + z.level * 3 });
  SFX3D.swing(hand);
}
const GRENADE_R = 2.3;
function explodeGrenade(p, head) {
  const at = p.obj.position.clone();
  SFX.explosion(1);
  burst(at.clone().setY(0.3), 0xff8a2a, 30);
  burst(at.clone().setY(0.3), 0x333333, 20);
  shockwave(at.clone().setY(0.05));
  puff(at.clone().setY(0.4), 0x555555, 0.8, 1.6, 0.6, 0.7);
  const d = Math.hypot(head.x - at.x, head.z - at.z);
  if (d < GRENADE_R) { cb.playerHit(p.dmg * (0.45 + 0.55 * (1 - d / GRENADE_R)), boss); cb.pulse(1, 400); }
  else cb.pulse(0.4, 150);
}
function removeProjectile(p) {
  scene.remove(p.obj);
  if (p.warn) { scene.remove(p.warn); p.warn.geometry.dispose(); p.warn.material.dispose(); p.blink.geometry.dispose(); p.blink.material.dispose(); }
}
const _prev = new THREE.Vector3(), _body = new THREE.Vector3();
function updateProjectiles(dt, head) {
  _body.set(head.x, head.y - 0.45, head.z);
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    if (p.kind === 'bullet') {
      _prev.copy(p.obj.position);
      const step = p.vel.length() * dt;
      p.obj.position.addScaledVector(p.vel, dt);
      p.left -= step;
      // Treffer: Kopf oder Oberkörper
      if (segDist(_prev, p.obj.position, head) < 0.17 || segDist(_prev, p.obj.position, _body) < 0.2) {
        cb.playerHit(p.dmg, boss); cb.pulse(0.8, 120);
        scene.remove(p.obj); projectiles.splice(i, 1); continue;
      }
      if (!p.whiz && segDist(_prev, p.obj.position, head) < 0.6) { p.whiz = true; SFX.whoosh(); }
      if (p.left <= 0) { sparks(p.obj.position.clone(), p.vel.clone().normalize().negate(), 6); scene.remove(p.obj); projectiles.splice(i, 1); }
      continue;
    }
    // Granate: fliegt im Bogen, rollt aus, blinkt immer schneller, dann Explosion
    p.fuse -= dt;
    if (!p.landed) {
      p.vel.y -= 9.8 * dt;
      const nx = p.obj.position.x + p.vel.x * dt, nz = p.obj.position.z + p.vel.z * dt;
      if (!walkable(nx, nz) && walkable(p.obj.position.x, p.obj.position.z)) { p.vel.x *= -0.3; p.vel.z *= -0.3; } else { p.obj.position.x = nx; p.obj.position.z = nz; } // nur an Wänden abprallen
      p.obj.position.y += p.vel.y * dt;
      p.obj.rotation.x += dt * 8;
      if (p.obj.position.y <= 0.045) { p.obj.position.y = 0.045; p.landed = true; p.vel.multiplyScalar(0.25); p.vel.y = 0; SFX.thud(0.3); }
    } else {
      const rx = p.obj.position.x + p.vel.x * dt, rz = p.obj.position.z + p.vel.z * dt;
      if (walkable(rx, rz)) { p.obj.position.x = rx; p.obj.position.z = rz; }
      p.vel.multiplyScalar(Math.max(0, 1 - dt * 4));
      p.warn.visible = true;
      p.warn.position.set(p.obj.position.x, 0.02, p.obj.position.z);
    }
    const f = Math.max(0.08, p.fuse / 2.2);
    const on = Math.sin(p.fuse * Math.PI * 2 / (f * 0.5)) > 0;
    p.blink.visible = on;
    if (p.warn.visible) p.warn.material.opacity = on ? 0.85 : 0.35;
    if (on && !p.beeped) { p.beeped = true; SFX.tick(); } else if (!on) p.beeped = false;
    if (p.fuse <= 0) { explodeGrenade(p, head); removeProjectile(p); projectiles.splice(i, 1); }
  }
}

// ---- Angriffe --------------------------------------------------------------------------
const ATTACKS = [
  { id: 'shoot', from: 1, wind: 0.9, name: 'Schießen' },
  { id: 'charge', from: 1, wind: 0.9, name: 'Sturmangriff' },
  { id: 'stomp', from: 1, wind: 0.75, name: 'Stampfer' },
  { id: 'blink', from: 3, wind: 0.55, name: 'Teleport' },
  { id: 'spin', from: 4, wind: 0.45, name: 'Wirbelwind' },
  { id: 'grenade', from: GRENADE_LEVEL, wind: 0.7, name: 'Granate' }
];
function pickAttack(z, dist) {
  const list = ATTACKS.filter(a => z.level >= a.from && (a.id !== z.last || a.id === 'shoot'));
  // Schießen ist der Hauptangriff; nah dran lieber Stampfer/Wirbelwind; Granaten nur ab und zu
  const w = list.map(a => a.id === 'shoot' ? (dist < 1.6 && !z.gun.def.near ? 1.5 : 5)
    : a.id === 'grenade' ? (dist > 2 ? 1.2 : 0.2)
    : a.id === 'stomp' || a.id === 'spin' ? (dist < 1.8 ? 3 : 0.3)
    : (dist < 1.8 ? 0.6 : 0.8));
  let r = Math.random() * w.reduce((x, y) => x + y, 0);
  for (let i = 0; i < list.length; i++) { r -= w[i]; if (r <= 0) return list[i]; }
  return list[0];
}
const flat = (v) => new THREE.Vector3(v.x, 0, v.z);
function moveBoss(z, target, speed, dt) {
  const d = flat(target).sub(flat(z.pos));
  const len = d.length();
  if (len < 0.01) return true;
  const step = Math.min(len, speed * dt);
  d.multiplyScalar(step / len);
  const nx = z.pos.x + d.x, nz = z.pos.z + d.z;
  if (walkable(nx, nz)) { z.pos.x = nx; z.pos.z = nz; return false; }
  if (walkable(nx, z.pos.z)) z.pos.x = nx; else if (walkable(z.pos.x, nz)) z.pos.z = nz; else return true; // Wand
  return false;
}
function face(z, target, dt, rate = 6) {
  const want = Math.atan2(target.x - z.pos.x, target.z - z.pos.z);
  const d = Math.atan2(Math.sin(want - z.yaw), Math.cos(want - z.yaw));
  z.yaw += d * Math.min(1, dt * rate);
}
function hitPlayer(z, dmg) {
  cb.playerHit(dmg * (z.rage ? 1.25 : 1), z);
  cb.pulse(1, 200);
}
function updateRings(dt, head) {
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    r.r += r.speed * dt;
    r.obj.scale.setScalar(r.r);
    r.obj.material.opacity = Math.max(0, 0.85 * (1 - r.r / r.max));
    const d = Math.hypot(head.x - r.x, head.z - r.z);
    if (!r.hit && Math.abs(d - r.r) < 0.3) { r.hit = true; cb.playerHit(r.dmg, boss); cb.pulse(1, 250); }
    if (r.r >= r.max) { scene.remove(r.obj); r.obj.geometry.dispose(); r.obj.material.dispose(); rings.splice(i, 1); }
  }
}
// Waffe in der rechten Hand: zielt beim Schießen auf den Zielpunkt, sonst schräg nach unten
const _aimT = new THREE.Vector3(), _m4 = new THREE.Matrix4(), _hand = new THREE.Vector3(), _tgt = new THREE.Vector3();
function placeGun(z, aiming, dt) {
  const w = z.gun.w;
  z.B.bones.RightHand.getWorldPosition(_hand);
  if (aiming) _tgt.copy(z.aimPt);
  else _tgt.set(Math.sin(z.yaw), 0, Math.cos(z.yaw)).multiplyScalar(0.5).add(_hand).add(new THREE.Vector3(0, -0.7, 0));
  w.root.position.copy(_hand);
  w.root.quaternion.setFromRotationMatrix(_m4.lookAt(_hand, _tgt, UP));
  if (z.flashT > 0 && (z.flashT -= dt) <= 0) w.parts.flash.visible = false;
}

// ---- Animationen (Knochen) ------------------------------------------------------------------
function animate(z, dt, pose) {
  const B = z.B;
  z.root.updateMatrixWorld(true);
  B.rootQInv.copy(z.root.getWorldQuaternion(_qr)).invert();
  const s = Math.sin(z.phase), c = Math.cos(z.phase);
  const walk = pose.walk || 0;
  const lean = pose.lean || 0, armsUp = pose.armsUp || 0, rArm = pose.rArm || 0, tpose = pose.tpose || 0, crouch = pose.crouch || 0, aim = pose.aim || 0;
  const twoHand = z.gun && WEAPON_DEFS[z.gun.def.id].twoHand !== false && z.gun.def.id !== 'pistol' && z.gun.def.id !== 'revolver' && z.gun.def.id !== 'mpk';
  // Oberkörper
  const hurt = Math.max(0, z.hurtT) * 2.5;
  setBone(B, 'Spine', rot(AX, lean * 0.5 - hurt * 0.4 + crouch * 0.25));
  setBone(B, 'Spine1', rot(AX, lean * 0.3));
  setBone(B, 'Neck', rot(AX, -lean * 0.4));
  // Beine: Schritt-Zyklus, Hocke
  setBone(B, 'LeftUpLeg', rot(AX, -s * 0.5 * walk - crouch * 0.9));
  setBone(B, 'LeftLeg', rot(AX, Math.max(0, -c) * 0.8 * walk + crouch * 1.4));
  setBone(B, 'RightUpLeg', rot(AX, s * 0.5 * walk - crouch * 0.9));
  setBone(B, 'RightLeg', rot(AX, Math.max(0, c) * 0.8 * walk + crouch * 1.4));
  // Arme: Gehen pendeln, hoch (Stampfer), T-Pose (Wirbelwind), rechter Arm zum Werfen
  // Zielen: rechter Arm nach vorn gestreckt, bei Gewehren stützt der linke Arm mit
  const lAim = twoHand ? aim : 0;
  const lArm = comb(rot(AZ, 1.2 * tpose), rot(UP, -0.5 * lAim), rot(AX, s * 0.45 * walk * (1 - lAim) - armsUp * 2.6 - lAim * 1.3));
  const rArmQ = comb(rot(AZ, -1.2 * tpose), rot(UP, 0.15 * aim), rot(AX, -s * 0.45 * walk * (1 - aim) - armsUp * 2.6 - rArm * 2.8 - aim * 1.45));
  setBone(B, 'LeftArm', lArm);
  setBone(B, 'RightArm', rArmQ);
  setBone(B, 'LeftForeArm', rot(AX, -0.3 * walk * (1 - lAim) - 0.4 * armsUp - 0.5 * lAim));
  setBone(B, 'RightForeArm', rot(AX, -0.3 * walk * (1 - aim) - 0.4 * armsUp - 0.6 * rArm));
  z.body.position.y = -crouch * 0.18 * z.scale + Math.abs(s) * 0.03 * walk;
}

// ---- Haupt-Update -------------------------------------------------------------------------
function updateBoss(z, dt, head, opts) {
  const player = new THREE.Vector3(head.x, 0, head.z);
  z.t += dt;
  z.hurtT = Math.max(0, (z.hurtT || 0) - dt);
  updateProjectiles(dt, head);
  updateRings(dt, head);
  // Lebensbalken
  if (bar) {
    bar.p.mesh.position.copy(z.root.position).add(new THREE.Vector3(0, 2.15 * z.scale, 0));
    bar.p.mesh.lookAt(head);
    const k = Math.max(0, z.hp / z.maxHp);
    if (Math.abs(k - bar.last) > 0.004) {
      bar.last = k;
      bar.p.draw((ctx, w, h) => {
        ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = z.rage ? '#ff2a1a' : '#e03a2a'; ctx.fillRect(8, h * 0.52, (w - 16) * k, h * 0.38);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(8, h * 0.52, w - 16, h * 0.38);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 30px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(`👑 BOSS · Stufe ${z.level} · ${z.gun.def.name}${z.rage ? ' · WUT' : ''}`, w / 2, h * 0.27);
      });
    }
  }
  // Tod: nach hinten umfallen, versinken, verschwinden
  if (z.state === 'dead') {
    z.deadT += dt;
    if (bar) bar.p.mesh.visible = false;
    if (z.laser) z.laser.visible = false;
    // Waffe fällt zu Boden
    const gw = z.gun.w.root;
    if (gw.position.y > 0.04) { z.gunVy = (z.gunVy || 0) - 9.8 * dt; gw.position.y = Math.max(0.04, gw.position.y + z.gunVy * dt); gw.rotation.z += dt * 3; z.gun.w.parts.flash.visible = false; }
    z.body.rotation.x = -Math.min(1.5, z.deadT * 2.2);
    if (z.deadT > 1.6) { z.root.position.y -= dt * 0.5; if (Math.random() < dt * 10) burst(z.root.position.clone().setY(0.1), 0x2a221c, 3); }
    if (z.deadT > 4) { clearBoss(); const i = zombies.indexOf(z); if (i >= 0) zombies.splice(i, 1); }
    return;
  }
  if (z.frozenT > 0) { z.frozenT -= dt; if (z.frozenT <= 0 && z.ice) z.ice.visible = false; if (z.laser) z.laser.visible = false; return; }
  // Zielpunkt folgt dem Kopf des Spielers mit Verzögerung – wer sich bewegt, weicht aus
  const track = Math.min(5, 2.2 + z.level * 0.25) * (z.rage ? 1.3 : 1);
  z.aimPt.lerp(_aimT.set(head.x, head.y - 0.12, head.z), Math.min(1, dt * track));
  const aiming = (z.mode === 'wind' || z.mode === 'attack') && z.atk && z.atk.id === 'shoot';
  // Wut-Modus ab Stufe 3 bei wenig Leben
  if (!z.rage && z.level >= 3 && z.hp < z.maxHp * 0.35) {
    z.rage = true;
    for (const m of z.mats) { m.emissive = new THREE.Color(0x550000); m.emissiveIntensity = 1; }
    SFX3D.roar(z.root.position.clone().setY(1.6));
    cb.speak('Der Boss ist wütend!');
  }
  const rage = z.rage ? 1.5 : 1;
  const G = z.gun.def;
  const dist = Math.hypot(player.x - z.pos.x, player.z - z.pos.z);
  let pose = {};
  if (z.mode === 'intro') {
    pose = { armsUp: Math.max(0, Math.sin(Math.min(1, z.t / 1.6) * Math.PI)) };
    face(z, player, dt);
    if (z.t > 1.8) { z.mode = 'move'; z.t = 0; }
  } else if (z.mode === 'move') {
    // Abstand halten (2–3 m), dabei seitlich ausweichen
    const far = G.near ? 2.6 : 4.2, close = G.near ? 1.5 : 2.6;
    const want = dist > far ? player.clone() : dist < close ? z.pos.clone().add(flat(z.pos).sub(player).normalize()) : z.pos.clone().add(new THREE.Vector3(-(player.z - z.pos.z), 0, player.x - z.pos.x).normalize().multiplyScalar(Math.sin(z.t * 0.7) > 0 ? 1 : -1));
    moveBoss(z, want, z.speed * rage, dt);
    face(z, player, dt);
    z.phase += dt * 6 * z.speed * rage;
    pose = { walk: 1 };
    z.cool -= dt * rage;
    if (z.stepT === undefined || (z.stepT -= dt) <= 0) { z.stepT = 0.42 / rage; SFX3D.step(z.root.position.clone(), 1.3); }
    if (z.cool <= 0) {
      z.atk = pickAttack(z, dist);
      z.last = z.atk.id;
      z.mode = 'wind'; z.t = 0; z.attackHit = false;
      if (z.atk.id === 'shoot' && z.guns.length > 1) { // Waffe wechseln
        z.gun.w.root.visible = false; z.gun.w.parts.flash.visible = false;
        z.gun = z.guns[Math.floor(Math.random() * z.guns.length)];
        z.gun.w.root.visible = true; bar.last = -1; SFX.rackBack();
      }
      if (z.atk.id === 'shoot') z.aimPt.copy(z.root.position).add(new THREE.Vector3(Math.sin(z.yaw), 1.3, Math.cos(z.yaw)));
      if (z.atk.id === 'blink') { puff(z.root.position.clone().setY(1), 0x444444, 0.5, 0.8, 0.4, 0.8); }
      SFX3D.growl(z.root.position.clone().setY(1.6), 'brute');
    }
  } else if (z.mode === 'wind') {
    const a = z.atk, k = Math.min(1, z.t / ((a.id === 'shoot' ? G.aim : a.wind) / rage));
    face(z, player, dt, 10);
    if (a.id === 'charge') pose = { lean: 0.6 * k, crouch: 0.35 * k };
    else if (a.id === 'stomp') pose = { armsUp: k, crouch: -0.1 * k };
    else if (a.id === 'shoot') pose = { aim: Math.min(1, k * 2.5) };
    else if (a.id === 'grenade') pose = { armsUp: 0.45 * k, lean: -0.25 * k };
    else if (a.id === 'blink') { pose = { crouch: 0.3 * k }; z.root.scale.setScalar(1 - k * 0.9); }
    else if (a.id === 'spin') pose = { tpose: k };
    if (k >= 1) {
      z.mode = 'attack'; z.t = 0;
      if (a.id === 'charge') { z.chargeDir = flat(player).sub(flat(z.pos)).normalize(); SFX3D.roar(z.root.position.clone().setY(1.6)); }
      if (a.id === 'stomp') {
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color: 0xff3a1a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(z.pos.x, 0.03, z.pos.z);
        scene.add(ring);
        rings.push({ obj: ring, r: 0.3, x: z.pos.x, z: z.pos.z, speed: 2.6 + z.level * 0.25, max: 2.6 + z.level * 0.3, dmg: 14 + z.level * 4, hit: false });
        shockwave(z.root.position.clone().setY(0.05));
        burst(z.root.position.clone().setY(0.1), 0x5a5048, 25);
        SFX3D.bang(z.root.position.clone()); SFX.thunder();
        cb.pulse(0.7, 200);
      }
      if (a.id === 'shoot') { z.shotsLeft = G.shots + (z.rage ? Math.ceil(G.shots * 0.3) : 0); z.shotT = 0; z.burstN = 0; }
      if (a.id === 'grenade') { const n = z.level >= 8 ? 2 : 1; for (let i = 0; i < n; i++) throwGrenade(z, player); }
      if (a.id === 'blink') {
        // hinter den Spieler (Richtung, in die er gerade nicht schaut, ist ungefähr „hinter“ vom Boss aus gesehen)
        const dir = flat(player).sub(flat(z.pos)).normalize();
        const tgt = player.clone().addScaledVector(dir, 1.3);
        if (walkable(tgt.x, tgt.z)) z.pos.copy(tgt); else { const side = new THREE.Vector3(-dir.z, 0, dir.x); const t2 = player.clone().addScaledVector(side, 1.3); if (walkable(t2.x, t2.z)) z.pos.copy(t2); }
        z.root.position.set(z.pos.x, 0, z.pos.z);
        z.root.scale.setScalar(1);
        puff(z.root.position.clone().setY(1), 0x444444, 0.5, 0.8, 0.4, 0.8);
        SFX3D.growl(z.root.position.clone().setY(1.6), 'brute');
      }
    }
  } else if (z.mode === 'attack') {
    const a = z.atk;
    if (a.id === 'charge') {
      const blocked = moveBoss(z, z.pos.clone().addScaledVector(z.chargeDir, 1), (3.4 + z.level * 0.3) * rage, dt);
      z.phase += dt * 14;
      pose = { walk: 1.4, lean: 0.6 };
      if (!z.attackHit && Math.hypot(player.x - z.pos.x, player.z - z.pos.z) < 0.75) { z.attackHit = true; hitPlayer(z, 18 + z.level * 4); }
      if (blocked || z.t > 1.3) { z.mode = 'recover'; z.t = 0; if (blocked) { SFX3D.bang(z.root.position.clone().setY(1)); burst(z.root.position.clone().setY(1.2), 0x888888, 12); } }
    } else if (a.id === 'stomp') {
      pose = { armsUp: Math.max(0, 1 - z.t * 4), crouch: Math.max(0, 0.4 - z.t) };
      if (z.t > 0.6) { z.mode = 'recover'; z.t = 0; }
    } else if (a.id === 'shoot') {
      face(z, player, dt, 8);
      pose = { aim: 1 };
      z.shotT -= dt;
      if (z.shotT <= 0 && z.shotsLeft > 0) {
        fireGun(z, head);
        z.shotsLeft--;
        z.burstN++;
        z.shotT = G.rate * (z.rage ? 0.75 : 1) + (G.burst && z.burstN % G.burst === 0 ? 0.45 : 0);
        if (G.laser) z.t = 0; // Panzerbüchse: vor jedem Schuss wieder sichtbar zielen
      }
      if (z.shotsLeft <= 0 && z.shotT <= 0) { z.mode = 'recover'; z.t = 0; }
    } else if (a.id === 'grenade') {
      pose = { armsUp: Math.max(0, 0.45 - z.t * 2), lean: 0.2 };
      if (z.t > 0.5) { z.mode = 'recover'; z.t = 0; }
    } else if (a.id === 'blink') {
      face(z, player, dt, 12);
      const k = Math.min(1, z.t / 0.6);
      pose = { rArm: k, lean: 0.3 * k };
      if (z.t > 0.6 && !z.attackHit) { z.attackHit = true; SFX3D.swing(z.root.position.clone().setY(1.4)); if (dist < 1.4) hitPlayer(z, 16 + z.level * 4); }
      if (z.t > 0.9) { z.mode = 'recover'; z.t = 0; }
    } else if (a.id === 'spin') {
      z.yaw += dt * 14;
      moveBoss(z, player, 1.1 * rage, dt);
      pose = { tpose: 1 };
      z.spinHit = (z.spinHit || 0) - dt;
      if (z.spinHit <= 0) { z.spinHit = 0.25; SFX3D.swing(z.root.position.clone().setY(1.3)); if (dist < 1.15) { hitPlayer(z, 8 + z.level * 2); z.spinHit = 0.6; } }
      if (z.t > 2 + z.level * 0.2) { z.mode = 'recover'; z.t = 0; }
    }
  } else if (z.mode === 'recover') {
    face(z, player, dt, 3);
    pose = { lean: -0.1, crouch: 0.1 };
    if (z.t > (z.rage ? 0.35 : 0.9)) { z.mode = 'move'; z.t = 0; z.cool = Math.max(1.2, 3.4 - z.level * 0.3) * (0.7 + Math.random() * 0.6); if (z.rage && Math.random() < 0.5) z.cool = 0.2; }
  }
  z.root.position.x = z.pos.x;
  z.root.position.z = z.pos.z;
  z.root.rotation.y = z.yaw;
  animate(z, dt, pose);
  z.root.updateMatrixWorld(true);
  placeGun(z, aiming && (pose.aim || 0) > 0.6, dt);
  // Laser-Visier: zeigt beim Zielen, wohin er schießt (Vorwarnung)
  if (!z.laser) {
    z.laser = new THREE.Mesh(laserGeo, new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
    scene.add(z.laser);
  }
  const showLaser = aiming && (pose.aim || 0) > 0.6 && (z.mode === 'wind' || G.laser || G.id === 'minigun');
  z.laser.visible = showLaser;
  if (showLaser) {
    const m = muzzlePos(z);
    z.laser.position.copy(m);
    z.laser.quaternion.setFromRotationMatrix(_m4.lookAt(m, z.aimPt, UP));
    z.laser.scale.set(G.laser ? 2 : 1, G.laser ? 2 : 1, Math.min(12, freeDist(m, z.aimPt)));
    z.laser.material.opacity = 0.35 + 0.35 * Math.abs(Math.sin(z.t * 18));
  }
}
