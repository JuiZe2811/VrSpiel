import * as THREE from 'three';
import { room, surfacesOf, isOpening } from './room.js?v=38';
import { addDynamic, removeDynamic, localBoxOf, addKinematicBox, setKinematicPose, resizeKinematic, removeBody } from './physics.js?v=38';
import { SFX3D } from './sfx.js?v=38';
import { burst, addDebris, shockwave } from './effects.js?v=38';
import { cachedGeo } from './util.js?v=38';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadGiantModel, attachMonster, syncMonster } from './giantmodel.js?v=38';
const hyp = (a, b, c = 0) => Math.sqrt(a * a + b * b + c * c); // schneller als Math.hypot und ohne Speicher-Müll

// =============================================================================
// Zombies: kommen durch Türen und Fenster (reißen erst die Bretter ab),
// laufen um Wände/Tische/Stühle herum zum Spieler und greifen an.
// Trefferzonen: Kopf (x3), Körper, Arme (können abfallen), Beine (Humpeln / Kriechen).
// =============================================================================
let scene, onPlayerHit = () => {}, onBump = () => {}, onStomp = null;
const corpses = [];
const pendingBlasts = []; // Platzer, die im nächsten Update explodieren
export const spits = [];  // fliegende Säure-Klumpen der Spucker
export const zombies = [];
const planks = [];
const rand = THREE.MathUtils.randFloat;
const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();

let hooks = { explode: null, spitHit: null, shatter: null };
// Boss (eigenes Modul): eigene Bewegung/Angriffe, nutzt aber Treffer, Schaden und Waffen der Zombies
let bossHooks = { update: null, clear: null };
export function registerBoss(h) { Object.assign(bossHooks, h); }
// Lockvogel: aktive Position, zu der alle Zombies laufen
export const lure = { active: false, pos: new THREE.Vector3(), v: 0 };
export function setLure(pos) { if (pos) { lure.pos.set(pos.x, 0, pos.z); if (!lure.active) lure.v++; lure.active = true; } else if (lure.active) { lure.active = false; lure.v++; for (const z of zombies) z.pathT = 0; } }
export function setZombieHooks(h) { Object.assign(hooks, h); }
export function initZombies(s, hitCallback, bumpCallback, stompCallback) { scene = s; loadGiantModel(); onPlayerHit = hitCallback; if (bumpCallback) onBump = bumpCallback; if (stompCallback) onStomp = stompCallback; }

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
const clothTex = (base) => canvasTex(128, 128, (ctx, w, h) => {
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 3) { ctx.fillStyle = `rgba(0,0,0,${0.04 + Math.random() * 0.05})`; ctx.fillRect(0, y, w, 1); } // Stoffstruktur
  grime(ctx, w, h, 110, 0.3);
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; // Risse
  for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(Math.random() * w, Math.random() * h); ctx.lineTo(Math.random() * w, Math.random() * h); ctx.stroke(); }
});
const skinTex = (base) => canvasTex(128, 128, (ctx, w, h) => {
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 400; i++) { ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,230'},${Math.random() * 0.07})`; ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2); } // Poren
  grime(ctx, w, h, 70, 0.35);
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
const SKINS = SKIN_COLORS.map(c => { const t = skinTex(c); const m = new THREE.MeshStandardMaterial({ map: t, bumpMap: t, bumpScale: 1.2, roughness: 0.7, envMapIntensity: 0.35 }); m.userData.tint = new THREE.Color(c); m.userData.region = 0; return m; });
const FACES = SKIN_COLORS.map((c, i) => new THREE.MeshStandardMaterial({ map: faceTex(c, i % 3), roughness: 0.75, envMapIntensity: 0.35 }));
// ---- Gesichter von Freunden (Fotos, nur lokal auf dem Gerät gespeichert) ----------------------
const FRIEND_FACES = [];
let friendShare = 0;
// Foto auf eine eigene gewölbte Gesichtsfläche (keine Verzerrung wie auf der Kugel):
// Gesicht bleibt gut erkennbar, nur leicht fahl gefärbt, Ränder blenden in die Haut über
function friendFaceTex(img) {
  return canvasTex(300, 360, (ctx, w, h) => {
    ctx.fillStyle = '#7a7c64'; ctx.fillRect(0, 0, w, h);
    // Foto mit weichem, ovalem Rand
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    const t = tmp.getContext('2d');
    t.drawImage(img, 0, 0, w, h);
    t.globalCompositeOperation = 'destination-in';
    const g = t.createRadialGradient(w / 2, h * 0.5, Math.min(w, h) * 0.4, w / 2, h * 0.5, Math.min(w, h) * 0.56);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    t.fillStyle = g; t.save(); t.translate(w / 2, h / 2); t.scale(1, h / w); t.translate(-w / 2, -h / 2); t.fillRect(0, 0, w, h); t.restore();
    ctx.drawImage(tmp, 0, 0);
    // dezent zombiehaft: leichter Grünstich, etwas Schmutz und Blut nur am Rand
    ctx.globalCompositeOperation = 'color';
    ctx.fillStyle = 'rgba(120,150,100,0.18)'; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.38 + Math.random() * 0.12;
      ctx.fillStyle = Math.random() < 0.5 ? `rgba(110,0,0,${0.5 + Math.random() * 0.4})` : `rgba(0,0,0,${Math.random() * 0.3})`;
      ctx.beginPath(); ctx.ellipse(w / 2 + Math.cos(a) * w * r, h / 2 + Math.sin(a) * h * r, 3 + Math.random() * 8, 3 + Math.random() * 10, a, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(120,0,0,0.8)'; ctx.lineWidth = 3;
    for (const x of [w * 0.32, w * 0.7]) { ctx.beginPath(); ctx.moveTo(x, h * 0.86); ctx.lineTo(x + (Math.random() - 0.5) * 6, h * 0.99); ctx.stroke(); }
  });
}
// gewölbte Fläche vorne am Kopf (Ausschnitt einer Kugel), Bild füllt die ganze Fläche
const facePatchGeo = cachedGeo('zfacepatch', () => new THREE.SphereGeometry(0.104, 32, 24, Math.PI / 2 - 1.2, 2.4, 0.14, 2.2));
// urls: Bild-Daten (data:…); share: Anteil der Zombies mit Freundes-Gesicht (0…1)
export function setFriendFaces(urls, share) {
  friendShare = share;
  for (const m of FRIEND_FACES.splice(0)) { m.map.dispose(); m.dispose(); }
  for (const u of urls) {
    const img = new Image();
    img.onload = () => { const t = friendFaceTex(img); FRIEND_FACES.push(new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.35, roughness: 0.7, envMapIntensity: 0.3 })); };
    img.src = u;
  }
}
const clothMat = (c) => { const m = new THREE.MeshStandardMaterial({ map: clothTex(c), roughness: 0.95, envMapIntensity: 0.3 }); m.userData.tint = new THREE.Color(c); m.userData.region = 1; return m; };
const SHIRTS = ['#5b5145', '#3f4d5c', '#6b3b33', '#4c5b3c', '#7a7262', '#2b2b2b', '#8a8a80'].map(clothMat);
const PANTS = ['#2c3340', '#3d3226', '#28302a', '#45403a'].map(clothMat);
const EYES = [0xffe14a, 0xff2a1a, 0xe8f4ff].map(c => new THREE.MeshBasicMaterial({ color: c, toneMapped: false }));
// Leuchten um die Augen (sieht man vor allem im dunklen Flur)
const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'); const gr = g.createRadialGradient(16, 16, 1, 16, 16, 15); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();
const EYE_GLOW = [0xffe14a, 0xff2a1a, 0xbfe0ff, 0x7dff4a].map(c => new THREE.SpriteMaterial({ map: glowTex, color: c, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
let woundsMax = 4;
export function setWoundsMax(n) { woundsMax = n; }
let eyeGlowOn = true;
export function setEyeGlow(on) { eyeGlowOn = on; EYE_GLOW.slice(0, 3).forEach(m => { m.opacity = on ? 0.55 : 0; }); }
// Gift-Zombies: grünliche Haut, leuchtende Beulen
const TOXIC_SKIN = (() => { const t = skinTex('#6d7a3a'); const m = new THREE.MeshStandardMaterial({ map: t, bumpMap: t, bumpScale: 1.5, roughness: 0.55, envMapIntensity: 0.4 }); m.userData.tint = new THREE.Color('#6d7a3a'); m.userData.region = 0; return m; })();
const pustuleMat = new THREE.MeshStandardMaterial({ color: 0x9cff3a, emissive: 0x5aff1a, emissiveIntensity: 0.9, roughness: 0.3 });
const acidMat = new THREE.MeshBasicMaterial({ color: 0x8dff3a, toneMapped: false });
// Einschusswunden, die am Zombie bleiben
const holeGeo = cachedGeo('zhole', () => new THREE.CircleGeometry(0.014, 10));
const holeMat = new THREE.MeshBasicMaterial({ color: 0x2a0000, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
const bloodRunMat = new THREE.MeshBasicMaterial({ color: 0x5a0000, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
const runGeo = cachedGeo('zrun', () => new THREE.PlaneGeometry(0.008, 0.06));
const hairMat = new THREE.MeshStandardMaterial({ color: 0x1c1712, roughness: 1 });
const mouthMat = new THREE.MeshStandardMaterial({ color: 0x220707, roughness: 1 });
const boneMat = new THREE.MeshStandardMaterial({ color: 0xcfc6a8, roughness: 0.7 });
const woundMat = new THREE.MeshStandardMaterial({ color: 0x5a0606, roughness: 0.5 });
const stumpMat = woundMat;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const capGeo = (r, len) => cachedGeo(`zc${r}|${len}`, () => new THREE.CapsuleGeometry(r, len, 3, 8)); // wenige Polygone (Leistung)
const sphGeo = (r) => cachedGeo(`zs${r}`, () => new THREE.SphereGeometry(r, r > 0.03 ? 14 : 8, r > 0.03 ? 10 : 6));
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
  bloater: { name: 'Platzer', scale: [0.92, 1.0], width: 1.6, hp: 90, speed: 0.8, dmg: 6, explode: true },
  spitter: { name: 'Spucker', scale: [0.86, 0.94], width: 0.85, hp: 85, speed: 0.95, dmg: 8, spit: true },
  giant: { name: 'Riese', scale: [1.24, 1.3], width: 1.5, hp: 900, speed: 0.62, dmg: 28 }
};
function buildZombie(type) {
  const T = TYPES[type];
  const si = Math.floor(Math.random() * SKINS.length);
  const toxic = type === 'bloater' || type === 'spitter';
  const friend = FRIEND_FACES.length > 0 && type !== 'giant' && Math.random() < friendShare;
  const skin = toxic ? TOXIC_SKIN : SKINS[si], face = friend ? skin : FACES[si], shirt = pick(SHIRTS), pants = pick(PANTS);
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
  if (friend) { // Freundes-Gesicht: eigene Fläche mit dem Foto, Kopf etwas größer
    const patch = new THREE.Mesh(facePatchGeo, pick(FRIEND_FACES));
    patch.userData.part = 'head';
    skull.add(patch);
    head.scale.setScalar(1.32);
  }
  if (!friend && Math.random() < 0.6) head.add(mesh(hairGeo, hairMat, 0, 0.115, -0.005, null, 0.95, 1.1, 1.02));
  const eyeMat = type === 'runner' || type === 'giant' ? EYES[1] : pick(EYES);
  const glowMat = toxic ? EYE_GLOW[3] : EYE_GLOW[EYES.indexOf(eyeMat)];
  for (const sx of [-1, 1]) if (!friend && Math.random() > 0.12) {
    head.add(mesh(sphGeo(0.014), toxic ? acidMat : eyeMat, sx * 0.034, 0.118, 0.077));
    if (!eyeGlowOn) continue; // Leuchten nur, wenn eingeschaltet (spart Zeichenaufrufe)
    const gl = new THREE.Sprite(glowMat);
    gl.position.set(sx * 0.034, 0.118, 0.085);
    gl.scale.setScalar(0.06);
    head.add(gl);
  }
  const jaw = new THREE.Group();
  jaw.position.set(0, 0.06, 0.02);
  head.add(jaw);
  if (!friend) { // bei Fotos ist der Mund schon im Gesicht
    jaw.add(mesh(sphGeo(0.06), skin, 0, -0.02, 0.025, 'head', 1.05, 0.55, 1));
    jaw.add(mesh(sphGeo(0.04), mouthMat, 0, 0.0, 0.05, null, 1.1, 0.5, 0.5));
  }
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
  // Platzer: aufgeblähter Bauch voller leuchtender Beulen
  let belly = null;
  if (type === 'bloater') {
    belly = mesh(sphGeo(0.13), skin, 0, 0.2, 0.06, 'torso', 1.25, 1.15, 1.2);
    torso.add(belly);
    for (let k = 0; k < 9; k++) {
      const a = Math.random() * Math.PI * 1.6 - 0.8, y = 0.08 + Math.random() * 0.3;
      torso.add(mesh(sphGeo(0.022 + Math.random() * 0.02), pustuleMat, Math.sin(a) * 0.15, y, 0.06 + Math.cos(a) * 0.14, 'torso'));
    }
    for (let k = 0; k < 3; k++) head.add(mesh(sphGeo(0.016), pustuleMat, (Math.random() - 0.5) * 0.12, 0.16 + Math.random() * 0.05, 0.05));
  }
  // Spucker: langer Hals, leuchtender Mund mit Säure
  if (type === 'spitter') {
    neck.scale.y = 1.6;
    jaw.add(mesh(sphGeo(0.03), acidMat, 0, -0.005, 0.055, null, 1.1, 0.6, 0.6));
    for (let k = 0; k < 3; k++) jaw.add(mesh(capGeo(0.004, 0.04), acidMat, (k - 1) * 0.015, -0.05, 0.06));
  }
  // kräftige Typen: dickere Beine und Arme
  const thick = 0.6 + 0.4 * T.width;
  if (thick > 1.01) { for (const l of legs) l.hip.scale.set(thick, 1, thick); for (const a of arms) a.shoulder.scale.z = thick; }
  return { root, body, hips, torso, neck, head, skull, jaw, arms, legs, belly };
}

// ---- Leistung: alle Körperteile zu EINEM Skinned-Mesh zusammenfassen -------------------------
// Statt ~30 Einzelteilen (= 30 Zeichenaufrufe pro Auge) wird jeder Zombie als ein Körper gezeichnet.
// Die bisherigen Gruppen (Hüfte, Arme, Knie …) bleiben als Knochen erhalten – Animationen, Umfallen
// und abfallende Gliedmaßen funktionieren unverändert.
const ATLAS = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  // Bereich 0 (links oben): Haut – Poren, Adern, Schmutz, Blut (hell, wird mit der Hautfarbe eingefärbt)
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 700; i++) { ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2); }
  for (let i = 0; i < 40; i++) { ctx.fillStyle = Math.random() < 0.35 ? `rgba(150,0,0,${0.5 + Math.random() * 0.4})` : `rgba(0,0,0,${Math.random() * 0.35})`; ctx.beginPath(); ctx.ellipse(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 5, 1 + Math.random() * 4, Math.random() * 3, 0, Math.PI * 2); ctx.fill(); }
  ctx.strokeStyle = 'rgba(60,20,70,0.45)';
  for (let i = 0; i < 8; i++) { ctx.beginPath(); let x = Math.random() * 128, y = Math.random() * 128; ctx.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (Math.random() - 0.5) * 16; y += Math.random() * 12; ctx.lineTo(x, y); } ctx.stroke(); }
  // Bereich 1 (rechts oben): Stoff – Webstruktur, Risse, Flecken
  for (let y = 0; y < 128; y += 3) { ctx.fillStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.06})`; ctx.fillRect(128, y, 128, 1); }
  for (let i = 0; i < 60; i++) { ctx.fillStyle = Math.random() < 0.3 ? `rgba(140,0,0,${0.4 + Math.random() * 0.5})` : `rgba(0,0,0,${Math.random() * 0.35})`; ctx.beginPath(); ctx.ellipse(128 + Math.random() * 128, Math.random() * 128, 1 + Math.random() * 6, 1 + Math.random() * 5, Math.random() * 3, 0, Math.PI * 2); ctx.fill(); }
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, 256, 128); ctx.clip();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(128 + Math.random() * 128, Math.random() * 128); ctx.lineTo(128 + Math.random() * 128, Math.random() * 128); ctx.stroke(); }
  ctx.restore();
  // Bereich 2 (unten): einfarbig weiß (für Knochen, Wunden, Augen …)
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
export const ZOMBIE_MAT = new THREE.MeshLambertMaterial({ map: ATLAS, vertexColors: true });
const PART_CODES = { torso: 1, head: 2, armL: 3, armR: 4, legL: 5, legR: 6 };
const PART_NAMES = [null, 'torso', 'head', 'armL', 'armR', 'legL', 'legR'];
export let skinningOn = true;
export function setSkinning(on) { skinningOn = on; }
// GPU-Speicher eines entfernten Zombies freigeben (Körper-Geometrie + Knochen-Textur)
function freeZombie(z) {
  if (z.monster && !z.monster.freed) { z.monster.freed = true; z.monster.model.traverse(o => { if (o.isSkinnedMesh) o.skeleton.dispose(); }); }
  if (!z.skinned || z.freed) return;
  z.freed = true;
  z.skinned.geometry.dispose();
  z.skinned.skeleton.dispose();
}
function skinify(z) {
  if (!skinningOn) { z.hitTorso = z.torso.children[1]; return; }
  const root = z.root;
  const pos0 = root.position.clone(), rot0 = root.rotation.clone(), sc0 = root.scale.clone();
  root.position.set(0, 0, 0); root.rotation.set(0, 0, 0); root.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);
  const bones = [];
  root.traverse(o => { if (!o.isMesh && !o.isSprite && o !== root) bones.push(o); });
  const pieces = [], partOf = [];
  const keep = (m) => m === z.skull || m === z.belly || m.parent === z.skull || m.userData.keep;
  const merged = [];
  root.traverse(m => {
    if (!m.isMesh || keep(m)) return;
    const bone = m.parent;
    const bi = bones.indexOf(bone);
    if (bi < 0) return;
    const g = new THREE.BufferGeometry();
    const src = m.geometry;
    g.setAttribute('position', src.attributes.position.clone());
    g.setAttribute('normal', src.attributes.normal.clone());
    g.setAttribute('uv', src.attributes.uv.clone());
    g.setIndex(src.index.clone());
    g.applyMatrix4(m.matrixWorld);
    const n = g.attributes.position.count;
    const mat = m.material;
    const col = mat.userData.tint || mat.color || new THREE.Color(1, 1, 1);
    const region = mat.userData.region ?? 2;
    const colors = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const uv = g.attributes.uv;
    for (let i = 0; i < n; i++) {
      colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
      si[i * 4] = bi; sw[i * 4] = 1;
      if (region === 2) uv.setXY(i, 0.5, 0.25);
      else uv.setXY(i, (region === 1 ? 0.5 : 0) + 0.01 + uv.getX(i) * 0.48, 0.51 + uv.getY(i) * 0.48);
      partOf.push(PART_CODES[m.userData.part] || 0);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    pieces.push(g);
    merged.push(m);
  });
  const geo = mergeGeometries(pieces, false);
  for (const g of pieces) g.dispose();
  for (const m of merged) m.parent.remove(m);
  const mesh = new THREE.SkinnedMesh(geo, ZOMBIE_MAT);
  root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.8, 0), 1.3);
  mesh.castShadow = true;
  // Treffer: welches Körperteil wurde getroffen? (über den Eckpunkt des getroffenen Dreiecks)
  const parts = Uint8Array.from(partOf);
  const proxies = {};
  const holder = { torso: z.torso, head: z.head, armL: z.arms[0].shoulder, armR: z.arms[1].shoulder, legL: z.legs[0].hip, legR: z.legs[1].hip };
  for (const [name, bone] of Object.entries(holder)) { const o = new THREE.Object3D(); o.userData.part = name; o.userData.zombie = z; o.userData.proxy = true; bone.add(o); proxies[name] = o; }
  const orig = THREE.SkinnedMesh.prototype.raycast;
  mesh.raycast = function (rc, out) {
    const start = out.length;
    orig.call(this, rc, out);
    for (let i = start; i < out.length; i++) {
      const name = PART_NAMES[parts[out[i].face.a]];
      if (!name || !proxies[name]) { out.splice(i, 1); i--; continue; }
      // abgefallene Gliedmaßen treffen nicht mehr
      if ((name === 'armL' && z.armLost[0]) || (name === 'armR' && z.armLost[1]) || (name === 'legL' && z.legLost[0]) || (name === 'legR' && z.legLost[1])) { out.splice(i, 1); i--; continue; }
      out[i].object = proxies[name];
    }
  };
  mesh.userData.part = 'skinned';
  mesh.userData.zombie = z;
  z.skinned = mesh;
  z.proxies = proxies;
  z.hitTorso = proxies.torso;
  root.position.copy(pos0); root.rotation.copy(rot0); root.scale.copy(sc0);
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
  // beide Nägel als EIN Mesh (Leistung: ein Zeichenaufruf weniger pro Brett)
  g.add(new THREE.Mesh(cachedGeo(`nails${len.toFixed(2)}`, () => mergeGeometries([-1, 1].map(sx => new THREE.CylinderGeometry(0.006, 0.006, 0.01, 6).rotateX(Math.PI / 2).translate(sx * (len / 2 - 0.05), 0, 0.014)))), nailMat));
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
// für den Boss: ein Brett abreißen (true, wenn noch eins da war)
export function tearPlankFor(o, pos) { if (!o.planks || !o.planks.length) return false; tearPlank(o, pos); return true; }
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
const RADIUS = 0.16; // Abstand zu Wänden/Möbeln (klein genug, dass Zombies auch durch enge Lücken passen)
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
    // Türen großzügig zuordnen (auch leicht schief/versetzt eingezeichnet) und immer mindestens 0,8 m breit freihalten,
    // damit Zombies auch durch schmale Türen sauber durchlaufen
    w, doors: openings().filter(o => o.type === 'door' && Math.abs(o.normal.dot(w.normal)) > 0.8 && Math.abs((o.mid.x - w.mid.x) * w.normal.x + (o.mid.z - w.mid.z) * w.normal.z) < 0.6)
      .map(o => { const u = (o.mid.x - w.a.x) * w.right.x + (o.mid.z - w.a.z) * w.right.z, half = Math.max(0.4, o.width / 2 + 0.05); return [u - half, u + half]; })
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
export function walkable(x, z) { // ohne Hilfs-Arrays (wird sehr oft pro Bild aufgerufen)
  if (!nav.blocked) return true;
  const i = Math.floor((x - nav.minX) / nav.cell), j = Math.floor((z - nav.minZ) / nav.cell);
  return !inGrid(i, j) || !nav.blocked[j * nav.w + i];
}
// steckt fest (z. B. in einer Ecke): auf die nächste freie Zelle bzw. ein Stück in Wegrichtung setzen
function unstick(z) {
  z.stuckN = 0;
  if (!nav.blocked) return;
  const i = Math.floor((z.pos.x - nav.minX) / nav.cell), j = Math.floor((z.pos.z - nav.minZ) / nav.cell);
  const f = isFreeCell(i, j) ? null : nearestFree(i, j);
  if (f) { z.pos.x = nav.minX + (f[0] + 0.5) * nav.cell; z.pos.z = nav.minZ + (f[1] + 0.5) * nav.cell; }
  else if (z.path && z.path[0]) { const n = z.path[0], dx = n.x - z.pos.x, dz = n.z - z.pos.z, d = hyp(dx, dz) || 1; if (walkable(z.pos.x + dx / d * 0.15, z.pos.z + dz / d * 0.15)) { z.pos.x += dx / d * 0.15; z.pos.z += dz / d * 0.15; } }
}
function nearestFree(i, j) {
  if (isFreeCell(i, j)) return [i, j];
  for (let r = 1; r < 12; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    if (Math.max(Math.abs(di), Math.abs(dj)) === r && isFreeCell(i + di, j + dj)) return [i + di, j + dj];
  }
  return null;
}
// freie Sichtlinie auf dem Raster (in kleinen Schritten prüfen, mit etwas Seitenabstand)
function lineFree(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, len = Math.sqrt(dx * dx + dz * dz);
  const n = Math.ceil(len / (nav.cell * 0.5));
  const px = len > 0 ? -dz / len * 0.08 : 0, pz = len > 0 ? dx / len * 0.08 : 0;
  for (let k = 1; k <= n; k++) {
    const t = k / n, x = a.x + dx * t, z = a.z + dz * t;
    if (!walkable(x, z) || !walkable(x + px, z + pz) || !walkable(x - px, z - pz)) return false;
  }
  return true;
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
  const push = (k) => { let i = size++; heapArr[i] = k; while (i > 0) { const p = (i - 1) >> 1; if (fScore[heapArr[p]] <= fScore[heapArr[i]]) break; const t = heapArr[p]; heapArr[p] = heapArr[i]; heapArr[i] = t; i = p; } };
  const pop = () => { const top = heapArr[0]; heapArr[0] = heapArr[--size]; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < size && fScore[heapArr[l]] < fScore[heapArr[m]]) m = l; if (r < size && fScore[heapArr[r]] < fScore[heapArr[m]]) m = r; if (m === i) break; const t = heapArr[m]; heapArr[m] = heapArr[i]; heapArr[i] = t; i = m; } return top; };
  const gx = g[0], gy = g[1];
  gScore[start] = 0; fScore[start] = hyp(s[0] - gx, s[1] - gy); push(start);
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
      if (ng < gScore[nk]) { gScore[nk] = ng; fScore[nk] = ng + hyp(ni - gx, nj - gy); came[nk] = cur; push(nk); }
    }
  }
  if (!found) return [to.clone()];
  const path = [];
  for (let k = goal; k !== -1 && k !== start; k = came[k]) path.push(new THREE.Vector3(nav.minX + ((k % W) + 0.5) * nav.cell, 0, nav.minZ + (((k / W) | 0) + 0.5) * nav.cell));
  path.reverse();
  path.push(to.clone().setY(0));
  // glätten mit Sichtlinien-Prüfung: nur Punkte behalten, die wirklich nötig sind (keine Ecken abschneiden)
  const out = [];
  let anchor = from, i = 0;
  while (i < path.length) {
    let j = path.length - 1;
    while (j > i && !lineFree(anchor, path[j])) j--;
    out.push(path[j]);
    anchor = path[j];
    i = j + 1;
  }
  return out;
}
let planBudget = 0; // höchstens 2 Wegberechnungen pro Bild

// ---- Zombies erzeugen ------------------------------------------------------------
// Balance: Spezial-Zombies werden mit jeder Welle häufiger (mit Obergrenzen)
export function pickType(wave) {
  const w = wave;
  const table = [
    ['brute', w >= 3 ? Math.min(0.15, 0.05 + w * 0.005) : 0],
    ['bloater', w >= 4 ? Math.min(0.11, 0.04 + w * 0.004) : 0],
    ['spitter', w >= 5 ? Math.min(0.11, 0.04 + w * 0.004) : 0],
    ['runner', w >= 2 ? Math.min(0.28, 0.1 + w * 0.012) : 0],
    ['crawler', w >= 2 ? 0.09 : 0]
  ];
  let r = Math.random();
  for (const [t, p] of table) { if (r < p) return t; r -= p; }
  return 'walker';
}
// Lebenspunkte-Faktor: bis Welle 10 linear (+12 % pro Welle), danach +8 % pro Welle exponentiell
export const hpScale = (w) => (w <= 10 ? 1 + 0.12 * Math.max(0, w - 1) : 2.08 * Math.pow(1.08, w - 10));
// opts.hp / opts.speed: Faktoren für den Schwierigkeitsgrad
export function spawnZombie(wave, head, type = pickType(wave), opts = {}) {
  const T = TYPES[type];
  const z = buildZombie(type);
  z.root.traverse(m => { if (m.isMesh && !m.material.transparent && m.userData.part) m.castShadow = true; }); // nur große Körperteile werfen Schatten (Leistung)
  const scale = rand(T.scale[0], T.scale[1]);
  z.root.scale.setScalar(scale);
  const zombie = {
    ...z, type, T, scale, hp: T.hp * hpScale(wave) * (opts.hp || 1), maxHp: T.hp * hpScale(wave) * (opts.hp || 1), dmgK: Math.min(1.6, 1 + wave * 0.025), legHp: [60, 60].map(v => v * T.hp / 100), armHp: [45, 45].map(v => v * T.hp / 100), legLost: [false, false], armLost: [false, false],
    state: 'outside', pos: new THREE.Vector3(), yaw: 0, speed: Math.min(1.8, (rand(0.42, 0.58) + Math.min(wave, 16) * 0.035) * T.speed * (opts.speed || 1) * (type === 'walker' && wave >= 6 && Math.random() < Math.min(0.45, (wave - 5) * 0.05) ? 1.6 : 1)), phase: Math.random() * 6, jawT: Math.random() * 6,
    path: null, pathT: 0, attackT: 1, actionT: 0, deadT: 0, hurtT: 0, groanT: rand(1, 4), opening: null, enterT: 0, crawl: false, fallDir: 1, headless: false,
    // Leistung: alle später benutzten Felder gleich hier anlegen (gleiche Objekt-Form für alle Zombies,
    // Zahlenfelder bleiben Zahlen) – sonst erzeugt jede Änderung pro Bild neuen Speicher-Müll und es ruckelt
    atkK: opts.atk || 1, stuckT: 0, stuckX: 0, stuckZ: 0, stuckN: 0, skipT: 0, stagger: 0, recentDmg: 0, twitch: 0, twitchT: Math.random() * 3, bumpT: 0, lastStep: 0, hitPts: 0, spitT: rand(1.5, 3), fuseT: 0.9, wounds: 0,
    headSnap: 0, hurtTwist: 1, knockT: 0, knockBack: 0, frozenT: 0, burnT: 0, burnTick: 0, burnUp: false, roarT: 2, stompT: 4, smokeT: 0, landT: 0, spinDir: 0,
    lureV: -1, slot: 0, attackVariant: 0, exploded: false, gibbed: false, landed: false, spat: false, kinCrawl: false, freed: false,
    hurtDir: new THREE.Vector3(0, 0, 1), enterFrom: null, fallVec: null, d0: null, deathStyle: '', ice: null, kin: null, phys: null, proxies: null,
    skinned: null, hitTorso: null, pendingBump: null, monster: null
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
    for (const l of zombie.legs) { l.hip.visible = false; l.hip.scale.setScalar(0.0001); }
  }
  zombie.root.position.x = zombie.pos.x;
  zombie.root.position.z = zombie.pos.z;
  zombie.root.traverse(o => { if (o.isMesh && o.userData.part) o.userData.zombie = zombie; });
  skinify(zombie);
  if (type === 'giant') attachMonster(zombie); // Riese: Monster-Modell statt Baukasten-Körper
  // unsichtbarer Körper: geworfene Dinge prallen ab und treffen den Zombie
  zombie.kin = addKinematicBox(new THREE.Vector3(0.2 * T.width * scale, 0.8 * scale, 0.16 * scale), 0.8 * scale, (other, v, p) => bumpZombie(zombie, other, v, p));
  zombie.kinCrawl = false;
  scene.add(zombie.root);
  zombies.push(zombie);
  return zombie;
}
export function clearZombies() {
  if (bossHooks.clear) bossHooks.clear();
  for (const z of zombies) {
    if (z.root.parent) z.root.parent.remove(z.root);
    freeZombie(z);
    if (z.kin) { removeBody(z.kin); z.kin = null; }
    if (z.phys) { removeDynamic(z.phys); z.phys = null; }
  }
  zombies.length = 0;
  corpses.length = 0;
  clearSpits();
  for (const l of limbs) { removeDynamic(l.phys); l.obj.scale.setScalar(0.0001); l.obj.updateMatrixWorld(true); if (l.obj.parent) l.obj.parent.remove(l.obj); }
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
  group.traverse(o => { if (o.isMesh || o.userData.proxy) o.userData.part = null; });
  const box = z.skinned ? (kind === 'arm' ? new THREE.Box3(new THREE.Vector3(-0.05, -0.62, -0.06), new THREE.Vector3(0.05, 0, 0.06)) : new THREE.Box3(new THREE.Vector3(-0.07, -0.88, -0.07), new THREE.Vector3(0.07, 0, 0.1))).applyMatrix4(new THREE.Matrix4().makeScale(z.scale, z.scale, z.scale)) : localBoxOf(group);
  const phys = addDynamic(group, box, 3, { vel: new THREE.Vector3(rand(-1, 1), 1, rand(-1, 1)), angVel: new THREE.Vector3(rand(-5, 5), rand(-5, 5), rand(-5, 5)) });
  limbs.push({ obj: group, phys, t: 8 });
  if (kind === 'arm') z.armLost[sideIndex] = true;
  else z.legLost[sideIndex] = true;
}
// Trifft ein Projektil ein Körperteil: Ergebnis für Punkte/Anzeige
export function damageZombie(mesh, point, dir, dmg, quiet = false) {
  const z = mesh.userData.zombie;
  const partName = mesh.userData.part;
  if (!z || !partName || z.state === 'dead') return null;
  if (!quiet) {
    burst(point, 0x6a0000, 10);
    SFX3D.splat(point);
    addWound(z, mesh, point);
  }
  if (!quiet && (z.hurtT || 0) <= 0 && z.hp > dmg * 1.2 && Math.random() < 0.6) SFX3D.hurt(point, z.type);
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
  if (z.T.boss) dmg = Math.min(dmg, 300); // Boss: kein Sofort-Tod durch Eis, Fallen oder Power-ups
  else if (z.frozenT > 0) dmg *= 25; // gefroren: zerspringt
  if (partName === 'head') { z.hp -= dmg * 3; headshot = true; }
  else if (partName === 'torso') z.hp -= dmg;
  else if (partName.startsWith('arm')) {
    const k = partName === 'armL' ? 0 : 1;
    z.hp -= dmg * 0.5;
    z.armHp[k] -= dmg;
    if (z.armHp[k] <= 0 && !z.armLost[k] && !z.monster) detach(z, z.arms[k].shoulder, 'arm', k);
  } else {
    const k = partName === 'legL' ? 0 : 1;
    z.hp -= dmg * 0.6;
    z.legHp[k] -= dmg;
    if (z.legHp[k] <= 0 && !z.legLost[k] && !z.monster) { detach(z, z.legs[k].hip, 'leg', k); z.crawl = true; }
  }
  const res = { part: partName, headshot, kill: false, limp: z.legHp.some(h => h < 30) && !z.crawl, pos: z.pos.clone(), type: z.type, zombie: z, dot: quiet };
  if (z.hp <= 0) {
    res.kill = true;
    if (headshot && dmg * 3 >= 150 && !z.T.boss) { z.head.visible = false; z.headless = true; burst(point, 0x7a0000, 30); }
    kill(z, dir);
  }
  return res;
}
// Einschussloch + Blutspur bleiben am getroffenen Körperteil
function addWound(z, mesh, point) {
  if (z.monster) return; // Monster-Modell: keine Einschusslöcher am unsichtbaren Baukasten-Körper
  if ((z.wounds || 0) >= (woundsMax) ) return;
  if (!mesh.geometry && mesh.userData.proxy) { // Skinned-Körper: Loch am Knochen befestigen
    z.wounds = (z.wounds || 0) + 1;
    const bone = mesh.parent;
    bone.updateWorldMatrix(true, false);
    const local = bone.worldToLocal(point.clone());
    const n = new THREE.Vector3(local.x, 0, local.z);
    if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
    n.normalize();
    const hole = new THREE.Mesh(holeGeo, holeMat);
    hole.position.copy(local).addScaledVector(n, 0.004);
    hole.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    hole.scale.setScalar(0.9 + Math.random() * 0.5);
    bone.add(hole);
    return;
  }
  if (!mesh.geometry) return;
  z.wounds = (z.wounds || 0) + 1;
  mesh.updateWorldMatrix(true, false);
  const local = mesh.worldToLocal(point.clone());
  const c = mesh.geometry.boundingSphere || (mesh.geometry.computeBoundingSphere(), mesh.geometry.boundingSphere);
  const n = local.clone().sub(c.center);
  if (n.lengthSq() < 1e-8) return;
  n.normalize();
  const hole = new THREE.Mesh(holeGeo, holeMat);
  hole.position.copy(local).addScaledVector(n, 0.002);
  hole.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n));
  const sc = 1 / Math.max(0.3, (mesh.scale.x + mesh.scale.y + mesh.scale.z) / 3);
  hole.scale.setScalar(sc * (0.8 + Math.random() * 0.6));
  mesh.add(hole);
  if (Math.random() < 0.6) {
    const run = new THREE.Mesh(runGeo, bloodRunMat);
    run.position.set(0, -0.03, 0.0005);
    hole.add(run);
  }
}
// Atombombe (Power-up): alle Zombies sterben
export function killAll(from) {
  const results = [];
  for (const z of zombies) {
    if (z.state === 'dead') continue;
    const dir = new THREE.Vector3(z.pos.x - from.x, 0, z.pos.z - from.z).normalize();
    if (z.T.boss) { // Atombombe: Boss verliert nur ein Stück Leben
      z.hp -= 300; z.hurtT = 0.4;
      const r = { part: 'torso', headshot: false, kill: false, pos: z.pos.clone(), type: z.type, zombie: z, explosion: true, nuke: true };
      if (z.hp <= 0) { r.kill = true; kill(z, dir); }
      results.push(r);
      continue;
    }
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
    const d = hyp(z.pos.x - center.x, z.pos.z - center.z, Math.max(0, center.y - 1.0) * 0.5);
    const f = 1 - d / radius;
    if (f <= 0) continue;
    const dir = new THREE.Vector3(z.pos.x - center.x, 0, z.pos.z - center.z).normalize();
    z.hp -= z.T.boss ? Math.min(300, maxDmg * f) : maxDmg * f;
    z.hurtT = 0.4;
    burst(z.skull.getWorldPosition(new THREE.Vector3()), 0x6a0000, 12);
    if (f > 0.45 && !z.T.boss && !z.monster) {
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
  const res = damageZombie(z.hitTorso || z.torso.children[1], p, dir, dmg);
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
  freeZombie(z);
  const i = zombies.indexOf(z);
  if (i >= 0) zombies.splice(i, 1);
}
function kill(z, dir) {
  z.state = 'dead';
  z.deadT = 0;
  if (z.frozenT > 0 && !z.T.boss) { // in Eissplitter zerspringen
    const at = z.root.position.clone().setY(1);
    z.gibbed = true;
    z.root.visible = false;
    burst(at, 0xbfe8ff, 40);
    burst(at, 0xffffff, 16);
    if (hooks.shatter) hooks.shatter(at);
    if (z.kin) { removeBody(z.kin); z.kin = null; }
    return;
  }
  if (!z.T.explode) SFX3D.death(z.skull.getWorldPosition(new THREE.Vector3()), z.type);
  if (z.T.explode && !z.exploded) { z.exploded = true; pendingBlasts.push(z); }
  // nach hinten (vom Schuss weg) umfallen
  const fwd = new THREE.Vector3(Math.sin(z.yaw), 0, Math.cos(z.yaw));
  z.fallDir = dir && dir.dot(fwd) > 0 ? 1 : -1;
  z.fallVec = dir ? new THREE.Vector3(dir.x, 0, dir.z).normalize() : fwd;
  if (!isFinite(z.fallVec.x) || z.fallVec.lengthSq() < 0.5) z.fallVec = fwd;
  if (z.kin) { removeBody(z.kin); z.kin = null; }
  // Art des Sterbens
  z.deathStyle = z.crawl || Math.abs(z.body.rotation.x) > 0.8 ? 'crawl' : z.headless ? 'knees' : ['fall', 'fall', 'knees', 'spin'][Math.floor(Math.random() * 4)];
  z.d0 = { rx: z.body.rotation.x, y: z.body.position.y, ry: z.root.rotation.y };
  z.landed = false;
}
// ---- Todesanimation: taumeln → zusammenbrechen/umfallen → liegen → im Boden versinken (mit Rauch) ----
let corpseHold = 1.2;
export function setCorpseTime(s) { corpseHold = s; }
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
function animateDeath(z, dt) {
  const t = z.deadT, st = z.deathStyle, fd = z.fallDir || -1, d0 = z.d0 || { rx: 0, y: 0 };
  const lerp = THREE.MathUtils.lerp;
  let fallK = 0;
  if (st === 'crawl') {
    fallK = ease(t / 0.4);
    z.body.rotation.x = lerp(d0.rx, 1.5, fallK);
    z.body.position.y = lerp(d0.y, 0.03, fallK);
  } else if (st === 'knees') {
    // auf die Knie sacken, dann nach vorne kippen
    const kneel = ease(t / 0.45), tip = ease((t - 0.45) / 0.55);
    for (let _k = 0; _k < z.legs.length; _k++) { const l = z.legs[_k]; l.hip.rotation.x = -1.3 * kneel * (1 - tip * 0.6); l.knee.rotation.x = 2.1 * kneel * (1 - tip * 0.5); }
    z.body.position.y = lerp(d0.y, -0.36 * z.scale, kneel) * (1 - tip) + 0.03 * tip;
    z.body.rotation.x = lerp(d0.rx, 1.45, tip * tip);
    for (let _k = 0; _k < z.arms.length; _k++) { const a = z.arms[_k]; a.shoulder.rotation.x = lerp(-0.4, -0.2, tip); a.elbow.rotation.x = -0.6; }
    fallK = tip;
  } else {
    // getroffen zurücktaumeln, dann wie ein Brett umfallen (beschleunigt)
    const stag = ease(t / 0.22), k = Math.max(0, (t - 0.18) / 0.62), kk = Math.min(1, k * k);
    z.torso.rotation.x = -0.35 * fd * stag * (1 - kk);
    z.body.rotation.x = lerp(d0.rx, fd * 1.5, kk);
    z.body.position.y = lerp(d0.y, 0.04, kk);
    for (let j = 0; j < z.legs.length; j++) { const l = z.legs[j]; l.knee.rotation.x = 0.5 * kk + j * 0.15; l.hip.rotation.x = (fd > 0 ? -0.3 : 0.4) * kk; }
    for (let j = 0; j < z.arms.length; j++) { const a = z.arms[j]; a.shoulder.rotation.x = fd < 0 ? lerp(-0.6, -2.7, kk) + Math.sin(t * 14 + j) * 0.2 * (1 - kk) : lerp(-0.6, -1.4, kk); a.shoulder.rotation.z = (j ? -1 : 1) * 0.5 * kk; a.elbow.rotation.x = 0.2; }
    if (st === 'spin') z.root.rotation.y = d0.ry + 1.8 * ease(t / 0.8) * (z.spinDir || (z.spinDir = Math.random() < 0.5 ? -1 : 1));
    fallK = kk;
  }
  z.neck.rotation.x = THREE.MathUtils.damp(z.neck.rotation.x, 0.9, 4, dt);
  z.jaw.rotation.x = 0.45;
  // Aufschlag: kleiner Rückprall, Staub, dumpfer Schlag
  if (!z.landed && fallK >= 1) {
    z.landed = true;
    z.landT = t;
    SFX3D.step(z.root.position.clone(), 0.9);
    burst(z.root.position.clone().setY(0.1), 0x5a5048, 8);
  }
  if (z.landed) {
    const b = t - z.landT;
    z.body.rotation.x += Math.sin(b * 22) * Math.exp(-b * 9) * 0.06 * Math.sign(z.body.rotation.x || 1);
    // letztes Zucken
    if (b > 0.3 && b < 0.9) z.arms[0].elbow.rotation.x = 0.2 + Math.max(0, Math.sin(b * 30)) * 0.3 * (0.9 - b);
  }
  // nach kurzer Zeit im Boden versinken (mit dunklem Rauch)
  const sinkStart = (z.landed ? z.landT : 1.2) + corpseHold;
  if (t > sinkStart) {
    z.root.position.y -= dt * 0.55;
    z.smokeT = (z.smokeT || 0) - dt;
    if (z.smokeT <= 0) { z.smokeT = 0.12; burst(z.root.position.clone().setY(0.05), 0x2a221c, 2); }
  }
  return z.root.position.y < -0.7 || t > sinkStart + 2;
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
  const limp0 = z.legHp[0] < 30, limp1 = z.legHp[1] < 30; // (ohne Hilfs-Arrays/Closures: weniger Speicher-Müll pro Bild)
  if (z.crawl) {
    // liegt auf dem Bauch: Körper nach vorne gekippt, Füße hinter dem Standpunkt
    z.body.rotation.x = THREE.MathUtils.damp(z.body.rotation.x, 1.45, 6, dt);
    z.body.position.y = THREE.MathUtils.damp(z.body.position.y, 0.06, 6, dt);
    z.body.position.z = THREE.MathUtils.damp(z.body.position.z, -0.85, 6, dt);
    for (let i = 0; i < 2; i++) { const a = z.arms[i], l = z.legs[i]; a.shoulder.rotation.x = -2.6 + (i ? s : -s) * 0.5; a.elbow.rotation.x = -0.4; l.hip.rotation.x = 0.1 + (i ? -s : s) * 0.15; l.knee.rotation.x = 0.3; }
    return;
  }
  z.body.rotation.x = THREE.MathUtils.damp(z.body.rotation.x, 0.12, 6, dt);
  z.body.position.y = THREE.MathUtils.damp(z.body.position.y, 0, 6, dt);
  for (let i = 0; i < 2; i++) {
    const l = z.legs[i], lp = i ? limp1 : limp0;
    const ph = i ? -s : s, amp = lp ? 0.15 : 0.5;
    l.hip.rotation.x = ph * amp;
    l.knee.rotation.x = Math.max(0, (i ? c : -c)) * (lp ? 0.2 : 0.7);
  }
  z.hips.position.y = 0.86 - Math.abs(s) * 0.03 - (limp0 || limp1 ? Math.max(0, limp0 ? s : -s) * 0.08 : 0);
  z.body.rotation.z = (limp0 ? -0.12 : limp1 ? 0.12 : 0) + s * 0.05;
  if (z.type === 'runner') {
    // Renner: nach vorne gebeugt, Arme pumpen
    z.body.rotation.x = THREE.MathUtils.damp(z.body.rotation.x, 0.38, 6, dt);
    for (let i = 0; i < 2; i++) { const a = z.arms[i]; a.shoulder.rotation.x = -0.35 + (i ? -s : s) * 0.9; a.shoulder.rotation.z = a.side * -0.15; a.elbow.rotation.x = -1.2; }
  } else {
    for (let i = 0; i < 2; i++) { const a = z.arms[i]; a.shoulder.rotation.x = -1.35 + (i ? s : -s) * 0.12; a.shoulder.rotation.z = (a.side) * -0.08; a.elbow.rotation.x = -0.2; }
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
  for (let i = 0; i < z.arms.length; i++) { const a = z.arms[i]; a.shoulder.rotation.x = -1.6 + (i ? s : -s) * 0.6; a.elbow.rotation.x = -0.3 - Math.max(0, i ? -s : s) * 0.8; }
  for (let _k = 0; _k < z.legs.length; _k++) { const l = z.legs[_k]; l.hip.rotation.x *= 0.9; l.knee.rotation.x *= 0.9; }
}
function animateAttack(z, dt) {
  const t = 1 - Math.max(0, z.attackT) / 1.3; // 0..1 Schlagphase
  const swing = Math.sin(Math.min(1, t * 1.6) * Math.PI);
  if (z.attackVariant === 1 && !z.crawl) {
    // Biss: packt zu und stößt mit dem Kopf nach vorne
    for (let _k = 0; _k < z.arms.length; _k++) { const a = z.arms[_k]; a.shoulder.rotation.x = -1.5; a.shoulder.rotation.z = a.side * 0.35; a.elbow.rotation.x = -0.9; }
    z.body.rotation.x = THREE.MathUtils.damp(z.body.rotation.x, 0.15 + swing * 0.45, 10, dt);
    z.neck.rotation.x = 0.25 + swing * 0.5;
  } else {
    for (let i = 0; i < z.arms.length; i++) { const a = z.arms[i]; a.shoulder.rotation.x = -1.2 - swing * 1.2 * (i ? 1 : 0.6); a.elbow.rotation.x = -0.6 + swing * 0.5; a.shoulder.rotation.z = 0; }
    z.body.rotation.x = THREE.MathUtils.damp(z.body.rotation.x, z.crawl ? 1.45 : 0.2 + swing * 0.2, 8, dt);
    z.neck.rotation.x = THREE.MathUtils.damp(z.neck.rotation.x, 0.25, 8, dt);
  }
  for (let _k = 0; _k < z.legs.length; _k++) { const l = z.legs[_k]; l.hip.rotation.x *= 0.85; l.knee.rotation.x *= 0.85; }
}

export function updateZombies(dt, head, opts = {}) {
  const player = new THREE.Vector3(head.x, 0, head.z);
  planBudget = 2;
  // Platzer explodieren (verzögert, damit Ketten-Explosionen nicht mitten im Schaden passieren)
  while (pendingBlasts.length) {
    const z = pendingBlasts.shift();
    const at = z.root.position.clone().setY(0.9 * z.scale);
    burst(at, 0x8dff3a, 40);
    burst(at, 0x3a5a10, 24);
    shockwave(at.clone().setY(0.1));
    SFX3D.bang(at);
    z.root.visible = false;
    z.gibbed = true;
    const results = explosionDamage(at, 2.3, 150);
    if (hooks.explode) hooks.explode(at, results, z);
  }
  updateSpits(dt, head, opts);
  for (let i = zombies.length - 1; i >= 0; i--) updateOne(i, dt, head, opts, player);
  for (let k = 0; k < zombies.length; k++) if (zombies[k].monster) syncMonster(zombies[k]); // Monster-Modell des Riesen folgt der fertigen Haltung
  for (let i = limbs.length - 1; i >= 0; i--) {
    limbs[i].t -= dt;
    if (limbs[i].t <= 0) { removeDynamic(limbs[i].phys); limbs[i].obj.scale.setScalar(0.0001); limbs[i].obj.updateMatrixWorld(true); scene.remove(limbs[i].obj); limbs.splice(i, 1); }
  }
}
// Ein Zombie pro Aufruf (Leistung: kleine Funktion → wird vom Browser optimiert; die große Schleife wurde es nie)
function updateOne(i, dt, head, opts, player) {
  const z = zombies[i];
  if (!z) return; // Liste kann sich während des Updates ändern
  if (z.T.boss) { if (bossHooks.update) bossHooks.update(z, dt, head, opts); return; }
  z.hurtT = Math.max(0, z.hurtT - dt);
  if (z.stagger > 0) z.stagger -= dt;
  if (z.state === 'dead') {
    z.deadT += dt;
    // erschlafft: Arme sinken, Knie knicken, Kopf fällt
    for (let _k = 0; _k < z.arms.length; _k++) { const a = z.arms[_k]; a.shoulder.rotation.x *= 0.9; a.elbow.rotation.x *= 0.9; }
    for (let k = 0; k < z.legs.length; k++) { const l = z.legs[k]; l.knee.rotation.x = THREE.MathUtils.damp(l.knee.rotation.x, 0.5 + k * 0.3, 4, dt); }
    z.neck.rotation.x = THREE.MathUtils.damp(z.neck.rotation.x, 0.9, 4, dt);
    z.jaw.rotation.x = 0.45;
    if (z.gibbed) { if (z.deadT > 0.5) { scene.remove(z.root); freeZombie(z); zombies.splice(i, 1); } return; } // zerplatzt: keine Leiche
    if (animateDeath(z, dt)) { scene.remove(z.root); freeZombie(z); zombies.splice(i, 1); }
    return;
  }
  if (z.frozenT > 0) { // erstarrt
    z.frozenT -= dt;
    if (z.frozenT <= 0 && z.ice) z.ice.visible = false;
    return;
  }
  z.groanT -= dt;
  if (z.groanT <= 0) { z.groanT = rand(2.5, 6); SFX3D.groan(z.skull.getWorldPosition(tmpV2), 1 / z.scale, z.type); }
  let speed = z.speed * (z.crawl ? 0.35 : z.legHp[0] < 30 || z.legHp[1] < 30 ? 0.55 : 1);
  if (z.stagger > 0 && (z.state === 'walk' || z.state === 'attack')) speed = 0; // taumelt
  const o = z.opening;
  if (z.state === 'rise') {
    z.root.position.y = Math.min(0, z.root.position.y + dt * 0.9);
    faceTowards(z, player, dt);
    for (let k = 0; k < z.arms.length; k++) { const a = z.arms[k]; a.shoulder.rotation.x = -2.6 + Math.sin(z.phase += dt * 3) * 0.3 * (k ? 1 : -1); }
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
      for (let k = 0; k < z.arms.length; k++) { const a = z.arms[k]; a.shoulder.rotation.x = -2.2 + Math.sin(t * 12 + k) * 0.4; }
      for (let k = 0; k < z.legs.length; k++) { const l = z.legs[k]; l.hip.rotation.x = -Math.sin(t * Math.PI) * 1.2 + k * 0.3; l.knee.rotation.x = 1.0; }
    } else animateWalk(z, dt, speed);
    if (t >= 1) { z.state = 'walk'; z.root.position.y = 0; z.pathT = 0; if (z.type === 'runner') SFX3D.scream(z.skull.getWorldPosition(tmpV2)); }
  } else if ((z.state === 'walk' || z.state === 'attack') && z.knockT > 0) {
    // umgeworfen: fällt hin, bleibt kurz liegen, steht wieder auf
    z.knockT -= dt;
    const k = z.knockT;
    const down = k > 1.6 ? (2.2 - k) / 0.6 : k > 0.7 ? 1 : k / 0.7;
    z.body.rotation.x = 1.45 * z.knockBack * THREE.MathUtils.smoothstep(down, 0, 1);
    z.body.position.y = 0.05 * down;
    for (let i = 0; i < z.arms.length; i++) { const a = z.arms[i]; a.shoulder.rotation.x = -0.4 - (i ? 0.6 : 0.2) * down; a.elbow.rotation.x = -0.3; }
    if (z.knockT <= 0) { z.knockT = 0; z.body.rotation.x = 0.12; }
  } else if (z.state === 'spit') {
    // Spucker: bleibt stehen, holt aus und spuckt Säure
    z.actionT -= dt;
    faceTowards(z, player, dt, 8);
    const k = 1 - Math.max(0, z.actionT) / 0.9;
    z.neck.rotation.x = k < 0.55 ? 0.25 - k * 1.4 : 0.25 + (k - 0.55) * 2.2;
    z.jaw.rotation.x = 0.2 + k * 0.7;
    if (!z.spat && k > 0.6) { z.spat = true; launchSpit(z, head); }
    if (z.actionT <= 0) { z.state = 'walk'; z.neck.rotation.x = 0.25; }
  } else if (z.state === 'walk' || z.state === 'attack') {
    // Lockvogel (Trommel-Affe): alle Zombies im Raum laufen zu ihm statt zum Spieler
    const lured = lure.active;
    const tgt = lured ? lure.pos : player;
    if (lured && z.lureV !== lure.v) { z.lureV = lure.v; z.pathT = 0; }
    const dist = hyp(tgt.x - z.pos.x, tgt.z - z.pos.z);
    const reach = lured ? 0.55 : z.crawl ? 0.7 : 0.8;
    if (z.T.spit && !z.crawl && z.state === 'walk' && !lured) {
      z.spitT = (z.spitT ?? rand(1.5, 3)) - dt;
      if (z.spitT <= 0 && dist > 1.8 && dist < 6.5 && clearLine(z.pos, player)) { z.spitT = rand(4, 6.5); z.state = 'spit'; z.actionT = 0.9; z.spat = false; SFX3D.groan(z.skull.getWorldPosition(tmpV2), 1.4); return; }
    }
    if (z.T.explode && dist < 1.1 && !z.crawl && !lured) {
      // Platzer: bläht sich auf und explodiert neben dem Spieler
      z.fuseT = (z.fuseT ?? 0.9) - dt;
      const sw = 1 + (0.9 - z.fuseT) * 0.35;
      if (z.belly) z.belly.scale.set(1.25 * sw, 1.15 * sw, 1.2 * sw);
      if (Math.random() < dt * 12) burst(z.skull.getWorldPosition(tmpV2), 0x8dff3a, 2);
      if (z.fuseT <= 0) { z.hp = 0; kill(z, new THREE.Vector3(0, 0, 1)); return; }
    }
    if (dist < reach) {
      z.state = 'attack';
      faceTowards(z, tgt, dt, 8);
      if (!(z.stagger > 0)) z.attackT -= dt; // taumelnd kein Angriff
      animateAttack(z, dt);
      if (z.attackT <= 0) {
        z.attackT = 1.3 / z.atkK;
        z.attackVariant = Math.random() < 0.4 ? 1 : 0;
        SFX3D.swing(z.skull.getWorldPosition(tmpV2));
        if (Math.random() < 0.6) SFX3D.growl(z.skull.getWorldPosition(tmpV2), z.type);
        const armsLeft = z.armLost.filter(x => !x).length;
        if (!opts.harmless && armsLeft > 0 && !lured) onPlayerHit(z.T.dmg * (z.dmgK || 1) * (z.crawl ? 0.7 : 1) * (armsLeft === 2 ? 1 : 0.6), z);
      }
    } else {
      z.state = 'walk';
      z.attackT = Math.min(z.attackT, 0.5);
      z.pathT -= dt;
      // feststecken erkennen: kaum vorwärts gekommen → sofort neu planen (auch über das Budget hinaus)
      z.stuckT += dt;
      if (z.stuckT > 0.7) {
        const moved = hyp(z.pos.x - z.stuckX, z.pos.z - z.stuckZ);
        if (moved < 0.12 * speed / Math.max(0.2, z.speed)) { z.stuckN++; z.pathT = 0; if (z.stuckN >= 3) unstick(z); } else z.stuckN = 0;
        z.stuckT = 0; z.stuckX = z.pos.x; z.stuckZ = z.pos.z;
      }
      if ((z.pathT <= 0 || !z.path || !z.path.length) && (planBudget > 0 || z.stuckN > 0)) { planBudget--; z.path = findPath(z.pos, tgt); z.pathT = rand(0.5, 0.9); }
      if (!z.path) z.path = [tgt.clone()];
      while (z.path.length > 1 && z.path[0].distanceTo(tmpV.set(z.pos.x, 0, z.pos.z)) < 0.2) z.path.shift();
      // Abkürzung: ist der übernächste Punkt schon frei sichtbar, direkt dorthin
      z.skipT -= dt;
      if (z.skipT <= 0) { z.skipT = 0.25; if (z.path.length > 1 && lineFree(z.pos, z.path[1])) z.path.shift(); }
      const next = z.path[0] || tgt;
      faceTowards(z, next, dt);
      moveTowards(z, next, speed, dt);
      animateWalk(z, dt, speed);
    }
  }
  // Abstand zu anderen Zombies
  if (z.state === 'walk' || z.state === 'attack') {
    for (let k = 0; k < zombies.length; k++) { // (Index-Schleife: kein Iterator-Müll)
      const q = zombies[k];
      if (q === z || q.state === 'dead' || (q.state !== 'walk' && q.state !== 'attack')) continue;
      const dx = z.pos.x - q.pos.x, dz = z.pos.z - q.pos.z, d = hyp(dx, dz);
      if (d > 0.001 && d < 0.5) { const push = (0.5 - d) * 0.5; if (walkable(z.pos.x + dx / d * push, z.pos.z + dz / d * push)) { z.pos.x += dx / d * push; z.pos.z += dz / d * push; } }
    }
  }
  // schwere Schritte (Brocken, Riese) und Stampf-Angriff des Riesen
  if ((z.type === 'brute' || z.type === 'giant') && (z.state === 'walk' || z.state === 'outside' || z.state === 'enter') && !z.crawl) {
    const stepPhase = Math.floor(z.phase / Math.PI);
    if (stepPhase !== z.lastStep) { z.lastStep = stepPhase; SFX3D.step(z.root.position.clone(), z.type === 'giant' ? 1.8 : 1.2); if (z.type === 'giant' && onStomp) onStomp(z, false); }
  }
  else if (z.state === 'walk' && !z.crawl) { // schlurfende Schritte
    const stepPhase = Math.floor(z.phase / Math.PI);
    if (stepPhase !== z.lastStep) { z.lastStep = stepPhase; if (Math.random() < 0.35) SFX3D.shuffle(z.root.position.clone()); }
  }
  if (z.type === 'giant' && (z.state === 'walk' || z.state === 'attack')) {
    z.roarT = (z.roarT ?? 2) - dt;
    if (z.roarT <= 0) { z.roarT = rand(7, 12); SFX3D.roar(z.skull.getWorldPosition(tmpV2)); }
    z.stompT = (z.stompT ?? 4) - dt;
    const dPl = hyp(player.x - z.pos.x, player.z - z.pos.z);
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

// ---- Spucker: Säure-Klumpen (fliegen im Bogen, man kann ausweichen) ----------------------
const spitGeo = cachedGeo('zspit', () => new THREE.SphereGeometry(0.045, 10, 8));
// freie Sicht in Kopfhöhe: nur echte Wände blockieren (über Tische kann man spucken)
function clearLine(a, b) {
  for (const w of surfacesOf('wall')) {
    const p1 = w.a, p2 = w.a.clone().addScaledVector(w.right, w.width);
    const d1x = b.x - a.x, d1z = b.z - a.z, d2x = p2.x - p1.x, d2z = p2.z - p1.z;
    const den = d1x * d2z - d1z * d2x;
    if (Math.abs(den) < 1e-6) continue;
    const t = ((p1.x - a.x) * d2z - (p1.z - a.z) * d2x) / den, u = ((p1.x - a.x) * d1z - (p1.z - a.z) * d1x) / den;
    if (t > 0.02 && t < 0.98 && u > 0 && u < 1) return false;
  }
  return true;
}
function launchSpit(z, head) {
  const from = z.skull.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -0.04, 0));
  const target = head.clone().add(new THREE.Vector3(0, -0.1, 0));
  const T = Math.max(0.5, from.distanceTo(target) / 7); // Flugzeit
  const vel = target.clone().sub(from).divideScalar(T);
  vel.y += 0.5 * 6 * T; // Schwerkraft ausgleichen
  const m = new THREE.Mesh(spitGeo, acidMat);
  m.position.copy(from);
  const glow = new THREE.Sprite(EYE_GLOW[3]);
  glow.scale.setScalar(0.22);
  m.add(glow);
  scene.add(m);
  spits.push({ obj: m, vel, life: 3, z });
  SFX3D.splat(from);
}
function updateSpits(dt, head, opts) {
  for (let i = spits.length - 1; i >= 0; i--) {
    const sp = spits[i];
    sp.life -= dt;
    sp.vel.y -= 6 * dt;
    sp.obj.position.addScaledVector(sp.vel, dt);
    if (Math.random() < dt * 20) burst(sp.obj.position.clone(), 0x8dff3a, 1);
    const hitPlayer = sp.obj.position.distanceTo(head) < 0.32;
    if (hitPlayer || sp.obj.position.y < 0.03 || sp.life <= 0) {
      burst(sp.obj.position.clone(), 0x8dff3a, 14);
      scene.remove(sp.obj);
      spits.splice(i, 1);
      if (hitPlayer && !opts.harmless) { onPlayerHit(14, sp.z); if (hooks.spitHit) hooks.spitHit(); }
    }
  }
}
// Frostwerfer: Zombie erstarrt zu Eis (ein Treffer zerschmettert ihn dann)
const iceMat = new THREE.MeshStandardMaterial({ color: 0xbfe8ff, emissive: 0x3a7aa0, emissiveIntensity: 0.6, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.55, depthWrite: false });
export function freezeZombie(z, t = 5) {
  if (z.state === 'dead') return;
  if (z.T.boss) t = Math.min(t, 1.2); // Boss friert nur kurz ein
  z.frozenT = Math.max(z.frozenT || 0, t);
  if (!z.ice) {
    z.ice = new THREE.Group();
    z.ice.add(mesh(capGeo(0.2, 0.9), iceMat, 0, 0.9, 0, null, z.T.width, 1, 0.8));
    z.ice.add(mesh(sphGeo(0.16), iceMat, 0, 1.55, 0.03));
    z.root.add(z.ice);
  }
  z.ice.visible = true;
}
export function clearSpits() { for (const sp of spits.splice(0)) scene.remove(sp.obj); pendingBlasts.length = 0; }
