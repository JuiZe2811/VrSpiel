import * as THREE from 'three';
import { VERSION } from './version.js?v=53';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { makePanel, panelBg, roundRect, MAT, cachedGeo, cylY, mergeStatic } from './util.js?v=53';
import { SFX, ensureAudio, setListener, SFX_PLAYER, SFX3D, setVolumes, musicStart, musicStop, musicUpdate, setAudioPaused } from './sfx.js?v=53';
import { fromTemplate, WEAPON_ORDER, WEAPON_DEFS, BUILDERS, MASS, createWeapon, buildWeapon, refillWeapon, makeMag, makeShell, makeCasing, makeCartridge, makeKnife, makeGrenade, scopeRT, scopeCam } from './weapons.js?v=53';
import { makeArrow, makeGlRound } from './weaponkit.js?v=53';
import { facesButtonVisible, setFaces } from './faces.js?v=53';
import { world, addDynamic, removeDynamic, localBoxOf, stepPhysics, dynamics, applyImpulse } from './physics.js?v=53';
import { room, addWall, addBox, makeWall, makeBox, rotateBox, removeSurface, clearRoom, setEditMode, suggestYaw, surfacesOf, importDetectedPlanes, saveRoom, loadRoom, hasSavedRoom, surfaceName, addWallbuy, serializeRoom, deserializeRoom, roomSlots, saveRoomSlot, loadRoomSlot, addOpening, makeOpening, roomOccluders, isOpening, setAtmosphere, heightAt, closeRoomGaps, closeRoom, openWallEnds } from './room.js?v=53';
import { initEffects, headRef, spawnTracer, spawnBeam, burst, floatingText, updateEffects, addDebris, updateDebris, shockwave, floorDecal, clearDecals, puff, sparks, surfaceDecal, fx, clearDebris } from './effects.js?v=53';
import { hpScale, walkable, initZombies, zombies, spawnZombie, updateZombies, zombieHitMeshes, damageZombie, clearZombies, aliveCount, zombieHeads, setupPlanks, clearPlanks, plankMeshes, buildNav, openings, explosionDamage, killAll, makePlankMesh, plankSlot, missingPlanks, addPlank, setZombieHooks, setEyeGlow, freezeZombie, setLure, lure, setCorpseTime, setWoundsMax } from './zombies.js?v=53';
import { giantModelReady, giantWarmup } from './giantmodel.js?v=53';
import { initBoss, spawnBoss, bossReady, currentBoss, bossGunName, GRENADE_LEVEL, bossWarmup, warriorReady, warriorSettled } from './boss.js?v=53';
const hyp = (a, b, c = 0) => Math.sqrt(a * a + b * b + c * c); // schneller als Math.hypot und ohne Speicher-Müll

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

// ---- Schwierigkeitsgrade -------------------------------------------------------------------
// hp/speed/count/atk: Zombies (Leben, Tempo, Anzahl, Schlag-Tempo) · dmg: Schaden am Spieler · points: Punkte-Faktor
// regenDelay/regenRate: Heilung (Sekunden ohne Treffer / Lebenspunkte pro Sekunde) · ammo: Reserve-Munition
// drops: Chance auf Medipacks & Power-ups · start: Extra-Startpunkte
const DIFFS = {
  easy: { label: 'Leicht', icon: '🙂', hp: 0.7, speed: 0.85, count: 0.8, atk: 0.75, dmg: 0.5, points: 1.3, regenDelay: 2.5, regenRate: 6, ammo: 1.5, drops: 1.5, start: 1000,
    desc: 'Leicht: schwache Zombies · halber Schaden · schnelle Heilung · +30 % Punkte' },
  normal: { label: 'Mittel', icon: '😐', hp: 1, speed: 1, count: 1, atk: 1, dmg: 1, points: 1, regenDelay: 4, regenRate: 3, ammo: 1, drops: 1, start: 0,
    desc: 'Mittel: das ausgewogene Spiel' },
  hard: { label: 'Schwer', icon: '😠', hp: 1.35, speed: 1.12, count: 1.25, atk: 1.15, dmg: 1.6, points: 0.85, regenDelay: 6, regenRate: 2, ammo: 0.8, drops: 0.7, start: 0,
    desc: 'Schwer: zähe Zombies · +60 % Schaden · langsame Heilung · weniger Punkte' },
  hardcore: { label: 'Hardcore', icon: '☠', hp: 1.7, speed: 1.25, count: 1.4, atk: 1.3, dmg: 5.5, points: 0.7, regenDelay: 10, regenRate: 1.5, ammo: 0.6, drops: 0.4, start: 0,
    desc: '☠ Hardcore: 2 Schläge = down · zähe Horden · kaum Heilung & Munition' }
};
let diffKey = (() => { try { return JSON.parse(localStorage.getItem('vrspiel-schwierigkeit')) || 'normal'; } catch { return 'normal'; } })();
if (!DIFFS[diffKey]) diffKey = 'normal';
const DIFF = () => DIFFS[diffKey];
let paused = false; // Pause-Menü (siehe setPaused)
const perks = new Set(); // getrunkene Getränke (früh angelegt: wird schon beim Start für die Munition gebraucht)
const scene = new THREE.Scene();
scene.matrixWorldAutoUpdate = false; // Leistung: Matrizen werden einmal pro Bild in frameInner aktualisiert (nicht nochmal in jedem render)
const desktopBackground = new THREE.Color(0x30343c);
const scopeBackground = new THREE.Color(0x2b3a31);
scene.background = desktopBackground;
const envTex = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = envTex;
scene.add(room.group);
initEffects(scene);
initZombies(scene, (dmg, z) => playerHit(dmg, z), (res, p) => handleZombieHit(res, p, '🎯 '), (z, big) => onGiantStomp(z, big));
initBoss(scene, { playerHit: (d, z) => playerHit(d, z), pulse: (i, ms) => hands.forEach(h => pulse(h, i, ms)), speak: (t) => speak(t) });

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 200);
camera.position.set(0, 1.6, 0);
scene.add(camera);
const hemi = new THREE.HemisphereLight(0xffffff, 0x666677, 1.2);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(1, 3, 2);
scene.add(sun, sun.target);
// Echte Schatten: Zombies & Waffen werfen Schatten auf den echten Boden (unsichtbarer "Schattenfänger")
let shadowFrame = 0, boardT = 0;
let shadowsOn = (() => { try { return localStorage.getItem('vrspiel-schatten') !== 'false'; } catch { return true; } })();
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // nur einmal pro Bild (nicht nochmal fürs Zielfernrohr)
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -4.5, right: 4.5, top: 4.5, bottom: -4.5, near: 0.5, far: 14 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.02;
sun.castShadow = shadowsOn;
// Schattenfläche folgt dem Spieler (kleinere Fläche = weniger Rechenaufwand)
const shadowFloor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.ShadowMaterial({ opacity: 0.42, depthWrite: false }));
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
  if (act && act.pulse && settings.haptics > 0) act.pulse(Math.min(1, intensity * settings.haptics), ms);
}
const heldWeapon = (h) => (h && h.held && h.held.type === 'weapon' ? h.held.w : null);
const otherHand = (h) => hands[1 - h.i];
const isFree = (h) => !h.held && !h.grab && !h.pull;

// =============================================================================
// Waffen: genau ein Exemplar pro Waffe, liegen mit Physik im Raum
// =============================================================================
// Alle Waffen, die gerade in der Welt existieren (Startwaffe + gekaufte/gezogene)
const arsenal = [];
// Reserve-Munition (begrenzt): Magazine am Gürtel zehren davon, „Volle Munition“ und Wandkauf füllen auf
const reserveMax = (def) => Math.max(def.capacity, Math.round((def.feed === 'mag' ? def.capacity * (def.tier >= 4 ? 2 : 4) : Math.max(6, def.capacity * 3)) * DIFF().ammo * (def.reserveK || 1) * (perks.has('muni') ? 1.5 : 1)));
function refillAmmo(w) { refillWeapon(w); w.reserve = reserveMax(w.def); boardDirty = true; }
function spawnWeapon(id, starter = false) {
  const w = createWeapon(id);
  w.reserve = reserveMax(w.def);
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
  disposeTree(w.root); // eigene (zusammengefasste) Geometrien freigeben – sonst wächst der Grafikspeicher mit jeder Runde
  const i = arsenal.indexOf(w);
  if (i >= 0) arsenal.splice(i, 1);
}
// Geometrien eines Objekts freigeben (geteilte/zwischengespeicherte bleiben erhalten)
function disposeTree(obj) { obj.traverse(o => { if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); }); }
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
    onLost: () => (w.starter ? holsterPistol(w) : disposeWeapon(w)),
    onImpact: (v) => SFX.thud(Math.min(0.6, v * 0.12))
  });
}
// Waffe aus der Aufrüst-Maschine lösen (egal auf welchem Weg sie genommen wird)
function releaseFromMachine(w) {
  if (upg.w === w) Object.assign(upg, { w: null, state: 'idle', t: 0 });
  w.inMachine = false;
  w.smoothQ = null; // alte Ausrichtung aus der Maschine nicht nachziehen
  w.mPrev = null; w.ballP = null; w.draw = 0; // Nahkampf/Flegel/Bogen: frisch anfangen
}
function takeWeapon(w, h) {
  releaseFromMachine(w);
  // aus einer anderen Hand lösen
  for (const o of hands) {
    if (heldWeapon(o) === w) o.held = null;
    if (o.grab && o.grab.w === w && o !== h) o.grab = null;
  }
  if (deskW === w) deskW = null;
  if (holster === w) { holster = null; w.holstered = false; w.root.visible = true; }
  if (w.inBelt) { w.inBelt = false; w.root.visible = true; if (pistolSlot) { pistolSlot.available = false; pistolSlot.obj.visible = false; } }
  if (w.phys) { removeDynamic(w.phys); w.phys = null; }
  if (w.root.parent !== scene) scene.add(w.root);
  w.lastTouch = elapsed;
  w.holder = h.i;
  w.twoHanding = false;
  h.held = { type: 'weapon', w };
  setBeltWeapon(w.id, w.def, w);
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
  // Startpistole an der Hüfte losgelassen: zurück ins Gürtel-Holster
  if (w.starter && nearHipHolster(h.point)) { holsterPistol(w); SFX.click(700, 0.4, 0.08); pulse(h, 0.5, 50); return; }
  // über der Schulter losgelassen: ins Rückenholster stecken
  if (inHolsterZone(h.point)) {
    const old = holster;
    holster = w;
    w.holstered = true;
    w.root.visible = false;
    w.root.position.set(0, -10, 0);
    SFX.click(700, 0.4, 0.08);
    pulse(h, 0.6, 60);
    boardDirty = true;
    if (old) { old.holstered = false; old.root.visible = true; takeWeapon(old, h); } // tauschen: Waffe vom Rücken in die Hand
    return;
  }
  makeLoose(w, throwIt ? h.vel.clone().multiplyScalar(1.2) : new THREE.Vector3(), throwIt ? h.angVel.clone() : new THREE.Vector3());
  SFX.grab();
}
// Rückenholster: hinter den Schultern (links oder rechts)
// Rückenholster: großzügige Zone hinter/über beiden Schultern
function inHolsterZone(p) {
  getViewCamera().getWorldDirection(tmpV3);
  const f = tmpV3.setY(0).normalize();
  const side = new THREE.Vector3(-f.z, 0, f.x);
  const base = headPos.clone().addScaledVector(f, -0.1).add(new THREE.Vector3(0, -0.12, 0));
  const rel = p.clone().sub(headPos);
  const behind = rel.dot(f) < 0.05 && p.y > headPos.y - 0.45 && p.y < headPos.y + 0.25 && hyp(rel.x, rel.z) < 0.5;
  return behind || p.distanceTo(base.clone().addScaledVector(side, 0.18)) < 0.34 || p.distanceTo(base.clone().addScaledVector(side, -0.18)) < 0.34;
}
// Hüft-Holster der Pistole: großzügig um den Platz an der rechten Hüfte bzw. seitlich am Gürtel
function nearHipHolster(p) {
  if (!pistolSlot) return false;
  if (p.distanceTo(pistolSlot.obj.getWorldPosition(tmpV)) < 0.3) return true;
  const dy = p.y - belt.position.y, dr = hyp(p.x - belt.position.x, p.z - belt.position.z);
  return Math.abs(dy) < 0.22 && dr < BELT_R + 0.25 && dr > BELT_R - 0.1;
}
function releaseGrab(h) {
  const g = h.grab;
  if (!g) return;
  if (g.back) actionForward(g.w); // Federkraft schiebt nach vorne
  h.grab = null;
}

// ---- Kein Waffenständer mehr: die Startpistole steckt im Holster am Gürtel ------------------
let bench = null; // (alter Waffenständer – wird nicht mehr benutzt)
const plankPilePos = new THREE.Vector3(0, -10, 0);
function setupBench() { /* Waffenständer entfernt */ }
function placeOnBench(list) { for (const w of list) if (w.starter) holsterPistol(w); else makeLoose(w); }
// Startpistole ins Holster stecken (unsichtbar, im Holster wird ein Modell gezeigt)
function holsterPistol(w) {
  if (w.phys) { removeDynamic(w.phys); w.phys = null; }
  for (const h of hands) { if (heldWeapon(h) === w) h.held = null; if (h.grab && h.grab.w === w) h.grab = null; }
  if (deskW === w) { deskW = null; camera.remove(w.root); }
  if (w.root.parent !== scene) scene.add(w.root);
  w.holder = -1;
  w.inBelt = true;
  w.root.visible = false;
  w.root.position.set(0, -10, 0);
  if (pistolSlot) { pistolSlot.available = true; pistolSlot.obj.visible = true; }
}
const starterPistol = () => arsenal.find(w => w.starter);
// Waffen zurücksetzen: gekaufte weg (optional), alle voll, Pistole in die rechte Hand (bzw. ins Holster)
function resetWeapons(removeBought = false, toHand = true) {
  if (removeBought) for (const w of [...arsenal]) if (!w.starter) disposeWeapon(w);
  for (const w of arsenal) if (w.holder < 0 && w !== deskW) refillAmmo(w);
  const p0 = starterPistol();
  if (!p0) return;
  if (p0.holder < 0 && p0 !== deskW) holsterPistol(p0);
  if (!toHand) return;
  if (renderer.xr.isPresenting) {
    const right = hands[1];
    if (right && right.src && !right.held && p0.inBelt) takeWeapon(p0, right);
  } else if (!deskW) equipDesk(p0);
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
// Elektroschock (Getränk): beim Nachladen ein Blitzschlag rund um den Spieler (höchstens alle 2,5 s)
let shockT = -10;
function electroShock() {
  if (!perks.has('elektro') || !inRound() || elapsed - shockT < 2.5) return;
  shockT = elapsed;
  SFX.zap();
  const dmg = 60 * Math.max(1, Math.pow(hpScale(wave), 0.75));
  for (const z of [...zombies]) {
    if (z.state === 'dead' || hyp(z.pos.x - headPos.x, z.pos.z - headPos.z) > 2.6) continue;
    const c = z.root.position.clone().setY(1);
    lightningLine(headPos.clone().setY(headPos.y - 0.5), c);
    handleZombieHit(damageZombie((z.hitTorso || z.torso.children[1]), c, c.clone().sub(headPos).setY(0).normalize(), dmg, true), c, 'ϟ ');
    if (z.state !== 'dead') z.slowT = Math.max(z.slowT || 0, 1.5);
  }
  burst(headPos.clone().setY(headPos.y - 0.6), 0x66ddff, 20);
}
function ejectMag(w) {
  if (w.def.feed !== 'mag' || !w.magInserted) return;
  electroShock();
  w.magInserted = false;
  const mag = w.parts.mag;
  mag.updateWorldMatrix(true, false);
  const drop = makeMag(w.id);
  mag.matrixWorld.decompose(drop.position, drop.quaternion, tmpS);
  w.root.getWorldQuaternion(tmpQ);
  w.reserve = (w.reserve || 0) + w.magRounds; // Restpatronen gehen nicht verloren
  dropMagObject(drop, w.id, 0, new THREE.Vector3(0, -1.2, 0).applyQuaternion(tmpQ));
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
  if (w.def.spinUp && (w.spinV || 0) < 1) return false; // Minigun: Läufe drehen noch hoch
  if (mode(w) === 'safe' || w.actionOpen || w.chamber !== 'live') { SFX.dry(); pulse(h, 0.15, 20); return false; }
  w.chamber = 'spent';
  w.cooldown = 60 / (w.def.rpm * (perks.has('turbo') ? 1.33 : 1));
  w.recoil = 1;
  w.recoilSide = THREE.MathUtils.randFloatSpread(1);
  // Rückstoß je nach Griff: mit zwei Händen ruhig, Gewehr einhändig springt stark
  w.recoilGrip = w.twoHanding ? 0.6 : w.def.twoHand ? 1.45 : 1;
  // Dauerfeuer zieht die Mündung nach oben (mit zwei Händen gut kontrollierbar)
  if (w.def.autoCycle && w.def.rpm >= 400) w.climb = Math.min(1, (w.climb || 0) + (w.twoHanding ? 0.05 : 0.12));
  SFX.shot(w.def);
  // Vibration passend zur Waffe: kurz und leicht (MP) bis lang und hart (Flinte, Scharfschütze)
  const kick = THREE.MathUtils.clamp((w.def.dmg || 30) / 60 + (w.def.pellets > 1 ? 0.5 : 0), 0.35, 1);
  pulse(h, kick, 30 + kick * 90);
  if (w.twoHanding && h) pulse(otherHand(h), kick * 0.6, 20 + kick * 60);
  const origin = new THREE.Vector3(), dir = new THREE.Vector3();
  if (desktopRay) { origin.copy(desktopRay.origin); dir.copy(desktopRay.direction); }
  else {
    w.sockets.sightRear.getWorldPosition(origin);
    w.sockets.sightFront.getWorldPosition(dir).sub(origin).normalize();
  }
  let spread = w.def.spread * (perks.has('kopf') ? 0.6 : 1);
  if (w.def.twoHand && !w.twoHanding && h) spread += 0.012; // einhändig unruhiger
  const muzzlePos = w.sockets.muzzle.getWorldPosition(new THREE.Vector3());
  flashLight.position.copy(muzzlePos);
  flashLight.distance = 2.5;
  flashLight.intensity = 4;
  puff(muzzlePos, 0xcfcfcf, w.def.pellets > 1 ? 0.09 : 0.05, 1.0, 0.12, w.def.pellets > 1 ? 0.45 : 0.3);
  if (w.parts.spin) w.parts.spin.rotation.z += Math.PI / 3; // Revolvertrommel dreht weiter
  if (w.def.projectile) { // Plasmakugel bzw. Armbrustbolzen statt Sofort-Treffer
    if (w.def.projectile === 'bolt') { if (settings.assist && !desktopRay) shotAssist(origin, dir); launchArrow(muzzlePos, dir.clone(), weaponDmg(w)); }
    else if (w.def.projectile === 'grenade') launchArrow(muzzlePos, dir.clone().add(new THREE.Vector3(0, 0.06, 0)).normalize(), weaponDmg(w), 'grenade');
    else launchPlasma(muzzlePos, dir.clone(), weaponDmg(w));
    if (w.def.autoCycle) { ejectChamber(w); if (!feed(w)) w.actionOpen = w.def.holdOpen; w.cycleAnim = 1; }
    if (inRound()) stats.shots++;
    boardDirty = true;
    return true;
  }
  if (w.def.sonic) { // Schallkanone: Druckwellen-Kegel
    sonicShot(muzzlePos, dir, weaponDmg(w), w.def.upgraded);
    if (w.def.autoCycle) { ejectChamber(w); if (!feed(w)) w.actionOpen = w.def.holdOpen; }
    if (inRound()) stats.shots++;
    boardDirty = true;
    return true;
  }
  if (w.def.flame || w.def.freeze) { // Flammen- bzw. Froststrahl (Kegel statt einzelner Kugel)
    if (w.def.flame) flameShot(muzzlePos, dir, weaponDmg(w), w.def.upgraded); else frostShot(muzzlePos, dir, weaponDmg(w), w.def.upgraded);
    if (w.def.autoCycle) { ejectChamber(w); if (!feed(w)) w.actionOpen = w.def.holdOpen; }
    if (inRound()) stats.shots++;
    boardDirty = true;
    return true;
  }
  if (settings.assist && !desktopRay) shotAssist(origin, dir);
  const cands = [...zombieHitMeshes(), ...plankMeshes(), ...roomOccluders(), ...(startButton.visible ? startButton.userData.hit : [])];
  const dmg = weaponDmg(w);
  let startHit = null;
  if (w.def.chain) { // Blitzwerfer: Kettenblitz
    raycaster.set(origin, dir);
    raycaster.far = 40;
    const hit = raycaster.intersectObjects(cands, false)[0];
    teslaStrike(muzzlePos, hit, dir, dmg, w.def.chain + (w.def.upgraded ? 4 : 0));
    if (hit && hit.object.userData.isStart) startHit = hit;
  }
  for (let p = 0; p < (w.def.chain ? 0 : w.def.pellets); p++) {
    const d = dir.clone();
    if (spread > 0) d.add(new THREE.Vector3().randomDirection().multiplyScalar(spread * Math.sqrt(Math.random()))).normalize();
    raycaster.set(origin, d);
    raycaster.far = 200;
    const all = raycaster.intersectObjects(cands, false);
    // Durchschlag (Panzerbüchse): mehrere Zombies hintereinander, Wände stoppen
    let hit = all[0], pierced = 0;
    const seen = new Set();
    for (const hh of w.def.pierce ? all : all.slice(0, 1)) {
      if (!w.def.pierce) break;
      const z = hh.object.userData.zombie;
      if (!z) { if (hh.object.userData.plank) { burst(hh.point, 0xb08850, 6); continue; } hit = hh; break; }
      if (seen.has(z)) continue;
      seen.add(z);
      const res = damageZombie(hh.object, hh.point, d, dmg * Math.pow(w.def.pierceKeep || 0.8, pierced), false, headMultOf(w));
      onBulletHit(w, z, res, hh.point, dmg);
      if (w.def.incendiary && res && !res.kill) ignite(z, w.def.incendiary);
      if (w.def.explodeKill && res && res.kill && res.headshot) killBlast(hh.point);
      handleZombieHit(res, hh.point, pierced ? '🎯 ' : '');
      hit = hh;
      if (++pierced >= w.def.pierce) break;
    }
    if (w.def.beam) { if (p === 0) spawnBeam(muzzlePos, hit ? hit.point : origin.clone().addScaledVector(d, 30), w.def.beam); }
    else if (p < 3) spawnTracer(muzzlePos, hit ? hit.point : origin.clone().addScaledVector(d, 60));
    if (!hit) continue;
    const ud = hit.object.userData;
    if (ud.isStart) { startHit = hit; continue; }
    if (ud.surface) { if (p < 4) wallImpact(hit, d); if (w.def.ricochet) ricochet(w, hit, d, dmg * 0.8, w.def.ricochet); continue; }
    if (ud.plank) { burst(hit.point, 0xb08850, 6); continue; }
    if (ud.zombie) {
      if (!w.def.pierce) { const res = damageZombie(hit.object, hit.point, d, dmg, false, headMultOf(w)); if (w.def.incendiary && res && !res.kill) ignite(ud.zombie, w.def.incendiary); onBulletHit(w, ud.zombie, res, hit.point, dmg); handleZombieHit(res, hit.point); }
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
  if (mode(w) === 'burst' && !w.inBurst) w.burst = 2; // Salve: noch zwei Schuss
  if (inRound()) stats.shots++;
  boardDirty = true;
  if (startHit) { burst(startHit.point, 0x33ff77, 20); startPressed(); }
  return true;
}
// Salve fortsetzen (läuft auch nach dem Loslassen des Abzugs weiter)
function continueBurst(w, fire) {
  if (!(w.burst > 0) || w.cooldown > 0) return;
  w.burst--;
  w.inBurst = true;
  if (mode(w) !== 'burst' || w.chamber !== 'live' || !fire()) w.burst = 0;
  w.inBurst = false;
}
// Schaden einer Waffe (aufgerüstet: doppelt)
const weaponDmg = (w) => (w.def.dmg ?? DAMAGE[w.id] ?? 30) * (activeInstakill() ? 50 : 1) * (perks.has('doppel') ? 1.35 : 1);
const headMultOf = (w) => (w.def.headMult || 3) + (perks.has('kopf') ? 1 : 0); // Adlerauge: Kopfschuss +1

// =============================================================================
// Gürtel mit Munition und Messer
// =============================================================================
const belt = new THREE.Group();
scene.add(belt);
const BELT_R = 0.17;
const beltSlots = [];
let beltWeaponId = null, beltDef = null, beltYaw = 0;
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
const grenadeSlots = [0, 1].map(k => { // zwei Granaten übereinander an einer Stelle (links)
  const mount = beltMount(-0.75);
  mount.position.y = -k * 0.07;
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
// ---- Trommel-Affe (Lockvogel): aufziehbares Blechspielzeug mit Trommel ----------------
const monkeyMats = {
  fur: new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.9 }),
  face: new THREE.MeshStandardMaterial({ color: 0xe0b88a, roughness: 0.7 }),
  eye: new THREE.MeshBasicMaterial({ color: 0x111111 }),
  drum: new THREE.MeshStandardMaterial({ color: 0xc8202a, roughness: 0.4, metalness: 0.3 }),
  drumTop: new THREE.MeshStandardMaterial({ color: 0xf2eee0, roughness: 0.6 }),
  vest: new THREE.MeshStandardMaterial({ color: 0x2a4fb0, roughness: 0.6 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xd4a83a, roughness: 0.3, metalness: 1 }),
  light: new THREE.MeshBasicMaterial({ color: 0xff3a3a, toneMapped: false })
};
function makeMonkey() { // aus einer Vorlage klonen (teilt Geometrie → kein Speicher-Zuwachs pro Affe)
  const g = fromTemplate('monkey', buildMonkey);
  g.userData = { arms: [g.getObjectByName('arm0'), g.getObjectByName('arm1')], key: g.getObjectByName('key'), light: g.getObjectByName('light') };
  return g;
}
function buildMonkey() {
  const g = new THREE.Group();
  const sph = (r, mat, x, y, z, sx = 1, sy = 1, sz = 1) => { const m = new THREE.Mesh(cachedGeo('mk' + r, () => new THREE.SphereGeometry(r, 14, 10)), mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); g.add(m); return m; };
  sph(0.032, monkeyMats.vest, 0, 0.045, 0, 1, 1.15, 0.9);           // Körper mit Weste
  sph(0.026, monkeyMats.fur, 0, 0.1, 0);                             // Kopf
  sph(0.016, monkeyMats.face, 0, 0.094, 0.018, 1.1, 0.8, 0.7);       // Schnauze
  for (const x of [-0.009, 0.009]) sph(0.0045, monkeyMats.eye, x, 0.108, 0.021);
  for (const x of [-0.026, 0.026]) sph(0.011, monkeyMats.face, x, 0.104, 0, 0.5, 1, 1); // Ohren
  for (const x of [-0.018, 0.018]) sph(0.012, monkeyMats.fur, x, 0.004, 0.01, 1, 0.7, 1.4); // Füße
  // Trommel vor dem Bauch
  const drum = new THREE.Mesh(cachedGeo('mkdrum', () => new THREE.CylinderGeometry(0.026, 0.026, 0.026, 18)), monkeyMats.drum);
  drum.position.set(0, 0.04, 0.034);
  g.add(drum);
  const top = new THREE.Mesh(cachedGeo('mkdrumtop', () => new THREE.CylinderGeometry(0.0262, 0.0262, 0.004, 18)), monkeyMats.drumTop);
  top.position.set(0, 0.054, 0.034);
  g.add(top);
  // Arme mit Trommelstöcken (bewegen sich beim Trommeln)
  const arms = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(sx * 0.03, 0.07, 0.006);
    const a = new THREE.Mesh(cachedGeo('mkarm', () => new THREE.CapsuleGeometry(0.007, 0.03, 4, 8)), monkeyMats.fur);
    a.rotation.x = 1.1; a.position.set(0, -0.008, 0.014);
    arm.add(a);
    const stick = new THREE.Mesh(cachedGeo('mkstick', () => new THREE.CylinderGeometry(0.002, 0.002, 0.04, 6)), monkeyMats.drumTop);
    stick.rotation.x = 0.4; stick.position.set(-sx * 0.006, -0.012, 0.04);
    arm.add(stick);
    g.add(arm);
    arms.push(arm);
  }
  // Aufziehschlüssel am Rücken + Warnlicht auf dem Kopf
  const key = new THREE.Group();
  key.position.set(0, 0.05, -0.03);
  key.add(new THREE.Mesh(cachedGeo('mkkey1', () => new THREE.CylinderGeometry(0.003, 0.003, 0.02, 6).rotateX(Math.PI / 2)), monkeyMats.brass));
  const bow = new THREE.Mesh(cachedGeo('mkkey2', () => new THREE.TorusGeometry(0.01, 0.003, 6, 12)), monkeyMats.brass);
  bow.position.z = -0.012;
  key.add(bow);
  g.add(key);
  const light = sph(0.006, monkeyMats.light, 0, 0.128, 0);
  mergeStatic(g, { light }); // Leistung: Teile mit gleichem Material zusammenfassen (Arme und Schlüssel bleiben beweglich)
  arms.forEach((a, i) => { a.name = 'arm' + i; });
  key.name = 'key'; light.name = 'light';
  return g;
}
let monkeyCount = 1;
const monkeySlot = (() => {
  const mount = beltMount(-1.75);
  const m = makeMonkey();
  m.position.set(0, -0.04, -0.03);
  m.rotation.y = Math.PI;
  mount.add(m);
  const slot = { kind: 'monkey', mount, obj: m, available: true, refill: 0, radius: 0.13 };
  beltSlots.push(slot);
  return slot;
})();
// Pistolen-Holster (rechte Hüfte) und Bretter (vorne) am Gürtel
let pistolSlot = null;
{
  const mount = beltMount(1.35);
  const hol = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.13, 0.05), leather);
  hol.position.set(0, -0.06, -0.03);
  mount.add(hol);
  const show = buildWeapon('pistol').root;
  show.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  show.position.set(0, 0.02, -0.035);
  mount.add(show);
  pistolSlot = { kind: 'pistol', mount, obj: show, available: false, refill: 0, radius: 0.14 };
  show.visible = false;
  beltSlots.push(pistolSlot);
}
function syncMonkeySlot() { monkeySlot.available = monkeyCount > 0; monkeySlot.obj.visible = monkeyCount > 0; boardDirty = true; }
// einzelne Munition: Schrotpatrone, Revolverpatrone oder Armbrustbolzen
function beltAmmoObj(def) {
  if (def.ammo === 'round') { const o = makeCartridge(true); o.scale.setScalar(1.4); return o; }
  if (def.ammo === 'gl') { const o = makeGlRound(); o.scale.setScalar(0.9); return o; }
  if (def.ammo === 'bolt') { const o = makeArrow(); o.rotation.x = Math.PI / 2; o.scale.setScalar(0.7); const g = new THREE.Group(); g.add(o); return g; }
  return makeShell();
}
let beltW = null; // Waffe, deren Munition gerade am Gürtel hängt
function setBeltWeapon(id, def = null, w = null) {
  if (w) beltW = w;
  const wdef = def || WEAPON_DEFS[id];
  if (id === beltWeaponId && wdef === beltDef) return;
  beltWeaponId = id;
  beltDef = wdef;
  for (let i = beltSlots.length - 1; i >= 0; i--) {
    if (beltSlots[i].kind !== 'mag' && beltSlots[i].kind !== 'shell') continue; // nur Munition austauschen
    belt.remove(beltSlots[i].mount);
    beltSlots.splice(i, 1);
  }
  def = wdef;
  for (const side of [1]) { // nur noch ein Munitionsplatz (rechts vorne)
    const mount = beltMount(side * 0.5 * settings.snapBelt);
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
      const round = def.ammo === 'round', bolt = def.ammo === 'bolt' || def.ammo === 'gl';
      for (let k = 0; k < (round ? 5 : bolt ? 2 : 4); k++) {
        const sh = beltAmmoObj(def);
        sh.position.set(round ? -0.04 + k * 0.02 : bolt ? -0.02 + k * 0.04 : -0.036 + k * 0.024, 0.008, -0.027);
        mount.add(sh);
        beltSlots.push({ kind: 'shell', mount, obj: sh, available: true, refill: 0, radius: 0.12 });
      }
    }
  }
}
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
function updateBelt(dt) {
  // Gürtel zeigt immer Munition für eine Waffe, die man gerade in der Hand hat (bei zwei Waffen: die, die nachgeladen werden muss)
  const hw = [heldWeapon(hands[0]), heldWeapon(hands[1]), deskW].filter(Boolean);
  if (hw.length && !hw.includes(beltW)) {
    const need = hw.find(w => (w.def.feed === 'mag' ? !w.magInserted || w.magRounds === 0 : w.tube < w.def.capacity)) || hw[0];
    setBeltWeapon(need.id, need.def, need);
  }
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
    if (s.kind === 'monkey' || s.kind === 'pistol') continue; // eigene Logik
    if ((s.kind === 'mag' || s.kind === 'shell') && beltW && beltW.reserve <= 0) continue; // keine Munition mehr
    s.refill -= dt;
    if (s.refill <= 0) { s.available = true; s.obj.visible = true; }
  }
  // Munition leer: Platz leeren
  if (beltW && beltW.reserve <= 0) for (const s of beltSlots) if ((s.kind === 'mag' || s.kind === 'shell') && s.available) { s.available = false; s.obj.visible = false; s.refill = 0.5; }
  // Anzeige über der Munition: wie viel Schuss noch in Reserve
  const res = beltW ? beltW.reserve : 0, txt = beltW ? (res > 0 ? `${res}` : 'LEER') : '';
  if (txt !== ammoLabel.txt) {
    ammoLabel.txt = txt;
    ammoLabel.p.draw((ctx, w, h) => {
      if (!txt) return;
      roundRect(ctx, 2, 2, w - 4, h - 4, 14);
      ctx.fillStyle = res > 0 ? 'rgba(0,0,0,0.65)' : 'rgba(120,0,0,0.75)'; ctx.fill();
      ctx.fillStyle = res > (beltDef ? beltDef.capacity : 0) ? '#ffffff' : '#ffcc33';
      ctx.font = 'bold 60px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(txt, w / 2, h / 2 + 3);
    });
  }
  const am = beltSlots.find(s => s.kind === 'mag' || s.kind === 'shell');
  ammoLabel.p.mesh.visible = !!(am && beltW && (beltW.holder >= 0 || beltW === deskW));
  if (am) { am.mount.getWorldPosition(ammoLabel.p.mesh.position); ammoLabel.p.mesh.position.y += 0.1; ammoLabel.p.mesh.lookAt(headPos); }
  belt.updateMatrixWorld(true);
}
const ammoLabel = { p: makePanel(0.075, 0.04, 2400), txt: null };
ammoLabel.p.mesh.renderOrder = 30;
scene.add(ammoLabel.p.mesh);
function holdItem(h, type, obj, extra = {}) {
  obj.position.set(0, 0.05, -0.03);
  obj.quaternion.setFromEuler(new THREE.Euler(-0.3, 0, 0));
  if (type === 'knife') { obj.position.set(0, -0.045, 0.015); obj.quaternion.identity(); }
  if (type === 'grenade') { obj.position.set(0, -0.03, -0.01); obj.quaternion.identity(); }
  if (type === 'monkey') { obj.position.set(0, -0.06, -0.02); obj.quaternion.identity(); }
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
  const dr = hyp(h.point.x - belt.position.x, h.point.z - belt.position.z);
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
  if (best.kind === 'monkey') { monkeyCount--; holdItem(h, 'monkey', makeMonkey()); syncMonkeySlot(); return true; }
  if (best.kind === 'pistol') { const p0 = starterPistol(); if (p0) takeWeapon(p0, h); return true; }
  if (best.kind === 'knife') holdItem(h, 'knife', makeKnife());
  else if (best.kind === 'grenade') holdItem(h, 'grenade', makeGrenade(), { slot: best });
  else if (best.kind === 'mag') {
    // Magazin immer für die Waffe in der ANDEREN Hand (die man gerade nachlädt)
    const target = heldWeapon(otherHand(h));
    if (target && target !== beltW && target.def.feed === 'mag') setBeltWeapon(target.id, target.def, target);
    if (beltW && beltW.reserve <= 0) { best.available = true; best.obj.visible = true; SFX.dry(); floatingNoAmmo(beltW); return false; } // keine leeren Magazine austeilen
    const n = beltW ? Math.min(beltDef.capacity, beltW.reserve) : beltDef.capacity;
    if (beltW) beltW.reserve -= n;
    holdItem(h, 'mag', makeMag(beltWeaponId), { weaponId: beltWeaponId, rounds: n });
  } else { if (beltW) beltW.reserve = Math.max(0, beltW.reserve - 1); holdItem(h, 'shell', beltAmmoObj(WEAPON_DEFS[beltWeaponId])); }
  boardDirty = true;
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
    const d = hyp(to.x, to.z);
    if (d < 0.5 || d > 14) continue;
    const ang = flat.angleTo(new THREE.Vector3(to.x, 0, to.z).normalize());
    if (ang < bestAng) { bestAng = ang; best = c; }
  }
  if (!best) return vel;
  const to = best.clone().sub(pos);
  const d = hyp(to.x, to.z), hgt = to.y, g = 9.81;
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
  slowmo: { icon: '⏳', name: 'Zeitlupe', color: '#c48aff' },
  instakill: { icon: '☠', name: 'Sofort-Tod', color: '#ff4a4a' },
  planks: { icon: '🔨', name: 'Holzhammer', color: '#e0a65a' } // alle Bretter sofort wieder angenagelt
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
const active = { double: 0, slowmo: 0, instakill: 0 };
const activeInstakill = () => active.instakill > 0;
function spawnPowerup(pos, type) {
  if (!type) { // Holzhammer nur, wenn auch Bretter fehlen
    const types = Object.keys(POWERUPS).filter(t => t !== 'planks' || openings().some(o => missingPlanks(o) > 0));
    type = types[Math.floor(Math.random() * types.length)];
  }
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
    else take = hyp(camera.position.x - pu.obj.position.x, camera.position.z - pu.obj.position.z) < 1.0;
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
  SFX.powerup();
  for (const h of hands) pulse(h, 0.8, 120);
  floatingText(P.name + '!', pu.obj.position.clone(), P.color);
  if (pu.type === 'double') active.double = 20;
  if (pu.type === 'slowmo') active.slowmo = 10;
  if (pu.type === 'instakill') active.instakill = 20;
  if (pu.type === 'ammo') { for (const w of arsenal) refillAmmo(w); refillGrenades(); }
  if (pu.type === 'planks') { // Holzhammer: alle Bretter an allen Türen & Fenstern wieder dran
    let n = 0;
    for (const o of openings()) while (missingPlanks(o) > 0) { addPlank(o); n++; }
    for (let i = 0; i < Math.min(6, n); i++) later(i * 0.09, () => SFX.thunk());
    if (inRound()) award(200);
    floatingText(`🔨 ${n} Bretter +200`, headPos.clone().add(new THREE.Vector3(0, -0.2, -1).applyQuaternion(getViewCamera().getWorldQuaternion(tmpQ))), '#e0a65a');
  }
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
// Schwebende Staubteilchen im Raum (Atmosphäre, sehr günstig: ein einziges Points-Objekt)
const DUST_N = 260;
const dustGeo = new THREE.BufferGeometry();
const dustPos = new Float32Array(DUST_N * 3);
for (let i = 0; i < DUST_N; i++) { dustPos[i * 3] = (Math.random() - 0.5) * 8; dustPos[i * 3 + 1] = Math.random() * 2.6; dustPos[i * 3 + 2] = (Math.random() - 0.5) * 8; }
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: 0.012, color: 0xd8cfb8, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending, map: (() => { const c = document.createElement('canvas'); c.width = c.height = 16; const g = c.getContext('2d'); const gr = g.createRadialGradient(8, 8, 0, 8, 8, 8); gr.addColorStop(0, '#fff'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 16, 16); return new THREE.CanvasTexture(c); })() }));
dust.frustumCulled = false;
scene.add(dust);
function updateDust(dt) {
  const a = dustGeo.attributes.position.array;
  for (let i = 0; i < DUST_N; i++) {
    const k = i * 3;
    a[k] += Math.sin(elapsed * 0.3 + i) * dt * 0.02;
    a[k + 1] += (Math.sin(elapsed * 0.2 + i * 1.7) * 0.5 - 0.15) * dt * 0.03;
    a[k + 2] += Math.cos(elapsed * 0.25 + i * 0.7) * dt * 0.02;
    // um den Spieler herum halten
    if (a[k] - headPos.x > 4) a[k] -= 8; else if (a[k] - headPos.x < -4) a[k] += 8;
    if (a[k + 2] - headPos.z > 4) a[k + 2] -= 8; else if (a[k + 2] - headPos.z < -4) a[k + 2] += 8;
    if (a[k + 1] < 0) a[k + 1] += 2.6; else if (a[k + 1] > 2.6) a[k + 1] -= 2.6;
  }
  dustGeo.attributes.position.needsUpdate = true;
}
// ---- Leistung: höchstens so viele Zombies gleichzeitig; bei Rucklern automatisch Details reduzieren ----
// Leistungsprofile: Auflösung, Foveated Rendering, Schatten-Takt, Zombie-Obergrenze
const QUALITY = {
  quality: { scale: 1.0, fov: 0.5, shadowEvery: 1, maxAlive: 16, shadowMap: 1024, wounds: 5, soft: true, env: true },
  balanced: { scale: 0.9, fov: 1, shadowEvery: 2, maxAlive: 14, shadowMap: 1024, wounds: 3, soft: false, env: false },
  fast: { scale: 0.75, fov: 1, shadowEvery: 3, maxAlive: 12, shadowMap: 512, wounds: 0, soft: false, env: false }
};
const Q = () => QUALITY[settings.quality] || QUALITY.balanced;
let MAX_ALIVE = 16;
function applyQuality() {
  const q = Q();
  MAX_ALIVE = q.maxAlive;
  setWoundsMax(q.wounds);
  if (sun.shadow.mapSize.x !== q.shadowMap) { sun.shadow.mapSize.set(q.shadowMap, q.shadowMap); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  if (!renderer.xr.isPresenting) renderer.xr.setFramebufferScaleFactor(q.scale); // wirkt beim nächsten VR-Start
  try { renderer.xr.setFoveation(q.fov); } catch { /* nicht unterstützt */ }
  // Schattenart und Umgebungsspiegelungen (beides kostet bei jedem Pixel Rechenzeit)
  const type = q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  const env = q.env ? envTex : null;
  if (renderer.shadowMap.type !== type || scene.environment !== env) {
    renderer.shadowMap.type = type;
    scene.environment = env;
    hemi.intensity = q.env ? 1.2 : 1.55; // ohne Spiegelungen etwas mehr Grundlicht
    scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.needsUpdate = true; }); });
  }
}
const perf = { ema: 0, slowT: 0, level: 0, okT: 0 };
// Bildrate der Brille (Quest: 72/90/120 Hz). Höher = flüssiger.
function applyFrameRate() {
  const session = renderer.xr.getSession && renderer.xr.getSession();
  if (!session || !session.updateTargetFrameRate || !session.supportedFrameRates) return;
  const rates = [...session.supportedFrameRates].sort((a, b) => a - b);
  const want = settings.frameRate > 72 && perf.lowHz ? 72 : settings.frameRate;
  const best = rates.filter(r => r <= want + 0.5).pop() || rates[0];
  if (best && Math.abs((session.frameRate || 0) - best) > 0.5) session.updateTargetFrameRate(best).catch(() => {});
}
// Automatisch flüssig halten – nur VORÜBERGEHEND (nichts wird dauerhaft abgeschaltet):
// zuerst Bildrate auf 72 Hz, dann Staub, dann Schatten, dann Augenleuchten. Läuft es wieder lange gut,
// kommen die Details Schritt für Schritt zurück.
function autoPerf(raw) {
  if (!settings.autoPerf || !renderer.xr.isPresenting || raw <= 0 || raw > 0.5) return;
  const session = renderer.xr.getSession();
  const target = 1 / ((session && session.frameRate) || 72);
  perf.ema += (raw - perf.ema) * 0.05;
  if (perf.ema > target * 1.3) { perf.slowT += raw; perf.okT = 0; } else { perf.slowT = Math.max(0, perf.slowT - raw); perf.okT += raw; }
  if (perf.slowT > 2.5) {
    perf.slowT = 0;
    perf.ema = target;
    if (!perf.lowHz && session && (session.frameRate || 72) > 73) { perf.lowHz = true; applyFrameRate(); return; }
    if (perf.level >= 3) return;
    perf.level++;
    applyPerfLevel();
  } else if (perf.okT > 25 && perf.level > 0) { // lange flüssig: eine Stufe zurück
    perf.okT = 0;
    perf.level--;
    applyPerfLevel();
  }
}
function applyPerfLevel() {
  const L = perf.level;
  dust.visible = settings.dust && L < 1;
  fx.particles = L >= 3 ? Math.min(settings.particles, 0.4) : L >= 1 ? Math.min(settings.particles, 0.6) : settings.particles;
  const sh = settings.shadows && L < 2;
  sun.castShadow = sh; shadowFloor.visible = sh; shadowsOn = sh; // nicht gespeichert
  setEyeGlow(settings.eyeGlow && L < 3);
}
// ---- Rundenwechsel: große Zahl im Raum – bekommt Risse, blutet, zerspringt, neue Zahl knallt herein ----
const roundFx = { p: makePanel(1.6, 0.8, 500), t: 0, active: false, from: 0, to: 1, bonus: 0, slammed: false, shards: [], cracks: [], drips: [] };
roundFx.p.mesh.renderOrder = 50;
roundFx.p.mesh.scale.setScalar(1.35);
roundFx.p.mesh.material.depthTest = false;
roundFx.p.mesh.visible = false;
scene.add(roundFx.p.mesh);
const ROUND_DUR = 8.6, SLAM_T = 4.8;
function startRoundFx(from, to, skipIntro = false, bonus = 0) {
  Object.assign(roundFx, { active: true, t: skipIntro ? SLAM_T - 0.5 : 0, from, to, bonus, slammed: false });
  roundFx.cracks = Array.from({ length: 9 }, () => { const pts = [[400 + (Math.random() - 0.5) * 60, 200 + (Math.random() - 0.5) * 60]]; for (let k = 0; k < 4; k++) { const l = pts[pts.length - 1]; pts.push([l[0] + (Math.random() - 0.5) * 90, l[1] + (Math.random() - 0.5) * 90]); } return pts; });
  roundFx.drips = Array.from({ length: 7 }, () => ({ x: 330 + Math.random() * 140, len: 0, speed: 25 + Math.random() * 50 }));
  placeRoundFx(true);
  roundFx.p.mesh.visible = true;
}
function placeRoundFx(snap) {
  const yaw = headYaw();
  const dist = Math.min(2.4, Math.max(1.2, freeDistance(headPos, new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), 2.6) - 0.25));
  const target = inFront(dist, 0, headPos.y - 0.05, yaw);
  if (snap) roundFx.p.mesh.position.copy(target); else roundFx.p.mesh.position.lerp(target, 0.04);
  roundFx.p.mesh.lookAt(headPos);
}
const romanish = (n) => String(n);
function drawRoundFx() {
  const f = roundFx, t = f.t;
  const slam = t >= SLAM_T;
  f.p.draw((ctx, w, h) => {
    const fadeIn = Math.min(1, t / 0.4), fadeOut = Math.min(1, (ROUND_DUR - t) / 0.7);
    ctx.globalAlpha = Math.max(0, Math.min(fadeIn, fadeOut));
    // dunkler Schleier
    const g = ctx.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(20,0,0,0.75)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (!slam) {
      // alte Zahl: zittert, bekommt Risse und blutet
      const k = Math.max(0, (t - 2.4) / (SLAM_T - 2.4));
      const shake = k * 10;
      ctx.save();
      ctx.translate(w / 2 + (Math.random() - 0.5) * shake, 215 + (Math.random() - 0.5) * shake);
      ctx.shadowColor = '#ff1a1a'; ctx.shadowBlur = 30;
      ctx.fillStyle = '#b30f0f'; ctx.font = 'bold 230px Georgia, serif';
      ctx.fillText(romanish(f.from), 0, 0);
      ctx.restore();
      ctx.strokeStyle = 'rgba(10,0,0,0.9)'; ctx.lineWidth = 4;
      const nCr = Math.floor(k * f.cracks.length);
      for (let i = 0; i < nCr; i++) { const c = f.cracks[i]; ctx.beginPath(); ctx.moveTo(c[0][0], c[0][1]); for (const q of c) ctx.lineTo(q[0], q[1]); ctx.stroke(); }
      ctx.fillStyle = '#7a0000';
      for (const d of f.drips) { if (t > 1.5) { ctx.fillRect(d.x, 300, 6, Math.min(90, d.len)); ctx.beginPath(); ctx.arc(d.x + 3, 300 + Math.min(90, d.len), 6, 0, Math.PI * 2); ctx.fill(); } }
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 44px system-ui, sans-serif';
      ctx.fillText(f.from ? `WELLE ${f.from} ÜBERSTANDEN` : 'BEREIT MACHEN …', w / 2, 50);
      if (f.bonus) { ctx.fillStyle = '#ffd21f'; ctx.font = 'bold 34px system-ui, sans-serif'; ctx.fillText(`Bonus +${f.bonus}`, w / 2, 372); }
    } else {
      // neue Zahl knallt herein
      const k = Math.min(1, (t - SLAM_T) / 0.25);
      const sc = 2.4 - 1.4 * (1 - Math.pow(1 - k, 3));
      ctx.save();
      ctx.translate(w / 2, 215);
      ctx.scale(sc, sc);
      ctx.shadowColor = '#ff3a1a'; ctx.shadowBlur = 40 + Math.sin(t * 12) * 10;
      ctx.fillStyle = '#e01a1a'; ctx.font = 'bold 230px Georgia, serif';
      ctx.fillText(romanish(f.to), 0, 0);
      ctx.restore();
      ctx.shadowBlur = 12; ctx.shadowColor = '#000';
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 50px system-ui, sans-serif';
      ctx.fillText(`WELLE ${f.to}`, w / 2, 48);
      const sub = f.to % 5 === 0 && gameMode !== 'training' ? (bossReady() ? `👑 BOSS · STUFE ${f.to / 5} · ${bossGunName(f.to / 5)}${f.to / 5 === GRENADE_LEVEL ? ' + GRANATEN' : ''} 👑` : '☠ EIN RIESE KOMMT ☠') : f.to > 5 && f.to % 5 === 3 && gameMode !== 'training' ? (warriorReady() ? `⚔ DIE KRIEGERIN KOMMT · STUFE ${Math.max(1, Math.round((f.to - 3) / 5))} ⚔` : '☠ EIN RIESE KOMMT ☠') : f.to === 3 ? 'Neu: Brocken' : f.to === 4 ? 'Neu: Platzer' : f.to === 5 ? 'Neu: Spucker' : f.to === UPGRADE_TIERS[1].wave ? 'Aufrüster: Stufe ★★ freigeschaltet' : f.to === UPGRADE_TIERS[2].wave ? 'Aufrüster: Stufe ★★★ freigeschaltet' : '';
      if (sub) { ctx.fillStyle = '#ffcc33'; ctx.font = 'bold 34px system-ui, sans-serif'; ctx.fillText(sub, w / 2, 372); }
    }
  });
}
function updateRoundFx(dt) {
  const f = roundFx;
  if (!f.active) return;
  if (state !== 'playing') { f.active = false; f.p.mesh.visible = false; return; }
  f.t += dt;
  for (const d of f.drips) d.len += d.speed * dt;
  if (!f.slammed && f.t >= SLAM_T) {
    f.slammed = true;
    const at = f.p.mesh.position.clone();
    burst(at, 0xb30f0f, 40);
    burst(at, 0x220000, 20);
    shockwave(headPos.clone().setY(0.05));
    SFX.waveStart();
    hurtFlash = Math.max(hurtFlash, 0.55);
    for (const h of hands) pulse(h, 0.9, 250);
    speak(f.to % 5 === 0 && gameMode !== 'training' ? `Welle ${f.to}. Der Boss kommt!` : f.to > 5 && f.to % 5 === 3 && gameMode !== 'training' && warriorReady() ? `Welle ${f.to}. Die Kriegerin kommt!` : `Welle ${f.to}`);
  }
  placeRoundFx(false);
  if ((roundFx.frame = (roundFx.frame || 0) + 1) % 2 === 0 || !f.slammed) drawRoundFx();
  if (f.t >= ROUND_DUR) { f.active = false; f.p.mesh.visible = false; }
}
// Blickrichtung einer Hand (um die Hochachse)
function handYaw(h) { const f = new THREE.Vector3(0, 0, -1).applyQuaternion(h.quat); return Math.atan2(-f.x, -f.z); }
// Rundenanzeige als schwebendes HUD: 1,3 m vor dir, leicht oberhalb der Blickrichtung
let boardYaw = 0;
function placeBoardHud(snap) {
  const yaw = headYaw();
  const diff = Math.atan2(Math.sin(yaw - boardYaw), Math.cos(yaw - boardYaw));
  if (snap || Math.abs(diff) > 0.55) boardYaw += diff * (snap ? 1 : 0.06); // erst nachziehen, wenn man sich deutlich wegdreht
  const target = new THREE.Vector3(headPos.x - Math.sin(boardYaw) * 1.3, headPos.y + 0.42, headPos.z - Math.cos(boardYaw) * 1.3);
  if (snap) board.mesh.position.copy(target); else board.mesh.position.lerp(target, 0.12);
  board.mesh.lookAt(headPos);
}
// ---- Leuchtende Hilfen: zeigen, was als Nächstes zu tun ist (Magazin, Durchladen, Entsichern …) ----
const guideTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 4, 32, 32, 30); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 3; g.beginPath(); g.arc(32, 32, 22, 0, Math.PI * 2); g.stroke(); return new THREE.CanvasTexture(c); })();
const guides = [0, 1].map(() => {
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: guideTex, color: 0x4ae2ff, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  glow.renderOrder = 70;
  glow.visible = false;
  scene.add(glow);
  const label = makePanel(0.2, 0.045, 1600);
  label.mesh.renderOrder = 71;
  label.mesh.material.depthTest = false;
  label.mesh.visible = false;
  scene.add(label.mesh);
  return { glow, label, txt: '' };
});
const tmpG = new THREE.Vector3();
// Was muss mit der Waffe in Hand h als Nächstes passieren? → { pos (Weltposition), text }
function guideStep(w, h) {
  const d = w.def, off = otherHand(h), offItem = off && off.held;
  const sock = (n) => (w.sockets[n] ? w.sockets[n].getWorldPosition(new THREE.Vector3()) : null);
  const A = btnName(h, 'a'), B = btnName(h, 'b');
  if (mode(w) === 'safe') return { pos: w.root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.08, 0)), text: `${B}: entsichern`, color: 0xffd21f };
  if (d.feed === 'mag') {
    if (!w.magInserted) {
      if (offItem && offItem.type === 'mag') return { pos: sock('magwell'), text: '↑ Magazin hier rein' };
      const slot = beltSlots.find(s0 => s0.kind === 'mag' && s0.available);
      if (slot) return { pos: slot.obj.getWorldPosition(new THREE.Vector3()), text: 'Magazin greifen' };
      return { pos: w.root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.08, 0)), text: 'Keine Munition!', color: 0xff4a3a };
    }
    if (w.magRounds === 0 && w.chamber !== 'live') return { pos: sock('magwell'), text: `${A}: Magazin raus`, color: 0xffb03a };
  } else {
    if (w.tube === 0 && w.chamber !== 'live') {
      if (offItem && offItem.type === 'shell') return { pos: sock('loadPort'), text: 'Patrone hier rein' };
      const slot = beltSlots.find(s0 => s0.kind === 'shell' && s0.available);
      if (slot) return { pos: slot.obj.getWorldPosition(new THREE.Vector3()), text: 'Patrone greifen' };
      return { pos: w.root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.08, 0)), text: 'Keine Munition!', color: 0xff4a3a };
    }
  }
  if ((w.chamber !== 'live' || w.actionOpen) && d.action !== 'none' && !w.desktopBusy) {
    if (d.action === 'pump') return { pos: sock('foregrip'), text: 'Vorderschaft zurück & vor' };
    if (off && off.grab && off.grab.w === w) return { pos: sock('chargerGrab'), text: d.action === 'bolt' ? 'zurück … und vor' : 'ganz zurückziehen' };
    return { pos: sock('chargerGrab'), text: d.action === 'slide' ? `Schlitten ziehen (oder ${B})` : d.action === 'bolt' ? 'Kammerstängel greifen' : 'Spannhebel ziehen' };
  }
  return null;
}
function updateGuides() {
  const on = settings.guides && renderer.xr.isPresenting;
  hands.forEach((h, i) => {
    const G = guides[i];
    const w = on ? heldWeapon(h) : null;
    const step = w ? guideStep(w, h) : null;
    G.glow.visible = G.label.mesh.visible = !!(step && step.pos);
    if (!G.glow.visible) return;
    const k = 0.75 + Math.sin(elapsed * 9) * 0.25;
    G.glow.position.copy(step.pos);
    G.glow.scale.setScalar(0.06 * k + 0.02);
    G.glow.material.color.setHex(step.color || 0x4ae2ff);
    G.glow.material.opacity = 0.55 + 0.45 * k;
    G.label.mesh.position.copy(step.pos).add(tmpG.set(0, 0.07, 0));
    G.label.mesh.lookAt(headPos);
    if (G.txt !== step.text) {
      G.txt = step.text;
      G.label.draw((ctx, cw, ch) => { roundRect(ctx, 2, 2, cw - 4, ch - 4, 18); ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fill(); ctx.strokeStyle = '#4ae2ff'; ctx.lineWidth = 3; ctx.stroke(); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; let f = 34; ctx.font = `bold ${f}px system-ui, sans-serif`; while (ctx.measureText(step.text).width > cw - 24 && f > 16) { f -= 2; ctx.font = `bold ${f}px system-ui, sans-serif`; } ctx.fillText(step.text, cw / 2, ch / 2 + 2); });
    }
  });
}
// Brett direkt an einer Tür/einem Fenster mit fehlenden Brettern greifen
function plankOpeningNear(p) {
  for (const o of openings()) {
    if (missingPlanks(o) <= 0) continue;
    const rel = p.clone().sub(o.mid);
    if (Math.abs(rel.dot(o.right)) < o.width / 2 + 0.3 && Math.abs(rel.dot(o.normal)) < 0.6 && p.y > o.bottom - 0.2 && p.y < o.top + 0.3) return o;
  }
  return null;
}
// wenig Munition: gehaltene Waffe hat weniger als ein Magazin in Reserve
function lowAmmo() { return hands.some(h => { const w = heldWeapon(h); return w && w.reserve < w.def.capacity; }) || (deskW && deskW.reserve < deskW.def.capacity); }
// Klangkulisse: Musik-Spannung und zufällige Gruselgeräusche aus der Umgebung
function updateSoundscape(dt) {
  if (state === 'playing') {
    let near = 0;
    for (const z of zombies) if (z.state !== 'dead' && z.state !== 'outside') near += Math.max(0, 1 - hyp(z.pos.x - headPos.x, z.pos.z - headPos.z) / 5);
    const k = THREE.MathUtils.clamp(0.15 + near * 0.3 + (playerHp < 40 ? 0.35 : 0) + (waveBreak > 0 ? -0.2 : 0), 0, 1);
    musicUpdate(dt, k);
  }
  if (!settings.ambient || state === 'setup') return;
  ambientT -= dt;
  if (ambientT > 0) return;
  ambientT = THREE.MathUtils.randFloat(7, 18);
  const ops = openings();
  let pos;
  if (ops.length) { const o = ops[Math.floor(Math.random() * ops.length)]; pos = o.mid.clone().addScaledVector(o.normal, -THREE.MathUtils.randFloat(2, 6)).setY(THREE.MathUtils.randFloat(0.5, 2)); }
  else pos = headPos.clone().add(new THREE.Vector3().randomDirection().setY(0).normalize().multiplyScalar(5));
  const kinds = ops.some(o => o.type === 'window') ? ['creak', 'scream', 'wind', 'drip', 'chain'] : ['creak', 'scream', 'drip', 'chain'];
  SFX3D.ambient(pos, kinds[Math.floor(Math.random() * kinds.length)]);
}
// Platzer-Explosion und Säure-Treffer der Spucker
let acidFlash = 0, killcamT = 0, ambientT = 6;
const warnedTypes = new Set();
setZombieHooks({
  explode(at, results) {
    flashLight.position.copy(at); flashLight.distance = 6; flashLight.intensity = 20;
    floorDecal(at.clone().setY(0), 'scorch', 1.2);
    for (const r of results) handleZombieHit(r, r.zombie.skull.getWorldPosition(new THREE.Vector3()), '☣ ');
    const pd = headPos.distanceTo(at);
    for (const h of hands) pulse(h, Math.max(0.2, 1 - pd / 5), 200);
    if (pd < 2.3 && gameMode !== 'training') { playerHit(28 * (1 - pd / 2.3)); acidFlash = 1; }
  },
  spitHit() { acidFlash = 1; SFX_PLAYER.hurt(); },
  shatter(at) { SFX.shatter(); floatingText('Zersplittert!', at.clone().setY(1.9), '#bfe8ff'); }
});
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
// Armbrust: Sprengbolzen fliegen mit leichter Schwerkraft, bleiben stecken und explodieren
// =============================================================================
const arrows = [];
function launchArrow(pos, dir, dmg, kind = 'bolt') {
  const gl = kind === 'grenade';
  let a;
  if (gl) { a = new THREE.Group(); const r = makeGlRound(); r.rotation.x = -Math.PI / 2; a.add(r); } else a = makeArrow();
  a.position.copy(pos);
  a.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
  scene.add(a);
  arrows.push({ obj: a, vel: dir.clone().multiplyScalar(gl ? 24 : 42), grav: gl ? 9.8 : 4, life: 4, dmg, stuck: false, fuse: gl ? 0 : 1.1, radius: gl ? 3.2 : 2.8 });
  if (!gl) SFX.click(260, 0.5, 0.12);
}
function updateArrows(dt) {
  for (let i = arrows.length - 1; i >= 0; i--) {
    const a = arrows[i];
    if (a.stuck) {
      a.fuse -= dt;
      a.beepT = (a.beepT ?? 0) - dt;
      if (a.beepT <= 0 && a.fuse > 0) { a.beepT = 0.22; SFX.tick(); }
      if (a.fuse > 0) continue;
      const at = a.obj.getWorldPosition(new THREE.Vector3());
      if (a.obj.parent) a.obj.parent.remove(a.obj);
      arrows.splice(i, 1);
      SFX.explosion();
      burst(at, 0xff8a30, 26);
      burst(at, 0x3a3532, 16);
      shockwave(at);
      flashLight.position.copy(at); flashLight.distance = 7; flashLight.intensity = 30;
      if (at.y < 0.5) floorDecal(at.clone().setY(0), 'scorch', 1.0);
      for (const r of explosionDamage(at, a.radius, a.dmg)) handleZombieHit(r, r.zombie.skull.getWorldPosition(new THREE.Vector3()), '💥 ');
      const pd = headPos.distanceTo(at);
      if (pd < 1.6 && gameMode !== 'training') playerHit(30 * (1 - pd / 1.6));
      for (const h of hands) pulse(h, Math.max(0.2, 1 - pd / 5), 200);
      continue;
    }
    a.life -= dt;
    a.vel.y -= a.grav * dt;
    const step = a.vel.clone().multiplyScalar(dt);
    raycaster.set(a.obj.position, step.clone().normalize());
    raycaster.far = step.length() + 0.05;
    const hit = raycaster.intersectObjects([...zombieHitMeshes(), ...roomOccluders(), ...plankMeshes()], false)[0];
    if (hit || a.obj.position.y + step.y < 0.01 || a.life <= 0) {
      a.stuck = true;
      SFX.thud(0.4);
      if (hit) {
        a.obj.position.copy(hit.point).addScaledVector(step.clone().normalize(), -0.08);
        if (hit.object.userData.zombie) { hit.object.attach(a.obj); handleZombieHit(damageZombie(hit.object, hit.point, step.clone().normalize(), 40), hit.point); if (!a.obj.parent) scene.add(a.obj); }
      } else a.obj.position.y = Math.max(0.02, a.obj.position.y);
      continue;
    }
    a.obj.position.add(step);
    a.obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), a.vel.clone().normalize());
  }
}

// =============================================================================
// Flammenwerfer & Frostwerfer: Kegel-Treffer, Feuer-/Eispartikel, brennende Zombies
// =============================================================================
const flameTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30); gr.addColorStop(0, 'rgba(255,255,220,1)'); gr.addColorStop(0.35, 'rgba(255,170,40,0.9)'); gr.addColorStop(0.7, 'rgba(200,40,0,0.5)'); gr.addColorStop(1, 'rgba(60,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
const flameMat = new THREE.SpriteMaterial({ map: flameTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
const frostMat = new THREE.SpriteMaterial({ map: flameTex, color: 0x6fd0ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
const flameParts = [];
function spawnFlamePart(pos, vel, mat, life = 0.55, size = 0.12) {
  if (flameParts.length > 160) return;
  const sp = new THREE.Sprite(mat);
  sp.position.copy(pos);
  sp.scale.setScalar(size);
  scene.add(sp);
  flameParts.push({ obj: sp, vel, life, max: life, size });
}
// ---- Besondere Treffer-Wirkungen (v49) ---------------------------------------------------
// Schock-Flinte lähmt, Spreng-Revolver explodiert am Ziel
let blastSndT = 0;
function onBulletHit(w, z, res, at, dmg) {
  if (!res || !z) return;
  if (w.def.stun && !res.kill) { z.slowT = Math.max(z.slowT || 0, w.def.stun); burst(at, 0x66ccff, 4); }
  if (w.def.blast) {
    burst(at, 0xff9a40, 10); puff(at, 0x666666, 0.25, 0.6, 0.3, 0.5);
    if (elapsed - blastSndT > 0.08) { blastSndT = elapsed; SFX.explosion(0.35); }
    for (const r of explosionDamage(at, w.def.blast.r, dmg * w.def.blast.k)) if (r.zombie !== z || r.kill) handleZombieHit(r, r.pos.clone().setY(1), '💥 ');
  }
}
// Querschläger: Kugel prallt von der Wand ab (Einfallswinkel = Ausfallswinkel) und fliegt weiter
function ricochet(w, hit, d, dmg, bounces) {
  if (bounces <= 0 || !hit.face) return;
  const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
  if (n.dot(d) > 0) n.negate();
  const nd = d.clone().reflect(n).normalize();
  const from = hit.point.clone().addScaledVector(n, 0.01);
  raycaster.set(from, nd);
  raycaster.far = 12;
  const h2 = raycaster.intersectObjects([...zombieHitMeshes(), ...roomOccluders()], false)[0];
  spawnTracer(from, h2 ? h2.point : from.clone().addScaledVector(nd, 6));
  sparks(hit.point, n, 4);
  if (!h2) return;
  const ud = h2.object.userData;
  if (ud.zombie) handleZombieHit(damageZombie(h2.object, h2.point, nd, dmg, false, headMultOf(w)), h2.point, '↯ ');
  else if (ud.surface) ricochet(w, h2, nd, dmg * 0.8, bounces - 1);
}
// Schallkanone: alle Zombies im Kegel bekommen Schaden, werden zurückgeworfen und fallen um
function sonicShot(from, dir, dmg, up) {
  const range = up ? 6 : 4.5;
  const at = from.clone().addScaledVector(dir, 0.6);
  shockwave(at);
  for (let i = 1; i <= 4; i++) puff(from.clone().addScaledVector(dir, i * 0.9), 0x9fffe8, 0.25 + i * 0.12, 0.4, 0.05, 0.35);
  SFX.explosion(0.45);
  for (const { z, c, d } of zombiesInCone(from, dir, range, up ? 0.6 : 0.45)) {
    const k = Math.max(0.3, 1 - d / (range + 0.5));
    handleZombieHit(damageZombie((z.hitTorso || z.torso.children[1]), c, dir, dmg * k), c, '〰 ');
    if (z.state === 'dead' || z.T.boss) continue;
    // zurückwerfen (nicht durch Wände)
    const push = 1.3 * k;
    for (let s = 0; s < 6; s++) { const nx = z.pos.x + dir.x * push / 6, nz = z.pos.z + dir.z * push / 6; if (!walkable(nx, nz)) break; z.pos.x = nx; z.pos.z = nz; }
    z.stagger = Math.max(z.stagger || 0, 0.8);
    if (k > 0.55 && z.type !== 'giant' && z.type !== 'brute' && (z.state === 'walk' || z.state === 'attack')) { z.knockT = 2.2; z.knockBack = -1; }
  }
}
// Zombies im Kegel vor der Mündung (freie Sicht vorausgesetzt)
function zombiesInCone(from, dir, range, angle) {
  const out = [];
  for (const z of zombies) {
    if (z.state === 'dead') continue;
    const c = z.root.position.clone().setY(1.0 * z.scale);
    const to = c.clone().sub(from);
    const d = to.length();
    if (d > range || to.normalize().angleTo(dir) > angle) continue;
    raycaster.set(from, to);
    raycaster.far = d - 0.2;
    if (raycaster.intersectObjects([...roomOccluders(), ...plankMeshes()], false).length) continue;
    out.push({ z, c, d });
  }
  return out;
}
const burning = new Set();
// Drachenatem (aufgerüstete Flinte): Zombie brennt ein paar Sekunden
function ignite(z, dmg) { if (!z || z.state === 'dead') return; if (!z.burnT) burning.add(z); z.burnT = 3; z.burnDmg = Math.max(z.burnDmg || 0, dmg); }
// Kopfschuss-Explosion (Scharfschütze ★★★): kleine Explosion an der Stelle
function killBlast(at) {
  burst(at, 0xffb030, 18); shockwave(at.clone()); SFX.explosion(0.5);
  for (const r of explosionDamage(at, 1.6, 220)) handleZombieHit(r, r.pos.clone().setY(1), '💥 ');
}
function flameShot(from, dir, dmg, up) {
  for (let i = 0; i < 3; i++) spawnFlamePart(from.clone(), dir.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(0.12)).normalize().multiplyScalar(THREE.MathUtils.randFloat(6, 8)), flameMat, 0.6, 0.08);
  flashLight.position.copy(from).addScaledVector(dir, 1); flashLight.distance = 4; flashLight.intensity = 6;
  for (const { z, c } of zombiesInCone(from, dir, 5, 0.3)) {
    if (!z.burnT) burning.add(z);
    z.burnT = up ? 6 : 4;
    z.burnUp = up;
    handleZombieHit(damageZombie((z.hitTorso || z.torso.children[1]), c, dir, dmg, true), c, '🔥 ');
  }
}
function frostShot(from, dir, dmg, up) {
  SFX.freeze();
  for (let i = 0; i < 24; i++) spawnFlamePart(from.clone(), dir.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(0.15)).normalize().multiplyScalar(THREE.MathUtils.randFloat(7, 11)), frostMat, 0.5, 0.1);
  lightningLine(from, from.clone().addScaledVector(dir, 6), frostLineMat);
  for (const { z, c } of zombiesInCone(from, dir, up ? 9 : 7, up ? 0.3 : 0.22)) {
    const was = z.frozenT > 0;
    if (!was) { handleZombieHit(damageZombie((z.hitTorso || z.torso.children[1]), c, dir, dmg), c, '❄ '); if (z.state !== 'dead') { freezeZombie(z, up ? 7 : 5); floatingText('Eingefroren!', c.clone().setY(2), '#bfe8ff'); } }
    else handleZombieHit(damageZombie((z.hitTorso || z.torso.children[1]), c, dir, dmg), c, '❄ ');
  }
}
function updateFlames(dt) {
  for (let i = flameParts.length - 1; i >= 0; i--) {
    const f = flameParts[i];
    f.life -= dt;
    if (f.life <= 0) { scene.remove(f.obj); flameParts.splice(i, 1); continue; }
    const k = 1 - f.life / f.max;
    f.vel.multiplyScalar(1 - dt * 2.5);
    f.vel.y += dt * 1.5;
    f.obj.position.addScaledVector(f.vel, dt);
    f.obj.scale.setScalar(f.size * (1 + k * 5));
    f.obj.material.rotation += dt;
  }
  // brennende Zombies: Schaden über Zeit + Flammen am Körper
  for (const z of burning) {
    if (z.state === 'dead' || !zombies.includes(z)) { burning.delete(z); z.burnT = 0; continue; }
    z.burnT -= dt;
    z.burnTick = (z.burnTick || 0) - dt;
    if (Math.random() < dt * 22) spawnFlamePart(z.root.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.4 + Math.random() * 1.1, (Math.random() - 0.5) * 0.3)), new THREE.Vector3(0, 0.6, 0), flameMat, 0.45, 0.07);
    if (z.burnTick <= 0) {
      z.burnTick = 0.5;
      const c = z.root.position.clone().setY(1);
      handleZombieHit(damageZombie((z.hitTorso || z.torso.children[1]), c, new THREE.Vector3(0, -1, 0), z.burnDmg || (z.burnUp ? 16 : 9), true), c, '🔥 ');
      if (Math.random() < 0.3) SFX.fire();
    }
    if (z.burnT <= 0) { burning.delete(z); z.burnT = 0; z.burnDmg = 0; }
  }
}

// =============================================================================
// Blitzwerfer: Blitz springt vom getroffenen Zombie zu den nächsten
// =============================================================================
const bolts = [];
const boltMat = new THREE.LineBasicMaterial({ color: 0x9fe6ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
const frostLineMat = new THREE.LineBasicMaterial({ color: 0xbfe8ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
function lightningLine(a, b, mat = boltMat) {
  const pts = [];
  const n = Math.max(4, Math.round(a.distanceTo(b) * 8));
  for (let i = 0; i <= n; i++) {
    const p = a.clone().lerp(b, i / n);
    if (i > 0 && i < n) p.add(new THREE.Vector3().randomDirection().multiplyScalar(0.06));
    pts.push(p);
  }
  for (let k = 0; k < 2; k++) { // zwei Stränge für mehr Volumen
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(p => p.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(0.015)))), mat);
    line.renderOrder = 15;
    scene.add(line);
    bolts.push({ obj: line, t: 0.18 });
  }
  sparks(b, new THREE.Vector3(0, 1, 0), 8);
}
function updateBolts(dt) {
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i];
    b.t -= dt;
    if (b.t <= 0) { scene.remove(b.obj); b.obj.geometry.dispose(); bolts.splice(i, 1); }
  }
  boltMat.opacity = 0.6 + Math.random() * 0.4;
}
function teslaStrike(from, hit, dir, dmg, jumps) {
  flashLight.position.copy(from); flashLight.distance = 5; flashLight.intensity = 16;
  SFX.click(4200, 0.6, 0.15);
  if (!hit) { lightningLine(from, from.clone().addScaledVector(dir, 6)); return; }
  if (!hit.object.userData.zombie) { lightningLine(from, hit.point); if (hit.object.userData.surface) wallImpact(hit, dir); return; }
  let z = hit.object.userData.zombie, last = from, n = 0;
  const done = new Set();
  while (z && n <= jumps) {
    done.add(z);
    const p = z.skull.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -0.25, 0));
    lightningLine(last, p);
    const d = p.clone().sub(last).normalize();
    handleZombieHit(damageZombie((z.hitTorso || z.torso.children[1]), p, d, dmg / (1 + n * 0.15)), p, '⚡ ');
    last = p;
    n++;
    let best = null, bd = 3.5;
    for (const q of zombies) {
      if (done.has(q) || q.state === 'dead' || q.state === 'outside') continue;
      const dd = q.pos.distanceTo(z.pos);
      if (dd < bd) { bd = dd; best = q; }
    }
    z = best;
  }
}

// =============================================================================
// Punkte als Währung
// =============================================================================
const START_POINTS = 500;
let points = 0;
const free = () => gameMode === 'training';
function award(n) { score += n; points += Math.round(n * settings.pointsMul * DIFF().points); boardDirty = true; }
function spend(price, where) {
  if (free() || points >= price) {
    if (!free()) points -= price;
    boardDirty = true;
    if (audioCtxOk()) SFX.coins();
    return true;
  }
  SFX.buzz();
  floatingText(`Zu wenig Punkte (${price})`, where, '#ff7070');
  return false;
}
const audioCtxOk = () => true;
const ownedWeapon = (id) => arsenal.find(w => w.id === id && !w.inMachine && (w.holder >= 0 || w.holstered || w.inBelt || w === deskW));
// Munition an der Wand: aufgerüstete Waffen kosten mehr (★ ×2,5 · ★★ ×4 · ★★★ ×5,5)
const ammoPrice = (w, wbDef) => Math.round(price.ammo(wbDef) * (1 + 1.5 * (w.def.up || 0)) / 50) * 50;
// gekaufte Waffe in die Hand (VR) bzw. vor die Kamera (PC) geben
function giveWeapon(id, h) {
  const w = spawnWeapon(id);
  if (h) takeWeapon(w, h); else equipDesk(w);
  return w;
}
// nicht mehr benutzte gekaufte Waffen verschwinden nach einer Weile
function updateWeaponExpiry() {
  const p0 = starterPistol();
  if (p0 && !p0.inBelt && p0.holder < 0 && p0 !== deskW && !p0.inMachine && elapsed - p0.lastTouch > 6) { puff(p0.root.position.clone(), 0xcfcfcf, 0.08, 1, 0.3, 0.5); holsterPistol(p0); }
  for (const w of [...arsenal]) {
    if (w.starter || w.holder >= 0 || w === deskW || w.holstered || w.inMachine) continue;
    if (elapsed - w.lastTouch > 40) { burst(w.root.position.clone(), 0xaaaaaa, 10); disposeWeapon(w); }
  }
  // höchstens 8 Waffen gleichzeitig
  const loose = arsenal.filter(w => !w.starter && w.holder < 0 && w !== deskW && !w.holstered && !w.inMachine);
  while (arsenal.length > 8 && loose.length) disposeWeapon(loose.shift());
}

// =============================================================================
// Wandkäufe: an markierten Wandstellen hängt jede Runde eine zufällige Waffe zum Kaufen
// =============================================================================
const wallbuys = [];
const boardMat = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.9 });
const chalkMat = new THREE.MeshBasicMaterial({ color: 0xffd36a, toneMapped: false });
function clearWallbuys() {
  for (const wb of wallbuys.splice(0)) { scene.remove(wb.group); disposeTree(wb.group); wb.glow.material.dispose(); wb.label.mesh.material.map.dispose(); wb.label.mesh.material.dispose(); wb.label.mesh.geometry.dispose(); }
}
// freie Wandstellen (nicht vor Türen/Fenstern, Abstand zu anderen Plätzen) – ohne Wände: frei stehend im Kreis
function freeWallSpots(n, y, avoid = [], minSep = 1.2, angles = [Math.PI * 0.5, Math.PI, -Math.PI * 0.5], radius = 1.8) {
  const spots = [];
  const ops = surfacesOf('door', 'window');
  const walls = surfacesOf('wall').filter(w => w.width > 1.3).sort(() => Math.random() - 0.5);
  const taken = (pos) => [...avoid, ...spots.map(o => o.pos)].some(q => hyp(q.x - pos.x, q.z - pos.z) < minSep);
  for (let pass = 0; pass < 3 && spots.length < n; pass++) {
    for (const w of walls) {
      for (let k = 0; k < 8 && spots.length < n; k++) {
        const u = THREE.MathUtils.randFloat(0.65, w.width - 0.65);
        const pos = w.a.clone().addScaledVector(w.right, u).setY(y);
        if (ops.some(o => hyp(o.mid.x - pos.x, o.mid.z - pos.z) < o.width / 2 + 0.75)) continue;
        if (taken(pos)) continue;
        spots.push({ pos, normal: w.normal.clone() });
        break;
      }
      if (spots.length >= n) break;
    }
  }
  if (spots.length < n) { // nicht genug Wandplatz: frei stehend im Kreis um den Spieler
    for (const a of angles.slice(0, n - spots.length)) {
      const pos = inFront(radius, a, y);
      spots.push({ pos, normal: headPos.clone().setY(y).sub(pos).setY(0).normalize() });
    }
  }
  return spots;
}
// Wandkauf-Plätze: selbst gesetzte – sonst automatisch
function autoWallbuySpots() {
  const own = surfacesOf('wallbuy');
  return own.length || settings.autoPlace === 'none' ? own : freeWallSpots(3, 1.35);
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
      text(ctx, `💰 ${price.weapon(def)}  ·  Munition ${price.ammo(def)}`, 14, h * 0.75, 26, '#ffd21f', 'left', true);
    });
    label.mesh.position.set(0, -0.2, 0.01);
    g.add(label.mesh);
    scene.add(g);
    const glow = new THREE.Mesh(cachedGeo('wbglow', () => new THREE.PlaneGeometry(1.25, 0.75)), new THREE.MeshBasicMaterial({ map: wbGlowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    glow.position.z = -0.004;
    g.add(glow);
    mergeStatic(g, { glow, label: label.mesh });
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
    const cost = own ? ammoPrice(own, wb.def) : price.weapon(wb.def);
    const afford = free() || points >= cost;
    // Schild aktualisieren: Waffe gekauft → zeigt den Munitionspreis (aufgerüstet: teurer)
    const key = own ? 'a' + (own.def.up || 0) : 'w';
    if (wb.labelKey !== key) {
      wb.labelKey = key;
      wb.label.draw((ctx, w, h) => {
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, w, h);
        text(ctx, own ? `${wb.def.name}${own.def.up ? ' ' + UPGRADE_TIERS[own.def.up - 1].stars : ''}` : wb.def.name, 14, h * 0.32, 30, '#ffe7a8', 'left', true);
        text(ctx, own ? `🔄 Munition: 💰 ${cost}` : `💰 ${price.weapon(wb.def)}  ·  Munition ${price.ammo(wb.def)}`, 14, h * 0.75, 26, own ? '#9fe8ff' : '#ffd21f', 'left', true);
      });
    }
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
  if (own) { // Waffe schon da: Munition kaufen (komplett auffüllen) – auch für aufgerüstete Waffen, dann teurer
    const cost = ammoPrice(own, wb.def);
    if (!spend(cost, where)) return false;
    refillAmmo(own);
    SFX.magIn();
    floatingText(`Munition aufgefüllt −${cost}`, where, '#9fe8ff');
    return true;
  }
  if (!spend(price.weapon(wb.def), where)) return false;
  giveWeapon(wb.id, h);
  floatingText(wb.def.name, where, '#ffe7a8');
  speak(wb.def.name);
  return true;
}

// =============================================================================
// Perk-Automaten (Getränke mit Dauer-Vorteil) und Aufrüster (Waffe verbessern)
// =============================================================================
const PERKS = {
  eisen: { name: 'Eisenhaut', icon: '♥', color: '#ff3a4a', price: 2500, desc: 'Doppelte Lebenspunkte' },
  flink: { name: 'Flinkhand', icon: '⚡', color: '#3aff7a', price: 2000, desc: 'Doppelt so schnell nachladen' },
  turbo: { name: 'Schnellfeuer', icon: '»', color: '#ffa53a', price: 2000, desc: 'Ein Drittel mehr Feuerrate' },
  leben: { name: 'Zweites Leben', icon: '✚', color: '#4ab8ff', price: 1500, desc: 'Einmal wiederbeleben' },
  // v50: sechs weitere Getränke
  doppel: { name: 'Doppelschlag', icon: '‼', color: '#ff5ad0', price: 3000, desc: '35 % mehr Schaden mit allen Waffen' },
  kopf: { name: 'Adlerauge', icon: '◎', color: '#ffd84a', price: 2000, desc: 'Kopfschüsse stärker, weniger Streuung' },
  weste: { name: 'Panzerweste', icon: '⛨', color: '#9fb0c4', price: 2500, desc: '30 % weniger Schaden' },
  vampir: { name: 'Blutdurst', icon: '♥+', color: '#d0203a', price: 2000, desc: 'Jeder Kill heilt 4 Leben' },
  elektro: { name: 'Elektroschock', icon: 'ϟ', color: '#48d8ff', price: 2000, desc: 'Nachladen schockt Zombies in der Nähe' },
  muni: { name: 'Munitionsgürtel', icon: '▤', color: '#9fd06a', price: 1500, desc: '50 % mehr Reserve-Munition' }
};
const PERK_ORDER = Object.keys(PERKS);
const maxHp = () => (perks.has('eisen') ? 200 : 100);
const reloadK = () => (perks.has('flink') ? 0.5 : 1);
// Aufrüst-Stufen: höhere Stufen erst in späteren Wellen
const UPGRADE_TIERS = [
  { price: 5000, wave: 1, stars: '★', dmg: 2, cap: 1.5, rpm: 1.1, colors: ['#b04dff', '#2ee6ff'], base: '#140a22' },
  { price: 15000, wave: 8, stars: '★★', dmg: 3.2, cap: 1.9, rpm: 1.18, colors: ['#ff3a1a', '#ffb21a'], base: '#200806' },
  { price: 30000, wave: 15, stars: '★★★', dmg: 4.8, cap: 2.3, rpm: 1.25, colors: ['#ffe14a', '#ffffff'], base: '#2a1d04' }
];
const UPGRADE_PRICE = UPGRADE_TIERS[0].price;
const machines = [];
const upg = { m: null, w: null, state: 'idle', t: 0 };
function panelTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const perkTex = {};
function perkTexture(kind) {
  const key = kind + price.perk(PERKS[kind]);
  if (perkTex[key]) return perkTex[key];
  const P = PERKS[kind];
  perkTex[key] = panelTex(256, 512, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#0b0b10'); g.addColorStop(0.5, P.color + '55'); g.addColorStop(1, '#0b0b10');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = P.color; ctx.lineWidth = 8; ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.shadowColor = P.color; ctx.shadowBlur = 30;
    ctx.fillStyle = P.color; ctx.font = 'bold 150px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(P.icon, w / 2, 170);
    ctx.shadowBlur = 12; ctx.fillStyle = '#fff'; ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.fillText(P.name.toUpperCase(), w / 2, 300);
    ctx.font = '22px system-ui, sans-serif'; ctx.fillStyle = '#ddd'; ctx.fillText(P.desc, w / 2, 340);
    ctx.font = 'bold 40px system-ui, sans-serif'; ctx.fillStyle = '#ffd21f'; ctx.fillText('💰 ' + price.perk(P), w / 2, 420);
  });
  return perkTex[key];
}
const upgTexCache = {};
function upgTexture() {
  const label = UPGRADE_TIERS.map(t => t.stars + ' ' + price.upgrade(t)).join(' · ');
  if (upgTexCache[label]) return upgTexCache[label];
  return (upgTexCache[label] = panelTex(256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#0d0716'; ctx.fillRect(0, 0, w, h);
    ctx.shadowColor = '#b26bff'; ctx.shadowBlur = 20;
    ctx.fillStyle = '#d9b8ff'; ctx.font = 'bold 34px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('⚙ AUFRÜSTER', w / 2, 45);
    ctx.fillStyle = '#ffd21f'; ctx.font = 'bold 21px system-ui, sans-serif'; ctx.fillText(label, w / 2, 95);
  }));
}
// Leucht-Tarnung je Stufe (wandert langsam über die Waffe)
function makeCamo(base, colors) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = base; ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 26; i++) {
    ctx.strokeStyle = colors[i % 2];
    ctx.lineWidth = 1 + Math.random() * 3;
    ctx.beginPath();
    let x = Math.random() * 128, y = Math.random() * 128;
    ctx.moveTo(x, y);
    for (let k = 0; k < 4; k++) { x += (Math.random() - 0.5) * 50; y += (Math.random() - 0.5) * 50; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.7, metalness: 0.6, roughness: 0.35 });
}
const camoMats = UPGRADE_TIERS.map(t => makeCamo(t.base, t.colors));
const camoMat = camoMats[0];
// Stufe n aus der Grundwaffe berechnen (nicht aufeinander stapeln)
// Besondere Fähigkeiten beim Aufrüsten – damit sich Scharfschützen, Flinten & Co. lohnen (nicht nur Maschinengewehre)
const SNIPERS = ['sniper', 'hunter', 'antimat', 'dmr'], SHOTGUNS = ['shotgun', 'autoshot', 'dbl', 'sawed'], HANDCANNONS = ['revolver', 'magnum', 'lever'];
function upgradeAbilities(id, base, n) {
  const a = {}, names = [];
  if (SNIPERS.includes(id)) {
    if (base.action === 'bolt') { a.autoCycle = true; a.action = 'none'; names.push('Halbautomatisch – kein Repetieren mehr'); }
    a.pierce = (base.pierce || 1) + 2 * n;                                  // ★ 3 · ★★ 5 · ★★★ 7 Zombies hintereinander
    names.push(`Durchschlag: ${a.pierce} Zombies`);
    a.pierceKeep = 0.9;                                                     // verliert kaum Schaden pro Zombie
    if (n >= 3) { a.explodeKill = true; names.push('Kopfschuss-Explosion'); }
  } else if (SHOTGUNS.includes(id)) {
    a.pellets = Math.round(base.pellets * (1 + 0.25 * n)); a.spread = base.spread * (1 - 0.15 * n);
    names.push(`${a.pellets} Kugeln, enger gestreut`);
    if (base.action === 'pump') { a.autoCycle = true; a.action = 'none'; names.push('Automatisch – kein Pumpen mehr'); }
    if (n >= 2) { a.incendiary = 8 + 6 * n; names.push('Drachenatem: Zombies brennen'); }
    if (n >= 3) { a.pierce = 2; a.pierceKeep = 0.75; names.push('Kugeln durchschlagen'); }
  } else if (id === 'ricochet') { a.ricochet = 2 + n; names.push(`Prallt ${a.ricochet}× ab`);
  } else if (id === 'shock') { a.stun = 2.5 + n; a.pellets = base.pellets + 2 * n; names.push(`Lähmt ${a.stun.toFixed(1)} s · ${a.pellets} Kugeln`);
  } else if (id === 'boomrev') { a.blast = { r: 1.2 + 0.3 * n, k: 0.7 + 0.1 * n }; names.push(`Größere Explosion (${a.blast.r.toFixed(1)} m)`);
  } else if (id === 'headhunter') { a.headMult = 5 + n; a.pierce = 1 + n; a.pierceKeep = 0.9; names.push(`Kopfschuss ×${a.headMult} · Durchschlag ${a.pierce}`);
  } else if (id === 'rail') { a.pierce = 12 + 4 * n; names.push(`Durchschlag ${a.pierce}`);
  } else if (id === 'sonic') { names.push('Größere Reichweite & breiterer Kegel');
  } else if (HANDCANNONS.includes(id)) {
    if (base.action === 'lever') { a.autoCycle = true; names.push('Repetiert von selbst'); }
    a.pierce = 1 + n; a.pierceKeep = 0.85; names.push(`Durchschlag: ${a.pierce} Zombies`);
  }
  return { a, names };
}
function upgradedDef(base, n) {
  const T = UPGRADE_TIERS[n - 1];
  const ab = upgradeAbilities(base.id || Object.keys(WEAPON_DEFS).find(k => WEAPON_DEFS[k] === base), base, n);
  return Object.assign({}, base, ab.a, { abilities: ab.names }, {
    name: base.name + ' ' + T.stars, upgraded: true, up: n, dmg: Math.round((base.dmg ?? 30) * T.dmg),
    capacity: Math.max(base.capacity + n, Math.round(base.capacity * T.cap)), rpm: base.rpm * T.rpm, spread: base.spread * (1 - 0.15 * n),
    reserveK: 1 + 0.5 * n // Reserve-Munition: ★ ×1,5 · ★★ ×2 · ★★★ ×2,5 (zusätzlich zum größeren Magazin)
  });
}
function upgradeWeapon(w) {
  const n = (w.def.up || 0) + 1;
  w.def = upgradedDef(WEAPON_DEFS[w.id], n);
  if (!w.camoMeshes) { w.camoMeshes = []; w.root.traverse(o => { if (o.isMesh && o.material && o.material.isMeshStandardMaterial && !o.material.map && !o.material.transparent && o.material.toneMapped !== false && !o.userData.sight) w.camoMeshes.push(o); /* Visier bleibt frei */ }); }
  for (const o of w.camoMeshes) o.material = camoMats[n - 1];
  refillAmmo(w); // aufgerüstet = immer komplett neue Munition (volles, größeres Magazin + mehr Reserve)
  if (w.holder >= 0 || w === deskW) setBeltWeapon(w.id, w.def, w);
  const base = WEAPON_DEFS[w.id];
  const at = w === deskW ? inFront(1.3, 0.15, headPos.y + 0.15) : w.root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.25, 0)); // am PC nicht direkt vor dem Auge
  floatingText(`${UPGRADE_TIERS[n - 1].stars} Magazin ${base.capacity}→${w.def.capacity} · Reserve ${w.reserve}`, at, '#ffd84a');
  if (w.def.abilities && w.def.abilities.length) later(1.1, () => floatingText('Neu: ' + w.def.abilities.join(' · '), at.clone().add(new THREE.Vector3(0, -0.12, 0)), '#7dffa8'));
  boardDirty = true;
}
const bottleMats = {};
function makeBottle(color) {
  const g = new THREE.Group();
  const glass = bottleMats[color] || (bottleMats[color] = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.15, metalness: 0.1 }));
  g.add(cylY(0.028, 0.028, 0.11, glass, 0, 0));
  g.add(cylY(0.012, 0.026, 0.035, glass, 0, 0.072));
  g.add(cylY(0.014, 0.014, 0.012, MAT.steel, 0, 0.096));
  return g;
}
function clearMachines() {
  for (const m of machines.splice(0)) { scene.remove(m.group); m.group.traverse(o => { if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); if (o.material && o.material !== machineDark && o.material !== machineChrome) o.material.dispose(); }); }
  if (upg.w) upg.w.inMachine = false;
  Object.assign(upg, { m: null, w: null, state: 'idle', t: 0 });
}
const machineDark = new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.5, metalness: 0.6 });
const machineChrome = new THREE.MeshStandardMaterial({ color: 0xb8bec6, roughness: 0.2, metalness: 1 });
function buildPerkMachine(spot, kind) {
  const P = PERKS[kind];
  const col = new THREE.Color(P.color);
  const g = new THREE.Group();
  g.position.copy(spot.pos).setY(0).addScaledVector(spot.normal, 0.2 * MACHINE_SCALE);
  g.lookAt(g.position.clone().add(spot.normal));
  g.scale.setScalar(MACHINE_SCALE);
  const bodyMat = new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.55), roughness: 0.45, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.75, 0.38), bodyMat);
  body.position.y = 0.875;
  g.add(body);
  const front = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.96), new THREE.MeshStandardMaterial({ map: perkTexture(kind), emissive: 0xffffff, emissiveMap: perkTexture(kind), emissiveIntensity: 0.9, roughness: 0.3 }));
  front.position.set(0, 1.12, 0.192);
  g.add(front);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.05, 0.4), new THREE.MeshBasicMaterial({ color: col, toneMapped: false }));
  strip.position.y = 1.77;
  g.add(strip);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.02), machineDark);
  slot.position.set(0, 0.36, 0.19);
  g.add(slot);
  const btn = new THREE.Mesh(cachedGeo('perkbtn', () => new THREE.SphereGeometry(0.035, 14, 10)), new THREE.MeshBasicMaterial({ color: col, toneMapped: false }));
  btn.position.set(0.2, 0.55, 0.2);
  g.add(btn);
  for (const x of [-0.31, 0.31]) { const e = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.75, 0.4), machineChrome); e.position.set(x, 0.875, 0); g.add(e); }
  // Lichtschein auf dem Boden
  const glow = new THREE.Mesh(cachedGeo('perkglow', () => new THREE.PlaneGeometry(1.2, 0.9)), new THREE.MeshBasicMaterial({ map: wbGlowTex, color: col, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(0, 0.006, 0.45);
  g.add(glow);
  castShadows(g);
  scene.add(g);
  mergeStatic(g, { btn, glow });
  g.updateMatrixWorld(true);
  machines.push({ type: 'perk', kind, group: g, normal: spot.normal.clone(), front: g.localToWorld(new THREE.Vector3(0, 1.0, 0.25)), btn, glow, phase: Math.random() * 6 });
}
function buildUpgrader(spot) {
  const g = new THREE.Group();
  g.position.copy(spot.pos).setY(0).addScaledVector(spot.normal, 0.26 * MACHINE_SCALE);
  g.lookAt(g.position.clone().add(spot.normal));
  g.scale.setScalar(MACHINE_SCALE);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.5), machineDark);
  body.position.y = 0.55;
  g.add(body);
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.08, 0.56), machineChrome);
  top.position.y = 1.14;
  g.add(top);
  const slotMat = new THREE.MeshBasicMaterial({ color: 0xb26bff, toneMapped: false });
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, 0.02), slotMat);
  slot.position.set(0, 0.92, 0.252);
  g.add(slot);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.25), new THREE.MeshStandardMaterial({ map: upgTexture(), emissive: 0xffffff, emissiveMap: upgTexture(), emissiveIntensity: 0.9 }));
  sign.position.set(0, 0.55, 0.252);
  g.add(sign);
  const gears = [];
  for (const x of [-0.46, 0.46]) {
    const gear = new THREE.Mesh(cachedGeo('upggear', () => new THREE.TorusGeometry(0.16, 0.035, 6, 12)), machineChrome);
    gear.position.set(x, 0.6, 0);
    gear.rotation.y = Math.PI / 2;
    g.add(gear);
    gears.push(gear);
  }
  const glow = new THREE.Mesh(cachedGeo('perkglow', () => new THREE.PlaneGeometry(1.2, 0.9)), new THREE.MeshBasicMaterial({ map: wbGlowTex, color: 0xb26bff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(0, 0.006, 0.55);
  g.add(glow);
  castShadows(g);
  scene.add(g);
  mergeStatic(g, { glow, g0: gears[0], g1: gears[1], slot });
  g.updateMatrixWorld(true);
  const m = { type: 'upgrade', group: g, normal: spot.normal.clone(), front: g.localToWorld(new THREE.Vector3(0, 0.92, 0.32)), slotPos: g.localToWorld(new THREE.Vector3(0, 0.92, 0.0)), gears, glow, slotMat, phase: 0 };
  machines.push(m);
  upg.m = m;
}
const MACHINE_SCALE = 0.7; // kleiner, damit sie nicht so viel Platz wegnehmen
function setupMachines() {
  clearMachines();
  const avoid = wallbuys.map(wb => wb.s.pos);
  const ownP = surfacesOf('perk'), ownU = surfacesOf('upgrade');
  const auto = settings.autoPlace === 'all';
  const perkSpots = ownP.length || !auto ? ownP.map(s0 => ({ pos: s0.pos, normal: s0.normal, kind: s0.kind })) : freeWallSpots(PERK_ORDER.length, 0, avoid, 0.9, [2.3, -2.3, 2.75, -2.75, 1.85, -1.85, 3.1, -3.1, 1.4, -1.4], 2.4).map((sp, i) => ({ ...sp, kind: PERK_ORDER[i] }));
  for (const sp of perkSpots) if (PERKS[sp.kind]) buildPerkMachine(sp, sp.kind);
  const upSpot = ownU[0] || (auto ? freeWallSpots(1, 0, [...avoid, ...perkSpots.map(p0 => p0.pos)], 1.0, [0.9], 2.4)[0] : null);
  if (upSpot) buildUpgrader(upSpot);
}
function machineNear(p) {
  let best = null, bd = 0.38;
  for (const m of machines) {
    const d = p.distanceTo(m.front);
    if (d < bd) { bd = d; best = m; }
  }
  if (upg.state === 'ready' && upg.w && upg.w.root.position.distanceTo(p) < 0.3) return upg.m;
  return best;
}
function applyPerk(kind) {
  perks.add(kind);
  if (kind === 'eisen') playerHp = Math.min(maxHp(), playerHp + 100);
  if (kind === 'muni') for (const w of arsenal) refillAmmo(w); // gleich mit mehr Munition auffüllen
  boardDirty = true;
}
function useMachine(m, h) {
  const where = m.front.clone().addScaledVector(m.normal, 0.2);
  if (m.type === 'perk') {
    const P = PERKS[m.kind];
    if (perks.has(m.kind)) { floatingText('Schon getrunken', where, '#cccccc'); return false; }
    if (!spend(price.perk(P), where)) return false;
    applyPerk(m.kind);
    floatingText(P.name + '!', where, P.color);
    speak(P.name);
    SFX.jingle([523, 784, 1046]);
    if (h) holdItem(h, 'bottle', makeBottle(new THREE.Color(P.color).getHex()), { t: 0 });
    return true;
  }
  // Aufrüster
  if (upg.state === 'ready' && upg.w) {
    const w = upg.w;
    w.inMachine = false;
    Object.assign(upg, { w: null, state: 'idle' });
    if (h) takeWeapon(w, h); else equipDesk(w);
    return true;
  }
  if (upg.state === 'working') return false;
  const w = h ? heldWeapon(otherHand(h)) : deskW;
  if (!w) { floatingText('Waffe in die andere Hand nehmen', where, '#ffcc33'); return false; }
  const nextUp = (w.def.up || 0) + 1;
  if (nextUp > UPGRADE_TIERS.length) { floatingText('Maximal aufgerüstet ★★★', where, '#ffe14a'); return false; }
  const tier = UPGRADE_TIERS[nextUp - 1];
  if (!free() && wave < tier.wave) { floatingText(`Stufe ${tier.stars} ab Welle ${tier.wave}`, where, '#cccccc'); return false; }
  if (!spend(price.upgrade(tier), where)) return false;
  // Waffe wandert in die Maschine
  if (h) {
    const o = otherHand(h);
    for (const q of hands) if (q.grab && q.grab.w === w) releaseGrab(q);
    o.held = null;
    w.holder = -1;
    w.twoHanding = false;
    w.parts.flash.visible = false;
    w.smoothQ = null;
  } else if (deskW === w) { deskW = null; camera.remove(w.root); scene.add(w.root); }
  if (w.phys) { removeDynamic(w.phys); w.phys = null; }
  if (w.root.parent !== scene) scene.add(w.root);
  w.inMachine = true;
  Object.assign(upg, { w, state: 'working', t: 3.5 });
  SFX.jingle([196, 247, 294, 392], 0.3);
  speak('Aufrüsten');
  return true;
}
function updateMachines(dt) {
  camoMats.forEach((m, i) => { m.map.offset.x += dt * (0.06 + i * 0.05); m.map.offset.y += dt * (0.03 + i * 0.02); m.emissiveIntensity = 0.55 + Math.sin(elapsed * (4 + i * 2)) * 0.25; });
  camoMats[2].emissive.setHSL((elapsed * 0.1) % 1, 0.6, 0.6); // höchste Stufe schimmert in allen Farben
  for (const m of machines) {
    m.glow.material.opacity = 0.35 + Math.sin(elapsed * 2.2 + m.phase) * 0.15;
    if (m.type === 'perk') m.btn.scale.setScalar(perks.has(m.kind) ? 0.6 : 1 + Math.sin(elapsed * 5 + m.phase) * 0.15);
    if (m.type === 'upgrade') for (const [i, gr] of m.gears.entries()) gr.rotation.x += dt * (upg.state === 'working' ? 6 : 0.4) * (i ? 1 : -1);
  }
  // Aufrüsten läuft
  if (upg.w && (upg.w.holder >= 0 || upg.w === deskW)) releaseFromMachine(upg.w);
  const w = upg.w;
  if (w && upg.m) {
    const m = upg.m;
    if (upg.state === 'working') {
      upg.t -= dt;
      w.root.position.lerp(m.slotPos, Math.min(1, dt * 4));
      w.root.quaternion.setFromAxisAngle(UP, Math.atan2(m.normal.x, m.normal.z) + Math.PI / 2);
      m.slotMat.color.setHSL(0.75, 1, 0.5 + Math.sin(elapsed * 20) * 0.2);
      if (Math.random() < dt * 8) sparks(m.front.clone(), m.normal, 5);
      if (Math.random() < dt * 6) SFX.click(200 + Math.random() * 300, 0.25, 0.05);
      if (upg.t <= 0) {
        upgradeWeapon(w);
        upg.state = 'ready';
        upg.t = 0;
        SFX.jingle([523, 659, 784, 1046, 1318], 0.3);
        burst(m.front.clone(), 0xb26bff, 24);
        floatingText(w.def.name, m.front.clone().addScaledVector(m.normal, 0.3).setY(1.35), '#d9b8ff');
      }
    } else if (upg.state === 'ready') {
      upg.t += dt;
      const target = m.front.clone().addScaledVector(m.normal, 0.25).setY(1.0 + Math.sin(elapsed * 2) * 0.03);
      w.root.position.lerp(target, Math.min(1, dt * 5));
      w.root.rotateY(dt * 0.8);
    }
  }
  // Perk-Getränk an den Mund führen = trinken
  for (const h of hands) {
    if (!h.held || h.held.type !== 'bottle') continue;
    h.held.t += dt;
    if (h.point.distanceTo(headPos) < 0.22 || h.held.t > 8) {
      h.ray.remove(h.held.obj);
      h.held = null;
      SFX.gulp();
      pulse(h, 0.4, 200);
    }
  }
}

// =============================================================================
// Fallen: Elektro- und Feuerfalle auf dem Boden, per Hebel aktivieren (1000 Punkte)
// =============================================================================
const TRAPS = {
  electric: { name: 'Elektrofalle', price: 1000, dur: 15, cool: 35, color: 0x7fd4ff },
  fire: { name: 'Feuerfalle', price: 1000, dur: 15, cool: 35, color: 0xff7a1a }
};
const traps = [];
const trapTex = {};
function trapTexture(kind) {
  if (trapTex[kind]) return trapTex[kind];
  const t = panelTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#1b1c20'; ctx.fillRect(0, 0, w, h);
    // Warnstreifen am Rand
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.rect(22, 22, w - 44, h - 44); ctx.clip('evenodd');
    for (let i = -h; i < w + h; i += 28) { ctx.fillStyle = '#e8c21a'; ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 14, 0); ctx.lineTo(i + 14 - h, h); ctx.lineTo(i - h, h); ctx.fill(); }
    ctx.restore();
    if (kind === 'electric') { ctx.strokeStyle = '#4a7a99'; ctx.lineWidth = 3; for (let i = 40; i < w - 30; i += 22) { ctx.beginPath(); ctx.moveTo(i, 34); ctx.lineTo(i, h - 34); ctx.stroke(); ctx.beginPath(); ctx.moveTo(34, i); ctx.lineTo(w - 34, i); ctx.stroke(); } }
    else { ctx.fillStyle = '#2a1206'; for (let x = 36; x < w - 36; x += 16) ctx.fillRect(x, 34, 9, h - 68); ctx.fillStyle = 'rgba(255,90,0,0.25)'; ctx.fillRect(30, 30, w - 60, h - 60); }
  });
  trapTex[kind] = t;
  return t;
}
function clearTraps() {
  for (const t of traps.splice(0)) { scene.remove(t.group); t.group.traverse(o => { if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); if (o.material && o.material !== machineDark && o.material !== machineChrome) o.material.dispose(); }); }
}
function buildTrap(pos, normal, kind) {
  const T = TRAPS[kind];
  const g = new THREE.Group();
  g.position.copy(pos).setY(0);
  g.rotation.y = Math.atan2(normal.x, normal.z);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), new THREE.MeshStandardMaterial({ map: trapTexture(kind), roughness: 0.6, metalness: 0.4 }));
  plate.rotation.x = -Math.PI / 2;
  plate.position.y = 0.006;
  plate.receiveShadow = true;
  g.add(plate);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), new THREE.MeshBasicMaterial({ map: wbGlowTex, color: T.color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.01;
  g.add(glow);
  const posts = [];
  if (kind === 'electric') {
    for (const [x, z] of [[-0.62, -0.62], [0.62, -0.62], [-0.62, 0.62], [0.62, 0.62]]) {
      const p0 = new THREE.Mesh(cachedGeo('trappost', () => new THREE.CylinderGeometry(0.025, 0.035, 0.35, 10)), machineDark);
      p0.position.set(x, 0.175, z);
      g.add(p0);
      const cap = new THREE.Mesh(cachedGeo('trapcap', () => new THREE.SphereGeometry(0.035, 12, 8)), new THREE.MeshBasicMaterial({ color: 0x3a6a88, toneMapped: false }));
      cap.position.set(x, 0.37, z);
      g.add(cap);
      posts.push(cap);
    }
  } else {
    for (let i = 0; i < 6; i++) { const n = new THREE.Mesh(cachedGeo('trapnozzle', () => new THREE.CylinderGeometry(0.02, 0.03, 0.05, 8)), machineChrome); n.position.set(-0.5 + (i % 3) * 0.5, 0.025, i < 3 ? -0.4 : 0.4); g.add(n); }
  }
  // Hebel seitlich (zum Spieler hin) auf einem Pfosten
  const lever = new THREE.Group();
  lever.position.set(0.8, 0, 0.85);
  const pole = new THREE.Mesh(cachedGeo('trappole', () => new THREE.BoxGeometry(0.06, 1.0, 0.06)), machineDark);
  pole.position.y = 0.5;
  lever.add(pole);
  const box0 = new THREE.Mesh(cachedGeo('trapbox', () => new THREE.BoxGeometry(0.14, 0.2, 0.1)), machineChrome);
  box0.position.y = 1.05;
  lever.add(box0);
  const lamp = new THREE.Mesh(cachedGeo('traplamp', () => new THREE.SphereGeometry(0.02, 10, 8)), new THREE.MeshBasicMaterial({ color: 0x3aff6a, toneMapped: false }));
  lamp.position.set(0, 1.17, 0);
  lever.add(lamp);
  const arm = new THREE.Group();
  arm.position.set(0, 1.05, 0.05);
  const stick = new THREE.Mesh(cachedGeo('traparm', () => new THREE.BoxGeometry(0.025, 0.025, 0.2)), machineChrome);
  stick.position.z = 0.1;
  arm.add(stick);
  const knob = new THREE.Mesh(cachedGeo('trapknob', () => new THREE.SphereGeometry(0.03, 12, 8)), new THREE.MeshStandardMaterial({ color: 0xc8202a, roughness: 0.4 }));
  knob.position.z = 0.2;
  arm.add(knob);
  arm.rotation.x = -0.7;
  lever.add(arm);
  g.add(lever);
  castShadows(g);
  scene.add(g);
  g.updateMatrixWorld(true);
  const t = { kind, T, group: g, glow, posts, lamp, arm, knob, state: 'ready', t: 0, tick: 0, fxT: 0, center: g.position.clone(), yaw: g.rotation.y };
  traps.push(t);
}
function setupTraps() {
  clearTraps();
  const own = surfacesOf('trap');
  if (own.length) { for (const s0 of own) buildTrap(s0.pos, s0.normal, s0.kind || 'electric'); return; }
  // automatisch: vor den ersten zwei Türen/Fenstern (innen)
  if (settings.autoPlace !== 'all') return;
  openings().slice(0, 2).forEach((o, i) => buildTrap(o.mid.clone().addScaledVector(o.normal, 1.15).setY(0), o.normal.clone(), i % 2 ? 'fire' : 'electric'));
}
function knobPos(t) { return t.knob.getWorldPosition(new THREE.Vector3()); }
function trapNear(p) { for (const t of traps) if (p.distanceTo(knobPos(t)) < 0.2) return t; return null; }
function pullTrap(t, h) {
  const where = knobPos(t).add(new THREE.Vector3(0, 0.3, 0));
  if (t.state === 'active') return false;
  if (t.state === 'cool') { floatingText(`Lädt noch ${Math.ceil(t.t)} s`, where, '#cccccc'); return false; }
  if (!spend(price.trap(), where)) return false;
  t.state = 'active';
  t.t = t.T.dur;
  SFX.clang();
  if (h) pulse(h, 0.8, 120);
  speak(t.T.name);
  return true;
}
const inTrap = (t, x, z) => { const dx = x - t.center.x, dz = z - t.center.z, c = Math.cos(t.yaw), s0 = Math.sin(t.yaw); return Math.abs(dx * c - dz * s0) < 0.68 && Math.abs(dx * s0 + dz * c) < 0.68; };
function updateTraps(dt) {
  for (const t of traps) {
    // Hebel-Stellung und Lampe
    const down = t.state === 'active';
    t.arm.rotation.x = THREE.MathUtils.damp(t.arm.rotation.x, down ? 0.7 : -0.7, 10, dt);
    t.lamp.material.color.setHex(t.state === 'ready' ? 0x3aff6a : t.state === 'active' ? 0xffd21f : 0xff3a3a);
    t.glow.material.opacity = THREE.MathUtils.damp(t.glow.material.opacity, down ? 0.8 + Math.sin(elapsed * 30) * 0.2 : t.state === 'ready' ? 0.12 : 0, 8, dt);
    if (t.state === 'cool') { t.t -= dt; if (t.t <= 0) { t.state = 'ready'; SFX.click(1200, 0.3, 0.05); } continue; }
    if (t.state !== 'active') continue;
    t.t -= dt;
    if (t.t <= 0) { t.state = 'cool'; t.t = t.T.cool; continue; }
    // Effekte
    t.fxT -= dt;
    if (t.fxT <= 0) {
      if (t.kind === 'electric') {
        t.fxT = 0.09;
        const a = t.posts[Math.floor(Math.random() * 4)].getWorldPosition(new THREE.Vector3()), b0 = t.posts[Math.floor(Math.random() * 4)].getWorldPosition(new THREE.Vector3());
        if (a.distanceTo(b0) > 0.1) lightningLine(a, b0);
        if (Math.random() < 0.3) SFX.zap();
        for (const p of t.posts) p.material.color.setHex(Math.random() < 0.5 ? 0xbfefff : 0x3a6a88);
      } else {
        t.fxT = 0.04;
        const lp = new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.05, (Math.random() - 0.5) * 1.2).applyAxisAngle(UP, t.yaw).add(t.center);
        spawnFlamePart(lp, new THREE.Vector3((Math.random() - 0.5) * 0.3, 1.6 + Math.random(), (Math.random() - 0.5) * 0.3), flameMat, 0.7, 0.12);
        if (Math.random() < 0.15) SFX.fire();
      }
    }
    // Schaden
    t.tick -= dt;
    if (t.tick > 0) continue;
    t.tick = 0.2;
    for (const z of zombies) {
      if (z.state === 'dead' || z.state === 'outside' || z.state === 'tear' || !inTrap(t, z.pos.x, z.pos.z)) continue;
      const c = z.root.position.clone().setY(1);
      if (t.kind === 'electric') {
        lightningLine(t.posts[Math.floor(Math.random() * 4)].getWorldPosition(new THREE.Vector3()), c);
        handleZombieHit(damageZombie((z.hitTorso || z.torso.children[1]), c, new THREE.Vector3(0, 1, 0), z.T.boss ? 40 : 9999, true), c, '⚡ ');
      } else {
        if (!z.burnT) burning.add(z);
        z.burnT = 3;
        handleZombieHit(damageZombie((z.hitTorso || z.torso.children[1]), c, new THREE.Vector3(0, 1, 0), 30, true), c, '🔥 ');
      }
    }
    if (inRound() && gameMode !== 'training' && inTrap(t, headPos.x, headPos.z)) { playerHit(t.kind === 'electric' ? 6 : 4); }
  }
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
  if (!s && settings.autoPlace === 'none') return;
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
  const glow = new THREE.Object3D(); // (früher Punktlicht – kostet zu viel Leistung)
  g.add(glow);
  castShadows(g);
  scene.add(g);
  Object.assign(mbox, { group: g, lid: lidPivot, beam, glow, top: new THREE.Vector3(s.center.x, H, s.center.z) });
}
function boxPool() {
  const held = new Set(arsenal.filter(w => w.holder >= 0 || w.holstered || w === deskW).map(w => w.id));
  const ids = WEAPON_ORDER.filter(id => id !== 'pistol' && !held.has(id));
  const weights = ids.map(id => (id === 'plasma' ? 0.5 : WEAPON_DEFS[id].tier >= 3 ? 0.8 : 1));
  if (monkeyCount < 3) { ids.push('monkey'); weights.push(2.2); } // Trommel-Affen (3 Stück)
  return { ids, weights };
}
function setBoxDisplay(id) {
  if (mbox.disp) mbox.group.remove(mbox.disp.holder);
  if (id === 'monkey') {
    const holder = new THREE.Group();
    const m = makeMonkey();
    m.scale.setScalar(2.2);
    m.position.y = -0.1;
    holder.add(m);
    holder.position.set(0, mbox.s.height + 0.05, 0);
    mbox.group.add(holder);
    mbox.disp = { root: m, holder };
    mbox.id = id;
    return;
  }
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
    if (mbox.id === 'monkey') { monkeyCount = 3; syncMonkeySlot(); SFX.bonus(); floatingText('🐒 x3 am Gürtel', where, '#ffd36a'); }
    else giveWeapon(mbox.id, h);
    mbox.state = 'close';
    mbox.t = 0;
    return true;
  }
  if (mbox.state !== 'idle') return false;
  if (boxPool().ids.length === 0 || !spend(price.box(), where)) return false;
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
      const pname = pick === 'monkey' ? '3 Trommel-Affen' : WEAPON_DEFS[pick].name;
      floatingText(pname, mbox.top.clone().add(new THREE.Vector3(0, 0.8, 0)), pick === 'plasma' ? '#7dff9a' : '#9fe8ff');
      speak(pname);
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
  const got = awardPlank();
  floatingText(got ? '🔨 +10' : '🔨', t.slot.pos.clone().addScaledVector(t.o.normal, 0.1), '#ffd28a');
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
// Trommel-Affe werfen: landet, zieht sich auf, trommelt 8 s lang (alle Zombies kommen) und explodiert
const monkeys = [];
function throwMonkey(h) {
  const m = h.held.obj;
  h.held = null;
  m.updateWorldMatrix(true, false);
  m.matrixWorld.decompose(m.position, m.quaternion, tmpS);
  h.ray.remove(m);
  scene.add(m);
  const v = h.vel.clone();
  if (v.length() < 1.2 && m.position.distanceTo(monkeySlot.obj.getWorldPosition(tmpV)) < 0.22) { // zurück an den Gürtel
    scene.remove(m);
    monkeyCount++;
    syncMonkeySlot();
    return;
  }
  launchMonkey(m, v.multiplyScalar(1.3));
}
function launchMonkey(m, vel) {
  m.scale.setScalar(1.5);
  const phys = addDynamic(m, localBoxOf(m), 0.6, { vel, angVel: new THREE.Vector3(), angularDamping: 0.9, onImpact: (v) => SFX.thud(Math.min(0.4, v * 0.1)) });
  monkeys.push({ obj: m, phys, t: 0, active: false, beat: 0 });
  SFX.whoosh();
}
function updateMonkeys(dt) {
  for (let i = monkeys.length - 1; i >= 0; i--) {
    const mk = monkeys[i];
    mk.t += dt;
    const ud = mk.obj.userData;
    if (!mk.active && mk.t > 0.9) {
      // liegt still: aufrichten (aus der Physik nehmen) und loslegen
      if (mk.phys) { removeDynamic(mk.phys); mk.phys = null; }
      const y = heightAt(mk.obj.position.x, mk.obj.position.z);
      mk.obj.position.y = y;
      mk.obj.quaternion.setFromAxisAngle(UP, Math.atan2(headPos.x - mk.obj.position.x, headPos.z - mk.obj.position.z));
      mk.active = true;
      mk.t = 0;
      setLure(mk.obj.position);
      speak('Trommel-Affe!');
    }
    if (!mk.active) continue;
    // Trommeln, Schlüssel dreht sich, Licht blinkt, Musik
    const k = mk.t * 9;
    ud.arms.forEach((a, j) => { a.rotation.x = Math.max(0, Math.sin(k + j * Math.PI)) * 0.9; });
    ud.key.rotation.z += dt * 6;
    ud.light.visible = Math.floor(mk.t * 6) % 2 === 0;
    mk.obj.position.y = heightAt(mk.obj.position.x, mk.obj.position.z) + Math.abs(Math.sin(k * 0.5)) * 0.01;
    mk.beat -= dt;
    if (mk.beat <= 0) {
      mk.beat = 60 / 160 / 2;
      SFX3D.drum(mk.obj.position.clone().setY(0.4), Math.floor(mk.t * 5.33) % 4);
    }
    setLure(mk.obj.position);
    if (mk.t > 8) { // Explosion
      const pos = mk.obj.position.clone().setY(mk.obj.position.y + 0.3);
      scene.remove(mk.obj);
      monkeys.splice(i, 1);
      if (!monkeys.some(o => o.active)) setLure(null);
      SFX.explosion(1.2);
      flashLight.position.copy(pos); flashLight.distance = 9; flashLight.intensity = 40;
      burst(pos, 0xffb030, 34); burst(pos, 0x6b4423, 14);
      shockwave(pos);
      floorDecal(pos, 'scorch', 1.6);
      for (const r of explosionDamage(pos, 3.8, 600)) handleZombieHit(r, r.zombie.skull.getWorldPosition(new THREE.Vector3()), '🐒 ');
      const pd = headPos.distanceTo(pos);
      for (const h of hands) pulse(h, Math.max(0.3, 1 - pd / 6), 300);
      if (pd < 3 && gameMode !== 'training') playerHit(40 * (1 - pd / 3));
    }
  }
}
function clearMonkeys() { for (const mk of monkeys.splice(0)) { if (mk.phys) removeDynamic(mk.phys); scene.remove(mk.obj); } setLure(null); }
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
    else take = hyp(camera.position.x - m.obj.position.x, camera.position.z - m.obj.position.z) < 1.0;
    if (take) collectMedkit(m);
    else if (m.t > 30) { scene.remove(m.obj); medkits.splice(i, 1); }
  }
}
function collectMedkit(m) {
  scene.remove(m.obj);
  medkits.splice(medkits.indexOf(m), 1);
  playerHp = Math.min(maxHp(), playerHp + 35);
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
// ---- Einstellungen: alle an einem Ort, gespeichert als ein Eintrag --------------------------
const ten = (lbl = (v) => (v === 0 ? 'Aus' : v * 10 + ' %')) => Array.from({ length: 11 }, (_, i) => [i, lbl(i)]);
const onOff = [[true, 'An'], [false, 'Aus']];
const SETTINGS_TABS = {
  ton: { label: '🔊 Ton', items: [
    { key: 'master', label: 'Gesamtlautstärke', opts: ten() },
    { key: 'sfx', label: 'Effekte (Waffen, Treffer)', opts: ten() },
    { key: 'music', label: 'Musik', opts: ten() },
    { key: 'voices', label: 'Zombie-Stimmen', opts: ten() },
    { key: 'announcer', label: 'Ansager', opts: ten() },
    { key: 'announcerVoice', label: 'Ansager-Stimme', opts: [['demon', 'Dämon'], ['deep', 'Tief'], ['normal', 'Normal'], ['high', 'Hoch']] }
  ] },
  spiel: { label: '🧟 Spiel', items: [
    { key: 'startPoints', label: 'Startpunkte', opts: [[500, '500'], [1500, '1500'], [5000, '5000'], [20000, '20000']] },
    { key: 'amount', label: 'Zombie-Menge', opts: [[0.7, 'Weniger'], [1, 'Normal'], [1.4, 'Mehr'], [1.8, 'Horde']] },
    { key: 'blood', label: 'Blut', opts: [[0, 'Aus'], [1, 'Normal'], [2, 'Extra']] },
    { key: 'killcam', label: 'Zeitlupe beim letzten Kill', opts: onOff },
    { key: 'ambient', label: 'Gruselgeräusche', opts: onOff },
    { key: 'hitmarker', label: 'Treffer-Ton', opts: onOff },
    { key: 'autoPlace', label: 'Automatisch aufstellen', opts: [['none', 'Nichts'], ['weapons', 'Waffen+Kiste'], ['all', 'Alles']] },
    { key: 'startWave', label: 'Start in Welle', opts: [[1, '1'], [5, '5'], [10, '10'], [15, '15'], [20, '20'], [25, '25'], [30, '30']] }
  ] },
  preise: { label: '💰 Preise', items: [
    { key: 'priceWeapons', label: 'Wandkauf-Waffen', opts: [[0.5, '50 %'], [0.75, '75 %'], [1, '100 %'], [1.5, '150 %'], [2, '200 %']] },
    { key: 'priceBox', label: 'Glückskiste', opts: [[500, '500'], [950, '950'], [1500, '1500'], [2500, '2500']] },
    { key: 'pricePerks', label: 'Getränke-Automaten', opts: [[0.5, '50 %'], [0.75, '75 %'], [1, '100 %'], [1.5, '150 %'], [2, '200 %']] },
    { key: 'priceUpgrade', label: 'Aufrüster', opts: [[0.25, '25 %'], [0.5, '50 %'], [0.75, '75 %'], [1, '100 %'], [1.5, '150 %']] },
    { key: 'priceTrap', label: 'Fallen', opts: [[250, '250'], [500, '500'], [1000, '1000'], [2000, '2000']] },
    { key: 'pointsMul', label: 'Punkte für Treffer & Kills', opts: [[0.5, '×0,5'], [0.75, '×0,75'], [1, '×1'], [1.5, '×1,5'], [2, '×2'], [3, '×3']] }
  ] },
  bedienung: { label: '✊ Bedienung', items: [
    { key: 'guides', label: 'Leuchtende Hilfen', opts: onOff },
    { key: 'grip', label: 'Griff-Taste', opts: [['hold', 'Halten'], ['toggle', 'Tippen']] },
    { key: 'reload', label: 'Nachladen', opts: [['real', 'Echt'], ['simple', 'Einfach']] },
    { key: 'assist', label: 'Zielhilfe', opts: onOff },
    { key: 'haptics', label: 'Vibration', opts: [[0, 'Aus'], [0.5, 'Schwach'], [1, 'Normal'], [1.5, 'Stark']] },
    { key: 'wristHud', label: 'Anzeige am Handgelenk', opts: onOff },
    { key: 'snapBelt', label: 'Gürtel-Abstand', opts: [[0.85, 'Eng'], [1, 'Normal'], [1.2, 'Weit']] },
    { key: 'popups', label: 'Punkte-Anzeigen', opts: onOff }
  ] },
  grafik: { label: '✨ Grafik', items: [
    { key: 'quality', label: 'Leistung', opts: [['quality', 'Schön'], ['balanced', 'Ausgewogen'], ['fast', 'Flüssig']] },
    { key: 'shadows', label: 'Echte Schatten', opts: onOff },
    { key: 'particles', label: 'Partikel', opts: [[0.5, 'Wenig'], [1, 'Normal'], [1.6, 'Viel']] },
    { key: 'dust', label: 'Staub in der Luft', opts: onOff },
    { key: 'eyeGlow', label: 'Leuchtende Zombie-Augen', opts: onOff },
    { key: 'frameRate', label: 'Bildrate (Brille)', opts: [[72, '72 Hz'], [90, '90 Hz'], [120, '120 Hz']] },
    { key: 'autoPerf', label: 'Automatisch flüssig halten', opts: onOff },
    { key: 'corpseTime', label: 'Tote Zombies liegen', opts: [[0.4, 'Sehr kurz'], [1.2, 'Kurz'], [3, 'Normal'], [8, 'Lang']] }
  ] }
};
const SETTINGS_DEFAULT = {
  master: 9, sfx: 10, music: 6, voices: 10, announcer: 10, announcerVoice: 'deep',
  startPoints: 500, amount: 1, blood: 1, killcam: true, ambient: true, hitmarker: true,
  grip: 'hold', reload: 'real', assist: true, haptics: 1, wristHud: true, snapBelt: 1,
  shadows: true, particles: 1, dust: true, popups: true, eyeGlow: true, autoPerf: true,
  autoPlace: 'weapons', corpseTime: 1.2, quality: 'balanced', guides: true, priceWeapons: 1, priceBox: 950, pricePerks: 1, priceUpgrade: 1, priceTrap: 1000, pointsMul: 1, frameRate: 90, startWave: 1
};
// Preise laut Einstellungen (auf schöne Zahlen gerundet)
const price = {
  weapon: (def) => Math.round(def.price * settings.priceWeapons / 50) * 50,
  ammo: (def) => Math.round(def.price * settings.priceWeapons / 100) * 50,
  box: () => settings.priceBox,
  perk: (P) => Math.round(P.price * settings.pricePerks / 50) * 50,
  upgrade: (t) => Math.round(t.price * settings.priceUpgrade / 250) * 250,
  trap: () => settings.priceTrap
};
const settings = Object.assign({}, SETTINGS_DEFAULT, {
  // ältere Einzel-Einstellungen übernehmen
  grip: load('vrspiel-griff', 'hold'), reload: load('vrspiel-nachladen', 'real'), assist: load('vrspiel-zielhilfe', true),
  announcer: load('vrspiel-ansager', true) ? 10 : 0, shadows: shadowsOn
}, load('vrspiel-einstellungen', {}));
let voiceOn = settings.announcer > 0;
function applySettings() {
  setVolumes({ master: settings.master / 10, sfx: settings.sfx / 10, music: settings.music / 10, voices: settings.voices / 10 });
  voiceOn = settings.announcer > 0;
  fx.blood = settings.blood;
  fx.particles = settings.particles;
  fx.popups = settings.popups;
  if (shadowsOn !== settings.shadows) setShadows(settings.shadows);
  if (typeof dust !== 'undefined') dust.visible = settings.dust;
  setEyeGlow(settings.eyeGlow);
  setCorpseTime(settings.corpseTime);
  applyQuality();
  perf.level = 0; perf.lowHz = false;
  if (renderer.xr.isPresenting) applyFrameRate();
}
function setSetting(k, v) {
  settings[k] = v;
  store('vrspiel-einstellungen', settings);
  applySettings();
  refreshMenu();
}
function speak(textStr) {
  if (!voiceOn || !window.speechSynthesis) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(textStr);
    u.lang = 'de-DE';
    u.pitch = { demon: 0.05, deep: 0.55, normal: 1, high: 1.45 }[settings.announcerVoice] ?? 0.55;
    u.rate = settings.announcerVoice === 'demon' ? 0.82 : 0.95;
    u.volume = settings.announcer / 10;
    const v = speechSynthesis.getVoices().find(x => x.lang && x.lang.startsWith('de'));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch { /* keine Sprachausgabe */ }
}
let lowHpWarned = false, bruteWarned = false, pendingDeath = false, bossPending = false, bossWave = false, warriorWave = false, bossSpawnT = 0;
let streak = 0, lastKillT = -10, streakMsg = null, lastBreakSec = 0;
function topList(mode) { return load('vrspiel-top-' + mode, []); }
const TOP_N = 10;
function addTop(mode, entry) {
  const list = topList(mode);
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  store('vrspiel-top-' + mode, list.slice(0, TOP_N));
  return list.indexOf(entry);
}
const qualifiesTop = (mode, sc) => { const l = topList(mode); return sc > 0 && (l.length < TOP_N || sc > l[l.length - 1].score); };


// =============================================================================
// Hände: greifen, loslassen, zeigen (VR)
// =============================================================================
function grabCandidates(h) {
  // Dinge in Reichweite der Hand
  const list = [];
  for (const w of arsenal) {
    if (w.holder >= 0 || w === deskW || w.holstered || w.inMachine || w.inBelt) continue;
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
  if (w.def.action !== 'pump' && w.def.action !== 'none') opts.push({ type: 'charger', d: p.distanceTo(w.sockets.chargerGrab.getWorldPosition(tmpV)) / 0.12 });
  if (w.sockets.foregrip) opts.push({ type: 'fore', d: p.distanceTo(w.sockets.foregrip.getWorldPosition(tmpV)) / 0.2 });
  opts.push({ type: 'swap', d: p.distanceTo(w.root.getWorldPosition(tmpV)) / 0.05 });
  opts.sort((a, b) => a.d - b.d);
  if (opts[0].d > 1) {
    // Hand irgendwo vorne an einer Langwaffe: als Vorderschaft-Griff werten
    if (!w.sockets.foregrip) return false;
    const local = w.root.worldToLocal(p.clone());
    const fl = w.root.worldToLocal(w.sockets.foregrip.getWorldPosition(tmpV));
    if (!(local.z < 0.02 && local.z > fl.z - 0.25 && hyp(local.x, local.y - fl.y) < 0.15)) return false;
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
  if (held.type === 'monkey') { throwMonkey(h); return; }
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
  for (const w of arsenal) if (w.holder < 0 && w !== deskW && !w.inMachine && !w.holstered && !w.inBelt) objs.push({ o: w.root, kind: 'weapon', w });
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
      if (setup.tool === 'door' || setup.tool === 'window' || setup.tool === 'wallbuy' || setup.tool === 'perk' || setup.tool === 'upgrade') {
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
    else if (down(h, 'squeeze') && free && !(state === 'setup' && setup.align)) {
      if (tryWeaponGrab(h)) { /* zweite Hand an der Waffe */ }
      else if (tryBeltGrab(h)) { /* vom Gürtel */ }
      else if (holster && inHolsterZone(h.point)) takeWeapon(holster, h); // aus dem Rückenholster
      else if (trapNear(h.point)) pullTrap(trapNear(h.point), h); // Fallen-Hebel
      else if (inRound() && plankOpeningNear(h.point)) { holdItem(h, 'plank', makePlankMesh(1.0)); } // Brett direkt an der Tür/am Fenster nehmen
      else if (machineNear(h.point)) useMachine(machineNear(h.point), h); // Automat / Aufrüster
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
    // spürbare Rückmeldung: Waffe ist über der Schulter (Rücken) bzw. an der Hüfte (Pistole) – loslassen = einstecken
    const zone = w ? (inHolsterZone(h.point) ? 'back' : w.starter && nearHipHolster(h.point) ? 'hip' : null) : null;
    if (zone !== h.holsterZone) { h.holsterZone = zone; if (zone) { pulse(h, 0.7, 60); SFX.click(zone === 'back' ? 900 : 1400, 0.15, 0.03); } }
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
    // Gewicht spürbar: schwere Waffen einhändig träger, mit zwei Händen ruhig und stabil
    const heavy = Math.sqrt(Math.max(1, (MASS[w.id] || 2) / 1.5));
    const k = 1 - Math.exp(-dt * (w.twoHanding ? 14 : 22 / heavy) * (1 + ang * 60));
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
    if (item.type === 'mag' && item.weaponId === w.id && !w.magInserted && itemPos.distanceTo(w.sockets.magwell.getWorldPosition(tmpV)) < (perks.has('flink') ? 0.22 : 0.17)) {
      off.ray.remove(item.obj);
      off.held = null;
      insertMag(w, item.rounds);
      if (w.def.action === 'none' && w.chamber !== 'live') feed(w);
      pulse(off, 0.8, 50); pulse(main, 0.5, 40);
    } else if (item.type === 'shell' && w.def.feed === 'tube' && w.tube < w.def.capacity && itemPos.distanceTo(w.sockets.loadPort.getWorldPosition(tmpV)) < 0.16) {
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
  if (main.btn.trigger) w.spinning = true;
  continueBurst(w, () => tryFire(w));
}

function updateWeaponVisuals(w, dt) {
  w.cooldown -= dt;
  w.recoil = Math.max(0, w.recoil - dt * (w.def.autoCycle ? 9 : 5));
  w.climb = Math.max(0, (w.climb || 0) - dt * (w.twoHanding ? 2.2 : 1.2)); // Mündung sinkt nach dem Feuern zurück
  const k = w.recoil * w.recoil * (w.recoilGrip || 1);
  w.body.position.z = k * w.def.recoil.back;
  w.body.rotation.x = k * w.def.recoil.rise + w.climb * 0.09;
  w.body.rotation.y = k * w.def.recoil.jitter * w.recoilSide;
  w.parts.flash.visible = w.recoil > 0.7;
  w.parts.flash.rotation.z = Math.random() * Math.PI;
  w.parts.flash.scale.setScalar(w.def.pellets > 1 ? 1.6 : w.id === 'sniper' ? 1.4 : 1);
  w.cycleAnim = Math.max(0, w.cycleAnim - dt * 14);
  if (w.def.spinUp) { // Minigun hochdrehen
    const was = w.spinV || 0;
    w.spinV = THREE.MathUtils.clamp(was + (w.spinning ? dt / w.def.spinUp : -dt / 1.2), 0, 1);
    if (w.spinning && was < 1 && Math.random() < dt * 25 && audioReady()) SFX.click(300 + w.spinV * 900, 0.12, 0.03);
    w.parts.spin.rotation.z += dt * 45 * w.spinV;
    w.spinning = false;
  }
  if (w.parts.string) { w.parts.string.position.z = w.chamber === 'live' ? -0.18 : -0.27; w.parts.arrow.visible = w.chamber === 'live'; }
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

// ---- Bestenliste: Name eingeben (virtuelle Tastatur in VR, am PC auch per Tastatur) -------------
const namePanel = new UIPanel(1.15, 0.8, 680);
namePanel.border = '#ffcc33';
namePanel.visible = false;
let nameEntry = null; // { entry, name }
const KEY_ROWS = ['QWERTZUIOPÜ', 'ASDFGHJKLÖÄ', 'YXCVBNM-'];
function refreshNamePanel() {
  const e = nameEntry;
  if (!e) return;
  const W = Math.round(1.15 * 680);
  const keys = [];
  KEY_ROWS.forEach((r, ri) => keys.push(...row(196 + ri * 74, 64, [...r].map(ch => ({ id: 'k' + ch, label: ch, font: 30, onClick: () => typeName(ch) })), W, 24 + ri * 30, 7)));
  keys.push(...row(418, 64, [
    { id: 'kspace', label: '␣ Leertaste', font: 24, onClick: () => typeName(' ') },
    { id: 'kdel', label: '⌫ Löschen', font: 24, onClick: () => typeName('\b') },
    { id: 'kok', label: '✔ Speichern', font: 28, onClick: saveName, disabled: !e.name.trim() }
  ], W, 24, 10));
  namePanel.set((ctx, w) => {
    text(ctx, `🏆 Platz ${e.place + 1} in der Bestenliste!`, w / 2, 40, 38, '#ffcc33', 'center', true);
    text(ctx, `${e.entry.score} Punkte · Welle ${e.entry.wave} · ${DIFFS[e.entry.diff] ? DIFFS[e.entry.diff].label : ''}`, w / 2, 84, 24, '#cfd8e3');
    roundRect(ctx, 60, 108, w - 120, 64, 12); ctx.fillStyle = '#0e1218'; ctx.fill(); ctx.strokeStyle = '#8796ad'; ctx.lineWidth = 2; ctx.stroke();
    text(ctx, (e.name || '') + (Math.floor(elapsed * 2) % 2 ? '|' : ' '), w / 2, 141, 38, '#fff', 'center', true);
    text(ctx, 'Name eingeben (am PC auch per Tastatur, Enter = speichern)', w / 2, 510, 18, '#8796ad');
  }, keys);
}
function typeName(ch) {
  if (!nameEntry) return;
  if (ch === '\b') nameEntry.name = nameEntry.name.slice(0, -1);
  else if (nameEntry.name.length < 14) nameEntry.name += ch;
  refreshNamePanel();
}
function askName(entry) {
  nameEntry = { entry, name: load('vrspiel-name', ''), place: topList(gameMode).filter(x => x.score >= entry.score).length };
  menuPanel.visible = false; startButton.visible = false; topPanel.visible = false;
  namePanel.visible = true;
  namePanel.place(0.95, 0, -0.12);
  refreshNamePanel();
}
function saveName() {
  if (!nameEntry || !nameEntry.name.trim()) return;
  const name = nameEntry.name.trim();
  store('vrspiel-name', name);
  const place = addTop(gameMode, { ...nameEntry.entry, name });
  nameEntry = null;
  namePanel.visible = false;
  if (lastResult) { lastResult.place = place; lastResult.name = name; }
  SFX.bonus();
  enterMenu();
}
// Bestenliste neben dem Menü (Top 10 mit Namen)
const topPanel = new UIPanel(0.7, 0.8, 680);
topPanel.border = '#ffcc33';
topPanel.visible = false;
function refreshTopPanel() {
  const list = topList(gameMode);
  const mine = lastResult && lastResult.place >= 0 ? lastResult.place : -1;
  topPanel.set((ctx, w, h) => {
    text(ctx, `🏆 Bestenliste · ${MODES[gameMode].label}`, w / 2, 40, 30, '#ffcc33', 'center', true);
    if (!list.length) { text(ctx, 'Noch keine Einträge', w / 2, h / 2, 24, '#8796ad'); return; }
    list.slice(0, TOP_N).forEach((e, i) => {
      const y = 92 + i * 44;
      if (i === mine) { ctx.fillStyle = 'rgba(255,204,51,0.18)'; ctx.fillRect(14, y - 21, w - 28, 42); }
      text(ctx, `${i + 1}.`, 46, y, 24, i < 3 ? '#ffcc33' : '#cfd8e3', 'right', true);
      text(ctx, (e.name || '—').slice(0, 14), 58, y, 24, '#fff', 'left', true);
      text(ctx, String(e.score), w - 150, y, 24, '#ffd21f', 'right', true);
      text(ctx, `W${e.wave} ${DIFFS[e.diff] ? DIFFS[e.diff].icon : ''}`, w - 24, y, 20, '#9ad', 'right');
    });
  });
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
const setup = { perkKind: 'eisen', view: 'main', align: null, hoverS: null, confirm: -1, tool: null, drag: null, pending: null, last: null, msg: '', rotT: 0, planeSupport: false, importReq: false, autoImport: 0, refT: 0 };
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
  trap: ['FALLE: Laser auf den Boden + Abzug (z. B. vor eine Tür). Der Hebel steht seitlich.', 'Abwechselnd Elektro- und Feuerfalle. Im Spiel: Hebel greifen = 1000 Punkte, 15 s aktiv.'],
  perk: ['AUTOMAT: Sorte wählen = Knopf nochmal drücken (♥ ⚡ » ✚). Dann Laser auf eine', 'Wand oder den Boden + Abzug. Jede Sorte gibt es einmal – neu setzen = umstellen.'],
  upgrade: ['AUFRÜSTER: Laser auf eine Wand oder den Boden + Abzug. Dort werden Waffen in 3 Stufen', 'aufgerüstet (Preise unter Einstellungen → Preise).'],
  wallbuy: ['WANDKAUF: Mit dem Laser auf eine markierte Wand zeigen und Abzug drücken.', 'Dort hängt jede Runde eine zufällige Waffe zum Kaufen.'],
  mbox: ['GLÜCKSKISTE: Laser auf den Boden, Abzug drücken (ziehen = Ausrichtung).', 'Für 950 Punkte gibt es eine zufällige Waffe – auch die Wunderwaffe.'],
  erase: ['LÖSCHEN: Mit dem Laser auf eine Fläche zeigen (wird rot),', 'Abzug = diese Fläche entfernen.'],
  align: ['AUSRICHTEN: GRIFF-TASTE HALTEN = Karte anfassen und mit der Hand hinschieben/drehen.', 'Fein: linker Stick schieben, rechter Stick drehen · Laser-Linie an echter Wand = einrasten.'],
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
    text(ctx, `Wände ${count('wall')} · Türen ${count('door')} · Fenster ${count('window')} · Tische ${count('table')} · Stühle ${count('chair')} · Wandkäufe ${count('wallbuy')} · Kiste ${count('mbox') ? '✔' : '–'} · Automaten ${count('perk')} · Fallen ${count('trap')} · Aufrüster ${count('upgrade') ? '✔' : '–'}`, w / 2, 150, 18, '#9ad', 'center', true);
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
      { id: 'chair', label: '💺 Stuhl', active: setup.tool === 'chair', onClick: () => setTool('chair') }
    ], 760),
    ...row(354, 56, [
      { id: 'wallbuy', label: '💰 Wandkauf', font: 23, active: setup.tool === 'wallbuy', onClick: () => setTool('wallbuy') },
      { id: 'mbox', label: '❓ Kiste', font: 23, active: setup.tool === 'mbox', onClick: () => setTool('mbox') },
      { id: 'perk', label: setup.tool === 'perk' ? `${PERKS[setup.perkKind].icon} ${PERKS[setup.perkKind].name}` : '🥤 Automat', font: setup.tool === 'perk' ? 19 : 23, active: setup.tool === 'perk', onClick: () => { if (setup.tool === 'perk') { setup.perkKind = PERK_ORDER[(PERK_ORDER.indexOf(setup.perkKind) + 1) % PERK_ORDER.length]; refreshSetupPanel(); } else setTool('perk'); } },
      { id: 'upgrade', label: '⚙ Aufrüster', font: 23, active: setup.tool === 'upgrade', onClick: () => setTool('upgrade') }
    ], 760, 30, 12),
    ...row(418, 56, [
      { id: 'floor', label: '📏 Boden', font: 23, active: setup.tool === 'floor', onClick: () => setTool('floor') },
      { id: 'quest', label: '📡 Quest-Raum', font: 23, disabled: !setup.planeSupport, onClick: () => { endAlign(); setup.importReq = true; } },
      { id: 'rooms', label: '💾 Räume …', font: 23, onClick: () => { endAlign(); setup.tool = null; setup.view = 'rooms'; setup.confirm = -1; refreshSetupPanel(); } },
      { id: 'align', label: '🧭 Ausrichten', font: 23, disabled: !room.surfaces.length, active: setup.tool === 'align', onClick: () => setTool('align') }
    ], 760, 30, 12),
    ...row(482, 56, [
      { id: 'trap', label: '⚡ Falle', font: 23, active: setup.tool === 'trap', onClick: () => setTool('trap') },
      { id: 'erase', label: '✂ Löschen', font: 23, active: setup.tool === 'erase', onClick: () => setTool('erase') },
      { id: 'undo', label: '↶ Zurück', font: 23, onClick: undoSurface },
      { id: 'clear', label: '🗑 Alles', font: 23, onClick: () => { endAlign(); clearRoom(); syncBench(); setup.last = null; setup.pending = null; setup.msg = 'Alles gelöscht'; refreshSetupPanel(); } }
    ], 760, 30, 12),
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
  resetWeapons(false, false);
  saveRoom();
  SFX.magIn();
  setTool('align');
  setup.msg = `${name} geladen (${n} Flächen) – jetzt an einer echten Wand ausrichten`;
  refreshSetupPanel();
}
// Waffenständer-Gestell an die (evtl. verschobene) Ständer-Fläche anpassen
// alte gespeicherte Waffenständer entfernen (gibt es nicht mehr)
function syncBench() {
  for (const b of surfacesOf('bench')) removeSurface(b);
  bench = null;
}
// ---- Ausrichten: gespeicherte Karte drehen/verschieben, bis sie auf den echten Raum passt ----
function beginAlign() {
  setup.align = { base: serializeRoom(), angle: 0, pivot: headPos.clone().setY(0), offset: new THREE.Vector3(), dirty: false, t: 0, lines: 0 };
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
  resetWeapons(false, false);
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
function snapCorner(p, maxD = 0.4) {
  let best = null, bd = maxD;
  for (const e of wallEnds()) { const d = hyp(e.x - p.x, e.z - p.z); if (d < bd) { bd = d; best = e; } }
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
  if (tool === 'wallbuy' || tool === 'perk' || tool === 'upgrade') {
    const r = rayOf(src);
    const wh = wallHit(r);
    let pos, normal;
    if (wh) {
      const half = tool === 'upgrade' ? 0.35 : tool === 'perk' ? 0.25 : 0.45;
      const u = THREE.MathUtils.clamp(wh.u, half, Math.max(half, wh.wall.width - half));
      pos = wh.wall.a.clone().addScaledVector(wh.wall.right, u).setY(tool === 'wallbuy' ? THREE.MathUtils.clamp(wh.v, 1.0, 1.6) : 1.0);
      normal = wh.wall.normal;
    } else if (tool !== 'wallbuy' && floorHit(r)) { // Automat/Aufrüster auch frei im Raum (schaut zu dir)
      pos = floorHit(r).setY(1.0);
      normal = headPos.clone().sub(pos).setY(0).normalize();
    } else { setup.msg = tool === 'wallbuy' ? 'Zeige mit dem Laser auf eine markierte (blaue) Wand' : 'Laser auf eine Wand oder den Boden richten'; refreshSetupPanel(); return; }
    let kind = null;
    if (tool === 'perk') { kind = setup.perkKind; for (const o of surfacesOf('perk').filter(o => o.kind === kind)) removeSurface(o); } // jede Sorte nur einmal
    if (tool === 'upgrade') for (const o of surfacesOf('upgrade')) removeSurface(o);
    if (surfacesOf('wallbuy', 'perk', 'upgrade').some(o => hyp(o.pos.x - pos.x, o.pos.z - pos.z) < (tool === 'wallbuy' ? 0.9 : 0.55))) { setup.msg = 'Zu nah an einem anderen Platz'; refreshSetupPanel(); return; }
    const x = addWallbuy(pos, normal, tool, kind);
    setup.last = x;
    if (tool === 'perk') { const used = surfacesOf('perk').map(o => o.kind); setup.perkKind = PERK_ORDER.find(k => !used.includes(k)) || kind; }
    setup.msg = tool === 'wallbuy' ? `Wandkauf ${surfacesOf('wallbuy').length} platziert – jede Runde eine zufällige Waffe` : tool === 'perk' ? `Automat „${PERKS[kind].name}“ platziert${setup.perkKind !== kind ? ` – als Nächstes: ${PERKS[setup.perkKind].name}` : ''}` : 'Aufrüster platziert';
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
  } else if (setup.tool === 'trap') {
    const n = headPos.clone().sub(d.start).setY(0);
    if (n.lengthSq() < 1e-4) n.set(0, 0, 1);
    n.normalize();
    const kind = surfacesOf('trap').length % 2 ? 'fire' : 'electric';
    const x = addWallbuy(d.start.clone().setY(0), n, 'trap', kind);
    setup.last = x;
    setup.msg = `${kind === 'fire' ? 'Feuerfalle' : 'Elektrofalle'} platziert`;
    SFX.magIn();
    saveRoom();
  } else if (setup.tool === 'mbox') {
    const yaw = len > 0.2 ? Math.atan2(-(d.cur.z - d.start.z), d.cur.x - d.start.x) : headYaw();
    const x = placeMysteryBoxSurface(len > 0.2 ? d.start.clone().add(d.cur).multiplyScalar(0.5) : d.start, yaw);
    setup.last = x;
    setup.msg = 'Glückskiste platziert';
    SFX.magIn();
    saveRoom();
  } else if (setup.tool === 'wall') {
    const s = addWall(d.start, d.cur, headPos);
    if (s) {
      const fixed = closeRoomGaps(0.6); // an Nachbarwände anheften
      setup.last = surfacesOf('wall').includes(s) ? s : null;
      const open = openWallEnds();
      setup.msg = `Wand hinzugefügt${fixed ? ' · angeheftet' : ''}${open ? ` · noch ${open} offene Enden` : ' · Raum geschlossen ✔'}`;
      SFX.magIn(); saveRoom();
    } else setup.msg = 'Zu kurz – nochmal';
  } else if (setup.tool === 'door') {
    const s = addOpening('door', d.start, d.cur, headPos, 0, 2.05);
    if (s) { setup.last = s; setup.msg = 'Tür hinzugefügt'; SFX.magIn(); saveRoom(); } else setup.msg = 'Zu schmal – nochmal';
  } else if (setup.tool === 'window') {
    if (len < 0.25) setup.msg = 'Zu schmal – Breite unter dem Fenster aufziehen';
    else { setup.pending = { type: 'window', a: d.start, b: d.cur, stage: 'bottom', bottom: 0.9, top: 2.0, src: d.src }; setup.msg = ''; }
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
    if (setup.tool === 'door' || setup.tool === 'window' || setup.tool === 'wallbuy' || setup.tool === 'perk' || setup.tool === 'upgrade') {
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
  } else if (!setup.align && setup.last && setup.last.type !== 'wall' && !setup.last.pos && Math.abs(stickX) > 0.4 && room.surfaces.includes(setup.last)) {
    // zuletzt platzierten Tisch/Stuhl drehen
    setup.rotT -= dt;
    if (setup.rotT <= 0) { rotateBox(setup.last, setup.last.yaw - stickX * 0.1); setup.rotT = 0.05; }
  }
  // Ausrichten:
  //  · Griff-Taste halten = Karte „anfassen“: sie folgt der Hand (verschieben) und dreht sich mit dem Handgelenk
  //  · linker Stick = in alle Richtungen schieben, rechter Stick ◀ ▶ = drehen (fein)
  if (setup.align && !d) {
    const a = setup.align;
    const grabber = renderer.xr.isPresenting ? hands.find(h => h.src && h.btn.squeeze && !h.held) : null;
    if (grabber) {
      const hy = handYaw(grabber);
      if (!a.grab || a.grab.h !== grabber) {
        a.grab = { h: grabber, start: grabber.point.clone().setY(0), yaw0: hy, angle0: a.angle, offset0: a.offset.clone() };
        pulse(grabber, 0.5, 40);
        setup.msg = 'Karte gepackt – Hand bewegen = schieben, Handgelenk drehen = drehen';
      }
      const g = a.grab;
      const dYaw = Math.atan2(Math.sin(hy - g.yaw0), Math.cos(hy - g.yaw0));
      const dP = grabber.point.clone().setY(0).sub(g.start);
      // Transformation: erst um den Griffpunkt drehen, dann um die Handbewegung verschieben
      const q = new THREE.Quaternion().setFromAxisAngle(UP, dYaw);
      const t = a.pivot.clone().add(g.offset0).sub(g.start).applyQuaternion(q).add(g.start).add(dP);
      a.angle = g.angle0 + dYaw;
      a.offset.copy(t.sub(a.pivot));
      a.dirty = true;
      if (Math.random() < dt * 8) pulse(grabber, 0.08, 10);
    } else if (a.grab) { a.grab = null; setup.msg = 'Losgelassen – passt es? Sonst nochmal packen'; refreshSetupPanel(); }
    else {
      const L = hands[0], R = hands[1];
      const mx = renderer.xr.isPresenting ? (L && L.stickX) || 0 : stickX, my = renderer.xr.isPresenting ? (L && L.stickY) || 0 : stickY;
      const rx = renderer.xr.isPresenting ? (R && R.stickX) || 0 : 0;
      if (Math.abs(rx) > 0.3) alignRotate(-rx * dt * 0.3, headPos.clone().setY(0));
      if (Math.abs(mx) > 0.25 || Math.abs(my) > 0.25) {
        const yaw = headYaw();
        const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
        a.offset.addScaledVector(right, mx * dt * 0.35).addScaledVector(fwd, -my * dt * 0.35);
        a.dirty = true;
      }
    }
    a.t -= dt;
    if (a.dirty && a.t <= 0) { a.t = a.grab ? 0.06 : 0.12; applyAlign(); if (!a.grab) refreshSetupPanel(); }
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
    if (n > 0) { closeRoomGaps(0.9); saveRoom(); }
    refreshSetupPanel();
  }
}
function enterSetup() {
  state = 'setup';
  { const p0 = starterPistol(); if (p0 && (p0.holder >= 0 || p0.phys)) holsterPistol(p0); } // Hände frei zum Einrichten
  setEditMode(true);
  clearZombies();
  clearPlanks();
  menuPanel.visible = board.visible = false;
  topPanel.visible = namePanel.visible = false; nameEntry = null;
  startButton.visible = false;
  setupPanel.visible = true;
  setupPanel.place(0.85, 0.65, -0.4);
  refreshSetupPanel();
}
function finishSetup() {
  endAlign();
  // Wände zu einem geschlossenen Raum verbinden (Lücken schließen, letzte Öffnung zumachen)
  if (surfacesOf('wall').length >= 2 && closeRoom() > 0) { floatingText('Raum geschlossen', headPos.clone().add(new THREE.Vector3(0, -0.2, 0)), '#7dffa8'); buildNav(headPos); }
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
let startedAt = 1, score = 0, wave = 0, waveBreak = 0, countdown = 0, roundClock = 0, toSpawn = 0, spawnT = 0;
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
  // Bestenliste rechts neben dem Menü
  topPanel.visible = gameMode !== 'training';
  topPanel.place(Math.min(1.1, freeDistance(headPos, inFront(1, -0.6, headPos.y).sub(headPos), 1.4) - 0.15), -0.62, -0.15);
  refreshTopPanel();
}
function refreshMenu() {
  if (menuView === 'settings') { refreshSettings(); return; }
  if (paused) { menuPanel.visible = false; pausePanel.visible = true; refreshPause(); return; } // aus den Einstellungen zurück in die Pause
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
    text(ctx, DIFF().desc, w / 2, 384, 18, diffKey === 'hardcore' ? '#ff6a5a' : '#ffd28a');
    text(ctx, top.length ? '🏆 ' + top.slice(0, 3).map((e, i) => `${i + 1}. ${e.name ? e.name + ' ' : ''}${e.score} (W${e.wave})`).join('   ') : '🏆 Noch keine Bestenliste', w / 2, 410, 19, '#9ad');
    text(ctx, '⚙ Bedienung', 30, 506, 20, '#9ad', 'left', true);
    text(ctx, 'Kopf x3 · 💰 Punkte → Wandkäufe & Glückskiste · Waffe über die Schulter = Holster', w / 2, 610, 19, '#cfd8e3');
    text(ctx, `Version ${VERSION}`, w - 24, 664, 18, '#6b7a90', 'right');
  }, [
    ...row(184, 56, Object.entries(MODES).map(([id, m]) => ({ id, label: `${m.icon} ${m.label}`, active: gameMode === id, onClick: () => { gameMode = id; refreshMenu(); } })), 792),
    ...row(250, 50, [
      ...Object.entries(DIFFS).map(([id, d]) => ({ id: 'd_' + id, label: `${d.icon} ${d.label}`, font: 23, active: diffKey === id, onClick: () => { diffKey = id; store('vrspiel-schwierigkeit', id); refreshMenu(); } })),
      { id: 'settings', label: '⚙', font: 26, onClick: () => { menuView = 'settings'; refreshMenu(); } }
    ], 792),
    ...row(308, 58, [{ id: 'start', label: '▶ START', font: 40, onClick: startPressed }], 792, 220),
    ...row(428, 58, [
      { id: 'room', label: '🧱 Raum bearbeiten', onClick: enterSetup },
      { id: 'reset', label: '🔫 Waffen zurücklegen', onClick: resetWeapons }
    ], 792),
    ...row(510, 56, [
      { id: 'settings2', label: '⚙ Einstellungen: Ton · Spiel · Bedienung · Grafik', font: 24, onClick: () => { menuView = 'settings'; refreshMenu(); } }
    ], 792, 60)
  ]);
}
// Einstellungs-Ansicht mit Reitern
let menuView = 'main', settingsTab = 'ton';
function refreshSettings() {
  const tab = SETTINGS_TABS[settingsTab];
  const btns = [...row(80, 52, Object.entries(SETTINGS_TABS).map(([id, t]) => ({ id: 't_' + id, label: t.label, font: 21, active: settingsTab === id, onClick: () => { settingsTab = id; refreshMenu(); } })), 792, 20, 8)];
  tab.items.forEach((it, i) => {
    const y = 148 + i * 57;
    const idx = Math.max(0, it.opts.findIndex(o => o[0] === settings[it.key]));
    const step = (d) => () => { const n = it.opts.length; setSetting(it.key, it.opts[(idx + d + n) % n][0]); if (it.key === 'announcer' || it.key === 'announcerVoice') speak('Welle eins'); else SFX.ui(); };
    btns.push({ id: 'l_' + it.key, label: '◀', font: 28, x: 470, y, w: 64, h: 50, onClick: step(-1) });
    btns.push({ id: 'r_' + it.key, label: '▶', font: 28, x: 704, y, w: 64, h: 50, onClick: step(1) });
  });
  btns.push(...row(610, 56, [
    { id: 'reset', label: '↺ Standard', font: 26, onClick: () => { for (const it of tab.items) settings[it.key] = SETTINGS_DEFAULT[it.key]; setSetting(tab.items[0].key, settings[tab.items[0].key]); } },
    { id: 'back', label: '◀ Zurück', font: 30, onClick: () => { menuView = 'main'; refreshMenu(); } }
  ], 792));
  menuPanel.set((ctx, w) => {
    text(ctx, '⚙ Einstellungen', w / 2, 40, 38, '#fff', 'center', true);
    tab.items.forEach((it, i) => {
      const y = 148 + i * 57;
      const o = it.opts.find(q => q[0] === settings[it.key]) || it.opts[0];
      text(ctx, it.label, 40, y + 26, 24, '#e6edf5', 'left', true);
      roundRect(ctx, 542, y + 3, 154, 44, 12);
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill();
      text(ctx, o[1], 619, y + 27, 24, '#ffd36a', 'center', true);
      if (it.opts.length === 11 && typeof o[0] === 'number') { ctx.fillStyle = '#ffd36a'; ctx.fillRect(546, y + 43, 146 * o[0] / 10, 4); }
    });
    text(ctx, `Version ${VERSION}`, w - 24, 664, 18, '#6b7a90', 'right');
  }, btns);
}
function startPressed() {
  if (state === 'menu' || state === 'over') startCountdown();
}
// Karte komplett aufräumen: nichts bleibt von der letzten Runde liegen
function resetMap() {
  for (const m of [...looseMags]) removeLooseMag(m);
  for (const k of knives.splice(0)) if (k.obj.parent) k.obj.parent.remove(k.obj);
  knifeSlot.available = true; knifeSlot.obj.visible = true;
  for (const h of hands) { if (h.held && h.held.type !== 'weapon') { h.ray.remove(h.held.obj); h.held = null; } h.grab = null; h.pull = null; }
  clearDebris();
  for (const a of arrows.splice(0)) if (a.obj.parent) a.obj.parent.remove(a.obj);
  for (const f of flameParts.splice(0)) scene.remove(f.obj);
  burning.clear();
  for (const b of bolts.splice(0)) { scene.remove(b.obj); b.obj.geometry.dispose(); }
  for (const p0 of plasmas.splice(0)) { p0.obj.children[0].material.dispose(); scene.remove(p0.obj); }
  for (const t of traps) { t.state = 'ready'; t.t = 0; }
  // alle Waffen außer der Startpistole verschwinden, die Pistole kommt ins Holster
  if (holster) { holster.holstered = false; disposeWeapon(holster); holster = null; }
  for (const w of [...arsenal]) if (!w.starter) disposeWeapon(w);
  const p0 = starterPistol();
  if (p0 && (p0.phys || (p0.holder < 0 && p0 !== deskW && !p0.inBelt))) holsterPistol(p0);
}
function startCountdown() {
  bossSpawnT = 0;
  state = 'countdown';
  resetMap();
  countdown = 3.999;
  lastResult = null;
  menuPanel.visible = false;
  topPanel.visible = namePanel.visible = false; nameEntry = null;
  startButton.visible = false;
  clearZombies();
  clearDecals();
  for (const m of medkits.splice(0)) scene.remove(m.obj);
  for (const g of grenades.splice(0)) { removeDynamic(g.phys); scene.remove(g.obj); }
  refillGrenades();
  for (const pu of powerups.splice(0)) { scene.remove(pu.obj); pu.obj.material.dispose(); }
  active.double = active.slowmo = active.instakill = 0;
  setupPlanks();
  buildNav(headPos);
  playerHp = 100;
  lowHpWarned = false;
  pendingDeath = false;
  // jede Runde: nur die Startpistole, Punkte neu, neue Wandkauf-Waffen, Glückskiste bereit
  if (holster) { disposeWeapon(holster); holster = null; }
  for (const w of [...arsenal]) if (!w.starter) disposeWeapon(w);
  for (const w of arsenal) refillAmmo(w);
  resetWeapons();
  setupWallbuys();
  setupMysteryBox();
  setupMachines();
  setupTraps();
  perks.clear();
  clearMonkeys();
  monkeyCount = 1;
  syncMonkeySlot();
  // Rundenanzeige: schwebt oben im Blickfeld, folgt dem Kopf mit Verzögerung, liegt immer vor allem (nie in einer Wand)
  board.mesh.scale.setScalar(0.42);
  board.mesh.material.depthTest = false;
  board.mesh.renderOrder = 60;
  boardYaw = headYaw();
  placeBoardHud(true);
  board.visible = true;
  boardDirty = true;
}
function beginRound() {
  state = 'playing';
  // Startwelle (Einstellungen → Spiel): später einsteigen, z. B. zum Testen; dazu passende Startpunkte
  const sw = gameMode === 'training' ? 1 : Math.max(1, settings.startWave || 1);
  score = 0; roundClock = 0; wave = sw - 1;
  startedAt = sw;
  points = free() ? 0 : settings.startPoints + DIFF().start + 120 * (sw - 1) * (sw - 1);
  stats.shots = stats.hits = stats.kills = stats.headshots = 0;
  stats.bestStreak = 0;
  streak = 0;
  streakMsg = null;
  nextWave();
  musicStart();
  startRoundFx(sw - 1, sw, true);
}
// Boden aufräumen (alle 3 Wellen): Blut- und Brandflecken, leere Magazine, Hülsen, Trümmer.
// Waffen, Messer, Power-ups und Medipacks bleiben liegen.
function cleanupFloor() {
  clearDecals();
  clearDebris();
  for (const m of [...looseMags]) { puff(m.position.clone(), 0x999999, 0.08, 0.5, 0.1, 0.3); removeLooseMag(m); }
}
function nextWave() {
  wave++;
  if (wave > 1 && (wave - 1) % 3 === 0) cleanupFloor();
  plankPts = 0;
  toSpawn = Math.max(2, Math.round((gameMode === 'training' ? 2 + wave : Math.min(70, 4 + wave * 2.4)) * DIFFS[diffKey].count * settings.amount));
  refillGrenades();
  bruteWarned = false;
  // jede 5. Welle: Boss-Runde – nur der Boss, keine Zombies. In Welle 8, 13, 18 … kommt die Kriegerin (ebenfalls allein)
  bossWave = gameMode !== 'training' && wave % 5 === 0 && bossReady();
  warriorWave = gameMode !== 'training' && wave > 5 && wave % 5 === 3 && warriorReady();
  bossPending = gameMode !== 'training' && (bossWave || warriorWave ? false : wave % 5 === 0 || (wave > 5 && wave % 5 === 3)); // Modell fehlt: Riese als Ersatz
  if (bossWave || warriorWave) { toSpawn = 0; bossSpawnT = 2.5; }
  spawnT = 1.5;
  waveBreak = 0;
  setupPlanks(); // Bretter werden vor jeder Welle wieder angenagelt
  buildNav(headPos);
  boardDirty = true;
}
function endRound(died = false) {
  state = 'over';
  bossSpawnT = 0;
  clearMonkeys();
  musicStop();
  killcamT = 0;
  clearZombies();
  hurtFlash = 0;
  const acc = stats.shots ? Math.round(stats.hits / stats.shots * 100) : 0;
  // Bestenliste: nur Runden ab Welle 1 (späterer Start zählt nicht); bei einem Platz in den Top 10 Namen eingeben
  const entry = { score, wave, kills: stats.kills, diff: diffKey, date: Date.now() };
  const qualifies = startedAt === 1 && gameMode !== 'training' && qualifiesTop(gameMode, score);
  const place = qualifies ? topList(gameMode).filter(x => x.score >= score).length : -1;
  lastResult = { score, kills: stats.kills, headshots: stats.headshots, acc, wave, place, died, streak: stats.bestStreak || 0 };
  speak(died ? 'Du wurdest gefressen' : place === 0 ? 'Neuer Rekord!' : qualifies ? 'Ab in die Bestenliste!' : 'Runde beendet');
  if (died) SFX.jingle([392, 370, 349, 330, 196], 0.4); else SFX.jingle([784, 659, 523, 392], 0.35);
  if (qualifies) askName(entry); else enterMenu();
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
  playerHp -= dmg * DIFF().dmg * (perks.has('weste') ? 0.7 : 1);
  hurtFlash = 1;
  if (playerHp < 30 && playerHp > 0 && !lowHpWarned) { lowHpWarned = true; speak('Du bist schwer verletzt'); }
  if (playerHp >= 45) lowHpWarned = false;
  regenT = DIFF().regenDelay;
  SFX_PLAYER.hurt();
  for (const h of hands) pulse(h, 1, 150);
  boardDirty = true;
  if (playerHp <= 0 && perks.has('leben')) { // Zweites Leben: aufstehen, Druckwelle wirft Zombies um
    perks.delete('leben');
    playerHp = 60;
    later(0, () => {
      shockwave(headPos.clone().setY(0.1));
      SFX.explosion();
      nukeFlash = 0.7;
      for (const r of explosionDamage(headPos.clone().setY(1), 2.6, 400)) handleZombieHit(r, r.zombie.skull.getWorldPosition(new THREE.Vector3()), '✚ ');
    });
    speak('Zweites Leben');
    return;
  }
  if (playerHp <= 0) { playerHp = 0; pendingDeath = true; } // Rundenende erst im nächsten Bild (nicht mitten im Zombie-Update)
}
function updateGame(dt) {
  hurtFlash = Math.max(0, hurtFlash - dt * 1.5);
  const low = state === 'playing' && playerHp < 35 ? (0.35 - playerHp / 100) * (0.6 + 0.4 * Math.sin(elapsed * 6)) : 0;
  acidFlash = Math.max(0, acidFlash - dt * 0.8);
  hurtMesh.material.color.setRGB(0.67 * (1 - acidFlash) + 0.3 * acidFlash, acidFlash * 0.75, 0);
  hurtMesh.material.opacity = Math.min(0.6, hurtFlash * 0.45 + low + acidFlash * 0.35);
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
  if (regenT <= 0 && playerHp < maxHp()) { playerHp = Math.min(maxHp(), playerHp + dt * DIFF().regenRate); if (Math.random() < dt * 2) boardDirty = true; }
  if (playerHp < 35) { heartT -= dt; if (heartT <= 0) { heartT = 0.9; SFX_PLAYER.heartbeat(); if (Math.random() < 0.35) SFX_PLAYER.breath(); } }
  if (streakMsg) { streakMsg.t -= dt; if (streakMsg.t <= 0) streakMsg = null; boardDirty = true; }
  if (waveBreak > 0) {
    if (Math.ceil(waveBreak) !== lastBreakSec) { lastBreakSec = Math.ceil(waveBreak); boardDirty = true; }
    waveBreak -= dt;
    if (waveBreak <= 0) nextWave();
    return;
  }
  // Boss-Runde: kurz warten, dann erscheint der Boss (allein)
  if (bossSpawnT > 0) {
    bossSpawnT -= dt;
    if (bossSpawnT <= 0) {
      if (warriorWave) {
        const wl = Math.max(1, Math.round((wave - 3) / 5));
        if (spawnBoss(wl, headPos, DIFFS[diffKey].hp, 'warrior')) speak(wl === 1 ? 'Die Kriegerin kommt – mit ihrem Kriegshammer! Weich ihren Schlägen aus!' : `Die Kriegerin ist zurück – Stufe ${wl}!`);
        else bossPending = true, toSpawn = 1;
        boardDirty = true;
        return;
      }
      const lvl = Math.floor(wave / 5);
      if (spawnBoss(lvl, headPos, DIFFS[diffKey].hp)) speak((lvl === 1 ? 'Der Boss ist da – mit einer Pistole!' : `Der Boss ist zurück – Stufe ${lvl}, ${lvl <= 8 ? 'jetzt mit ' : ''}${bossGunName(lvl)}!`) + (lvl === GRENADE_LEVEL ? ' Und er hat Granaten!' : ''));
      else bossPending = true, toSpawn = 1; // Modell fehlt: Riese als Ersatz
      boardDirty = true;
    }
    return;
  }
  // Zombies nach und nach erscheinen lassen
  if (toSpawn > 0) {
    spawnT -= dt;
    if (spawnT <= 0 && aliveCount() < Math.min(MAX_ALIVE, Math.round((3 + wave) * Math.min(1.5, settings.amount)))) {
      const D = DIFFS[diffKey];
      const zn = spawnZombie(gameMode === 'training' ? 0 : wave, headPos, bossPending ? 'giant' : undefined, { hp: D.hp, speed: gameMode === 'training' ? 0.8 : D.speed, atk: gameMode === 'training' ? 1 : D.atk });
      bossPending = false;
      if (zn.type === 'brute' && !bruteWarned) { bruteWarned = true; speak('Achtung, ein Brocken!'); }
      if ((zn.type === 'bloater' || zn.type === 'spitter') && !warnedTypes.has(zn.type)) { warnedTypes.add(zn.type); speak(zn.type === 'bloater' ? 'Achtung, ein Platzer! Nicht zu nah ran!' : 'Achtung, Spucker! Ausweichen!'); }
      toSpawn--;
      spawnT = Math.max(0.8, 3.5 - wave * 0.3) * THREE.MathUtils.randFloat(0.7, 1.3);
      boardDirty = true;
    }
  } else if (aliveCount() === 0) {
    const bonus = 30 * wave; // Wellen-Bonus (Punkte-Balance v35: vorher 50 pro Welle)
    award(bonus);
    SFX.waveEnd();
    speak(`Welle ${wave} überstanden`);
    waveBreak = 9;
    startRoundFx(wave, wave + 1, false, bonus);
    boardDirty = true;
  }
}
// ---- Punkte-Balance -------------------------------------------------------------------
// Kill: 60 (Kopfschuss 100). Treffer: je 10, aber höchstens 60 pro Zombie (Riese 200, Boss 400).
// Bretter annageln: je 10, höchstens 300 pro Welle.
const killPts = (res) => (res.headshot ? 100 : 60);
const hitCap = (z) => (z.type === 'boss' ? 400 : z.type === 'giant' ? 200 : 60);
const PLANK_CAP = 300;
let lastMarkerT = -1;
let plankPts = 0;
function awardPlank() { if (!inRound() || plankPts >= PLANK_CAP) return 0; plankPts += 10; award(10); return 10; }
function handleZombieHit(res, point, prefix = '') {
  if (!res) return;
  if (res.kill) {
    floorDecal(res.pos, 'blood', THREE.MathUtils.randFloat(0.5, 0.9));
    if (inRound() && res.type === 'boss') { // Boss besiegt: großer Bonus + volle Munition + Medipack
      const lvl = res.zombie.level || 1;
      award(700 * lvl);
      spawnPowerup(res.pos, 'ammo');
      spawnMedkit(res.pos.clone().add(new THREE.Vector3(0.6, 0, 0)));
      const kw = res.zombie.kind === 'warrior';
      speak(kw ? 'Die Kriegerin ist besiegt!' : 'Boss besiegt!');
      streakMsg = { text: kw ? `⚔ KRIEGERIN BESIEGT +${700 * lvl}` : `👑 BOSS BESIEGT +${700 * lvl}`, t: 3 };
    } else if (inRound() && res.type === 'giant') spawnPowerup(res.pos); // der Riese lässt immer ein Power-up fallen
    else if (inRound() && Math.random() < (playerHp < 50 ? 0.12 : 0.05) * DIFF().drops) spawnMedkit(res.pos);
    else if (inRound() && !res.nuke && powerups.length < 2 && Math.random() < 0.045 * DIFF().drops) spawnPowerup(res.pos);
    else if (inRound() && lowAmmo() && !powerups.some(p0 => p0.type === 'ammo') && Math.random() < 0.09) spawnPowerup(res.pos, 'ammo'); // wenig Munition: öfter „Volle Munition“
  }
  if (settings.hitmarker && (!res.dot || res.kill) && (res.kill || elapsed - lastMarkerT > 0.05)) { lastMarkerT = elapsed; SFX.marker(res.kill, res.headshot); } // (gedrosselt bei Dauerfeuer)
  if (inRound()) {
    if (!res.explosion && !res.dot) stats.hits++;
    const mult = active.double > 0 ? 2 : 1;
    // Treffer-Punkte nur bis zu einer Obergrenze pro Zombie: Schrot (viele Kugeln), Dauerfeuer und zähe Zombies
    // in späten Wellen bringen sonst viel zu schnell viel zu viele Punkte
    const z = res.zombie;
    if (!res.dot && z && (z.hitPts || 0) < hitCap(z)) { z.hitPts = (z.hitPts || 0) + 10; award(10 * mult); }
    if (res.kill) {
      stats.kills++;
      // Killserie: mehrere Kills kurz hintereinander
      streak = elapsed - lastKillT < 1.6 ? streak + 1 : 1;
      lastKillT = elapsed;
      stats.bestStreak = Math.max(stats.bestStreak || 0, streak);
      if (streak >= 2) {
        const names = { 2: 'Doppelkill!', 3: 'Dreifachkill!', 4: 'Vierfachkill!' };
        const name = names[streak] || 'Massaker!';
        const bonus = Math.min(100, 25 * (streak - 1)) * mult;
        award(bonus);
        streakMsg = { text: `${name} +${bonus}`, t: 2.2 };
        if (streak <= 5 || streak % 3 === 0) speak(name.replace('!', ''));
      }
      award(killPts(res) * mult);
      if (perks.has('vampir')) playerHp = Math.min(maxHp(), playerHp + 4); // Blutdurst
      if (res.headshot) stats.headshots++;
      // letzter Zombie der Welle: kurze Zeitlupe
      if (settings.killcam && toSpawn === 0 && aliveCount() === 0 && wave > 0) { killcamT = 1.6; SFX.slowmo(); }
    }
  }
  if (res.kill) floatingText(prefix + (res.headshot ? 'KOPFSCHUSS! +' : 'Erledigt +') + killPts(res) * (active.double > 0 ? 2 : 1), point, res.headshot ? '#ffd21f' : '#ffffff');
  boardDirty = true;
}
function refreshBoard() {
  const training = gameMode === 'training' && state === 'playing';
  board.set((ctx, w) => {
    if (state === 'countdown') {
      text(ctx, `${MODES[gameMode].icon} ${MODES[gameMode].label} · ${DIFF().icon} ${DIFF().label}`, w / 2, 70, 40, diffKey === 'hardcore' ? '#ff6a5a' : '#9ad', 'center', true);
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
    ctx.fillRect(bx, by, bw * Math.min(1, playerHp / maxHp()), 30);
    text(ctx, `❤ ${Math.ceil(playerHp)}${perks.size ? '   ' + [...perks].map(k => PERKS[k].icon).join(' ') : ''}`, w / 2, by + 16, 24, '#fff', 'center', true);
    text(ctx, `💰 ${free() ? '∞' : points} · ${score} Punkte · Erledigt ${stats.kills} · 💣 ${grenadeSlots.filter(g => g.available).length} · 🐒 ${monkeyCount}${holster ? ' · 🎒 ' + holster.def.name : ''}`, w / 2, 176, 26, '#cfd8e3', 'center', true);
    const act = [active.double > 0 ? `×2 Punkte ${Math.ceil(active.double)}s` : '', active.slowmo > 0 ? `⏳ Zeitlupe ${Math.ceil(active.slowmo)}s` : '', active.instakill > 0 ? `☠ Sofort-Tod ${Math.ceil(active.instakill)}s` : ''].filter(Boolean).join(' · ');
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
  const modeName = { safe: 'GESICHERT', semi: d.modes.length > 2 ? 'EINZEL' : 'FEUER', auto: 'DAUERFEUER', burst: 'SALVE' }[mode(w)];
  const loaded = w.chamber === 'live' ? 1 : 0;
  const ammo = (d.feed === 'mag' ? `${w.magInserted ? w.magRounds : '–'}+${loaded}` : `${w.tube}+${loaded}`) + ` | ${w.reserve ?? 0}`;
  const line2 = `${inRound() ? `❤${Math.ceil(playerHp)}${[...perks].map(k => PERKS[k].icon).join('')} 💰${free() ? '∞' : points} · ` : ''}${ammo} · ${modeName}${d.sight === 'scope' ? ` · ${w.zoom.toFixed(0)}x` : ''}`;
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
  if (!wh || !off.src || !settings.wristHud) { hud.mesh.visible = false; hudAlpha = 0; return; }
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
      redDot.updateMatrixWorld(true); // nach dem Szenen-Update verschoben
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
  releaseFromMachine(w);
  if (deskW) { const old = deskW; deskW = null; camera.remove(old.root); scene.add(old.root); if (old.starter) holsterPistol(old); else makeLoose(old); }
  if (w.inBelt) { w.inBelt = false; w.root.visible = true; if (pistolSlot) { pistolSlot.available = false; pistolSlot.obj.visible = false; } }
  for (const h of hands) if (heldWeapon(h) === w) h.held = null;
  if (w.phys) { removeDynamic(w.phys); w.phys = null; }
  w.holder = -1;
  camera.add(w.root);
  w.root.quaternion.identity();
  deskW = w;
  setBeltWeapon(w.id, w.def, w);
  SFX.grab();
}
function desktopReload() { if (deskW) autoReload(deskW); }
let noAmmoT = 0;
function floatingNoAmmo(w) { if (elapsed - noAmmoT < 2) return; noAmmoT = elapsed; floatingText('Keine Munition mehr!', w.root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.25, 0)), '#ff7070'); }
// automatisches Nachladen (PC und Einstellung "Nachladen: einfach")
function autoReload(w) {
  if (!w || w.desktopBusy) return;
  if (w.def.feed === 'mag' ? (w.magInserted && w.magRounds >= w.def.capacity) : w.tube >= w.def.capacity) { if (w.chamber !== 'live') cycleAction(w); return; }
  const avail = (w.reserve || 0) + (w.def.feed === 'mag' && w.magInserted ? w.magRounds : 0);
  if (avail <= 0) { SFX.dry(); floatingNoAmmo(w); return; }
  if (w.def.feed !== 'mag') electroShock(); // (Magazin-Waffen schocken über ejectMag)
  w.desktopBusy = true;
  let t = 0;
  if (w.def.feed === 'mag') {
    if (w.magInserted) { ejectMag(w); t += 0.5 * reloadK(); }
    later(t, () => { const n = Math.min(w.def.capacity, w.reserve || 0); w.reserve -= n; if (n > 0) insertMag(w, n); });
    t += 0.35 * reloadK();
  } else {
    const need = Math.min(w.def.capacity - w.tube, w.reserve || 0);
    for (let i = 0; i < need; i++) later(t + i * 0.3 * reloadK(), () => { if (w.tube < w.def.capacity && w.reserve > 0) { w.tube++; w.reserve--; } SFX.shellIn(); boardDirty = true; });
    t += (need * 0.3 + 0.1) * reloadK();
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
  if (paused) return; // in der Pause nur Menü-Knöpfe
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
  if (nameEntry) { // Name für die Bestenliste tippen
    if (e.key === 'Enter') saveName();
    else if (e.key === 'Backspace') typeName('\b');
    else if (e.key.length === 1 && /[\p{L}\d \-]/u.test(e.key)) typeName(e.key.toUpperCase());
    e.preventDefault();
    return;
  }
  if (paused && e.code !== 'Escape') return; // in der Pause keine Spiel-Tasten
  if (renderer.xr.isPresenting) return;
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= 9 && arsenal[n - 1]) equipDesk(arsenal[n - 1]);
  if (e.key === 'b' || e.key === 'B') { // nächsten Wandkauf benutzen
    let best = null, bd = Infinity;
    for (const wb of wallbuys) { const d = wb.group.position.distanceTo(camera.position); if (d < bd) { bd = d; best = wb; } }
    if (best) tryBuy(best, null);
  }
  if (e.key === 'k' || e.key === 'K') useBox(null);
  if (e.key === 'u' || e.key === 'U') { if (upg.m) useMachine(upg.m, null); } // Aufrüster
  if (e.key === 'j' || e.key === 'J') { const m = machines.find(q => q.type === 'perk' && !perks.has(q.kind)); if (m) useMachine(m, null); } // nächstes Getränk
  if (e.key === 'f' || e.key === 'F') desktopThrowKnife();
  if (e.key === 'p' || e.key === 'P') {
    let best = null, bd = Infinity;
    for (const o of openings()) { if (missingPlanks(o) <= 0) continue; const d = o.mid.distanceTo(camera.position); if (d < bd) { bd = d; best = o; } }
    if (best) { addPlank(best); SFX.thunk(); awardPlank(); }
  }
  if (e.key === 't' || e.key === 'T') { let best = null, bd = Infinity; for (const t of traps) { const d = t.center.distanceTo(camera.position); if (d < bd) { bd = d; best = t; } } if (best) pullTrap(best, null); }
  if ((e.key === 'm' || e.key === 'M') && monkeyCount > 0) {
    monkeyCount--; syncMonkeySlot();
    raycaster.setFromCamera(mouseNdc, camera);
    const m = makeMonkey();
    m.position.copy(raycaster.ray.origin).addScaledVector(raycaster.ray.direction, 0.4);
    scene.add(m);
    launchMonkey(m, raycaster.ray.direction.clone().multiplyScalar(6).add(new THREE.Vector3(0, 2, 0)));
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
  if (e.code === 'Escape') setPaused(!paused);
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
  if (leftDown) w.spinning = true;
  if (leftDown && mode(w) === 'auto' && w.cooldown <= 0 && w.chamber === 'live') desktopShoot();
  continueBurst(w, () => { const r = tryFire(w, aiming ? null : (raycaster.setFromCamera(mouseNdc, camera), raycaster.ray.clone())); return r; });
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
  addWallbuy(v(-2.5, 1, -5), v(0, 0, 1), 'perk', 'eisen');
  addWallbuy(v(-1.6, 1, -5), v(0, 0, 1), 'perk', 'flink');
  addWallbuy(v(1.4, 1, -5), v(0, 0, 1), 'perk', 'turbo');
  addWallbuy(v(-3.2, 1, -1.7), v(1, 0, 0), 'perk', 'leben');
  addWallbuy(v(-3.2, 1, -4.4), v(1, 0, 0), 'upgrade');
}

// =============================================================================
// VR-Sitzung
// =============================================================================
renderer.xr.addEventListener('sessionstart', () => {
  facesButtonVisible(false);
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
  perf.level = 0; perf.lowHz = false; perf.ema = 0;
  applyPerfLevel();
  applyFrameRate(); // 90 Hz statt 72 Hz (wenn die Brille es kann)
  setTimeout(() => { enterSetup(); resetWeapons(false, false); }, 400);
});
renderer.xr.addEventListener('sessionend', () => {
  facesButtonVisible(true);
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
    try { renderer.setRenderTarget(null); scene.updateMatrixWorld(); renderer.render(scene, camera); } catch { /* nächstes Bild */ }
  }
});
function frame() {
  const _t0 = performance.now();
  try { frameInner(); } finally { const d = performance.now() - _t0; profStat.sum += d; profStat.n++; profStat.max = Math.max(profStat.max, d); }
}
const profStat = { sum: 0, n: 0, max: 0 };
// Boss- und Riesen-Modell einmal unsichtbar mitzeichnen, sobald geladen (Shader/Texturen vorbereiten → kein Ruckler beim Erscheinen)
let warmed = false;
function warmupModels() {
  if (warmed || !bossReady() || !giantModelReady() || !warriorSettled()) return;
  warmed = true;
  const objs = [bossWarmup(), giantWarmup()];
  const camoWarm = new THREE.Group();
  for (const m of camoMats) { const b = new THREE.Mesh(cachedGeo('camowarm', () => new THREE.BoxGeometry(0.05, 0.05, 0.05)), m); b.frustumCulled = false; camoWarm.add(b); }
  objs.push(camoWarm);
  for (const o of objs) { o.position.set(headPos.x, -60, headPos.z); o.traverse(m => { if (m.isMesh) m.castShadow = true; }); scene.add(o); }
  renderer.shadowMap.needsUpdate = true;
  later(0.3, () => { renderer.shadowMap.needsUpdate = true; });
  // Effekte beim Erscheinen (Rauch, Druckwelle, Partikel) ebenfalls einmal unsichtbar auslösen
  const at = new THREE.Vector3(headPos.x, -60, headPos.z);
  burst(at, 0x3a3a3a, 4); puff(at, 0x555555, 0.6, 0.3, 0.6, 0.7); shockwave(at);
  later(0.6, () => { for (const o of objs) o.visible = false; });
}
// ---- Pause-Menü: jederzeit in der Runde (VR: Stick drücken oder Y/B mit freier Hand · PC: Esc) ----------
const pausePanel = new UIPanel(0.9, 0.62, 700);
pausePanel.border = '#7dc8ff';
pausePanel.visible = false;
function refreshPause() {
  pausePanel.set((ctx, w) => {
    text(ctx, '⏸ Pause', w / 2, 52, 48, '#fff', 'center', true);
    text(ctx, `Welle ${wave} · 💰 ${free() ? '∞' : points} · ❤ ${Math.ceil(playerHp)} · ${DIFF().icon} ${DIFF().label}`, w / 2, 104, 24, '#cfd8e3');
    text(ctx, 'Pause/weiter: Stick drücken oder Y/B (PC: Esc)', w / 2, 398, 18, '#8796ad');
  }, [
    ...row(140, 70, [{ id: 'resume', label: '▶ Weiter', font: 36, onClick: () => setPaused(false) }], 630, 60),
    ...row(226, 62, [{ id: 'psettings', label: '⚙ Einstellungen', font: 28, onClick: () => { pausePanel.visible = false; menuView = 'settings'; menuPanel.visible = true; menuPanel.place(0.95, 0, -0.1); refreshMenu(); } }], 630, 60),
    ...row(304, 62, [{ id: 'quit', label: '🏠 Runde beenden → Hauptmenü', font: 26, onClick: () => { setPaused(false); endRound(false); } }], 630, 60)
  ]);
}
function setPaused(on) {
  if (on === paused) return;
  if (on && state !== 'playing') return;
  paused = on;
  setAudioPaused(on);
  if (on) {
    refreshPause();
    pausePanel.visible = true;
    pausePanel.place(0.9, 0, -0.1);
    for (const h of hands) pulse(h, 0.4, 40);
  } else {
    pausePanel.visible = false;
    if (menuView === 'settings') { menuView = 'main'; menuPanel.visible = false; }
    clock.getDelta(); // die Pausenzeit nicht als einen riesigen Zeitschritt nachholen
  }
}
const pauseButton = (h) => down(h, 'stick') || (down(h, 'b') && !heldWeapon(h) && !(h.held && h.held.type !== 'weapon'));
// Bild während der Pause: nur Kopf, Zeigestrahl und Menü – das Spiel steht still
function pauseFrame(xr) {
  clock.getDelta();
  if (!xr) camera.rotation.set(lookPitch, lookYaw, 0, 'YXZ');
  camera.updateMatrixWorld(true);
  getViewCamera().getWorldPosition(headPos);
  if (xr) {
    readInputs();
    for (const h of hands) {
      h.ray.updateMatrixWorld(true);
      if (!h.src) { h.pointer.visible = false; continue; }
      const pt = pointerTarget(h);
      const hover = pt && pt.kind === 'ui' ? pt.panel.buttonAt(pt.uv) : null;
      if (h.uiHover !== hover) { if (h.uiHover) h.uiHover.panel.setHover(null); h.uiHover = hover; if (hover) { hover.panel.setHover(hover); pulse(h, 0.1, 10); } }
      h.pointer.visible = true;
      h.pointer.scale.z = pt && pt.kind === 'ui' ? pt.dist : 1.5;
      if (down(h, 'trigger') && hover) { hover.onClick(); pulse(h, 0.3, 20); if (!paused) break; }
      else if (pauseButton(h) && pausePanel.visible) { setPaused(false); break; }
    }
  }
  scene.updateMatrixWorld();
  renderer.render(scene, camera);
}
function frameInner() {
  if (paused) { pauseFrame(renderer.xr.isPresenting); return; }
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.05);
  autoPerf(rawDt);
  elapsed += dt;
  const xr = renderer.xr.isPresenting;
  if (!xr) camera.rotation.set(lookPitch, lookYaw, 0, 'YXZ');
  camera.updateMatrixWorld(true);
  getViewCamera().getWorldPosition(headPos);
  for (const h of hands) h.ray.updateMatrixWorld(true);
  if (shadowsOn) { // Schattenkamera folgt dem Spieler
    sun.target.position.set(headPos.x, 0, headPos.z);
    shadowFloor.position.x = headPos.x; shadowFloor.position.z = headPos.z;
    sun.position.set(headPos.x + 1.6, 5, headPos.z + 2.2);
    sun.target.updateMatrixWorld();
    shadowFrame = (shadowFrame + 1) % Q().shadowEvery;
    if (shadowFrame === 0) renderer.shadowMap.needsUpdate = true;
  }
  for (let i = timers.length - 1; i >= 0; i--) {
    timers[i].t -= dt;
    if (timers[i].t <= 0) { const f = timers[i].fn; timers.splice(i, 1); f(); }
  }
  warmupModels();
  updateBelt(dt);
  if (xr) {
    readInputs();
    if (state === 'playing' && hands.some(h => h.src && pauseButton(h))) { setPaused(true); pauseFrame(true); return; }
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
  // Zeitlupe nach dem letzten Kill: Leichen und Trümmer fallen langsam
  killcamT = Math.max(0, killcamT - dt);
  const worldDt = killcamT > 0 ? dt * 0.25 : dt;
  stepPhysics(worldDt);
  updateKnives(dt);
  updateGrenades(dt);
  updatePlasmas(dt);
  updateMysteryBox(dt);
  updateArrows(dt);
  updateMachines(dt);
  updateDust(dt);
  updateGuides();
  if (board.visible && (state === 'playing' || state === 'countdown')) placeBoardHud(false);
  updateBolts(dt);
  updateMonkeys(dt);
  updateTraps(dt);
  updateFlames(worldDt);
  updateWallbuys();
  updateWeaponExpiry();
  updatePlankGhost();
  updateMedkits(dt);
  updateZombies(active.slowmo > 0 ? dt * 0.35 : worldDt, headPos, { harmless: gameMode === 'training' });
  updateSoundscape(dt);
  updateRoundFx(dt);
  updatePowerups(dt);
  updateAtmosphere(dt);
  if (dirIndicator.visible) { dirIndicator.material.opacity -= dt * 0.9; if (dirIndicator.material.opacity <= 0) dirIndicator.visible = false; }
  if ((active.double > 0 || active.slowmo > 0 || active.instakill > 0) && Math.random() < dt * 3) boardDirty = true;
  nukeFlash = Math.max(0, nukeFlash - dt * 1.2);
  nukeMesh.material.opacity = nukeFlash * 0.85;
  nukeMesh.visible = nukeFlash > 0.01;
  getViewCamera().getWorldDirection(tmpV);
  setListener(headPos, tmpV, UP.clone().applyQuaternion(getViewCamera().getWorldQuaternion(tmpQ)));
  updateGame(dt);
  if (startButton.visible) startButton.scale.setScalar(1 + Math.sin(elapsed * 4) * 0.05);
  updateEffects(worldDt);
  updateDebris(worldDt);
  updateHud(dt);
  boardT -= dt;
  if (boardDirty && board.visible && boardT <= 0) { refreshBoard(); boardDirty = false; boardT = 0.2; }
  scene.updateMatrixWorld();
  redDot.visible = false;
  scopeRendered = false;
  for (const h of hands) updateSights(heldWeapon(h));
  updateSights(deskW);
  renderer.render(scene, camera);
}

// Für automatisierte Tests
applySettings();
window.__game = {
  get boss() { return currentBoss(); }, get warriorWave() { return warriorWave; }, takeWeapon, pointerTarget, perks, get paused() { return paused; }, get nameEntry() { return nameEntry; }, namePanel, topPanel, set score(v) { score = v; }, setPaused, tryBuy, ammoPrice,
  renderer, get errors() { return errorCount; }, get plankPile() { return plankPilePos; }, hit: (r, p) => handleZombieHit(r, p), debugWave: (n) => { clearZombies(); wave = n - 1; waveBreak = 0; toSpawn = 0; nextWave(); }, get wave() { return wave; }, forceLightning: () => { lightningT = 0; }, spawnPowerup, powerups, active, get grenadeList() { return grenades.map(g => +g.fuse.toFixed(2)); }, medkits, spawnMedkit, get diff() { return diffKey; }, set diff(v) { diffKey = v; refreshMenu(); }, get state() { return state; }, get score() { return score; }, arsenal, hands, room, beltSlots, knives, looseMags, zombies, uiPanels, get playerHp() { return playerHp; }, set playerHp(v) { playerHp = v; },
  menuPanel, setupPanel, board, startButton, setup, get floorOffset() { return floorOffset; }, get bench() { return bench; }, startPressed, enterSetup, finishSetup, equipDesk, desktopReload,
  get deskW() { return deskW; }, get mode() { return gameMode; }, set mode(m) { gameMode = m; }, endRound,
  guides, profile: async (ms) => { profStat.sum = profStat.n = profStat.max = 0; await new Promise(r => setTimeout(r, ms)); return { jsMsAvg: +(profStat.sum / Math.max(1, profStat.n)).toFixed(2), jsMsMax: +profStat.max.toFixed(1), frames: profStat.n }; },
  setFaces, get monkeyCount() { return monkeyCount; }, lure, traps, pullTrap, roundFx, upgradeWeapon, set wave(v) { wave = v; }, set toSpawn(v) { toSpawn = v; }, spawnWeapon, resetWeapons, settings, tryFire, arrows, machines, upg, perks, useMachine, get points() { return points; }, set points(v) { points = v; }, wallbuys, mbox, useBox, tryBuy, giveWeapon, get holster() { return holster; }, plasmas, setTool, setupTriggerDown, setupTriggerUp, alignToLine, loadSlot, saveSlot, serializeRoom, setupWallbuys, setupMysteryBox, surfaceAt, updateSetup
};
