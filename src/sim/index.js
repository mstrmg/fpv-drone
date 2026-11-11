// Simulation entry point. See ARCHITECTURE.md for the SimState / SimEvent contract.

import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { FlightModel } from './flightModel.js';
import { Wind } from './environment.js';
import { createEntities } from './entities.js';
import { addPropColliders, WireField } from './propColliders.js';
import { createWalker } from './onFoot.js';
import { WARHEADS, ARM_DISTANCE_M, FUZE_IMPACT_SPEED, JET_REACH_M, blastAt, DamageRegistry } from './warhead.js';

export const SIM_HZ = 240;
export const GRAVITY = 9.81;

const CRASH_SPEED = 7.5;   // m/s change in velocity from one impact that breaks the frame
const PROP_STRIKE_SPEED = 4.5; // lower limit while the props are spinning fast
const BUMP_SPEED = 1.5;    // smaller impacts are reported as 'collision'
const DRONE_HALF = [0.16, 0.035, 0.16];
const RESPAWN_DELAY = 3;   // s of static after the warhead goes off, then the next drone launches

let rapierReady = null;
export function initPhysics() {
  rapierReady ??= RAPIER.init();
  return rapierReady;
}

function buildStaticWorld(world, level) {
  const { terrain } = level;
  const n = terrain.segments + 1;
  const step = terrain.size / terrain.segments;
  const verts = new Float32Array(n * n * 3);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const i = iz * n + ix;
      verts[i * 3] = -terrain.size / 2 + ix * step;
      verts[i * 3 + 1] = terrain.heights[i];
      verts[i * 3 + 2] = -terrain.size / 2 + iz * step;
    }
  }
  const idx = new Uint32Array(terrain.segments * terrain.segments * 6);
  let k = 0;
  for (let iz = 0; iz < terrain.segments; iz++) {
    for (let ix = 0; ix < terrain.segments; ix++) {
      const a = iz * n + ix, b = a + 1, c = a + n, d = c + 1;
      // Triangles (a,d,b) and (a,c,d): diagonal a→d, normals +Y. Matches heightAt().
      idx[k++] = a; idx[k++] = d; idx[k++] = b;
      idx[k++] = a; idx[k++] = c; idx[k++] = d;
    }
  }
  const surfaces = new Map(); // collider handle → { surface, objectId }
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const gc = world.createCollider(RAPIER.ColliderDesc.trimesh(verts, idx).setFriction(0.8), ground);
  surfaces.set(gc.handle, { surface: 'ground', objectId: null });

  for (const o of level.objects) {
    const [x, y, z] = o.position;
    if (o.kind === 'building') {
      const [w, h, d] = o.size;
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), o.rotationY);
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(x, y + h / 2, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
      );
      const c = world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2), body);
      surfaces.set(c.handle, { surface: 'building', objectId: o.id });
    } else if (o.kind === 'tree') {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
      const trunkH = o.height * 0.6;
      const tag = (c) => surfaces.set(c.handle, { surface: 'tree', objectId: o.id });
      tag(world.createCollider(RAPIER.ColliderDesc.cylinder(trunkH / 2, 0.25).setTranslation(0, trunkH / 2, 0), body));
      // Canopy: an ellipsoid-ish stack of two balls.
      const r = o.radius;
      tag(world.createCollider(RAPIER.ColliderDesc.ball(r).setTranslation(0, o.height - r, 0), body));
      tag(world.createCollider(RAPIER.ColliderDesc.ball(r * 0.8).setTranslation(0, o.height - r * 1.8, 0), body));
    }
  }
  addPropColliders(world, ground, level, surfaces);
  return surfaces;
}

const _q = new Quaternion();
const _v = new Vector3();
const _camOffset = new Vector3();
const _tiltQ = new Quaternion();
const X_AXIS = new Vector3(1, 0, 0);

export async function createSim({ level, settings = {} }) {
  await initPhysics();
  const world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
  world.timestep = 1 / SIM_HZ;
  const surfaces = buildStaticWorld(world, level);

  const opts = { cameraTiltDeg: 30, fovDeg: 78, wind: true, warhead: 'rpg-heat', ...settings };
  const fm = new FlightModel();
  const warhead = WARHEADS[opts.warhead] ?? WARHEADS.none;
  fm.setPayload(warhead.massKg, warhead.lengthM);
  const wires = new WireField(level);
  const damage = new DamageRegistry();
  const entityColliders = new Map(); // collider handle → entity id
  const wind = new Wind({ seed: level.seed * 13 + 1, meanSpeed: opts.wind ? 3 : 0, gustStrength: opts.wind ? 1.8 : 0 });

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setCcdEnabled(true).setCanSleep(false),
  );
  const [Ix, Iy, Iz] = fm.airframe.inertia;
  const droneCollider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(...DRONE_HALF)
      .setMassProperties(fm.totalMass, { x: 0, y: 0, z: 0 }, { x: Ix, y: Iy, z: Iz }, { x: 0, y: 0, z: 0, w: 1 })
      .setFriction(0.5)
      .setRestitution(0.15),
    body,
  );

  const events = [];
  // Levels with a `start` begin on foot (campaign); the others go straight to the drone.
  const walker = level.start ? createWalker(world, level) : null;
  const state = {
    time: 0,
    paused: false,
    mode: walker ? 'foot' : 'drone',
    player: walker ? walker.state : null,
    prompt: null,
    drone: {
      position: [0, 0, 0], quaternion: [0, 0, 0, 1], velocity: [0, 0, 0], angularVelocity: [0, 0, 0],
      motors: [0, 0, 0, 0], throttle: 0, armed: false, crashed: false, destroyed: false, flightMode: 'ACRO',
      warhead: { type: warhead.type, state: 'safe', massKg: warhead.massKg },
    },
    camera: { position: [0, 0, 0], quaternion: [0, 0, 0, 1], fovDeg: opts.fovDeg, tiltDeg: opts.cameraTiltDeg },
    hud: {
      armed: false, flightMode: 'ACRO', throttlePct: 0, altitudeM: 0, speedKmh: 0, headingDeg: 0,
      batteryV: 0, batteryPct: 100, mAhUsed: 0, currentA: 0, flightTimeS: 0, linkQuality: 100,
      warhead: 'SAFE', warheadArmInM: ARM_DISTANCE_M, warnings: [],
    },
    link: { signal: 1, jamming: 0, lost: false, roll: 0 },
    env: { wind: wind.value },
    entities: [],
  };

  // Secondary explosions (ammo cook-off, fuel fires) from destroyed vehicles.
  function explode(x) {
    const w = { chargeKg: x.chargeKg, radius: x.radius, fragmentRadius: x.fragmentRadius, fragmentLethality: x.fragmentLethality ?? 0.5, shaped: false, penetrationMm: 0 };
    emit({
      type: 'explosion', position: x.position, normal: [0, 1, 0], surface: 'entity', objectId: x.objectId, kind: x.kind,
      chargeKg: w.chargeKg, radius: w.radius, fragmentRadius: w.fragmentRadius, shaped: false, direction: [0, 1, 0], cause: 'cookoff', turretToss: !!x.turretToss,
    });
    applyBlast(x.position, [0, 1, 0], w, x.ignoreHandle);
  }
  const entities = createEntities({
    world, level, emit: (e) => emit(e), damage, explode, registerCollider: (h, id) => entityColliders.set(h, id), unregisterCollider: (h) => entityColliders.delete(h),
  });
  state.entities = entities.states;

  let flightTime = 0;
  let throttleWarnUntil = -1;
  let upsideDownTime = 0;
  let safeWarnUntil = -1;
  let respawnAt = -1;
  const launchPoint = new Vector3();
  const linkOrigin = new Vector3();
  const NEUTRAL = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
  const emit = (e) => events.push({ time: state.time, ...e });

  function respawn() {
    const { position, yaw } = level.spawn;
    _q.setFromAxisAngle(new Vector3(0, 1, 0), yaw);
    body.setTranslation({ x: position[0], y: position[1] + DRONE_HALF[1] + 0.02, z: position[2] }, true);
    body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    body.resetForces(true);
    body.resetTorques(true);
    body.setEnabled(true);
    fm.reset();
    fm.resetBattery();
    state.drone.crashed = false;
    state.drone.destroyed = false;
    state.drone.warhead.state = 'safe';
    state.link.lost = false;
    state.link.signal = 1;
    state.link.roll = 0;
    signalLost = false;
    respawnAt = -1;
    launchPoint.set(position[0], position[1], position[2]);
    if (level.linkOrigin) linkOrigin.fromArray(level.linkOrigin); else linkOrigin.copy(launchPoint);
    flightTime = 0;
    upsideDownTime = 0;
    writeState();
  }

  function setArmed(on) {
    if (on === fm.armed) return;
    fm.armed = on;
    if (!on) fm.iTerm.set(0, 0, 0);
    emit({ type: on ? 'armed' : 'disarmed' });
  }

  function crash(position, impactSpeed, cause) {
    if (state.drone.crashed) return;
    state.drone.crashed = true;
    setArmed(false);
    emit({ type: 'crash', position, impactSpeed, ...(cause ? { cause } : {}) });
  }

  // --- Warhead -------------------------------------------------------------

  const _dir = new Vector3();
  const _to = new Vector3();

  // What is the drone touching / about to touch? Ray along `dir` from the drone.
  function probeSurface(origin, dir, maxDist) {
    const ray = new RAPIER.Ray(origin, dir);
    const hit = world.castRayAndGetNormal(ray, maxDist, true, undefined, undefined, undefined, body);
    if (!hit) return null;
    const info = surfaces.get(hit.collider.handle) ?? entitySurface(hit.collider);
    return { ...info, normal: [hit.normal.x, hit.normal.y, hit.normal.z], toi: hit.timeOfImpact ?? hit.toi };
  }
  function entitySurface(collider) {
    const id = entityColliders.get(collider.handle);
    return id ? { surface: 'entity', objectId: id } : { surface: 'ground', objectId: null };
  }

  function lineOfSight(from, to, ignoreBodyHandle, ignoreBodyHandle2) {
    _to.set(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const dist = _to.length();
    if (dist < 1e-3) return true;
    _to.divideScalar(dist);
    const ray = new RAPIER.Ray({ x: from[0], y: from[1], z: from[2] }, _to);
    const hit = world.castRay(ray, dist, true, undefined, undefined, undefined, body,
      ignoreBodyHandle != null ? (c) => { const h = c.parent()?.handle; return h !== ignoreBodyHandle && h !== ignoreBodyHandle2; } : undefined);
    return !hit || (hit.timeOfImpact ?? hit.toi) >= dist - 0.3;
  }

  function detonate(cause, impactNormal) {
    if (state.drone.destroyed || warhead.type === 'none') return;
    const p = body.translation();
    const lv = body.linvel();
    const pos = [p.x, p.y, p.z];
    const speed = Math.hypot(lv.x, lv.y, lv.z);
    if (speed > 0.5) _dir.set(lv.x / speed, lv.y / speed, lv.z / speed);
    else _dir.set(0, 0, -1).applyQuaternion(_q.copy(body.rotation()));

    // Classify what it went off against.
    let hit = probeSurface(p, _dir, 1.0);
    if (!hit && cause === 'impact' && impactNormal) hit = probeSurface(p, { x: -impactNormal[0], y: -impactNormal[1], z: -impactNormal[2] }, 1.0);
    if (!hit && p.y - level.terrain.heightAt(p.x, p.z) < 0.6) hit = { surface: 'ground', objectId: null, normal: [0, 1, 0] };
    const surface = hit?.surface ?? 'air';
    const normal = hit?.normal ?? impactNormal ?? [0, 1, 0];

    state.drone.destroyed = true;
    state.drone.warhead.state = 'detonated';
    setArmed(false);
    body.setLinvel({ x: 0, y: 0, z: 0 }, false);
    body.setAngvel({ x: 0, y: 0, z: 0 }, false);
    body.setEnabled(false);

    emit({
      type: 'explosion', position: pos, normal, surface, objectId: hit?.objectId ?? null,
      kind: 'warhead', chargeKg: warhead.chargeKg, radius: warhead.radius, fragmentRadius: warhead.fragmentRadius,
      shaped: warhead.shaped, direction: [_dir.x, _dir.y, _dir.z], cause,
    });
    applyBlast(pos, [_dir.x, _dir.y, _dir.z], warhead);

    state.link.lost = true;
    state.link.roll = 0; // the feed is simply gone, not rolling
    respawnAt = state.time + RESPAWN_DELAY;
    emit({ type: 'drone_lost', reason: 'detonated', respawnIn: RESPAWN_DELAY });
  }

  function applyBlast(origin, direction, w, ignoreHandle) {
    for (const t of [...damage.targets.values()]) {
      const tp = t.position();
      const dx = tp[0] - origin[0], dy = tp[1] - origin[1], dz = tp[2] - origin[2];
      const centre = Math.hypot(dx, dy, dz);
      const distance = t.distanceFrom ? t.distanceFrom(origin) : Math.max(0, centre - (t.radius ?? 0.5));
      if (distance > Math.max(w.fragmentRadius, w.radius * 6)) continue;
      const los = lineOfSight(origin, tp, t.bodyHandle ?? ignoreHandle, ignoreHandle ?? t.bodyHandle);
      let { blast, fragments } = blastAt(distance, w);
      if (!los) { blast *= 0.4; fragments = 0; } // blast wraps around cover, fragments don't
      // HEAT jet: only a target right in front of the nose.
      const along = centre > 0 ? (dx * direction[0] + dy * direction[1] + dz * direction[2]) / centre : 1;
      const jet = w.shaped && distance <= JET_REACH_M && along > 0.7;
      if (blast <= 0 && fragments <= 0 && !jet) continue;
      const r = t.applyDamage({
        blast, fragments, jet, distance, lineOfSight: los, shaped: !!w.shaped,
        penetrationMm: w.penetrationMm ?? 0, direction, position: origin,
      });
      // A target returns either a damage number or { damage, source, weakSpot, extra, after }.
      const res = typeof r === 'number' ? { damage: r } : (r ?? { damage: 0 });
      if (res.damage > 0) {
        emit({
          type: 'hit', entityId: t.id, position: tp, damage: res.damage,
          source: res.source ?? (blast > 0 || jet ? 'blast' : 'fragments'),
          ...(res.weakSpot ? { weakSpot: res.weakSpot } : {}),
          ...res.extra,
        });
      }
      res.after?.();
    }
  }

  // Analog video link: weakens with distance from the launch point, flying low
  // (the ground blocks the signal) and hills between you and the launch point.
  // `roll` drives the picture rolling vertically as sync starts to fail.
  const LINK_RANGE_M = level.linkRangeM ?? 800;
  let linkTick = 0;
  let occlusion = 1;
  let signalLost = false;
  function updateLink(dt) {
    const l = state.link;
    if (state.drone.destroyed) return;
    const p = body.translation();
    const T = level.terrain;
    const dist = linkOrigin.distanceTo(_to.set(p.x, p.y, p.z));
    const agl = Math.max(0, p.y - T.heightAt(p.x, p.z));
    if ((linkTick++ & 7) === 0) { // terrain between us and the launch point, sampled a few times a second
      let blocked = 0;
      const N = 12;
      for (let i = 1; i < N; i++) {
        const t = i / N;
        const x = linkOrigin.x + (p.x - linkOrigin.x) * t, z = linkOrigin.z + (p.z - linkOrigin.z) * t;
        const y = linkOrigin.y + 1 + (p.y - linkOrigin.y - 1) * t;
        blocked = Math.max(blocked, T.heightAt(x, z) - y);
      }
      occlusion = blocked > 0 ? Math.max(0.25, 1 - blocked / 15) : 1;
    }
    const range = Math.max(0, 1 - (dist / LINK_RANGE_M) ** 2);
    const lowFly = Math.max(0, Math.min(1, (4 - agl) / 4)) * (0.25 + 0.75 * Math.min(1, dist / 120));
    const target = range * (1 - 0.75 * lowFly) * occlusion;
    l.signal += (target - l.signal) * Math.min(1, dt / 0.25);
    l.roll = Math.min(1, Math.max(0, (0.6 - l.signal) / 0.4)) ** 1.5;
    const lost = l.signal < 0.08;
    if (lost !== signalLost) { signalLost = lost; emit({ type: lost ? 'link_lost' : 'link_restored' }); }
    l.lost = lost;
  }

  function updateWarheadArming() {
    const wh = state.drone.warhead;
    if (warhead.type === 'none') { wh.state = 'safe'; return; }
    if (wh.state !== 'safe') return;
    const p = body.translation();
    const flown = launchPoint.distanceTo(_to.set(p.x, p.y, p.z));
    if (fm.armed && flown >= ARM_DISTANCE_M) wh.state = 'armed';
  }

  function setMode(mode) {
    if (state.mode === mode) return;
    state.mode = mode;
    if (mode === 'drone' && (state.drone.crashed || state.drone.destroyed)) { respawn(); emit({ type: 'reset' }); }
    if (mode === 'foot') setArmed(false);
    emit({ type: 'mode', mode });
  }

  function handleEdges(c) {
    if (c.pause) state.paused = !state.paused;
    if (state.paused) return;
    if (state.mode === 'foot') {
      if ((c.interact || c.goggles) && walker.state.nearGoggles) setMode('drone');
      if (c.resetTargets) { entities.reset(); emit({ type: 'targets_reset' }); }
      return;
    }
    if (walker && c.goggles) { setMode('foot'); return; }
    if (c.fire && !state.paused) {
      if (state.drone.warhead.state === 'armed') detonate('manual');
      else if (!state.drone.destroyed && warhead.type !== 'none') safeWarnUntil = state.time + 2;
    }
    if (c.resetTargets) { entities.reset(); emit({ type: 'targets_reset' }); }
    if (c.toggleMode) fm.mode = fm.mode === 'ACRO' ? 'ANGLE' : 'ACRO';
    if (c.reset) { respawn(); emit({ type: 'reset' }); }
    if (c.arm) {
      if (fm.armed) setArmed(false);
      else if (state.drone.crashed || state.drone.destroyed) { /* need reset first */ }
      else if (c.throttle > 0.05) throttleWarnUntil = state.time + 2;
      else setArmed(true);
    }
  }

  const entityDrone = { position: [0, 0, 0], speed: 0, active: false };
  const vBefore = new Vector3();
  const accel = new Vector3();
  const gq = new Quaternion();

  function step(dt, input) {
    handleEdges(input);
    if (state.paused) return;
    // On foot the drone sits where it is with the sticks centred.
    const controls = state.mode === 'foot' ? NEUTRAL : input;
    if (walker) {
      if (state.mode === 'foot') walker.update(dt, input, (col) => col.handle === droneCollider.handle);
      state.prompt = state.mode === 'foot' && walker.state.nearGoggles ? 'goggles' : state.mode === 'drone' ? 'ungoggle' : null;
    }

    const dr = state.drone;
    entityDrone.position = dr.position;
    entityDrone.speed = Math.hypot(dr.velocity[0], dr.velocity[1], dr.velocity[2]);
    entityDrone.active = !dr.destroyed && dr.armed;
    entities.update(dt, entityDrone);

    if (state.drone.destroyed) {
      state.time += dt;
      if (respawnAt >= 0 && state.time >= respawnAt) {
        respawn(); emit({ type: 'reset' });
        if (walker) setMode('foot'); // goggles off: the next drone is waiting by the mast
      }
      if (walker) world.step(); // the walker still moves
      writeState(controls);
      return;
    }

    const r = body.rotation(), lv = body.linvel(), av = body.angvel();
    const q = [r.x, r.y, r.z, r.w];
    const vel = [lv.x, lv.y, lv.z];
    const agl0 = body.translation().y - level.terrain.heightAt(body.translation().x, body.translation().z);
    wind.step(dt, agl0);
    fm.step(controls, q, vel, [av.x, av.y, av.z], dt, wind.value);

    body.resetForces(true);
    body.resetTorques(true);
    body.addForce(fm.forceWorld, true);
    body.addTorque(fm.torqueWorld, true);

    vBefore.set(lv.x, lv.y, lv.z);
    accel.copy(fm.forceWorld).divideScalar(fm.totalMass);
    accel.y -= GRAVITY;

    const p0x = body.translation().x, p0y = body.translation().y, p0z = body.translation().z;
    world.step();
    state.time += dt;

    // Telegraph wires: the props tangle in them and the drone drops.
    if (!state.drone.crashed && fm.armed && wires.hit({ x: p0x, y: p0y, z: p0z }, body.translation(), 0.2)) {
      const l = body.linvel();
      crash([p0x, p0y, p0z], Math.hypot(l.x, l.y, l.z), 'wire');
      body.setLinvel({ x: l.x * 0.15, y: l.y * 0.15, z: l.z * 0.15 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    if (fm.armed) flightTime += dt;

    // Impact detection: velocity change not explained by applied forces.
    const lv2 = body.linvel();
    const dv = _v.set(lv2.x, lv2.y, lv2.z).sub(vBefore).addScaledVector(accel, -dt);
    const impact = dv.length();
    if (impact > BUMP_SPEED) {
      const p = body.translation();
      const position = [p.x, p.y, p.z];
      // Props stick out sideways: an edge-on hit while they spin fast breaks them,
      // a flat landing on the frame does not.
      const r2 = body.rotation();
      const bodyUp = new Vector3(0, 1, 0).applyQuaternion(gq.set(r2.x, r2.y, r2.z, r2.w));
      const edgeOn = Math.abs(dv.dot(bodyUp)) < 0.7 * impact;
      const propsFast = fm.armed && Math.max(...fm.motorRpm) > 0.35;
      const n = dv.clone().normalize();
      if (state.drone.warhead.state === 'armed' && impact > FUZE_IMPACT_SPEED) {
        // Contact fuze. The pre-impact velocity is the travel direction.
        detonate('impact', [n.x, n.y, n.z]);
        writeState(controls);
        return;
      }
      if (impact > CRASH_SPEED || (propsFast && edgeOn && impact > PROP_STRIKE_SPEED)) crash(position, impact);
      else {
        emit({ type: 'collision', position, normal: [n.x, n.y, n.z], impactSpeed: impact });
      }
    }

    // Upside down on the ground for a while = stuck (no turtle mode yet).
    const p = body.translation();
    gq.set(body.rotation().x, body.rotation().y, body.rotation().z, body.rotation().w);
    const upY = _v.set(0, 1, 0).applyQuaternion(gq).y;
    const agl = p.y - level.terrain.heightAt(p.x, p.z);
    if (upY < -0.3 && agl < 0.6 && body.linvel().y ** 2 < 0.5) {
      upsideDownTime += dt;
      if (upsideDownTime > 1.5) crash([p.x, p.y, p.z], 0);
    } else upsideDownTime = 0;

    // Off the map.
    const half = level.terrain.size / 2;
    if (Math.abs(p.x) > half || Math.abs(p.z) > half || p.y < -200) crash([p.x, p.y, p.z], 0);

    updateWarheadArming();
    updateLink(dt);
    writeState(controls);
  }

  function writeState(controls) {
    const d = state.drone;
    const p = body.translation(), r = body.rotation(), lv = body.linvel(), av = body.angvel();
    d.position[0] = p.x; d.position[1] = p.y; d.position[2] = p.z;
    d.quaternion[0] = r.x; d.quaternion[1] = r.y; d.quaternion[2] = r.z; d.quaternion[3] = r.w;
    d.velocity[0] = lv.x; d.velocity[1] = lv.y; d.velocity[2] = lv.z;
    d.angularVelocity[0] = av.x; d.angularVelocity[1] = av.y; d.angularVelocity[2] = av.z;
    for (let i = 0; i < 4; i++) d.motors[i] = fm.motorRpm[i];
    d.throttle = controls ? controls.throttle : 0;
    d.armed = fm.armed;
    d.flightMode = fm.mode;

    // FPV camera: front of the frame, tilted up. On foot: the soldier's eyes.
    _q.set(r.x, r.y, r.z, r.w);
    if (state.mode === 'foot') walker.writeCamera(state.camera, 72);
    else {
    _camOffset.set(0, 0.03, -0.09).applyQuaternion(_q);
    const cam = state.camera;
    cam.position[0] = p.x + _camOffset.x; cam.position[1] = p.y + _camOffset.y; cam.position[2] = p.z + _camOffset.z;
    _tiltQ.setFromAxisAngle(X_AXIS, opts.cameraTiltDeg * Math.PI / 180);
    _q.multiply(_tiltQ);
    cam.quaternion[0] = _q.x; cam.quaternion[1] = _q.y; cam.quaternion[2] = _q.z; cam.quaternion[3] = _q.w;
    cam.fovDeg = opts.fovDeg;
    cam.tiltDeg = opts.cameraTiltDeg;
    }

    const h = state.hud;
    h.armed = fm.armed;
    h.flightMode = fm.mode;
    h.throttlePct = Math.round(d.throttle * 100);
    h.altitudeM = p.y - level.terrain.heightAt(p.x, p.z) - DRONE_HALF[1];
    h.speedKmh = Math.hypot(lv.x, lv.y, lv.z) * 3.6;
    _q.set(r.x, r.y, r.z, r.w);
    const f = _v.set(0, 0, -1).applyQuaternion(_q);
    h.headingDeg = (Math.atan2(f.x, -f.z) * 180 / Math.PI + 360) % 360;
    h.batteryV = fm.voltage;
    h.batteryPct = Math.round(fm.soc * 100);
    h.mAhUsed = Math.round(fm.mAhUsed);
    h.currentA = fm.current;
    h.flightTimeS = flightTime;
    h.linkQuality = state.link.lost ? 0 : Math.round(state.link.signal * 100);
    const ws = d.warhead.state;
    h.warhead = warhead.type === 'none' ? 'NONE' : ws.toUpperCase();
    h.warheadArmInM = ws === 'safe' && warhead.type !== 'none'
      ? Math.max(0, Math.ceil(ARM_DISTANCE_M - launchPoint.distanceTo(_to.set(p.x, p.y, p.z)))) : 0;
    const w = h.warnings;
    w.length = 0;
    if (d.destroyed) w.push('NO SIGNAL');
    else if (d.crashed) w.push('CRASH');
    else if (!fm.armed) w.push('DISARMED');
    if (state.time < safeWarnUntil) w.push('WARHEAD SAFE');
    if (state.time < throttleWarnUntil) w.push('THROTTLE');
    if (fm.voltage / fm.batt.cells < 3.3 && fm.armed) w.push('LOW BATTERY');
  }

  respawn();

  return {
    state,
    level,
    flightModel: fm,
    settings: opts,
    warhead,
    entities,       // enemy manager (list, alive, reset)
    damage,         // DamageRegistry: register targets that blasts can hurt
    step,
    detonate: () => detonate('manual'),
    drainEvents() {
      if (!events.length) return EMPTY;
      const out = events.slice();
      events.length = 0;
      return out;
    },
    // Debug helpers (not part of the contract)
    _body: body,
    _collider: droneCollider,
  };
}

const EMPTY = Object.freeze([]);
