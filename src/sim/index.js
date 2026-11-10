// Simulation entry point. See ARCHITECTURE.md for the SimState / SimEvent contract.

import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { FlightModel } from './flightModel.js';

export const SIM_HZ = 240;
export const GRAVITY = 9.81;

const CRASH_SPEED = 7.5;   // m/s change in velocity from one impact that breaks props
const BUMP_SPEED = 1.5;    // smaller impacts are reported as 'collision'
const DRONE_HALF = [0.16, 0.035, 0.16];

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
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.trimesh(verts, idx).setFriction(0.8), ground);

  for (const o of level.objects) {
    const [x, y, z] = o.position;
    if (o.kind === 'building') {
      const [w, h, d] = o.size;
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), o.rotationY);
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(x, y + h / 2, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
      );
      world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2), body);
    } else if (o.kind === 'tree') {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
      const trunkH = o.height * 0.6;
      world.createCollider(RAPIER.ColliderDesc.cylinder(trunkH / 2, 0.25).setTranslation(0, trunkH / 2, 0), body);
      // Canopy: an ellipsoid-ish stack of two balls.
      const r = o.radius;
      world.createCollider(RAPIER.ColliderDesc.ball(r).setTranslation(0, o.height - r, 0), body);
      world.createCollider(RAPIER.ColliderDesc.ball(r * 0.8).setTranslation(0, o.height - r * 1.8, 0), body);
    }
  }
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
  buildStaticWorld(world, level);

  const opts = { cameraTiltDeg: 30, fovDeg: 78, ...settings };
  const fm = new FlightModel();

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
  const state = {
    time: 0,
    paused: false,
    view: 'fpv',
    drone: {
      position: [0, 0, 0], quaternion: [0, 0, 0, 1], velocity: [0, 0, 0], angularVelocity: [0, 0, 0],
      motors: [0, 0, 0, 0], throttle: 0, armed: false, crashed: false, flightMode: 'ACRO',
    },
    camera: { position: [0, 0, 0], quaternion: [0, 0, 0, 1], fovDeg: opts.fovDeg, tiltDeg: opts.cameraTiltDeg },
    hud: {
      armed: false, flightMode: 'ACRO', throttlePct: 0, altitudeM: 0, speedKmh: 0, headingDeg: 0,
      batteryV: 0, batteryPct: 100, mAhUsed: 0, currentA: 0, flightTimeS: 0, linkQuality: 100, warnings: [],
    },
    link: { signal: 1, jamming: 0, lost: false },
    entities: [],
  };

  let flightTime = 0;
  let throttleWarnUntil = -1;
  let upsideDownTime = 0;
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
    fm.reset();
    fm.resetBattery();
    state.drone.crashed = false;
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

  function crash(position, impactSpeed) {
    if (state.drone.crashed) return;
    state.drone.crashed = true;
    setArmed(false);
    emit({ type: 'crash', position, impactSpeed });
  }

  function handleEdges(c) {
    if (c.pause) state.paused = !state.paused;
    if (c.toggleView) state.view = state.view === 'fpv' ? 'chase' : 'fpv';
    if (c.toggleMode) fm.mode = fm.mode === 'ACRO' ? 'ANGLE' : 'ACRO';
    if (c.reset) { respawn(); emit({ type: 'reset' }); }
    if (c.arm) {
      if (fm.armed) setArmed(false);
      else if (state.drone.crashed) { /* need reset first */ }
      else if (c.throttle > 0.05) throttleWarnUntil = state.time + 2;
      else setArmed(true);
    }
  }

  const vBefore = new Vector3();
  const accel = new Vector3();
  const gq = new Quaternion();

  function step(dt, controls) {
    handleEdges(controls);
    if (state.paused) return;

    const r = body.rotation(), lv = body.linvel(), av = body.angvel();
    const q = [r.x, r.y, r.z, r.w];
    const vel = [lv.x, lv.y, lv.z];
    fm.step(controls, q, vel, [av.x, av.y, av.z], dt);

    body.resetForces(true);
    body.resetTorques(true);
    body.addForce(fm.forceWorld, true);
    body.addTorque(fm.torqueWorld, true);

    vBefore.set(lv.x, lv.y, lv.z);
    accel.copy(fm.forceWorld).divideScalar(fm.totalMass);
    accel.y -= GRAVITY;

    world.step();
    state.time += dt;
    if (fm.armed) flightTime += dt;

    // Impact detection: velocity change not explained by applied forces.
    const lv2 = body.linvel();
    const dv = _v.set(lv2.x, lv2.y, lv2.z).sub(vBefore).addScaledVector(accel, -dt);
    const impact = dv.length();
    if (impact > BUMP_SPEED) {
      const p = body.translation();
      const position = [p.x, p.y, p.z];
      if (impact > CRASH_SPEED) crash(position, impact);
      else {
        const n = dv.clone().normalize();
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

    // FPV camera: front of the frame, tilted up.
    _q.set(r.x, r.y, r.z, r.w);
    _camOffset.set(0, 0.03, -0.09).applyQuaternion(_q);
    const cam = state.camera;
    cam.position[0] = p.x + _camOffset.x; cam.position[1] = p.y + _camOffset.y; cam.position[2] = p.z + _camOffset.z;
    _tiltQ.setFromAxisAngle(X_AXIS, opts.cameraTiltDeg * Math.PI / 180);
    _q.multiply(_tiltQ);
    cam.quaternion[0] = _q.x; cam.quaternion[1] = _q.y; cam.quaternion[2] = _q.z; cam.quaternion[3] = _q.w;
    cam.fovDeg = opts.fovDeg;
    cam.tiltDeg = opts.cameraTiltDeg;

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
    h.linkQuality = Math.round(state.link.signal * 100);
    const w = h.warnings;
    w.length = 0;
    if (d.crashed) w.push('CRASH');
    else if (!fm.armed) w.push('DISARMED');
    if (state.time < throttleWarnUntil) w.push('THROTTLE');
    if (fm.voltage / fm.batt.cells < 3.3 && fm.armed) w.push('LOW BATTERY');
  }

  respawn();

  return {
    state,
    level,
    flightModel: fm,
    settings: opts,
    step,
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
