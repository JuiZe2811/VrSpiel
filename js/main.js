import * as THREE from 'three';
import { VERSION } from './version.js?v=19';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { makePanel, panelBg, roundRect, MAT, cachedGeo } from './util.js?v=19';
import { SFX, ensureAudio, setListener, SFX_PLAYER } from './sfx.js?v=19';
import { WEAPON_ORDER, WEAPON_DEFS, BUILDERS, MASS, createWeapon, buildWeapon, refillWeapon, makeMag, makeShell, makeCasing, makeCartridge, makeKnife, makeGrenade, scopeRT, scopeCam } from './weapons.js?v=19';
import './weaponkit.js?v=19';
import { world, addDynamic, removeDynamic, localBoxOf, stepPhysics, dynamics, applyImpulse } from './physics.js?v=19';
import { room, addWall, addBox, makeWall, makeBox, rotateBox, removeSurface, clearRoom, setEditMode, suggestYaw, surfacesOf, importDetectedPlanes, saveRoom, loadRoom, hasSavedRoom, surfaceName, addWallbuy, serializeRoom, deserializeRoom, roomSlots, saveRoomSlot, loadRoomSlot, addOpening, makeOpening, roomOccluders, isOpening, setAtmosphere } from './room.js?v=19';
import { initEffects, headRef, spawnTracer, burst, floatingText, updateEffects, addDebris, updateDebris, shockwave, floorDecal, clearDecals, puff, sparks, surfaceDecal } from './effects.js?v=19';
import { initZombies, zombies, spawnZombie, updateZombies, zombieHitMeshes, damageZombie, clearZombies, aliveCount, zombieHeads, setupPlanks, clearPlanks, plankMeshes, buildNav, openings, explosionDamage, killAll, makePlankMesh, plankSlot, missingPlanks, addPlank } from './zombies.js?v=19';

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
initZombies(scene, (dmg, z) => playerHit(dmg, z), (res, p) => handleZombieHit(res, p, '🎯 '), (z, big) => onGiantStomp(z, big));

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 200);
camera.position.set(0, 1.6, 0);
scene.add(camera);
scene.add(new THREE.HemisphereLight(0xffffff, 0x666677, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(1, 3, 2);
scene.add(sun, sun.target);
// Echte Schatten: Zombies & Waffen werfen Schatten auf den echten Boden (unsichtbarer "Schattenfänger")
let shadowsOn = (() => { try { return localStorage.getItem('vrspiel-schatten') !== 'false'; } catch { return true; } })();
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // nur einmal pro Bild (nicht nochmal fürs Zielfernrohr)
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -4.5, right: 4.5, top: 4.5, bottom: -4.5, near: 0.5, far: 14 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.02;
sun.castShadow = shadowsOn;
const shadowFloor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.42, depthWrite: false }));
shadowFloor.rotation.x = -Math.PI / 2;
shadowFloor.position.y = 0.002;
shadowFloor.receiveShadow = true;
shadowFloor.renderOrder = -5;
shadowFloor.visible = shadowsOn;
scene.add(shadowFloor);
function setShadows(on) {
  shadowsOn = on;
  sun.castShadow = on;
  shadowFloor.visible = on;
  try { localStorage.setItem('vrspiel-schatten', String(on)); } catch { /* ignorieren */ }
}
const castShadows = (o) => o.traverse(m => { if (m.isMesh && !m.material.transparent) m.castShadow = true; });
const flashLight = new THREE.PointLight(0xffaa44, 0, 2.5);
scene.add(flashLight);
const desktopFloor = new THREE.GridHelper(40, 40, 0x666666, 0x444444);
scene.add(desktopFloor);

document.body.appendChild(ARButton.createButton(renderer, { optionalFeatures: ['local-floor', 'plane-detection'] }));
const statusEl = document.getElementById('status');
document.getElementById('info').insertAdjacentHTML('beforeend', `<br /><span style="opacity:.7">Version ${VERSION}</span>`);
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
  const hit = raycaster.intersectObjects(roomOccluders(), false)[0];
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
// Alle Waffen, die gerade in der Welt existieren (Startwaffe + gekaufte/gezogene)
const arsenal = [];
function spawnWeapon(id, starter = false) {
  const w = createWeapon(id);
  castShadows(w.root);
  w.starter = starter;
  w.lastTouch = elapsed;
  scene.add(w.root);
  arsenal.push(w);
  return w;
}
function disposeWeapon(w) {
  for (const h of hands) { if (heldWeapon(h) === w) h.held = null; if (h.grab && h.grab.w === w) h.grab = null; }
  if (deskW === w) { deskW = null; camera.remove(w.root); }
  if (holster === w) holster = null;
  if (w.phys) { removeDynamic(w.phys); w.phys = null; }
  if (w.root.parent) w.root.parent.remove(w.root);
  const i = arsenal.indexOf(w);
  if (i >= 0) arsenal.splice(i, 1);
}
let holster = null; // im Rückenholster verstaute Waffe
spawnWeapon('pistol', true);
let deskW = null; // am PC gehaltene Waffe
const mode = (w) => w.def.modes[w.modeIdx];

function makeLoose(w, vel, angVel) {
  if (w.phys) return;
  if (w.root.parent !== scene) { w.root.updateMatrixWorld(true); w.root.matrixWorld.decompose(w.root.position, w.root.quaternion, tmpS); scene.add(w.root); }
  w.body.position.set(0, 0, 0);
  w.body.rotation.set(0, 0, 0);
  w.phys = addDynamic(w.root, w.localBox, MASS[w.id], {
    vel, angVel,
    onLost: () => (w.starter ? placeOnBench([w]) : disposeWeapon(w)),
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
  if (holster === w) { holster = null; w.holstered = false; w.root.visible = true; }
  if (w.phys) { removeDynamic(w.phys); w.phys = null; }
  if (w.root.parent !== scene) scene.add(w.root);
  w.lastTouch = elapsed;
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
  w.smoothQ = null;
  const o = otherHand(h);
  if (o.grab && o.grab.w === w) releaseGrab(o);
  h.held = null;
  w.holder = -1;
  w.twoHanding = false;
  w.handTravel = false;
  w.parts.flash.visible = false;
  w.lastTouch = elapsed;
  // über der Schulter losgelassen: ins Rückenholster stecken
  if (!holster && inHolsterZone(h.point)) {
    holster = w;
    w.holstered = true;
    w.root.visible = false;
    SFX.click(700, 0.4, 0.08);
    pulse(h, 0.6, 60);
    boardDirty = true;
    return;
  }
  makeLoose(w, throwIt ? h.vel.clone().multiplyScalar(1.2) : new THREE.Vector3(), throwIt ? h.angVel.clone() : new THREE.Vector3());
  SFX.grab();
}
// Rückenholster: hinter den Schultern (links oder rechts)
function inHolsterZone(p) {
  getViewCamera().getWorldDirection(tmpV3);
  const f = tmpV3.setY(0).normalize();
  const side = new THREE.Vector3(-f.z, 0, f.x);
  const base = headPos.clone().addScaledVector(f, -0.12).add(new THREE.Vector3(0, -0.18, 0));
  return p.distanceTo(base.clone().addScaledVector(side, 0.18)) < 0.26 || p.distanceTo(base.clone().addScaledVector(side, -0.18)) < 0.26;
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
// Kompakter Waffenständer: Langwaffen stehen aufrecht in der Halterung, die Pistole liegt davor
let benchRack = null;
const plankPilePos = new THREE.Vector3(0, -10, 0);
function placeBench(c, by) {
  for (const old of room.surfaces.filter(x => x.type === 'bench')) removeSurface(old);
  const X = new THREE.Vector3(Math.cos(by), 0, -Math.sin(by)), Z = new THREE.Vector3(Math.sin(by), 0, Math.cos(by));
  const p1 = c.clone().addScaledVector(X, -0.45).addScaledVector(Z, -0.22), p2 = c.clone().addScaledVector(X, 0.45).addScaledVector(Z, 0.22);
  bench = addBox('bench', p1.setY(0.8), p2.setY(0.8), by);
  if (benchRack) { scene.remove(benchRack); benchRack.traverse(o => { if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); }); }
  benchRack = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a4128, roughness: 0.8 });
  const mk = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wood); m.position.set(x, y, z); benchRack.add(m); };
  // Halterung an der Rückseite (vom Spieler weg)
  const back = Z.dot(headPos.clone().sub(c)) > 0 ? -1 : 1;
  for (const x of [-0.43, 0.43]) mk(0.035, 0.6, 0.035, x, 0.8 + 0.3, back * 0.2);
  mk(0.9, 0.04, 0.05, 0, 1.35, back * 0.2);
  mk(0.9, 0.03, 0.09, 0, 0.815, back * 0.17);
  // Bretterstapel auf einer Kiste neben dem Ständer (zum Reparieren von Türen/Fenstern)
  const crate = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.6, 0.42), new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9 }));
  crate.position.set(0.72, 0.3, 0);
  benchRack.add(crate);
  for (let i = 0; i < 4; i++) {
    const b = makePlankMesh(0.9);
    b.rotation.set(-Math.PI / 2, Math.PI / 2 + (Math.random() - 0.5) * 0.15, 0);
    b.position.set(0.72 + (Math.random() - 0.5) * 0.06, 0.615 + i * 0.026, 0);
    benchRack.add(b);
  }
  castShadows(benchRack);
  benchRack.position.set(c.x, 0, c.z);
  benchRack.rotation.y = by;
  scene.add(benchRack);
  benchRack.updateMatrixWorld(true);
  plankPilePos.copy(benchRack.localToWorld(new THREE.Vector3(0.72, 0.68, 0)));
}
function placeOnBench(list) {
  if (!bench || !room.surfaces.includes(bench)) setupBench();
  const L = bench.X.clone(), S = bench.Z.clone();
  if (S.dot(headPos.clone().sub(bench.center)) < 0) S.negate(); // S zeigt zum Spieler
  const top = bench.height;
  let along = -0.36;
  for (const w of arsenal.filter(a => a.starter)) {
    const upright = w.def.twoHand;
    const width = w.localBox.max.y - w.localBox.min.y;
    let target;
    if (upright) { target = bench.center.clone().addScaledVector(L, along + width / 2).addScaledVector(S, -0.15); along += width + 0.03; }
    else target = bench.center.clone().addScaledVector(S, 0.1);
    if (!list.includes(w) || w.holder >= 0 || w === deskW) continue;
    if (w.phys) { removeDynamic(w.phys); w.phys = null; }
    if (w.root.parent !== scene) scene.add(w.root);
    if (upright) {
      // Mündung nach oben, rechte Seite zum Spieler
      w.root.quaternion.setFromAxisAngle(UP, Math.atan2(-S.z, S.x)).multiply(new THREE.Quaternion().setFromAxisAngle(XAXIS, Math.PI / 2));
    } else {
      const yawW = Math.atan2(-L.x, -L.z);
      w.root.quaternion.setFromEuler(new THREE.Euler(0, yawW, Math.PI / 2, 'YXZ'));
    }
    w.root.position.copy(bench.center);
    w.root.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(w.root);
    const cc = bb.getCenter(new THREE.Vector3());
    w.root.position.x += target.x - cc.x;
    w.root.position.z += target.z - cc.z;
    w.root.position.y += top + 0.004 - bb.min.y;
    if (!upright) makeLoose(w); // Pistole liegt mit Physik, Langwaffen stehen fest im Ständer
  }
}
// Startwaffen zurück auf den Ständer; gekaufte Waffen verschwinden (removeBought)
function resetWeapons(removeBought = false) {
  if (removeBought) for (const w of [...arsenal]) if (!w.starter) disposeWeapon(w);
  for (const w of arsenal) if (w.holder < 0 && w !== deskW) refillWeapon(w);
  placeOnBench(arsenal.filter(w => w.starter));
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
  if (w.def.noEject && w.chamber !== 'empty') { w.chamber = 'empty'; return; } // Revolver/Doppelflinte/Plasma: nichts fliegt heraus
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
const DAMAGE = { pistol: 34, smg: 24, shotgun: 15, sniper: 150, knife: 90 }; // Schaden pro Treffer (Schrot: pro Kugel)
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
  sparks(hit.point, n, 6);
  puff(hit.point, 0x9a9183, 0.08, 0.7, 0.1, 0.5);
}
// Zielhilfe: knapp danebengezielte Kopfschüsse (bis ~2,5°) werden auf den Kopf gelenkt, wenn freie Sicht besteht
function shotAssist(origin, dir) {
  let best = null, ba = 0.044;
  for (const hp of zombieHeads()) {
    const to = hp.clone().sub(origin);
    const dist = to.length();
    if (dist > 25 || dist < 0.3) continue;
    const ang = to.normalize().angleTo(dir);
    if (ang < ba) { ba = ang; best = { to: to.clone(), dist }; }
  }
  if (!best) return;
  raycaster.set(origin, best.to);
  raycaster.far = best.dist - 0.15;
  if (raycaster.intersectObjects([...roomOccluders(), ...plankMeshes()], false).length) return;
  dir.lerp(best.to, 0.85).normalize();
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
  flashLight.distance = 2.5;
  flashLight.intensity = 4;
  puff(muzzlePos, 0xcfcfcf, w.def.pellets > 1 ? 0.09 : 0.05, 1.0, 0.12, w.def.pellets > 1 ? 0.45 : 0.3);
  if (w.parts.spin) w.parts.spin.rotation.z += Math.PI / 3; // Revolvertrommel dreht weiter
  if (w.def.projectile) { // Plasmakugel statt Sofort-Treffer
    launchPlasma(muzzlePos, dir.clone(), w.def.dmg);
    if (w.def.autoCycle) { ejectChamber(w); if (!feed(w)) w.actionOpen = w.def.holdOpen; w.cycleAnim = 1; }
    if (inRound()) stats.shots++;
    boardDirty = true;
    return true;
  }
  if (settings.assist && !desktopRay) shotAssist(origin, dir);
  const cands = [...zombieHitMeshes(), ...plankMeshes(), ...roomOccluders(), ...(startButton.visible ? startButton.userData.hit : [])];
  const dmg = w.def.dmg ?? DAMAGE[w.id] ?? 30;
  let startHit = null;
  for (let p = 0; p < w.def.pellets; p++) {
    const d = dir.clone();
    if (spread > 0) d.add(new THREE.Vector3().randomDirection().multiplyScalar(spread * Math.sqrt(Math.random()))).normalize();
    raycaster.set(origin, d);
    raycaster.far = 200;
    const hit = raycaster.intersectObjects(cands, false)[0];
    if (p < 3) spawnTracer(muzzlePos, hit ? hit.point : origin.clone().addScaledVector(d, 60));
    if (!hit) continue;
    const ud = hit.object.userData;
    if (ud.isStart) { startHit = hit; continue; }
    if (ud.surface) { if (p < 4) wallImpact(hit, d); continue; }
    if (ud.plank) { burst(hit.point, 0xb08850, 6); continue; }
    if (ud.zombie) {
      handleZombieHit(damageZombie(hit.object, hit.point, d, dmg), hit.point);
      // Blut spritzt auf die Wand/den Tisch dahinter
      if (Math.random() < 0.6) {
        raycaster.set(hit.point, d);
        raycaster.far = 1.8;
        const back = raycaster.intersectObjects(roomOccluders(), false)[0];
        if (back) {
          const n = back.face ? back.face.normal.clone().transformDirection(back.object.matrixWorld) : d.clone().negate();
          if (n.dot(d) > 0) n.negate();
          surfaceDecal(back.point, n, 'blood', THREE.MathUtils.randFloat(0.18, 0.4) * (1.4 - back.distance / 1.8));
        }
      }
    }
  }
  if (w.def.autoCycle) { // Halbautomat: auswerfen und nachladen
    ejectChamber(w);
    if (!feed(w)) w.actionOpen = w.def.holdOpen;
    w.cycleAnim = 1;
  }
  if (inRound()) stats.shots++;
  boardDirty = true;
  if (startHit) { burst(startHit.point, 0x33ff77, 20); startPressed(); }
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
  const slot = { kind: 'knife', mount, obj: knife, available: true, refill: 0, radius: 0.13 };
  beltSlots.push(slot);
  return slot;
})();
// zwei Handgranaten am Gürtel (werden zu jeder Welle aufgefüllt)
const grenadeSlots = [-0.95, 0.95].map(phi => {
  const mount = beltMount(phi);
  const loop = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.012), leather);
  loop.position.set(0, -0.01, -0.016);
  mount.add(loop);
  const g = makeGrenade();
  g.position.set(0, 0, -0.045);
  mount.add(g);
  const slot = { kind: 'grenade', mount, obj: g, available: true, refill: 0, radius: 0.12 };
  beltSlots.push(slot);
  return slot;
});
function refillGrenades() { for (const s of grenadeSlots) { s.available = true; s.obj.visible = true; } }
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
      const pouch = new THREE.Mesh(cachedGeo('pouch', () => new THREE.BoxGeometry(0.05, 0.075, 0.042)), pouchMat);
      pouch.position.set(0, -0.022, -0.024);
      mount.add(pouch);
      const mag = makeMag(id);
      mag.position.set(0, 0.035, -0.024);
      mount.add(mag);
      beltSlots.push({ kind: 'mag', mount, obj: mag, available: true, refill: 0, radius: 0.15 });
    } else {
      const strip = new THREE.Mesh(cachedGeo('shellstrip', () => new THREE.BoxGeometry(0.105, 0.032, 0.008)), leather);
      strip.position.set(0, 0, -0.014);
      mount.add(strip);
      const round = def.ammo === 'round';
      for (let k = 0; k < (round ? 5 : 4); k++) {
        const sh = round ? makeCartridge(true) : makeShell();
        if (round) sh.scale.setScalar(1.4);
        sh.position.set(round ? -0.04 + k * 0.02 : -0.036 + k * 0.024, 0.008, -0.027);
        mount.add(sh);
        beltSlots.push({ kind: 'shell', mount, obj: sh, available: true, refill: 0, radius: 0.12 });
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
    if (s.kind === 'grenade' && (state === 'playing' || state === 'countdown')) continue; // erst zur nächsten Welle
    s.refill -= dt;
    if (s.refill <= 0) { s.available = true; s.obj.visible = true; }
  }
  belt.updateMatrixWorld(true);
}
function holdItem(h, type, obj, extra = {}) {
  obj.position.set(0, 0.05, -0.03);
  obj.quaternion.setFromEuler(new THREE.Euler(-0.3, 0, 0));
  if (type === 'knife') { obj.position.set(0, -0.045, 0.015); obj.quaternion.identity(); }
  if (type === 'grenade') { obj.position.set(0, -0.03, -0.01); obj.quaternion.identity(); }
  if (type === 'plank') { obj.position.set(0, -0.03, -0.06); obj.quaternion.setFromEuler(new THREE.Euler(-0.2, 0, 0)); }
  h.ray.add(obj);
  h.held = Object.assign({ type, obj }, extra);
  SFX.grab();
  pulse(h, 0.5, 40);
}
// Welcher Gürtel-Platz würde gegriffen? (großzügig: in Hüfthöhe nahe am Gürtel zählt immer Munition)
function beltSlotFor(h) {
  let best = null, bd = Infinity;
  for (const s of beltSlots) {
    if (!s.available) continue;
    const d = s.obj.getWorldPosition(tmpV).distanceTo(h.point);
    if (d < s.radius && d < bd) { bd = d; best = s; }
  }
  if (best) return best;
  const armed = heldWeapon(otherHand(h));
  const dy = Math.abs(h.point.y - belt.position.y);
  const dr = Math.hypot(h.point.x - belt.position.x, h.point.z - belt.position.z);
  if (armed && dy < 0.22 && dr < BELT_R + 0.25) {
    for (const s of beltSlots) {
      if (!s.available || s.kind === 'knife' || s.kind === 'grenade') continue;
      const d = s.obj.getWorldPosition(tmpV).distanceTo(h.point);
      if (d < bd) { bd = d; best = s; }
    }
  }
  return best;
}
function tryBeltGrab(h) {
  const best = beltSlotFor(h);
  if (!best) return false;
  best.available = false;
  best.obj.visible = false;
  best.refill = best.kind === 'knife' ? 2 : best.kind === 'grenade' ? 3 : 1.2;
  if (best.kind === 'knife') holdItem(h, 'knife', makeKnife());
  else if (best.kind === 'grenade') holdItem(h, 'grenade', makeGrenade(), { slot: best });
  else if (best.kind === 'mag') holdItem(h, 'mag', makeMag(beltWeaponId), { weaponId: beltWeaponId, rounds: WEAPON_DEFS[beltWeaponId].capacity });
  else { const round = WEAPON_DEFS[beltWeaponId].ammo === 'round'; const o = round ? makeCartridge(true) : makeShell(); if (round) o.scale.setScalar(1.4); holdItem(h, 'shell', o); }
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
  const cands = zombieHeads();
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
    const cands = [...zombieHitMeshes(), ...roomOccluders(), ...(startButton.visible ? startButton.userData.hit : [])];
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
  if (hit.object.userData.zombie) handleZombieHit(damageZombie(hit.object, hit.point, dir, DAMAGE.knife), hit.point, '🔪 ');
}

// =============================================================================
// Power-ups (fallen selten von Zombies): berühren zum Einsammeln
// =============================================================================
const POWERUPS = {
  double: { icon: '×2', name: 'Doppelte Punkte', color: '#ffd21f' },
  nuke: { icon: '☢', name: 'Atombombe', color: '#7dff4a' },
  ammo: { icon: '▮▮', name: 'Volle Munition', color: '#4ac8ff' },
  slowmo: { icon: '⏳', name: 'Zeitlupe', color: '#c48aff' }
};
const powerTex = {};
for (const [id, pu] of Object.entries(POWERUPS)) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 62);
  g.addColorStop(0, pu.color); g.addColorStop(0.7, pu.color + 'aa'); g.addColorStop(1, pu.color + '00');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(64, 64, 62, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 6; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(64, 64, 44, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#111'; ctx.font = 'bold 46px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(pu.icon, 64, 68);
  powerTex[id] = new THREE.CanvasTexture(c);
  powerTex[id].colorSpace = THREE.SRGBColorSpace;
}
const powerups = [];
const active = { double: 0, slowmo: 0 };
function spawnPowerup(pos, type) {
  type = type || Object.keys(POWERUPS)[Math.floor(Math.random() * 4)];
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: powerTex[type], toneMapped: false, transparent: true, depthWrite: false }));
  sp.scale.setScalar(0.32);
  sp.position.set(pos.x, 1.05, pos.z);
  scene.add(sp);
  powerups.push({ obj: sp, type, t: 0 });
  SFX.bonus();
}
function updatePowerups(dt) {
  for (const k of Object.keys(active)) if (active[k] > 0) { active[k] -= dt; if (active[k] <= 0) { active[k] = 0; boardDirty = true; } }
  for (let i = powerups.length - 1; i >= 0; i--) {
    const pu = powerups[i];
    pu.t += dt;
    pu.obj.position.y = 1.05 + Math.sin(pu.t * 2.5) * 0.06;
    pu.obj.material.rotation += dt;
    pu.obj.visible = pu.t < 16 || Math.floor(pu.t * 8) % 2 === 0;
    let take = false;
    if (renderer.xr.isPresenting) take = hands.some(h => h.src && h.point.distanceTo(pu.obj.position) < 0.3);
    else take = Math.hypot(camera.position.x - pu.obj.position.x, camera.position.z - pu.obj.position.z) < 1.0;
    if (take) collectPowerup(pu);
    else if (pu.t > 20) { scene.remove(pu.obj); pu.obj.material.dispose(); powerups.splice(i, 1); }
  }
}
function collectPowerup(pu) {
  scene.remove(pu.obj);
  pu.obj.material.dispose();
  powerups.splice(powerups.indexOf(pu), 1);
  const P = POWERUPS[pu.type];
  speak(P.name);
  SFX.jingle([659, 880, 1175]);
  for (const h of hands) pulse(h, 0.8, 120);
  floatingText(P.name + '!', pu.obj.position.clone(), P.color);
  if (pu.type === 'double') active.double = 20;
  if (pu.type === 'slowmo') active.slowmo = 10;
  if (pu.type === 'ammo') { for (const w of arsenal) refillWeapon(w); refillGrenades(); }
  if (pu.type === 'nuke') {
    nukeFlash = 1;
    SFX.explosion();
    for (const r of killAll(headPos)) handleZombieHit(r, r.zombie.skull.getWorldPosition(new THREE.Vector3()), '☢ ');
  }
  boardDirty = true;
}
let nukeFlash = 0;
const nukeMesh = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, depthWrite: false, toneMapped: false }));
nukeMesh.renderOrder = 2001;
nukeMesh.visible = false;
camera.add(nukeMesh);
// Stimmung: flackerndes Notlicht im Flur, Blitze + Donner draußen vor den Fenstern
let flickerT = 0, doorK = 0.2, lightningT = 8, lightningSeq = 0, windowK = 0;
function updateAtmosphere(dt) {
  flickerT -= dt;
  if (flickerT <= 0) { flickerT = Math.random() * 0.15; doorK = Math.random() < 0.12 ? 0 : 0.25 + Math.random() * 0.5; }
  if (openings().some(o => o.type === 'window')) {
    lightningT -= dt;
    if (lightningT <= 0) { lightningT = THREE.MathUtils.randFloat(12, 28); lightningSeq = 0.6; later(THREE.MathUtils.randFloat(0.6, 2.2), () => SFX.thunder()); }
  }
  if (lightningSeq > 0) { lightningSeq -= dt; windowK = Math.sin(lightningSeq * 40) > 0.3 ? 1 : 0.15; } else windowK = 0;
  setAtmosphere(doorK, windowK);
}
// Riese stampft: Controller vibrieren je nach Entfernung
function onGiantStomp(z, big) {
  const d = headPos.distanceTo(z.root.position);
  const k = Math.max(0, 1 - d / (big ? 8 : 5));
  if (k > 0) for (const h of hands) pulse(h, k * (big ? 1 : 0.4), big ? 250 : 60);
}

// =============================================================================
// Plasmakugeln (Wunderwaffe): fliegende Geschosse mit Flächenschaden
// =============================================================================
const plasmaGeo = new THREE.SphereGeometry(0.035, 12, 8);
const plasmaMat = new THREE.MeshBasicMaterial({ color: 0x7dff9a, toneMapped: false });
const plasmas = [];
function launchPlasma(pos, dir, dmg) {
  const m = new THREE.Mesh(plasmaGeo, plasmaMat);
  m.position.copy(pos);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffSpriteTex(), color: 0x55ff88, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
  glow.scale.setScalar(0.25);
  m.add(glow);
  scene.add(m);
  plasmas.push({ obj: m, vel: dir.multiplyScalar(22), life: 2.5, dmg });
  if (audioReady()) SFX.click(5200, 0.25, 0.08);
}
let _puffTex = null;
function puffSpriteTex() {
  if (_puffTex) return _puffTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  _puffTex = new THREE.CanvasTexture(c);
  return _puffTex;
}
const audioReady = () => true;
function updatePlasmas(dt) {
  for (let i = plasmas.length - 1; i >= 0; i--) {
    const p = plasmas[i];
    p.life -= dt;
    const step = p.vel.clone().multiplyScalar(dt);
    raycaster.set(p.obj.position, step.clone().normalize());
    raycaster.far = step.length() + 0.04;
    const hit = raycaster.intersectObjects([...zombieHitMeshes(), ...roomOccluders(), ...plankMeshes()], false)[0];
    const floorHitNow = p.obj.position.y + step.y < 0.02;
    if (hit || floorHitNow || p.life <= 0) {
      const at = hit ? hit.point : p.obj.position.clone();
      p.obj.material?.dispose?.call && null;
      p.obj.children[0].material.dispose();
      scene.remove(p.obj);
      plasmas.splice(i, 1);
      // Plasma-Explosion: grünes Licht, Druckwelle, Flächenschaden (trifft den Spieler nicht)
      burst(at, 0x66ff88, 22);
      shockwave(at);
      flashLight.position.copy(at); flashLight.distance = 5; flashLight.intensity = 14;
      SFX.click(900, 0.6, 0.2);
      if (hit && hit.object.userData.zombie) handleZombieHit(damageZombie(hit.object, hit.point, p.vel.clone().normalize(), p.dmg), hit.point, '⚡ ');
      for (const r of explosionDamage(at, 2.4, p.dmg * 0.8)) handleZombieHit(r, r.pos.clone().setY(1.2), '⚡ ');
      continue;
    }
    p.obj.position.add(step);
  }
}

// =============================================================================
// Punkte als Währung
// =============================================================================
const START_POINTS = 500;
let points = 0;
const free = () => gameMode === 'training';
function award(n) { score += n; points += n; boardDirty = true; }
function spend(price, where) {
  if (free() || points >= price) {
    if (!free()) points -= price;
    boardDirty = true;
    if (audioCtxOk()) { SFX.jingle([988, 1319], 0.12); SFX.click(3000, 0.3, 0.05); }
    return true;
  }
  SFX.buzz();
  floatingText(`Zu wenig Punkte (${price})`, where, '#ff7070');
  return false;
}
const audioCtxOk = () => true;
const ownedWeapon = (id) => arsenal.find(w => w.id === id && (w.holder >= 0 || w.holstered || w === deskW));
// gekaufte Waffe in die Hand (VR) bzw. vor die Kamera (PC) geben
function giveWeapon(id, h) {
  const w = spawnWeapon(id);
  if (h) takeWeapon(w, h); else equipDesk(w);
  return w;
}
// nicht mehr benutzte gekaufte Waffen verschwinden nach einer Weile
function updateWeaponExpiry() {
  for (const w of [...arsenal]) {
    if (w.starter || w.holder >= 0 || w === deskW || w.holstered) continue;
    if (elapsed - w.lastTouch > 40) { burst(w.root.position.clone(), 0xaaaaaa, 10); disposeWeapon(w); }
  }
  // höchstens 8 Waffen gleichzeitig
  const loose = arsenal.filter(w => !w.starter && w.holder < 0 && w !== deskW && !w.holstered);
  while (arsenal.length > 8 && loose.length) disposeWeapon(loose.shift());
}

// =============================================================================
// Wandkäufe: an markierten Wandstellen hängt jede Runde eine zufällige Waffe zum Kaufen
// =============================================================================
const wallbuys = [];
const boardMat = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.9 });
const chalkMat = new THREE.MeshBasicMaterial({ color: 0xffd36a, toneMapped: false });
function clearWallbuys() {
  for (const wb of wallbuys.splice(0)) { scene.remove(wb.group); wb.glow.material.dispose(); wb.label.mesh.material.map.dispose(); wb.label.mesh.material.dispose(); wb.label.mesh.geometry.dispose(); }
}
// Wandkauf-Plätze: selbst gesetzte – sonst automatisch an freien Wandstellen (bzw. frei stehend um den Spieler)
function autoWallbuySpots() {
  const own = surfacesOf('wallbuy');
  if (own.length) return own;
  const spots = [];
  const ops = surfacesOf('door', 'window');
  const walls = surfacesOf('wall').filter(w => w.width > 1.3).sort(() => Math.random() - 0.5);
  for (const w of walls) {
    for (let k = 0; k < 6 && spots.length < 3; k++) {
      const u = THREE.MathUtils.randFloat(0.65, w.width - 0.65);
      const pos = w.a.clone().addScaledVector(w.right, u).setY(1.35);
      if (ops.some(o => Math.hypot(o.mid.x - pos.x, o.mid.z - pos.z) < o.width / 2 + 0.75)) continue;
      if (spots.some(o => o.pos.distanceTo(pos) < 1.2)) continue;
      spots.push({ pos, normal: w.normal.clone() });
      break;
    }
    if (spots.length >= 3) break;
  }
  if (!spots.length) { // keine Wände: frei stehende Tafeln im Kreis um den Spieler
    for (const a of [Math.PI * 0.5, Math.PI, -Math.PI * 0.5]) {
      const pos = inFront(1.8, a, 1.35);
      spots.push({ pos, normal: headPos.clone().setY(1.35).sub(pos).setY(0).normalize() });
    }
  }
  return spots;
}
function setupWallbuys() {
  clearWallbuys();
  const pool = WEAPON_ORDER.filter(id => !WEAPON_DEFS[id].boxOnly && id !== 'pistol');
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  autoWallbuySpots().forEach((s, i) => {
    const id = pool[i % pool.length];
    const def = WEAPON_DEFS[id];
    const g = new THREE.Group();
    g.position.copy(s.pos).addScaledVector(s.normal, 0.015);
    g.lookAt(g.position.clone().add(s.normal));
    const back = new THREE.Mesh(cachedGeo('wbboard', () => new THREE.PlaneGeometry(0.95, 0.5)), boardMat);
    g.add(back);
    // Kreide-Umriss
    for (const [w, h, x, y] of [[0.92, 0.012, 0, 0.235], [0.92, 0.012, 0, -0.235], [0.012, 0.47, 0.46, 0], [0.012, 0.47, -0.46, 0]]) {
      const l = new THREE.Mesh(cachedGeo(`chalk${w}${h}`, () => new THREE.PlaneGeometry(w, h)), chalkMat);
      l.position.set(x, y, 0.002);
      g.add(l);
    }
    const disp = buildWeapon(id);
    disp.root.rotation.y = -Math.PI / 2;
    disp.root.scale.setScalar(Math.min(0.85, 0.75 / Math.max(0.3, disp.localBox.max.z - disp.localBox.min.z)));
    const holder = new THREE.Group();
    holder.add(disp.root);
    holder.updateMatrixWorld(true);
    const c = new THREE.Box3().setFromObject(disp.root).getCenter(new THREE.Vector3());
    disp.root.position.sub(c);
    holder.position.set(0, 0.04, 0.07);
    g.add(holder);
    const label = makePanel(0.9, 0.12, 700);
    label.draw((ctx, w, h) => {
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, w, h);
      text(ctx, def.name, 14, h * 0.32, 30, '#ffe7a8', 'left', true);
      text(ctx, `💰 ${def.price}  ·  Munition ${Math.round(def.price / 2)}`, 14, h * 0.75, 26, '#ffd21f', 'left', true);
    });
    label.mesh.position.set(0, -0.2, 0.01);
    g.add(label.mesh);
    scene.add(g);
    const glow = new THREE.Mesh(cachedGeo('wbglow', () => new THREE.PlaneGeometry(1.25, 0.75)), new THREE.MeshBasicMaterial({ map: wbGlowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    glow.position.z = -0.004;
    g.add(glow);
    castShadows(holder);
    wallbuys.push({ s, id, def, group: g, holder, label, glow, phase: Math.random() * 6 });
  });
}
// leuchtender Rahmen: gelb = genug Punkte, rot = zu teuer
const wbGlowTex = (() => {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 64, 10, 128, 64, 128);
  g.addColorStop(0, 'rgba(255,255,255,0.0)'); g.addColorStop(0.55, 'rgba(255,255,255,0.15)'); g.addColorStop(0.8, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 128);
  return new THREE.CanvasTexture(c);
})();
function updateWallbuys() {
  for (const wb of wallbuys) {
    const own = ownedWeapon(wb.id);
    const afford = free() || points >= (own ? Math.round(wb.def.price / 2) : wb.def.price);
    wb.glow.material.color.setHex(afford ? 0xffc23a : 0xff3a2a);
    wb.glow.material.opacity = (afford ? 0.55 : 0.25) + Math.sin(elapsed * 3 + wb.phase) * 0.12;
    wb.holder.rotation.y = Math.sin(elapsed * 0.8 + wb.phase) * 0.12;
  }
}
function wallbuyNear(p, maxD = 0.22) {
  let best = null, bd = maxD;
  for (const wb of wallbuys) {
    const d = new THREE.Box3().setFromObject(wb.holder).distanceToPoint(p);
    if (d < bd) { bd = d; best = wb; }
  }
  return best;
}
function tryBuy(wb, h) {
  const where = wb.group.position.clone().addScaledVector(wb.s.normal, 0.2);
  const own = ownedWeapon(wb.id);
  if (own) {
    if (!spend(Math.round(wb.def.price / 2), where)) return false;
    refillWeapon(own);
    floatingText('Munition aufgefüllt', where, '#9fe8ff');
    return true;
  }
  if (!spend(wb.def.price, where)) return false;
  giveWeapon(wb.id, h);
  floatingText(wb.def.name, where, '#ffe7a8');
  speak(wb.def.name);
  return true;
}

// =============================================================================
// Glückskiste: für 950 Punkte eine zufällige Waffe (auch die Wunderwaffe)
// =============================================================================
const BOX_PRICE = 950;
const mbox = { s: null, group: null, lid: null, beam: null, state: 'idle', t: 0, disp: null, id: null, step: 0, user: null };
const crateMat = new THREE.MeshStandardMaterial({ color: 0x4a3018, roughness: 0.8 });
const crateTrim = new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.9, roughness: 0.3 });
const qTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#4a3018'; ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 40; i++) { ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.25})`; ctx.fillRect(0, Math.random() * 128, 128, 2); }
  ctx.fillStyle = '#9fe8ff'; ctx.font = 'bold 96px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = '#39c8ff'; ctx.shadowBlur = 18; ctx.fillText('?', 64, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const qMat = new THREE.MeshStandardMaterial({ map: qTex, emissive: 0x2a7fa0, emissiveIntensity: 0.6, roughness: 0.7 });
function clearMysteryBox() {
  if (mbox.group) scene.remove(mbox.group);
  if (mbox.disp) mbox.disp = null;
  Object.assign(mbox, { s: null, group: null, lid: null, beam: null, state: 'idle', t: 0, id: null });
}
function setupMysteryBox() {
  clearMysteryBox();
  let s = surfacesOf('mbox')[0];
  if (!s) { // nicht platziert: automatisch an eine freie Stelle neben dem Spieler
    let best = 2.2, ang = 2.4;
    for (const a of [2.4, -2.4, 1.6, -1.6, Math.PI]) {
      const dir = new THREE.Vector3(-Math.sin(headYaw() + a), 0, -Math.cos(headYaw() + a));
      if (freeDistance(headPos.clone().setY(0.4), dir, 2.4) >= best) { ang = a; break; }
    }
    const c = inFront(1.5, ang, 0);
    const yaw = headYaw() + ang;
    s = makeBox('mbox', c.clone().add(new THREE.Vector3(-0.42, 0.48, -0.22).applyAxisAngle(UP, yaw)), c.clone().add(new THREE.Vector3(0.42, 0.48, 0.22).applyAxisAngle(UP, yaw)), yaw);
  }
  mbox.s = s;
  const g = new THREE.Group();
  g.position.set(s.center.x, 0, s.center.z);
  g.rotation.y = s.yaw;
  const W = s.hx * 2, D = s.hz * 2, H = s.height;
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H - 0.06, D), [crateMat, crateMat, crateMat, crateMat, qMat, qMat]);
  body.position.y = (H - 0.06) / 2;
  g.add(body);
  for (const x of [-W / 2, W / 2]) for (const z of [-D / 2, D / 2]) { const e = new THREE.Mesh(cachedGeo('crateEdge', () => new THREE.BoxGeometry(0.04, 1, 0.04)), crateTrim); e.scale.y = H - 0.06; e.position.set(x, (H - 0.06) / 2, z); g.add(e); }
  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, H - 0.06, -D / 2);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(W + 0.02, 0.06, D + 0.02), crateMat);
  lid.position.set(0, 0.03, D / 2);
  lidPivot.add(lid);
  g.add(lidPivot);
  // Lichtstrahl nach oben
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.22, 3, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0x6fd8ff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  beam.position.y = H + 1.5;
  g.add(beam);
  const glow = new THREE.PointLight(0x6fd8ff, 1.2, 2.5);
  glow.position.y = H + 0.3;
  g.add(glow);
  castShadows(g);
  scene.add(g);
  Object.assign(mbox, { group: g, lid: lidPivot, beam, glow, top: new THREE.Vector3(s.center.x, H, s.center.z) });
}
function boxPool() {
  const held = new Set(arsenal.filter(w => w.holder >= 0 || w.holstered || w === deskW).map(w => w.id));
  const ids = WEAPON_ORDER.filter(id => id !== 'pistol' && !held.has(id));
  const weights = ids.map(id => (id === 'plasma' ? 0.5 : WEAPON_DEFS[id].tier >= 3 ? 0.8 : 1));
  return { ids, weights };
}
function setBoxDisplay(id) {
  if (mbox.disp) mbox.group.remove(mbox.disp.holder);
  const disp = buildWeapon(id);
  disp.root.scale.setScalar(Math.min(0.8, 0.7 / Math.max(0.3, disp.localBox.max.z - disp.localBox.min.z)));
  const holder = new THREE.Group();
  holder.add(disp.root);
  disp.root.rotation.y = Math.PI / 2;
  holder.position.set(0, mbox.s.height + 0.05, 0);
  mbox.group.add(holder);
  mbox.disp = { root: disp.root, holder };
  mbox.id = id;
}
function useBox(h) {
  if (!mbox.group) return false;
  const where = mbox.top.clone().add(new THREE.Vector3(0, 0.5, 0));
  if (mbox.state === 'offer') { // gezogene Waffe nehmen
    mbox.group.remove(mbox.disp.holder);
    mbox.disp = null;
    giveWeapon(mbox.id, h);
    mbox.state = 'close';
    mbox.t = 0;
    return true;
  }
  if (mbox.state !== 'idle') return false;
  if (boxPool().ids.length === 0 || !spend(BOX_PRICE, where)) return false;
  mbox.state = 'spin';
  mbox.t = 0;
  mbox.step = 0;
  SFX.jingle([523, 659, 784, 1047, 784, 659], 0.18);
  return true;
}
function updateMysteryBox(dt) {
  if (!mbox.group) return;
  mbox.t += dt;
  mbox.beam.material.opacity = 0.12 + Math.sin(elapsed * 3) * 0.05 + (mbox.state === 'spin' ? 0.15 : 0);
  mbox.beam.rotation.y += dt;
  const openK = mbox.state === 'idle' ? 0 : mbox.state === 'close' ? Math.max(0, 1 - mbox.t * 2) : Math.min(1, mbox.t * 3);
  mbox.lid.rotation.x = -1.9 * openK;
  if (mbox.state === 'spin') {
    // Waffen wechseln immer langsamer, die Anzeige steigt aus der Kiste
    const interval = 0.07 + mbox.t * 0.08;
    mbox.step -= dt;
    if (mbox.step <= 0) {
      mbox.step = interval;
      const { ids } = boxPool();
      setBoxDisplay(ids[Math.floor(Math.random() * ids.length)]);
      SFX.click(1200 + mbox.t * 300, 0.2, 0.03);
    }
    if (mbox.disp) { mbox.disp.holder.position.y = mbox.s.height + 0.05 + Math.min(1, mbox.t / 4) * 0.35; mbox.disp.holder.rotation.y += dt * 2; }
    if (mbox.t > 4.2) {
      const { ids, weights } = boxPool();
      let r = Math.random() * weights.reduce((a, b) => a + b, 0), pick = ids[0];
      for (let i = 0; i < ids.length; i++) { r -= weights[i]; if (r <= 0) { pick = ids[i]; break; } }
      setBoxDisplay(pick);
      mbox.disp.holder.position.y = mbox.s.height + 0.4;
      mbox.state = 'offer';
      mbox.t = 0;
      SFX.bonus();
      floatingText(WEAPON_DEFS[pick].name, mbox.top.clone().add(new THREE.Vector3(0, 0.8, 0)), pick === 'plasma' ? '#7dff9a' : '#9fe8ff');
      speak(WEAPON_DEFS[pick].name);
    }
  } else if (mbox.state === 'offer') {
    if (mbox.disp) { mbox.disp.holder.rotation.y += dt * 0.8; mbox.disp.holder.position.y = mbox.s.height + 0.4 + Math.sin(elapsed * 2) * 0.03; }
    if (mbox.t > 12) { if (mbox.disp) mbox.group.remove(mbox.disp.holder); mbox.disp = null; mbox.state = 'close'; mbox.t = 0; }
  } else if (mbox.state === 'close' && mbox.t > 0.6) mbox.state = 'idle';
}
function boxNear(p) {
  if (!mbox.group) return false;
  if (mbox.state === 'offer' && mbox.disp) return new THREE.Box3().setFromObject(mbox.disp.holder).distanceToPoint(p) < 0.18;
  return p.distanceTo(mbox.top) < 0.45;
}

// =============================================================================
// Bretter annageln: Brett vom Stapel an eine Tür/ein Fenster halten und loslassen
// =============================================================================
const ghostPlank = new THREE.Mesh(new THREE.BoxGeometry(1, 0.13, 0.03), new THREE.MeshBasicMaterial({ color: 0x66ff88, transparent: true, opacity: 0.35, depthWrite: false }));
ghostPlank.visible = false;
scene.add(ghostPlank);
function plankTarget(pos) {
  let best = null, bd = 0.6;
  for (const o of openings()) {
    if (missingPlanks(o) <= 0) continue;
    const slot = plankSlot(o, o.planks.length);
    const d = pos.distanceTo(slot.pos);
    if (d < bd) { bd = d; best = { o, slot, d }; }
  }
  return best;
}
function updatePlankGhost() {
  ghostPlank.visible = false;
  for (const h of hands) {
    if (!h.held || h.held.type !== 'plank') continue;
    const t = plankTarget(h.held.obj.getWorldPosition(tmpV));
    if (!t) continue;
    ghostPlank.visible = true;
    ghostPlank.position.copy(t.slot.pos);
    ghostPlank.quaternion.copy(t.slot.quat);
    ghostPlank.scale.set(t.o.width + 0.18, 1, 1);
    ghostPlank.material.color.set(t.d < 0.45 ? 0x66ff88 : 0xffcc33);
  }
}
function nailPlank(h) {
  const obj = h.held.obj;
  const t = plankTarget(obj.getWorldPosition(tmpV));
  if (!t || t.d >= 0.45) return false;
  h.ray.remove(obj);
  h.held = null;
  addPlank(t.o);
  // drei Hammerschläge
  for (let i = 0; i < 3; i++) later(i * 0.14, () => { SFX.thunk(); pulse(h, 0.6, 30); });
  if (inRound()) award(10);
  floatingText('🔨 +10', t.slot.pos.clone().addScaledVector(t.o.normal, 0.1), '#ffd28a');
  return true;
}

// =============================================================================
// Handgranaten
// =============================================================================
const grenades = [];
function throwGrenade(h) {
  const held = h.held;
  const g = held.obj;
  h.held = null;
  g.updateWorldMatrix(true, false);
  g.matrixWorld.decompose(g.position, g.quaternion, tmpS);
  h.ray.remove(g);
  scene.add(g);
  const v = h.vel.clone();
  // langsam am Gürtel losgelassen: zurückstecken (nicht scharf)
  if (v.length() < 1.2 && held.slot && g.position.distanceTo(held.slot.obj.getWorldPosition(tmpV)) < 0.2) {
    scene.remove(g);
    held.slot.available = true;
    held.slot.obj.visible = true;
    SFX.click(900, 0.3, 0.05);
    return;
  }
  launchGrenade(g, v.multiplyScalar(1.4), h.angVel.clone());
}
function launchGrenade(g, vel, angVel) {
  if (g.userData.ring) g.userData.ring.visible = false; // Stift gezogen
  SFX.pin();
  const phys = addDynamic(g, localBoxOf(g), 0.45, { vel, angVel, onImpact: (v) => SFX.click(700, Math.min(0.4, v * 0.1), 0.05) });
  grenades.push({ obj: g, phys, fuse: 2.6, tick: 0 });
}
function updateGrenades(dt) {
  for (let i = grenades.length - 1; i >= 0; i--) {
    const gr = grenades[i];
    gr.fuse -= dt;
    gr.tick -= dt;
    if (gr.fuse < 1.2 && gr.tick <= 0) { gr.tick = 0.25; SFX.tick(); }
    if (gr.fuse <= 0) { grenades.splice(i, 1); explode(gr); }
  }
}
function explode(gr) {
  const pos = gr.obj.position.clone();
  removeDynamic(gr.phys);
  scene.remove(gr.obj);
  SFX.explosion();
  flashLight.position.copy(pos);
  flashLight.distance = 9;
  flashLight.intensity = 40;
  burst(pos, 0xffb030, 30);
  burst(pos, 0x4a4542, 24);
  shockwave(pos);
  if (pos.y < 0.6) floorDecal(pos, 'scorch', 1.4);
  for (const r of explosionDamage(pos, 4.2, 260)) handleZombieHit(r, r.zombie.skull.getWorldPosition(new THREE.Vector3()), '💥 ');
  // Druckwelle schleudert lose Gegenstände weg
  for (const e of dynamics) {
    const d = e.obj.position.distanceTo(pos);
    if (d > 3.5 || d < 0.01) continue;
    const dir = e.obj.position.clone().sub(pos).normalize().add(new THREE.Vector3(0, 0.6, 0)).normalize();
    applyImpulse(e, dir.multiplyScalar(e.body.mass * 7 * (1 - d / 3.5)), e.obj.position);
  }
  const pd = headPos.distanceTo(pos);
  for (const h of hands) pulse(h, Math.max(0.3, 1 - pd / 6), 350);
  if (pd < 3.5 && gameMode !== 'training') { playerHit(50 * (1 - pd / 3.5)); if (pd < 2) speak('Vorsicht mit den Granaten!'); }
}

// =============================================================================
// Messer-Nahkampf: mit dem Messer in der Hand zustechen
// =============================================================================
function knifeMelee(h, dt) {
  h.meleeT = Math.max(0, (h.meleeT || 0) - dt);
  const tip = h.held.obj.localToWorld(new THREE.Vector3(0, 0, -0.17));
  const prev = h.prevTip;
  h.prevTip = tip;
  if (!prev || h.meleeT > 0 || h.vel.length() < 0.9) return;
  const seg = tip.clone().sub(prev);
  const len = seg.length();
  if (len < 0.004) return;
  raycaster.set(prev, seg.normalize());
  raycaster.far = len + 0.05;
  const hit = raycaster.intersectObjects(zombieHitMeshes(), false)[0];
  if (!hit) return;
  const dmg = 35 + Math.min(45, h.vel.length() * 12);
  handleZombieHit(damageZombie(hit.object, hit.point, seg, dmg), hit.point, '🔪 ');
  SFX.thunk();
  pulse(h, 1, 70);
  h.meleeT = 0.35;
}

// =============================================================================
// Erste-Hilfe-Kästen (fallen manchmal von erledigten Zombies) – berühren zum Heilen
// =============================================================================
const medTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f2f2ee'; ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#d61f1f'; ctx.fillRect(26, 12, 12, 40); ctx.fillRect(12, 26, 40, 12);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const medMat = new THREE.MeshStandardMaterial({ map: medTex, roughness: 0.5, emissive: 0x331111 });
const medkits = [];
function spawnMedkit(pos) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(cachedGeo('medkit', () => new THREE.BoxGeometry(0.2, 0.14, 0.08)), medMat));
  const handle = new THREE.Mesh(cachedGeo('medhandle', () => new THREE.BoxGeometry(0.08, 0.02, 0.02)), MAT.black);
  handle.position.y = 0.08;
  g.add(handle);
  g.position.set(pos.x, 0.95, pos.z);
  scene.add(g);
  medkits.push({ obj: g, t: 0, base: 0.95 });
}
function updateMedkits(dt) {
  for (let i = medkits.length - 1; i >= 0; i--) {
    const m = medkits[i];
    m.t += dt;
    m.obj.rotation.y += dt * 1.5;
    m.obj.position.y = m.base + Math.sin(m.t * 2.2) * 0.05;
    m.obj.visible = m.t < 25 || Math.floor(m.t * 8) % 2 === 0;
    let take = false;
    if (renderer.xr.isPresenting) take = hands.some(h => h.src && h.point.distanceTo(m.obj.position) < 0.25);
    else take = Math.hypot(camera.position.x - m.obj.position.x, camera.position.z - m.obj.position.z) < 1.0;
    if (take) collectMedkit(m);
    else if (m.t > 30) { scene.remove(m.obj); medkits.splice(i, 1); }
  }
}
function collectMedkit(m) {
  scene.remove(m.obj);
  medkits.splice(medkits.indexOf(m), 1);
  playerHp = Math.min(100, playerHp + 35);
  lowHpWarned = playerHp < 30;
  SFX.bonus();
  floatingText('+35 ❤', m.obj.position.clone(), '#7dff7d');
  for (const h of hands) pulse(h, 0.6, 80);
  speak('Geheilt');
  boardDirty = true;
}

// =============================================================================
// Ansager (Sprachausgabe), Schwierigkeitsgrad, Bestenliste
// =============================================================================
const load = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignorieren */ } };
let voiceOn = load('vrspiel-ansager', true);
// Bedienung: Griff halten/umschalten, Nachladen realistisch/einfach, Zielhilfe
const settings = { grip: load('vrspiel-griff', 'hold'), reload: load('vrspiel-nachladen', 'real'), assist: load('vrspiel-zielhilfe', true) };
function setSetting(k, v, key) { settings[k] = v; store(key, v); refreshMenu(); }
function speak(textStr) {
  if (!voiceOn || !window.speechSynthesis) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(textStr);
    u.lang = 'de-DE'; u.rate = 0.95; u.pitch = 0.6;
    const v = speechSynthesis.getVoices().find(x => x.lang && x.lang.startsWith('de'));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch { /* keine Sprachausgabe */ }
}
const DIFFS = {
  easy: { label: 'Leicht', hp: 0.8, speed: 0.85, dmg: 0.6, count: 0.8 },
  normal: { label: 'Normal', hp: 1, speed: 1, dmg: 1, count: 1 },
  hard: { label: 'Schwer', hp: 1.25, speed: 1.15, dmg: 1.4, count: 1.3 }
};
let diffKey = load('vrspiel-schwierigkeit', 'normal');
if (!DIFFS[diffKey]) diffKey = 'normal';
let lowHpWarned = false, bruteWarned = false, pendingDeath = false, bossPending = false;
let streak = 0, lastKillT = -10, streakMsg = null, lastBreakSec = 0;
function topList(mode) { return load('vrspiel-top-' + mode, []); }
function addTop(mode, entry) {
  const list = topList(mode);
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  store('vrspiel-top-' + mode, list.slice(0, 5));
  return list.indexOf(entry);
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
  if (w.def.action !== 'pump' && w.def.action !== 'none') opts.push({ type: 'charger', d: p.distanceTo(w.sockets.chargerGrab.getWorldPosition(tmpV)) / 0.09 });
  if (w.sockets.foregrip) opts.push({ type: 'fore', d: p.distanceTo(w.sockets.foregrip.getWorldPosition(tmpV)) / 0.2 });
  opts.push({ type: 'swap', d: p.distanceTo(w.root.getWorldPosition(tmpV)) / 0.05 });
  opts.sort((a, b) => a.d - b.d);
  if (opts[0].d > 1) {
    // Hand irgendwo vorne an einer Langwaffe: als Vorderschaft-Griff werten
    if (!w.sockets.foregrip) return false;
    const local = w.root.worldToLocal(p.clone());
    const fl = w.root.worldToLocal(w.sockets.foregrip.getWorldPosition(tmpV));
    if (!(local.z < 0.02 && local.z > fl.z - 0.25 && Math.hypot(local.x, local.y - fl.y) < 0.15)) return false;
    opts[0] = { type: 'fore' };
  }
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
  if (held.type === 'grenade') { throwGrenade(h); return; }
  if (held.type === 'plank' && nailPlank(h)) return;
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
  // Menüs zählen nur, wenn ein Knopf getroffen wird – sonst geht der Laser durch (z. B. zur Wand dahinter)
  for (const ph of raycaster.intersectObjects(uiPanels.filter(p => p.mesh.visible).map(p => p.mesh), false)) {
    if (ph.object.userData.ui.buttonAt(ph.uv)) { best = { kind: 'ui', dist: ph.distance, panel: ph.object.userData.ui, uv: ph.uv }; break; }
  }
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
    if (free && !(setup.drag && setup.drag.src === h) && !(state === 'playing' && heldWeapon(otherHand(h)))) pt = pointerTarget(h);
    let len = pt ? pt.dist : 2;
    let showPtr = free && (pt || state !== 'playing');
    if (state === 'setup' && free && !pt && setup.tool && setup.tool !== 'floor') {
      if (setup.tool === 'door' || setup.tool === 'window' || setup.tool === 'wallbuy') {
        const wh = setup.drag && setup.drag.src === h ? wallHit(rayOf(h), setup.drag.wall) : wallHit(rayOf(h));
        len = wh ? wh.point.distanceTo(h.tip) : 4;
      } else {
        const fh = floorHit(rayOf(h));
        len = fh ? fh.distanceTo(h.tip) : 4;
      }
    }
    h.pointer.visible = !!showPtr;
    h.pointer.scale.z = len;
    const hover = pt && pt.kind === 'ui' ? pt.panel.buttonAt(pt.uv) : null;
    if (h.uiHover !== hover) { if (h.uiHover) h.uiHover.panel.setHover(null); h.uiHover = hover; if (hover) { hover.panel.setHover(hover); pulse(h, 0.1, 10); } }

    // Gürtel-Platz in Reichweite hervorheben (größer + kurzes Vibrieren)
    const near = free ? beltSlotFor(h) : null;
    if (near !== h.beltHover) {
      if (h.beltHover && !hands.some(o => o !== h && o.beltHover === h.beltHover)) h.beltHover.obj.scale.setScalar(1);
      if (near) { near.obj.scale.setScalar(1.3); pulse(h, 0.25, 20); }
      h.beltHover = near;
    }

    // Griff-Taste: greifen
    if (down(h, 'squeeze') && !free && settings.grip === 'toggle' && h.held && h.held.type === 'weapon' && !h.grab) releaseHand(h); // Umschalten: nochmal drücken = loslassen
    else if (down(h, 'squeeze') && free) {
      if (tryWeaponGrab(h)) { /* zweite Hand an der Waffe */ }
      else if (tryBeltGrab(h)) { /* vom Gürtel */ }
      else if (h.point.distanceTo(plankPilePos) < 0.35) holdItem(h, 'plank', makePlankMesh(1.0)); // Brett vom Stapel
      else if (holster && inHolsterZone(h.point)) takeWeapon(holster, h); // aus dem Rückenholster
      else if (boxNear(h.point)) useBox(h); // Glückskiste
      else if (wallbuyNear(h.point)) tryBuy(wallbuyNear(h.point), h); // Wandkauf
      else {
        const c = grabCandidates(h)[0];
        if (c) pickCandidate(h, c);
        // aus der Ferne heranziehen – nicht, wenn die andere Hand eine Waffe hält (dann will man nachladen/greifen)
        else if (pt && pt.kind !== 'ui' && !heldWeapon(otherHand(h)) && pt.dist > 0.4) h.pull = pt;
      }
    }
    if (h.pull) {
      const o = h.pull.kind === 'weapon' ? h.pull.w.root : h.pull.kind === 'mag' ? h.pull.obj : h.pull.k.obj;
      const ph = h.pull.kind === 'weapon' ? h.pull.w.phys : h.pull.kind === 'mag' ? h.pull.obj.userData.phys : null;
      if (ph) { ph.body.wakeUp(); ph.body.velocity.set(0, 0, 0); ph.body.position.x += (h.point.x - o.position.x) * Math.min(1, dt * 10); ph.body.position.y += (h.point.y - o.position.y) * Math.min(1, dt * 10); ph.body.position.z += (h.point.z - o.position.z) * Math.min(1, dt * 10); }
      else o.position.lerp(h.point, Math.min(1, dt * 10));
      if (o.position.distanceTo(h.point) < 0.2) { const c = h.pull; h.pull = null; pickCandidate(h, c); }
    }
    if (up(h, 'squeeze') && !(settings.grip === 'toggle' && h.held && h.held.type === 'weapon')) releaseHand(h);

    // Abzug: UI klicken bzw. Raum-Werkzeug
    if (free && down(h, 'trigger')) {
      if (hover) { hover.onClick(); SFX.ui(); pulse(h, 0.3, 20); }
      else if (state === 'setup') setupTriggerDown(h);
    }
    if (setup.drag && setup.drag.src === h && !h.btn.trigger) setupTriggerUp();

    // Messer in der Hand: Nahkampf
    if (h.held && h.held.type === 'knife') knifeMelee(h, dt); else h.prevTip = null;
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
  // Zittern glätten: kleine Bewegungen stark, große kaum (kein Nachziehen beim schnellen Schwenken)
  if (w.smoothQ && w.smoothHand === main) {
    const ang = w.smoothQ.angleTo(w.root.quaternion);
    const k = 1 - Math.exp(-dt * (w.twoHanding || w.def.sight === 'scope' ? 14 : 22) * (1 + ang * 60));
    w.smoothQ.slerp(w.root.quaternion, k);
    w.root.quaternion.copy(w.smoothQ);
  } else { w.smoothQ = w.root.quaternion.clone(); w.smoothHand = main; }
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
    if (item.type === 'mag' && item.weaponId === w.id && !w.magInserted && itemPos.distanceTo(w.sockets.magwell.getWorldPosition(tmpV)) < 0.14) {
      off.ray.remove(item.obj);
      off.held = null;
      insertMag(w, item.rounds);
      if (w.def.action === 'none' && w.chamber !== 'live') feed(w);
      pulse(off, 0.8, 50); pulse(main, 0.5, 40);
    } else if (item.type === 'shell' && w.def.feed === 'tube' && w.tube < w.def.capacity && itemPos.distanceTo(w.sockets.loadPort.getWorldPosition(tmpV)) < 0.13) {
      off.ray.remove(item.obj);
      off.held = null;
      w.tube++;
      if (w.def.action === 'none' && w.chamber !== 'live') feed(w);
      SFX.shellIn();
      pulse(off, 0.5, 30);
      boardDirty = true;
    }
  }
  // Tasten
  const simple = settings.reload === 'simple';
  if (down(main, 'a')) { if (simple) autoReload(w); else ejectMag(w); }
  if (down(main, 'b')) { if (!toggleMode(w) && w.actionOpen) actionForward(w); pulse(main, 0.2, 20); }
  if (w.def.sight === 'scope' && Math.abs(main.stickY) > 0.3) w.zoom = THREE.MathUtils.clamp(w.zoom - main.stickY * dt * 8, 4, 12);
  // Abzug
  if (simple && w.desktopBusy) return; // gerade am automatischen Nachladen
  if (down(main, 'trigger')) {
    if (simple && w.chamber !== 'live' && mode(w) !== 'safe') { // leer: einfach automatisch nachladen/durchladen
      const ammoLeft = w.def.feed === 'mag' ? w.magInserted && w.magRounds > 0 : w.tube > 0;
      if (ammoLeft) cycleAction(w); else autoReload(w);
      SFX.dry();
    } else if (w.cooldown <= 0 && tryFire(w) && simple && !w.def.autoCycle) cycleAction(w, 0.25);
  } else if (main.btn.trigger && mode(w) === 'auto' && w.cooldown <= 0 && w.chamber === 'live') tryFire(w);
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

const setupPanel = new UIPanel(1.0, 0.84, 760);
setupPanel.border = '#3a8bff';
const menuPanel = new UIPanel(1.1, 0.95, 720);
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
const setup = { view: 'main', align: null, hoverS: null, confirm: -1, tool: null, drag: null, pending: null, last: null, msg: '', rotT: 0, planeSupport: false, importReq: false, autoImport: 0, refT: 0 };
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
  bench: ['WAFFENSTÄNDER: Mit dem Laser auf den Boden zeigen und Abzug drücken', '(ziehen = Ausrichtung). Hier stehen die Waffen zu Beginn jeder Runde.'],
  door: ['TÜR: Laser oben an eine Türecke auf der Wand, Abzug halten,', 'zur anderen Ecke ziehen, loslassen. Unten = automatisch Boden.'],
  window: ['FENSTER: Laser an eine Fensterecke auf der Wand, Abzug halten,', 'zur gegenüberliegenden Ecke ziehen, loslassen.'],
  wallbuy: ['WANDKAUF: Mit dem Laser auf eine markierte Wand zeigen und Abzug drücken.', 'Dort hängt jede Runde eine zufällige Waffe zum Kaufen.'],
  mbox: ['GLÜCKSKISTE: Laser auf den Boden, Abzug drücken (ziehen = Ausrichtung).', 'Für 950 Punkte gibt es eine zufällige Waffe – auch die Wunderwaffe.'],
  erase: ['LÖSCHEN: Mit dem Laser auf eine Fläche zeigen (wird rot),', 'Abzug = diese Fläche entfernen.'],
  align: ['AUSRICHTEN: Mit dem Laser eine Linie am Boden ENTLANG EINER ECHTEN WAND ziehen –', 'die Karte rastet daran ein. Stick ◀ ▶ drehen · ▲▼ schieben · 2. Wand = Feinschliff.'],
  floor: ['BODENHÖHE: Controller auf den Boden legen und Abzug drücken, dann mit', 'Stick ▲▼ fein einstellen, bis das Gitter genau auf dem echten Boden liegt.']
};
function refreshSetupPanel() {
  const count = (t) => surfacesOf(t).length;
  const pend = setup.pending;
  if (setup.view === 'rooms') { refreshRoomsPanel(); return; }
  setupPanel.set((ctx, w) => {
    text(ctx, '🧱 Spielbereich einrichten', w / 2, 40, 40, '#fff', 'center', true);
    const help = pend && pend.type === 'window' ? [`Laser auf die ${pend.stage === 'bottom' ? 'UNTERKANTE' : 'OBERKANTE'} des Fensters zeigen (${(pend.stage === 'bottom' ? pend.bottom : pend.top).toFixed(2)} m),`, 'Abzug = übernehmen · B/Y = abbrechen']
      : pend ? ['Mit dem Laser auf die Oberkante zeigen = Höhe (' + pend.height.toFixed(2) + ' m),', 'Abzug = übernehmen · Stick ◀ ▶ = drehen · B/Y = abbrechen']
      : setup.tool ? TOOL_HELP[setup.tool] : ['Wähle unten ein Werkzeug. Tipp: zuerst die Bodenhöhe prüfen, dann Wände,', 'Türen/Fenster, Möbel, Wandkäufe und die Glückskiste. Räume kannst du speichern.'];
    text(ctx, help[0], w / 2, 86, 20, '#cfd8e3');
    text(ctx, help[1], w / 2, 114, 20, '#cfd8e3');
    text(ctx, `Wände ${count('wall')} · Türen ${count('door')} · Fenster ${count('window')} · Tische ${count('table')} · Stühle ${count('chair')} · Wandkäufe ${count('wallbuy')} · Kiste ${count('mbox') ? '✔' : '–'} · Ständer ${count('bench') ? '✔' : '–'}`, w / 2, 150, 18, '#9ad', 'center', true);
    text(ctx, `Boden ${floorOffset >= 0 ? '+' : ''}${(floorOffset * 100).toFixed(1)} cm${setup.align ? ` · Drehung ${Math.round(THREE.MathUtils.radToDeg(setup.align.angle))}°` : ''}`, w / 2, 174, 18, '#9ad', 'center', true);
    if (setup.msg) text(ctx, setup.msg, w / 2, 204, 22, '#ffcc33', 'center', true);
    text(ctx, `Version ${VERSION}`, w - 22, 26, 16, '#6b8ab0', 'right');
  }, [
    ...row(226, 56, [
      { id: 'wall', label: '🧱 Wand', active: setup.tool === 'wall', onClick: () => setTool('wall') },
      { id: 'door', label: '🚪 Tür', active: setup.tool === 'door', onClick: () => setTool('door') },
      { id: 'window', label: '🪟 Fenster', active: setup.tool === 'window', onClick: () => setTool('window') }
    ], 760),
    ...row(290, 56, [
      { id: 'table', label: '🪑 Tisch', active: setup.tool === 'table', onClick: () => setTool('table') },
      { id: 'chair', label: '💺 Stuhl', active: setup.tool === 'chair', onClick: () => setTool('chair') },
      { id: 'bench', label: '🔫 Waffenständer', font: 26, active: setup.tool === 'bench', onClick: () => setTool('bench') }
    ], 760),
    ...row(354, 56, [
      { id: 'wallbuy', label: '💰 Wandkauf', font: 27, active: setup.tool === 'wallbuy', onClick: () => setTool('wallbuy') },
      { id: 'mbox', label: '❓ Glückskiste', font: 27, active: setup.tool === 'mbox', onClick: () => setTool('mbox') },
      { id: 'floor', label: '📏 Bodenhöhe', font: 27, active: setup.tool === 'floor', onClick: () => setTool('floor') }
    ], 760),
    ...row(418, 56, [
      { id: 'quest', label: '📡 Quest-Raum', font: 27, disabled: !setup.planeSupport, onClick: () => { endAlign(); setup.importReq = true; } },
      { id: 'rooms', label: '💾 Räume …', font: 27, onClick: () => { endAlign(); setup.tool = null; setup.view = 'rooms'; setup.confirm = -1; refreshSetupPanel(); } },
      { id: 'align', label: '🧭 Ausrichten', font: 27, disabled: !room.surfaces.length, active: setup.tool === 'align', onClick: () => setTool('align') }
    ], 760),
    ...row(482, 56, [
      { id: 'erase', label: '✂ Löschen', font: 27, active: setup.tool === 'erase', onClick: () => setTool('erase') },
      { id: 'undo', label: '↶ Rückgängig', font: 27, onClick: undoSurface },
      { id: 'clear', label: '🗑 Alles löschen', font: 27, onClick: () => { endAlign(); clearRoom(); syncBench(); setup.last = null; setup.pending = null; setup.msg = 'Alles gelöscht'; refreshSetupPanel(); } }
    ], 760),
    ...row(552, 62, [{ id: 'done', label: '✔ Fertig – los geht’s', font: 34, onClick: finishSetup }], 760, 160)
  ]);
}
// Speicherplätze für Räume
const SLOT_COUNT = 5;
function refreshRoomsPanel() {
  const slots = roomSlots();
  const btns = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const y = 132 + i * 72;
    btns.push({ id: 'ld' + i, label: '📂 Laden', font: 26, x: 400, y, w: 160, h: 56, disabled: !slots[i], onClick: () => loadSlot(i) });
    btns.push({ id: 'sv' + i, label: setup.confirm === i ? '⚠ Überschreiben?' : '💾 Speichern', font: setup.confirm === i ? 21 : 26, x: 574, y, w: 160, h: 56, disabled: !room.surfaces.length, onClick: () => saveSlot(i) });
  }
  btns.push({ id: 'auto', label: '↺ Letzten Raum laden', font: 25, x: 30, y: 498, w: 340, h: 56, disabled: !hasSavedRoom(), onClick: () => { const n = loadRoom(); afterRoomLoad(n, 'Letzter Raum'); } });
  btns.push({ id: 'back', label: '◀ Zurück', font: 28, x: 394, y: 498, w: 340, h: 56, onClick: () => { setup.view = 'main'; setup.confirm = -1; refreshSetupPanel(); } });
  setupPanel.set((ctx, w) => {
    text(ctx, '💾 Gespeicherte Räume', w / 2, 40, 40, '#fff', 'center', true);
    text(ctx, 'Nach dem Laden die Karte mit 🧭 Ausrichten an deine echten Wände anlegen.', w / 2, 88, 20, '#cfd8e3');
    for (let i = 0; i < SLOT_COUNT; i++) {
      const y = 160 + i * 72, sl = slots[i];
      text(ctx, `Raum ${i + 1}`, 40, y - 10, 26, '#fff', 'left', true);
      text(ctx, sl ? `${sl.count} Flächen · ${new Date(sl.date).toLocaleDateString('de-DE')} ${new Date(sl.date).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}` : 'leer', 40, y + 16, 18, sl ? '#9ad' : '#6b778a', 'left');
    }
    if (setup.msg) text(ctx, setup.msg, w / 2, 580, 22, '#ffcc33', 'center', true);
  }, btns);
}
function saveSlot(i) {
  if (roomSlots()[i] && setup.confirm !== i) { setup.confirm = i; refreshSetupPanel(); return; }
  setup.confirm = -1;
  saveRoomSlot(i);
  setup.msg = `Raum ${i + 1} gespeichert (${room.surfaces.length} Flächen)`;
  SFX.magIn();
  refreshSetupPanel();
}
function loadSlot(i) {
  const n = loadRoomSlot(i);
  afterRoomLoad(n, `Raum ${i + 1}`);
}
function afterRoomLoad(n, name) {
  setup.view = 'main';
  setup.confirm = -1;
  setup.last = null;
  syncBench();
  resetWeapons();
  saveRoom();
  SFX.magIn();
  setTool('align');
  setup.msg = `${name} geladen (${n} Flächen) – jetzt an einer echten Wand ausrichten`;
  refreshSetupPanel();
}
// Waffenständer-Gestell an die (evtl. verschobene) Ständer-Fläche anpassen
function syncBench() {
  const b = surfacesOf('bench')[0];
  bench = null;
  if (b) placeBench(b.center.clone(), b.yaw);
  else if (benchRack) benchRack.visible = false;
}
// ---- Ausrichten: gespeicherte Karte drehen/verschieben, bis sie auf den echten Raum passt ----
function beginAlign() {
  setup.align = { base: serializeRoom(), angle: 0, pivot: headPos.clone().setY(0), offset: new THREE.Vector3(), dirty: false, t: 0, lines: 0 };
  if (benchRack) benchRack.visible = false;
}
function applyAlign(force = false) {
  const a = setup.align;
  if (!a || (!a.dirty && !force)) return;
  a.dirty = false;
  deserializeRoom(a.base, a.angle, a.pivot, a.offset);
  setup.hoverS = null;
}
// zusätzliche Drehung um einen Punkt c (in Weltkoordinaten) in die Transformation einrechnen
function alignRotate(delta, c) {
  const a = setup.align;
  const q = new THREE.Quaternion().setFromAxisAngle(UP, delta);
  const t = a.pivot.clone().add(a.offset).sub(c).applyQuaternion(q).add(c);
  a.offset.copy(t.sub(a.pivot));
  a.angle += delta;
  a.dirty = true;
}
function endAlign() {
  const a = setup.align;
  if (!a) return;
  applyAlign();
  setup.align = null;
  syncBench();
  resetWeapons();
  saveRoom();
}
// Linie entlang einer echten Wand gezogen → passende gespeicherte Wand darauf einrasten
function alignToLine(p0, p1) {
  const a = setup.align;
  const dir = p1.clone().sub(p0).setY(0);
  const len = dir.length();
  if (len < 0.4) return 'Linie zu kurz – mindestens 40 cm an der Wand entlang ziehen';
  dir.normalize();
  const mid = p0.clone().add(p1).multiplyScalar(0.5).setY(0);
  const lineAng = Math.atan2(dir.z, dir.x);
  let best = null, bs = Infinity;
  for (const w of surfacesOf('wall')) {
    let dA = Math.atan2(w.right.z, w.right.x) - lineAng;
    dA = Math.atan2(Math.sin(dA), Math.cos(dA));
    if (dA > Math.PI / 2) dA -= Math.PI; else if (dA < -Math.PI / 2) dA += Math.PI; // Richtung egal
    const dist = Math.abs(mid.clone().sub(w.mid).dot(w.normal));
    const along = Math.max(0, Math.abs(mid.clone().sub(w.mid).dot(w.right)) - w.width / 2);
    // beim 2. Mal nur noch fast parallele Wände (Drehung steht schon)
    if (a.lines > 0 && Math.abs(dA) > 0.35) continue;
    const score = Math.abs(dA) * 2.5 + dist + along * 0.5;
    if (score < bs) { bs = score; best = { w, dA }; }
  }
  if (!best) return 'Keine passende Wand gefunden';
  const w = best.w;
  // erste Linie: drehen (um die Wandmitte, die bleibt dabei stehen); danach nur noch schieben
  const rot = a.lines === 0 ? best.dA : 0; // atan2-Winkel und Drehung um die Hochachse haben entgegengesetzte Vorzeichen
  if (rot) alignRotate(rot, w.mid.clone().setY(0));
  const n = w.normal.clone().applyAxisAngle(UP, rot);
  const shift = mid.clone().sub(w.mid.clone().setY(0)).dot(n);
  a.offset.addScaledVector(n, shift);
  a.dirty = true;
  a.lines++;
  applyAlign();
  return a.lines === 1 ? 'Eingerastet! Optional: Linie an einer QUER stehenden Wand ziehen' : 'Feinschliff übernommen ✔';
}
function setTool(t) {
  if (setup.tool === 'align' && t !== 'align') endAlign();
  setup.tool = setup.tool === t && t !== 'align' ? null : t;
  if (setup.tool === 'align' && !setup.align) beginAlign();
  if (setup.hoverS) { unhover(); }
  setup.pending = null;
  setup.drag = null;
  setup.msg = '';
  floorGrid.visible = setup.tool === 'floor';
  refreshSetupPanel();
}
function undoSurface() {
  if (setup.pending) { setup.pending = null; refreshSetupPanel(); return; }
  if (setup.align) { setup.align.angle = 0; setup.align.offset.set(0, 0, 0); setup.align.lines = 0; setup.align.dirty = true; applyAlign(); setup.msg = 'Ausrichtung zurückgesetzt'; refreshSetupPanel(); return; }
  const list = room.surfaces.filter(s => s.type !== 'bench');
  if (!list.length) return;
  unhover();
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
function heightFromRay(r, center, maxH = 1.6) {
  const n = new THREE.Vector3(headPos.x - center.x, 0, headPos.z - center.z);
  if (n.lengthSq() < 1e-4) return null;
  n.normalize();
  const denom = r.d.dot(n);
  if (Math.abs(denom) < 1e-3) return null;
  const t = center.clone().sub(r.o).dot(n) / denom;
  return t > 0 ? THREE.MathUtils.clamp(r.o.y + r.d.y * t, 0.15, maxH) : null;
}
// Laser trifft eine markierte Wand: Position entlang der Wand (u) und Höhe (v)
function wallHit(r, only = null) {
  let best = null;
  for (const w of only ? [only] : surfacesOf('wall')) {
    const denom = r.d.dot(w.normal);
    if (Math.abs(denom) < 1e-4) continue;
    const t = ((w.mid.x - r.o.x) * w.normal.x + (w.mid.z - r.o.z) * w.normal.z) / denom;
    if (t <= 0 || t > 15) continue;
    const p = r.o.clone().addScaledVector(r.d, t);
    let u = (p.x - w.a.x) * w.right.x + (p.z - w.a.z) * w.right.z, v = p.y;
    if (only) { u = THREE.MathUtils.clamp(u, 0, w.width); v = THREE.MathUtils.clamp(v, 0, w.height); }
    else if (u < -0.05 || u > w.width + 0.05 || v < 0 || v > w.height) continue;
    if (!best || t < best.t) best = { wall: w, u, v, t, point: w.a.clone().addScaledVector(w.right, u).setY(v) };
  }
  return best;
}
// Rechteck einer Tür/eines Fensters aus dem Ziehen auf der Wand
function openingFromDrag(d) {
  const w = d.wall;
  const u0 = Math.min(d.u0, d.u), u1 = Math.max(d.u0, d.u);
  let bottom, top;
  if (setup.tool === 'door') { bottom = 0; top = THREE.MathUtils.clamp(Math.max(d.v0, d.v), 1.6, w.height - 0.02); }
  else { bottom = Math.min(d.v0, d.v); top = Math.max(d.v0, d.v); if (top - bottom < 0.25) top = Math.min(w.height, bottom + 0.25); }
  return { a: w.a.clone().addScaledVector(w.right, u0), b: w.a.clone().addScaledVector(w.right, u1), inside: w.mid.clone().add(w.normal), bottom, top, width: u1 - u0 };
}
const boxWithHeight = (p) => makeBox(p.type, p.p1.clone().setY(p.height), p.p2.clone().setY(p.height), p.yaw);

// ---- Hilfen: Wand-Ecken einrasten, Längen-Anzeige, Löschen per Laser ----
function wallEnds() {
  const pts = [];
  for (const w of surfacesOf('wall')) pts.push(w.a.clone().setY(0), w.a.clone().addScaledVector(w.right, w.width).setY(0));
  return pts;
}
function snapCorner(p, maxD = 0.22) {
  let best = null, bd = maxD;
  for (const e of wallEnds()) { const d = Math.hypot(e.x - p.x, e.z - p.z); if (d < bd) { bd = d; best = e; } }
  return best;
}
// Endpunkt einer neuen Wand: an Ecken einrasten, sonst rechte Winkel zur nächsten Wand
function snapWallEnd(start, cur) {
  const c = snapCorner(cur);
  if (c && c.distanceTo(start) > 0.25) return { p: c, how: 'Ecke' };
  const dir = cur.clone().sub(start).setY(0);
  const len = dir.length();
  if (len < 0.3) return { p: cur, how: '' };
  let ref = null, bd = Infinity;
  for (const w of surfacesOf('wall')) { const d = start.distanceTo(w.mid.clone().setY(0)) - w.width / 2; if (d < bd) { bd = d; ref = w; } }
  if (!ref) return { p: cur, how: '' };
  const phi = Math.atan2(ref.right.z, ref.right.x);
  let rel = Math.atan2(dir.z, dir.x) - phi;
  rel = Math.atan2(Math.sin(rel), Math.cos(rel));
  const snapped = Math.round(rel / (Math.PI / 2)) * (Math.PI / 2);
  if (Math.abs(rel - snapped) > 0.12) return { p: cur, how: '' };
  return { p: start.clone().add(new THREE.Vector3(Math.cos(phi + snapped), 0, Math.sin(phi + snapped)).multiplyScalar(len)), how: snapped % Math.PI === 0 ? '∥' : '90°' };
}
const lenLabel = makePanel(0.34, 0.09, 600);
lenLabel.mesh.renderOrder = 40;
lenLabel.mesh.material.depthTest = false;
lenLabel.mesh.visible = false;
scene.add(lenLabel.mesh);
let lenLabelTxt = '';
function showLenLabel(pos, str) {
  lenLabel.mesh.visible = true;
  lenLabel.mesh.position.copy(pos);
  lenLabel.mesh.lookAt(headPos);
  if (str === lenLabelTxt) return;
  lenLabelTxt = str;
  lenLabel.draw((ctx, w, h) => { roundRect(ctx, 2, 2, w - 4, h - 4, 14); ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fill(); text(ctx, str, w / 2, h / 2 + 2, 34, '#ffee66', 'center', true); });
}
function surfaceAt(r) {
  const vis = room.surfaces.map(x => x.visual).filter(Boolean);
  raycaster.set(r.o, r.d);
  raycaster.far = 15;
  const hit = raycaster.intersectObjects(vis, false)[0];
  return hit ? room.surfaces.find(x => x.visual === hit.object) : null;
}
function unhover() {
  const s0 = setup.hoverS;
  if (s0 && s0.edges && s0._ec !== undefined) { s0.edges.material.color.setHex(s0._ec); s0.visual.material.opacity = s0._eo; }
  setup.hoverS = null;
}
function hoverSurface(x) {
  if (x === setup.hoverS) return;
  unhover();
  if (!x || !x.edges) return;
  setup.hoverS = x;
  x._ec = x.edges.material.color.getHex();
  x._eo = x.visual.material.opacity;
  x.edges.material.color.setHex(0xff2a2a);
  if (x.visual.material.transparent) x.visual.material.opacity = 0.6;
}
function placeMysteryBoxSurface(c, yaw) {
  for (const old of surfacesOf('mbox')) removeSurface(old);
  const X = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), Z = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const p1 = c.clone().addScaledVector(X, -0.42).addScaledVector(Z, -0.22), p2 = c.clone().addScaledVector(X, 0.42).addScaledVector(Z, 0.22);
  return addBox('mbox', p1.setY(0.48), p2.setY(0.48), yaw);
}

// Abzug gedrückt (mit Laser, nicht auf ein Menü)
function setupTriggerDown(src) {
  const tool = setup.tool;
  if (setup.pending && setup.pending.type === 'window') { // Fenster: erst Unter-, dann Oberkante
    const p = setup.pending;
    if (p.stage === 'bottom') { p.stage = 'top'; p.top = Math.max(p.top, p.bottom + 0.4); refreshSetupPanel(); return; }
    setup.pending = null;
    const s = addOpening('window', p.a, p.b, headPos, p.bottom, Math.max(p.top, p.bottom + 0.2));
    if (s) { setup.last = s; setup.msg = 'Fenster hinzugefügt'; SFX.magIn(); saveRoom(); }
    refreshSetupPanel();
    return;
  }
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
  if (tool === 'erase') {
    const x = surfaceAt(rayOf(src));
    if (!x) return;
    unhover();
    if (x === setup.last) setup.last = null;
    removeSurface(x);
    if (x.type === 'bench') syncBench();
    setup.msg = `${surfaceName(x.type)} gelöscht`;
    SFX.click();
    saveRoom();
    refreshSetupPanel();
    return;
  }
  if (tool === 'wallbuy') {
    const wh = wallHit(rayOf(src));
    if (!wh) { setup.msg = surfacesOf('wall').length ? 'Zeige mit dem Laser auf eine markierte (blaue) Wand' : 'Zuerst Wände markieren'; refreshSetupPanel(); return; }
    const u = THREE.MathUtils.clamp(wh.u, 0.45, Math.max(0.45, wh.wall.width - 0.45));
    const pos = wh.wall.a.clone().addScaledVector(wh.wall.right, u).setY(THREE.MathUtils.clamp(wh.v, 1.0, 1.6));
    if (surfacesOf('wallbuy').some(o => o.pos.distanceTo(pos) < 0.9)) { setup.msg = 'Zu nah an einem anderen Wandkauf'; refreshSetupPanel(); return; }
    const x = addWallbuy(pos, wh.wall.normal);
    setup.last = x;
    setup.msg = `Wandkauf ${surfacesOf('wallbuy').length} platziert – jede Runde eine zufällige Waffe`;
    SFX.magIn();
    saveRoom();
    refreshSetupPanel();
    return;
  }
  if (tool === 'door' || tool === 'window') {
    const wh = wallHit(rayOf(src));
    if (!wh) { setup.msg = surfacesOf('wall').length ? 'Zeige mit dem Laser auf eine markierte (blaue) Wand' : 'Zuerst Wände markieren – dann Türen/Fenster einzeichnen'; refreshSetupPanel(); return; }
    setup.drag = { src, wall: wh.wall, u0: wh.u, v0: wh.v, u: wh.u, v: wh.v };
    if (src !== 'mouse') pulse(src, 0.4, 30);
    return;
  }
  const hit = floorHit(rayOf(src));
  if (!tool || !hit) return;
  const start = tool === 'wall' ? (snapCorner(hit) || hit) : hit;
  setup.drag = { src, start, cur: start.clone() };
  if (src !== 'mouse') pulse(src, 0.4, 30);
}
function setupTriggerUp() {
  const d = setup.drag;
  setup.drag = null;
  previewWall.visible = previewLine.visible = false;
  if (!d) return;
  if (d.wall) { // Tür / Fenster in der Wand
    const o = openingFromDrag(d);
    const s = o.width >= 0.3 ? addOpening(setup.tool, o.a, o.b, o.inside, o.bottom, o.top) : null;
    if (s) { setup.last = s; setup.msg = `${surfaceName(s.type)} hinzugefügt (${o.width.toFixed(2)} × ${(o.top - o.bottom).toFixed(2)} m)`; SFX.magIn(); saveRoom(); }
    else setup.msg = 'Zu schmal – nochmal ziehen';
    refreshSetupPanel();
    return;
  }
  lenLabel.mesh.visible = false;
  const len = d.start.distanceTo(d.cur);
  if (setup.tool === 'align') {
    setup.msg = alignToLine(d.start, d.cur);
    SFX.magIn();
  } else if (setup.tool === 'mbox') {
    const yaw = len > 0.2 ? Math.atan2(-(d.cur.z - d.start.z), d.cur.x - d.start.x) : headYaw();
    const x = placeMysteryBoxSurface(len > 0.2 ? d.start.clone().add(d.cur).multiplyScalar(0.5) : d.start, yaw);
    setup.last = x;
    setup.msg = 'Glückskiste platziert';
    SFX.magIn();
    saveRoom();
  } else if (setup.tool === 'wall') {
    const s = addWall(d.start, d.cur, headPos);
    if (s) { setup.last = s; setup.msg = 'Wand hinzugefügt'; SFX.magIn(); saveRoom(); } else setup.msg = 'Zu kurz – nochmal';
  } else if (setup.tool === 'door') {
    const s = addOpening('door', d.start, d.cur, headPos, 0, 2.05);
    if (s) { setup.last = s; setup.msg = 'Tür hinzugefügt'; SFX.magIn(); saveRoom(); } else setup.msg = 'Zu schmal – nochmal';
  } else if (setup.tool === 'window') {
    if (len < 0.25) setup.msg = 'Zu schmal – Breite unter dem Fenster aufziehen';
    else { setup.pending = { type: 'window', a: d.start, b: d.cur, stage: 'bottom', bottom: 0.9, top: 2.0, src: d.src }; setup.msg = ''; }
  } else if (setup.tool === 'bench') {
    const yaw = len > 0.2 ? Math.atan2(-(d.cur.z - d.start.z), d.cur.x - d.start.x) : headYaw();
    placeBench(len > 0.2 ? d.start.clone().add(d.cur).multiplyScalar(0.5) : d.start, yaw);
    resetWeapons();
    setup.msg = 'Waffenständer platziert';
    SFX.magIn();
    saveRoom();
  } else if (setup.tool === 'table' || setup.tool === 'chair') {
    if (len < 0.15) setup.msg = 'Zu klein – Grundfläche von Ecke zu Ecke aufziehen';
    else {
      setup.pending = { type: setup.tool, p1: d.start, p2: d.cur, yaw: d.yaw, height: setup.tool === 'table' ? 0.75 : 0.45, src: d.src };
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
    if (setup.tool === 'erase') continue;
    if (setup.tool === 'door' || setup.tool === 'window' || setup.tool === 'wallbuy') {
      const wh = setup.drag && setup.drag.src === src ? wallHit(rayOf(src), setup.drag.wall) : wallHit(rayOf(src));
      if (wh) { marker.visible = true; marker.position.copy(wh.point).addScaledVector(wh.wall.normal, 0.01); marker.quaternion.setFromUnitVectors(UP, wh.wall.normal); }
      continue;
    }
    marker.quaternion.identity();
    const hit = floorHit(rayOf(src));
    if (hit) {
      marker.visible = true;
      const c = setup.tool === 'wall' && !setup.drag ? snapCorner(hit) : null;
      marker.position.copy(c || hit).setY(0.003);
      marker.scale.setScalar(c ? 1.8 : 1);
    }
  }
  if (setup.tool === 'erase') {
    let hx = null;
    for (const src of srcs) { if (src !== 'mouse' && (!isFree(src) || src.uiHover)) continue; hx = surfaceAt(rayOf(src)); if (hx) break; }
    hoverSurface(hx);
  } else if (setup.hoverS) unhover();
  // Ziehen
  const d = setup.drag;
  previewWall.visible = previewBox.visible = previewLine.visible = false;
  if (d && d.wall) {
    const wh = wallHit(rayOf(d.src), d.wall);
    if (wh) { d.u = wh.u; d.v = wh.v; }
    const o = openingFromDrag(d);
    const w = d.wall;
    previewWall.visible = true;
    previewWall.scale.set(Math.max(0.02, o.width), Math.max(0.02, o.top - o.bottom), 1);
    previewWall.position.copy(o.a).addScaledVector(w.right, o.width / 2).setY((o.bottom + o.top) / 2).addScaledVector(w.normal, 0.01);
    previewWall.quaternion.setFromRotationMatrix(tmpM.makeBasis(w.right, UP, w.normal));
  } else if (d) {
    const hit = floorHit(rayOf(d.src));
    let how = '';
    if (hit) { if (setup.tool === 'wall') { const sn = snapWallEnd(d.start, hit); d.cur = sn.p; how = sn.how; } else d.cur = hit; }
    d.yaw = suggestYaw(d.start, headYaw());
    const L = d.start.distanceTo(d.cur);
    if (L > 0.05) showLenLabel(d.cur.clone().setY(0.25), `${L.toFixed(2)} m${how ? ' · ' + how : ''}`);
    previewLine.visible = true;
    previewLine.geometry.setFromPoints([d.start.clone().setY(0.01), d.cur.clone().setY(0.01)]);
    if (setup.tool === 'wall' || setup.tool === 'door' || setup.tool === 'window') {
      const s = setup.tool === 'wall' ? makeWall(d.start, d.cur, headPos) : makeOpening(setup.tool, d.start, d.cur, headPos, setup.tool === 'door' ? 0 : 0.9, setup.tool === 'door' ? 2.05 : 2.0);
      if (s) {
        previewWall.visible = true;
        previewWall.scale.set(s.width, s.type === 'wall' ? s.height : s.top - s.bottom, 1);
        previewWall.position.copy(s.center);
        previewWall.quaternion.setFromRotationMatrix(tmpM.makeBasis(s.right, UP, s.normal));
      }
    } else if (setup.tool === 'mbox') {
      const L2 = d.start.distanceTo(d.cur);
      const yaw = L2 > 0.2 ? Math.atan2(-(d.cur.z - d.start.z), d.cur.x - d.start.x) : headYaw();
      const c = L2 > 0.2 ? d.start.clone().add(d.cur).multiplyScalar(0.5) : d.start;
      previewBox.visible = true;
      previewBox.scale.set(0.84, 0.48, 0.44);
      previewBox.position.set(c.x, 0.24, c.z);
      previewBox.rotation.set(0, yaw, 0);
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
  if (p && p.type === 'window') {
    // die Hand, die gezeichnet hat, bestimmt die Höhe
    const src = !renderer.xr.isPresenting ? 'mouse' : (p.src && p.src !== 'mouse' && p.src.src && !p.src.uiHover ? p.src : (hands.find(h => h.src && isFree(h) && !h.uiHover) || null));
    const mid = p.a.clone().add(p.b).multiplyScalar(0.5).setY(0);
    if (src) { const hgt = heightFromRay(rayOf(src), mid, 2.6); if (hgt) p[p.stage] = THREE.MathUtils.damp(p[p.stage], hgt, 20, dt); }
    if (hands.some(h => down(h, 'b'))) { setup.pending = null; setup.msg = 'Abgebrochen'; refreshSetupPanel(); return; }
    const s = makeOpening('window', p.a, p.b, headPos, p.bottom, p.stage === 'bottom' ? p.bottom + 0.02 : Math.max(p.top, p.bottom + 0.05));
    if (s) {
      previewWall.visible = true;
      previewWall.scale.set(s.width, Math.max(0.02, s.top - s.bottom), 1);
      previewWall.position.copy(s.center);
      previewWall.quaternion.setFromRotationMatrix(tmpM.makeBasis(s.right, UP, s.normal));
    }
    setup.refT -= dt;
    if (setup.refT <= 0) { setup.refT = 0.15; refreshSetupPanel(); }
  } else if (p) {
    // die Hand, die gezeichnet hat, bestimmt die Höhe
    const src = !renderer.xr.isPresenting ? 'mouse' : (p.src && p.src !== 'mouse' && p.src.src && !p.src.uiHover ? p.src : (hands.find(h => h.src && isFree(h) && !h.uiHover) || null));
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
  } else if (!setup.align && setup.last && setup.last.type !== 'wall' && setup.last.type !== 'wallbuy' && Math.abs(stickX) > 0.4 && room.surfaces.includes(setup.last)) {
    // zuletzt platzierten Tisch/Stuhl drehen
    setup.rotT -= dt;
    if (setup.rotT <= 0) { rotateBox(setup.last, setup.last.yaw - stickX * 0.1); setup.rotT = 0.05; }
  }
  // Ausrichten: Stick ◀ ▶ dreht die Karte um den Kopf, ▲▼ schiebt sie in Blickrichtung
  if (setup.align && !d) {
    const a = setup.align;
    if (Math.abs(stickX) > 0.3) { alignRotate(-stickX * dt * 0.35, headPos.clone().setY(0)); }
    if (Math.abs(stickY) > 0.3) {
      const yaw = headYaw();
      a.offset.addScaledVector(new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), -stickY * dt * 0.3);
      a.dirty = true;
    }
    a.t -= dt;
    if (a.dirty && a.t <= 0) { a.t = 0.12; applyAlign(); refreshSetupPanel(); }
  }
  if (!d) lenLabel.mesh.visible = false;
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
  clearZombies();
  clearPlanks();
  menuPanel.visible = board.visible = false;
  startButton.visible = false;
  setupPanel.visible = true;
  setupPanel.place(0.85, 0.65, -0.4);
  refreshSetupPanel();
}
function finishSetup() {
  endAlign();
  unhover();
  lenLabel.mesh.visible = false;
  setup.view = 'main';
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
// Spielablauf: Menü → Countdown → Zombie-Wellen → Ergebnis
// =============================================================================
const MODES = {
  survival: { icon: '🧟', label: 'Überleben', desc: 'Zombies kommen in Wellen durch Türen & Fenster – überlebe!' },
  training: { icon: '🎯', label: 'Training', desc: 'Langsame Zombies, die dir nichts tun – zum Üben' }
};
let state = 'menu', gameMode = 'survival';
let score = 0, wave = 0, waveBreak = 0, countdown = 0, roundClock = 0, toSpawn = 0, spawnT = 0;
let playerHp = 100, hurtFlash = 0, regenT = 0, heartT = 0;
let boardDirty = true, lastResult = null;
const stats = { shots: 0, hits: 0, kills: 0, headshots: 0 };
const inRound = () => state === 'playing';
const hsKey = (m) => 'vrspiel-zombie-hs-' + m;
function getHighscore(m) { try { return parseInt(localStorage.getItem(hsKey(m)) || '0', 10); } catch { return 0; } }
function setHighscore(m, v) { try { localStorage.setItem(hsKey(m), String(v)); } catch { /* ignorieren */ } }

// roter Schleier bei Treffern / wenig Leben
const hurtMesh = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0xaa0000, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, depthWrite: false, toneMapped: false }));
hurtMesh.renderOrder = 2000;
hurtMesh.visible = false;
camera.add(hurtMesh);

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
  const r = lastResult;
  const nOpen = openings().length;
  const top = topList(gameMode);
  menuPanel.set((ctx, w) => {
    if (r) {
      text(ctx, r.died ? '💀 Die Zombies haben dich erwischt!' : r.place === 0 ? '🏆 Neuer Rekord!' : 'Runde beendet', w / 2, 40, 36, '#fff', 'center', true);
      text(ctx, `${r.score} Punkte · Welle ${r.wave}`, w / 2, 90, 46, '#ffcc33', 'center', true);
      text(ctx, `Erledigt ${r.kills} · Kopfschüsse ${r.headshots} · Genauigkeit ${r.acc}% · Beste Serie ${r.streak}`, w / 2, 134, 22, '#cfd8e3');
    } else {
      text(ctx, '🧟 Zombie-Abwehr', w / 2, 44, 46, '#fff', 'center', true);
      text(ctx, 'Waffe vom Waffenständer nehmen: hingreifen & Griff-Taste HALTEN.', w / 2, 94, 23, '#cfd8e3');
      text(ctx, nOpen ? `Die Zombies kommen durch deine ${nOpen} Türen/Fenster.` : '⚠ Keine Türen/Fenster eingerichtet – Zombies kommen aus dem Boden.', w / 2, 124, 23, nOpen ? '#cfd8e3' : '#ffb04a');
    }
    text(ctx, MODES[gameMode].desc, w / 2, 168, 23, '#9ad', 'center', true);
    text(ctx, top.length ? '🏆 ' + top.slice(0, 5).map((e, i) => `${i + 1}. ${e.score} (W${e.wave}, ${DIFFS[e.diff] ? DIFFS[e.diff].label : ''})`).join('  ') : '🏆 Noch keine Bestenliste', w / 2, 404, 19, '#9ad');
    text(ctx, '⚙ Bedienung', 30, 506, 20, '#9ad', 'left', true);
    text(ctx, 'Kopf x3 · 💰 Punkte → Wandkäufe & Glückskiste · Waffe über die Schulter = Holster', w / 2, 610, 19, '#cfd8e3');
    text(ctx, `Version ${VERSION}`, w - 24, 664, 18, '#6b7a90', 'right');
  }, [
    ...row(184, 56, Object.entries(MODES).map(([id, m]) => ({ id, label: `${m.icon} ${m.label}`, active: gameMode === id, onClick: () => { gameMode = id; refreshMenu(); } })), 792),
    ...row(250, 50, [
      ...Object.entries(DIFFS).map(([id, d]) => ({ id: 'd_' + id, label: d.label, font: 28, active: diffKey === id, onClick: () => { diffKey = id; store('vrspiel-schwierigkeit', id); refreshMenu(); } })),
      { id: 'voice', label: voiceOn ? '🔊 Ansager' : '🔇 Ansager', font: 26, active: voiceOn, onClick: () => { voiceOn = !voiceOn; store('vrspiel-ansager', voiceOn); if (voiceOn) speak('Ansager an'); refreshMenu(); } }
    ], 792),
    ...row(312, 66, [{ id: 'start', label: '▶ START', font: 40, onClick: startPressed }], 792, 220),
    ...row(428, 58, [
      { id: 'room', label: '🧱 Raum bearbeiten', onClick: enterSetup },
      { id: 'reset', label: '🔫 Waffen zurücklegen', onClick: resetWeapons }
    ], 792),
    ...row(522, 56, [
      { id: 'grip', label: settings.grip === 'toggle' ? '✊ Griff: Tippen' : '✊ Griff: Halten', font: 21, onClick: () => setSetting('grip', settings.grip === 'toggle' ? 'hold' : 'toggle', 'vrspiel-griff') },
      { id: 'reload', label: settings.reload === 'simple' ? '🔄 Laden: Einfach' : '🔄 Laden: Echt', font: 21, active: settings.reload === 'simple', onClick: () => setSetting('reload', settings.reload === 'simple' ? 'real' : 'simple', 'vrspiel-nachladen') },
      { id: 'assist', label: settings.assist ? '🎯 Zielhilfe: An' : '🎯 Zielhilfe: Aus', font: 21, active: settings.assist, onClick: () => setSetting('assist', !settings.assist, 'vrspiel-zielhilfe') },
      { id: 'shadow', label: shadowsOn ? '🌗 Schatten: An' : '🌗 Schatten: Aus', font: 21, active: shadowsOn, onClick: () => { setShadows(!shadowsOn); refreshMenu(); } }
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
  clearZombies();
  clearDecals();
  for (const m of medkits.splice(0)) scene.remove(m.obj);
  for (const g of grenades.splice(0)) { removeDynamic(g.phys); scene.remove(g.obj); }
  refillGrenades();
  for (const pu of powerups.splice(0)) { scene.remove(pu.obj); pu.obj.material.dispose(); }
  active.double = active.slowmo = 0;
  setupPlanks();
  buildNav(headPos);
  playerHp = 100;
  lowHpWarned = false;
  pendingDeath = false;
  // jede Runde: nur die Startpistole, Punkte neu, neue Wandkauf-Waffen, Glückskiste bereit
  if (holster) { disposeWeapon(holster); holster = null; }
  for (const w of [...arsenal]) if (!w.starter) disposeWeapon(w);
  for (const w of arsenal) refillWeapon(w);
  resetWeapons();
  setupWallbuys();
  setupMysteryBox();
  const fd = freeDistance(headPos, inFront(1, 0, headPos.y + 0.6).sub(headPos), 3.2);
  board.place(Math.max(1.2, Math.min(3, fd - 0.2)), 0, 0.6);
  board.mesh.scale.setScalar(1.3);
  board.visible = true;
  boardDirty = true;
}
function beginRound() {
  state = 'playing';
  score = 0; roundClock = 0; wave = 0;
  points = free() ? 0 : START_POINTS;
  stats.shots = stats.hits = stats.kills = stats.headshots = 0;
  stats.bestStreak = 0;
  streak = 0;
  streakMsg = null;
  nextWave();
  SFX.jingle([392, 330, 262]);
}
function nextWave() {
  wave++;
  toSpawn = Math.max(2, Math.round((gameMode === 'training' ? 2 + wave : 3 + wave * 2) * DIFFS[diffKey].count));
  refillGrenades();
  bruteWarned = false;
  bossPending = gameMode !== 'training' && wave % 5 === 0;
  speak(bossPending ? `Welle ${wave}. Ein Riese kommt!` : `Welle ${wave}`);
  spawnT = 1.5;
  waveBreak = 0;
  setupPlanks(); // Bretter werden vor jeder Welle wieder angenagelt
  buildNav(headPos);
  boardDirty = true;
}
function endRound(died = false) {
  state = 'over';
  clearZombies();
  hurtFlash = 0;
  const acc = stats.shots ? Math.round(stats.hits / stats.shots * 100) : 0;
  const place = addTop(gameMode, { score, wave, kills: stats.kills, diff: diffKey, date: Date.now() });
  lastResult = { score, kills: stats.kills, headshots: stats.headshots, acc, wave, place, died, streak: stats.bestStreak || 0 };
  speak(died ? 'Du wurdest gefressen' : place === 0 ? 'Neuer Rekord!' : 'Runde beendet');
  if (died) SFX.jingle([392, 370, 349, 330, 196], 0.4); else SFX.jingle([784, 659, 523, 392], 0.35);
  enterMenu();
}
function currentRange() {
  const ws = hands.map(heldWeapon).filter(Boolean);
  if (deskW) ws.push(deskW);
  if (!ws.length) return [2.5, 6];
  return [Math.min(...ws.map(w => w.def.range[0])), Math.max(...ws.map(w => w.def.range[1]))];
}
// Richtungsanzeige: roter Bogen zeigt, von wo der Angriff kam
const dirIndicator = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 80, 128, 128, 126);
  g.addColorStop(0, 'rgba(255,0,0,0)'); g.addColorStop(0.6, 'rgba(255,20,20,0.9)'); g.addColorStop(1, 'rgba(255,0,0,0)');
  ctx.strokeStyle = g; ctx.lineWidth = 40;
  ctx.beginPath(); ctx.arc(128, 128, 104, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); ctx.stroke();
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false }));
  m.position.set(0, 0, -0.5);
  m.renderOrder = 2002;
  m.visible = false;
  camera.add(m);
  return m;
})();
function showHitDirection(from) {
  const cam = getViewCamera();
  const v = from.clone();
  cam.worldToLocal(v);
  dirIndicator.rotation.z = Math.atan2(-v.x, -v.z);
  dirIndicator.material.opacity = 1;
  dirIndicator.visible = true;
}
function playerHit(dmg, z) {
  if (z && z.root) showHitDirection(z.root.position.clone().setY(headPos.y));
  if (state !== 'playing') return;
  playerHp -= dmg * DIFFS[diffKey].dmg;
  hurtFlash = 1;
  if (playerHp < 30 && playerHp > 0 && !lowHpWarned) { lowHpWarned = true; speak('Du bist schwer verletzt'); }
  if (playerHp >= 45) lowHpWarned = false;
  regenT = 4;
  SFX_PLAYER.hurt();
  for (const h of hands) pulse(h, 1, 150);
  boardDirty = true;
  if (playerHp <= 0) { playerHp = 0; pendingDeath = true; } // Rundenende erst im nächsten Bild (nicht mitten im Zombie-Update)
}
function updateGame(dt) {
  hurtFlash = Math.max(0, hurtFlash - dt * 1.5);
  const low = state === 'playing' && playerHp < 35 ? (0.35 - playerHp / 100) * (0.6 + 0.4 * Math.sin(elapsed * 6)) : 0;
  hurtMesh.material.opacity = Math.min(0.6, hurtFlash * 0.45 + low);
  hurtMesh.visible = hurtMesh.material.opacity > 0.01;
  if (state === 'countdown') {
    const prev = Math.ceil(countdown);
    countdown -= dt;
    if (Math.ceil(countdown) !== prev) { boardDirty = true; if (countdown > 0) SFX.beep(); }
    if (countdown <= 0) beginRound();
    return;
  }
  if (state !== 'playing') return;
  if (pendingDeath) { pendingDeath = false; endRound(true); return; }
  roundClock += dt;
  // Leben regeneriert langsam, wenn man eine Weile nicht getroffen wurde
  regenT -= dt;
  if (regenT <= 0 && playerHp < 100) { playerHp = Math.min(100, playerHp + dt * 3); if (Math.random() < dt * 2) boardDirty = true; }
  if (playerHp < 35) { heartT -= dt; if (heartT <= 0) { heartT = 0.9; SFX_PLAYER.heartbeat(); } }
  if (streakMsg) { streakMsg.t -= dt; if (streakMsg.t <= 0) streakMsg = null; boardDirty = true; }
  if (waveBreak > 0) {
    if (Math.ceil(waveBreak) !== lastBreakSec) { lastBreakSec = Math.ceil(waveBreak); boardDirty = true; }
    waveBreak -= dt;
    if (waveBreak <= 0) nextWave();
    return;
  }
  // Zombies nach und nach erscheinen lassen
  if (toSpawn > 0) {
    spawnT -= dt;
    if (spawnT <= 0 && aliveCount() < 3 + wave) {
      const D = DIFFS[diffKey];
      const zn = spawnZombie(gameMode === 'training' ? 0 : wave, headPos, bossPending ? 'giant' : undefined, { hp: D.hp, speed: gameMode === 'training' ? 0.8 : D.speed });
      bossPending = false;
      if (zn.type === 'brute' && !bruteWarned) { bruteWarned = true; speak('Achtung, ein Brocken!'); }
      toSpawn--;
      spawnT = Math.max(0.8, 3.5 - wave * 0.3) * THREE.MathUtils.randFloat(0.7, 1.3);
      boardDirty = true;
    }
  } else if (aliveCount() === 0) {
    const bonus = 50 * wave;
    award(bonus);
    floatingText(`Welle ${wave} überlebt! +${bonus}`, board.mesh.position.clone().add(new THREE.Vector3(0, -0.5, 0)), '#7dffa8');
    SFX.jingle([523, 659, 784, 1046]);
    speak(`Welle ${wave} überlebt`);
    waveBreak = 5;
    boardDirty = true;
  }
}
function handleZombieHit(res, point, prefix = '') {
  if (!res) return;
  if (res.kill) {
    floorDecal(res.pos, 'blood', THREE.MathUtils.randFloat(0.5, 0.9));
    if (inRound() && res.type === 'giant') spawnPowerup(res.pos); // der Riese lässt immer ein Power-up fallen
    else if (inRound() && Math.random() < (playerHp < 60 ? 0.18 : 0.1)) spawnMedkit(res.pos);
    else if (inRound() && !res.nuke && powerups.length < 2 && Math.random() < 0.045) spawnPowerup(res.pos);
  }
  SFX.marker(res.kill);
  if (inRound()) {
    if (!res.explosion) stats.hits++;
    const mult = active.double > 0 ? 2 : 1;
    award(10 * mult);
    if (res.kill) {
      stats.kills++;
      // Killserie: mehrere Kills kurz hintereinander
      streak = elapsed - lastKillT < 1.6 ? streak + 1 : 1;
      lastKillT = elapsed;
      stats.bestStreak = Math.max(stats.bestStreak || 0, streak);
      if (streak >= 2) {
        const names = { 2: 'Doppelkill!', 3: 'Dreifachkill!', 4: 'Vierfachkill!' };
        const name = names[streak] || 'Massaker!';
        const bonus = 50 * (streak - 1) * mult;
        award(bonus);
        streakMsg = { text: `${name} +${bonus}`, t: 2.2 };
        if (streak <= 5 || streak % 3 === 0) speak(name.replace('!', ''));
      }
      award((res.headshot ? 150 : 100) * mult);
      if (res.headshot) stats.headshots++;
    }
  }
  if (res.kill) floatingText(prefix + (res.headshot ? 'KOPFSCHUSS! +160' : 'Erledigt +110'), point, res.headshot ? '#ffd21f' : '#ffffff');
  boardDirty = true;
}
function refreshBoard() {
  const training = gameMode === 'training' && state === 'playing';
  board.set((ctx, w) => {
    if (state === 'countdown') {
      text(ctx, `${MODES[gameMode].icon} ${MODES[gameMode].label}`, w / 2, 70, 44, '#9ad', 'center', true);
      text(ctx, countdown > 0.5 ? String(Math.ceil(countdown - 0.5)) : 'LOS!', w / 2, 200, 150, '#ffcc33', 'center', true);
      return;
    }
    const left = aliveCount() + toSpawn;
    text(ctx, waveBreak > 0 ? `Welle ${wave} überlebt! Nächste in ${Math.max(1, Math.ceil(waveBreak))}` : `Welle ${wave} · 🧟 ${left}`, w / 2, 56, waveBreak > 0 ? 44 : 56, '#fff', 'center', true);
    if (streakMsg && !training) text(ctx, streakMsg.text, w / 2, 282, 40, '#ff8a3a', 'center', true);
    // Lebensbalken
    const bx = 90, bw = w - 180, by = 104;
    ctx.fillStyle = '#333'; ctx.fillRect(bx, by, bw, 30);
    ctx.fillStyle = playerHp > 50 ? '#3ad35a' : playerHp > 25 ? '#f0b020' : '#e02a2a';
    ctx.fillRect(bx, by, bw * playerHp / 100, 30);
    text(ctx, `❤ ${Math.ceil(playerHp)}`, w / 2, by + 16, 24, '#fff', 'center', true);
    text(ctx, `💰 ${free() ? '∞' : points} · ${score} Punkte · Erledigt ${stats.kills} · 💣 ${grenadeSlots.filter(g => g.available).length}${holster ? ' · 🎒 ' + holster.def.name : ''}`, w / 2, 176, 26, '#cfd8e3', 'center', true);
    const act = [active.double > 0 ? `×2 Punkte ${Math.ceil(active.double)}s` : '', active.slowmo > 0 ? `⏳ Zeitlupe ${Math.ceil(active.slowmo)}s` : ''].filter(Boolean).join(' · ');
    if (act) text(ctx, act, w / 2, 214, 26, '#ffd21f', 'center', true);
  }, training ? row(238, 58, [{ id: 'end', label: '■ Training beenden', onClick: () => endRound(false) }], 768, 230) : []);
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
  const line2 = `${inRound() ? `❤${Math.ceil(playerHp)} 💰${free() ? '∞' : points} · ` : ''}${ammo} · ${modeName}${d.sight === 'scope' ? ` · ${w.zoom.toFixed(0)}x` : ''}`;
  let hint = '';
  if (mode(w) === 'safe') hint = `Gesichert – ${B}: entsichern`;
  else if (d.feed === 'mag' && !w.magInserted) hint = desk ? 'R: nachladen' : holding ? 'Magazin von unten einschieben' : 'Magazin vom Gürtel holen';
  else if (d.feed === 'mag' && w.chamber !== 'live' && w.magRounds === 0) hint = desk ? 'Leer – R: nachladen' : `Leer – ${A}: Magazin raus`;
  else if (d.feed === 'tube' && w.chamber !== 'live' && w.tube === 0) hint = desk ? 'Leer – R: nachladen' : holding ? 'Patrone unten einführen' : 'Patronen vom Gürtel holen';
  else if (w.chamber !== 'live' || w.actionOpen) {
    if (desk) hint = 'Lade durch…';
    else hint = { slide: `Schlitten ziehen (oder ${B})`, charge: 'Spannhebel zurückziehen', pump: 'Vorderschaft zurück & vor', bolt: 'Kammerstängel zurück & vor', none: 'Nachladen' }[d.action] || '';
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
function desktopReload() { if (deskW) autoReload(deskW); }
// automatisches Nachladen (PC und Einstellung "Nachladen: einfach")
function autoReload(w) {
  if (!w || w.desktopBusy) return;
  if (w.def.feed === 'mag' ? (w.magInserted && w.magRounds >= w.def.capacity) : w.tube >= w.def.capacity) { if (w.chamber !== 'live') cycleAction(w); return; }
  w.desktopBusy = true;
  let t = 0;
  if (w.def.feed === 'mag') {
    if (w.magInserted) { ejectMag(w); t += 0.5; }
    later(t, () => insertMag(w, w.def.capacity));
    t += 0.35;
  } else {
    const need = w.def.capacity - w.tube;
    for (let i = 0; i < need; i++) later(t + i * 0.3, () => { if (w.tube < w.def.capacity) w.tube++; SFX.shellIn(); boardDirty = true; });
    t += need * 0.3 + 0.1;
  }
  later(t, () => {
    if (w.chamber !== 'live') { actionBack(w); later(0.18, () => { actionForward(w); w.desktopBusy = false; }); }
    else w.desktopBusy = false;
  });
}
// Verschluss einmal durchladen (Pumpe/Kammerstängel automatisch)
function cycleAction(w, delay = 0) {
  if (w.desktopBusy) return;
  w.desktopBusy = true;
  later(delay, () => { actionBack(w); later(0.18, () => { actionForward(w); w.desktopBusy = false; }); });
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
  const mk = medkits.find(m => raycaster.ray.distanceToPoint(m.obj.position) < 0.2);
  if (mk) { collectMedkit(mk); return; }
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
  if (n >= 1 && n <= 9 && arsenal[n - 1]) equipDesk(arsenal[n - 1]);
  if (e.key === 'b' || e.key === 'B') { // nächsten Wandkauf benutzen
    let best = null, bd = Infinity;
    for (const wb of wallbuys) { const d = wb.group.position.distanceTo(camera.position); if (d < bd) { bd = d; best = wb; } }
    if (best) tryBuy(best, null);
  }
  if (e.key === 'k' || e.key === 'K') useBox(null);
  if (e.key === 'f' || e.key === 'F') desktopThrowKnife();
  if (e.key === 'p' || e.key === 'P') {
    let best = null, bd = Infinity;
    for (const o of openings()) { if (missingPlanks(o) <= 0) continue; const d = o.mid.distanceTo(camera.position); if (d < bd) { bd = d; best = o; } }
    if (best) { addPlank(best); SFX.thunk(); if (inRound()) award(10); }
  }
  if (e.key === 'g' || e.key === 'G') {
    const gs = grenadeSlots.find(x => x.available);
    if (gs) {
      gs.available = false; gs.obj.visible = false; gs.refill = 3;
      raycaster.setFromCamera(mouseNdc, camera);
      const g = makeGrenade();
      g.position.copy(raycaster.ray.origin).addScaledVector(raycaster.ray.direction, 0.4);
      scene.add(g);
      launchGrenade(g, raycaster.ray.direction.clone().multiplyScalar(8).add(new THREE.Vector3(0, 2, 0)), new THREE.Vector3(3, 1, 0));
      boardDirty = true;
    }
  }
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
  addOpening('door', v(-3.2, 0, -3.6), v(-3.2, 0, -2.6), headPos, 0, 2.05);
  addOpening('window', v(-0.6, 0, -5), v(0.6, 0, -5), headPos, 0.9, 2.0);
  addWallbuy(v(2.4, 1.35, -5), v(0, 0, 1));
  addWallbuy(v(-3.2, 1.35, -0.6), v(1, 0, 0));
  placeMysteryBoxSurface(v(2.6, 0, -1.6), Math.PI / 2);
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

// Fehler werden gemeldet, aber das Spiel läuft weiter (sonst friert die VR-Ansicht ein)
const errorEl = document.createElement('div');
errorEl.style.cssText = 'position:absolute;bottom:120px;left:16px;right:16px;color:#ffb0b0;font:12px monospace;white-space:pre-wrap;pointer-events:none';
document.body.appendChild(errorEl);
let errorCount = 0, lastErrorShown = -10;
function reportError(e) {
  errorCount++;
  console.error(e);
  errorEl.textContent = `Fehler (${errorCount}): ${e && e.message ? e.message : e}`;
  if (renderer.xr.isPresenting && elapsed - lastErrorShown > 5) {
    lastErrorShown = elapsed;
    try { floatingText('⚠ Fehler abgefangen – Spiel läuft weiter', inFront(1.2, 0, headPos.y), '#ff9090'); } catch { /* egal */ }
  }
}
window.addEventListener('error', (ev) => reportError(ev.error || ev.message));
window.addEventListener('unhandledrejection', (ev) => reportError(ev.reason));

renderer.setAnimationLoop(() => {
  try { frame(); }
  catch (e) {
    reportError(e);
    // Zustand nach einem Fehler mitten im Zielfernrohr-Rendern wiederherstellen
    renderer.xr.enabled = true;
    try { renderer.setRenderTarget(null); renderer.render(scene, camera); } catch { /* nächstes Bild */ }
  }
});
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  const xr = renderer.xr.isPresenting;
  if (!xr) camera.rotation.set(lookPitch, lookYaw, 0, 'YXZ');
  camera.updateMatrixWorld(true);
  getViewCamera().getWorldPosition(headPos);
  for (const h of hands) h.ray.updateMatrixWorld(true);
  if (shadowsOn) { // Schattenkamera folgt dem Spieler
    sun.target.position.set(headPos.x, 0, headPos.z);
    sun.position.set(headPos.x + 1.6, 5, headPos.z + 2.2);
    sun.target.updateMatrixWorld();
    renderer.shadowMap.needsUpdate = true;
  }
  for (let i = timers.length - 1; i >= 0; i--) {
    timers[i].t -= dt;
    if (timers[i].t <= 0) { const f = timers[i].fn; timers.splice(i, 1); f(); }
  }
  updateBelt(dt);
  if (xr) {
    readInputs();
    // Bedienfelder folgen, wenn man sich weit entfernt
    for (const p of [setupPanel, menuPanel]) if (p.visible && headPos.distanceTo(p.anchor) > 1.3) p === menuPanel ? enterMenu() : p.place(0.85, 0.65, -0.4);
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
  updateGrenades(dt);
  updatePlasmas(dt);
  updateMysteryBox(dt);
  updateWallbuys();
  updateWeaponExpiry();
  updatePlankGhost();
  updateMedkits(dt);
  updateZombies(active.slowmo > 0 ? dt * 0.35 : dt, headPos, { harmless: gameMode === 'training' });
  updatePowerups(dt);
  updateAtmosphere(dt);
  if (dirIndicator.visible) { dirIndicator.material.opacity -= dt * 0.9; if (dirIndicator.material.opacity <= 0) dirIndicator.visible = false; }
  if ((active.double > 0 || active.slowmo > 0) && Math.random() < dt * 3) boardDirty = true;
  nukeFlash = Math.max(0, nukeFlash - dt * 1.2);
  nukeMesh.material.opacity = nukeFlash * 0.85;
  nukeMesh.visible = nukeFlash > 0.01;
  getViewCamera().getWorldDirection(tmpV);
  setListener(headPos, tmpV, UP.clone().applyQuaternion(getViewCamera().getWorldQuaternion(tmpQ)));
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
}

// Für automatisierte Tests
window.__game = {
  renderer, get errors() { return errorCount; }, get plankPile() { return plankPilePos; }, hit: (r, p) => handleZombieHit(r, p), debugWave: (n) => { clearZombies(); wave = n - 1; waveBreak = 0; toSpawn = 0; nextWave(); }, get wave() { return wave; }, forceLightning: () => { lightningT = 0; }, spawnPowerup, powerups, active, get grenadeList() { return grenades.map(g => +g.fuse.toFixed(2)); }, medkits, spawnMedkit, get diff() { return diffKey; }, get state() { return state; }, get score() { return score; }, arsenal, hands, room, beltSlots, knives, looseMags, zombies, uiPanels, get playerHp() { return playerHp; }, set playerHp(v) { playerHp = v; },
  menuPanel, setupPanel, board, startButton, setup, get floorOffset() { return floorOffset; }, get bench() { return bench; }, startPressed, enterSetup, finishSetup, equipDesk, desktopReload,
  get deskW() { return deskW; }, get mode() { return gameMode; }, set mode(m) { gameMode = m; }, endRound,
  spawnWeapon, resetWeapons, settings, get points() { return points; }, set points(v) { points = v; }, wallbuys, mbox, useBox, tryBuy, giveWeapon, get holster() { return holster; }, plasmas, setTool, setupTriggerDown, setupTriggerUp, alignToLine, loadSlot, saveSlot, serializeRoom, setupWallbuys, setupMysteryBox, surfaceAt, updateSetup, get benchRack() { return benchRack; }
};
