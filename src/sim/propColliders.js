// Colliders for the front-line props in level.props (poles, fences, bales, sandbags, crater
// rims), and a wire field for the telegraph cables. Wires are too thin and too long for rigid
// bodies, so the drone's path each step is tested against the cables directly.

import RAPIER from '@dimforge/rapier3d-compat';
import { Euler, Quaternion, Vector3 } from 'three';

const _q = new Quaternion(), _q2 = new Quaternion(), _e = new Euler(), _v = new Vector3();
const X = new Vector3(1, 0, 0), Z = new Vector3(0, 0, 1), Y = new Vector3(0, 1, 0);

/** Add static colliders to `body` (the fixed ground body) and tag them in `surfaces`. */
export function addPropColliders(world, body, level, surfaces) {
  const pr = level.props;
  if (!pr) return;
  let n = 0;
  const put = (desc, pos, quat, kind) => {
    desc.setTranslation(pos[0], pos[1], pos[2]).setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    const c = world.createCollider(desc, body);
    surfaces.set(c.handle, { surface: 'prop', objectId: `${kind}${n++}` });
  };
  const yawQ = (yaw) => _q2.setFromAxisAngle(Y, yaw).clone();

  // Poles: a thin cylinder up the local Y axis plus the crossarm near the top.
  for (const p of pr.poles ?? []) {
    _q.setFromEuler(_e.set(p.rotation[0], p.rotation[1], p.rotation[2]));
    const q = _q.clone();
    const centre = _v.set(0, p.height / 2, 0).applyQuaternion(q);
    put(RAPIER.ColliderDesc.cylinder(p.height / 2, p.radius ?? 0.13), [p.x + centre.x, p.y + centre.y, p.z + centre.z], q, 'pole');
    const arm = _v.set(0, p.height * (7.0 / 7.5), 0).applyQuaternion(q);
    put(RAPIER.ColliderDesc.cuboid(0.85, 0.05, 0.05), [p.x + arm.x, p.y + arm.y, p.z + arm.z], q, 'pole');
  }

  // Fence panels: one thin solid panel from the ground up to `height`.
  for (const f of pr.fences ?? []) {
    const dx = f.b[0] - f.a[0], dz = f.b[2] - f.a[2], len = Math.hypot(dx, dz);
    const h = f.height ?? 1.2;
    put(
      RAPIER.ColliderDesc.cuboid(len / 2, h / 2, 0.05),
      [(f.a[0] + f.b[0]) / 2, (f.a[1] + f.b[1]) / 2 + h / 2, (f.a[2] + f.b[2]) / 2],
      yawQ(-Math.atan2(dz, dx)), 'fence',
    );
  }

  // Round bales: a cylinder lying along local X.
  for (const b of pr.bales ?? []) {
    const q = yawQ(b.yaw).multiply(_q.setFromAxisAngle(Z, Math.PI / 2));
    put(RAPIER.ColliderDesc.cylinder(b.length / 2, b.radius), [b.x, b.y, b.z], q, 'bale');
  }

  // Sandbags: one small box each.
  for (const s of pr.sandbags ?? []) {
    _q.setFromEuler(_e.set(0, s.yaw, s.roll ?? 0));
    put(RAPIER.ColliderDesc.cuboid(0.31, 0.1, 0.15), [s.x, s.y, s.z], _q.clone(), 'sandbag');
  }

  // Dugouts: log walls banked with earth and a log-and-earth roof over the front part.
  for (const d of pr.dugouts ?? []) {
    const q = yawQ(d.yaw), cos = Math.cos(d.yaw), sin = Math.sin(d.yaw);
    for (const b of dugoutBoxes(d)) {
      const [lx, ly, lz] = b.c;
      put(RAPIER.ColliderDesc.cuboid(...b.half), [d.x + lx * cos + lz * sin, d.y + ly, d.z - lx * sin + lz * cos], q, 'dugout');
    }
  }
  // Antenna masts: the pole only (guy lines are too thin to matter).
  for (const m of pr.masts ?? []) {
    put(RAPIER.ColliderDesc.cylinder(m.height / 2, 0.07), [m.x, m.y + m.height / 2, m.z], _q.identity(), 'mast');
  }

  // Crater rims: a ring of low boxes at 0.85 r, about 0.3 m tall.
  const SEG = 8;
  for (const c of pr.craters ?? []) {
    const R = c.r * 0.85, half = (Math.PI * R / SEG) * 0.95;
    for (let k = 0; k < SEG; k++) {
      const th = (k / SEG) * Math.PI * 2;
      put(
        RAPIER.ColliderDesc.cuboid(half, 0.15, 0.3),
        [c.x + Math.cos(th) * R, c.y + 0.08, c.z + Math.sin(th) * R],
        yawQ(-(th + Math.PI / 2)), 'rim',
      );
    }
  }
}

// --- Wires -----------------------------------------------------------------

const CELL = 8;
// Closest distance between segments p1→q1 and p2→q2 (Ericson, Real-Time Collision Detection).
const d1 = new Vector3(), d2 = new Vector3(), rr = new Vector3(), c1 = new Vector3(), c2 = new Vector3();
function segSegDistance(p1, q1, p2, q2) {
  d1.subVectors(q1, p1); d2.subVectors(q2, p2); rr.subVectors(p1, p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(rr);
  let s, t;
  if (a <= 1e-9 && e <= 1e-9) return p1.distanceTo(p2);
  if (a <= 1e-9) { s = 0; t = Math.min(1, Math.max(0, f / e)); }
  else {
    const c = d1.dot(rr);
    if (e <= 1e-9) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
    else {
      const b = d1.dot(d2), denom = a * e - b * b;
      s = denom > 1e-9 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  c1.copy(p1).addScaledVector(d1, s); c2.copy(p2).addScaledVector(d2, t);
  return c1.distanceTo(c2);
}

export class WireField {
  constructor(level, pieces = 4) {
    this.cells = new Map();
    this.count = 0;
    const key = (ix, iz) => ix * 100003 + iz;
    this.key = key;
    for (const w of level.props?.wires ?? []) {
      let prev = null;
      for (let k = 0; k <= pieces; k++) {
        const t = k / pieces;
        const p = new Vector3(w.a[0] + (w.b[0] - w.a[0]) * t, w.a[1] + (w.b[1] - w.a[1]) * t - w.sag * 4 * t * (1 - t), w.a[2] + (w.b[2] - w.a[2]) * t);
        if (prev) {
          const seg = [prev, p];
          this.count++;
          const x0 = Math.floor((Math.min(prev.x, p.x) - 1) / CELL), x1 = Math.floor((Math.max(prev.x, p.x) + 1) / CELL);
          const z0 = Math.floor((Math.min(prev.z, p.z) - 1) / CELL), z1 = Math.floor((Math.max(prev.z, p.z) + 1) / CELL);
          for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
            const kk = key(ix, iz);
            let list = this.cells.get(kk);
            if (!list) this.cells.set(kk, list = []);
            list.push(seg);
          }
        }
        prev = p;
      }
    }
    this._a = new Vector3(); this._b = new Vector3();
  }

  /** Did the drone, moving from `from` to `to` ({x,y,z}), touch a wire (within `radius`)? */
  hit(from, to, radius) {
    if (!this.count) return false;
    this._a.set(from.x, from.y, from.z); this._b.set(to.x, to.y, to.z);
    const x0 = Math.floor((Math.min(from.x, to.x) - radius) / CELL), x1 = Math.floor((Math.max(from.x, to.x) + radius) / CELL);
    const z0 = Math.floor((Math.min(from.z, to.z) - radius) / CELL), z1 = Math.floor((Math.max(from.z, to.z) + radius) / CELL);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const list = this.cells.get(this.key(ix, iz));
      if (!list) continue;
      for (const [p, q] of list) if (segSegDistance(this._a, this._b, p, q) < radius) return true;
    }
    return false;
  }
}

// Solid parts of a dugout in its local frame (floor centre at the origin, front wall towards −Z,
// entrance gap in the rear wall). Shared with the visuals so the logs sit where the colliders are.
export const DUGOUT_WALL = 0.8;      // wall + earth bank thickness
export const DUGOUT_DOOR = [0.15, 1.05]; // entrance gap in the rear wall, local x
export const DUGOUT_OPEN_REAR = 1.3; // the rear strip with no roof, only the net
export function dugoutBoxes(d) {
  const t = DUGOUT_WALL, hw = d.w / 2, hd = d.d / 2;
  const h = d.collapsed ? d.h * 0.55 : d.h;
  const out = [
    { c: [0, h / 2, -hd - t / 2], half: [hw + t, h / 2, t / 2] },
    { c: [-hw - t / 2, h / 2, 0], half: [t / 2, h / 2, hd] },
    { c: [hw + t / 2, h / 2, 0], half: [t / 2, h / 2, hd] },
  ];
  const [g0, g1] = DUGOUT_DOOR;
  const l0 = -hw - t, r1 = hw + t;
  out.push({ c: [(l0 + g0) / 2, h / 2, hd + t / 2], half: [(g0 - l0) / 2, h / 2, t / 2] });
  out.push({ c: [(g1 + r1) / 2, h / 2, hd + t / 2], half: [(r1 - g1) / 2, h / 2, t / 2] });
  const z0 = -hd - t, z1 = hd - DUGOUT_OPEN_REAR;
  out.push({ c: [0, h + 0.22, (z0 + z1) / 2], half: [hw + t, 0.22, (z1 - z0) / 2] });
  return out;
}
