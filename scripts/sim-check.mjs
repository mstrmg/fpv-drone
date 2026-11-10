// Headless flight-model sanity checks: `npm run test:sim`.
import { createTestLevel } from '../src/sim/level.js';
import { createSim, SIM_HZ } from '../src/sim/index.js';
import { Quaternion, Vector3 } from 'three';

const level = createTestLevel();
const dt = 1 / SIM_HZ;
let failures = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${info}`); if (!ok) failures++; };

function blank() { return { throttle: 0, yaw: 0, pitch: 0, roll: 0, arm: false, reset: false, toggleMode: false, toggleView: false, pause: false, fire: false }; }

async function fresh() {
  const sim = await createSim({ level });
  const c = blank();
  c.arm = true; sim.step(dt, c); c.arm = false;
  return { sim, c };
}
const run = (sim, c, secs, each) => { for (let i = 0; i < secs * SIM_HZ; i++) { sim.step(dt, c); each?.(i); } };

// 1. Hover throttle
{
  let lo = 0, hi = 1;
  for (let k = 0; k < 14; k++) {
    const mid = (lo + hi) / 2;
    const { sim, c } = await fresh();
    sim._body.setTranslation({ x: 0, y: 30, z: 0 }, true);   // start at rest in the air
    c.throttle = mid; run(sim, c, 0.6);
    const vy = sim.state.drone.velocity[1];
    if (vy > 0) hi = mid; else lo = mid;
  }
  check('hover throttle 25-40%', lo > 0.25 && lo < 0.4, `${(lo * 100).toFixed(1)}%`);
  globalThis.hoverThrottle = lo;
  const { sim, c } = await fresh();
  c.throttle = lo; run(sim, c, 3);
  check('hover current 6-20 A', sim.state.hud.currentA > 6 && sim.state.hud.currentA < 20, `${sim.state.hud.currentA.toFixed(1)} A, ${sim.state.hud.batteryV.toFixed(2)} V`);
}

// 2. Full throttle climb
{
  const { sim, c } = await fresh();
  c.throttle = 1; let maxA = 0, prevVy = 0;
  run(sim, c, 3, () => { const vy = sim.state.drone.velocity[1]; maxA = Math.max(maxA, (vy - prevVy) / dt); prevVy = vy; });
  check('full-throttle accel 3.5-6 g', maxA / 9.81 > 3.5 && maxA / 9.81 < 6.5, `${(maxA / 9.81).toFixed(2)} g net, vy=${prevVy.toFixed(1)} m/s after 3 s`);
  check('sag under full throttle', sim.state.hud.batteryV < 24, `${sim.state.hud.batteryV.toFixed(2)} V @ ${sim.state.hud.currentA.toFixed(0)} A`);
}

// 3. Roll rate at full stick
{
  const { sim, c } = await fresh();
  c.throttle = 0.6; run(sim, c, 1.5);
  c.roll = 1; let peak = 0;
  run(sim, c, 0.4, () => {
    const q = new Quaternion().fromArray(sim.state.drone.quaternion).invert();
    const w = new Vector3().fromArray(sim.state.drone.angularVelocity).applyQuaternion(q);
    peak = Math.max(peak, -w.z * 180 / Math.PI);
  });
  check('full roll rate ~670 deg/s (≤15% overshoot)', peak > 640 && peak < 770, `${peak.toFixed(0)} deg/s`);
  // Response time: half-stick step, time to 90% of target
  const { sim: s2, c: c2 } = await fresh();
  c2.throttle = 0.6; run(s2, c2, 1.5);
  c2.pitch = 0.5; let t90 = null; let i0 = 0;
  const target = 200 * 0.5 + 470 * 0.5 * (0.5 ** 5 * 0.54 + 0.5 * 0.46);
  run(s2, c2, 0.3, (i) => {
    const q = new Quaternion().fromArray(s2.state.drone.quaternion).invert();
    const w = new Vector3().fromArray(s2.state.drone.angularVelocity).applyQuaternion(q);
    if (t90 === null && -w.x * 180 / Math.PI > 0.9 * target) t90 = (i - i0) * dt;
  });
  check('pitch step response < 150 ms', t90 !== null && t90 < 0.15, `${t90 === null ? 'never' : (t90 * 1000).toFixed(0) + ' ms'} to 90% of ${target.toFixed(0)} deg/s`);
}

// 4. Forward flight top speed (ANGLE mode holds a fixed 55° tilt)
{
  const { sim, c } = await fresh();
  c.toggleMode = true; sim.step(dt, c); c.toggleMode = false;
  c.throttle = 0.6; run(sim, c, 1.5);
  c.throttle = 1; c.pitch = 1; run(sim, c, 8);
  const v = sim.state.drone.velocity;
  const hs = Math.hypot(v[0], v[2]) * 3.6;
  check('angle-mode (55°) top speed 90-170 km/h', hs > 90 && hs < 170, `${hs.toFixed(0)} km/h horiz, vy=${v[1].toFixed(1)}, alt=${sim.state.hud.altitudeM.toFixed(0)} m`);
  // Stop: release stick, drag + rotor drag should slow it
}

// 5. Crash into the ground
{
  const { sim, c } = await fresh();
  c.throttle = 0.8; run(sim, c, 2);
  c.throttle = 0; c.pitch = 0; let crashed = null;
  // flip upside down and power into the ground
  c.roll = 1; run(sim, c, 0.27); c.roll = 0; c.throttle = 1;
  run(sim, c, 4, () => { for (const e of sim.drainEvents()) if (e.type === 'crash') crashed ??= e; });
  check('power-dive into ground crashes', !!crashed, crashed ? `impact ${crashed.impactSpeed.toFixed(1)} m/s` : `alt ${sim.state.hud.altitudeM.toFixed(1)}`);
}

// 6. Gentle landing does not crash
{
  const { sim, c } = await fresh();
  c.throttle = 0.5; run(sim, c, 1.5);
  c.throttle = globalThis.hoverThrottle - 0.04; let crashed = false;
  run(sim, c, 20, () => { for (const e of sim.drainEvents()) if (e.type === 'crash') crashed = true; });
  check('soft landing survives', !crashed && sim.state.hud.altitudeM < 0.2, `alt ${sim.state.hud.altitudeM.toFixed(2)} m`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
