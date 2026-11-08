import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// Physik-Welt (cannon-es): Boden, echte Wände/Tische als statische Körper,
// Waffen, Magazine, Dosen und umfallende Ziele als dynamische Körper.
export const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
world.allowSleep = true;
world.broadphase = new CANNON.SAPBroadphase(world);
world.defaultContactMaterial.friction = 0.45;
world.defaultContactMaterial.restitution = 0.15;

const ground = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(ground);

export const dynamics = []; // { body, obj, onLost, onImpact }

// Box-Form aus der Bounding-Box eines Objekts (in dessen eigenem Koordinatensystem)
export function localBoxOf(obj) {
  const parent = obj.parent;
  const pos = obj.position.clone(), quat = obj.quaternion.clone(), scl = obj.scale.clone();
  if (parent) parent.remove(obj);
  obj.position.set(0, 0, 0);
  obj.quaternion.identity();
  obj.scale.set(1, 1, 1);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  obj.position.copy(pos);
  obj.quaternion.copy(quat);
  obj.scale.copy(scl);
  if (parent) parent.add(obj);
  return box;
}

// Fügt ein Objekt (direktes Kind der Szene) als dynamischen Körper hinzu.
export function addDynamic(obj, box, mass, opts = {}) {
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const shape = opts.cylinder
    ? new CANNON.Cylinder(opts.cylinder.r, opts.cylinder.r, opts.cylinder.h, 12)
    : new CANNON.Box(new CANNON.Vec3(Math.max(0.005, size.x / 2), Math.max(0.005, size.y / 2), Math.max(0.005, size.z / 2)));
  const body = new CANNON.Body({ mass, linearDamping: 0.05, angularDamping: 0.2, sleepSpeedLimit: 0.15, sleepTimeLimit: 0.6 });
  body.addShape(shape, new CANNON.Vec3(center.x, center.y, center.z));
  body.position.set(obj.position.x, obj.position.y, obj.position.z);
  body.quaternion.set(obj.quaternion.x, obj.quaternion.y, obj.quaternion.z, obj.quaternion.w);
  if (opts.vel) body.velocity.set(opts.vel.x, opts.vel.y, opts.vel.z);
  if (opts.angVel) body.angularVelocity.set(opts.angVel.x, opts.angVel.y, opts.angVel.z);
  world.addBody(body);
  const entry = { body, obj, onLost: opts.onLost, onImpact: opts.onImpact, lastImpact: 0 };
  if (opts.onImpact) {
    body.addEventListener('collide', (e) => {
      const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
      const now = performance.now();
      if (v > 0.8 && now - entry.lastImpact > 120) { entry.lastImpact = now; opts.onImpact(v); }
    });
  }
  dynamics.push(entry);
  return entry;
}

export function removeDynamic(entry) {
  if (!entry) return;
  world.removeBody(entry.body);
  const i = dynamics.indexOf(entry);
  if (i >= 0) dynamics.splice(i, 1);
}

export function applyImpulse(entry, impulse, worldPoint) {
  entry.body.wakeUp();
  entry.body.applyImpulse(new CANNON.Vec3(impulse.x, impulse.y, impulse.z),
    new CANNON.Vec3(worldPoint.x, worldPoint.y, worldPoint.z));
}

// Statischer Quader (für Wände, Tische, Stühle, Waffenbank)
export function addStaticBox(center, half, quat) {
  const body = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Box(new CANNON.Vec3(half.x, half.y, half.z)) });
  body.position.set(center.x, center.y, center.z);
  if (quat) body.quaternion.set(quat.x, quat.y, quat.z, quat.w);
  world.addBody(body);
  return body;
}
export const removeStatic = (body) => world.removeBody(body);

export function stepPhysics(dt) {
  world.step(1 / 90, dt, 4);
  for (let i = dynamics.length - 1; i >= 0; i--) {
    const e = dynamics[i];
    const b = e.body;
    e.obj.position.set(b.position.x, b.position.y, b.position.z);
    e.obj.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    if (b.position.y < -1.5 && e.onLost) e.onLost(e);
  }
}
