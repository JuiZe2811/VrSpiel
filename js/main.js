import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { makePanel, panelBg, roundRect, MAT } from './util.js';
import { SFX, ensureAudio } from './sfx.js';
import { WEAPON_ORDER, WEAPON_DEFS, BUILDERS, MASS, createWeapon, refillWeapon, makeMag, makeShell, makeCasing, makeCartridge, makeKnife, scopeRT, scopeCam } from './weapons.js';
import { world, addDynamic, removeDynamic, localBoxOf, stepPhysics, dynamics } from './physics.js';
import { room, addWall, addBox, makeWall, makeBox, rotateBox, removeSurface, clearRoom, setEditMode, suggestYaw, surfacesOf, importDetectedPlanes, saveRoom, loadRoom, hasSavedRoom, surfaceName } from './room.js';
import { initEffects, headRef, spawnTracer, burst, floatingText, updateEffects, addDebris, updateDebris } from './effects.js';
import { initTargets, targets, spawnTarget, updateTargets, hittableMeshes, hitTarget, clearTargets, dismissTargets, remainingRequired } from './targets.js';

// =============================================================================
// Grundgerüst
// =============================================================================
const HOLD_OFFSET = new THREE.Matrix4().makeTranslation(0, -0.045, 0.015); // Handmitte relativ zum Controller
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0); // transparent -> Passthrough sichtbar
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const desktopBackground = new THREE.Color(0x30343c);
const scopeBackground = new THREE.Color(0x2b3a31);
scene.background = desktopBackground;
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.add(room.group);
initEffects(scene);
initTargets(scene);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 200);
camera.position.set(0, 1.6, 0);
scene.add(camera);
scene.add(new THREE.HemisphereLight(0xffffff, 0x666677, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(1, 3, 2);
scene.add(sun);
const flashLight = new THREE.PointLight(0xffaa44, 0, 2.5);
scene.add(flashLight);
const desktopFloor = new THREE.GridHelper(40, 40, 0x666666, 0x444444);
scene.add(desktopFloor);

document.body.appendChild(ARButton.createButton(renderer, { optionalFeatures: ['local-floor', 'plane-detection'] }));
const statusEl = document.getElementById('status');
const crosshairEl = document.getElementById('crosshair');

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
document.addEventListener('pointerdown', ensureAudio);
document.addEventListener('keydown', ensureAudio);

const tmpM = new THREE.Matrix4(), tmpM2 = new THREE.Matrix4();
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpV3 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3();
const FWD = new THREE.Vector3(0, 0, -1), XAXIS = new THREE.Vector3(1, 0, 0), UP = new THREE.Vector3(0, 1, 0);
const raycaster = new THREE.Raycaster();
const headPos = headRef; // aktuelle Kopfposition (von effects.js mitbenutzt)
let elapsed = 0;
const getViewCamera = () => (renderer.xr.isPresenting ? renderer.xr.getCamera() : camera);
function headYaw() {
  getViewCamera().getWorldDirection(tmpV);
  return Math.atan2(-tmpV.x, -tmpV.z);
}
// Punkt vor dem Spieler (Winkel positiv = nach links)
function inFront(dist, angle, height, yaw = headYaw()) {
  const a = yaw + angle;
  return new THREE.Vector3(headPos.x - Math.sin(a) * dist, height, headPos.z - Math.cos(a) * dist);
}
// Wie weit ist es in einer Richtung bis zur nächsten echten Wand/Möbel?
function freeDistance(from, dir, max) {
  raycaster.set(from, dir.clone().normalize());
  raycaster.far = max;
  const hit = raycaster.intersectObjects(room.surfaces.map(s => s.occluder), false)[0];
  return hit ? hit.distance : max;
}

// =============================================================================
// Controller / Hände
// =============================================================================
const tipGeo = new THREE.SphereGeometry(0.008, 10, 8);
const hands = [0, 1].map(i => {
  const ray = renderer.xr.getController(i);
  scene.add(ray);
  const h = {
    i, ray, src: null, handedness: i === 0 ? 'left' : 'right', btn: {}, prev: {}, stickX: 0, stickY: 0,
    held: null, grab: null, hist: [], vel: new THREE.Vector3(), angVel: new THREE.Vector3(),
    point: new THREE.Vector3(), tip: new THREE.Vector3(), quat: new THREE.Quaternion(), uiHover: null, pull: null
  };
  ray.addEventListener('connected', (e) => { h.src = e.data; h.handedness = e.data.handedness; });
  ray.addEventListener('disconnected', () => { releaseHand(h); h.src = null; });
  const ptr = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
  ptr.visible = false;
  ray.add(ptr);
  h.pointer = ptr;
  // Markierung der Controller-Spitze (zum Antippen von Wänden/Tischen)
  const tip = new THREE.Mesh(tipGeo, new THREE.MeshBasicMaterial({ color: 0xffee00, toneMapped: false }));
  tip.visible = false;
  ray.add(tip);
  h.tipMarker = tip;
  return h;
});
const BTN = { trigger: 0, squeeze: 1, stick: 3, a: 4, b: 5 };
const handPoint = (h, out) => out.setFromMatrixPosition(tmpM.multiplyMatrices(h.ray.matrixWorld, HOLD_OFFSET));
function readInputs() {
  for (const h of hands) {
    h.prev = h.btn;
    h.btn = {};
    const gp = h.src && h.src.gamepad;
    for (const [k, idx] of Object.entries(BTN)) h.btn[k] = !!(gp && gp.buttons[idx] && gp.buttons[idx].pressed);
    h.stickX = gp && gp.axes.length > 3 ? gp.axes[2] : 0;
    h.stickY = gp && gp.axes.length > 3 ? gp.axes[3] : 0;
    handPoint(h, h.point);
    h.tip.setFromMatrixPosition(h.ray.matrixWorld);
    h.ray.getWorldQuaternion(h.quat);
    // Geschwindigkeit + Drehgeschwindigkeit (für Würfe)
    h.hist.push({ p: h.point.clone(), q: h.quat.clone(), t: elapsed });
    while (h.hist.length > 2 && elapsed - h.hist[0].t > 0.08) h.hist.shift();
    const a = h.hist[0], b = h.hist[h.hist.length - 1], dt = b.t - a.t;
    if (dt > 0.001) {
      h.vel.copy(b.p).sub(a.p).divideScalar(dt);
      const dq = b.q.clone().multiply(a.q.clone().invert());
      if (dq.w < 0) { dq.x *= -1; dq.y *= -1; dq.z *= -1; dq.w *= -1; }
      const angle = 2 * Math.acos(Math.min(1, dq.w)), s = Math.sqrt(1 - dq.w * dq.w);
      if (s > 1e-4) h.angVel.set(dq.x / s, dq.y / s, dq.z / s).multiplyScalar(angle / dt);
      else h.angVel.set(0, 0, 0);
    }
  }
}
const down = (h, k) => h.btn[k] && !h.prev[k];
const up = (h, k) => !h.btn[k] && h.prev[k];
const btnName = (h, k) => k === 'a' ? (h.handedness === 'left' ? 'X' : 'A') : (h.handedness === 'left' ? 'Y' : 'B');
function pulse(h, intensity, ms) {
  const act = h && h.src && h.src.gamepad && h.src.gamepad.hapticActuators && h.src.gamepad.hapticActuators[0];
  if (act && act.pulse) act.pulse(intensity, ms);
}
const heldWeapon = (h) => (h && h.held && h.held.type === 'weapon' ? h.held.w : null);
const otherHand = (h) => hands[1 - h.i];
const isFree = (h) => !h.held && !h.grab && !h.pull;

// =============================================================================
// Waffen: genau ein Exemplar pro Waffe, liegen mit Physik im Raum
// =============================================================================
const arsenal = WEAPON_ORDER.map(id => createWeapon(id));
for (const w of arsenal) scene.add(w.root);
let deskW = null; // am PC gehaltene Waffe
const mode = (w) => w.def.modes[w.modeIdx];

function makeLoose(w, vel, angVel) {
  if (w.phys) return;
  if (w.root.parent !== scene) { w.root.updateMatrixWorld(true); w.root.matrixWorld.decompose(w.root.position, w.root.quaternion, tmpS); scene.add(w.root); }
  w.body.position.set(0, 0, 0);
  w.body.rotation.set(0, 0, 0);
  w.phys = addDynamic(w.root, w.localBox, MASS[w.id], {
    vel, angVel,
    onLost: () => placeOnBench([w]),
    onImpact: (v) => SFX.thud(Math.min(0.6, v * 0.12))
  });
}
function takeWeapon(w, h) {
  // aus einer anderen Hand lösen
  for (const o of hands) {
    if (heldWeapon(o) === w) o.held = null;
    if (o.grab && o.grab.w === w && o !== h) o.grab = null;
  }
  if (deskW === w) deskW = null;
  if (w.phys) { removeDynamic(w.phys); w.phys = null; }
  if (w.root.parent !== scene) scene.add(w.root);
  w.holder = h.i;
  w.twoHanding = false;
  h.held = { type: 'weapon', w };
  setBeltWeapon(w.id);
  SFX.grab();
  pulse(h, 0.5, 40);
  boardDirty = true;
}
function dropWeapon(h, throwIt = true) {
  const w = heldWeapon(h);
  if (!w) return;
  const o = otherHand(h);
  if (o.grab && o.grab.w === w) releaseGrab(o);
  h.held = null;
  w.holder = -1;
  w.twoHanding = false;
  w.handTravel = false;
  w.parts.flash.visible = false;
  makeLoose(w, throwIt ? h.vel.clone().multiplyScalar(1.2) : new THREE.Vector3(), throwIt ? h.angVel.clone() : new THREE.Vector3());
  SFX.grab();
}
function releaseGrab(h) {
  const g = h.grab;
  if (!g) return;
  if (g.back) actionForward(g.w); // Federkraft schiebt nach vorne
  h.grab = null;
}

// ---- Waffenbank: hier liegen die Waffen bereit ---------------------------------
let bench = null;
// Waffentisch: vom Spieler platziert (gespeichert) oder automatisch neben dem Spieler
function setupBench() {
  const existing = room.surfaces.find(x => x.type === 'bench');
  if (existing) { bench = existing; return; }
  const yaw = headYaw();
  const eye = headPos.clone().setY(0.85);
  let angle = -0.6; // freie Richtung suchen (vorne rechts bevorzugt)
  for (const a of [-0.6, 0.6, -1.3, 1.3, 0]) {
    const dir = new THREE.Vector3(-Math.sin(yaw + a), 0, -Math.cos(yaw + a));
    if (freeDistance(eye, dir, 1.6) >= 1.5) { angle = a; break; }
  }
  placeBench(inFront(0.95, angle, 0, yaw), yaw + angle);
}
function placeBench(c, by) {
  for (const old of room.surfaces.filter(x => x.type === 'bench')) removeSurface(old);
  const X = new THREE.Vector3(Math.cos(by), 0, -Math.sin(by)), Z = new THREE.Vector3(Math.sin(by), 0, Math.cos(by));
  const p1 = c.clone().addScaledVector(X, -0.7).addScaledVector(Z, -0.47), p2 = c.clone().addScaledVector(X, 0.7).addScaledVector(Z, 0.47);
  bench = addBox('bench', p1.setY(0.8), p2.setY(0.8), by);
}
function placeOnBench(list) {
  if (!bench || !room.surfaces.includes(bench)) setupBench();
  // Reihen-Richtung S soll zum Spieler zeigen
  const L = bench.X.clone(), S = bench.Z.clone();
  if (S.dot(headPos.clone().sub(bench.center)) < 0) { S.negate(); L.negate(); } // Mündung entlang L, Reihen entlang S (S zeigt zum Spieler)
  const yawW = Math.atan2(-L.x, -L.z);
  const order = WEAPON_ORDER;
  let across = 0.38;
  for (const id of order) {
    const w = arsenal.find(a => a.id === id);
    const width = w.localBox.max.y - w.localBox.min.y;
    const rowCenter = across - width / 2;
    across -= width + 0.035;
    if (!list.includes(w) || w.holder >= 0 || w === deskW) continue;
    if (w.phys) { removeDynamic(w.phys); w.phys = null; }
    if (w.root.parent !== scene) scene.add(w.root);
    w.root.quaternion.setFromEuler(new THREE.Euler(0, yawW, Math.PI / 2, 'YXZ'));
    w.root.position.copy(bench.center);
    w.root.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(w.root);
    const c = bb.getCenter(new THREE.Vector3());
    const target = bench.center.clone().addScaledVector(S, rowCenter);
    w.root.position.x += target.x - c.x;
    w.root.position.z += target.z - c.z;
    w.root.position.y += bench.height + 0.004 - bb.min.y;
    makeLoose(w);
  }
}
function resetWeapons() {
  for (const w of arsenal) if (w.holder < 0 && w !== deskW) refillWeapon(w);
  placeOnBench(arsenal);
}

// ---- Waffen-Mechanik -------------------------------------------------------------
function ejectObject(w, obj, speed = 1.6) {
  w.sockets.eject.getWorldPosition(tmpV);
  w.root.getWorldQuaternion(tmpQ);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(tmpQ);
  const upv = new THREE.Vector3(0, 1, 0).applyQuaternion(tmpQ);
  obj.position.copy(tmpV);
  obj.quaternion.copy(tmpQ);
  addDebris(obj, right.multiplyScalar(speed * THREE.MathUtils.randFloat(0.8, 1.2)).addScaledVector(upv, speed * 0.7), 3);
}
function ejectChamber(w) {
  if (w.chamber === 'empty') return;
  const spent = w.chamber === 'spent';
  const obj = w.def.feed === 'tube' ? makeShell(spent) : spent ? makeCasing(w.id === 'sniper') : makeCartridge(w.id === 'sniper');
  ejectObject(w, obj, w.def.autoCycle ? 1.8 : 1.1);
  w.chamber = 'empty';
}
function feed(w) {
  if (w.def.feed === 'mag' && w.magInserted && w.magRounds > 0) { w.magRounds--; w.chamber = 'live'; return true; }
  if (w.def.feed === 'tube' && w.tube > 0) { w.tube--; w.chamber = 'live'; return true; }
  return false;
}
function actionBack(w) { ejectChamber(w); w.actionOpen = true; SFX.rackBack(); boardDirty = true; }
function actionForward(w) {
  const fed = feed(w);
  w.actionOpen = !fed && w.def.holdOpen && w.magInserted && w.magRounds === 0; // Verschlussfang
  SFX.rackFwd();
  boardDirty = true;
}
// Lose Magazine: Physik-Körper, die man wieder aufheben kann (mit Restpatronen)
const looseMags = [];
function dropMagObject(obj, weaponId, rounds, vel) {
  obj.userData.mag = { weaponId, rounds };
  scene.add(obj);
  const entry = addDynamic(obj, localBoxOf(obj), 0.35, { vel, angVel: new THREE.Vector3().randomDirection().multiplyScalar(2), onLost: (e) => removeLooseMag(e.obj), onImpact: (v) => SFX.click(900, Math.min(0.4, v * 0.1), 0.05) });
  obj.userData.phys = entry;
  looseMags.push(obj);
  while (looseMags.length > 12) removeLooseMag(looseMags[0]);
}
function removeLooseMag(obj) {
  removeDynamic(obj.userData.phys);
  scene.remove(obj);
  const i = looseMags.indexOf(obj);
  if (i >= 0) looseMags.splice(i, 1);
}
function ejectMag(w) {
  if (w.def.feed !== 'mag' || !w.magInserted) return;
  w.magInserted = false;
  const mag = w.parts.mag;
  mag.updateWorldMatrix(true, false);
  const drop = makeMag(w.id);
  mag.matrixWorld.decompose(drop.position, drop.quaternion, tmpS);
  w.root.getWorldQuaternion(tmpQ);
  dropMagObject(drop, w.id, w.magRounds, new THREE.Vector3(0, -1.2, 0).applyQuaternion(tmpQ));
  mag.visible = false;
  SFX.magOut();
  boardDirty = true;
}
function insertMag(w, rounds) {
  w.magInserted = true;
  w.magRounds = rounds;
  w.parts.mag.visible = true;
  SFX.magIn();
  boardDirty = true;
}
function toggleMode(w) {
  if (w.def.modes.length < 2) return false;
  w.modeIdx = (w.modeIdx + 1) % w.def.modes.length;
  SFX.selector();
  boardDirty = true;
  return true;
}

// ---- Schießen ----------------------------------------------------------------------
const wallMarks = [];
const markGeo = new THREE.CircleGeometry(0.006, 8);
const markMat = new THREE.MeshBasicMaterial({ color: 0x151515 });
function wallImpact(hit, dir) {
  // Einschussloch auf der echten Wand / dem echten Tisch
  const mark = new THREE.Mesh(markGeo, markMat);
  const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : dir.clone().negate();
  if (n.dot(dir) > 0) n.negate();
  mark.position.copy(hit.point).addScaledVector(n, 0.002);
  mark.lookAt(mark.position.clone().add(n));
  scene.add(mark);
  wallMarks.push(mark);
  if (wallMarks.length > 60) scene.remove(wallMarks.shift());
  burst(hit.point, 0x9a9183, 6);
}
function tryFire(w, desktopRay) {
  const h = w.holder >= 0 ? hands[w.holder] : null;
  if (mode(w) === 'safe' || w.actionOpen || w.chamber !== 'live') { SFX.dry(); pulse(h, 0.15, 20); return false; }
  w.chamber = 'spent';
  w.cooldown = 60 / w.def.rpm;
  w.recoil = 1;
  w.recoilSide = THREE.MathUtils.randFloatSpread(1);
  SFX.shot(w.def);
  pulse(h, 1.0, 80);
  if (w.twoHanding && h) pulse(otherHand(h), 0.6, 60);
  const origin = new THREE.Vector3(), dir = new THREE.Vector3();
  if (desktopRay) { origin.copy(desktopRay.origin); dir.copy(desktopRay.direction); }
  else {
    w.sockets.sightRear.getWorldPosition(origin);
    w.sockets.sightFront.getWorldPosition(dir).sub(origin).normalize();
  }
  let spread = w.def.spread;
  if (w.def.twoHand && !w.twoHanding && h) spread += 0.012; // einhändig unruhiger
  const muzzlePos = w.sockets.muzzle.getWorldPosition(new THREE.Vector3());
  flashLight.position.copy(muzzlePos);
  flashLight.intensity = 4;
  const occ = room.surfaces.map(s => s.occluder);
  const cands = [...hittableMeshes(), ...occ, ...(startButton.visible ? startButton.userData.hit : [])];
  const perTarget = new Map();
  let startHit = null;
  for (let p = 0; p < w.def.pellets; p++) {
    const d = dir.clone();
    if (spread > 0) d.add(new THREE.Vector3().randomDirection().multiplyScalar(spread * Math.sqrt(Math.random()))).normalize();
    raycaster.set(origin, d);
    raycaster.far = 200;
    const hit = raycaster.intersectObjects(cands, false)[0];
    if (p < 3) spawnTracer(muzzlePos, hit ? hit.point : origin.clone().addScaledVector(d, 60));
    if (!hit) continue;
    if (hit.object.userData.isStart) { startHit = hit; continue; }
    if (hit.object.userData.surface) { if (p < 4) wallImpact(hit, d); continue; }
    const t = hit.object.userData.target;
    if (!t) continue;
    const local = hit.object.worldToLocal(hit.point.clone());
    const r = Math.hypot(local.x, local.y);
    const prev = perTarget.get(t);
    if (!prev || r < prev.r) perTarget.set(t, { hit, r, dir: d });
  }
  if (w.def.autoCycle) { // Halbautomat: auswerfen und nachladen
    ejectChamber(w);
    if (!feed(w)) w.actionOpen = w.def.holdOpen;
    w.cycleAnim = 1;
  }
  if (inRound()) stats.shots++;
  boardDirty = true;
  if (startHit) { burst(startHit.point, 0x33ff77, 20); startPressed(); return true; }
  if (inRound() && perTarget.size === 0) combo = 1;
  for (const [t, x] of perTarget) handleResult(hitTarget(t, x.hit, x.dir), x.hit.point, w.def.scoreMult);
  return true;
}

// =============================================================================
// Gürtel mit Munition und Messer
// =============================================================================
const belt = new THREE.Group();
scene.add(belt);
const BELT_R = 0.17;
const beltSlots = [];
let beltWeaponId = null, beltYaw = 0;
const leather = new THREE.MeshStandardMaterial({ color: 0x4a2f1c, roughness: 0.75, side: THREE.DoubleSide });
const pouchMat = new THREE.MeshStandardMaterial({ color: 0x3c4130, roughness: 0.95 });
{
  belt.add(new THREE.Mesh(new THREE.CylinderGeometry(BELT_R, BELT_R, 0.045, 48, 1, true), leather));
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.052, 0.01), MAT.bright);
  buckle.position.set(0, 0, -BELT_R - 0.004);
  belt.add(buckle);
}
function beltMount(phi) {
  const g = new THREE.Group();
  g.position.set(Math.sin(phi) * BELT_R, 0, -Math.cos(phi) * BELT_R);
  g.rotation.y = -phi;
  belt.add(g);
  return g;
}
const knifeSlot = (() => {
  const mount = beltMount(-1.3);
  const sheath = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.14, 0.036), leather);
  sheath.position.set(0, -0.075, -0.02);
  mount.add(sheath);
  const knife = makeKnife();
  knife.rotation.x = -Math.PI / 2;
  knife.position.set(0, 0.055, -0.02);
  mount.add(knife);
  const slot = { kind: 'knife', mount, obj: knife, available: true, refill: 0, radius: 0.1 };
  beltSlots.push(slot);
  return slot;
})();
function setBeltWeapon(id) {
  if (id === beltWeaponId) return;
  beltWeaponId = id;
  for (let i = beltSlots.length - 1; i >= 0; i--) {
    if (beltSlots[i].kind === 'knife') continue;
    belt.remove(beltSlots[i].mount);
    beltSlots.splice(i, 1);
  }
  const def = WEAPON_DEFS[id];
  for (const side of [-1, 1]) {
    const mount = beltMount(side * 0.55);
    if (def.feed === 'mag') {
      const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.075, 0.042), pouchMat);
      pouch.position.set(0, -0.022, -0.024);
      mount.add(pouch);
      const mag = makeMag(id);
      mag.position.set(0, 0.035, -0.024);
      mount.add(mag);
      beltSlots.push({ kind: 'mag', mount, obj: mag, available: true, refill: 0, radius: 0.09 });
    } else {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.032, 0.008), leather);
      strip.position.set(0, 0, -0.014);
      mount.add(strip);
      for (let k = 0; k < 4; k++) {
        const sh = makeShell();
        sh.position.set(-0.036 + k * 0.024, 0.008, -0.027);
        mount.add(sh);
        beltSlots.push({ kind: 'shell', mount, obj: sh, available: true, refill: 0, radius: 0.045 });
      }
    }
  }
}
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
function updateBelt(dt) {
  getViewCamera().getWorldQuaternion(tmpQ);
  // Hüfte sitzt unter dem Hals (beim Runterschauen bleibt der Gürtel stehen)
  const neck = tmpV.set(0, -0.08, 0.1).applyQuaternion(tmpQ).add(headPos);
  belt.position.set(neck.x, neck.y - 0.5, neck.z);
  const f = tmpV2.set(0, 0, -1).applyQuaternion(tmpQ);
  if (Math.abs(f.y) < 0.85) {
    const diff = wrapAngle(Math.atan2(-f.x, -f.z) - beltYaw);
    if (Math.abs(diff) > 0.45) beltYaw += diff - Math.sign(diff) * 0.45;
    beltYaw += diff * Math.min(1, dt * 0.7);
  }
  belt.rotation.y = beltYaw;
  // Messer auf der Seite der freien Hand
  const wh = hands.find(h => heldWeapon(h));
  const phi = (wh && wh.handedness === 'left' ? 1 : -1) * 1.3;
  knifeSlot.mount.position.set(Math.sin(phi) * BELT_R, 0, -Math.cos(phi) * BELT_R);
  knifeSlot.mount.rotation.y = -phi;
  for (const s of beltSlots) {
    if (s.available) continue;
    s.refill -= dt;
    if (s.refill <= 0) { s.available = true; s.obj.visible = true; }
  }
  belt.updateMatrixWorld(true);
}
function holdItem(h, type, obj, extra = {}) {
  obj.position.set(0, 0.05, -0.03);
  obj.quaternion.setFromEuler(new THREE.Euler(-0.3, 0, 0));
  if (type === 'knife') { obj.position.set(0, -0.045, 0.015); obj.quaternion.identity(); }
  h.ray.add(obj);
  h.held = Object.assign({ type, obj }, extra);
  SFX.grab();
  pulse(h, 0.5, 40);
}
function tryBeltGrab(h) {
  let best = null, bd = Infinity;
  for (const s of beltSlots) {
    if (!s.available) continue;
    const d = s.obj.getWorldPosition(tmpV).distanceTo(h.point);
    if (d < s.radius && d < bd) { bd = d; best = s; }
  }
  if (!best) return false;
  best.available = false;
  best.obj.visible = false;
  best.refill = best.kind === 'knife' ? 2 : 1.2;
  if (best.kind === 'knife') holdItem(h, 'knife', makeKnife());
  else if (best.kind === 'mag') holdItem(h, 'mag', makeMag(beltWeaponId), { weaponId: beltWeaponId, rounds: WEAPON_DEFS[beltWeaponId].capacity });
  else holdItem(h, 'shell', makeShell());
  return true;
}

// =============================================================================
// Wurfmesser
// =============================================================================
const knives = [];
function throwKnife(h) {
  const k = h.held.obj;
  h.held = null;
  k.updateWorldMatrix(true, false);
  k.matrixWorld.decompose(k.position, k.quaternion, tmpS);
  h.ray.remove(k);
  scene.add(k);
  const v = h.vel.clone();
  if (v.length() < 1.5) {
    if (k.position.distanceTo(knifeSlot.obj.getWorldPosition(tmpV)) < 0.15) { // zurück in die Scheide
      scene.remove(k);
      knifeSlot.available = true;
      knifeSlot.obj.visible = true;
      SFX.click(900, 0.3, 0.05);
      return;
    }
    knives.push({ obj: k, vel: v, flying: true, spin: 0, spinRate: 3, life: 30 });
    return;
  }
  launchKnife(k, aimAssist(k.position, v.multiplyScalar(1.5)));
}
function launchKnife(k, vel) {
  if (inRound()) { stats.shots++; boardDirty = true; }
  knives.push({ obj: k, vel, flying: true, spin: 0, spinRate: 14, life: 30 });
  SFX.whoosh();
  while (knives.length > 10) { const old = knives.shift(); if (old.obj.parent) old.obj.parent.remove(old.obj); }
}
// Wurfhilfe: liegt ein Ziel ungefähr in Wurfrichtung, wird die Flugbahn passend berechnet
function aimAssist(pos, vel) {
  const flat = new THREE.Vector3(vel.x, 0, vel.z);
  if (flat.lengthSq() < 1e-4) return vel;
  flat.normalize();
  const cands = targets.filter(t => t.hittable).map(t => t.hitMeshes[0].getWorldPosition(new THREE.Vector3()));
  if (startButton.visible) cands.push(startButton.getWorldPosition(new THREE.Vector3()));
  let best = null, bestAng = 0.26;
  for (const c of cands) {
    const to = c.clone().sub(pos);
    const d = Math.hypot(to.x, to.z);
    if (d < 0.5 || d > 14) continue;
    const ang = flat.angleTo(new THREE.Vector3(to.x, 0, to.z).normalize());
    if (ang < bestAng) { bestAng = ang; best = c; }
  }
  if (!best) return vel;
  const to = best.clone().sub(pos);
  const d = Math.hypot(to.x, to.z), hgt = to.y, g = 9.81;
  const v = THREE.MathUtils.clamp(vel.length(), 7, 15);
  const disc = v ** 4 - g * (g * d * d + 2 * hgt * v * v);
  if (disc < 0) return vel;
  const theta = Math.atan((v * v - Math.sqrt(disc)) / (g * d));
  return new THREE.Vector3(to.x, 0, to.z).normalize().multiplyScalar(v * Math.cos(theta)).add(new THREE.Vector3(0, v * Math.sin(theta), 0));
}
function updateKnives(dt) {
  for (let i = knives.length - 1; i >= 0; i--) {
    const k = knives[i];
    k.life -= dt;
    if (k.life <= 0 || (!k.obj.parent && !k.flying)) { if (k.obj.parent) k.obj.parent.remove(k.obj); knives.splice(i, 1); continue; }
    if (!k.flying) continue;
    k.vel.y -= 9.81 * dt;
    const step = k.vel.clone().multiplyScalar(dt);
    const dir = step.clone().normalize();
    raycaster.set(k.obj.position, dir);
    raycaster.far = step.length() + 0.15;
    const cands = [...hittableMeshes(), ...room.surfaces.map(s => s.occluder), ...(startButton.visible ? startButton.userData.hit : [])];
    const hit = raycaster.intersectObjects(cands, false)[0];
    if (hit) { stickKnife(k, hit, dir); continue; }
    k.obj.position.add(step);
    k.spin += k.spinRate * dt;
    k.obj.quaternion.setFromUnitVectors(FWD, dir).multiply(tmpQ.setFromAxisAngle(XAXIS, -k.spin));
    if (k.obj.position.y < 0.012) {
      k.flying = false;
      k.obj.position.y = 0.012;
      k.obj.quaternion.setFromEuler(new THREE.Euler(0, Math.random() * 6.28, Math.PI / 2, 'YXZ'));
      SFX.click(2200, 0.3, 0.06);
    }
  }
}
function stickKnife(k, hit, dir) {
  k.flying = false;
  k.obj.quaternion.setFromUnitVectors(FWD, dir);
  k.obj.position.copy(hit.point).addScaledVector(dir, -0.14);
  SFX.thunk();
  if (hit.object.userData.surface) { scene.attach(k.obj); return; } // steckt in echter Wand / Tisch
  hit.object.attach(k.obj);
  if (hit.object.userData.isStart) { burst(hit.point, 0x33ff77, 20); startPressed(); return; }
  const t = hit.object.userData.target;
  if (t) handleResult(hitTarget(t, hit, dir), hit.point, 2, '🔪 ');
}

// =============================================================================
// Hände: greifen, loslassen, zeigen (VR)
// =============================================================================
function grabCandidates(h) {
  // Dinge in Reichweite der Hand
  const list = [];
  for (const w of arsenal) {
    if (w.holder >= 0 || w === deskW) continue;
    w.root.updateMatrixWorld(true);
    const d = new THREE.Box3().setFromObject(w.root).distanceToPoint(h.point);
    if (d < 0.06) list.push({ d, kind: 'weapon', w });
  }
  for (const m of looseMags) {
    const d = new THREE.Box3().setFromObject(m).distanceToPoint(h.point);
    if (d < 0.05) list.push({ d: d + 0.01, kind: 'mag', obj: m });
  }
  for (const k of knives) {
    if (k.flying) continue;
    const d = k.obj.getWorldPosition(tmpV).distanceTo(h.point);
    if (d < 0.09) list.push({ d: d + 0.01, kind: 'knife', k });
  }
  return list.sort((a, b) => a.d - b.d);
}
function pickCandidate(h, c) {
  if (c.kind === 'weapon') takeWeapon(c.w, h);
  else if (c.kind === 'mag') {
    const data = c.obj.userData.mag;
    removeLooseMag(c.obj);
    holdItem(h, 'mag', c.obj, { weaponId: data.weaponId, rounds: data.rounds });
  } else if (c.kind === 'knife') {
    knives.splice(knives.indexOf(c.k), 1);
    if (c.k.obj.parent) c.k.obj.parent.remove(c.k.obj);
    holdItem(h, 'knife', c.k.obj);
  }
}
// zweite Hand an der Waffe der anderen Hand: Spannhebel, Vorderschaft oder Übergabe
function tryWeaponGrab(h) {
  const w = heldWeapon(otherHand(h));
  if (!w) return false;
  const p = h.point;
  const opts = [];
  if (w.def.action !== 'pump') opts.push({ type: 'charger', d: p.distanceTo(w.sockets.chargerGrab.getWorldPosition(tmpV)) / 0.07 });
  if (w.sockets.foregrip) opts.push({ type: 'fore', d: p.distanceTo(w.sockets.foregrip.getWorldPosition(tmpV)) / 0.13 });
  opts.push({ type: 'swap', d: p.distanceTo(w.root.getWorldPosition(tmpV)) / 0.06 });
  opts.sort((a, b) => a.d - b.d);
  if (opts[0].d > 1) return false;
  if (opts[0].type === 'swap') { takeWeapon(w, h); return true; }
  h.grab = { type: opts[0].type, w, startZ: w.root.worldToLocal(p.clone()).z, back: false };
  SFX.grab();
  pulse(h, 0.4, 30);
  return true;
}
function releaseHand(h) {
  if (h.grab) releaseGrab(h);
  h.pull = null;
  const held = h.held;
  if (!held) return;
  if (held.type === 'weapon') { dropWeapon(h); return; }
  if (held.type === 'knife') { throwKnife(h); return; }
  const obj = held.obj;
  obj.updateWorldMatrix(true, false);
  obj.matrixWorld.decompose(obj.position, obj.quaternion, tmpS);
  h.ray.remove(obj);
  h.held = null;
  if (held.type === 'mag') dropMagObject(obj, held.weaponId, held.rounds, h.vel.clone());
  else addDebris(obj, h.vel.clone(), 4);
}

// Zeigestrahl: UI-Knöpfe und entfernte Gegenstände (Heranziehen mit Griff-Taste)
function pointerTarget(h) {
  h.ray.getWorldPosition(tmpV);
  raycaster.set(tmpV, tmpV3.set(0, 0, -1).applyQuaternion(h.quat));
  raycaster.far = 6;
  let best = null;
  const panelsHit = raycaster.intersectObjects(uiPanels.filter(p => p.mesh.visible).map(p => p.mesh), false)[0];
  if (panelsHit) best = { kind: 'ui', dist: panelsHit.distance, panel: panelsHit.object.userData.ui, uv: panelsHit.uv };
  const objs = [];
  for (const w of arsenal) if (w.holder < 0 && w !== deskW) objs.push({ o: w.root, kind: 'weapon', w });
  for (const m of looseMags) objs.push({ o: m, kind: 'mag', obj: m });
  for (const k of knives) if (!k.flying) objs.push({ o: k.obj, kind: 'knife', k });
  for (const c of objs) {
    const box = new THREE.Box3().setFromObject(c.o).expandByScalar(0.03);
    const p = raycaster.ray.intersectBox(box, tmpV2);
    if (p) { const d = p.distanceTo(tmpV); if (d < 4 && (!best || d < best.dist)) best = { ...c, dist: d }; }
  }
  return best;
}

function updateHandsXR(dt) {
  for (const h of hands) {
    if (!h.src) { h.pointer.visible = false; continue; }
    h.tipMarker.visible = state === 'setup' && setup.tool === 'floor';
    const free = isFree(h);
    // Zeigestrahl (im Einrichtungsmodus als Laser bis zum Boden)
    let pt = null;
    if (free && !(setup.drag && setup.drag.src === h)) pt = pointerTarget(h);
    let len = pt ? pt.dist : 2;
    let showPtr = free && (pt || state !== 'playing');
    if (state === 'setup' && free && !pt && setup.tool && setup.tool !== 'floor') {
      const fh = floorHit(rayOf(h));
      len = fh ? fh.distanceTo(h.tip) : 4;
    }
    h.pointer.visible = !!showPtr;
    h.pointer.scale.z = len;
    const hover = pt && pt.kind === 'ui' ? pt.panel.buttonAt(pt.uv) : null;
    if (h.uiHover !== hover) { if (h.uiHover) h.uiHover.panel.setHover(null); h.uiHover = hover; if (hover) { hover.panel.setHover(hover); pulse(h, 0.1, 10); } }

    // Griff-Taste: greifen
    if (down(h, 'squeeze') && free) {
      if (tryWeaponGrab(h)) { /* zweite Hand an der Waffe */ }
      else if (tryBeltGrab(h)) { /* vom Gürtel */ }
      else {
        const c = grabCandidates(h)[0];
        if (c) pickCandidate(h, c);
        else if (pt && pt.kind !== 'ui') h.pull = pt; // aus der Ferne heranziehen
      }
    }
    if (h.pull) {
      const o = h.pull.kind === 'weapon' ? h.pull.w.root : h.pull.kind === 'mag' ? h.pull.obj : h.pull.k.obj;
      const ph = h.pull.kind === 'weapon' ? h.pull.w.phys : h.pull.kind === 'mag' ? h.pull.obj.userData.phys : null;
      if (ph) { ph.body.wakeUp(); ph.body.velocity.set(0, 0, 0); ph.body.position.x += (h.point.x - o.position.x) * Math.min(1, dt * 10); ph.body.position.y += (h.point.y - o.position.y) * Math.min(1, dt * 10); ph.body.position.z += (h.point.z - o.position.z) * Math.min(1, dt * 10); }
      else o.position.lerp(h.point, Math.min(1, dt * 10));
      if (o.position.distanceTo(h.point) < 0.2) { const c = h.pull; h.pull = null; pickCandidate(h, c); }
    }
    if (up(h, 'squeeze')) releaseHand(h);

    // Abzug: UI klicken bzw. Raum-Werkzeug
    if (free && down(h, 'trigger')) {
      if (hover) { hover.onClick(); SFX.ui(); pulse(h, 0.3, 20); }
      else if (state === 'setup') setupTriggerDown(h);
    }
    if (setup.drag && setup.drag.src === h && !h.btn.trigger) setupTriggerUp();

    // Waffe in dieser Hand
    const w = heldWeapon(h);
    if (w) updateHeldWeapon(w, h, dt);
  }
}

function updateHeldWeapon(w, main, dt) {
  const off = otherHand(main);
  const offGrab = off.grab && off.grab.w === w ? off.grab : null;
  w.twoHanding = !!(offGrab && offGrab.type === 'fore');
  // Pose
  tmpM.multiplyMatrices(main.ray.matrixWorld, HOLD_OFFSET);
  tmpM.decompose(w.root.position, w.root.quaternion, tmpS);
  if (w.twoHanding) {
    const upv = new THREE.Vector3(0, 1, 0).applyQuaternion(w.root.quaternion);
    tmpM2.lookAt(w.root.position, off.point, upv);
    w.root.quaternion.setFromRotationMatrix(tmpM2).multiply(w.foreQ);
  }
  w.root.updateMatrixWorld(true);
  // Verschluss / Schlitten / Pumpe mit der zweiten Hand
  if (offGrab && (offGrab.type === 'charger' || (offGrab.type === 'fore' && w.def.action === 'pump'))) {
    const local = w.root.worldToLocal(off.point.clone());
    w.travel = THREE.MathUtils.clamp(local.z - offGrab.startZ, 0, w.def.travel);
    if (!offGrab.back && w.travel > w.def.travel * 0.85) { offGrab.back = true; actionBack(w); pulse(off, 0.5, 40); }
    if (offGrab.back && w.travel < w.def.travel * 0.15) { offGrab.back = false; actionForward(w); pulse(off, 0.6, 40); }
    w.handTravel = true;
  } else w.handTravel = false;
  // Magazin / Patrone einführen
  const item = off.held;
  if (item && (item.type === 'mag' || item.type === 'shell')) {
    const itemPos = item.obj.getWorldPosition(new THREE.Vector3());
    if (item.type === 'mag' && item.weaponId === w.id && !w.magInserted && itemPos.distanceTo(w.sockets.magwell.getWorldPosition(tmpV)) < 0.07) {
      off.ray.remove(item.obj);
      off.held = null;
      insertMag(w, item.rounds);
      pulse(off, 0.8, 50); pulse(main, 0.5, 40);
    } else if (item.type === 'shell' && w.def.feed === 'tube' && w.tube < w.def.capacity && itemPos.distanceTo(w.sockets.loadPort.getWorldPosition(tmpV)) < 0.08) {
      off.ray.remove(item.obj);
      off.held = null;
      w.tube++;
      SFX.shellIn();
      pulse(off, 0.5, 30);
      boardDirty = true;
    }
  }
  // Tasten
  if (down(main, 'a')) ejectMag(w);
  if (down(main, 'b')) { if (!toggleMode(w) && w.actionOpen) actionForward(w); pulse(main, 0.2, 20); }
  if (w.def.sight === 'scope' && Math.abs(main.stickY) > 0.3) w.zoom = THREE.MathUtils.clamp(w.zoom - main.stickY * dt * 8, 4, 12);
  // Abzug
  if (down(main, 'trigger')) { if (w.cooldown <= 0) tryFire(w); }
  else if (main.btn.trigger && mode(w) === 'auto' && w.cooldown <= 0 && w.chamber === 'live') tryFire(w);
}

function updateWeaponVisuals(w, dt) {
  w.cooldown -= dt;
  w.recoil = Math.max(0, w.recoil - dt * (w.def.autoCycle ? 9 : 5));
  const k = w.recoil * w.recoil;
  w.body.position.z = k * w.def.recoil.back;
  w.body.rotation.x = k * w.def.recoil.rise;
  w.body.rotation.y = k * w.def.recoil.jitter * w.recoilSide;
  w.parts.flash.visible = w.recoil > 0.7;
  w.parts.flash.rotation.z = Math.random() * Math.PI;
  w.parts.flash.scale.setScalar(w.def.pellets > 1 ? 1.6 : w.id === 'sniper' ? 1.4 : 1);
  w.cycleAnim = Math.max(0, w.cycleAnim - dt * 14);
  let travel;
  if (w.handTravel) travel = w.travel;
  else if (w.cycleAnim > 0) travel = Math.sin((1 - w.cycleAnim) * Math.PI) * w.def.travel;
  else travel = w.actionOpen ? w.def.travel * (w.def.holdOpen ? 0.8 : 1) : 0;
  w.parts.charger.position.z = travel;
  if (w.parts.selector) w.parts.selector.rotation.x = [-0.9, 0, 0.9][w.modeIdx];
}

// =============================================================================
// Bedienfelder mit Knöpfen (Zeigen + Abzug, am PC: Klick)
// =============================================================================
const uiPanels = [];
class UIPanel {
  constructor(w, h, ppm = 700) {
    this.p = makePanel(w, h, ppm);
    this.mesh = this.p.mesh;
    this.mesh.userData.ui = this;
    this.mesh.renderOrder = 5;
    this.buttons = [];
    this.hover = null;
    this.border = '#ffcc33';
    this.anchor = new THREE.Vector3();
    scene.add(this.mesh);
    uiPanels.push(this);
  }
  set(drawFn, buttons = []) {
    this.drawFn = drawFn;
    this.buttons = buttons.map(b => ({ ...b, panel: this }));
    this.hover = null;
    this.redraw();
  }
  setHover(b) { if (this.hover !== b) { this.hover = b; this.redraw(); } }
  buttonAt(uv) {
    if (!uv) return null;
    const x = uv.x * this.p.canvas.width, y = (1 - uv.y) * this.p.canvas.height;
    return this.buttons.find(b => !b.disabled && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) || null;
  }
  redraw() {
    this.p.draw((ctx, w, h) => {
      panelBg(ctx, w, h, 30, this.border);
      if (this.drawFn) this.drawFn(ctx, w, h);
      for (const b of this.buttons) {
        const hov = this.hover && this.hover.id === b.id;
        roundRect(ctx, b.x, b.y, b.w, b.h, 16);
        ctx.fillStyle = b.disabled ? 'rgba(60,64,72,0.6)' : b.active ? '#2f8a50' : hov ? '#56657d' : '#2c3444';
        ctx.fill();
        ctx.lineWidth = hov ? 5 : 2;
        ctx.strokeStyle = b.active ? '#7dffa8' : hov ? '#ffffff' : '#8796ad';
        ctx.stroke();
        ctx.fillStyle = b.disabled ? '#8a8f99' : '#fff';
        ctx.font = `bold ${b.font || 32}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 2);
      }
    });
  }
  place(dist, angle, dy) {
    this.mesh.position.copy(inFront(dist, angle, headPos.y + dy));
    this.mesh.lookAt(headPos);
    this.anchor.copy(headPos);
  }
  get visible() { return this.mesh.visible; }
  set visible(v) { this.mesh.visible = v; }
}
function text(ctx, str, x, y, size, color = '#fff', align = 'center', bold = false) {
  ctx.font = `${bold ? 'bold ' : ''}${size}px system-ui, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(str, x, y);
}
// Knöpfe in einer Reihe verteilen
function row(y, h, labels, W, pad = 30, gap = 18) {
  const bw = (W - pad * 2 - gap * (labels.length - 1)) / labels.length;
  return labels.map((b, i) => ({ ...b, x: pad + i * (bw + gap), y, w: bw, h }));
}

const setupPanel = new UIPanel(1.0, 0.72, 760);
setupPanel.border = '#3a8bff';
const menuPanel = new UIPanel(1.1, 0.74, 720);
const board = new UIPanel(1.2, 0.5, 640);
setupPanel.visible = menuPanel.visible = board.visible = false;

// START-Scheibe zum Anschießen
const startButton = new THREE.Group();
{
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 40),
    new THREE.MeshStandardMaterial({ color: 0x1fae52, emissive: 0x0a3a1a, roughness: 0.5 }));
  plate.rotation.x = Math.PI / 2;
  startButton.add(plate);
  const label = makePanel(0.3, 0.12, 800);
  label.draw((ctx, w, h) => text(ctx, 'START', w / 2, h / 2 + 4, 80, '#fff', 'center', true));
  label.mesh.position.z = 0.022;
  startButton.add(label.mesh);
  plate.userData.isStart = true;
  label.mesh.userData.isStart = true;
  startButton.userData.hit = [plate, label.mesh];
}
startButton.visible = false;
scene.add(startButton);

// =============================================================================
// Raum einrichten – alles per Laser (wie die Begrenzung der Quest):
// Wände und Möbel auf dem Boden aufziehen, Waffentisch platzieren, Bodenhöhe einstellen
// =============================================================================
const setup = { tool: null, drag: null, pending: null, last: null, msg: '', rotT: 0, planeSupport: false, importReq: false, autoImport: 0, refT: 0 };
const previewMat = new THREE.MeshBasicMaterial({ color: 0xffee00, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
const previewWall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), previewMat);
const previewBox = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), previewMat);
const previewLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]), new THREE.LineBasicMaterial({ color: 0xffee00 }));
previewWall.visible = previewBox.visible = previewLine.visible = false;
scene.add(previewWall, previewBox, previewLine);
// Laserpunkt auf dem Boden (pro Hand + Maus)
const markerGeo = new THREE.RingGeometry(0.035, 0.05, 32).rotateX(-Math.PI / 2);
const makeMarker = () => { const m = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: 0xffee00, toneMapped: false, depthTest: false, transparent: true })); m.renderOrder = 30; m.visible = false; scene.add(m); return m; };
for (const h of hands) h.floorMarker = makeMarker();
const mouseMarker = makeMarker();
// Gitter zum Einstellen der Bodenhöhe
const floorGrid = new THREE.GridHelper(4, 16, 0x00ffcc, 0x00ffcc);
floorGrid.material.transparent = true;
floorGrid.material.opacity = 0.7;
floorGrid.visible = false;
scene.add(floorGrid);

// Bodenhöhe: verschiebt das Koordinatensystem der VR-Sitzung, bis y = 0 auf dem echten Boden liegt
const FLOOR_KEY = 'vrspiel-boden';
let floorOffset = (() => { try { return parseFloat(localStorage.getItem(FLOOR_KEY) || '0') || 0; } catch { return 0; } })();
let baseRefSpace = null;
function applyFloorOffset() {
  if (!baseRefSpace || typeof XRRigidTransform === 'undefined') return;
  renderer.xr.setReferenceSpace(baseRefSpace.getOffsetReferenceSpace(new XRRigidTransform({ x: 0, y: floorOffset, z: 0 })));
  try { localStorage.setItem(FLOOR_KEY, String(floorOffset)); } catch { /* ignorieren */ }
}

const TOOL_HELP = {
  wall: ['WAND: Laser auf den Boden an einer Ecke der Wand richten,', 'Abzug halten, an der Wand entlang zur anderen Ecke fahren, loslassen.'],
  table: ['TISCH: Grundfläche mit dem Laser auf dem Boden aufziehen (Ecke zu Ecke),', 'dann mit dem Laser auf die Tischkante zeigen = Höhe, Abzug = fertig.'],
  chair: ['STUHL: Grundfläche mit dem Laser auf dem Boden aufziehen,', 'dann auf die Sitzfläche zeigen = Höhe, Abzug = fertig.'],
  bench: ['WAFFENTISCH: Mit dem Laser auf den Boden zeigen und Abzug drücken', '(ziehen = Ausrichtung). Hier liegen die Waffen zu Beginn jeder Runde.'],
  floor: ['BODENHÖHE: Controller auf den Boden legen und Abzug drücken, dann mit', 'Stick ▲▼ fein einstellen, bis das Gitter genau auf dem echten Boden liegt.']
};
function refreshSetupPanel() {
  const count = (t) => surfacesOf(t).length;
  const pend = setup.pending;
  setupPanel.set((ctx, w) => {
    text(ctx, '🧱 Spielbereich einrichten', w / 2, 44, 42, '#fff', 'center', true);
    const help = pend ? ['Mit dem Laser auf die Oberkante zeigen = Höhe (' + pend.height.toFixed(2) + ' m),', 'Abzug = übernehmen · Stick ◀ ▶ = drehen · B/Y = abbrechen']
      : setup.tool ? TOOL_HELP[setup.tool] : ['Wähle unten ein Werkzeug. Die Zielscheiben erscheinen dann an', 'deinen Wänden, auf Tischen und Stühlen. Tipp: zuerst die Bodenhöhe prüfen.'];
    text(ctx, help[0], w / 2, 94, 21, '#cfd8e3');
    text(ctx, help[1], w / 2, 124, 21, '#cfd8e3');
    text(ctx, `Wände: ${count('wall')} · Tische: ${count('table')} · Stühle: ${count('chair')} · Waffentisch: ${count('bench') ? '✔' : '–'} · Boden: ${floorOffset >= 0 ? '+' : ''}${(floorOffset * 100).toFixed(1)} cm`, w / 2, 166, 21, '#9ad', 'center', true);
    if (setup.msg) text(ctx, setup.msg, w / 2, 200, 24, '#ffcc33', 'center', true);
  }, [
    ...row(224, 66, [
      { id: 'wall', label: '🧱 Wand', active: setup.tool === 'wall', onClick: () => setTool('wall') },
      { id: 'table', label: '🪑 Tisch', active: setup.tool === 'table', onClick: () => setTool('table') },
      { id: 'chair', label: '💺 Stuhl', active: setup.tool === 'chair', onClick: () => setTool('chair') }
    ], 760),
    ...row(302, 66, [
      { id: 'bench', label: '🔫 Waffentisch', font: 28, active: setup.tool === 'bench', onClick: () => setTool('bench') },
      { id: 'floor', label: '📏 Bodenhöhe', font: 28, active: setup.tool === 'floor', onClick: () => setTool('floor') },
      { id: 'quest', label: '📡 Quest-Raum', font: 28, disabled: !setup.planeSupport, onClick: () => { setup.importReq = true; } }
    ], 760),
    ...row(380, 60, [
      { id: 'load', label: '💾 Laden', font: 28, disabled: !hasSavedRoom(), onClick: () => { const n = loadRoom(); bench = null; setup.msg = `${n} Flächen geladen (passt nur, wenn du am selben Platz gestartet bist)`; refreshSetupPanel(); } },
      { id: 'undo', label: '↶ Rückgängig', font: 28, onClick: undoSurface },
      { id: 'clear', label: '🗑 Alles löschen', font: 28, onClick: () => { clearRoom(); bench = null; setup.last = null; setup.pending = null; setup.msg = 'Alles gelöscht'; refreshSetupPanel(); } }
    ], 760),
    ...row(454, 70, [{ id: 'done', label: '✔ Fertig', font: 38, onClick: finishSetup }], 760, 200)
  ]);
}
function setTool(t) {
  setup.tool = setup.tool === t ? null : t;
  setup.pending = null;
  setup.drag = null;
  setup.msg = '';
  floorGrid.visible = setup.tool === 'floor';
  refreshSetupPanel();
}
function undoSurface() {
  if (setup.pending) { setup.pending = null; refreshSetupPanel(); return; }
  const list = room.surfaces.filter(s => s.type !== 'bench');
  if (!list.length) return;
  removeSurface(list[list.length - 1]);
  setup.last = null;
  setup.msg = 'Letzte Fläche entfernt';
  saveRoom();
  refreshSetupPanel();
}

// Strahl einer Hand bzw. der Maus
function rayOf(src) {
  if (src === 'mouse') { raycaster.setFromCamera(mouseNdc, camera); return { o: raycaster.ray.origin.clone(), d: raycaster.ray.direction.clone() }; }
  return { o: src.tip.clone(), d: new THREE.Vector3(0, 0, -1).applyQuaternion(src.quat) };
}
// Schnittpunkt mit dem Boden (y = 0)
function floorHit(r, maxDist = 12) {
  if (r.d.y > -0.02) return null;
  const t = -r.o.y / r.d.y;
  return t > 0 && t < maxDist ? r.o.clone().addScaledVector(r.d, t) : null;
}
// Höhe aus dem Laser: Schnitt mit senkrechter Ebene durch die Mitte (zum Spieler gedreht)
function heightFromRay(r, center) {
  const n = new THREE.Vector3(headPos.x - center.x, 0, headPos.z - center.z);
  if (n.lengthSq() < 1e-4) return null;
  n.normalize();
  const denom = r.d.dot(n);
  if (Math.abs(denom) < 1e-3) return null;
  const t = center.clone().sub(r.o).dot(n) / denom;
  return t > 0 ? THREE.MathUtils.clamp(r.o.y + r.d.y * t, 0.15, 1.6) : null;
}
const boxWithHeight = (p) => makeBox(p.type, p.p1.clone().setY(p.height), p.p2.clone().setY(p.height), p.yaw);

// Abzug gedrückt (mit Laser, nicht auf ein Menü)
function setupTriggerDown(src) {
  const tool = setup.tool;
  if (setup.pending) { // Höhe bestätigen
    const p = setup.pending;
    setup.pending = null;
    const s = addBox(p.type, p.p1.clone().setY(p.height), p.p2.clone().setY(p.height), p.yaw);
    if (s) { setup.last = s; setup.msg = `${surfaceName(s.type)} hinzugefügt (Höhe ${p.height.toFixed(2)} m)`; SFX.magIn(); saveRoom(); }
    refreshSetupPanel();
    return;
  }
  if (tool === 'floor') {
    if (src !== 'mouse') {
      floorOffset += src.tip.y - 0.035; // Controller liegt auf dem Boden: Spitze ca. 3,5 cm darüber
      applyFloorOffset();
      setup.msg = 'Bodenhöhe gesetzt – mit Stick ▲▼ fein einstellen';
      SFX.magIn();
      refreshSetupPanel();
    }
    return;
  }
  const hit = floorHit(rayOf(src));
  if (!tool || !hit) return;
  setup.drag = { src, start: hit, cur: hit.clone() };
  if (src !== 'mouse') pulse(src, 0.4, 30);
}
function setupTriggerUp() {
  const d = setup.drag;
  setup.drag = null;
  previewWall.visible = previewLine.visible = false;
  if (!d) return;
  const len = d.start.distanceTo(d.cur);
  if (setup.tool === 'wall') {
    const s = addWall(d.start, d.cur, headPos);
    if (s) { setup.last = s; setup.msg = 'Wand hinzugefügt'; SFX.magIn(); saveRoom(); } else setup.msg = 'Zu kurz – nochmal';
  } else if (setup.tool === 'bench') {
    const yaw = len > 0.2 ? Math.atan2(-(d.cur.z - d.start.z), d.cur.x - d.start.x) : headYaw();
    placeBench(len > 0.2 ? d.start.clone().add(d.cur).multiplyScalar(0.5) : d.start, yaw);
    resetWeapons();
    setup.msg = 'Waffentisch platziert';
    SFX.magIn();
    saveRoom();
  } else if (setup.tool === 'table' || setup.tool === 'chair') {
    if (len < 0.15) setup.msg = 'Zu klein – Grundfläche von Ecke zu Ecke aufziehen';
    else {
      setup.pending = { type: setup.tool, p1: d.start, p2: d.cur, yaw: d.yaw, height: setup.tool === 'table' ? 0.75 : 0.45 };
      setup.msg = '';
    }
  }
  refreshSetupPanel();
}
function updateSetup(dt) {
  // Laser-Punkt(e) auf dem Boden
  const srcs = renderer.xr.isPresenting ? hands.filter(h => h.src) : ['mouse'];
  for (const h of hands) h.floorMarker.visible = false;
  mouseMarker.visible = false;
  const laserTool = setup.tool && setup.tool !== 'floor';
  for (const src of srcs) {
    const marker = src === 'mouse' ? mouseMarker : src.floorMarker;
    if (!laserTool || (src !== 'mouse' && (!isFree(src) || src.uiHover))) continue;
    const hit = floorHit(rayOf(src));
    if (hit) { marker.visible = true; marker.position.copy(hit).setY(0.003); }
  }
  // Ziehen
  const d = setup.drag;
  previewWall.visible = previewBox.visible = previewLine.visible = false;
  if (d) {
    const hit = floorHit(rayOf(d.src));
    if (hit) d.cur = hit;
    d.yaw = suggestYaw(d.start, headYaw());
    previewLine.visible = true;
    previewLine.geometry.setFromPoints([d.start.clone().setY(0.01), d.cur.clone().setY(0.01)]);
    if (setup.tool === 'wall') {
      const s = makeWall(d.start, d.cur, headPos);
      if (s) {
        previewWall.visible = true;
        previewWall.scale.set(s.width, s.height, 1);
        previewWall.position.copy(s.center);
        previewWall.quaternion.setFromRotationMatrix(tmpM.makeBasis(s.right, UP, s.normal));
      }
    } else if (setup.tool === 'table' || setup.tool === 'chair') {
      const s = makeBox(setup.tool, d.start.clone().setY(0.02), d.cur.clone().setY(0.02), d.yaw);
      previewBox.visible = true;
      previewBox.scale.set(s.hx * 2, 0.02, s.hz * 2);
      previewBox.position.set(s.center.x, 0.01, s.center.z);
      previewBox.rotation.set(0, s.yaw, 0);
    }
  }
  // Höhe des neuen Tisches/Stuhls mit dem Laser bestimmen
  const p = setup.pending;
  const stickX = hands.reduce((a, h) => (Math.abs(h.stickX) > Math.abs(a) ? h.stickX : a), 0);
  const stickY = hands.reduce((a, h) => (Math.abs(h.stickY) > Math.abs(a) ? h.stickY : a), 0);
  if (p) {
    const src = renderer.xr.isPresenting ? (hands.find(h => h.src && isFree(h) && !h.uiHover) || null) : 'mouse';
    const s0 = boxWithHeight(p);
    if (src) {
      const hgt = heightFromRay(rayOf(src), s0.center.clone().setY(0));
      if (hgt) p.height = THREE.MathUtils.damp(p.height, hgt, 20, dt);
    }
    if (Math.abs(stickX) > 0.4) p.yaw -= stickX * dt * 1.2;
    if (hands.some(h => down(h, 'b'))) { setup.pending = null; setup.msg = 'Abgebrochen'; refreshSetupPanel(); return; }
    const s = boxWithHeight(p);
    previewBox.visible = true;
    previewBox.scale.set(s.hx * 2, s.height, s.hz * 2);
    previewBox.position.set(s.center.x, s.height / 2, s.center.z);
    previewBox.rotation.set(0, s.yaw, 0);
    setup.refT -= dt;
    if (setup.refT <= 0) { setup.refT = 0.15; refreshSetupPanel(); }
  } else if (setup.last && setup.last.type !== 'wall' && Math.abs(stickX) > 0.4 && room.surfaces.includes(setup.last)) {
    // zuletzt platzierten Tisch/Stuhl drehen
    setup.rotT -= dt;
    if (setup.rotT <= 0) { rotateBox(setup.last, setup.last.yaw - stickX * 0.1); setup.rotT = 0.05; }
  }
  // Bodenhöhe fein einstellen
  if (setup.tool === 'floor') {
    floorGrid.position.set(headPos.x, 0.001, headPos.z);
    if (Math.abs(stickY) > 0.3) {
      floorOffset -= stickY * dt * 0.08; // Stick hoch = Gitter hoch
      setup.refT -= dt;
      if (setup.refT <= 0) { setup.refT = 0.05; applyFloorOffset(); refreshSetupPanel(); }
    }
  }
  // Raum aus der Quest-Raumeinrichtung übernehmen
  const frame = renderer.xr.getFrame && renderer.xr.getFrame();
  if (frame && frame.detectedPlanes !== undefined && !setup.planeSupport) { setup.planeSupport = true; refreshSetupPanel(); }
  const autoTry = setup.autoImport > 0 && !room.surfaces.some(s => s.type !== 'bench');
  if (setup.autoImport > 0) setup.autoImport -= dt;
  if (frame && (setup.importReq || (autoTry && frame.detectedPlanes && frame.detectedPlanes.size > 0))) {
    if (setup.importReq) clearRoom(true);
    const n = importDetectedPlanes(frame, renderer.xr.getReferenceSpace());
    setup.importReq = false;
    setup.autoImport = 0;
    setup.msg = n > 0 ? `${n} Flächen aus der Quest-Raumeinrichtung übernommen – prüfen & ergänzen` : 'Keine Raumdaten gefunden – bitte selbst einzeichnen';
    if (n > 0) saveRoom();
    refreshSetupPanel();
  }
}
function enterSetup() {
  state = 'setup';
  setEditMode(true);
  clearTargets();
  menuPanel.visible = board.visible = false;
  startButton.visible = false;
  setupPanel.visible = true;
  setupPanel.place(0.9, 0.35, -0.2);
  refreshSetupPanel();
}
function finishSetup() {
  setup.tool = null;
  setup.drag = null;
  setup.pending = null;
  floorGrid.visible = false;
  previewWall.visible = previewBox.visible = previewLine.visible = false;
  for (const h of hands) h.floorMarker.visible = false;
  mouseMarker.visible = false;
  saveRoom();
  setEditMode(false);
  setupPanel.visible = false;
  setupBench();
  resetWeapons();
  enterMenu();
}

// =============================================================================
// Spielablauf: Menü → Countdown → Runde → Ergebnis
// =============================================================================
const MODES = {
  time: { name: '⏱ Zeitjagd', desc: '60 Sekunden – so viele Punkte wie möglich' },
  waves: { name: '🌊 Wellen', desc: 'Räume jede Welle ab, bevor die Zeit abläuft' },
  training: { name: '🎯 Training', desc: 'Ohne Zeitlimit üben – Beenden über die Tafel' }
};
let state = 'menu', gameMode = 'time';
let score = 0, combo = 1, timeLeft = 0, wave = 0, waveBreak = 0, countdown = 0, roundClock = 0, spawnDelay = 0, extraTimer = 0;
let boardDirty = true, lastResult = null;
const stats = { shots: 0, hits: 0, bullseyes: 0 };
const inRound = () => state === 'playing';
const hsKey = (m) => 'vrspiel-hs-' + m;
function getHighscore(m) { try { return parseInt(localStorage.getItem(hsKey(m)) || '0', 10); } catch { return 0; } }
function setHighscore(m, v) { try { localStorage.setItem(hsKey(m), String(v)); } catch { /* ignorieren */ } }

function enterMenu() {
  state = lastResult ? 'over' : 'menu';
  board.visible = false;
  menuPanel.visible = true;
  startButton.visible = true;
  menuPanel.place(Math.min(1.1, freeDistance(headPos, inFront(1, 0.45, headPos.y).sub(headPos), 1.4) - 0.15), 0.45, -0.15);
  const sdist = Math.min(2.0, freeDistance(headPos, inFront(1, -0.05, headPos.y).sub(headPos), 2.4) - 0.25);
  startButton.position.copy(inFront(Math.max(0.9, sdist), -0.05, headPos.y + 0.05));
  startButton.lookAt(headPos);
  refreshMenu();
}
function refreshMenu() {
  const best = getHighscore(gameMode);
  const r = lastResult;
  menuPanel.set((ctx, w) => {
    if (r) {
      text(ctx, r.record ? '🏆 Neuer Rekord!' : 'Runde beendet', w / 2, 44, 40, '#fff', 'center', true);
      text(ctx, `${r.score} Punkte`, w / 2, 98, 56, '#ffcc33', 'center', true);
      text(ctx, `Treffer ${r.hits} · Schüsse ${r.shots} · Genauigkeit ${r.acc}% · Volltreffer ${r.bull}${r.wave ? ` · Welle ${r.wave}` : ''}`, w / 2, 146, 24, '#cfd8e3');
    } else {
      text(ctx, '🎯 Schießstand', w / 2, 50, 48, '#fff', 'center', true);
      text(ctx, 'Waffe vom Waffentisch nehmen: hingreifen & Griff-Taste HALTEN.', w / 2, 102, 24, '#cfd8e3');
      text(ctx, 'Loslassen = ablegen oder werfen. Munition & Messer am Gürtel.', w / 2, 134, 24, '#cfd8e3');
    }
    text(ctx, MODES[gameMode].desc, w / 2, 190, 26, '#9ad', 'center', true);
    text(ctx, `Rekord ${MODES[gameMode].name.slice(2)}: ${best}`, w / 2, 395, 26, '#9ad');
    text(ctx, 'Starten: auf die grüne START-Scheibe schießen oder Knopf drücken', w / 2, 505, 22, '#cfd8e3');
  }, [
    ...row(214, 74, Object.entries(MODES).map(([id, m]) => ({ id, label: m.name, active: gameMode === id, onClick: () => { gameMode = id; refreshMenu(); } })), 792),
    ...row(300, 72, [{ id: 'start', label: '▶ START', font: 40, onClick: startPressed }], 792, 220),
    ...row(420, 62, [
      { id: 'room', label: '🧱 Raum bearbeiten', onClick: enterSetup },
      { id: 'reset', label: '🔫 Waffen zurücklegen', onClick: resetWeapons }
    ], 792)
  ]);
}
function startPressed() {
  if (state === 'menu' || state === 'over') startCountdown();
}
function startCountdown() {
  state = 'countdown';
  countdown = 3.999;
  lastResult = null;
  menuPanel.visible = false;
  startButton.visible = false;
  clearTargets();
  for (const w of arsenal) if (w.holder >= 0 || w === deskW) refillWeapon(w);
  resetWeapons(); // nicht gehaltene Waffen liegen zu Beginn jeder Runde wieder auf dem Waffentisch
  const fd = freeDistance(headPos, inFront(1, 0, headPos.y + 0.6).sub(headPos), 3.2);
  board.place(Math.max(1.2, Math.min(3, fd - 0.2)), 0, 0.6);
  board.mesh.scale.setScalar(1.3);
  board.visible = true;
  boardDirty = true;
}
function beginRound() {
  state = 'playing';
  score = 0; combo = 1; roundClock = 0; spawnDelay = 0; extraTimer = 3;
  stats.shots = stats.hits = stats.bullseyes = 0;
  wave = 0;
  timeLeft = gameMode === 'time' ? 60 : Infinity;
  if (gameMode === 'waves') nextWave();
  SFX.jingle([523, 659, 784]);
  refreshBoard();
}
function nextWave() {
  wave++;
  const n = 2 + wave;
  for (let i = 0; i < n; i++) spawn(true);
  timeLeft = 8 + n * 2.6;
  waveBreak = 0;
  boardDirty = true;
}
function endRound() {
  state = 'over';
  dismissTargets();
  const acc = stats.shots ? Math.round(stats.hits / stats.shots * 100) : 0;
  const record = score > getHighscore(gameMode);
  if (record) setHighscore(gameMode, score);
  lastResult = { score, hits: stats.hits, shots: stats.shots, acc, bull: stats.bullseyes, wave: gameMode === 'waves' ? wave : 0, record };
  SFX.jingle([784, 659, 523, 392], 0.35);
  enterMenu();
}
const difficulty = () => gameMode === 'time' ? Math.min(1, roundClock / 60) : gameMode === 'waves' ? Math.min(1, (wave - 1) / 8) : 0.35;
function currentRange() {
  const ws = hands.map(heldWeapon).filter(Boolean);
  if (deskW) ws.push(deskW);
  if (!ws.length) return [2.5, 6];
  return [Math.min(...ws.map(w => w.def.range[0])), Math.max(...ws.map(w => w.def.range[1]))];
}
function spawn(onlyRequired, kind) {
  return spawnTarget({ difficulty: difficulty(), head: headPos.clone(), yaw: headYaw(), range: currentRange(), onlyRequired, kind });
}
function updateGame(dt) {
  if (state === 'countdown') {
    const prev = Math.ceil(countdown);
    countdown -= dt;
    if (Math.ceil(countdown) !== prev) { boardDirty = true; if (countdown > 0) SFX.beep(); }
    if (countdown <= 0) beginRound();
    return;
  }
  if (state !== 'playing') return;
  roundClock += dt;
  const prevT = Math.ceil(timeLeft);
  if (Number.isFinite(timeLeft)) timeLeft -= dt;
  if (Math.ceil(timeLeft) !== prevT) { boardDirty = true; if (timeLeft <= 5 && timeLeft > 0) SFX.beep(); }
  if (gameMode === 'waves') {
    if (waveBreak > 0) { waveBreak -= dt; if (waveBreak <= 0) nextWave(); return; }
    if (remainingRequired() === 0) {
      const bonus = 20 * wave + Math.max(0, Math.ceil(timeLeft)) * 3;
      score += bonus;
      floatingText(`Welle ${wave} geschafft! +${bonus}`, board.mesh.position.clone().add(new THREE.Vector3(0, -0.5, 0)), '#7dffa8');
      SFX.jingle([659, 784, 1046]);
      waveBreak = 2;
      timeLeft = Infinity;
      boardDirty = true;
      return;
    }
    extraTimer -= dt;
    if (extraTimer <= 0) { extraTimer = THREE.MathUtils.randFloat(3, 6); spawn(false, Math.random() < 0.5 ? 'bonus' : 'noshoot'); }
  } else {
    const want = 3 + Math.floor(difficulty() * 2);
    spawnDelay -= dt;
    if (remainingRequired() < want && spawnDelay <= 0) { spawn(false); spawnDelay = 0.35; }
  }
  if (timeLeft <= 0) endRound();
}
function handleResult(res, point, mult, prefix = '') {
  if (!res) return;
  let label;
  if (res.penalty) {
    if (inRound()) { score = Math.max(0, score + res.pts); combo = 1; }
    label = res.label;
  } else {
    const gained = Math.round(res.pts * (inRound() ? combo : 1) * mult);
    label = `${prefix}+${gained}${res.timeBonus ? ` +${res.timeBonus}s` : ''}${inRound() && combo > 1 ? ` (x${combo})` : ''}`;
    if (inRound()) {
      score += gained;
      stats.hits++;
      if (res.ring === 0) stats.bullseyes++;
      combo = Math.min(5, combo + 1);
      if (res.timeBonus && Number.isFinite(timeLeft)) timeLeft += res.timeBonus;
    }
  }
  floatingText(label, point, res.color || '#fff');
  boardDirty = true;
}
function refreshBoard() {
  const training = gameMode === 'training' && state === 'playing';
  board.set((ctx, w, h) => {
    if (state === 'countdown') {
      text(ctx, MODES[gameMode].name, w / 2, 70, 44, '#9ad', 'center', true);
      text(ctx, countdown > 0.5 ? String(Math.ceil(countdown - 0.5)) : 'LOS!', w / 2, 200, 150, '#ffcc33', 'center', true);
      return;
    }
    text(ctx, `${score} Punkte`, w / 2, 66, 76, '#fff', 'center', true);
    let line = '';
    if (gameMode === 'time') line = `⏱ ${Math.max(0, Math.ceil(timeLeft))} s`;
    else if (gameMode === 'waves') line = waveBreak > 0 ? `Welle ${wave} geschafft!` : `Welle ${wave} · ⏱ ${Math.max(0, Math.ceil(timeLeft))} s · noch ${remainingRequired()}`;
    else line = 'Training';
    text(ctx, line, w / 2, 150, 50, timeLeft < 10 ? '#ff5a4a' : '#9ad', 'center', true);
    const acc = stats.shots ? Math.round(stats.hits / stats.shots * 100) : 0;
    text(ctx, `Treffer ${stats.hits}/${stats.shots} (${acc}%) · Combo x${combo}`, w / 2, 214, 30, '#cfd8e3');
  }, training ? row(240, 60, [{ id: 'end', label: '■ Training beenden', onClick: endRound }], 768, 230) : []);
}

// =============================================================================
// Anzeige am Handgelenk der freien Hand
// =============================================================================
const hud = makePanel(0.12, 0.05, 2800);
hud.mesh.visible = false;
hud.mesh.renderOrder = 6;
scene.add(hud.mesh);
let hudKey = '', hudAlpha = 0;
function statusLines(w, h) {
  const d = w.def;
  const desk = !h;
  const A = h ? btnName(h, 'a') : 'R', B = h ? btnName(h, 'b') : 'V';
  const off = h ? otherHand(h) : null;
  const holding = off && off.held && (off.held.type === 'mag' || off.held.type === 'shell');
  const modeName = { safe: 'GESICHERT', semi: d.modes.length > 2 ? 'EINZEL' : 'FEUER', auto: 'DAUERFEUER' }[mode(w)];
  const loaded = w.chamber === 'live' ? 1 : 0;
  const ammo = d.feed === 'mag' ? `${w.magInserted ? w.magRounds : '–'}/${d.capacity}+${loaded}` : `${w.tube}/${d.capacity}+${loaded}`;
  const line2 = `${ammo} · ${modeName}${d.sight === 'scope' ? ` · ${w.zoom.toFixed(0)}x` : ''}`;
  let hint = '';
  if (mode(w) === 'safe') hint = `Gesichert – ${B}: entsichern`;
  else if (d.feed === 'mag' && !w.magInserted) hint = desk ? 'R: nachladen' : holding ? 'Magazin von unten einschieben' : 'Magazin vom Gürtel holen';
  else if (d.feed === 'mag' && w.chamber !== 'live' && w.magRounds === 0) hint = desk ? 'Leer – R: nachladen' : `Leer – ${A}: Magazin raus`;
  else if (d.feed === 'tube' && w.chamber !== 'live' && w.tube === 0) hint = desk ? 'Leer – R: nachladen' : holding ? 'Patrone unten einführen' : 'Patronen vom Gürtel holen';
  else if (w.chamber !== 'live' || w.actionOpen) {
    if (desk) hint = 'Lade durch…';
    else hint = { slide: `Schlitten ziehen (oder ${B})`, charge: 'Spannhebel zurückziehen', pump: 'Vorderschaft zurück & vor', bolt: 'Kammerstängel zurück & vor' }[d.action];
  } else if (holding && d.feed === 'tube' && w.tube < d.capacity) hint = 'Patrone unten einführen';
  return { title: d.name, line2, hint };
}
function updateHud(dt) {
  if (!renderer.xr.isPresenting) {
    const s = deskW ? statusLines(deskW, null) : null;
    statusEl.style.display = s ? 'block' : 'none';
    if (s) statusEl.textContent = `${s.title}\n${s.line2}${s.hint ? '\n➜ ' + s.hint : ''}`;
    hud.mesh.visible = false;
    return;
  }
  statusEl.style.display = 'none';
  const wh = hands.find(h => heldWeapon(h) && h.src && !heldWeapon(otherHand(h)));
  const off = wh ? otherHand(wh) : null;
  if (!wh || !off.src) { hud.mesh.visible = false; hudAlpha = 0; return; }
  const w = heldWeapon(wh);
  const s = statusLines(w, wh);
  hud.mesh.position.copy(off.point).add(tmpV.set(0, 0.035, 0.1).applyQuaternion(off.quat));
  hud.mesh.lookAt(headPos);
  getViewCamera().getWorldDirection(tmpV2);
  const look = tmpV3.copy(hud.mesh.position).sub(headPos).normalize().dot(tmpV2);
  let target = THREE.MathUtils.smoothstep(look, Math.cos(0.55), Math.cos(0.3)); // nur beim Hinschauen
  if (w.twoHanding || w.aligned) target = 0; // nie beim Zielen
  hudAlpha = THREE.MathUtils.damp(hudAlpha, target, 12, dt);
  hud.mesh.material.opacity = hudAlpha;
  hud.mesh.visible = hudAlpha > 0.02;
  const key = JSON.stringify(s);
  if (key === hudKey) return;
  hudKey = key;
  hud.draw((ctx, cw, ch) => {
    panelBg(ctx, cw, ch, 22, s.hint ? '#ffcc33' : '#55ff77');
    text(ctx, s.line2, 18, ch * 0.3, 34, '#fff', 'left', true);
    text(ctx, s.hint || s.title, 18, ch * 0.7, 26, s.hint ? '#ffcc33' : '#9ad', 'left', true);
  });
}

// =============================================================================
// Visiere: Rotpunkt & Zielfernrohr
// =============================================================================
const redDot = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,90,90,1)');
  g.addColorStop(0.35, 'rgba(255,30,30,0.9)');
  g.addColorStop(1, 'rgba(255,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, depthWrite: false, toneMapped: false }));
  s.renderOrder = 999;
  s.visible = false;
  scene.add(s);
  return s;
})();
const eyePositions = [new THREE.Vector3(), new THREE.Vector3()];
function eyeAlignment(lensSocket, axis) {
  lensSocket.getWorldPosition(tmpV2);
  const cams = renderer.xr.isPresenting ? renderer.xr.getCamera().cameras : [];
  const eyes = cams.length ? cams.map((c, i) => c.getWorldPosition(eyePositions[i])) : [headPos];
  let best = { along: -1, perp: Infinity, eye: headPos };
  for (const eye of eyes) {
    const toLens = tmpV2.clone().sub(eye);
    const along = toLens.dot(axis);
    const perp = toLens.addScaledVector(axis, -along).length();
    if (along > 0 && perp < best.perp) best = { along, perp, eye };
  }
  return best;
}
// Kamerabild der Quest für das Zielfernrohr (optional)
const CAM_HFOV = THREE.MathUtils.degToRad(72);
let camVideo = null, camTex = null;
const camBtn = document.getElementById('camBtn');
async function startCamera() {
  if (camTex || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
    camVideo = document.createElement('video');
    camVideo.muted = true;
    camVideo.playsInline = true;
    camVideo.srcObject = stream;
    await camVideo.play();
    camTex = new THREE.VideoTexture(camVideo);
    camTex.colorSpace = THREE.SRGBColorSpace;
    camBtn.textContent = '📷 Kamera fürs Zielfernrohr aktiv';
  } catch (e) {
    camBtn.textContent = '📷 Kamera nicht verfügbar – Zielfernrohr zeigt den Raum durchs Glas';
  }
}
camBtn.addEventListener('click', startCamera);
if (navigator.permissions && navigator.permissions.query) {
  navigator.permissions.query({ name: 'camera' }).then(r => { if (r.state === 'granted') startCamera(); }).catch(() => {});
}
let scopeRendered = false;
function updateSights(w) {
  if (!w || !w.root.parent) return;
  const axis = w.sockets.sightFront.getWorldPosition(new THREE.Vector3()).sub(w.sockets.sightRear.getWorldPosition(tmpV3)).normalize();
  const iron = eyeAlignment(w.sockets.sightRear, axis);
  w.aligned = iron.along > 0 && iron.along < 0.5 && iron.perp < 0.05;
  if (w.def.sight === 'reddot') {
    const a = eyeAlignment(w.sockets.dotLens, axis);
    if (a.along > 0 && a.along < 0.7 && a.perp < 0.016) {
      redDot.visible = true;
      redDot.position.copy(a.eye).addScaledVector(axis, 40);
      redDot.scale.setScalar(0.14);
    }
  } else if (w.def.sight === 'scope' && !scopeRendered) {
    const P = w.parts;
    const a = eyeAlignment(w.sockets.scopeEye, axis);
    const k = a.along > 0 ? THREE.MathUtils.clamp(1 - (a.perp - 0.008) / 0.02, 0, 1) : 0;
    if (a.along < 0.6 && a.perp < 0.06) w.aligned = true;
    P.lensShade.material.opacity = 1 - k;
    const xr = renderer.xr.isPresenting;
    const useVideo = xr && camTex && camVideo.videoWidth > 0;
    P.lensVideo.visible = !!useVideo;
    P.lensHole.visible = xr && !useVideo; // „Loch“: echter Raum durchs Glas
    if (k > 0 && a.along < 0.6) {
      scopeRendered = true;
      const fovDeg = 24 / w.zoom;
      w.sockets.scopeCam.getWorldPosition(scopeCam.position);
      w.body.getWorldQuaternion(scopeCam.quaternion);
      scopeCam.fov = fovDeg;
      scopeCam.updateProjectionMatrix();
      scopeCam.updateMatrixWorld(true);
      const prevTarget = renderer.getRenderTarget(), prevBg = scene.background, hudVis = hud.mesh.visible;
      renderer.xr.enabled = false;
      scene.background = xr ? null : scopeBackground;
      w.root.visible = false;
      hud.mesh.visible = false;
      renderer.setRenderTarget(scopeRT);
      renderer.clear();
      renderer.render(scene, scopeCam);
      renderer.setRenderTarget(prevTarget);
      w.root.visible = true;
      hud.mesh.visible = hudVis;
      scene.background = prevBg;
      renderer.xr.enabled = true;
      if (useVideo) {
        if (P.lensVideo.material.map !== camTex) { P.lensVideo.material.map = camTex; P.lensVideo.material.needsUpdate = true; }
        getViewCamera().getWorldQuaternion(tmpQ);
        const d = axis.clone().applyQuaternion(tmpQ.invert());
        const tx = Math.tan(CAM_HFOV / 2), ty = tx * camVideo.videoHeight / camVideo.videoWidth;
        const half = Math.tan(THREE.MathUtils.degToRad(fovDeg / 2));
        if (d.z < -0.2) {
          camTex.repeat.set(half / tx, half / ty);
          camTex.offset.set(0.5 + (d.x / -d.z) / (2 * tx) - camTex.repeat.x / 2, 0.5 + (d.y / -d.z) / (2 * ty) - camTex.repeat.y / 2);
        }
      }
    }
  }
}

// =============================================================================
// Steuerung am PC (zum Testen ohne Brille)
// =============================================================================
const mouseNdc = new THREE.Vector2();
let lookYaw = 0, lookPitch = -0.2, rightDrag = false, lastX = 0, lastY = 0, leftDown = false, aiming = false;
const timers = [];
const later = (sec, fn) => timers.push({ t: sec, fn });
function equipDesk(w) {
  if (deskW === w) return;
  if (deskW) { const old = deskW; deskW = null; camera.remove(old.root); scene.add(old.root); placeOnBench([old]); }
  for (const h of hands) if (heldWeapon(h) === w) h.held = null;
  if (w.phys) { removeDynamic(w.phys); w.phys = null; }
  w.holder = -1;
  camera.add(w.root);
  w.root.quaternion.identity();
  deskW = w;
  setBeltWeapon(w.id);
  SFX.grab();
}
function desktopReload() {
  const w = deskW;
  if (!w || w.desktopBusy) return;
  w.desktopBusy = true;
  let t = 0;
  if (w.def.feed === 'mag') {
    if (w.magInserted) { ejectMag(w); t += 0.5; }
    later(t, () => insertMag(w, w.def.capacity));
    t += 0.35;
  } else {
    const need = w.def.capacity - w.tube;
    for (let i = 0; i < need; i++) later(t + i * 0.3, () => { w.tube++; SFX.shellIn(); boardDirty = true; });
    t += need * 0.3 + 0.1;
  }
  later(t, () => {
    if (w.chamber !== 'live') { actionBack(w); later(0.18, () => { actionForward(w); w.desktopBusy = false; }); }
    else w.desktopBusy = false;
  });
}
function desktopShoot() {
  const w = deskW;
  let ray = null;
  if (!aiming) { raycaster.setFromCamera(mouseNdc, camera); ray = raycaster.ray.clone(); }
  if (tryFire(w, ray) && !w.def.autoCycle) {
    w.desktopBusy = true;
    later(0.3, () => { actionBack(w); later(0.18, () => { actionForward(w); w.desktopBusy = false; }); });
  }
}
function desktopThrowKnife() {
  raycaster.setFromCamera(mouseNdc, camera);
  const k = makeKnife();
  k.position.copy(raycaster.ray.origin).addScaledVector(raycaster.ray.direction, 0.3).add(new THREE.Vector3(0, -0.1, 0));
  scene.add(k);
  launchKnife(k, aimAssist(k.position, raycaster.ray.direction.clone().multiplyScalar(11)));
}
renderer.domElement.addEventListener('pointermove', (e) => {
  mouseNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  crosshairEl.style.left = e.clientX + 'px';
  crosshairEl.style.top = e.clientY + 'px';
  if (rightDrag) {
    lookYaw -= (e.clientX - lastX) * 0.004;
    lookPitch = THREE.MathUtils.clamp(lookPitch - (e.clientY - lastY) * 0.004, -1.3, 1.2);
    lastX = e.clientX; lastY = e.clientY;
  }
});
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (renderer.xr.isPresenting) return;
  mouseNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  if (e.button === 2) { rightDrag = true; lastX = e.clientX; lastY = e.clientY; return; }
  if (e.button !== 0) return;
  raycaster.setFromCamera(mouseNdc, camera);
  const ui = raycaster.intersectObjects(uiPanels.filter(p => p.visible).map(p => p.mesh), false)[0];
  if (ui) { const b = ui.object.userData.ui.buttonAt(ui.uv); if (b) { b.onClick(); SFX.ui(); } return; }
  if (state === 'setup') { setupTriggerDown('mouse'); return; }
  leftDown = true;
  if (deskW && deskW.cooldown <= 0 && !deskW.desktopBusy) desktopShoot();
});
window.addEventListener('pointerup', (e) => {
  if (e.button === 2) rightDrag = false;
  if (e.button === 0) { leftDown = false; if (setup.drag && setup.drag.src === 'mouse') setupTriggerUp(); }
});
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('wheel', (e) => { if (deskW && deskW.def.sight === 'scope') deskW.zoom = THREE.MathUtils.clamp(deskW.zoom - Math.sign(e.deltaY), 4, 12); });
window.addEventListener('keydown', (e) => {
  if (renderer.xr.isPresenting) return;
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= 4) equipDesk(arsenal[n - 1]);
  if (e.key === 'f' || e.key === 'F') desktopThrowKnife();
  if (e.key === 'Enter') startPressed();
  if (!deskW) return;
  if (e.key === 'r' || e.key === 'R') desktopReload();
  if (e.key === 'v' || e.key === 'V') toggleMode(deskW);
  if (e.code === 'Space') { aiming = !aiming; e.preventDefault(); }
});
function updateWeaponDesktop(w, dt) {
  w.aim = THREE.MathUtils.damp(w.aim, aiming ? 1 : 0, 12, dt);
  raycaster.setFromCamera(mouseNdc, camera);
  const dirCam = raycaster.ray.direction.clone().transformDirection(camera.matrixWorldInverse);
  const hipQ = new THREE.Quaternion().setFromUnitVectors(FWD, dirCam);
  const hipP = new THREE.Vector3(0.16, -0.17, -0.42);
  const eyeDist = w.def.sight === 'scope' ? 0.075 : w.def.sight === 'reddot' ? 0.2 : 0.32;
  const adsP = new THREE.Vector3(0, 0, -eyeDist).sub(w.restSightRear);
  w.root.position.lerpVectors(hipP, adsP, w.aim);
  w.root.quaternion.slerpQuaternions(hipQ, new THREE.Quaternion(), w.aim);
  const fov = aiming ? 55 : 70;
  if (Math.abs(camera.fov - fov) > 0.1) { camera.fov = THREE.MathUtils.damp(camera.fov, fov, 10, dt); camera.updateProjectionMatrix(); }
  crosshairEl.style.display = aiming ? 'none' : 'block';
  if (leftDown && mode(w) === 'auto' && w.cooldown <= 0 && w.chamber === 'live') desktopShoot();
}
// Beispielraum für den PC-Test
function buildDemoRoom() {
  room.desktop = true;
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  addWall(v(-4, 0, -5), v(4, 0, -5), headPos);
  addWall(v(-3.2, 0, -5), v(-3.2, 0, 1), headPos);
  addBox('table', v(0.4, 0.75, -2.9), v(1.8, 0.75, -2.2), 0);
  addBox('chair', v(-1.7, 0.46, -3.3), v(-1.25, 0.46, -2.85), 0);
}

// =============================================================================
// VR-Sitzung
// =============================================================================
renderer.xr.addEventListener('sessionstart', () => {
  scene.background = null;
  desktopFloor.visible = false;
  crosshairEl.style.display = 'none';
  ensureAudio();
  if (deskW) { const w = deskW; deskW = null; camera.remove(w.root); scene.add(w.root); }
  room.desktop = false;
  baseRefSpace = renderer.xr.getReferenceSpace();
  applyFloorOffset();
  clearRoom();
  bench = null;
  lastResult = null;
  setup.autoImport = 4;
  setTimeout(() => { enterSetup(); for (const w of arsenal) { refillWeapon(w); if (!w.phys) makeLoose(w); } }, 400);
});
renderer.xr.addEventListener('sessionend', () => {
  scene.background = desktopBackground;
  desktopFloor.visible = true;
  camera.position.set(0, 1.6, 0);
  for (const h of hands) { h.held = null; h.grab = null; h.pull = null; }
  for (const w of arsenal) w.holder = -1;
  clearRoom();
  bench = null;
  baseRefSpace = null;
  setup.tool = null; setup.pending = null; setup.drag = null;
  floorGrid.visible = false;
  setEditMode(false);
  setupPanel.visible = false;
  buildDemoRoom();
  setupBench();
  resetWeapons();
  enterMenu();
});

// =============================================================================
// Hauptschleife
// =============================================================================
const clock = new THREE.Clock();
camera.rotation.set(lookPitch, lookYaw, 0, 'YXZ');
camera.updateMatrixWorld(true);
buildDemoRoom();
setupBench();
resetWeapons();
enterMenu();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  const xr = renderer.xr.isPresenting;
  if (!xr) camera.rotation.set(lookPitch, lookYaw, 0, 'YXZ');
  camera.updateMatrixWorld(true);
  getViewCamera().getWorldPosition(headPos);
  for (const h of hands) h.ray.updateMatrixWorld(true);
  for (let i = timers.length - 1; i >= 0; i--) {
    timers[i].t -= dt;
    if (timers[i].t <= 0) { const f = timers[i].fn; timers.splice(i, 1); f(); }
  }
  updateBelt(dt);
  if (xr) {
    readInputs();
    // Bedienfelder folgen, wenn man sich weit entfernt
    for (const p of [setupPanel, menuPanel]) if (p.visible && headPos.distanceTo(p.anchor) > 1.3) p === menuPanel ? enterMenu() : p.place(0.9, 0.35, -0.2);
    updateHandsXR(dt);
    if (state === 'setup') updateSetup(dt);
  } else {
    if (deskW) updateWeaponDesktop(deskW, dt);
    if (state === 'setup') updateSetup(dt);
  }
  for (const w of arsenal) updateWeaponVisuals(w, dt);
  flashLight.intensity = Math.max(0, flashLight.intensity - dt * 60);
  stepPhysics(dt);
  updateKnives(dt);
  updateTargets(dt);
  updateGame(dt);
  if (startButton.visible) startButton.scale.setScalar(1 + Math.sin(elapsed * 4) * 0.05);
  updateEffects(dt);
  updateDebris(dt);
  updateHud(dt);
  if (boardDirty && board.visible) { refreshBoard(); boardDirty = false; }
  scene.updateMatrixWorld();
  redDot.visible = false;
  scopeRendered = false;
  for (const h of hands) updateSights(heldWeapon(h));
  updateSights(deskW);
  renderer.render(scene, camera);
});

// Für automatisierte Tests
window.__game = {
  get state() { return state; }, get score() { return score; }, arsenal, hands, room, beltSlots, knives, looseMags, targets, uiPanels,
  menuPanel, setupPanel, board, startButton, setup, get floorOffset() { return floorOffset; }, get bench() { return bench; }, startPressed, enterSetup, finishSetup, equipDesk, desktopReload,
  get deskW() { return deskW; }, get mode() { return gameMode; }, set mode(m) { gameMode = m; }, endRound
};
