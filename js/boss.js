// Boss-Runde (jede 5. Welle): ein einzelner, menschlicher Boss (eigenes 3D-Modell) mit wechselnden Angriffen.
// Stufe 1: Sturmangriff + Stampfer · Stufe 2: + Bretter werfen · Stufe 3: + Teleport · Stufe 4: + Wirbelwind
// Ab Stufe 5: Wut-Modus (bei wenig Leben schneller, Angriffe direkt hintereinander).
// Er wird wie ein Zombie in die Zombie-Liste eingetragen – alle Waffen, Fallen, Granaten treffen ihn ganz normal.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { zombies, walkable, registerBoss, makePlankMesh } from './zombies.js?v=32';
import { burst, shockwave, puff, floatingText } from './effects.js?v=32';
import { SFX, SFX3D } from './sfx.js?v=32';
import { makePanel } from './util.js?v=32';

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
    B, mats, mode: 'intro', t: 0, cool: 2.5, last: null, attackHit: false, rage: false
  };
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
  if (boss) for (const m of boss.mats) m.dispose();
  boss = null;
  for (const p of projectiles) scene.remove(p.obj);
  projectiles = [];
  for (const r of rings) { scene.remove(r.obj); r.obj.geometry.dispose(); r.obj.material.dispose(); }
  rings = [];
  if (bar) { scene.remove(bar.p.mesh); bar.p.mesh.material.map.dispose(); bar.p.mesh.material.dispose(); bar.p.mesh.geometry.dispose(); bar = null; }
}

// ---- Angriffe --------------------------------------------------------------------------
const ATTACKS = [
  { id: 'charge', from: 1, wind: 0.9, name: 'Sturmangriff' },
  { id: 'stomp', from: 1, wind: 0.75, name: 'Stampfer' },
  { id: 'throw', from: 2, wind: 0.6, name: 'Bretterwurf' },
  { id: 'blink', from: 3, wind: 0.55, name: 'Teleport' },
  { id: 'spin', from: 4, wind: 0.45, name: 'Wirbelwind' }
];
function pickAttack(z, dist) {
  const list = ATTACKS.filter(a => z.level >= a.from && a.id !== z.last);
  // nah dran: lieber Stampfer/Wirbelwind, weit weg: lieber Sturmangriff/Werfen/Teleport
  const w = list.map(a => (dist < 1.8 ? (a.id === 'stomp' || a.id === 'spin' ? 3 : 1) : (a.id === 'stomp' || a.id === 'spin' ? 0.6 : 2)));
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
const plankFly = [];
function throwPlank(z, head, spreadIdx, n) {
  const hand = z.B.bones.RightHand.getWorldPosition(new THREE.Vector3());
  const target = head.clone().add(new THREE.Vector3((spreadIdx - (n - 1) / 2) * 0.5, -0.1, 0));
  const T = Math.max(0.55, hand.distanceTo(target) / (7 + z.level * 0.6));
  const vel = target.clone().sub(hand).divideScalar(T);
  vel.y += 0.5 * 9.8 * T;
  const obj = makePlankMesh(0.8);
  obj.position.copy(hand);
  scene.add(obj);
  projectiles.push({ obj, vel, life: 3, spin: new THREE.Vector3(Math.random() * 8, Math.random() * 4, 4 + Math.random() * 6), dmg: 12 + z.level * 3, hit: false });
  SFX3D.swing(hand);
}
function updateProjectiles(dt, head) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.life -= dt;
    p.vel.y -= 9.8 * dt;
    p.obj.position.addScaledVector(p.vel, dt);
    p.obj.rotation.x += p.spin.x * dt; p.obj.rotation.y += p.spin.y * dt; p.obj.rotation.z += p.spin.z * dt;
    if (!p.hit && p.obj.position.distanceTo(head) < 0.38) { p.hit = true; cb.playerHit(p.dmg, boss); cb.pulse(1, 150); SFX3D.bang(p.obj.position.clone()); p.life = 0; }
    if (p.obj.position.y < 0.05 || p.life <= 0 || !walkable(p.obj.position.x, p.obj.position.z)) {
      if (!p.hit) { SFX3D.crack(p.obj.position.clone()); burst(p.obj.position.clone(), 0x8a6239, 10); }
      scene.remove(p.obj);
      projectiles.splice(i, 1);
    }
  }
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

// ---- Animationen (Knochen) ------------------------------------------------------------------
function animate(z, dt, pose) {
  const B = z.B;
  z.root.updateMatrixWorld(true);
  B.rootQInv.copy(z.root.getWorldQuaternion(_qr)).invert();
  const s = Math.sin(z.phase), c = Math.cos(z.phase);
  const walk = pose.walk || 0;
  const lean = pose.lean || 0, armsUp = pose.armsUp || 0, rArm = pose.rArm || 0, tpose = pose.tpose || 0, crouch = pose.crouch || 0;
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
  const lArm = comb(rot(AZ, 1.2 * tpose), rot(AX, s * 0.45 * walk - armsUp * 2.6));
  const rArmQ = comb(rot(AZ, -1.2 * tpose), rot(AX, -s * 0.45 * walk - armsUp * 2.6 - rArm * 2.8));
  setBone(B, 'LeftArm', lArm);
  setBone(B, 'RightArm', rArmQ);
  setBone(B, 'LeftForeArm', rot(AX, -0.3 * walk - 0.4 * armsUp));
  setBone(B, 'RightForeArm', rot(AX, -0.3 * walk - 0.4 * armsUp - 0.6 * rArm));
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
        ctx.fillStyle = '#fff'; ctx.font = 'bold 34px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(`👑 BOSS · Stufe ${z.level}${z.rage ? ' · WUT' : ''}`, w / 2, h * 0.27);
      });
    }
  }
  // Tod: nach hinten umfallen, versinken, verschwinden
  if (z.state === 'dead') {
    z.deadT += dt;
    if (bar) bar.p.mesh.visible = false;
    z.body.rotation.x = -Math.min(1.5, z.deadT * 2.2);
    if (z.deadT > 1.6) { z.root.position.y -= dt * 0.5; if (Math.random() < dt * 10) burst(z.root.position.clone().setY(0.1), 0x2a221c, 3); }
    if (z.deadT > 4) { clearBoss(); const i = zombies.indexOf(z); if (i >= 0) zombies.splice(i, 1); }
    return;
  }
  if (z.frozenT > 0) { z.frozenT -= dt; if (z.frozenT <= 0 && z.ice) z.ice.visible = false; return; }
  // Wut-Modus ab Stufe 3 bei wenig Leben
  if (!z.rage && z.level >= 3 && z.hp < z.maxHp * 0.35) {
    z.rage = true;
    for (const m of z.mats) { m.emissive = new THREE.Color(0x550000); m.emissiveIntensity = 1; }
    SFX3D.roar(z.root.position.clone().setY(1.6));
    cb.speak('Der Boss ist wütend!');
  }
  const rage = z.rage ? 1.5 : 1;
  const dist = Math.hypot(player.x - z.pos.x, player.z - z.pos.z);
  let pose = {};
  if (z.mode === 'intro') {
    pose = { armsUp: Math.max(0, Math.sin(Math.min(1, z.t / 1.6) * Math.PI)) };
    face(z, player, dt);
    if (z.t > 1.8) { z.mode = 'move'; z.t = 0; }
  } else if (z.mode === 'move') {
    // Abstand halten (2–3 m), dabei seitlich ausweichen
    const want = dist > 3 ? player.clone() : dist < 1.6 ? z.pos.clone().add(flat(z.pos).sub(player).normalize()) : z.pos.clone().add(new THREE.Vector3(-(player.z - z.pos.z), 0, player.x - z.pos.x).normalize().multiplyScalar(Math.sin(z.t * 0.7) > 0 ? 1 : -1));
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
      if (z.atk.id === 'blink') { puff(z.root.position.clone().setY(1), 0x444444, 0.5, 0.8, 0.4, 0.8); }
      SFX3D.growl(z.root.position.clone().setY(1.6), 'brute');
    }
  } else if (z.mode === 'wind') {
    const a = z.atk, k = Math.min(1, z.t / (a.wind / rage));
    face(z, player, dt, 10);
    if (a.id === 'charge') pose = { lean: 0.6 * k, crouch: 0.35 * k };
    else if (a.id === 'stomp') pose = { armsUp: k, crouch: -0.1 * k };
    else if (a.id === 'throw') pose = { rArm: k, lean: -0.2 * k };
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
      if (a.id === 'throw') { const n = Math.min(3, 1 + Math.floor((z.level - 2) / 2) + (z.rage ? 1 : 0)); for (let i = 0; i < n; i++) throwPlank(z, head, i, n); }
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
    } else if (a.id === 'throw') {
      pose = { rArm: Math.max(-0.5, 1 - z.t * 6) };
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
  z.t += 0; // (Zeit läuft oben)
  z.root.position.x = z.pos.x;
  z.root.position.z = z.pos.z;
  z.root.rotation.y = z.yaw;
  animate(z, dt, pose);
}
