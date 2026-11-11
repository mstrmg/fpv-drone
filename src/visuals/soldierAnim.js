// Procedural animation for the skinned soldiers: blending between standing, kneeling and prone
// (passing through a kneel on the way down), walk and run gaits, crawling, breathing and looking
// around, turning to aim at the drone, two-bone arm IK onto the weapon, and deaths: a crumple that
// falls under gravity, or a body thrown by a blast that tumbles, flails and lands in a sprawl.
import * as THREE from 'three';
import { JOINTS } from './soldierModel.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

const KEYS = ['hipsY', 'hipsX', 'hipsYaw', 'hipsZ', 'spineX', 'spineY', 'chestX', 'chestY', 'neckX', 'neckY', 'headX', 'headY',
  'thighRX', 'thighRZ', 'thighLX', 'thighLZ', 'kneeR', 'kneeL', 'footR', 'footL', 'armRX', 'armRZ', 'foreR', 'armLX', 'armLZ', 'foreL', 'clav'];
const pose = (o) => Object.fromEntries(KEYS.map((k) => [k, o[k] ?? 0]));

const STAND = pose({ hipsY: 0.96, thighRZ: 0.03, thighLZ: 0.03, kneeR: -0.04, kneeL: -0.04, footR: 0.04, footL: 0.04, armRZ: 0.1, armLZ: 0.1, foreR: 0.2, foreL: 0.2 });
// Right knee on the ground, left foot planted.
const KNEEL = pose({ hipsY: 0.51, spineX: -0.12, chestX: 0.02, neckX: 0.08, thighRX: -0.05, thighRZ: 0.08, kneeR: -1.45, footR: 0.3, thighLX: 1.45, thighLZ: 0.1, kneeL: -1.15, footL: -0.3, foreR: 0.4, foreL: 0.4 });
// Flat on the belly, chest and head raised to look forward, one leg drawn up.
const PRONE = pose({ hipsY: 0.17, hipsX: -1.5, spineX: 0.12, chestX: 0.22, neckX: 0.55, headX: 0.3, thighRX: -0.05, thighRZ: 0.12, kneeR: -0.1, thighLX: 0.3, thighLZ: 0.4, kneeL: -0.5, footL: 0.2, armRZ: 0.4, armLZ: 0.4 });

const DEATHS = [
  pose({ face: 1, hipsY: 0.13, hipsX: -1.52, hipsZ: 0.05, spineX: 0.05, chestX: 0.08, neckX: 0.25, neckY: 0.5, headX: 0.1, headY: 0.6, thighRX: -0.15, thighRZ: 0.3, kneeR: -0.5, thighLX: 0.1, thighLZ: 0.2, kneeL: -0.15, footR: -0.3, footL: -0.4, armRX: 0.3, armRZ: 0.55, foreR: 0.3, armLX: 2.6, armLZ: 0.3, foreL: 0.4 }),
  pose({ face: -1, hipsY: 0.13, hipsX: 1.5, hipsZ: -0.05, spineX: -0.05, chestX: -0.05, neckX: -0.1, neckY: 0.7, headY: 0.3, thighRX: 0.1, thighRZ: 0.3, kneeR: -0.15, thighLX: 0.45, thighLZ: 0.2, kneeL: -0.6, footR: 0.5, footL: 0.4, armRX: -0.3, armRZ: 1.2, foreR: 0.3, armLX: 0.2, armLZ: 1.3, foreL: 0.2 }),
  pose({ face: 0, hipsY: 0.2, hipsYaw: 0.3, hipsZ: 1.45, spineX: -0.35, chestX: -0.3, neckX: -0.4, headX: -0.1, thighRX: 1.1, kneeR: -1.5, thighLX: 0.8, thighLZ: 0.1, kneeL: -1.1, armRX: 0.9, armRZ: 0.1, foreR: 1.5, armLX: 1.1, armLZ: -0.1, foreL: 1.2 }),
  pose({ face: 1, hipsY: 0.3, hipsX: -0.85, spineX: -0.25, chestX: -0.2, neckX: -0.3, headY: 0.4, thighRX: 1.6, thighRZ: 0.1, kneeR: -2.3, thighLX: 1.5, thighLZ: 0.15, kneeL: -2.2, footR: 0.6, footL: 0.6, armRX: 0.5, armRZ: 0.15, foreR: 0.3, armLX: 0.9, armLZ: 0.1, foreL: 0.2 }),
  pose({ face: 1, hipsY: 0.14, hipsX: -1.5, hipsYaw: 0.5, hipsZ: -0.25, spineY: -0.3, chestX: 0.1, neckX: 0.3, neckY: -0.6, thighRX: 0.5, thighRZ: 0.3, kneeR: -0.3, thighLX: 0.6, thighLZ: 0.6, kneeL: -0.5, armRX: 2.3, armRZ: 0.4, foreR: 0.4, armLX: 0.2, armLZ: 1.0, foreL: 0.3 }),
  pose({ face: -1, hipsY: 0.15, hipsX: 1.45, hipsYaw: -0.3, hipsZ: 0.1, spineX: -0.1, neckX: 0.1, neckY: -0.5, thighRX: 0.9, thighRZ: 0.35, kneeR: -1.3, thighLX: 0.3, thighLZ: 0.15, kneeL: -0.5, footR: 0.3, armRX: -0.1, armRZ: 0.5, foreR: 0.25, armLX: 0.3, armLZ: 1.3, foreL: 0.3 }),
];
DEATHS[0].face = 1; DEATHS[1].face = -1; DEATHS[2].face = 0; DEATHS[3].face = 1; DEATHS[4].face = 1; DEATHS[5].face = -1;

// Weapon holds in the chest bone's space. `aim` puts the butt in the shoulder pocket.
const E = (x, y, z, o) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, o));
const HOLDS = {
  rifle: { low: { p: [0.1, -0.2, -0.24], q: E(-0.6, 0.35, 0.2) }, port: { p: [0.04, -0.06, -0.26], q: E(0.7, 0.9, 0) }, pocket: [0.13, 0.15, -0.12], aimQ: E(0, 0.05, 0) },
  pkm: { low: { p: [0.12, -0.27, -0.22], q: E(-0.25, 0.2, 0.15) }, port: { p: [0.1, -0.22, -0.24], q: E(-0.1, 0.35, 0.2) }, pocket: [0.13, 0.15, -0.12], aimQ: E(0, 0.05, 0) },
  rpg: { low: { p: [0.12, -0.18, -0.25], q: E(-0.45, 0.25, 0.1) }, port: { p: [0.16, 0.24, -0.05], q: E(-0.35, 0, 0) }, pocket: [0.16, 0.24, 0.0], aimQ: E(0, 0.04, 0) },
};
const SLUNG = { p: [0.04, 0.0, 0.22], q: E(Math.PI / 2, 0, 0.6, 'ZYX') };
const HAND_R = E(1.3, 0, 0);
const HAND_L = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.6, 0)).multiply(E(0, 0, Math.PI / 2));
const HAND_BINO = E(1.5, 0, 0);

const REST = {};
for (const n of ['R', 'L']) {
  REST['arm' + n] = new THREE.Vector3(...JOINTS['fore' + n]).sub(new THREE.Vector3(...JOINTS['arm' + n]));
  REST['fore' + n] = new THREE.Vector3(...JOINTS['hand' + n]).sub(new THREE.Vector3(...JOINTS['fore' + n]));
}
const L1 = REST.armR.length(), L2 = REST.foreR.length();
for (const k of Object.keys(REST)) REST[k].normalize();

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _s = new THREE.Vector3(), _d = new THREE.Vector3(), _b = new THREE.Vector3(),
  _e = new THREE.Vector3(), _u = new THREE.Vector3(), _q = new THREE.Quaternion(), _qa = new THREE.Quaternion(), _qi = new THREE.Quaternion(),
  _qw = new THREE.Quaternion(), _pole = new THREE.Vector3();

export function initSoldierAnim(s) {
  const r = s.rand;
  for (const n of ['hips', 'spine', 'chest', 'neck', 'head']) s.bones[n].rotation.order = 'YXZ';
  s.st = {
    p: 0, phase: r() * TAU, aimK: 0, runK: 0, walkK: 0, crawl: 0, binos: 0, t: r() * 100,
    kneel: r() < ({ rpg: 0.6, rifleman: 0.25, mg: 0.15 }[s.variant] ?? 0),
    look: { yaw: 0, pitch: 0, ty: 0, tp: 0, next: 0 }, cur: pose(STAND),
    hold: s.gun === 'pkm' ? HOLDS.pkm : s.gun === 'rpg' ? HOLDS.rpg : HOLDS.rifle,
  };
}

function applyPose(s, P) {
  const b = s.bones;
  b.hips.position.set(0, P.hipsY, 0);
  b.hips.rotation.set(P.hipsX, P.hipsYaw, P.hipsZ);
  b.spine.rotation.set(P.spineX, P.spineY, 0);
  b.chest.rotation.set(P.chestX, P.chestY, 0);
  b.neck.rotation.set(P.neckX, P.neckY, 0);
  b.head.rotation.set(P.headX, P.headY, 0);
  b.thighR.rotation.set(P.thighRX, 0, P.thighRZ);
  b.thighL.rotation.set(P.thighLX, 0, -P.thighLZ);
  b.shinR.rotation.set(P.kneeR, 0, 0); b.shinL.rotation.set(P.kneeL, 0, 0);
  b.footR.rotation.set(P.footR, 0, 0); b.footL.rotation.set(P.footL, 0, 0);
  b.clavR.rotation.set(0, P.clav, 0); b.clavL.rotation.set(0, -P.clav, 0);
}
function applyArms(s, P) {
  const b = s.bones;
  b.armR.rotation.set(P.armRX, 0, P.armRZ); b.armL.rotation.set(P.armLX, 0, -P.armLZ);
  b.foreR.rotation.set(P.foreR, 0, 0); b.foreL.rotation.set(P.foreL, 0, 0);
  b.handR.quaternion.identity(); b.handL.quaternion.identity();
}

// Two-bone IK: put the wrist on `target` with the elbow bent toward `pole`; turn the hand to `handQ`.
function reach(s, n, target, pole, handQ, scale) {
  const arm = s.bones['arm' + n], fore = s.bones['fore' + n], hand = s.bones['hand' + n];
  arm.parent.getWorldQuaternion(_q);
  arm.getWorldPosition(_s);
  const l1 = L1 * scale, l2 = L2 * scale;
  _d.subVectors(target, _s);
  const d = clamp(_d.length(), Math.abs(l1 - l2) + 1e-3, (l1 + l2) * 0.999);
  _d.normalize();
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  _b.copy(pole).addScaledVector(_d, -pole.dot(_d)).normalize();
  _e.copy(_s).addScaledVector(_d, a).addScaledVector(_b, h);
  _w.copy(_s).addScaledVector(_d, d);
  _qi.copy(_q).invert();
  _u.subVectors(_e, _s).normalize().applyQuaternion(_qi);
  arm.quaternion.setFromUnitVectors(REST['arm' + n], _u);
  _qa.copy(_q).multiply(arm.quaternion);
  _u.subVectors(_w, _e).normalize().applyQuaternion(_qi.copy(_qa).invert());
  fore.quaternion.setFromUnitVectors(REST['fore' + n], _u);
  if (handQ) {
    _qa.multiply(fore.quaternion).invert();
    hand.quaternion.copy(_qa).multiply(handQ);
  }
}

// Per frame for a living soldier. `drone` is the drone's world position (or null), `alert` 0..1.
export function animateSoldier(s, { dt, speed, status, drone, alert }) {
  const st = s.st, P = st.cur;
  st.t += dt;
  // Stance: 0 stand, 1 kneel, 2 prone. Going down passes through the kneel.
  const target = status === 'prone' ? 2 : status === 'idle' && st.kneel ? 1 : 0;
  st.p += clamp(target - st.p, -dt * 1.1, dt * 1.5);
  if (st.p < 1) for (const k of KEYS) P[k] = lerp(STAND[k], KNEEL[k], st.p);
  else for (const k of KEYS) P[k] = lerp(KNEEL[k], PRONE[k], st.p - 1);

  // Where is the drone, relative to the body?
  let relYaw = 0, elev = 0, dist = 1e9;
  if (drone) {
    s.root.updateMatrixWorld();
    _v.copy(drone);
    s.root.worldToLocal(_v);
    relYaw = Math.atan2(-_v.x, -_v.z);
    dist = Math.hypot(_v.x, _v.z);
    elev = Math.atan2(_v.y - 1.5, Math.max(1, dist));
  }
  const engaged = dist < 140 && (alert > 0 || dist < 45);
  const moving = speed > 0.15;

  // Gait.
  const stand = clamp(1 - st.p, 0, 1);
  st.walkK += (clamp(speed / 1.3, 0, 1) * stand - st.walkK) * Math.min(1, dt * 6);
  st.runK += (clamp((speed - 2.0) / 2, 0, 1) * stand - st.runK) * Math.min(1, dt * 4);
  const wk = st.walkK, rk = st.runK;
  if (st.p < 1.5) st.phase += dt * TAU * speed / lerp(1.45, 2.6, rk);
  for (const [n, off] of [['R', 0], ['L', Math.PI]]) {
    const ph = st.phase + off;
    P['thigh' + n + 'X'] += wk * (0.05 + 0.1 * rk + lerp(0.42, 0.75, rk) * Math.sin(ph));
    P['knee' + n] -= wk * (0.08 + 0.15 * rk + lerp(0.95, 1.6, rk) * Math.max(0, Math.sin(ph + 1.97)) ** 1.6);
    P['foot' + n] += wk * (0.25 * Math.max(0, Math.sin(ph - 1.6)) - 0.2 * Math.max(0, Math.sin(ph + 2.4)));
    P['arm' + n + 'X'] += wk * (n === 'R' ? -1 : 1) * Math.sin(st.phase) * lerp(0.3, 0.7, rk);
    P['fore' + n] += wk * lerp(0.15, 0.9, rk);
  }
  P.hipsY += wk * ((0.016 + 0.03 * rk) * Math.cos(2 * st.phase) - 0.05 * rk);
  P.hipsYaw += wk * 0.1 * Math.sin(st.phase);
  P.hipsZ += wk * 0.04 * Math.sin(st.phase);
  P.chestY -= wk * 0.14 * Math.sin(st.phase);
  P.spineX -= wk * (0.04 + 0.2 * rk);
  P.chestX -= wk * 0.06 * rk;
  P.neckX += wk * 0.12 * rk;
  // Crawling on the belly.
  st.crawl += ((st.p > 1.6 && moving ? 1 : 0) - st.crawl) * Math.min(1, dt * 4);
  if (st.crawl > 0.01) {
    if (moving) st.phase += dt * TAU * speed / 0.7;
    const c = st.crawl, sn = Math.sin(st.phase);
    P.thighRZ += c * (0.25 + 0.3 * sn); P.thighLZ += c * (0.25 - 0.3 * sn);
    P.thighRX += c * 0.3 * Math.max(0, sn); P.thighLX += c * 0.3 * Math.max(0, -sn) - 0.3 * c;
    P.kneeR -= c * 0.9 * Math.max(0, sn); P.kneeL -= c * (0.9 * Math.max(0, -sn) - 0.5);
    P.hipsZ += c * 0.08 * sn; P.chestY += c * 0.12 * sn;
  }
  // Idle life: breathing, weight shift, glancing around.
  const idle = (1 - wk) * (1 - st.crawl);
  P.chestX += 0.018 * Math.sin(st.t * 1.7);
  P.hipsZ += idle * stand * 0.025 * Math.sin(st.t * 0.37 + s.seed);
  P.thighRX -= idle * stand * 0.03 * Math.sin(st.t * 0.37 + s.seed);
  const L = st.look;
  if (st.t > L.next) { L.next = st.t + 1.5 + s.rand() * 3.5; L.ty = (s.rand() - 0.5) * 1.4; L.tp = (s.rand() - 0.6) * 0.3; }

  // Aim at the drone when it is close or they have been alerted; officers raise binoculars.
  const canAim = !s.officer;
  const aimT = canAim && rk < 0.4 && (engaged || st.p > 1.5) ? 1 : 0;
  st.aimK += (aimT - st.aimK) * Math.min(1, dt * 3);
  const binT = s.officer && engaged && !moving ? 1 : 0;
  st.binos += (binT - st.binos) * Math.min(1, dt * 3);
  const ak = st.aimK;
  const ay = (engaged ? clamp(relYaw, -0.9, 0.9) : 0) * Math.max(ak, st.binos);
  const ap = (engaged ? clamp(elev, -0.3, st.p > 1.5 ? 0.45 : 1.0) : 0) * Math.max(ak, st.binos);
  P.hipsYaw += 0.2 * ay; P.spineY += 0.35 * ay; P.chestY += 0.45 * ay;
  P.spineX += 0.4 * ap; P.chestX += 0.6 * ap;
  P.clav = 0.12 * ak;
  // Head: follow the drone when it is near, else look around.
  const lookYaw = engaged ? clamp(relYaw - ay, -1.2, 1.2) : L.ty * idle;
  const lookPitch = engaged ? clamp(elev - ap, -0.4, 0.9) : L.tp * idle;
  L.yaw += (lookYaw - L.yaw) * Math.min(1, dt * 4);
  L.pitch += (lookPitch - L.pitch) * Math.min(1, dt * 4);
  P.neckY += L.yaw * 0.45; P.headY += L.yaw * 0.55;
  P.neckX += L.pitch * 0.4 - 0.25 * ak * (st.p < 1.5 ? 1 : 0); P.headX += L.pitch * 0.6 - 0.1 * ak;
  applyPose(s, P);

  // Weapon in the chest's space: low ready, port arms when running, or shouldered.
  const H = st.hold, wp = s.wpivot;
  if (s.officer) {
    wp.position.fromArray(SLUNG.p); wp.quaternion.copy(SLUNG.q);
  } else {
    _v.fromArray(H.low.p).lerp(_w.fromArray(H.port.p), rk);
    _q.copy(H.low.q).slerp(H.port.q, rk);
    // Shouldered: keep the gun level in the world however the chest is bent, butt in the pocket.
    const pitchSum = P.hipsX + P.spineX + P.chestX - ap;
    _qw.setFromEuler(new THREE.Euler(-pitchSum, 0, 0)).multiply(H.aimQ);
    _e.fromArray(s.info.butt).applyQuaternion(_qw);
    _w.fromArray(H.pocket).sub(_e);
    wp.position.copy(_v.lerp(_w, ak));
    wp.quaternion.copy(_q.slerp(_qw, ak));
    // Gait bob.
    wp.position.y += wk * 0.012 * Math.sin(2 * st.phase);
  }
  if (s.binos) {
    const b = s.binos;
    if (st.binos > 0.5 && b.parent !== s.bones.head) { s.bones.head.add(b); b.position.set(0, 0.095, -0.17); b.rotation.set(0, 0, 0); }
    if (st.binos <= 0.5 && b.parent !== s.bones.chest) { s.bones.chest.add(b); b.position.set(0, 0.06, -0.21); b.rotation.set(-1.2, 0, 0); }
  }

  // Arms: on the weapon (or binoculars), or swinging free.
  s.root.updateMatrixWorld(true);
  const scale = s.root.scale.y;
  const chestQ = s.bones.chest.getWorldQuaternion(new THREE.Quaternion());
  if (s.officer && st.binos <= 0.5) {
    P.armRX *= 1; applyArms(s, P);
    return;
  }
  const obj = s.officer ? s.binos : s.weapon, info = s.officer ? s.binosInfo : s.info;
  const handR = s.officer ? HAND_BINO : HAND_R, handL = s.officer ? HAND_BINO : HAND_L;
  const tR = obj.localToWorld(new THREE.Vector3().fromArray(info.R)), tL = obj.localToWorld(new THREE.Vector3().fromArray(info.L));
  // Out of reach for the support hand: slide the gun back along its axis.
  if (!s.officer) {
    s.bones.armL.getWorldPosition(_s);
    const over = _s.distanceTo(tL) - (L1 + L2) * scale * 0.97;
    if (over > 0) {
      const back = Math.min(over / scale, 0.18);
      _v.set(0, 0, back).applyQuaternion(wp.quaternion);
      wp.position.add(_v);
      wp.updateMatrixWorld(true);
      obj.localToWorld(tR.fromArray(info.R)); obj.localToWorld(tL.fromArray(info.L));
    }
  }
  obj.getWorldQuaternion(_qw);
  _pole.set(1, -0.7, 0.25).applyQuaternion(chestQ);
  reach(s, 'R', tR, _pole, _q.copy(_qw).multiply(handR), scale);
  _pole.set(-0.5, -1, 0.1).applyQuaternion(chestQ);
  reach(s, 'L', tL, _pole, _q.copy(_qw).multiply(handL), scale);
}

// ---- Deaths -----------------------------------------------------------------------------------

export function killSoldierAnim(s, thrown) {
  const st = s.st, P = st.cur, b = s.bones;
  // Start from the arms where they are now.
  P.armRX = b.armR.rotation.x; P.armRZ = b.armR.rotation.z; P.foreR = b.foreR.rotation.x;
  P.armLX = b.armL.rotation.x; P.armLZ = -b.armL.rotation.z; P.foreL = b.foreL.rotation.x;
  const prone = st.p > 1.5;
  let list = DEATHS;
  if (prone) list = DEATHS.filter((d) => d.face === 1);
  st.dead = { t: 0, air: !!thrown, spin: thrown?.spin ?? 0, vy: 0, pose: list[Math.floor(s.rand() * list.length)], landed: !thrown };
  if (s.binos && s.binos.parent !== b.chest) { b.chest.add(s.binos); s.binos.position.set(0, 0.06, -0.21); }
}

// Called by the owner when a thrown body hits the ground.
export function landSoldier(s) {
  const d = s.st.dead, P = s.st.cur;
  d.air = false; d.landed = true; d.t = 0;
  // Land on the side the tumble left facing the ground.
  const x = ((P.hipsX + Math.PI) % TAU + TAU) % TAU - Math.PI;
  P.hipsX = x;
  const face = Math.abs(x) < 0.4 ? 0 : x < 0 ? 1 : -1;
  const list = DEATHS.filter((p) => p.face === face);
  d.pose = list.length ? list[Math.floor(s.rand() * list.length)] : DEATHS[0];
  d.fast = true;
}

export function animateDeadSoldier(s, dt) {
  const st = s.st, d = st.dead, P = st.cur;
  d.t += dt;
  if (d.air) {
    // Tumbling and flailing through the air.
    const t = d.t;
    P.hipsX += d.spin * dt;
    P.hipsY = lerp(P.hipsY, 0.6, Math.min(1, dt * 4));
    P.armRX = 1.2 * Math.sin(t * 11); P.armRZ = 1.0 + 0.6 * Math.sin(t * 7);
    P.armLX = 1.2 * Math.sin(t * 10 + 2); P.armLZ = 1.0 + 0.6 * Math.sin(t * 8 + 1);
    P.foreR = 0.6 + 0.5 * Math.sin(t * 9); P.foreL = 0.6 + 0.5 * Math.sin(t * 12);
    P.thighRX = 0.6 * Math.sin(t * 9 + 1); P.thighLX = 0.6 * Math.sin(t * 8);
    P.kneeR = -0.6 - 0.4 * Math.sin(t * 7); P.kneeL = -0.6 - 0.4 * Math.sin(t * 10);
    P.spineX = 0.4 * Math.sin(t * 6); P.neckX = 0.5 * Math.sin(t * 9);
  } else {
    // Fall: knees give, the body drops under gravity and settles into the pose.
    const T = d.pose, rate = d.fast ? 14 : 1.5 + 12 * clamp(d.t / 0.7, 0, 1) ** 2;
    const k = 1 - Math.exp(-dt * rate), kl = 1 - Math.exp(-dt * (d.fast ? 12 : 6));
    for (const key of KEYS) {
      if (key === 'hipsY') continue;
      P[key] += (T[key] - P[key]) * (key.startsWith('hips') || key.startsWith('spine') || key.startsWith('chest') ? k : kl);
    }
    if (P.hipsY > T.hipsY) {
      d.vy -= 9.8 * dt;
      P.hipsY = Math.max(T.hipsY, P.hipsY + d.vy * dt);
    } else P.hipsY += (T.hipsY - P.hipsY) * kl;
  }
  applyPose(s, P);
  applyArms(s, P);
}
