// Enemy troops and vehicles: stats, weak spots, damage, simple AI.
// The sim owns them; visuals only reads `state.entities` (see ARCHITECTURE.md).
//
// Hull-local frame: +X right, +Y up (from the ground), −Z forward.

import RAPIER from '@dimforge/rapier3d-compat';
import { Euler, Quaternion, Vector3 } from 'three';
import { JET_REACH_M } from './warhead.js';
import {
  initVehicle, vehicleHealth, hatchState, evaluateVehicle, vehicleHit, tickVehicle,
  initInfantry, infantryMobility, infantryHealth, evaluateInfantry, infantryHit, tickInfantry,
} from './damageModel.js';

// armour is mm of rolled steel equivalent per zone, used against shaped-charge jets.
// blast / frag are how much of the (0..1) blast / fragment intensity turns into health loss (infantry).
// `era` (reactive armour) cuts the jet's penetration on the front and sides.
// seats / parts place the crew and the components inside the hull (see damageModel.js):
//   seat = { role, p:[fx,fy,fz], exposure, visible }, part = { p:[fx,fy,fz], r, external? }
//   p is a fraction of the half width, of the height, and of the half length (−1 = nose).
// The *Blast / *Frag factors say how much outside blast / fragments get to the crew and parts.
// Each kind has base stats; VARIANTS override them (the first variant of a kind is its default).
const seat = (role, p, exposure, visible = 0) => ({ role, p, exposure, visible });
const part = (p, r, external = false) => ({ p, r, external });

const ARMOURED = { // shared by tanks and APCs: sealed crew, only the ones in hatches are exposed
  crewShield: 0.2, opticsFrag: 0.3, engineFrag: 0, fuelFrag: 0.02, engineFire: 0.3, fuelFire: 0.25,
};

export const ENTITY_TYPES = {
  infantry: {
    size: [0.5, 1.8, 0.4], blast: 1.0, frag: 1.25, jetBase: 1, armour: { front: 1, side: 1, rear: 1, top: 1 },
    walk: 1.4, run: 5.2, turnRate: 6, accel: 6, hearing: 30, cookoff: null, vehicle: false, locomotion: 'foot',
    seats: [], parts: {},
  },
  light: { // jeeps, pickups: thin-skinned, open, and fast
    size: [1.8, 1.9, 4.1], blast: 1.0, frag: 0.35, jetBase: 1, armour: { front: 3, side: 2, rear: 2, top: 2 },
    walk: 9, run: 22, turnRate: 1.8, accel: 6, hearing: 30, vehicle: true, locomotion: 'wheels',
    seats: [seat('driver', [-0.5, 0.5, -0.15], 0.9, 1), seat('troop', [0.5, 0.5, -0.15], 0.9, 1), seat('troop', [-0.5, 0.5, 0.55], 0.9, 1), seat('troop', [0.5, 0.5, 0.55], 0.9, 1)],
    parts: { engine: part([0, 0.45, -0.75], 0.6), fuel: part([0, 0.25, 0.8], 0.5) },
    crewBlast: 0.9, crewFrag: 1.6, crewShield: 1, gearBlast: 0.5, opticsFrag: 0, engineBlast: 0.45, engineFrag: 0.5, fuelFrag: 0.5,
    engineFire: 0.3, fuelFire: 0.5, fuelExplode: 0.15,
    cookoff: { chance: 0.25, delay: [1, 2.5], kind: 'vehicle', chargeKg: 0.1, radius: 2, fragmentRadius: 6, fragmentLethality: 0.2 },
  },
  truck: {
    size: [2.5, 2.9, 7.0], blast: 0.9, frag: 0.18, jetBase: 1, armour: { front: 6, side: 3, rear: 3, top: 3 },
    walk: 6, run: 14, turnRate: 0.9, accel: 3.5, hearing: 25, vehicle: true, locomotion: 'wheels',
    seats: [seat('driver', [-0.5, 0.55, -0.7], 0.6, 0.2), seat('troop', [0.5, 0.55, -0.7], 0.6, 0.1)],
    parts: { engine: part([0, 0.45, -0.75], 0.8), fuel: part([0.9, 0.25, 0.1], 0.6) },
    crewBlast: 0.7, crewFrag: 1.0, crewShield: 0.5, gearBlast: 0.3, opticsFrag: 0, engineBlast: 0.25, engineFrag: 0.3, fuelFrag: 0.4,
    engineFire: 0.25, fuelFire: 0.4, fuelExplode: 0.15,
    cookoff: { chance: 0.5, delay: [1.2, 3], kind: 'vehicle', chargeKg: 0.3, radius: 3, fragmentRadius: 10, fragmentLethality: 0.3 },
  },
  apc: {
    size: [3.0, 2.4, 7.0], blast: 0.35, frag: 0.03, jetBase: 0.85, armour: { front: 100, side: 40, rear: 25, top: 15 },
    walk: 5, run: 10, turnRate: 0.8, accel: 3, hearing: 20, turret: 1.5, vehicle: true, locomotion: 'tracks',
    seats: [seat('driver', [-0.55, 0.45, -0.75], 0.3, 0.2), seat('commander', [0.45, 0.85, -0.2], 0.7, 0.4), seat('troop', [-0.5, 0.5, 0.35], 0.15), seat('troop', [0.5, 0.5, 0.6], 0.15)],
    parts: {
      engine: part([0, 0.45, 0.8], 1.0), fuel: part([0.7, 0.25, 0.4], 0.6), ammo: part([0, 0.6, -0.15], 0.5),
      gun: part([0, 0.95, -0.45], 0.3, true), turret: part([0, 0.9, -0.2], 0.5), optics: part([0.15, 1.0, -0.3], 0.25, true),
    },
    ...ARMOURED, crewBlast: 0.12, crewFrag: 0.25, gearBlast: 0.1, engineBlast: 0.08,
    cookoff: { chance: 0.75, delay: [1.5, 4], kind: 'ammo', chargeKg: 0.8, radius: 4, fragmentRadius: 18, fragmentLethality: 0.6 },
  },
  tank: {
    size: [3.4, 2.4, 7.0], blast: 0.12, frag: 0, jetBase: 0.7, armour: { front: 700, side: 300, rear: 120, top: 60 },
    walk: 4, run: 6, turnRate: 0.6, accel: 2, hearing: 15, turret: 1.0, vehicle: true, locomotion: 'tracks',
    seats: [seat('driver', [0, 0.4, -0.78], 0.25, 0.15), seat('gunner', [-0.3, 0.78, 0.0], 0.2), seat('commander', [0.3, 0.95, 0.05], 0.8, 0.5)],
    parts: {
      ammo: part([0, 0.62, 0], 0.8), engine: part([0, 0.45, 0.78], 1.1), fuel: part([0.55, 0.4, 0.45], 0.7),
      turret: part([0, 0.8, 0], 0.7), gun: part([0, 0.8, -1.0], 0.3, true), optics: part([0.3, 1.0, -0.15], 0.3, true),
    },
    ...ARMOURED, crewBlast: 0.03, crewFrag: 0.5, gearBlast: 0.15, engineBlast: 0.05, engineFire: 0.35,
    cookoff: { chance: 0.9, delay: [2, 5], kind: 'ammo', chargeKg: 1.8, radius: 6, fragmentRadius: 25, fragmentLethality: 0.7 },
  },
};

export const VARIANTS = {
  infantry: {
    rifleman: {},
    mg: { walk: 1.2, run: 4.5, hearing: 28 },                // machine gunner, weighed down
    rpg: { walk: 1.3, run: 4.8 },                            // anti-tank launcher
    officer: { hearing: 38, walk: 1.5, run: 5.4 },           // alert: his shout warns the squad from further away
    crew: { walk: 1.4, run: 5.0, hearing: 20 },              // a bailed-out vehicle crewman
  },
  light: {
    uaz: {},                                                 // UAZ-469 style jeep
    pickup: {                                                // civilian-style pickup truck
      size: [2.0, 1.9, 5.2], run: 20, frag: 0.3,
      seats: [seat('driver', [-0.5, 0.5, -0.4], 0.9, 1), seat('troop', [0.5, 0.5, -0.4], 0.9, 1)],
      parts: { engine: part([0, 0.45, -0.8], 0.6), fuel: part([0, 0.25, 0.4], 0.5) },
    },
    atv: {                                                   // quad bike: one rider, fast, no protection at all
      size: [1.2, 1.3, 2.1], walk: 8, run: 17, turnRate: 2.6, accel: 7, frag: 0.8, blast: 1.1, hearing: 35,
      seats: [seat('driver', [0, 0.65, 0.1], 1.0, 1)],
      parts: { engine: part([0, 0.35, 0], 0.35), fuel: part([0, 0.55, -0.35], 0.25) },
      crewBlast: 1.0, crewFrag: 1.8, crewShield: 1, engineBlast: 0.7, engineFrag: 0.8, fuelFrag: 0.7, fuelFire: 0.6,
      cookoff: { chance: 0.3, delay: [0.5, 1.5], kind: 'vehicle', chargeKg: 0.05, radius: 1.5, fragmentRadius: 4, fragmentLethality: 0.15 },
    },
    technical: {                                             // pickup with a mounted heavy MG
      size: [2.0, 2.3, 5.2], run: 19, turret: 2.0, hearing: 25,
      seats: [seat('driver', [-0.5, 0.45, -0.4], 0.9, 1), seat('troop', [0.5, 0.45, -0.4], 0.9, 1), seat('gunner', [0, 0.9, 0.45], 1.0, 1)],
      parts: { engine: part([0, 0.4, -0.8], 0.6), fuel: part([0, 0.2, 0.4], 0.5), gun: part([0, 0.95, 0.4], 0.4, true) },
    },
  },
  truck: {
    ural: {},                                                // Ural-4320 style 6x6 cargo truck
    kamaz: { size: [2.5, 3.1, 7.8], run: 16, blast: 0.85 },  // KamAZ-5350 style, quicker
    fuel: {                                                  // tanker: one hit and it goes up
      size: [2.5, 3.0, 8.0], run: 11, walk: 5,
      seats: [seat('driver', [-0.5, 0.45, -0.75], 0.6, 0.2)],
      parts: { engine: part([0, 0.4, -0.8], 0.9), fuel: part([0, 0.6, 0.15], 1.5) },
      fuelFire: 0.9, fuelExplode: 0.9, fuelFrag: 0.8,
      cookoff: { chance: 0.95, delay: [0.5, 1.5], kind: 'vehicle', chargeKg: 1.2, radius: 7, fragmentRadius: 15, fragmentLethality: 0.4 },
    },
  },
  apc: {
    btr: { // BTR-80 style 8x8: fast, wheeled, very thin armour
      size: [2.9, 2.4, 7.6], locomotion: 'wheels', armour: { front: 15, side: 10, rear: 10, top: 7 },
      blast: 0.5, frag: 0.08, walk: 7, run: 12, turnRate: 0.9, hearing: 22, crewBlast: 0.3, crewFrag: 0.5, gearBlast: 0.25,
      seats: [seat('driver', [-0.55, 0.5, -0.8], 0.3, 0.2), seat('commander', [0.45, 0.55, -0.8], 0.3, 0.2), seat('troop', [-0.5, 0.5, 0.0], 0.15), seat('troop', [0.5, 0.5, 0.4], 0.15)],
      parts: {
        engine: part([0, 0.45, 0.8], 1.0), fuel: part([0.7, 0.25, 0.4], 0.6), ammo: part([0, 0.6, -0.2], 0.5),
        gun: part([0, 0.95, -0.4], 0.3, true), turret: part([0, 0.9, -0.3], 0.5), optics: part([0.15, 1.0, -0.35], 0.25, true),
      },
      cookoff: { chance: 0.6, delay: [1.5, 4], kind: 'ammo', chargeKg: 0.6, radius: 3.5, fragmentRadius: 15, fragmentLethality: 0.5 },
    },
    bmp: { // BMP-2 style tracked IFV
      size: [3.2, 2.2, 6.7], armour: { front: 60, side: 25, rear: 20, top: 15 },
      seats: [seat('driver', [-0.55, 0.45, -0.8], 0.3, 0.2), seat('commander', [0.35, 0.9, -0.1], 0.7, 0.4), seat('gunner', [-0.35, 0.9, -0.1], 0.5, 0.1), seat('troop', [-0.5, 0.5, 0.45], 0.15), seat('troop', [0.5, 0.5, 0.6], 0.15)],
      cookoff: { chance: 0.85, delay: [1.5, 4], kind: 'ammo', chargeKg: 0.9, radius: 4, fragmentRadius: 18, fragmentLethality: 0.6 },
    },
    mtlb: { // MT-LB style light tracked carrier, no real turret
      size: [2.9, 2.0, 6.5], armour: { front: 14, side: 10, rear: 10, top: 7 }, blast: 0.6, frag: 0.1, turret: 0, walk: 6, run: 11,
      crewBlast: 0.3, crewFrag: 0.5,
      seats: [seat('driver', [-0.5, 0.5, -0.75], 0.3, 0.2), seat('commander', [0.5, 0.55, -0.75], 0.3, 0.3), seat('troop', [-0.5, 0.5, 0.0], 0.15), seat('troop', [0.5, 0.5, 0.3], 0.15), seat('troop', [0, 0.5, 0.6], 0.15)],
      parts: { engine: part([0, 0.4, -0.2], 0.9), fuel: part([0.7, 0.25, 0.4], 0.6), ammo: part([0, 0.5, 0.75], 0.4) },
      cookoff: { chance: 0.4, delay: [2, 5], kind: 'ammo', chargeKg: 0.3, radius: 3, fragmentRadius: 12, fragmentLethality: 0.4 },
    },
  },
  tank: {
    t72: { // autoloader carousel: its turret often blows off
      size: [3.6, 2.2, 6.9], armour: { front: 600, side: 250, rear: 100, top: 50 },
      cookoff: { chance: 0.95, delay: [2, 4.5], kind: 'ammo', chargeKg: 1.8, radius: 6, fragmentRadius: 25, fragmentLethality: 0.7, turretToss: true },
    },
    t80: { // gas turbine: quicker and louder
      size: [3.6, 2.2, 7.0], run: 8, hearing: 25,
      cookoff: { chance: 0.9, delay: [2, 5], kind: 'ammo', chargeKg: 1.8, radius: 6, fragmentRadius: 25, fragmentLethality: 0.7, turretToss: true },
    },
    t90: { // composite + reactive armour, safer ammo storage
      size: [3.8, 2.2, 7.1], armour: { front: 900, side: 350, rear: 130, top: 70 }, era: 0.4, blast: 0.1, turnRate: 0.55,
      cookoff: { chance: 0.8, delay: [2, 5], kind: 'ammo', chargeKg: 1.8, radius: 6, fragmentRadius: 25, fragmentLethality: 0.7, turretToss: false },
    },
  },
};

// Where troops ride on the outside of a vehicle ("riders" in a level's enemy def): hull-local seat
// surface [x, y, z] and the way the man faces (yaw relative to the hull; ±π/2 = sideways, legs over
// the edge). Filled in order.
const SIDE = Math.PI / 2;
export const RIDER_SEATS = {
  pickup: [[0.9, 1.28, 0.9, -SIDE], [-0.9, 1.28, 1.2, SIDE], [0.9, 1.28, 2.0, -SIDE], [-0.9, 1.28, 2.2, SIDE]],
  technical: [[0.9, 1.28, 0.4, -SIDE], [-0.9, 1.28, 0.6, SIDE], [-0.9, 1.28, 2.2, SIDE]],
  uaz: [[0.55, 1.92, 1.2, -SIDE], [-0.55, 1.92, 1.5, SIDE]],
  btr: [[1.0, 2.06, 0.9, -SIDE], [-1.0, 2.06, 1.3, SIDE], [0.95, 2.04, 2.4, -SIDE], [-0.95, 2.04, 2.7, SIDE], [0.3, 2.05, 3.2, Math.PI]],
  bmp: [[1.15, 1.55, 1.2, -SIDE], [-1.15, 1.55, 1.5, SIDE], [1.1, 1.52, 2.4, -SIDE], [-1.1, 1.52, 2.6, SIDE]],
  mtlb: [[1.05, 1.66, 0.3, -SIDE], [-1.05, 1.66, 0.6, SIDE], [1.05, 1.64, 1.8, -SIDE], [-1.05, 1.64, 2.1, SIDE], [0, 1.64, 2.9, Math.PI]],
  ural: [[0.9, 2.75, 1.0, -SIDE], [-0.9, 2.75, 1.6, SIDE]],
};

export function resolveType(kind, variant) {
  const base = ENTITY_TYPES[kind];
  if (!base) throw new Error(`unknown entity kind ${kind}`);
  const variants = VARIANTS[kind] ?? {};
  const name = variant && variants[variant] ? variant : Object.keys(variants)[0];
  return { ...base, ...variants[name], variant: name };
}

const FIRE_SECONDS = 30;
const PRONE_SECONDS = 8;
const CALM_AFTER = 4;
const CRAWL_SPEED = 0.45;

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
const aliveCrew = (c) => c.state === 'ok' || c.state === 'wounded';

/**
 * ctx = { world, level, emit(e), damage (DamageRegistry), registerCollider(handle, id),
 *         unregisterCollider?(handle), explode(spec) }
 */
export function createEntities(ctx) {
  const { world, level } = ctx;
  const rand = lcg((level.seed ?? 1) * 7919 + 5);
  const half = level.terrain.size / 2 - 10;
  const list = [];
  const states = [];
  let time = 0;
  let nextId = 0;
  let nextCrewId = 0;

  // The damage model reports through `env`. Events raised while a hit is being resolved are held
  // back until the sim has emitted the `hit` itself, so consumers see hit → consequences.
  let cur = null;
  let holding = false;
  let held = [];
  const env = {
    get time() { return time; },
    rand,
    emit: (ev) => { if (holding) held.push(ev); else ctx.emit(ev); },
    toLocal: (p) => { const l = toLocal(cur, p); return [l.x, l.y, l.z]; },
    dirLocal: (d) => {
      _qi.set(cur.q[0], cur.q[1], cur.q[2], cur.q[3]).invert();
      const l = _loc.set(d[0], d[1], d[2]).applyQuaternion(_qi);
      return [l.x, l.y, l.z];
    },
  };

  function makeState(e) {
    const v = e.def.vehicle;
    return {
      id: e.id, kind: e.kind, variant: e.def.variant, locomotion: e.def.locomotion, position: [0, 0, 0], quaternion: [0, 0, 0, 1], velocity: [0, 0, 0],
      size: [...e.def.size], health: 1, status: 'idle', turretYaw: 0, onFire: false, damage: 'none', weakSpots: [],
      ...(v ? {
        kill: 'none', mobility: 'ok', firepower: 'ok', operational: true, crewTotal: 0, crewAlive: 0, crew: [],
        hatches: { driver: false, commander: false, gunner: false, rear: false },
        bailing: false, abandoned: false, fire: 'none', smoke: 'none', components: {},
      } : {
        condition: 'ok', wounds: { head: 1, torso: 1, armL: 1, armR: 1, legL: 1, legR: 1 }, mobility: 1, bleeding: false,
        riding: null, // vehicle id while sitting on top of it (position = the point he sits on)
        ...(e.fromVehicle ? { fromVehicle: e.fromVehicle } : {}),
      }),
    };
  }

  function spawn(def, extra = {}) {
    const type = resolveType(def.kind, def.variant);
    const dynamic = !!extra.dynamic;
    const id = dynamic ? `c${nextCrewId++}` : `e${nextId++}`;
    const e = {
      id, kind: def.kind, def: type, dynamic, fromVehicle: extra.fromVehicle,
      spawn: { x: def.position[0], z: def.position[1], yaw: def.yaw ?? 0 },
      patrol: def.patrol ?? null, idleTime: def.idleTime ?? (type.vehicle ? 2 : 4),
      x: 0, z: 0, y: 0, yaw: 0, speed: 0, pitch: 0, roll: 0, mult: 1,
      health: 1, status: 'idle', destroyed: false, onFire: false, fireUntil: 0,
      wp: 0, waitUntil: 0, alerted: false, noticeT: 0, reactAfter: 0.6 + rand() * 1.0, calmT: 0,
      mode: 'patrol', proneUntil: 0, fleeHeading: 0, turretYaw: 0, s: null, body: null, collider: null, v: null, w: null,
    };
    // Start the body at its spawn point: a body created at the origin would sweep through anything
    // there (like a drone on its launch pad) on its first kinematic move.
    e.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(e.spawn.x, level.terrain.heightAt(e.spawn.x, e.spawn.z), e.spawn.z));
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
    // Troops riding on top: infantry entities that move with the hull until they jump off.
    const seats = RIDER_SEATS[type.variant] ?? [];
    (def.riders ?? []).slice(0, seats.length).forEach((variant, i) => {
      const r = spawn({ kind: 'infantry', variant, position: [def.position[0], def.position[1]], yaw: def.yaw ?? 0 });
      r.rideSpawn = { veh: e, seat: seats[i] };
      r.ride = r.rideSpawn;
      follow(r);
    });
    return e;
  }

  // Sit a rider on his seat on the hull.
  function follow(r) {
    const { veh, seat } = r.ride;
    _e.set(veh.pitch, veh.yaw, veh.roll, 'YXZ');
    _q.setFromEuler(_e);
    const w = _loc.set(seat[0], seat[1], seat[2]).applyQuaternion(_q);
    r.x = veh.x + w.x; r.y = veh.y + w.y; r.z = veh.z + w.z;
    r.yaw = veh.yaw + seat[3]; r.pitch = veh.pitch; r.roll = veh.roll; r.speed = 0;
    r.status = 'idle';
    sync(r);
    r.s.riding = veh.id;
    r.s.velocity[0] = -Math.sin(veh.yaw) * veh.speed; r.s.velocity[2] = -Math.cos(veh.yaw) * veh.speed;
  }

  // Off the vehicle: down to the ground on his side of the hull.
  function dismount(r) {
    const { veh, seat } = r.ride;
    r.ride = null;
    r.s.riding = null;
    const side = Math.sign(seat[0]) || 1, c = Math.cos(veh.yaw), sn = Math.sin(veh.yaw);
    const lx = side * (veh.def.size[0] / 2 + 0.7), lz = seat[2];
    r.x = veh.x + lx * c + lz * sn; r.z = veh.z - lx * sn + lz * c;
    r.pitch = r.roll = 0;
    if (r.alerted && r.cond === 'ok') {
      r.mode = rand() < 0.5 ? 'prone' : 'flee';
      r.proneUntil = time + PRONE_SECONDS;
      r.fleeHeading = Math.atan2(r.x - veh.x, r.z - veh.z) + Math.PI + (rand() - 0.5);
    }
    ground(r); sync(r);
  }

  function remove(e) {
    ctx.damage.unregister(e.id);
    ctx.unregisterCollider?.(e.collider.handle);
    world.removeRigidBody(e.body);
    list.splice(list.indexOf(e), 1);
    states.splice(states.indexOf(e.s), 1);
  }

  function place(e) {
    e.x = e.spawn.x; e.z = e.spawn.z; e.yaw = e.spawn.yaw; e.speed = 0; e.turretYaw = 0; e.mult = 1;
    e.status = 'idle'; e.destroyed = false; e.onFire = false; e.fireUntil = 0;
    e.wp = 0; e.waitUntil = time + rand() * 3;
    e.alerted = false; e.noticeT = 0; e.calmT = 0; e.mode = 'patrol'; e.proneUntil = 0;
    e.reactAfter = 0.6 + rand() * 1.0;
    e.ride = e.rideSpawn ?? null;
    if (e.s) e.s.riding = e.ride ? e.ride.veh.id : null;
    if (e.def.vehicle) {
      initVehicle(e, rand); e.health = vehicleHealth(e);
      e.s.weakSpots = Object.entries(e.v.comps).map(([name, c]) => ({ name, position: c.position, radius: c.radius }));
    } else { initInfantry(e); e.health = 1; }
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
    s.turretYaw = e.turretYaw;
    if (e.def.vehicle) {
      const v = e.v;
      const burning = e.destroyed ? time < e.fireUntil : v.fire !== 'none';
      s.status = e.destroyed ? 'destroyed' : (v.abandoned || !v.operational) ? 'disabled' : e.status;
      s.onFire = burning;
      s.fire = burning ? (v.fire === 'none' ? 'full' : v.fire) : 'none';
      s.smoke = e.destroyed ? (burning ? 'heavy' : 'light') : v.smoke;
      s.damage = e.destroyed || e.health < 0.35 ? 'heavy' : e.health < 0.7 ? 'light' : 'none';
      s.kill = v.kill; s.mobility = v.mobility; s.firepower = v.firepower; s.operational = v.operational && !e.destroyed;
      s.crewTotal = v.crew.length; s.crewAlive = v.crewAlive; s.crew = v.crew; s.components = v.comps;
      s.bailing = v.bailing; s.abandoned = v.abandoned;
      hatchState(v, s.hatches);
    } else {
      const c = e.w;
      s.status = e.cond === 'dead' ? 'destroyed' : (e.cond === 'ok' ? e.status : e.cond);
      s.onFire = false; s.damage = 'none';
      s.condition = e.cond; s.mobility = infantryMobility(e); s.bleeding = e.bleeding;
      s.wounds.head = c.head; s.wounds.torso = c.torso; s.wounds.armL = c.armL; s.wounds.armR = c.armR; s.wounds.legL = c.legL; s.wounds.legR = c.legR;
    }
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

  function applyDamage(e, hit) {
    if (e.destroyed) return 0;
    const def = e.def;
    cur = e; holding = true; held = [];
    let r;
    if (def.vehicle) {
      const jet = hit.shaped && hit.penetrationMm > 0 && hit.distance <= JET_REACH_M;
      r = vehicleHit(e, hit, env, jet);
      e.health = vehicleHealth(e);
    } else {
      r = infantryHit(e, hit, env);
      e.health = infantryHealth(e);
      e.fleeHeading = Math.atan2(e.x - hit.position[0], e.z - hit.position[2]) + (rand() - 0.5) * 0.6;
    }
    holding = false;
    const events = held; held = [];
    if (!e.alerted) alert(e);
    sync(e);
    const result = { damage: r.damage, source: r.source, extra: r.extra };
    if (def.vehicle && r.component) result.weakSpot = r.component;
    result.after = () => {
      for (const ev of events) ctx.emit(ev);
      if (!def.vehicle && e.cond === 'dead') killInfantry(e, r.source);
    };
    return result;
  }

  function alert(e, shout = true) {
    e.alerted = true; e.calmT = 0;
    ctx.emit({ type: 'entity_alerted', entityId: e.id, position: [e.x, e.y + e.def.size[1] / 2, e.z] });
    if (!shout || e.def.vehicle) return;
    // Infantry shout a warning to nearby troops; an officer's carries further.
    const reach = e.def.variant === 'officer' ? 40 : 15;
    for (const o of list) {
      if (o === e || o.destroyed || o.alerted || o.def.vehicle) continue;
      if (Math.hypot(o.x - e.x, o.z - e.z) < reach) alert(o, false);
    }
  }

  function killInfantry(e, cause) {
    if (e.destroyed) return;
    if (e.ride) dismount(e); // falls off
    e.destroyed = true; e.speed = 0; e.health = 0;
    sync(e);
    ctx.emit({ type: 'entity_destroyed', entityId: e.id, kind: e.kind, position: [e.x, e.y + e.def.size[1] / 2, e.z], cause });
  }

  // ---- vehicle events from the damage model ----------------------------

  const hooks = {
    cookoff(e) {
      const v = e.v, c = e.def.cookoff;
      v.cookoffDone = true; v.catastrophic = true;
      e.destroyed = true; e.speed = 0; e.fireUntil = time + FIRE_SECONDS; e.health = 0;
      for (const s of v.crew) if (aliveCrew(s)) { s.state = 'dead'; ctx.emit({ type: 'crew_hit', entityId: e.id, role: s.role, state: 'dead' }); }
      evaluateVehicle(e, env);
      sync(e);
      if (c) {
        ctx.explode({
          position: [e.x, e.y + e.def.size[1] / 2, e.z], objectId: e.id, kind: c.kind, chargeKg: c.chargeKg, radius: c.radius,
          fragmentRadius: c.fragmentRadius, fragmentLethality: c.fragmentLethality, ignoreHandle: e.body.handle, turretToss: !!c.turretToss,
        });
      }
      ctx.emit({ type: 'entity_destroyed', entityId: e.id, kind: e.kind, position: [e.x, e.y + e.def.size[1] / 2, e.z], cause: 'cookoff' });
    },
    burnedOut(e) {
      const v = e.v;
      v.burnedOut = true;
      e.destroyed = true; e.speed = 0; e.fireUntil = time + FIRE_SECONDS * 0.5; e.health = 0;
      for (const s of v.crew) if (aliveCrew(s)) { s.state = 'dead'; ctx.emit({ type: 'crew_hit', entityId: e.id, role: s.role, state: 'dead' }); }
      evaluateVehicle(e, env);
      sync(e);
      ctx.emit({ type: 'entity_destroyed', entityId: e.id, kind: e.kind, position: [e.x, e.y + e.def.size[1] / 2, e.z], cause: 'fire' });
    },
    bailOut(e) {
      const v = e.v;
      const out = v.crew.filter(aliveCrew);
      if (!out.length) return;
      ctx.emit({ type: 'crew_bailout', entityId: e.id, count: out.length });
      const [w, h, d] = e.def.size;
      const sinY = Math.sin(e.yaw), cosY = Math.cos(e.yaw);
      out.forEach((s, i) => {
        // Out of the hatch to the side of the hull, spread along it.
        const side = s.position[0] >= 0 ? 1 : -1;
        const lx = side * (w / 2 + 0.8), lz = s.position[2] + (i - out.length / 2) * 0.3;
        const x = e.x + lx * cosY + lz * sinY, z = e.z - lx * sinY + lz * cosY;
        const away = Math.atan2(-(x - e.x), -(z - e.z));
        const man = spawn({ kind: 'infantry', variant: 'crew', position: [x, z], yaw: away }, { dynamic: true, fromVehicle: e.id });
        man.s.fromVehicle = e.id;
        if (s.state === 'wounded') { man.w.armR = 0.4; man.w.legL = 0.55; man.w.torso = 0.7; evaluateInfantry(man, env); sync(man); }
        man.alerted = true; man.reactAfter = 0;
        man.mode = rand() < 0.35 ? 'prone' : 'flee';
        man.proneUntil = time + PRONE_SECONDS; man.fleeHeading = away + (rand() - 0.5) * 0.8;
        s.state = 'bailed';
        ctx.emit({ type: 'entity_spawned', entityId: man.id, kind: 'infantry', variant: 'crew', position: [x, man.y, z], fromVehicle: e.id });
      });
      void h;
    },
  };

  // ---- AI -------------------------------------------------------------

  function steer(e, dt, heading, speed) {
    const def = e.def;
    const err = wrap(heading - e.yaw);
    e.yaw += Math.sign(err) * Math.min(Math.abs(err), def.turnRate * e.mult * dt);
    let want = speed * e.mult;
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

  // How well a unit can move: vehicles by mobility kill, wounded infantry by their legs.
  function moveFactor(e) {
    if (e.def.vehicle) return e.v.abandoned ? 0 : e.v.mobility === 'immobilized' ? 0 : e.v.mobility === 'slow' ? 0.5 : 1;
    return e.cond === 'wounded' ? 0.35 + 0.65 * infantryMobility(e) : 1;
  }

  // The turret needs a working gunner (or the commander), and a traverse drive that isn't jammed.
  function turretWorks(e) {
    const v = e.v;
    if (v.abandoned) return false;
    const g = v.crew.find((c) => c.role === 'gunner') ?? v.crew.find((c) => c.role === 'commander');
    return !!g && aliveCrew(g) && !(v.comps.turret && v.comps.turret.state === 'destroyed');
  }

  function react(e, dt, drone) {
    const def = e.def;
    const dx = e.x - drone.position[0], dz = e.z - drone.position[2];
    const away = Math.atan2(-dx, -dz);
    const dist = Math.hypot(dx, dz);
    if (def.turret && turretWorks(e)) { // track the drone with the turret
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
    const bolt = e.mult > 0 && (e.kind === 'truck' || e.kind === 'light' || (e.kind === 'apc' && dist < 50));
    if (bolt) { steer(e, dt, away, def.run); e.status = 'fleeing'; } else { steer(e, dt, e.yaw, 0); e.status = 'idle'; }
  }

  function updateInfantryDown(e, dt) {
    // Can't stand: lie still (down) or drag themselves away (crawling), bleeding.
    e.status = e.cond;
    steer(e, dt, e.fleeHeading, e.cond === 'crawling' ? CRAWL_SPEED : 0);
    if (e.cond === 'down') e.speed = 0;
  }

  function update(dt, drone) {
    time += dt;
    for (const e of list) {
      if (e.destroyed) {
        if (e.def.vehicle) sync(e); // wrecks keep their fire timer
        continue;
      }
      cur = e;
      if (e.def.vehicle) {
        tickVehicle(e, env, hooks);
        if (e.destroyed) continue;
        e.health = vehicleHealth(e);
      } else if (tickInfantry(e, env)) {
        e.health = infantryHealth(e);
        killInfantry(e, 'bleedout');
        continue;
      }
      if (e.ride) {
        // Riding: jump off when the vehicle is knocked out, or stops while they're alarmed;
        // the wounded fall off.
        const veh = e.ride.veh;
        const stop = veh.destroyed || veh.v.abandoned || !veh.v.operational || veh.v.mobility === 'immobilized';
        if (stop || e.cond !== 'ok' || (e.alerted && veh.speed < 1.5)) dismount(e);
        else {
          if (drone.active && !e.alerted && Math.hypot(e.x - drone.position[0], e.y - drone.position[1], e.z - drone.position[2]) < e.def.hearing + drone.speed * 4) {
            e.noticeT += dt; if (e.noticeT > e.reactAfter) alert(e);
          }
          follow(e);
          continue;
        }
      }
      e.mult = moveFactor(e);
      if (!e.def.vehicle && (e.cond === 'down' || e.cond === 'crawling')) {
        updateInfantryDown(e, dt);
        e.health = infantryHealth(e);
        ground(e); sync(e);
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
        if (e.def.turret && (!e.def.vehicle || turretWorks(e))) e.turretYaw = approach(e.turretYaw, 0, e.def.turret * 0.5 * dt);
      }
      ground(e);
      sync(e);
    }
  }

  function reset() {
    time = 0;
    nextCrewId = 0;
    for (const e of [...list]) if (e.dynamic) remove(e);
    for (const e of list) place(e);
  }

  for (const def of level.enemies ?? []) spawn(def);

  return {
    list, states, update, reset,
    get alive() { return list.filter((e) => !e.destroyed).length; },
    byId: (id) => list.find((e) => e.id === id),
  };
}
