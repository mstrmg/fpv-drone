// The player on foot: a capsule moved by Rapier's kinematic character controller (walls, slopes,
// small steps), with mouse / right-stick look. Only used on levels with `level.start`.

import RAPIER from '@dimforge/rapier3d-compat';

const RADIUS = 0.28, HALF = 0.55;          // capsule: 1.66 m tall
const EYE = 1.6;                            // eye height above the feet
const WALK = 1.7, RUN = 4.2;                // m/s
const GRAVITY = 9.81;
export const GOGGLES_REACH = 2.4;           // m from the table to put the goggles on

export function createWalker(world, level) {
  const s = level.start;
  const feet = [...s.position];
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(feet[0], feet[1] + RADIUS + HALF + 0.02, feet[2]),
  );
  const collider = world.createCollider(RAPIER.ColliderDesc.capsule(HALF, RADIUS), body);
  const cc = world.createCharacterController(0.02);
  cc.enableAutostep(0.4, 0.2, false);
  cc.enableSnapToGround(0.45);
  cc.setMaxSlopeClimbAngle(48 * Math.PI / 180);
  cc.setSlideEnabled(true);

  // Where the goggles lie (the table by the dugout's front wall), in world space.
  const home = level.home;
  const table = home ? local(home, 0.45, -home.d / 2 + 0.45) : null;

  const p = {
    position: feet, yaw: s.yaw ?? 0, pitch: -0.08, speed: 0, bob: 0, vy: 0,
    nearGoggles: false,
  };

  function update(dt, c, ignore) {
    p.yaw -= c.lookX ?? 0;
    p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch - (c.lookY ?? 0)));
    let mx = c.moveX ?? 0, mz = c.moveZ ?? 0;
    const m = Math.hypot(mx, mz);
    if (m > 1) { mx /= m; mz /= m; }
    const sp = c.sprint && mz > 0.3 ? RUN : WALK;
    // Forward is −Z rotated by yaw.
    const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
    const vx = (-sin * mz + cos * mx) * sp, vz = (-cos * mz - sin * mx) * sp;
    p.vy = Math.max(-30, p.vy - GRAVITY * dt);
    cc.computeColliderMovement(collider, { x: vx * dt, y: p.vy * dt, z: vz * dt }, undefined, undefined,
      ignore ? (col) => !ignore(col) : undefined);
    const mv = cc.computedMovement();
    if (cc.computedGrounded()) p.vy = -0.5;
    const t = body.translation();
    const nx = t.x + mv.x, ny = t.y + mv.y, nz = t.z + mv.z;
    body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
    p.speed = Math.hypot(mv.x, mv.z) / dt;
    p.bob += p.speed * dt * 1.9;
    p.position[0] = nx; p.position[1] = ny - HALF - RADIUS; p.position[2] = nz;
    // Map edge: just stop there.
    const half = level.terrain.size / 2 - 5;
    if (Math.abs(nx) > half || Math.abs(nz) > half) {
      body.setNextKinematicTranslation({ x: Math.max(-half, Math.min(half, nx)), y: ny, z: Math.max(-half, Math.min(half, nz)) });
    }
    p.nearGoggles = !!table && Math.hypot(nx - table[0], nz - table[1]) < GOGGLES_REACH;
  }

  // Eye camera: yaw then pitch, a little head bob while walking.
  function writeCamera(cam, fovDeg) {
    const bobY = Math.sin(p.bob * 2) * 0.025 * Math.min(1, p.speed / 2);
    const bobX = Math.cos(p.bob) * 0.018 * Math.min(1, p.speed / 2);
    const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
    cam.position[0] = p.position[0] + cos * bobX;
    cam.position[1] = p.position[1] + EYE + bobY;
    cam.position[2] = p.position[2] - sin * bobX;
    // Quaternion of Euler(pitch, yaw, 0, 'YXZ').
    const cy = Math.cos(p.yaw / 2), sy = Math.sin(p.yaw / 2), cx = Math.cos(p.pitch / 2), sx = Math.sin(p.pitch / 2);
    cam.quaternion[0] = sx * cy;
    cam.quaternion[1] = cx * sy;
    cam.quaternion[2] = -sx * sy;
    cam.quaternion[3] = cx * cy;
    cam.fovDeg = fovDeg;
    cam.tiltDeg = 0;
  }

  return { state: p, update, writeCamera, collider, body };
}

// Dugout-local (x, z) → world [x, z]. Local −Z is the front wall, rotated by the dugout's yaw.
export function local(d, lx, lz) {
  const cos = Math.cos(d.yaw), sin = Math.sin(d.yaw);
  return [d.x + lx * cos + lz * sin, d.z - lx * sin + lz * cos];
}
