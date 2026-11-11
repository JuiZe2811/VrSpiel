// Riese mit eigenem 3D-Modell (Monster): Das Modell folgt dem unsichtbaren Baukasten-Skelett des Riesen.
// So laufen alle bisherigen Animationen (Gehen, Schlagen, Stampfen, Umfallen) und Trefferzonen unverändert weiter –
// sichtbar ist nur das Monster. Das Modell hat keine Textur: Hautfarbe, Flecken und Blut werden als Vertex-Farben erzeugt.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

let template = null, monsterMat = null;
export const giantModelReady = () => !!template;
export function giantWarmup() { const m = cloneSkinned(template); m.traverse(o => { if (o.isMesh) o.frustumCulled = false; }); return m; }
export function loadGiantModel() {
  new GLTFLoader().load('models/giant.glb', (g) => {
    const t = g.scene;
    t.traverse(o => {
      if (!o.isSkinnedMesh) return;
      paint(o.geometry);
      o.frustumCulled = false;
      o.castShadow = true;
    });
    monsterMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    t.traverse(o => { if (o.isSkinnedMesh) o.material = monsterMat; });
    t.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(t);
    t.userData.height = box.max.y - box.min.y;
    template = t;
  }, undefined, () => { template = null; });
}

// ---- Hautfarbe: fahles Grün-Grau, dunkle Flecken, Blut, hellerer Bauch ------------------------
function hash(x, y, z) { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const f = (t) => t * t * (3 - 2 * t), u = f(xf), v = f(yf), w = f(zf);
  const L = (a, b, t) => a + (b - a) * t;
  return L(L(L(hash(xi, yi, zi), hash(xi + 1, yi, zi), u), L(hash(xi, yi + 1, zi), hash(xi + 1, yi + 1, zi), u), v),
           L(L(hash(xi, yi, zi + 1), hash(xi + 1, yi, zi + 1), u), L(hash(xi, yi + 1, zi + 1), hash(xi + 1, yi + 1, zi + 1), u), v), w);
}
function paint(geo) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  geo.computeBoundingBox();
  const bb = geo.boundingBox, H = bb.max.y - bb.min.y;
  const col = new Float32Array(p.count * 3);
  const skin = new THREE.Color(0x8b957a), dark = new THREE.Color(0x4a5338), blood = new THREE.Color(0x5e1712), pale = new THREE.Color(0xb4b49a), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / H, y = (p.getY(i) - bb.min.y) / H, z = p.getZ(i) / H;
    const n1 = vnoise(x * 9, y * 9, z * 9) * 0.6 + vnoise(x * 23, y * 23, z * 23) * 0.4;
    const n2 = vnoise(x * 6 + 7, y * 6, z * 6 - 3);
    c.copy(skin).lerp(dark, Math.max(0, n1 - 0.35) * 1.4);
    // Bauch/Brust vorne heller
    if (n && n.getZ(i) > 0.4 && y > 0.35 && y < 0.7) c.lerp(pale, (n.getZ(i) - 0.4) * 0.5);
    // Blut: Flecken, vor allem um den Mund und an den Krallen
    const mouth = y > 0.78 && z > 0.05 ? 0.35 : 0;
    const hands = y < 0.42 && Math.abs(x) > 0.3 ? 0.3 : 0;
    const b = Math.max(0, n2 - 0.68 + mouth + hands) * 2.2;
    if (b > 0) c.lerp(blood, Math.min(0.85, b));
    // Füße/Unterseite etwas dunkler (Schmutz)
    if (y < 0.12) c.lerp(dark, (0.12 - y) * 4);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

// ---- Anbringen und Mitbewegen ---------------------------------------------------------------
const HIDDEN = new THREE.MeshBasicMaterial({ visible: false });
const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
function relQ(obj, rootInv, out) { _m.multiplyMatrices(rootInv, obj.matrixWorld).decompose(_p, out, _s); return out; }
function relP(obj, rootInv, out) { return out.setFromMatrixPosition(_m.multiplyMatrices(rootInv, obj.matrixWorld)); }

export function attachMonster(z) {
  if (!template) return false;
  const root = z.root;
  root.updateMatrixWorld(true);
  // Ruhehaltung des Baukasten-Skeletts merken (vor dem ersten Bild)
  const pos0 = root.position.clone(), rot0 = root.rotation.clone(), sc0 = root.scale.clone();
  root.position.set(0, 0, 0); root.rotation.set(0, 0, 0); root.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4();
  const procBox = new THREE.Box3();
  root.traverse(o => { if (o.isMesh && o.userData.part && o.visible) procBox.expandByObject(o); });
  // Baukasten-Körper unsichtbar machen (bleibt für Treffer und Physik erhalten)
  root.traverse(o => {
    if (o.isSprite) o.visible = false;
    else if (o.isMesh) { o.material = Array.isArray(o.material) ? o.material.map(() => HIDDEN) : HIDDEN; o.castShadow = false; }
  });
  // Monster einsetzen, auf die Höhe des Riesen skaliert
  const model = cloneSkinned(template);
  const k = (procBox.max.y - Math.max(0, procBox.min.y)) / template.userData.height * 1.02;
  model.scale.setScalar(k);
  root.add(model);
  root.updateMatrixWorld(true);
  const bones = {};
  model.traverse(o => { if (o.isBone) bones[o.name] = o; });
  // Zuordnung Monster-Knochen ← Baukasten-Gruppe (Seite über die x-Position bestimmen)
  const side = (name) => Math.sign(relP(bones[name], rootInv, new THREE.Vector3()).x);
  const arm = (sgn) => z.arms.find(a => Math.sign(a.shoulder.getWorldPosition(new THREE.Vector3()).x) === sgn);
  const leg = (sgn) => z.legs.find(l => Math.sign(l.hip.getWorldPosition(new THREE.Vector3()).x) === sgn);
  const map = [['root', z.hips], ['spine_02', z.torso], ['neck', z.neck], ['head', z.head], ['jaw', z.jaw]];
  for (const S of ['L', 'R']) {
    const sa = side('upper_arm_01' + S), sl = side('thigh_01' + S);
    const a = arm(sa), l = leg(sl);
    if (a) map.push(['upper_arm_01' + S, a.shoulder, 'forearm_01' + S], ['forearm_01' + S, a.elbow, 'hand' + S]);
    if (l) map.push(['thigh_01' + S, l.hip, 'shin_01' + S], ['shin_01' + S, l.knee, 'foot' + S]);
  }
  const links = [];
  for (const [bn, src, childBn] of map) {
    const dst = bones[bn];
    if (!dst || !src) continue;
    const L = { dst, src, srcRest: relQ(src, rootInv, new THREE.Quaternion()).invert(), dstRest: relQ(dst, rootInv, new THREE.Quaternion()), corr: new THREE.Quaternion() };
    // Gliedmaßen: Ruhe-Richtung des Monsters (A-Pose) auf die Ruhe-Richtung des Baukastens (hängend) drehen
    if (childBn && bones[childBn]) {
      const dDir = relP(bones[childBn], rootInv, new THREE.Vector3()).sub(relP(dst, rootInv, new THREE.Vector3())).normalize();
      L.corr.setFromUnitVectors(dDir, new THREE.Vector3(0, -1, 0)); // Baukasten-Glieder hängen in Ruhe senkrecht
    }
    links.push(L);
  }
  // Hierarchie-Reihenfolge der Monster-Knochen (Eltern zuerst)
  const order = [];
  bones.root.traverse(o => { if (o.isBone) order.push(o); });
  const byDst = new Map(links.map(L => [L.dst, L]));
  const rootParentQ = relQ(bones.root.parent, rootInv, new THREE.Quaternion());
  const rootParentInvM = new THREE.Matrix4().multiplyMatrices(rootInv, bones.root.parent.matrixWorld).invert();
  const hipsRest = relP(z.hips, rootInv, new THREE.Vector3());
  const rootBoneRest = relP(bones.root, rootInv, new THREE.Vector3());
  const restLocal = new Map(order.map(b => [b, b.quaternion.clone()]));
  z.monster = { model, bones, order, byDst, rootParentQ, rootParentInvM, hipsRest, rootBoneRest, restLocal, wq: new Map() };
  root.position.copy(pos0); root.rotation.copy(rot0); root.scale.copy(sc0);
  root.updateMatrixWorld(true);
  return true;
}

// nach der Zombie-Animation aufrufen: Monster-Knochen folgen dem Baukasten-Skelett
const _rootInv = new THREE.Matrix4(), _d = new THREE.Quaternion(), _w = new THREE.Quaternion(), _hp = new THREE.Vector3();
export function syncMonster(z) {
  const M = z.monster;
  if (!M || !z.root.visible) return;
  z.root.updateMatrixWorld(true);
  _rootInv.copy(z.root.matrixWorld).invert();
  const wq = M.wq;
  for (const b of M.order) {
    const parentW = b === M.bones.root ? M.rootParentQ : wq.get(b.parent);
    const L = M.byDst.get(b);
    if (L) {
      // gewünschte Ausrichtung = (Bewegung der Baukasten-Gruppe seit Ruhe) · Korrektur · Monster-Ruhe
      relQ(L.src, _rootInv, _d).multiply(L.srcRest);
      const w = (wq.get(b) || new THREE.Quaternion()).copy(_d).multiply(L.corr).multiply(L.dstRest);
      wq.set(b, w);
      b.quaternion.copy(parentW).invert().multiply(w);
    } else {
      const w = (wq.get(b) || new THREE.Quaternion()).copy(parentW).multiply(M.restLocal.get(b));
      wq.set(b, w);
    }
  }
  // Becken-Verschiebung (Ducken, Umfallen, Kriechen)
  relP(z.hips, _rootInv, _hp).sub(M.hipsRest).add(M.rootBoneRest).applyMatrix4(M.rootParentInvM);
  M.bones.root.position.copy(_hp);
}
