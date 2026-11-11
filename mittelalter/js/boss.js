// Boss-Runde (jede 5. Welle): ein einzelner, menschlicher Boss (eigenes 3D-Modell) mit wechselnden Angriffen.
// Jede Stufe eine bessere Schusswaffe (Pistole → Revolver → MP → Flinte → Sturmgewehr → MG → Panzerbüchse → Minigun),
// dazu Nahkampf: Sturmangriff + Stampfer, ab Stufe 3 Teleport + Wut-Modus, ab Stufe 4 Wirbelwind, ab Stufe 5 ab und zu Granaten.
// Er wird wie ein Skelett in die Skelett-Liste eingetragen – alle Waffen, Fallen, Granaten treffen ihn ganz normal.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { zombies, walkable, registerBoss, openings, tearPlankFor, navPath, groundAt, isInside, nearestInside } from './zombies.js?v=2';
import { burst, shockwave, puff, sparks } from './effects.js?v=2';
import { SFX, SFX3D } from './sfx.js?v=2';
import { makePanel } from './util.js?v=2';
import { buildWeapon, makeGrenade, WEAPON_DEFS } from './weapons.js?v=2';
import { roomOccluders } from './room.js?v=2';
const hyp = (a, b, c = 0) => Math.sqrt(a * a + b * b + c * c); // schneller als Math.hypot und ohne Speicher-Müll

let scene = null, cb = { playerHit: () => {}, pulse: () => {}, speak: () => {} };
let template = null;
export const bossReady = () => !!template;
// Vorwärmen: eine Kopie einmal unsichtbar mitzeichnen lassen → Shader & Texturen sind fertig, bevor der Boss kommt
// (sonst ruckelt es beim ersten Erscheinen). Die Kopie bleibt (unsichtbar) in der Szene, damit nichts wieder freigegeben wird.
export function bossWarmup() {
  const g = new THREE.Group();
  const m = cloneSkinned(template);
  m.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.material = o.material.clone(); o.castShadow = true; } }); // wie beim Erscheinen: eigene Materialien
  g.add(m);
  for (const G of GUNS) { const w = buildWeapon(G.id); g.add(w.root); } // alle Boss-Waffen
  const sc = document.createElement('canvas'); sc.width = sc.height = 4;
  g.add(new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(sc), color: 0x555555, transparent: true, opacity: 0.5, depthWrite: false }))); // Rauch
  g.add(new THREE.Mesh(laserGeo, new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending })));
  g.add(new THREE.Mesh(tracerGeo, tracerMat));                                       // Leuchtspur-Kugel
  g.add(new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color: 0xff3a1a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, toneMapped: false })));
  g.add(makeGrenade());
  const p = makePanel(0.7, 0.1, 900); p.mesh.material.depthTest = false; g.add(p.mesh); // Lebensbalken
  g.traverse(o => { if (o.isMesh || o.isSprite) o.frustumCulled = false; if (o.isMesh && !o.material.transparent) o.castShadow = true; });
  return g;
}
export function initBoss(s, callbacks) {
  scene = s;
  Object.assign(cb, callbacks);
  new GLTFLoader().load('models/boss.glb', (g) => {
    template = g.scene;
    // Schwarzer Ritter: Kleidung wird zu dunkler Plattenrüstung (Muster der Textur bleibt als Gravur sichtbar)
    template.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; const old = o.material; o.material = new THREE.MeshStandardMaterial({ map: old && old.map, color: 0x9aa0ac, metalness: 0.55, roughness: 0.45, envMapIntensity: 1.0 }); } });
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

// ---- Helm mit Krone und glühenden Augen (am Kopf-Knochen, in Metern unabhängig von der Modell-Skalierung)
const helmIron = new THREE.MeshStandardMaterial({ color: 0x2c2f35, metalness: 0.85, roughness: 0.35 });
const helmGold = new THREE.MeshStandardMaterial({ color: 0xd4ab45, metalness: 0.7, roughness: 0.3, emissive: 0x3a2a00 });
const helmEye = new THREE.MeshBasicMaterial({ color: 0xff3a1a, toneMapped: false });
const HG = { helm: new THREE.SphereGeometry(0.135, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), guard: new THREE.BoxGeometry(0.2, 0.12, 0.03), eye: new THREE.BoxGeometry(0.05, 0.012, 0.01), band: new THREE.TorusGeometry(0.13, 0.016, 6, 24), spike: new THREE.ConeGeometry(0.022, 0.08, 4) }; // einmal für alle Bosse
function addCrownHelm(headBone, root) {
  root.updateMatrixWorld(true);
  const ws = headBone.getWorldScale(new THREE.Vector3());
  const g = new THREE.Group();
  g.scale.set(1 / ws.x, 1 / ws.y, 1 / ws.z);
  const helm = new THREE.Mesh(HG.helm, helmIron);
  helm.position.y = 0.1; g.add(helm);
  const guard = new THREE.Mesh(HG.guard, helmIron); guard.position.set(0, 0.06, 0.12); g.add(guard);
  for (const x of [-0.045, 0.045]) { const e = new THREE.Mesh(HG.eye, helmEye); e.position.set(x, 0.095, 0.137); g.add(e); }
  const band = new THREE.Mesh(HG.band, helmGold); band.rotation.x = Math.PI / 2; band.position.y = 0.17; g.add(band);
  for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; const c = new THREE.Mesh(HG.spike, helmGold); c.position.set(Math.sin(a) * 0.13, 0.22, Math.cos(a) * 0.13); g.add(c); }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  headBone.add(g);
}

// ---- Erzeugen ------------------------------------------------------------------------
let boss = null, projectiles = [], rings = [], bar = null;
const HIT_MAT = new THREE.MeshBasicMaterial({ visible: false });
const HIT_HEAD = new THREE.SphereGeometry(0.14, 8, 6);
const HIT_TORSO = new THREE.CapsuleGeometry(0.24, 0.42, 3, 8);
const HIT_LEGS = new THREE.CapsuleGeometry(0.2, 0.5, 3, 8);
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
  const S = 0.92 + Math.min(0.12, level * 0.02); // etwas kleiner als früher, mit jeder Stufe minimal größer
  model.scale.setScalar(S);
  const bones = {};
  model.traverse(o => { if (o.isBone) bones[o.name] = o; });
  if (bones.Head) addCrownHelm(bones.Head, root);
  const B = { bones, base: {}, rootQInv: new THREE.Quaternion() };
  root.updateMatrixWorld(true);
  for (const n of ANIM_BONES) if (bones[n]) B.base[n] = bones[n].quaternion.clone();
  // Grundhaltung: Arme aus der T-Pose nach unten
  setBone(B, 'LeftArm', rot(AZ, -1.2)); B.base.LeftArm = bones.LeftArm.quaternion.clone();
  setBone(B, 'RightArm', rot(AZ, 1.2)); B.base.RightArm = bones.RightArm.quaternion.clone();
  // Auftritt wie die Skelette: draußen vor einem zufälligen Fenster (sonst Tür), Bretter abreißen, hereinsteigen.
  // Erst danach greift er an. Ohne Fenster/Türen: steigt in der Nähe aus dem Boden.
  const ops = openings();
  const wins = ops.filter(o => o.type === 'window');
  const opening = (wins.length ? wins : ops)[Math.floor(Math.random() * (wins.length || ops.length))] || null;
  const pos = new THREE.Vector3();
  if (opening) pos.copy(opening.mid).addScaledVector(opening.normal, -3.2).setY(0);
  else for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2, d = 2.6 + (k % 3) * 0.4;
    pos.set(head.x + Math.sin(a) * d, 0, head.z - Math.cos(a) * d);
    if (walkable(pos.x, pos.z)) break;
  }
  const hp = 3600 * (1 + 0.9 * (level - 1)) * diffHp; // (v41: deutlich zäher)
  const z = {
    type: 'boss', T: { boss: true, width: 1, hp, speed: 1, dmg: 20, name: 'Boss' }, scale: S, level,
    root, body, hips: bones.Hips, torso: bones.Spine1, neck: bones.Neck, head: bones.Head, skull: bones.Head, jaw: new THREE.Object3D(),
    arms: [], legs: [], legLost: [false, false], armLost: [false, false], legHp: [999, 999], armHp: [999, 999],
    hp, maxHp: hp, state: 'intro', pos: pos.clone(), yaw: 0, speed: 0.9 + 0.09 * level, phase: 0, hurtT: 0, deadT: 0,
    B, mats, mode: opening ? 'approach' : 'intro', opening, t: 0, cool: 2.5, last: null, attackHit: false, rage: false, aimPt: head.clone(), flashT: 0
  };
  // Waffe(n) – ab Stufe 9 wechselt er zwischen mehreren
  z.guns = gunsFor(level).map(def => { const w = buildWeapon(def.id); w.root.scale.setScalar(S); w.root.visible = false; scene.add(w.root); return { def, w }; });
  z.gun = z.guns[0];
  z.gun.w.root.visible = true;
  z.gunName = bossGunName(level);
  z.yaw = Math.atan2(head.x - pos.x, head.z - pos.z);
  root.position.copy(pos);
  root.rotation.y = z.yaw;
  // Treffer: einfache unsichtbare Trefferkörper (Kopf-Kugel, Rumpf- und Bein-Kapsel) statt Treffertest
  // gegen das ganze Modell (21 000 Punkte mit Skelett pro Schuss = starker Lag bei Dauerfeuer/Schrot)
  const proxies = {};
  const mk = (geo, part, y) => { const m = new THREE.Mesh(geo, HIT_MAT); m.userData = { part, zombie: z }; m.position.y = y * S; m.scale.setScalar(S); body.add(m); return m; };
  proxies.head = mk(HIT_HEAD, 'head', 1.6);
  proxies.torso = mk(HIT_TORSO, 'torso', 1.12);
  mk(HIT_LEGS, 'torso', 0.42);
  z.proxies = proxies;
  z.hitTorso = proxies.torso;
  model.traverse(o => {
    if (!o.isSkinnedMesh) return;
    o.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.4);
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
  if (boss) { // alles freigeben: Materialien, Skelett-Texturen, Waffen-Geometrien
    for (const m of boss.mats) m.dispose();
    boss.root.traverse(o => { if (o.isSkinnedMesh) o.skeleton.dispose(); });
    for (const g of boss.guns) { scene.remove(g.w.root); g.w.root.traverse(o => { if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); }); } if (boss.laser) { scene.remove(boss.laser); boss.laser.material.dispose(); } }
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
  { id: 'kurzbogen', name: 'Kurzbogen', shots: 3, rate: 0.5, dmg: 7, speed: 8.5, spread: 0.025, aim: 1.0 },
  { id: 'armbrust', name: 'Armbrust', shots: 3, rate: 0.65, dmg: 12, speed: 9.5, spread: 0.02, aim: 0.95 },
  { id: 'langbogen', name: 'Langbogen-Salven', shots: 9, rate: 0.12, dmg: 5, speed: 10.5, spread: 0.05, aim: 0.9 },
  { id: 'kurzbogen', name: 'Streupfeile', shots: 2, rate: 1.0, pellets: 6, dmg: 5, speed: 11, spread: 0.1, aim: 0.85, near: true },
  { id: 'armbrust', name: 'Schnell-Armbrust', shots: 8, rate: 0.11, burst: 4, dmg: 6, speed: 12.5, spread: 0.04, aim: 0.8 },
  { id: 'langbogen', name: 'Pfeilhagel', shots: 16, rate: 0.09, dmg: 5, speed: 13.5, spread: 0.06, aim: 0.9 },
  { id: 'armbrust', name: 'Ballisten-Armbrust', shots: 2, rate: 1.4, dmg: 32, speed: 24, spread: 0, aim: 1.6, laser: true },
  { id: 'frostbogen', name: 'Sturmbogen', shots: 30, rate: 0.06, dmg: 4, speed: 14.5, spread: 0.075, aim: 1.4 }
];
export const GRENADE_LEVEL = 5; // ab Stufe 5 (Welle 25) wirft er ab und zu Granaten
const gunsFor = (level) => (level <= GUNS.length ? [GUNS[level - 1]] : GUNS.slice(-3)); // danach wechselt er zwischen den drei stärksten
export const bossGunName = (level) => (level <= GUNS.length ? GUNS[level - 1].name : 'Waffenkammer');
// Stärke nach der letzten neuen Waffe: jede weitere Stufe mehr Schaden und schnellere Kugeln
const gunPower = (level) => 1 + Math.max(0, level - GUNS.length) * 0.12;

const tracerGeo = new THREE.BoxGeometry(0.014, 0.014, 0.55); // leuchtender Pfeil (gut sichtbar zum Ausweichen)
const tracerMat = new THREE.MeshBasicMaterial({ color: 0xff9a40, toneMapped: false });
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
    projectiles.push({ kind: 'bullet', obj, vel: dir.multiplyScalar(g.speed * 1.15 * (1 + (pw - 1) * 0.5)), dmg: g.dmg * pw * 1.35 * (z.rage ? 1.2 : 1), left: freeDist(from, from.clone().add(dir)), whiz: false });
  }
  z.flashT = 0.05; // (Bogen: kein Mündungsfeuer)
  z.kick = 1; // Rückstoß-Animation
  SFX.shot({ ...WEAPON_DEFS[g.id], snd: { ...WEAPON_DEFS[g.id].snd, vol: WEAPON_DEFS[g.id].snd.vol * 0.75 }, upgraded: false });
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
  const d = hyp(head.x - at.x, head.z - at.z);
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
      const gy = groundAt(p.obj.position.x, p.obj.position.z) + 0.045; // landet auch auf Tisch/Bett
      if (p.obj.position.y <= gy && p.vel.y < 0) { p.obj.position.y = gy; p.landed = true; p.vel.multiplyScalar(0.25); p.vel.y = 0; SFX.thud(0.3); }
    } else {
      const rx = p.obj.position.x + p.vel.x * dt, rz = p.obj.position.z + p.vel.z * dt;
      if (walkable(rx, rz)) { p.obj.position.x = rx; p.obj.position.z = rz; }
      p.vel.multiplyScalar(Math.max(0, 1 - dt * 4));
      p.warn.visible = true;
      p.obj.position.y = groundAt(p.obj.position.x, p.obj.position.z) + 0.045; // rollt sie über die Kante, fällt sie mit
      p.warn.position.set(p.obj.position.x, p.obj.position.y - 0.025, p.obj.position.z);
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
  // Tisch/Bett vor ihm: beim normalen Laufen hochklettern, bei Angriffen (Sturmangriff …) ist dort Schluss
  const h = groundAt(nx, nz);
  if (h - (z.groundY || 0) > 0.2) {
    if (z.mode === 'move') {
      const ux = d.x / step, uz = d.z / step;
      z.climb = { t: 0, dur: 0.9 + 1.0 * (h - (z.groundY || 0)), y0: z.groundY || 0, y1: h, x0: z.pos.x, z0: z.pos.z, x1: z.pos.x + ux * 0.45, z1: z.pos.z + uz * 0.45 };
      z.yaw = Math.atan2(ux, uz);
      z.mode = 'climb'; z.t = 0;
    }
    return true;
  }
  if (walkable(nx, nz) || !walkable(z.pos.x, z.pos.z)) { z.pos.x = nx; z.pos.z = nz; z.groundY = groundAt(nx, nz); return false; } // (steht er in einer Sperrzone, darf er heraus)
  if (walkable(nx, z.pos.z)) z.pos.x = nx; else if (walkable(z.pos.x, nz)) z.pos.z = nz; else return true; // Wand
  z.groundY = groundAt(z.pos.x, z.pos.z);
  return false;
}
function clearPath(a, b) { // jede Stelle auf der Strecke begehbar?
  const d = hyp(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(d / 0.08));
  for (let i = 1; i <= n; i++) if (!walkable(a.x + (b.x - a.x) * i / n, a.z + (b.z - a.z) * i / n)) return false;
  return true;
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
    const d = hyp(head.x - r.x, head.z - r.z);
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
}

// ---- Animationen (Knochen) ------------------------------------------------------------------
// Lebendige, aber billige Animation: nur Knochen-Drehungen (keine Animations-Dateien, kaum Rechenaufwand).
// Dazu kommen Atmen, Kopf folgt dem Spieler, Becken-/Schulterschwung beim Gehen, Rückstoß beim Schießen,
// Trefferzucken zur Seite, Sprung beim Stampfer, Brüllen und ein Zusammenbrechen beim Tod.
function animate(z, dt, pose) {
  const B = z.B;
  z.root.updateMatrixWorld(true);
  B.rootQInv.copy(z.root.getWorldQuaternion(_qr)).invert();
  const s = Math.sin(z.phase), c = Math.cos(z.phase);
  const walk = pose.walk || 0;
  const lean = pose.lean || 0, armsUp = pose.armsUp || 0, rArm = pose.rArm || 0, tpose = pose.tpose || 0, crouch = pose.crouch || 0, aim = pose.aim || 0;
  const armsBack = pose.armsBack || 0, headBack = pose.headBack || 0, limp = pose.limp || 0;
  const twoHand = z.gun && WEAPON_DEFS[z.gun.def.id].twoHand !== false && z.gun.def.id !== 'kurzbogen';
  z.animT = (z.animT || 0) + dt;
  z.kick = Math.max(0, (z.kick || 0) - dt * 9);                       // Rückstoß klingt schnell ab
  const breathe = Math.sin(z.animT * (z.rage ? 5 : 2.2)) * (z.rage ? 0.05 : 0.03) * (1 - limp);
  const shake = z.rage && !limp ? (Math.random() - 0.5) * 0.03 : 0;   // Wut: zittert vor Zorn
  // Kopf folgt dem Spieler (begrenzt), Brüllen: Kopf in den Nacken
  let look = 0;
  if (z.lookPt && !limp) {
    const want = Math.atan2(z.lookPt.x - z.pos.x, z.lookPt.z - z.pos.z);
    look = THREE.MathUtils.clamp(Math.atan2(Math.sin(want - z.yaw), Math.cos(want - z.yaw)), -0.8, 0.8);
  }
  z.lookS = THREE.MathUtils.damp(z.lookS || 0, look, 8, dt);
  // Treffer: zuckt zurück und zur getroffenen Seite
  const hurt = Math.max(0, z.hurtT) * 2.5;
  const twist = hurt * 0.35 * (z.hurtTwist || 1);
  // Becken & Oberkörper: Gehen schwingt das Becken, die Schultern drehen gegen
  setBone(B, 'Hips', comb(rot(UP, s * 0.12 * walk), rot(AZ, c * 0.05 * walk)));
  setBone(B, 'Spine', comb(rot(UP, -s * 0.1 * walk + twist), rot(AX, lean * 0.5 - hurt * 0.4 + crouch * 0.25 - z.kick * 0.08 + shake)));
  setBone(B, 'Spine1', rot(AX, lean * 0.3 + breathe));
  setBone(B, 'Spine2', rot(AX, -breathe * 0.5 - headBack * 0.15));
  setBone(B, 'Neck', comb(rot(UP, z.lookS * 0.45), rot(AX, -lean * 0.4 - headBack * 0.5 + limp * 0.6)));
  setBone(B, 'Head', comb(rot(UP, z.lookS * 0.45), rot(AX, -headBack * 0.4 - z.kick * 0.05)));
  // Beine: Schritt-Zyklus, Hocke
  setBone(B, 'LeftUpLeg', rot(AX, -s * 0.5 * walk - crouch * 0.9));
  setBone(B, 'LeftLeg', rot(AX, Math.max(0, -c) * 0.8 * walk + crouch * 1.4));
  setBone(B, 'RightUpLeg', rot(AX, s * 0.5 * walk - crouch * 0.9));
  setBone(B, 'RightLeg', rot(AX, Math.max(0, c) * 0.8 * walk + crouch * 1.4));
  // Arme: Gehen pendeln, hoch (Stampfer), T-Pose (Wirbelwind/Brüllen), nach hinten (Sturmangriff), schlaff (Tod)
  // Zielen: rechter Arm nach vorn gestreckt, bei Gewehren stützt der linke Arm mit; Rückstoß reißt den Arm hoch
  const lAim = twoHand ? aim : 0;
  const swing = (1 - limp) * walk;
  const lArm = comb(rot(AZ, 1.2 * tpose), rot(UP, -0.5 * lAim), rot(AX, s * 0.45 * swing * (1 - lAim) - armsUp * 2.6 - lAim * 1.3 + armsBack * 0.7 - z.kick * 0.2 * lAim));
  const rArmQ = comb(rot(AZ, -1.2 * tpose), rot(UP, 0.15 * aim), rot(AX, -s * 0.45 * swing * (1 - aim) - armsUp * 2.6 - rArm * 2.8 - aim * 1.45 + armsBack * 0.7 - z.kick * 0.35));
  setBone(B, 'LeftArm', lArm);
  setBone(B, 'RightArm', rArmQ);
  setBone(B, 'LeftForeArm', rot(AX, -0.3 * swing * (1 - lAim) - 0.4 * armsUp - 0.5 * lAim - breathe));
  setBone(B, 'RightForeArm', rot(AX, -0.3 * swing * (1 - aim) - 0.4 * armsUp - 0.6 * rArm - z.kick * 0.15));
  z.body.position.y = -crouch * 0.18 * z.scale + Math.abs(s) * 0.03 * walk + (pose.hop || 0) * 0.25 * z.scale;
}

// ---- Haupt-Update -------------------------------------------------------------------------
function updateBoss(z, dt, head, opts) {
  const player = new THREE.Vector3(head.x, 0, head.z);
  z.lookPt = player;
  z.t += dt;
  z.hurtT = Math.max(0, (z.hurtT || 0) - dt);
  updateProjectiles(dt, head);
  updateRings(dt, head);
  // Lebensbalken
  if (bar) {
    bar.p.mesh.position.copy(z.root.position).add(new THREE.Vector3(0, 2.15 * z.scale, 0));
    bar.p.mesh.lookAt(head);
    const k = Math.max(0, z.hp / z.maxHp);
    bar.t = (bar.t || 0) - dt;
    if (Math.abs(k - bar.last) > 0.004 && (bar.t <= 0 || k <= 0)) { // höchstens ~7× pro Sekunde neu zeichnen (Textur-Upload kostet)
      bar.t = 0.15;
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
    if (gw.position.y > 0.04) { z.gunVy = (z.gunVy || 0) - 9.8 * dt; gw.position.y = Math.max(0.04, gw.position.y + z.gunVy * dt); gw.rotation.z += dt * 3; }
    // erst in die Knie sacken, dann vornüber fallen
    const kneel = Math.min(1, z.deadT / 0.55), fall = Math.min(1, Math.max(0, (z.deadT - 0.5) / 0.6));
    animate(z, dt, { crouch: kneel * 0.85 * (1 - fall * 0.5), lean: 0.3 + fall * 0.3, limp: 1 });
    z.body.rotation.x = fall * fall * 1.45;
    if (z.deadT > 1.6) { z.root.position.y -= dt * 0.5; if (Math.random() < dt * 10) burst(z.root.position.clone().setY(0.1), 0x2a221c, 3); }
    if (z.deadT > 4) { clearBoss(); const i = zombies.indexOf(z); if (i >= 0) zombies.splice(i, 1); }
    return;
  }
  if (z.frozenT > 0) { z.frozenT -= dt; if (z.frozenT <= 0 && z.ice) z.ice.visible = false; if (z.laser) z.laser.visible = false; return; }
  // Wer ihn dauerhaft beschießt, dem weicht er mit einem Seitensprung aus; bleibt er eine Weile unverletzt,
  // heilt er langsam (höchstens bis 90 %) – man muss also dranbleiben
  if (z.lastHp === undefined) z.lastHp = z.hp;
  if (z.hp < z.lastHp - 0.01) { z.hitsRecent = (z.hitsRecent || 0) + 1; z.noHitT = 0; } else z.noHitT = (z.noHitT || 0) + dt;
  z.hitsRecent = Math.max(0, (z.hitsRecent || 0) - dt * 3);
  if (z.noHitT > 4 && z.hp < z.maxHp * 0.9 && z.mode !== 'approach' && z.mode !== 'tear') z.hp = Math.min(z.maxHp * 0.9, z.hp + z.maxHp * 0.012 * dt);
  z.lastHp = z.hp;
  z.dodgeCool = (z.dodgeCool || 0) - dt;
  if (z.mode === 'move' && z.hitsRecent > 5 && z.dodgeCool <= 0) {
    const pl = new THREE.Vector3(head.x, 0, head.z), side = new THREE.Vector3(-(pl.z - z.pos.z), 0, pl.x - z.pos.x).normalize();
    const s1 = Math.random() < 0.5 ? 1 : -1;
    for (const sg of [s1, -s1]) {
      const to = z.pos.clone().addScaledVector(side, 1.3 * sg);
      if (clearPath(z.pos, to)) { z.mode = 'dodge'; z.t = 0; z.dodgeFrom = z.pos.clone(); z.dodgeTo = to; break; }
    }
    z.dodgeCool = Math.max(2, 3.5 - z.level * 0.15);
    z.hitsRecent = 0;
    if (z.mode === 'dodge') { SFX.whoosh(); puff(z.root.position.clone().setY(0.3), 0x777777, 0.3, 0.5, 0.2, 0.5); }
  }
  // Sicherheitsnetz: im Kampf muss der Boss im Raum sein – sonst sofort zurück hinein
  if (z.mode !== 'approach' && z.mode !== 'tear' && z.mode !== 'enter' && z.mode !== 'climb') {
    z.insideT = (z.insideT || 0) - dt;
    if (z.insideT <= 0) {
      z.insideT = 0.4;
      if (!isInside(z.pos.x, z.pos.z)) {
        const back = nearestInside(z.pos.x, z.pos.z);
        if (back) { z.pos.x = back.x; z.pos.z = back.z; z.groundY = groundAt(back.x, back.z); z.navP = null; if (z.mode === 'attack' || z.mode === 'dodge') { z.mode = 'move'; z.t = 0; } puff(z.root.position.clone().setY(1), 0x444444, 0.5, 0.8, 0.4, 0.7); }
      }
    }
  }
  // Zielpunkt folgt dem Kopf des Spielers mit Verzögerung – wer sich bewegt, weicht aus
  const track = Math.min(6.5, 3 + z.level * 0.35) * (z.rage ? 1.3 : 1); // zielt schneller nach
  z.aimPt.lerp(_aimT.set(head.x, head.y - 0.12, head.z), Math.min(1, dt * track));
  const aiming = (z.mode === 'wind' || z.mode === 'attack') && z.atk && z.atk.id === 'shoot'; // (erst nach dem Hereinsteigen)
  // Wut-Modus ab Stufe 3 bei wenig Leben
  if (!z.rage && z.hp < z.maxHp * 0.45) { // Wut-Modus schon ab Stufe 1
    z.rage = true;
    for (const m of z.mats) { m.emissive = new THREE.Color(0x550000); m.emissiveIntensity = 1; }
    SFX3D.roar(z.root.position.clone().setY(1.6));
    cb.speak('Der Boss ist wütend!');
  }
  const rage = z.rage ? 1.5 : 1;
  const G = z.gun.def;
  const dist = hyp(player.x - z.pos.x, player.z - z.pos.z);
  let pose = {};
  // ---- Auftritt: zum Fenster laufen, Bretter abreißen, hereinsteigen (noch kein Angriff) ----
  if (z.mode === 'approach' || z.mode === 'tear' || z.mode === 'enter') {
    const o = z.opening;
    const stand = o.mid.clone().addScaledVector(o.normal, -0.55).setY(0);
    const inside = o.mid.clone().addScaledVector(o.normal, 0.7).setY(0);
    if (z.mode === 'approach') {
      const d = hyp(stand.x - z.pos.x, stand.z - z.pos.z);
      const step = Math.min(d, z.speed * 1.1 * dt);
      if (d > 0.02) { z.pos.x += (stand.x - z.pos.x) / d * step; z.pos.z += (stand.z - z.pos.z) / d * step; }
      face(z, stand, dt);
      z.phase += dt * 6 * z.speed;
      pose = { walk: 1 };
      if (z.stepT === undefined || (z.stepT -= dt) <= 0) { z.stepT = 0.42; SFX3D.step(z.root.position.clone(), 1.3); }
      if (d < 0.05) { z.mode = 'tear'; z.t = 0; z.tearT = 0.6; }
    } else if (z.mode === 'tear') {
      face(z, inside, dt, 8);
      z.tearT -= dt;
      pose = { rArm: Math.max(0, Math.sin(z.t * 6)) , lean: 0.25 };
      if (z.tearT <= 0) {
        z.tearT = 0.55;
        if (!tearPlankFor(o, z.pos)) { z.mode = 'enter'; z.t = 0; z.enterFrom = z.pos.clone(); SFX3D.roar(z.root.position.clone().setY(1.6)); }
        else SFX3D.growl(z.root.position.clone().setY(1.6), 'brute');
      }
    } else { // hereinsteigen (bei Fenstern geduckt)
      const k = Math.min(1, z.t / 1.3);
      z.pos.lerpVectors(z.enterFrom, inside, k);
      face(z, inside, dt, 8);
      z.phase += dt * 5;
      pose = { walk: 0.6, crouch: o.type === 'window' ? Math.sin(k * Math.PI) * 0.6 : 0, lean: o.type === 'window' ? 0.4 * Math.sin(k * Math.PI) : 0 };
      if (k >= 1) { z.mode = 'intro'; z.t = 0; }
    }
  } else if (z.mode === 'climb') { // Hände auf die Kante, hochziehen, Bein nach, aufrichten
    z.cool -= dt; // Angriff ist danach sofort bereit
    const c = z.climb, k = Math.min(1, z.t / c.dur);
    const ez = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
    const reach = ez(k / 0.3), pull = ez((k - 0.3) / 0.5), stand = ez((k - 0.8) / 0.2);
    z.climbY = c.y0 + (c.y1 - c.y0) * pull;
    const m = ez((k - 0.45) / 0.55);
    z.pos.x = c.x0 + (c.x1 - c.x0) * m; z.pos.z = c.z0 + (c.z1 - c.z0) * m;
    pose = { armsUp: 0.75 * reach * (1 - stand), lean: (0.3 * reach + 0.5 * pull) * (1 - stand), crouch: 0.6 * pull * (1 - stand) };
    if (k >= 1) { z.groundY = c.y1; z.climb = null; z.mode = 'move'; z.t = 0; z.pathT = 0; z.navP = null; }
  } else if (z.mode === 'dodge') { // schneller Seitensprung, danach sofort Gegenangriff
    const k = Math.min(1, z.t / 0.35);
    z.pos.lerpVectors(z.dodgeFrom, z.dodgeTo, 1 - (1 - k) * (1 - k));
    z.groundY = groundAt(z.pos.x, z.pos.z);
    face(z, player, dt, 10);
    pose = { crouch: 0.45 * Math.sin(k * Math.PI), lean: -0.2 };
    if (k >= 1) { z.mode = 'move'; z.t = 0; z.cool = 0.2; }
  } else if (z.mode === 'intro') {
    const r = Math.max(0, Math.sin(Math.min(1, z.t / 1.6) * Math.PI)); // Brüllen: Arme ausbreiten, Kopf in den Nacken
    pose = { tpose: r * 0.8, armsUp: r * 0.25, headBack: r, lean: -0.15 * r };
    face(z, player, dt);
    if (z.t > 1.8) { z.mode = 'move'; z.t = 0; }
  } else if (z.mode === 'move') {
    // Abstand halten (2–3 m), dabei seitlich ausweichen
    let far = G.near ? 2.6 : 4.2, close = G.near ? 1.5 : 2.6;
    // Spieler steht erhöht (Bett/Tisch)? Dann kommt er immer wieder ran und klettert hoch (7 von 12 Sekunden)
    if (groundAt(head.x, head.z) - (z.groundY || 0) > 0.2) { z.upT = (z.upT || 0) + dt; if (z.upT % 12 < 7) { far = 0.9; close = 0.5; } } else z.upT = 0;
    // freie Sicht zum Spieler? sonst wie die Skelette dem berechneten Weg folgen (um Ecken, durch Türen)
    z.losT = (z.losT || 0) - dt;
    if (z.losT <= 0) {
      z.losT = 0.2;
      z.los = clearPath(z.pos, player); // freier Laufweg (für Nahkampf und direktes Hinlaufen)
      // freie Schusslinie (Brust → Kopf): auch wenn du auf Bett/Tisch stehst oder ein Möbel dazwischen niedrig ist
      const chest = new THREE.Vector3(z.pos.x, (z.groundY || 0) + 1.35 * z.scale, z.pos.z);
      z.canShoot = freeDist(chest, head) >= chest.distanceTo(head) - 0.35;
    }
    let want;
    if (!z.los) {
      z.pathT = (z.pathT || 0) - dt;
      if (!z.navP || !z.navP.length || z.pathT <= 0) { z.navP = navPath(z.pos, player); z.pathT = 0.7; }
      while (z.navP.length > 1 && hyp(z.navP[0].x - z.pos.x, z.navP[0].z - z.pos.z) < 0.25) z.navP.shift();
      want = z.navP[0] || player;
      // feststecken → neu planen und kurz zur Seite
      z.stuckT = (z.stuckT || 0) + dt;
      if (z.stuckT > 0.8) { if (hyp(z.pos.x - (z.sx ?? 1e9), z.pos.z - (z.sz ?? 1e9)) < 0.1) z.pathT = 0; z.stuckT = 0; z.sx = z.pos.x; z.sz = z.pos.z; }
    } else if ((z.groundY || 0) > 0.2 && dist < close) want = z.pos.clone(); // oben auf Bett/Tisch: nicht rückwärts herunterfallen, sondern bleiben und kämpfen
    else want = dist > far ? player.clone() : dist < close ? z.pos.clone().add(flat(z.pos).sub(player).normalize()) : z.pos.clone().add(new THREE.Vector3(-(player.z - z.pos.z), 0, player.x - z.pos.x).normalize().multiplyScalar(Math.sin(z.t * 0.7) > 0 ? 1 : -1));
    moveBoss(z, want, z.speed * rage * (z.los ? 1 : 1.25), dt);
    face(z, z.los ? player : want, dt);
    z.phase += dt * 6 * z.speed * rage;
    pose = { walk: 1 };
    z.cool -= dt * rage;
    if (z.stepT === undefined || (z.stepT -= dt) <= 0) { z.stepT = 0.42 / rage; SFX3D.step(z.root.position.clone(), 1.3); }
    if (z.cool <= 0 && !z.los && !z.canShoot) z.cool = 0.3; // weder Weg noch Schusslinie frei: erst hinlaufen
    if (z.cool <= 0) {
      z.atk = pickAttack(z, dist);
      // ohne freien Laufweg (aber mit Schusslinie): nur Fernangriffe
      if (!z.los && z.atk.id !== 'shoot' && z.atk.id !== 'grenade') z.atk = ATTACKS[0];
      z.last = z.atk.id;
      z.mode = 'wind'; z.t = 0; z.attackHit = false;
      if (z.atk.id === 'shoot' && z.guns.length > 1) { // Waffe wechseln
        z.gun.w.root.visible = false;
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
    if (a.id === 'charge') pose = { lean: 0.6 * k, crouch: 0.35 * k, armsBack: k }; // wie ein Sprinter vor dem Start
    else if (a.id === 'stomp') pose = { armsUp: k, crouch: 0.25 * k, headBack: 0.5 * k }; // holt aus
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
      if (a.id === 'shoot') { z.shotsLeft = Math.round(G.shots * 1.4) + (z.rage ? Math.ceil(G.shots * 0.4) : 0); z.shotT = 0; z.burstN = 0; }
      if (a.id === 'grenade') { const n = z.level >= 8 ? 2 : 1; for (let i = 0; i < n; i++) throwGrenade(z, player); }
      if (a.id === 'blink') {
        // hinter den Spieler (Richtung, in die er gerade nicht schaut, ist ungefähr „hinter“ vom Boss aus gesehen)
        const dir = flat(player).sub(flat(z.pos)).normalize();
        const tgt = player.clone().addScaledVector(dir, 1.3);
        // nur auf freie Stellen im Raum (Weg vom Spieler dorthin darf keine Wand kreuzen)
        if (clearPath(player, tgt)) z.pos.copy(tgt); else { const side = new THREE.Vector3(-dir.z, 0, dir.x); const t2 = player.clone().addScaledVector(side, 1.3), t3 = player.clone().addScaledVector(side, -1.3); if (clearPath(player, t2)) z.pos.copy(t2); else if (clearPath(player, t3)) z.pos.copy(t3); }
        z.groundY = groundAt(z.pos.x, z.pos.z);
        z.root.position.set(z.pos.x, z.groundY, z.pos.z);
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
      pose = { walk: 1.4, lean: 0.6, armsBack: 0.6 };
      if (!z.attackHit && hyp(player.x - z.pos.x, player.z - z.pos.z) < 0.75) { z.attackHit = true; hitPlayer(z, 18 + z.level * 4); }
      if (blocked || z.t > 1.3) { z.mode = 'recover'; z.t = 0; if (blocked) { SFX3D.bang(z.root.position.clone().setY(1)); burst(z.root.position.clone().setY(1.2), 0x888888, 12); } }
    } else if (a.id === 'stomp') {
      pose = { armsUp: Math.max(0, 1 - z.t * 4), crouch: Math.max(0, 0.5 - z.t * 1.2), hop: z.t < 0.12 ? Math.sin(z.t / 0.12 * Math.PI) * 0.4 : 0 }; // Sprung + Aufprall
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
    pose = { lean: -0.1, crouch: 0.1, headBack: 0.2 }; // durchatmen
    if (z.t > (z.rage ? 0.35 : 0.9)) { z.mode = 'move'; z.t = 0; z.cool = Math.max(0.8, 2.4 - z.level * 0.22) * (0.7 + Math.random() * 0.5); if (Math.random() < (z.rage ? 0.6 : 0.3)) z.cool = 0.15; /* Kombo: gleich nochmal */ }
  }
  z.root.position.x = z.pos.x;
  z.root.position.z = z.pos.z;
  // Höhe: beim Klettern laut Animation, sonst auf Boden/Tisch (herunter: kurzer Fall)
  if (z.mode === 'climb') z.root.position.y = z.climbY;
  else if (z.mode !== 'approach' && z.mode !== 'tear' && z.mode !== 'enter') {
    const gy = z.groundY || 0;
    z.root.position.y = z.root.position.y > gy ? Math.max(gy, z.root.position.y - dt * 3.5) : gy;
  }
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
