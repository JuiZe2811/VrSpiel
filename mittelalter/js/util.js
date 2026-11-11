import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Hilfsfunktionen: Text-Panels, Materialien, Geometrie-Bausteine
export function makePanel(widthM, heightM, pxPerM = 600) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(widthM * pxPerM);
  canvas.height = Math.round(heightM * pxPerM);
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(widthM, heightM),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false })
  );
  return { mesh, canvas, ctx, draw(fn) { ctx.clearRect(0, 0, canvas.width, canvas.height); fn(ctx, canvas.width, canvas.height); texture.needsUpdate = true; } };
}
export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
export function panelBg(ctx, w, h, r = 30, border = '#ffcc33') {
  roundRect(ctx, 3, 3, w - 6, h - 6, r);
  ctx.fillStyle = 'rgba(12,16,24,0.85)';
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = border;
  ctx.stroke();
}

// ---- Materialien --------------------------------------------------------
function woodTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8a5129';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 70; i++) {
    const y = Math.random() * 256;
    ctx.strokeStyle = `rgba(${40 + Math.random() * 30},${18 + Math.random() * 12},5,${0.15 + Math.random() * 0.3})`;
    ctx.lineWidth = 0.5 + Math.random() * 2.5;
    ctx.beginPath();
    for (let x = 0; x <= 256; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.03 + i) * 4 + Math.random() * 1.5);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 12);
  return t;
}
function stippleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? '#5a5a5a' : '#a8a8a8';
    ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(60, 60);
  return t;
}
const stipple = stippleTexture();
export const MAT = {
  steel: new THREE.MeshStandardMaterial({ color: 0x2a2d31, metalness: 0.85, roughness: 0.32 }),
  blued: new THREE.MeshStandardMaterial({ color: 0x1d2330, metalness: 0.9, roughness: 0.25 }),
  bright: new THREE.MeshStandardMaterial({ color: 0x9aa1a8, metalness: 1.0, roughness: 0.2 }),
  polymer: new THREE.MeshStandardMaterial({ color: 0x1b1c1e, metalness: 0.05, roughness: 0.7 }),
  grip: new THREE.MeshStandardMaterial({ color: 0x232426, metalness: 0.0, roughness: 0.9, bumpMap: stipple, bumpScale: 1.5 }),
  tan: new THREE.MeshStandardMaterial({ color: 0x8b7d58, metalness: 0.05, roughness: 0.8 }),
  tanGrip: new THREE.MeshStandardMaterial({ color: 0x7d7051, metalness: 0.0, roughness: 0.95, bumpMap: stipple, bumpScale: 1.5 }),
  wood: new THREE.MeshStandardMaterial({ map: woodTexture(), metalness: 0.0, roughness: 0.45 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 1 }),
  black: new THREE.MeshStandardMaterial({ color: 0x070707, roughness: 0.6 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xd4a83a, metalness: 1.0, roughness: 0.25 }),
  copper: new THREE.MeshStandardMaterial({ color: 0xb8673a, metalness: 1.0, roughness: 0.3 }),
  shellRed: new THREE.MeshStandardMaterial({ color: 0xa3161b, roughness: 0.45 }),
  dotGreen: new THREE.MeshBasicMaterial({ color: 0x55ff66, toneMapped: false }),
  dotWhite: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
  dotOrange: new THREE.MeshBasicMaterial({ color: 0xff9a2a, toneMapped: false }),
  glass: new THREE.MeshStandardMaterial({ color: 0x5577aa, metalness: 1, roughness: 0.05, transparent: true, opacity: 0.25, depthWrite: false })
};

// ---- Geometrie-Bausteine (Design-Koordinaten: s = vorwärts, y = oben) -----
export function profileGeo(pts, width, bevel = 0.0015, holes) {
  const shape = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])));
  if (holes) for (const h of holes) shape.holes.push(new THREE.Path(h.map(p => new THREE.Vector2(p[0], p[1]))));
  const depth = Math.max(0.0005, width - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
  g.rotateY(Math.PI / 2);
  g.translate(-depth / 2, 0, 0);
  return g;
}
// Geometrie-Zwischenspeicher: gleiche Formen werden nur einmal erzeugt und geteilt.
// Wichtig gegen Speicherlecks (z. B. eine neue Hülse bei jedem Schuss).
const geoCache = new Map();
export function cachedGeo(key, make) {
  let g = geoCache.get(key);
  if (!g) { g = make(); g.userData.shared = true; geoCache.set(key, g); }
  return g;
}
export const prof = (pts, width, mat, bevel, holes) =>
  new THREE.Mesh(cachedGeo('p' + JSON.stringify([pts, width, bevel, holes]), () => profileGeo(pts, width, bevel, holes)), mat);
export function box(w, h, l, mat, s, y, x = 0) {
  const m = new THREE.Mesh(cachedGeo(`b${w}|${h}|${l}`, () => new THREE.BoxGeometry(w, h, l)), mat);
  m.position.set(x, y, -s);
  return m;
}
export function cylZ(rFront, rRear, len, mat, s, y, x = 0, seg = 20, open = false) {
  const g = cachedGeo(`z${rFront}|${rRear}|${len}|${seg}|${open}`, () => new THREE.CylinderGeometry(rRear, rFront, len, seg, 1, open).rotateX(Math.PI / 2));
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, -s);
  return m;
}
export function cylY(rTop, rBot, len, mat, s, y, x = 0, seg = 16) {
  const m = new THREE.Mesh(cachedGeo(`y${rTop}|${rBot}|${len}|${seg}`, () => new THREE.CylinderGeometry(rTop, rBot, len, seg)), mat);
  m.position.set(x, y, -s);
  return m;
}
export function cylX(r, len, mat, s, y, x = 0, seg = 16) {
  const g = cachedGeo(`x${r}|${len}|${seg}`, () => new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2));
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, -s);
  return m;
}
export function sphere(r, mat, s, y, x = 0) {
  const m = new THREE.Mesh(cachedGeo(`s${r}`, () => new THREE.SphereGeometry(r, 12, 8)), mat);
  m.position.set(x, y, -s);
  return m;
}


// Leistung: alle festen Teile einer Waffe mit gleichem Material zu einem Mesh zusammenfassen
// (bewegliche Teile wie Verschluss, Trommel, Magazin, Zielfernrohr-Linsen bleiben einzeln)
export function mergeStatic(root, parts) {
  const skip = new Set();
  for (const v of Object.values(parts || {})) if (v && v.isMesh) skip.add(v); // einzeln angesprochene Meshes behalten
  // in jeder (auch beweglichen) Gruppe die direkten Kinder je Material zusammenfassen
  const nodes = [];
  root.traverse(o => { if (!o.isMesh && !o.isSprite) nodes.push(o); });
  for (const n of nodes) mergeChildren(n, skip);
}
function mergeChildren(model, skip) {
  const groups = new Map();
  for (const m of [...model.children]) {
    if (!m.isMesh || skip.has(m) || m.material.transparent || Array.isArray(m.material) || m.renderOrder !== 0 || Object.keys(m.userData).length || m.children.length) continue;
    if (!groups.has(m.material)) groups.set(m.material, []);
    groups.get(m.material).push(m);
  }
  for (const [mat, list] of groups) {
    if (list.length < 2) continue;
    const geos = [];
    for (const m of list) {
      m.updateMatrix();
      let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      g.applyMatrix4(m.matrix);
      geos.push(g);
    }
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    for (const m of list) model.remove(m);
    const mm = new THREE.Mesh(merged, mat);
    model.add(mm);
  }
}
