// Simulated damage for vehicles (crew seats, components, shaped-charge jet and spall) and
// infantry (body zones, wounded states). Pure game logic: entities.js owns the bodies, the AI
// and the events' delivery; this file decides what a hit does.
//
// Vehicle frame: hull-local, +X right, +Y up from the ground, −Z forward.
//
// env = { time, rand(), emit(event), toLocal([x,y,z]) → [x,y,z], dirLocal([x,y,z]) → [x,y,z] }

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const stateOf = (hp) => (hp < 0.2 ? 'destroyed' : hp <= 0.6 ? 'damaged' : 'ok');
const alive = (c) => c.state === 'ok' || c.state === 'wounded';
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

// ---------------------------------------------------------------- vehicles

export function initVehicle(e, rand) {
  const def = e.def, [w, h, d] = def.size;
  const pos = (f) => [(f[0] * w) / 2, f[1] * h, (f[2] * d) / 2];
  const crew = def.seats.map((s) => ({
    role: s.role, state: 'ok', visible: rand() < (s.visible ?? 0), position: pos(s.p), exposure: s.exposure ?? def.crewExposure ?? 0.6,
  }));
  const comps = {};
  for (const [name, part] of Object.entries(def.parts)) {
    if (part) comps[name] = { hp: 1, state: 'ok', position: pos(part.p), radius: part.r, external: !!part.external };
  }
  if (def.locomotion === 'tracks') {
    comps.trackL = { hp: 1, state: 'ok', position: [-w / 2, 0.2 * h, 0], radius: d * 0.3, external: true };
    comps.trackR = { hp: 1, state: 'ok', position: [w / 2, 0.2 * h, 0], radius: d * 0.3, external: true };
  } else {
    comps.wheels = { hp: 1, state: 'ok', position: [0, 0.15 * h, 0], radius: d * 0.4, external: true };
  }
  e.v = {
    crew, comps, fire: 'none', fireStart: -1, escalateAt: -1, fullFireAt: -1, crewBurnAt: -1, burnedOut: false, catastrophic: false,
    abandoned: false, bailing: false, bailAt: -1, bailUntil: -1, cookoffAt: -1, cookoffDone: false, smouldering: false,
    kill: 'none', mobility: 'ok', firepower: 'ok', operational: true, crewAlive: crew.length, armed: !!comps.gun, smoke: 'none',
  };
}

export function vehicleHealth(e) {
  const v = e.v;
  if (v.catastrophic || v.burnedOut) return 0;
  const hps = Object.values(v.comps).map((c) => clamp01(c.hp));
  const mean = hps.reduce((a, b) => a + b, 0) / hps.length;
  return clamp01(0.35 * mean + 0.35 * (v.crewAlive / v.crew.length) + 0.3 * (v.operational ? 1 : 0));
}

export function hatchState(v, out) {
  const open = (roles) => v.crew.some((c) => roles.includes(c.role) && (c.visible || ((v.bailing || v.abandoned) && c.state !== 'dead')))
    || ((v.bailing || v.abandoned) && v.crew.some((c) => roles.includes(c.role)));
  out.driver = open(['driver']); out.commander = open(['commander']); out.gunner = open(['gunner']); out.rear = open(['troop', 'loader']);
  return out;
}

/** Recompute everything derived from components and crew; emit events for changes. */
export function evaluateVehicle(e, env) {
  const v = e.v, c = v.comps;
  v.crewAlive = v.crew.filter(alive).length;
  for (const [name, p] of Object.entries(c)) {
    const st = stateOf(p.hp);
    if (st !== p.state) {
      const worse = (st === 'destroyed' && p.state !== 'destroyed') || (st === 'damaged' && p.state === 'ok');
      p.state = st;
      if (worse) env.emit({ type: 'component_damaged', entityId: e.id, component: name, state: st });
    }
  }
  const driver = v.crew.find((x) => x.role === 'driver');
  const driverOk = !!driver && alive(driver);
  const gunner = v.crew.find((x) => x.role === 'gunner') ?? v.crew.find((x) => x.role === 'commander');
  const gunnerOk = !!gunner && alive(gunner);

  const gear = c.wheels ? c.wheels.hp : Math.min(c.trackL.hp, c.trackR.hp);
  let mob = 'ok';
  if (v.catastrophic || v.burnedOut || !driverOk || c.engine.hp < 0.2 || gear < (c.wheels ? 0.1 : 0.2)) mob = 'immobilized';
  else if (c.engine.hp < 0.6 || gear < (c.wheels ? 0.5 : 0.6) || driver.state === 'wounded') mob = 'slow';

  v.armed = !!c.gun;
  let fp = 'disabled'; // unarmed vehicles report 'disabled'
  if (v.armed && !v.catastrophic && !v.burnedOut) {
    if (c.gun.hp < 0.2 || !gunnerOk) fp = 'disabled';
    else if ((c.optics && c.optics.hp < 0.2) || (c.turret && c.turret.hp < 0.2) || c.gun.hp < 0.6 || gunner.state === 'wounded') fp = 'degraded';
    else fp = 'ok';
  }
  v.mobility = mob; v.firepower = fp;
  v.operational = v.crewAlive > 0 && !v.catastrophic && !v.burnedOut && (mob !== 'immobilized' || (v.armed && fp !== 'disabled'));

  v.smoke = v.catastrophic || v.fire === 'full' || v.fire === 'engine' || c.engine.hp < 0.2 ? 'heavy'
    : c.engine.hp < 0.6 || v.smouldering ? 'light' : 'none';

  let kill;
  if (v.catastrophic || v.burnedOut) kill = 'catastrophic';
  else if (v.fire !== 'none') kill = 'burning';
  else if (v.crewAlive === 0) kill = 'crew';
  else {
    const m = mob === 'immobilized', f = v.armed && fp === 'disabled';
    kill = m && f ? 'mobility+firepower' : m ? 'mobility' : f ? 'firepower' : 'none';
  }
  if (kill !== v.kill) {
    v.kill = kill;
    if (kill === 'mobility' || kill === 'firepower' || kill === 'mobility+firepower' || kill === 'crew') {
      env.emit({ type: 'entity_disabled', entityId: e.id, kind: kill });
    }
  }
}

function harmCrew(e, c, p, env) {
  if (!alive(c)) return;
  const r = env.rand();
  let next = null;
  if (r < p * 0.55) next = 'dead';
  else if (r < p * 1.1) next = c.state === 'wounded' ? 'dead' : 'wounded';
  if (next && next !== c.state) {
    c.state = next;
    env.emit({ type: 'crew_hit', entityId: e.id, role: c.role, state: next });
  }
}

function rayBox(o, d, half, centre) {
  let tmin = -Infinity, tmax = Infinity, axis = -1, sign = 0;
  for (let a = 0; a < 3; a++) {
    const lo = centre[a] - half[a], hi = centre[a] + half[a];
    if (Math.abs(d[a]) < 1e-9) { if (o[a] < lo || o[a] > hi) return null; continue; }
    let t1 = (lo - o[a]) / d[a], t2 = (hi - o[a]) / d[a], s = -1;
    if (t1 > t2) { [t1, t2] = [t2, t1]; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = a; sign = s; }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  const n = [0, 0, 0];
  if (axis >= 0) n[axis] = sign;
  return { t: Math.max(tmin, 0), n, inside: tmin < 0 };
}

function dominantNormal(v, half, centre) {
  let best = 0, bv = 0;
  for (let a = 0; a < 3; a++) { const x = (v[a] - centre[a]) / half[a]; if (Math.abs(x) > Math.abs(bv)) { bv = x; best = a; } }
  const n = [0, 0, 0]; n[best] = Math.sign(bv) || 1;
  return n;
}

const ZONE = (n) => (n[1] > 0.5 ? 'top' : n[2] > 0.5 ? 'rear' : n[2] < -0.5 ? 'front' : 'side');

function scheduleCookoff(e, env, lo, hi) {
  const v = e.v;
  if (v.cookoffDone) return;
  const at = env.time + lo + env.rand() * (hi - lo);
  v.cookoffAt = v.cookoffAt < 0 ? at : Math.min(v.cookoffAt, at);
}

export function ignite(e, env, level = 'engine') {
  const v = e.v;
  if (v.catastrophic) return;
  if (v.fire === 'none') {
    v.fire = level === 'full' ? 'full' : 'engine';
    v.fireStart = env.time;
    v.escalateAt = env.time + 4 + env.rand() * 10;
  }
  if (level === 'full' && v.fire !== 'full') v.fire = 'full';
  if (v.fire === 'full' && v.fullFireAt < 0) { v.fullFireAt = env.time; v.crewBurnAt = env.time + 6 + env.rand() * 8; }
  v.smouldering = true;
}

/** Shaped-charge jet: where it enters, whether it gets through, what it hits inside. */
function resolveJet(e, hit, env, info) {
  const def = e.def, v = e.v, c = v.comps, [w, h, d] = def.size;
  const half = [w / 2, h / 2, d / 2], centre = [0, h / 2, 0];
  const l = env.toLocal(hit.position);
  let dl = env.dirLocal(hit.direction);
  if (len(dl) < 1e-6) dl = [0, -1, 0];
  const dn = len(dl); dl = [dl[0] / dn, dl[1] / dn, dl[2] / dn];
  const o = [l[0] - dl[0] * 1.5, l[1] - dl[1] * 1.5, l[2] - dl[2] * 1.5];
  const r = rayBox(o, dl, half, centre);
  let E, n;
  if (r) {
    E = [o[0] + dl[0] * r.t, o[1] + dl[1] * r.t, o[2] + dl[2] * r.t];
    n = r.inside ? dominantNormal([-dl[0] * half[0] + centre[0], -dl[1] * half[1] + centre[1], -dl[2] * half[2] + centre[2]], half, centre) : r.n;
  } else { // the jet misses the box in a straight line: use the nearest surface point
    E = [Math.max(-half[0], Math.min(half[0], l[0])), Math.max(0, Math.min(h, l[1])), Math.max(-half[2], Math.min(half[2], l[2]))];
    n = dominantNormal(l, half, centre);
    dl = [-n[0], -n[1], -n[2]]; // the jet bites straight into the nearest surface
  }
  const zone = ZONE(n);
  const cosT = Math.max(0.3, Math.min(1, Math.abs(dot(dl, n))));
  const thickness = def.armour[zone] / cosT;
  const eraCut = def.era && (zone === 'front' || zone === 'side') ? 1 - def.era : 1;
  const pen = hit.penetrationMm * (0.9 + env.rand() * 0.2) * eraCut;
  const residual = pen - thickness;
  info.localPosition = E; info.localNormal = n; info.penetrated = residual > 0; info.zone = zone;

  const segDist = (P, Lj) => {
    const t = Math.max(0, Math.min(Lj, dot(sub(P, E), dl)));
    return len(sub(P, [E[0] + dl[0] * t, E[1] + dl[1] * t, E[2] + dl[2] * t]));
  };

  if (residual > 0) {
    const Lj = 0.5 + 3.5 * Math.min(1, residual / pen);
    const strength = 0.4 + 0.6 * Math.min(1, residual / pen);
    // The jet itself.
    for (const s of v.crew) {
      if (alive(s) && segDist(s.position, Lj) <= 0.5) { harmCrew(e, s, 1.0, env); info.crewHit = true; }
    }
    for (const [name, p] of Object.entries(c)) {
      if (p.external) continue;
      if (segDist(p.position, Lj) <= p.radius + 0.15) { p.hp -= 0.6 + env.rand() * 0.5; info.component ??= name; }
    }
    // Overpressure and flash inside the sealed hull reach everybody a little.
    for (const s of v.crew) if (alive(s)) harmCrew(e, s, 0.2 * strength, env);
    for (const p of Object.values(c)) if (!p.external) p.hp -= 0.06 * strength * env.rand();
    // Spall: a cone of hot fragments knocked off the inside of the armour, widening behind the entry hole.
    const range = Math.min(4, Lj + 1.2);
    const inCone = (P) => {
      const vv = sub(P, E), dist = len(vv);
      if (dist < 0.05) return { dist, ok: true };
      return { dist, ok: dist < range && dot(vv, dl) / dist > 0.7 };
    };
    for (const s of v.crew) {
      if (!alive(s)) continue;
      const q = inCone(s.position);
      if (q.ok) harmCrew(e, s, (1 - q.dist / range) * strength * 1.6, env);
    }
    for (const [name, p] of Object.entries(c)) {
      if (p.external) continue;
      const q = inCone(p.position);
      if (q.ok) { const dmg = (1 - q.dist / range) * strength * 0.5 * (0.5 + env.rand()); if (dmg > 0.05) { p.hp -= dmg; info.component ??= name; } }
    }
  } else if (pen > 0.6 * thickness) {
    // Did not get through, but the plate bulges and spalls a little.
    for (const s of v.crew) {
      if (alive(s) && len(sub(s.position, E)) < 1.2) harmCrew(e, s, 0.25 * (pen / thickness), env);
    }
  }
  // External parts near the entry hole.
  if (zone === 'side' && E[1] < 0.45 * h) {
    const track = c.wheels ?? (E[0] < 0 ? c.trackL : c.trackR);
    track.hp -= residual > 0 ? 0.6 + env.rand() * 0.4 : 0.25 + env.rand() * 0.2;
    info.component ??= c.wheels ? 'wheels' : (E[0] < 0 ? 'trackL' : 'trackR');
  }
  if (c.optics && len(sub(c.optics.position, E)) < 1.3) { c.optics.hp -= 0.7; info.component ??= 'optics'; }
  if (c.gun && zone === 'front' && len(sub(c.gun.position, E)) < 1.2) { c.gun.hp -= 0.5 * env.rand() + 0.2; info.component ??= 'gun'; }
}

/** Overpressure and fragments on the outside of the vehicle. */
function resolveExternal(e, hit, env, localOrigin) {
  const def = e.def, c = e.v.comps, v = e.v;
  const b = hit.blast, f = hit.fragments, r = () => 0.8 + env.rand() * 0.4;
  for (const s of v.crew) {
    // Crew under armour are shielded unless they are standing in a hatch.
    const p = Math.min(2, (b * def.crewBlast + f * def.crewFrag) * s.exposure * (s.visible ? 1 : def.crewShield ?? 0.2));
    if (p > 0.01) harmCrew(e, s, p, env);
  }
  const g = b * def.gearBlast + f * 0.05;
  if (g > 0.02) {
    if (c.wheels) c.wheels.hp -= g * r();
    else {
      const near = localOrigin[0] < 0 ? c.trackL : c.trackR, far = localOrigin[0] < 0 ? c.trackR : c.trackL;
      near.hp -= g * r(); far.hp -= g * 0.4 * env.rand();
    }
  }
  if (c.optics) c.optics.hp -= (f * def.opticsFrag + b * 0.35) * (0.6 + env.rand() * 0.6);
  if (c.gun) c.gun.hp -= b * 0.25 * env.rand();
  if (c.turret) c.turret.hp -= b * 0.1 * env.rand();
  c.engine.hp -= b * def.engineBlast * r() + f * def.engineFrag;
  c.fuel.hp -= f * def.fuelFrag + b * def.engineBlast * 0.3;
}

/** A blast, fragments or a jet hit a vehicle. Returns what the sim reports. */
export function vehicleHit(e, hit, env, jetContact) {
  const def = e.def, v = e.v, c = v.comps;
  const healthBefore = vehicleHealth(e);
  const snap = Object.fromEntries(Object.entries(c).map(([k, p]) => [k, p.hp]));
  const info = {};
  const lo = env.toLocal(hit.position);
  if (jetContact) resolveJet(e, hit, env, info);
  else {
    // Nearest surface point and its outward normal, for a scorch mark.
    const [w, h, d] = def.size, half = [w / 2, h / 2, d / 2], centre = [0, h / 2, 0];
    const n = dominantNormal(lo, half, centre);
    info.localPosition = [Math.max(-half[0], Math.min(half[0], lo[0])), Math.max(0, Math.min(h, lo[1])), Math.max(-half[2], Math.min(half[2], lo[2]))];
    info.localNormal = n; info.penetrated = false;
  }
  resolveExternal(e, hit, env, lo);
  for (const p of Object.values(c)) p.hp = clamp01(p.hp);

  // Fires and cook-offs from what got damaged.
  const drop = (k) => (c[k] ? Math.max(0, snap[k] - c[k].hp) : 0);
  if (c.ammo && drop('ammo') >= 0.3) {
    info.component = 'ammo';
    if (env.rand() < (def.cookoff?.chance ?? 0.8)) {
      scheduleCookoff(e, env, def.cookoff?.delay?.[0] ?? 2, def.cookoff?.delay?.[1] ?? 5);
      ignite(e, env, 'full');
    } else if (c.ammo.hp < 0.6) ignite(e, env);
  }
  if (drop('fuel') > 0.05) {
    info.component ??= 'fuel';
    if (def.fuelExplode && c.fuel.hp < 0.5 && env.rand() < def.fuelExplode) { scheduleCookoff(e, env, 0.3, 1.5); ignite(e, env, 'full'); }
    else if (env.rand() < def.fuelFire * Math.min(1, drop('fuel') * 1.5)) ignite(e, env);
  }
  if (drop('engine') > 0.05) {
    info.component ??= 'engine';
    if (c.engine.hp < 0.5 && env.rand() < def.engineFire * Math.min(1, drop('engine') * 1.5)) ignite(e, env);
  }
  evaluateVehicle(e, env);

  const delta = Math.max(0.001, healthBefore - vehicleHealth(e));
  const source = jetContact ? 'jet' : hit.fragments > hit.blast * (def.frag > 0 ? 1 : 99) ? 'fragments' : 'blast';
  return { damage: delta, source, extra: { ...info, ...(info.component ? { component: info.component } : {}) }, component: info.component };
}

// ---------------------------------------------------------------- infantry

const ZONES = ['head', 'torso', 'armL', 'armR', 'legL', 'legR'];
const ZONE_POS = { head: [0, 1.7, 0], torso: [0, 1.25, 0], armL: [-0.3, 1.3, 0], armR: [0.3, 1.3, 0], legL: [-0.12, 0.5, 0], legR: [0.12, 0.5, 0] };
const FRAG_ZONES = [['head', 0.1], ['torso', 0.4], ['armL', 0.1], ['armR', 0.1], ['legL', 0.15], ['legR', 0.15]];

export function initInfantry(e) {
  e.w = { head: 1, torso: 1, armL: 1, armR: 1, legL: 1, legR: 1 };
  e.cond = 'ok';
  e.bleeding = false;
  e.bleedOutAt = -1;
}

export function infantryMobility(e) { return clamp01((e.w.legL + e.w.legR) / 2); }
export function infantryHealth(e) {
  if (e.cond === 'dead') return 0;
  const w = e.w;
  return clamp01(0.4 * w.head + 0.4 * w.torso + 0.1 * (w.armL + w.armR) / 2 + 0.1 * infantryMobility(e));
}

/** Work out the condition from the wounds; emits entity_condition on change. Returns the condition. */
export function evaluateInfantry(e, env) {
  const w = e.w;
  let cond;
  if (w.head <= 0 || w.torso <= 0) cond = 'dead';
  else if (w.torso < 0.45 || w.head < 0.45) cond = 'down';
  else if (w.legL + w.legR < 0.6) cond = 'crawling';
  else if (Math.min(...ZONES.map((z) => w[z])) < 0.8) cond = 'wounded';
  else cond = 'ok';
  e.bleeding = cond === 'down' || (cond !== 'ok' && cond !== 'dead' && (w.torso < 0.7 || Math.min(w.legL, w.legR) < 0.4));
  if (cond === 'down' && e.bleedOutAt < 0) e.bleedOutAt = env.time + (w.torso < 0.2 ? 6 : 15) + env.rand() * 35;
  if (cond !== e.cond) {
    const rank = { ok: 0, wounded: 1, crawling: 2, down: 3, dead: 4 };
    const worse = rank[cond] > rank[e.cond];
    e.cond = cond;
    if (worse) env.emit({ type: 'entity_condition', entityId: e.id, condition: cond });
  }
  return cond;
}

export function infantryHit(e, hit, env) {
  const w = e.w, before = infantryHealth(e), prev = { ...w };
  const prone = e.status === 'prone';
  const b = hit.blast * (prone ? 0.6 : 1) * e.def.blast;
  const f = hit.fragments * (prone ? 0.4 : 1) * e.def.frag;
  const j = () => 0.85 + env.rand() * 0.3;
  if (b > 0) {
    w.torso -= b * 1.1 * j(); w.head -= b * 0.6 * j();
    for (const z of ['armL', 'armR', 'legL', 'legR']) w[z] -= b * 0.7 * j();
  }
  const n = Math.floor(f * 8 + env.rand());
  for (let i = 0; i < n; i++) {
    let r = env.rand(), zone = 'torso';
    for (const [z, p] of FRAG_ZONES) { if ((r -= p) < 0) { zone = z; break; } }
    w[zone] -= (0.15 + env.rand() * 0.35) * (zone === 'head' ? 1.6 : 1);
  }
  for (const z of ZONES) w[z] = clamp01(w[z]);
  let worst = 'torso', wd = 0;
  for (const z of ZONES) if (prev[z] - w[z] > wd) { wd = prev[z] - w[z]; worst = z; }
  const l = env.toLocal(hit.position), zp = ZONE_POS[worst];
  const nv = sub(l, zp), nl = len(nv) || 1;
  evaluateInfantry(e, env);
  return {
    damage: Math.max(0, before - infantryHealth(e)), source: b >= f ? 'blast' : 'fragments',
    extra: { bodyPart: worst, localPosition: [...zp], localNormal: [nv[0] / nl, nv[1] / nl, nv[2] / nl], penetrated: wd > 0.3 },
    died: e.cond === 'dead',
  };
}

export function tickInfantry(e, env) {
  if (e.cond === 'down' && e.bleedOutAt >= 0 && env.time >= e.bleedOutAt) {
    e.w.torso = 0; evaluateInfantry(e, env); return true; // bled out
  }
  return false;
}

// ---------------------------------------------------------------- vehicle timers

/** Fire, crew, bail-out and cook-off timers. `hooks` = { cookoff(e), burnedOut(e), bailOut(e) }. */
export function tickVehicle(e, env, hooks) {
  const v = e.v, c = v.comps, t = env.time;
  if (v.catastrophic) return;
  if (v.fire === 'engine' && t >= v.escalateAt) {
    if (env.rand() < 0.7) {
      v.fire = 'full'; v.fullFireAt = t; v.crewBurnAt = t + 6 + env.rand() * 8;
      if (c.ammo && env.rand() < (e.def.cookoff?.chance ?? 0.5) * 0.7) scheduleCookoff(e, env, 8, 25);
    } else v.fire = 'none';
    evaluateVehicle(e, env);
  }
  if (v.fire === 'full' && v.crewBurnAt >= 0 && t >= v.crewBurnAt) {
    v.crewBurnAt = -1;
    for (const s of v.crew) if (alive(s)) { s.state = 'dead'; env.emit({ type: 'crew_hit', entityId: e.id, role: s.role, state: 'dead' }); }
    evaluateVehicle(e, env);
  }
  if (v.fire === 'full' && t - v.fullFireAt > 45) { hooks.burnedOut(e); return; }
  if (!v.abandoned && v.bailAt < 0 && v.crewAlive > 0) {
    const stuck = v.mobility === 'immobilized' && (!v.armed || v.firepower === 'disabled');
    if (v.fire !== 'none' || stuck || (c.ammo && c.ammo.hp < 0.7)) v.bailAt = t + 0.8 + env.rand() * 2.2;
  }
  if (v.bailAt >= 0 && !v.abandoned && t >= v.bailAt) {
    v.abandoned = true; v.bailing = true; v.bailUntil = t + 4;
    hooks.bailOut(e);
    evaluateVehicle(e, env);
  }
  if (v.bailing && t >= v.bailUntil) v.bailing = false;
  if (v.cookoffAt >= 0 && !v.cookoffDone && t >= v.cookoffAt) hooks.cookoff(e);
}
