// Headless flight-model sanity checks: `npm run test:sim`.
import { createTestLevel } from '../src/sim/level.js';
import { createSim, SIM_HZ } from '../src/sim/index.js';
import { Quaternion, Vector3 } from 'three';

const level = createTestLevel();
const dt = 1 / SIM_HZ;
let failures = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${info}`); if (!ok) failures++; };

function blank() { return { throttle: 0, yaw: 0, pitch: 0, roll: 0, arm: false, reset: false, toggleMode: false, toggleView: false, pause: false, fire: false }; }

async function fresh(settings = { warhead: 'none' }) {
  const sim = await createSim({ level, settings });
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

// 7. Flying sideways into a wall at moderate speed breaks the props
{
  const { sim, c } = await fresh();
  c.toggleMode = true; sim.step(dt, c); c.toggleMode = false;
  const gy = level.terrain.heightAt(40, -45);
  sim._body.setTranslation({ x: 40, y: gy + 4, z: -45 }, true);
  sim._body.setLinvel({ x: 0, y: 0, z: -6 }, true);
  c.throttle = globalThis.hoverThrottle; let crashed = null;
  run(sim, c, 3, () => { for (const e of sim.drainEvents()) if (e.type === 'crash') crashed ??= e; });
  check('6 m/s into a wall breaks props', !!crashed, crashed ? `impact ${crashed.impactSpeed.toFixed(1)} m/s` : 'survived');
}

// 8. Prop wash shows up when dropping straight down under power
{
  const { sim, c } = await fresh();
  sim._body.setTranslation({ x: 0, y: 60, z: 0 }, true);
  sim._body.setLinvel({ x: 0, y: -10, z: 0 }, true);
  c.throttle = 0.5; let peak = 0;
  run(sim, c, 0.5, () => { peak = Math.max(peak, sim.flightModel.propWash); });
  check('prop wash when sinking through downwash', peak > 0.5, `peak ${peak.toFixed(2)}`);
}

// ---------------- Warhead ----------------
const collect = (sim, into) => { for (const e of sim.drainEvents()) into.push(e); };

// 9. Payload makes it heavier
{
  let lo = 0, hi = 1;
  for (let k = 0; k < 14; k++) {
    const mid = (lo + hi) / 2;
    const { sim, c } = await fresh({ warhead: 'rpg-heat' });
    sim._body.setTranslation({ x: 0, y: 30, z: 0 }, true);
    c.throttle = mid; run(sim, c, 0.6);
    if (sim.state.drone.velocity[1] > 0) hi = mid; else lo = mid;
  }
  check('hover with 1.2 kg RPG warhead 40-60%', lo > 0.4 && lo < 0.6, `${(lo * 100).toFixed(1)}%`);
  globalThis.hoverLoaded = lo;
}

// 10. Safe near the launch point: fire does nothing, a crash is just a crash
{
  const { sim, c } = await fresh({ warhead: 'rpg-heat' });
  const ev = [];
  c.throttle = 0.7; run(sim, c, 1.0, () => collect(sim, ev));
  c.fire = true; sim.step(dt, c); c.fire = false;
  check('warhead SAFE near launch', sim.state.hud.warhead === 'SAFE' && sim.state.hud.warnings.includes('WARHEAD SAFE') && !ev.some((e) => e.type === 'explosion'),
    `${sim.state.hud.warhead}, ${sim.state.hud.warheadArmInM} m to arm`);
}

// 11. Armed after 25 m, contact fuze on the ground, static, then a new drone
{
  const { sim, c } = await fresh({ warhead: 'rpg-heat' });
  const ev = [];
  sim._body.setTranslation({ x: 0, y: level.terrain.heightAt(0, -60) + 30, z: -60 }, true);
  c.throttle = globalThis.hoverLoaded; run(sim, c, 0.2, () => collect(sim, ev));
  const armed = sim.state.hud.warhead;
  c.throttle = 0; run(sim, c, 4, () => collect(sim, ev));
  const ex = ev.find((e) => e.type === 'explosion');
  const lost = ev.find((e) => e.type === 'drone_lost');
  check('arms after 25 m', armed === 'ARMED', armed);
  check('impact detonates against ground', ex && ex.surface === 'ground' && ex.chargeKg > 0 && ex.cause === 'impact',
    ex ? `${ex.surface}, normal ${ex.normal.map((v) => v.toFixed(2))}` : 'no explosion');
  check('drone_lost + feed lost', !!lost && sim.state.link.lost && sim.state.drone.destroyed, lost ? `respawn in ${lost.respawnIn} s` : 'missing');
  run(sim, c, 3.2, () => collect(sim, ev));
  check('next drone after 3 s', ev.some((e) => e.type === 'reset') && !sim.state.link.lost && !sim.state.drone.destroyed && sim.state.hud.warhead === 'SAFE', `${sim.state.hud.warhead}`);
}

// 12. Hitting a building reports the building
{
  const { sim, c } = await fresh({ warhead: 'rpg-heat', wind: false });
  const ev = [];
  c.toggleMode = true; sim.step(dt, c); c.toggleMode = false;
  const gy = level.terrain.heightAt(40, -45);
  sim._body.setTranslation({ x: 40, y: gy + 6, z: -48 }, true); // past the tree line at z≈-40
  c.throttle = globalThis.hoverLoaded + 0.1; c.pitch = 0.6; run(sim, c, 6, () => collect(sim, ev));
  const ex = ev.find((e) => e.type === 'explosion');
  check('impact on building', ex && ex.surface === 'building' && ex.objectId, ex ? `${ex.surface} ${ex.objectId} normal ${ex.normal.map((v) => v.toFixed(2))}` : 'no explosion');
}

// 13. Blast falloff, fragments and cover
{
  const { sim, c } = await fresh({ warhead: 'frag' });
  const ev = [];
  const gy = level.terrain.heightAt(40, -40);
  sim._body.setTranslation({ x: 40, y: gy + 1, z: -40 }, true);
  sim.state.drone.warhead.state = 'armed';
  const got = {};
  const target = (id, pos) => sim.damage.register({ id, radius: 0.3, position: () => pos, applyDamage: (h) => { got[id] = h; return Math.min(1, h.blast + h.fragments); } });
  target('d1', [40, gy + 1, -38]);
  target('d4', [44, gy + 1, -40]);
  target('d10', [30, gy + 1, -40]);
  target('d40', [80, gy + 1, -40]);
  sim.detonate();
  collect(sim, ev);
  const tot = (id) => got[id] ? got[id].blast + got[id].fragments : 0;
  check('damage falls off with distance', tot('d1') > tot('d4') && tot('d4') > tot('d10') && tot('d10') > 0 && !got.d40,
    ['d1', 'd4', 'd10', 'd40'].map((k) => `${k}=${tot(k).toFixed(2)}`).join(' '));
  check('hit events emitted', ev.filter((e) => e.type === 'hit').length >= 3, `${ev.filter((e) => e.type === 'hit').length} hits`);
}
{
  // Same distance, one target in the open and one behind the 12 m building at (40, -60).
  const { sim } = await fresh({ warhead: 'frag' });
  const gy = level.terrain.heightAt(40, -48);
  sim._body.setTranslation({ x: 40, y: gy + 1.5, z: -48 }, true);
  sim.state.drone.warhead.state = 'armed';
  const got = {};
  const target = (id, pos) => sim.damage.register({ id, radius: 0.3, position: () => pos, applyDamage: (h) => { got[id] = h; return h.blast + h.fragments; } });
  target('cover', [40, level.terrain.heightAt(40, -69) + 1, -69]);
  target('open', [40 + 21, level.terrain.heightAt(61, -48) + 1, -48]);
  sim.detonate();
  check('building blocks fragments', got.cover && got.cover.fragments === 0 && !got.cover.lineOfSight, got.cover ? `blast ${got.cover.blast.toFixed(3)} frags ${got.cover.fragments}` : 'not hit');
  check('open target at same range takes fragments', got.open && got.open.fragments > 0, got.open ? `frags ${got.open.fragments.toFixed(3)}` : 'not hit');
}

// ---------------- Enemies ----------------
const kindOf = (sim, kind, n = 0) => sim.state.entities.filter((e) => e.kind === kind)[n];
async function boom(warhead, target, offset) {
  const { sim } = await fresh({ warhead, wind: false });
  const e = kindOf(sim, target);
  const [fx, fz] = [-Math.sin(Math.atan2(-e.velocity[0] || 0, 0)), 0]; void fx; void fz;
  sim._body.setTranslation({ x: e.position[0] + offset[0], y: e.position[1] + offset[1], z: e.position[2] + offset[2] }, true);
  sim.state.drone.warhead.state = 'armed';
  sim.detonate();
  const ev = sim.drainEvents();
  return { sim, e, ev };
}

// 14. Truck dies to a HEAT hit; frag kills infantry but barely scratches a tank
{
  const r = await boom('rpg-heat', 'truck', [0, 3.2, 0]);
  check('HEAT top hit destroys truck', r.e.status === 'destroyed' && r.e.onFire && r.ev.some((x) => x.type === 'entity_destroyed' && x.cause === 'jet'), `health ${r.e.health.toFixed(2)}`);
  const f = await boom('frag', 'infantry', [0, 1, 1.5]);
  check('frag kills nearby infantry', f.e.status === 'destroyed', `health ${f.e.health.toFixed(2)}`);
  const t = await boom('frag', 'tank', [0, 3, 0]);
  check('frag barely hurts a tank', t.e.status !== 'destroyed' && t.e.health > 0.8, `health ${t.e.health.toFixed(2)}`);
}

// 15. Tank armour: front hit survives, top hit on the ammo kills and cooks off
{
  const front = await boom('rpg-heat', 'tank', [-3.9, 1.2, 0]);
  const hit = front.ev.find((x) => x.type === 'hit' && x.entityId === front.e.id);
  check('tank survives a frontal HEAT hit', front.e.status !== 'destroyed' && front.e.health > 0.3 && front.e.health < 0.8 && hit?.source === 'jet', `health ${front.e.health.toFixed(2)}`);
  const { sim, e } = await boom('rpg-heat', 'tank', [0, 2.7, 0]);
  const ev = [];
  run(sim, blank(), 6, () => collect(sim, ev));
  const cook = ev.find((x) => x.type === 'explosion' && x.cause === 'cookoff');
  const infantryHurt = sim.state.entities.filter((x) => x.kind === 'infantry' && x.health < 1).length;
  check('tank top hit kills it', e.status === 'destroyed', `health ${e.health.toFixed(2)}`);
  check('ammo cook-off hurts nearby troops', !!cook && cook.kind === 'ammo' && infantryHurt >= 2, `${cook ? cook.kind : 'no cook-off'}, ${infantryHurt} infantry hurt`);
}

// 16. Patrol, notice the drone, flee or hit the dirt
{
  const { sim, c } = await fresh({ warhead: 'rpg-heat' });
  const t0 = kindOf(sim, 'truck').position.slice();
  run(sim, c, 15);
  const t1 = kindOf(sim, 'truck').position;
  check('truck patrols', Math.hypot(t1[0] - t0[0], t1[2] - t0[2]) > 15, `${Math.hypot(t1[0] - t0[0], t1[2] - t0[2]).toFixed(0)} m in 15 s`);
  const squad = sim.state.entities.filter((e) => e.kind === 'infantry').slice(7);
  sim._body.setTranslation({ x: squad[0].position[0] + 12, y: squad[0].position[1] + 10, z: squad[0].position[2] + 12 }, true);
  sim._body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  c.throttle = globalThis.hoverLoaded; const ev = [];
  run(sim, c, 4, () => collect(sim, ev));
  const reacting = squad.filter((e) => e.status === 'fleeing' || e.status === 'prone').length;
  check('infantry notice the drone and react', reacting >= 3 && ev.some((x) => x.type === 'entity_alerted'), `${reacting}/${squad.length} fleeing or prone`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
