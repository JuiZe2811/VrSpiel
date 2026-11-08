import * as THREE from 'three';
import { makePanel } from './util.js';
import { heightAt } from './room.js';
import { SFX } from './sfx.js';

// Kurzlebige Effekte: Leuchtspuren, Partikel, Punkte-Text, Einschusslöcher, Hülsen
let scene;
export const headRef = new THREE.Vector3(0, 1.6, 0);
export function initEffects(s) { scene = s; }

const effects = [];
const debris = [];

export function spawnTracer(from, to) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const mat = new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.6 });
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  effects.push({ obj: line, life: 0.06, maxLife: 0.06, update(dt, k) { mat.opacity = 0.6 * k; } });
}

const particleGeo = new THREE.BoxGeometry(0.02, 0.02, 0.02);
export function burst(point, color, count) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
  for (let i = 0; i < count; i++) {
    const p = new THREE.Mesh(particleGeo, mat);
    p.position.copy(point);
    const v = new THREE.Vector3().randomDirection().multiplyScalar(THREE.MathUtils.randFloat(1, 3));
    scene.add(p);
    effects.push({
      obj: p, life: 0.7, maxLife: 0.7, keepGeo: true,
      update(dt, k) {
        v.y -= 6 * dt;
        p.position.addScaledVector(v, dt);
        p.rotation.x += dt * 8; p.rotation.y += dt * 6;
        p.scale.setScalar(k);
        mat.opacity = k;
      }
    });
  }
}

export function floatingText(text, point, color) {
  const panel = makePanel(0.6, 0.16, 600);
  panel.draw((ctx, w, h) => {
    ctx.font = 'bold 76px system-ui, sans-serif';
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
    dispose() { panel.mesh.material.map.dispose(); panel.mesh.material.dispose(); }
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
  scene.add(obj);
  debris.push({ obj, vel, life, ang: new THREE.Vector3().randomDirection().multiplyScalar(18), bounced: 0 });
  if (debris.length > 50) { const d = debris.shift(); scene.remove(d.obj); }
}
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
