// Quadcopter flight model: rates → rate controller → mixer → motors (with spin-up
// lag) → thrust/torque, plus aerodynamic drag and a simple battery.
// Pure math; the physics world integrates the forces it returns.
//
// Body frame (Three.js): +X right, +Y up, −Z forward.
// Motor order: 0 FL, 1 FR, 2 RR, 3 RL.

import { Quaternion, Vector3 } from 'three';

// Roughly a 7" Ukrainian-style strike quad (6S, ~1.1 kg without payload).
export const DEFAULT_AIRFRAME = {
  mass: 1.1,                       // kg (frame + battery + camera + VTX)
  payloadMass: 0,                  // kg, warhead added in M2
  inertia: [0.0085, 0.015, 0.0085],// kg·m² about body x, y, z
  armLength: 0.115,                // m, |x| and |z| of each motor (≈ 325 mm diagonal)
  maxThrustPerMotor: 16.5,         // N at 4.2 V/cell, no sag (~1.7 kgf)
  yawTorquePerThrust: 0.016,       // m, reaction torque / thrust
  motorTau: 0.035,                 // s, rotor spin-up time constant
  motorTauDown: 0.05,              // s, spin-down is slower (no active braking)
  idleThrust: 0.012,               // fraction of max thrust at zero throttle (airmode idle)
  throttleExpo: 1.5,               // thrust fraction = throttle^expo (prop thrust ∝ rpm²)
  // Drag: F = -k * |v| * v per body axis (k = ½ρCdA)
  dragK: [0.02, 0.035, 0.016],     // side, vertical, forward
  rotorDrag: 0.09,                 // N/(m/s) per unit thrust fraction, in-plane "H-force"
  angularDrag: 0.0012,             // N·m/(rad/s)
};

// Betaflight "Actual" rates, deg/s.
export const DEFAULT_RATES = {
  roll: { center: 200, max: 670, expo: 0.54 },
  pitch: { center: 200, max: 670, expo: 0.54 },
  yaw: { center: 200, max: 500, expo: 0.4 },
};

export const DEFAULT_CONTROLLER = {
  rateP: [22, 16, 22],   // 1/s, angular accel per rad/s of rate error (x, y, z)
  rateI: [30, 20, 30],
  rateD: [0.35, 0, 0.35],// damping on measured angular acceleration
  iLimit: 4,             // rad/s·s
  angleP: 6,             // ANGLE mode: rad/s per rad of attitude error
  maxAngleDeg: 55,
};

export const DEFAULT_BATTERY = {
  cells: 6,
  capacityMah: 3300,     // 6S LiPo
  internalResistance: 0.025, // ohm, whole pack
  maxCurrent: 110,       // A with all motors at full RPM (current ∝ rpm³)
  idleCurrent: 0.8,      // A (camera, VTX, FC)
};

const DEG = Math.PI / 180;

export function actualRate(stick, { center, max, expo }) {
  const a = Math.abs(stick);
  const expof = a * (Math.pow(stick, 5) * expo + stick * (1 - expo));
  return (stick * center + Math.max(0, max - center) * expof) * DEG;
}

// Li-ion open-circuit voltage per cell vs state of charge (0..1).
function cellOcv(soc) {
  const pts = [[0, 3.0], [0.05, 3.3], [0.1, 3.45], [0.3, 3.6], [0.5, 3.72], [0.7, 3.88], [0.9, 4.05], [1, 4.2]];
  for (let i = 1; i < pts.length; i++) {
    if (soc <= pts[i][0]) {
      const [s0, v0] = pts[i - 1], [s1, v1] = pts[i];
      return v0 + (v1 - v0) * (soc - s0) / (s1 - s0);
    }
  }
  return 4.2;
}

const _q = new Quaternion();
const _qInv = new Quaternion();
const _v = new Vector3();
const _w = new Vector3();

export class FlightModel {
  constructor({ airframe = DEFAULT_AIRFRAME, rates = DEFAULT_RATES, controller = DEFAULT_CONTROLLER, battery = DEFAULT_BATTERY } = {}) {
    this.airframe = { ...airframe };
    this.rates = rates;
    this.ctl = controller;
    this.batt = battery;
    this.motorRpm = new Float32Array(4);   // normalised 0..1
    this.motorCmd = new Float32Array(4);   // thrust fraction 0..1
    this.motorThrust = new Float32Array(4);// N
    this.iTerm = new Vector3();
    this.prevW = new Vector3();
    this.mode = 'ACRO';
    this.armed = false;
    this.resetBattery();
    // Outputs (body frame unless noted)
    this.forceWorld = new Vector3();
    this.torqueWorld = new Vector3();
    this.rateTarget = new Vector3();
  }

  get totalMass() { return this.airframe.mass + this.airframe.payloadMass; }

  resetBattery() {
    this.soc = 1;
    this.mAhUsed = 0;
    this.current = 0;
    this.voltage = this.batt.cells * 4.2;
  }

  reset() {
    this.motorRpm.fill(0);
    this.motorCmd.fill(0);
    this.motorThrust.fill(0);
    this.iTerm.set(0, 0, 0);
    this.prevW.set(0, 0, 0);
    this.armed = false;
  }

  // Thrust at full command scales with voltage² (motor KV × V sets max RPM).
  get thrustScale() {
    const r = this.voltage / (this.batt.cells * 4.2);
    return r * r;
  }

  /**
   * @param {object} controls  {throttle, yaw, pitch, roll}
   * @param {number[]} q       body→world quaternion [x,y,z,w]
   * @param {number[]} vel     world linear velocity
   * @param {number[]} angVel  world angular velocity
   * @param {number} dt
   */
  step(controls, q, vel, angVel, dt) {
    const af = this.airframe;
    _q.fromArray(q);
    _qInv.copy(_q).invert();
    const wBody = _w.fromArray(angVel).applyQuaternion(_qInv);

    // --- Rate targets (body frame). Stick forward = nose down = −x rotation.
    const rt = this.rateTarget;
    if (this.mode === 'ANGLE') {
      const maxA = this.ctl.maxAngleDeg * DEG;
      // Desired tilt as a body-up vector, compared with the current one.
      const upBody = _v.set(0, 1, 0).applyQuaternion(_qInv); // world up seen in body frame
      const wantPitch = -controls.pitch * maxA; // nose down when stick forward
      const wantRoll = -controls.roll * maxA;
      // current pitch/roll (small-angle-safe via atan2 of world-up in body frame)
      const curPitch = Math.atan2(-upBody.z, upBody.y);
      const curRoll = Math.atan2(upBody.x, upBody.y);
      rt.x = this.ctl.angleP * (wantPitch - curPitch);
      rt.z = this.ctl.angleP * (wantRoll - curRoll);
      const lim = 8;
      rt.x = Math.max(-lim, Math.min(lim, rt.x));
      rt.z = Math.max(-lim, Math.min(lim, rt.z));
    } else {
      rt.x = -actualRate(controls.pitch, this.rates.pitch);
      rt.z = -actualRate(controls.roll, this.rates.roll);
    }
    rt.y = -actualRate(controls.yaw, this.rates.yaw);

    // --- Rate PI controller → desired body torque.
    const [Ix, Iy, Iz] = af.inertia;
    const ex = rt.x - wBody.x, ey = rt.y - wBody.y, ez = rt.z - wBody.z;
    const { rateP: P, rateI: I, rateD: D, iLimit } = this.ctl;
    const dwx = (wBody.x - this.prevW.x) / dt, dwy = (wBody.y - this.prevW.y) / dt, dwz = (wBody.z - this.prevW.z) / dt;
    this.prevW.copy(wBody);
    const thrOk = this.armed;
    if (thrOk) {
      this.iTerm.x = clamp(this.iTerm.x + ex * dt, -iLimit, iLimit);
      this.iTerm.y = clamp(this.iTerm.y + ey * dt, -iLimit, iLimit);
      this.iTerm.z = clamp(this.iTerm.z + ez * dt, -iLimit, iLimit);
    }
    const tx = Ix * (P[0] * ex + I[0] * this.iTerm.x - D[0] * dwx);
    const ty = Iy * (P[1] * ey + I[1] * this.iTerm.y - D[1] * dwy);
    const tz = Iz * (P[2] * ez + I[2] * this.iTerm.z - D[2] * dwz);

    // --- Mixer (in thrust-fraction units of one motor at max thrust).
    const Tmax = af.maxThrustPerMotor * this.thrustScale;
    const a = af.armLength;
    const kq = af.yawTorquePerThrust;
    const thr = clamp(controls.throttle, 0, 1);
    const collective = Math.pow(thr, af.throttleExpo); // per-motor thrust fraction
    // Positions: FL(-a,-a) FR(+a,-a) RR(+a,+a) RL(-a,+a) as (x,z). spin: FL,RR = +1 ; FR,RL = -1
    // τx = Σ -z_i T_i ; τz = Σ x_i T_i ; τy = Σ s_i kq T_i
    const cx = tx / (4 * a * Tmax), cz = tz / (4 * a * Tmax), cy = ty / (4 * kq * Tmax);
    const cmd = this.motorCmd;
    cmd[0] = +cx - cz + cy; // FL: -z=+a, x=-a, s=+1
    cmd[1] = +cx + cz - cy; // FR: -z=+a, x=+a, s=-1
    cmd[2] = -cx + cz + cy; // RR: -z=-a, x=+a, s=+1
    cmd[3] = -cx - cz - cy; // RL: -z=-a, x=-a, s=-1
    // Airmode: keep the differential intact, shift/scale collective to fit [idle, 1].
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 4; i++) { lo = Math.min(lo, cmd[i]); hi = Math.max(hi, cmd[i]); }
    const idle = af.idleThrust;
    const span = hi - lo;
    const room = 1 - idle;
    let scale = 1;
    if (span > room) scale = room / span;
    let base = clamp(collective, idle, 1);
    base = clamp(base, idle - lo * scale, 1 - hi * scale);
    for (let i = 0; i < 4; i++) cmd[i] = this.armed ? clamp(base + cmd[i] * scale, 0, 1) : 0;

    // --- Motors: first-order RPM lag. Thrust ∝ rpm².
    let thrustSum = 0, yawReaction = 0, txOut = 0, tzOut = 0, powerSum = 0;
    const sx = [-a, a, a, -a], sz = [-a, -a, a, a], spin = [1, -1, 1, -1];
    for (let i = 0; i < 4; i++) {
      const target = Math.sqrt(cmd[i]);
      const tau = target > this.motorRpm[i] ? af.motorTau : af.motorTauDown;
      this.motorRpm[i] += (target - this.motorRpm[i]) * (1 - Math.exp(-dt / tau));
      const T = Tmax * this.motorRpm[i] * this.motorRpm[i];
      this.motorThrust[i] = T;
      thrustSum += T;
      txOut += -sz[i] * T;
      tzOut += sx[i] * T;
      yawReaction += spin[i] * kq * T;
      powerSum += Math.pow(this.motorRpm[i], 3);
    }

    // --- Aero in body frame.
    const vBody = _v.fromArray(vel).applyQuaternion(_qInv);
    const speed = vBody.length();
    const fx = -af.dragK[0] * speed * vBody.x - af.rotorDrag * (thrustSum / (4 * Tmax)) * 4 * vBody.x;
    const fy = thrustSum - af.dragK[1] * speed * vBody.y;
    const fz = -af.dragK[2] * speed * vBody.z - af.rotorDrag * (thrustSum / (4 * Tmax)) * 4 * vBody.z;
    this.forceWorld.set(fx, fy, fz).applyQuaternion(_q);

    const ad = af.angularDrag;
    this.torqueWorld.set(txOut - ad * wBody.x, yawReaction - ad * wBody.y, tzOut - ad * wBody.z).applyQuaternion(_q);

    // --- Battery.
    const b = this.batt;
    this.current = b.idleCurrent + (this.armed ? b.maxCurrent * powerSum / 4 : 0);
    const used = this.current * dt / 3.6; // mAh
    this.mAhUsed += used;
    this.soc = Math.max(0, 1 - this.mAhUsed / b.capacityMah);
    const ocv = cellOcv(this.soc) * b.cells;
    this.voltage = Math.max(0, ocv - this.current * b.internalResistance);
  }
}

function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
