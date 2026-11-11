// Enemy troops and vehicles: stats, weak spots, damage, simple AI.
// The sim owns them; visuals only reads `state.entities` (see ARCHITECTURE.md).
//
// Hull-local frame: +X right, +Y up (from the ground), −Z forward.

import RAPIER from '@dimforge/rapier3d-compat';
import { Euler, Quaternion, Vector3 } from 'three';
import { JET_REACH_M } from './warhead.js';

// armour is mm of rolled steel equivalent per zone, used against shaped-charge jets.
// blast / frag are how much of the (0..1) blast / fragment intensity turns into health loss.
export const ENTITY_TYPES = {
  infantry: {
    size: [0.5, 1.8, 0.4], blast: 1.0, frag: 1.25, jetBase: 1, armour: { front: 1, side: 1, rear: 1, top: 1 },
    walk: 1.4, run: 5.2, turnRate: 6, accel: 6, hearing: 30, weakSpots: [], cookoff: null, vehicle: false,
  },
  truck: {
    size: [2.5, 2.9, 7.0], blast: 0.9, frag: 0.18, jetBase: 1, armour: { front: 6, side: 3, rear: 3, top: 3 },
    walk: 6, run: 14, turnRate: 0.9, accel: 3.5, hearing: 25, vehicle: true,
    weakSpots: [
      { name: 'engine', position: [0, 1.2, -2.8], radius: 1.0, mult: 1.6 },
      { name: 'fuel', position: [1.2, 0.9, 0.5], radius: 0.8, mult: 2.0 },
    ],
    cookoff: { chance: 0.5, delay: [1.2, 3], kind: 'vehicle', chargeKg: 0.3, radius: 3, fragmentRadius: 10, fragmentLethality: 0.3 },
  },
  apc: {
    size: [3.0, 2.4, 7.0], blast: 0.35, frag: 0.03, jetBase: 0.85, armour: { front: 100, side: 40, rear: 25, top: 15 },
    walk: 5, run: 10, turnRate: 0.8, accel: 3, hearing: 20, turret: 1.5, vehicle: true,
    weakSpots: [
      { name: 'engine', position: [0, 1.2, 2.8], radius: 1.2, mult: 1.8 },
      { name: 'top', position: [0, 2.3, 0], radius: 1.8, mult: 1.4 },
    ],
    cookoff: { chance: 0.75, delay: [1.5, 4], kind: 'ammo', chargeKg: 0.8, radius: 4, fragmentRadius: 18, fragmentLethality: 0.6 },
  },
  tank: {
    size: [3.4, 2.4, 7.0], blast: 0.12, frag: 0, jetBase: 0.7, armour: { front: 700, side: 300, rear: 120, top: 60 },
    walk: 4, run: 6, turnRate: 0.6, accel: 2, hearing: 15, turret: 1.0, vehicle: true,
    weakSpots: [
      { name: 'ammo', position: [0, 1.8, 0], radius: 1.0, mult: 2.5 },
      { name: 'engine', position: [0, 1.3, 3.0], radius: 1.3, mult: 2.2 },
      { name: 'top', position: [0, 2.4, -0.3], radius: 1.6, mult: 1.6 },
    ],
    cookoff: { chance: 0.9, delay: [2, 5], kind: 'ammo', chargeKg: 1.8, radius: 6, fragmentRadius: 25, fragmentLethality: 0.7 },
  },
};

const FIRE_SECONDS = 30;
const PRONE_SECONDS = 8;
const CALM_AFTER = 4;

const _q = new Quaternion();
const _qi = new Quaternion();
const _e = new Euler(0, 0, 0, 'YXZ');
const _loc = new Vector3();

function lcg(seed) {
  let a = seed >>> 0;
  return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
}
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const approach = (cur, want, step) => (Math.abs(want - cur) <= step ? want : cur + Math.sign(want - cur) * step);

/**
 * ctx = { world, level, emit(e), damage (DamageRegistry), registerCollider(handle, id), explode(spec) }
 */
export function createEntities(ctx) {
  const { world, level } = ctx;
  const rand = lcg((level.seed ?? 1) * 7919 + 5);
  const half = level.terrain.size / 2 - 10;
  const list = [];
  const states = [];
  let time = 0;
  let nextId = 0;

  function makeState(e) {
    return {
      id: e.id, kind: e.kind, position: [0, 0, 0], quaternion: [0, 0, 0, 1], velocity: [0, 0, 0],
      size: [...e.def.size], health: 1, status: 'idle', turretYaw: 0, onFire: false, damage: 'none',
      weakSpots: e.def.weakSpots.map((w) => ({ name: w.name, position: [...w.position], radius: w.radius })),
    };
  }

  function spawn(def) {
    const type = ENTITY_TYPES[def.kind];
    const id = `e${nextId++}`;
    const e = {
      id, kind: def.kind, def: type,
      spawn: { x: def.position[0], z: def.position[1], yaw: def.yaw ?? 0 },
      patrol: def.patrol ?? null, idleTime: def.idleTime ?? (type.vehicle ? 2 : 4),
      x: 0, z: 0, y: 0, yaw: 0, speed: 0, pitch: 0, roll: 0,
      health: 1, status: 'idle', destroyed: false, onFire: false, fireUntil: 0, cookoffAt: -1, cookoffDone: false,
      wp: 0, waitUntil: 0, alerted: false, noticeT: 0, reactAfter: 0.6 + rand() * 1.0, calmT: 0,
      mode: 'patrol', proneUntil: 0, fleeHeading: 0, turretYaw: 0, s: null, body: null, collider: null,
    };
    e.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    const [w, h, d] = type.size;
    e.collider = world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(0, h / 2, 0), e.body);
    ctx.registerCollider(e.collider.handle, id);
    e.s = makeState(e);
    list.push(e);
    states.push(e.s);

    ctx.damage.register({
      id,
      radius: Math.max(w, d) / 2,
      bodyHandle: e.body.handle,
      position: () => [e.x, e.y + h / 2, e.z],
      distanceFrom: (p) => boxDistance(e, p),
      applyDamage: (hit) => applyDamage(e, hit),
    });
    place(e);
    return e;
  }

  function place(e) {
    e.x = e.spawn.x; e.z = e.spawn.z; e.yaw = e.spawn.yaw; e.speed = 0; e.turretYaw = 0;
    e.health = 1; e.status = 'idle'; e.destroyed = false; e.onFire = false; e.fireUntil = 0;
    e.cookoffAt = -1; e.cookoffDone = false; e.wp = 0; e.waitUntil = time + rand() * 3;
    e.alerted = false; e.noticeT = 0; e.calmT = 0; e.mode = 'patrol'; e.proneUntil = 0;
    e.reactAfter = 0.6 + rand() * 1.0;
    ground(e);
    sync(e);
  }

  // Sit on the terrain; vehicles tilt with the slope.
  function ground(e) {
    const T = level.terrain;
    if (!e.def.vehicle) { e.y = T.heightAt(e.x, e.z); e.pitch = e.roll = 0; return; }
    const hz = e.def.size[2] / 2, hx = e.def.size[0] / 2;
    const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw), rx = Math.cos(e.yaw), rz = -Math.sin(e.yaw);
    const hF = T.heightAt(e.x + fx * hz, e.z + fz * hz), hB = T.heightAt(e.x - fx * hz, e.z - fz * hz);
    const hR = T.heightAt(e.x + rx * hx, e.z + rz * hx), hL = T.heightAt(e.x - rx * hx, e.z - rz * hx);
    e.y = (hF + hB + hR + hL) / 4;
    e.pitch = Math.atan2(hF - hB, 2 * hz);
    e.roll = Math.atan2(hR - hL, 2 * hx);
  }

  function sync(e) {
    _e.set(e.pitch, e.yaw, e.roll, 'YXZ');
    _q.setFromEuler(_e);
    e.body.setNextKinematicTranslation({ x: e.x, y: e.y, z: e.z });
    e.body.setNextKinematicRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
    e.q = [_q.x, _q.y, _q.z, _q.w];
    const s = e.s;
    s.position[0] = e.x; s.position[1] = e.y; s.position[2] = e.z;
    s.quaternion[0] = _q.x; s.quaternion[1] = _q.y; s.quaternion[2] = _q.z; s.quaternion[3] = _q.w;
    s.velocity[0] = -Math.sin(e.yaw) * e.speed; s.velocity[1] = 0; s.velocity[2] = -Math.cos(e.yaw) * e.speed;
    s.health = Math.max(0, e.health);
    s.status = e.destroyed ? 'destroyed' : e.status;
    s.turretYaw = e.turretYaw;
    s.onFire = e.onFire;
    s.damage = e.destroyed || e.health < 0.35 ? 'heavy' : e.health < 0.7 ? 'light' : 'none';
    if (!e.def.vehicle) s.damage = 'none';
  }

  function toLocal(e, p) {
    _qi.set(e.q[0], e.q[1], e.q[2], e.q[3]).invert();
    return _loc.set(p[0] - e.x, p[1] - e.y, p[2] - e.z).applyQuaternion(_qi);
  }

  function boxDistance(e, p) {
    const l = toLocal(e, p);
    const [w, h, d] = e.def.size;
    const dx = Math.max(0, Math.abs(l.x) - w / 2), dy = Math.max(0, Math.abs(l.y - h / 2) - h / 2), dz = Math.max(0, Math.abs(l.z) - d / 2);
    return Math.hypot(dx, dy, dz);
  }

  function zoneOf(e, l) {
    const [w, h, d] = e.def.size;
    if (l.y > h * 0.85) return 'top';
    if (l.z > d * 0.3) return 'rear';
    if (Math.abs(l.x) > w * 0.3) return 'side';
    return 'front';
  }

  function applyDamage(e, hit) {
    if (e.destroyed) return 0;
    const def = e.def;
    const l = toLocal(e, hit.position).clone();
    const proneInf = !def.vehicle && e.status === 'prone';
    const blastDmg = hit.blast * def.blast * (proneInf ? 0.6 : 1);
    const fragDmg = hit.fragments * def.frag * (proneInf ? 0.4 : 1);
    let jetDmg = 0;
    if (hit.shaped && def.jetBase > 0 && boxDistance(e, hit.position) <= JET_REACH_M) {
      jetDmg = def.jetBase * Math.min(1, hit.penetrationMm / Math.max(1, def.armour[zoneOf(e, l)]));
    }
    let total = blastDmg + fragDmg + jetDmg;
    if (total <= 0.001) return 0;

    let weak = null, mult = 1;
    if (jetDmg > 0 || hit.blast > 0.3) {
      for (const w of def.weakSpots) {
        const d = Math.hypot(l.x - w.position[0], l.y - w.position[1], l.z - w.position[2]);
        if (d <= w.radius + 0.8 && w.mult > mult) { mult = w.mult; weak = w.name; }
      }
    }
    // Weak spots matter most for the shaped-charge jet; plain blast only gets a fraction of the bonus.
    if (jetDmg <= 0) mult = 1 + (mult - 1) * 0.4;
    total = Math.min(1.2, total * mult);
    const dealt = Math.min(e.health, total);
    e.health -= total;
    const source = jetDmg >= blastDmg && jetDmg >= fragDmg ? 'jet' : fragDmg > blastDmg ? 'fragments' : 'blast';
    if (!e.alerted) alert(e);
    const result = { damage: dealt, source, ...(weak ? { weakSpot: weak } : {}) };
    if (e.health <= 0) result.after = () => destroy(e, source, weak);
    else if (def.vehicle) sync(e);
    return result;
  }

  function alert(e) {
    e.alerted = true; e.calmT = 0;
    ctx.emit({ type: 'entity_alerted', entityId: e.id, position: [e.x, e.y + e.def.size[1] / 2, e.z] });
  }

  function destroy(e, cause, weak) {
    if (e.destroyed) return;
    e.destroyed = true; e.speed = 0; e.health = 0;
    const def = e.def;
    if (def.vehicle) {
      e.onFire = true; e.fireUntil = time + FIRE_SECONDS;
      const c = def.cookoff;
      // Ammo hits cook off almost always; otherwise roll the dice.
      if (c && (weak === 'ammo' || rand() < c.chance)) e.cookoffAt = time + c.delay[0] + rand() * (c.delay[1] - c.delay[0]);
    }
    sync(e);
    ctx.emit({ type: 'entity_destroyed', entityId: e.id, kind: e.kind, position: [e.x, e.y + def.size[1] / 2, e.z], cause });
  }

  function cookoff(e) {
    e.cookoffDone = true;
    const c = e.def.cookoff;
    ctx.explode({
      position: [e.x, e.y + e.def.size[1] / 2, e.z], objectId: e.id, kind: c.kind, chargeKg: c.chargeKg, radius: c.radius,
      fragmentRadius: c.fragmentRadius, fragmentLethality: c.fragmentLethality, ignoreHandle: e.body.handle,
    });
  }

  // ---- AI -------------------------------------------------------------

  function steer(e, dt, heading, speed) {
    const def = e.def;
    const err = wrap(heading - e.yaw);
    e.yaw += Math.sign(err) * Math.min(Math.abs(err), def.turnRate * dt);
    let want = speed;
    if (def.vehicle && Math.abs(err) > 0.6) want *= 0.25; // slow down to take a turn
    e.speed = approach(e.speed, want, def.accel * dt);
    e.x += -Math.sin(e.yaw) * e.speed * dt;
    e.z += -Math.cos(e.yaw) * e.speed * dt;
    e.x = Math.max(-half, Math.min(half, e.x));
    e.z = Math.max(-half, Math.min(half, e.z));
  }

  function patrol(e, dt) {
    const def = e.def;
    if (!e.patrol || e.patrol.length < 2 || time < e.waitUntil) { steer(e, dt, e.yaw, 0); return; }
    const [tx, tz] = e.patrol[e.wp];
    const dx = tx - e.x, dz = tz - e.z;
    if (Math.hypot(dx, dz) < (def.vehicle ? 4 : 1.2)) {
      e.wp = (e.wp + 1) % e.patrol.length;
      e.waitUntil = time + e.idleTime * (0.6 + rand() * 0.8);
      steer(e, dt, e.yaw, 0);
      return;
    }
    steer(e, dt, Math.atan2(-dx, -dz), def.walk);
  }

  function react(e, dt, drone) {
    const def = e.def;
    const dx = e.x - drone.position[0], dz = e.z - drone.position[2];
    const away = Math.atan2(-dx, -dz);
    const dist = Math.hypot(dx, dz);
    if (def.turret) { // track the drone with the turret
      _qi.set(e.q[0], e.q[1], e.q[2], e.q[3]).invert();
      const l = _loc.set(drone.position[0] - e.x, 0, drone.position[2] - e.z).applyQuaternion(_qi);
      e.turretYaw = approach(e.turretYaw, Math.atan2(-l.x, -l.z), def.turret * dt);
    }
    if (!def.vehicle) {
      if (e.mode === 'patrol') { // first reaction: run or hit the dirt
        e.mode = rand() < 0.4 ? 'prone' : 'flee';
        e.proneUntil = time + PRONE_SECONDS;
        e.fleeHeading = away + (rand() - 0.5) * 1.2;
      }
      if (e.mode === 'prone') {
        steer(e, dt, e.yaw, 0);
        e.status = 'prone';
        if (time > e.proneUntil && dist < 45) { e.mode = 'flee'; e.fleeHeading = away; }
        else if (time > e.proneUntil) e.alerted = false;
      } else {
        steer(e, dt, e.fleeHeading, def.run);
        e.status = 'fleeing';
      }
      return;
    }
    // Vehicles: trucks and APCs drive off when it gets close, tanks stand and turn the turret.
    const bolt = e.kind === 'truck' || (e.kind === 'apc' && dist < 50);
    if (bolt) { steer(e, dt, away, def.run); e.status = 'fleeing'; } else { steer(e, dt, e.yaw, 0); e.status = 'idle'; }
  }

  function update(dt, drone) {
    time += dt;
    for (const e of list) {
      if (e.destroyed) {
        if (e.onFire && time > e.fireUntil) e.onFire = false;
        if (e.cookoffAt >= 0 && !e.cookoffDone && time >= e.cookoffAt) cookoff(e);
        sync(e);
        continue;
      }
      // Notice the drone: louder the faster it flies.
      if (drone.active) {
        const hear = e.def.hearing + drone.speed * 4;
        const d = Math.hypot(e.x - drone.position[0], e.y - drone.position[1], e.z - drone.position[2]);
        if (!e.alerted) {
          if (d < hear) { e.noticeT += dt; if (e.noticeT > e.reactAfter) alert(e); } else e.noticeT = Math.max(0, e.noticeT - dt);
        }
        if (e.alerted) e.calmT = 0;
      } else if (e.alerted) {
        e.calmT += dt;
        if (e.calmT > CALM_AFTER) { e.alerted = false; e.noticeT = 0; e.mode = 'patrol'; }
      }
      if (e.alerted) react(e, dt, drone);
      else {
        patrol(e, dt);
        e.mode = 'patrol';
        e.status = e.speed > (e.def.vehicle ? 0.3 : 0.2) ? 'moving' : 'idle';
        if (e.def.turret) e.turretYaw = approach(e.turretYaw, 0, e.def.turret * 0.5 * dt);
      }
      ground(e);
      sync(e);
    }
  }

  function reset() {
    time = 0;
    for (const e of list) place(e);
  }

  for (const def of level.enemies ?? []) spawn(def);

  return {
    list, states, update, reset,
    get alive() { return list.filter((e) => !e.destroyed).length; },
    byId: (id) => list.find((e) => e.id === id),
  };
}
