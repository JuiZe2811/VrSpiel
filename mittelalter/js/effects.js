import * as THREE from 'three';
import { makePanel } from './util.js?v=3';
import { heightAt } from './room.js?v=3';
import { SFX } from './sfx.js?v=3';

// Kurzlebige Effekte: Leuchtspuren, Partikel, Punkte-Text, Einschusslöcher, Hülsen
let scene;
export const headRef = new THREE.Vector3(0, 1.6, 0);
export function initEffects(s) { scene = s; }

const effects = [];
const debris = [];

// Leuchtspur: dünner leuchtender Zylinder (Linien sind in VR nur 1 Pixel breit)
const tracerGeo = new THREE.CylinderGeometry(0.0025, 0.0025, 1, 5, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
export function spawnTracer(from, to) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const m = new THREE.Mesh(tracerGeo, mat);
  m.position.copy(from);
  m.lookAt(to);
  m.scale.set(1, 1, from.distanceTo(to));
  scene.add(m);
  effects.push({ obj: m, life: 0.07, maxLife: 0.07, keepGeo: true, update(dt, k) { mat.opacity = 0.85 * k; }, dispose() { mat.dispose(); } });
}

// Railgun-Strahl: dicker, leuchtender Strahl, der kurz nachglüht
export function spawnBeam(from, to, color = 0x66e0ff) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const m = new THREE.Mesh(tracerGeo, mat);
  m.position.copy(from);
  m.lookAt(to);
  m.scale.set(6, 6, from.distanceTo(to));
  scene.add(m);
  effects.push({ obj: m, life: 0.35, maxLife: 0.35, keepGeo: true, update(dt, k) { mat.opacity = 0.95 * k; m.scale.x = m.scale.y = 6 * k + 1; }, dispose() { mat.dispose(); } });
}
// weiche Rauch-/Staubwolke (Sprite)
const puffTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
  g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.5, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
export function puff(pos, color = 0xbbbbbb, size = 0.12, life = 0.9, rise = 0.25, opacity = 0.45) {
  const mat = new THREE.SpriteMaterial({ map: puffTex, color, transparent: true, opacity, depthWrite: false });
  const sp = new THREE.Sprite(mat);
  sp.position.copy(pos);
  sp.scale.setScalar(size);
  sp.material.rotation = Math.random() * 6;
  scene.add(sp);
  const drift = new THREE.Vector3((Math.random() - 0.5) * 0.1, rise, (Math.random() - 0.5) * 0.1);
  effects.push({ obj: sp, life, maxLife: life, keepGeo: true, update(dt, k) { sp.position.addScaledVector(drift, dt); sp.scale.setScalar(size * (1 + (1 - k) * 2.5)); mat.opacity = opacity * k; mat.rotation += dt * 0.5; }, dispose() { mat.dispose(); } });
}
// Funken bei Treffern auf harte Flächen
const sparkGeo = new THREE.BoxGeometry(0.006, 0.006, 0.03);
export function sparks(pos, normal, count = 8) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffd060, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(sparkGeo, mat);
    m.position.copy(pos);
    const v = normal.clone().multiplyScalar(THREE.MathUtils.randFloat(1, 3)).add(new THREE.Vector3().randomDirection().multiplyScalar(1.5));
    scene.add(m);
    effects.push({ obj: m, life: 0.35, maxLife: 0.35, keepGeo: true, dispose: i === count - 1 ? () => mat.dispose() : null,
      update(dt, k) { v.y -= 9.8 * dt; m.position.addScaledVector(v, dt); m.lookAt(m.position.clone().add(v)); mat.opacity = k; } });
  }
}

const particleGeo = new THREE.BoxGeometry(0.02, 0.02, 0.02);
// Einstellungen: Blut (0 aus, 1 normal, 2 extra), Partikelmenge, Punkte-Anzeigen
export const fx = { blood: 1, particles: 1, popups: true };
const isBlood = (c) => { const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255; return r > 60 && g < 25 && b < 25; };
// Partikel: ein einziges Punkt-System (1 Zeichenaufruf für alle Splitter, Blut, Funken)
const PMAX = 700;
const pPos = new Float32Array(PMAX * 3), pCol = new Float32Array(PMAX * 3), pVel = new Float32Array(PMAX * 3), pLife = new Float32Array(PMAX), pMax = new Float32Array(PMAX);
let pNext = 0, pPoints = null;
function ensurePoints() {
  if (pPoints) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color', new THREE.BufferAttribute(pCol, 3).setUsage(THREE.DynamicDrawUsage));
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.beginPath(); x.arc(8, 8, 7, 0, Math.PI * 2); x.fill();
  pPoints = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.022, vertexColors: true, map: new THREE.CanvasTexture(c), alphaTest: 0.5, sizeAttenuation: true }));
  pPoints.frustumCulled = false;
  for (let i = 0; i < PMAX; i++) pPos[i * 3 + 1] = -100;
  scene.add(pPoints);
}
const tmpC = new THREE.Color();
export function burst(point, color, count) {
  count = Math.round(count * fx.particles * (isBlood(color) ? fx.blood : 1));
  if (count <= 0) return;
  ensurePoints();
  tmpC.set(color);
  for (let i = 0; i < count; i++) {
    const k = pNext; pNext = (pNext + 1) % PMAX;
    pPos[k * 3] = point.x; pPos[k * 3 + 1] = point.y; pPos[k * 3 + 2] = point.z;
    const v = new THREE.Vector3().randomDirection().multiplyScalar(THREE.MathUtils.randFloat(1, 3));
    pVel[k * 3] = v.x; pVel[k * 3 + 1] = v.y; pVel[k * 3 + 2] = v.z;
    pCol[k * 3] = tmpC.r; pCol[k * 3 + 1] = tmpC.g; pCol[k * 3 + 2] = tmpC.b;
    pLife[k] = pMax[k] = 0.7;
  }
}
function updateParticles(dt) {
  if (!pPoints) return;
  let any = false;
  for (let k = 0; k < PMAX; k++) {
    if (pLife[k] <= 0) continue;
    any = true;
    pLife[k] -= dt;
    if (pLife[k] <= 0) { pPos[k * 3 + 1] = -100; continue; }
    pVel[k * 3 + 1] -= 6 * dt;
    pPos[k * 3] += pVel[k * 3] * dt; pPos[k * 3 + 1] += pVel[k * 3 + 1] * dt; pPos[k * 3 + 2] += pVel[k * 3 + 2] * dt;
    if (pPos[k * 3 + 1] < 0.005) { pPos[k * 3 + 1] = 0.005; pVel[k * 3] *= 0.5; pVel[k * 3 + 2] *= 0.5; pVel[k * 3 + 1] = 0; }
  }
  if (any || pPoints.visible) { pPoints.geometry.attributes.position.needsUpdate = true; pPoints.geometry.attributes.color.needsUpdate = true; }
  pPoints.visible = any;
}

export function floatingText(text, point, color) {
  if (!fx.popups && /^[+]/.test(text)) return;
  const panel = makePanel(0.6, 0.16, 600);
  panel.draw((ctx, w, h) => {
    ctx.font = 'bold 76px system-ui, sans-serif';
    const fit = Math.min(76, Math.floor(76 * (w * 0.94) / Math.max(1, ctx.measureText(text).width)));
    ctx.font = `bold ${fit}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText(text, w / 2, h / 2);
    ctx.fillStyle = color;
    ctx.fillText(text, w / 2, h / 2);
  });
  panel.mesh.position.copy(point);
  panel.mesh.renderOrder = 20;
  panel.mesh.material.depthTest = false;
  panel.mesh.scale.setScalar(Math.max(0.8, point.distanceTo(headRef) / 4));
  panel.mesh.lookAt(headRef);
  scene.add(panel.mesh);
  effects.push({
    obj: panel.mesh, life: 1.1, maxLife: 1.1,
    update(dt, k) {
      panel.mesh.position.y += dt * 0.4;
      panel.mesh.material.opacity = Math.min(1, k * 2);
    },
    dispose() { panel.mesh.material.map.dispose(); panel.mesh.material.dispose(); panel.mesh.geometry.dispose(); }
  });
}

const holeGeo = new THREE.CircleGeometry(0.008, 10);
const holeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
export function bulletHole(mesh, local) {
  const hole = new THREE.Mesh(holeGeo, holeMat);
  hole.position.set(local.x, local.y, 0.002);
  mesh.add(hole);
}

export function updateEffects(dt) {
  updateParticles(dt);
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.life -= dt;
    if (e.life <= 0) {
      scene.remove(e.obj);
      if (e.dispose) e.dispose();
      else if (!e.keepGeo && e.obj.geometry) e.obj.geometry.dispose();
      effects.splice(i, 1);
    } else e.update(dt, e.life / e.maxLife);
  }
}

// Hülsen & Patronen: einfache Flugbahn, landen auf Boden oder Tisch
export function addDebris(obj, vel, life = 4) {
  if (obj.parent !== scene) scene.attach(obj);
  debris.push({ obj, vel, life, ang: new THREE.Vector3().randomDirection().multiplyScalar(18), bounced: 0 });
  if (debris.length > 50) { const d = debris.shift(); scene.remove(d.obj); }
}
export function clearDebris() { for (const d of debris.splice(0)) if (d.obj.parent) d.obj.parent.remove(d.obj); }
export function updateDebris(dt) {
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    d.life -= dt;
    d.vel.y -= 9.81 * dt;
    d.obj.position.addScaledVector(d.vel, dt);
    d.obj.rotation.x += d.ang.x * dt;
    d.obj.rotation.y += d.ang.y * dt;
    d.obj.rotation.z += d.ang.z * dt;
    const floor = heightAt(d.obj.position.x, d.obj.position.z) + 0.005;
    if (d.obj.position.y < floor && d.vel.y < 0) {
      d.obj.position.y = floor;
      d.vel.y *= -0.3;
      d.vel.x *= 0.5; d.vel.z *= 0.5;
      d.ang.multiplyScalar(0.4);
      if (d.bounced < 2 && Math.abs(d.vel.y) > 0.3) SFX.casing();
      d.bounced++;
    }
    if (d.life < 0.5) d.obj.scale.setScalar(Math.max(0.001, d.life / 0.5));
    if (d.life <= 0) { scene.remove(d.obj); debris.splice(i, 1); }
  }
}

// Druckwelle einer Explosion
const waveGeo = new THREE.SphereGeometry(1, 20, 14);
export function shockwave(pos) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const m = new THREE.Mesh(waveGeo, mat);
  m.position.copy(pos);
  scene.add(m);
  effects.push({ obj: m, life: 0.45, maxLife: 0.45, update(dt, k) { m.scale.setScalar(0.2 + (1 - k) * 3.2); mat.opacity = 0.6 * k; }, dispose() { mat.dispose(); } });
  const smoke = new THREE.MeshBasicMaterial({ color: 0x2a2826, transparent: true, opacity: 0.5, depthWrite: false });
  const s = new THREE.Mesh(waveGeo, smoke);
  s.position.copy(pos);
  scene.add(s);
  effects.push({ obj: s, life: 2.2, maxLife: 2.2, update(dt, k) { s.scale.setScalar(0.4 + (1 - k) * 1.6); s.position.y += dt * 0.4; smoke.opacity = 0.5 * k; }, dispose() { smoke.dispose(); } });
}

// Blutlachen / Rußflecken auf dem Boden (bleiben bis zur nächsten Runde)
function splatTex(rgb) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  for (let i = 0; i < 26; i++) {
    const r = 6 + Math.random() * 28, a = Math.random() * Math.PI * 2, d = Math.random() * 34;
    ctx.fillStyle = `rgba(${rgb},${0.5 + Math.random() * 0.45})`;
    ctx.beginPath(); ctx.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, r, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 18; i++) { // Spritzer
    const a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 22;
    ctx.beginPath(); ctx.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 1 + Math.random() * 3, 0, Math.PI * 2); ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const DECAL_MATS = {
  blood: new THREE.MeshBasicMaterial({ map: splatTex('95,0,0'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  scorch: new THREE.MeshBasicMaterial({ map: splatTex('20,18,16'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
};
// Flecken als Instanzen: alle Blut- bzw. Brandflecken zusammen in EINEM Zeichenaufruf (statt einem pro Fleck)
const DECAL_CAP = { blood: 40, scorch: 16 };
const decalSets = {};
const _dm = new THREE.Object3D();
function decalSet(kind) {
  let d = decalSets[kind];
  if (!d) {
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), DECAL_MATS[kind], DECAL_CAP[kind]);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    scene.add(mesh);
    d = decalSets[kind] = { mesh, next: 0 };
  }
  if (!d.mesh.parent) scene.add(d.mesh);
  return d;
}
function addDecal(kind) {
  const d = decalSet(kind);
  _dm.updateMatrix();
  d.mesh.setMatrixAt(d.next, _dm.matrix);
  d.next = (d.next + 1) % DECAL_CAP[kind];          // älteste werden überschrieben
  d.mesh.count = Math.min(DECAL_CAP[kind], d.mesh.count + 1);
  d.mesh.instanceMatrix.needsUpdate = true;
}
export function floorDecal(pos, kind = 'blood', size = 0.7) {
  if (kind === 'blood') { if (!fx.blood) return; size *= fx.blood === 2 ? 1.5 : 1; }
  _dm.position.set(pos.x, heightAt(pos.x, pos.z) + 0.004, pos.z);
  _dm.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
  _dm.scale.setScalar(size);
  addDecal(kind);
}
// Fleck an Wand/Tisch (z. B. Blut hinter einem getroffenen Zombie)
export function surfaceDecal(point, normal, kind = 'blood', size = 0.4) {
  if (kind === 'blood') { if (!fx.blood) return; size *= fx.blood === 2 ? 1.5 : 1; }
  _dm.position.copy(point).addScaledVector(normal, 0.003);
  _dm.rotation.set(0, 0, 0);
  _dm.lookAt(_dm.position.clone().add(normal));
  _dm.rotateZ(Math.random() * Math.PI * 2);
  _dm.scale.setScalar(size);
  addDecal(kind);
}
export function clearDecals() { for (const d of Object.values(decalSets)) { d.mesh.count = 0; d.next = 0; } }
