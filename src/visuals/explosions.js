// Blast effects for `explosion` events: flash, fireball, sparks, a smoke column that lingers and
// drifts, thrown soil, a ground dust ring, tumbling debris and a scorched crater in the ground.
import * as THREE from 'three';

const MAX_CHUNKS = 90;

export function createExplosions({ scene, level, smoke, fire, terrain }) {
  const light = new THREE.PointLight(new THREE.Color().setRGB(1.0, 0.62, 0.3), 0, 90, 1.6);
  scene.add(light);
  let flash = 0;
  const emitters = [];

  // Debris: dark clods that fly out, land and stay.
  const chunkGeo = new THREE.DodecahedronGeometry(0.11, 0);
  const chunkMat = new THREE.MeshStandardMaterial({ color: 0x1d1813, roughness: 1 });
  const chunks = new THREE.InstancedMesh(chunkGeo, chunkMat, MAX_CHUNKS);
  chunks.frustumCulled = false;
  chunks.castShadow = true;
  chunks.count = 0;
  scene.add(chunks);
  const chunkState = [];
  let chunkNext = 0;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();

  const rnd = (a, b) => a + Math.random() * (b - a);
  const dirUp = (minEl) => {
    const az = Math.random() * Math.PI * 2, el = rnd(minEl, Math.PI / 2);
    return [Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)];
  };

  function explode(ev) {
    const [x, y, z] = ev.position;
    // Scale from the charge when the sim gives one (about 0.3 to 0.7 kg TNT), else from the blast radius.
    const s = THREE.MathUtils.clamp(ev.chargeKg ? Math.cbrt(ev.chargeKg / 0.5) : (ev.radius ?? 8) / 8, 0.6, 2.2);
    const ground = level.terrain.heightAt(x, z);
    const onGround = ev.surface ? ev.surface === 'ground' || (ev.surface !== 'air' && y - ground < 2.5 * s) : y - ground < 2.5 * s;
    const big = ev.kind === 'ammo' || ev.kind === 'vehicle';

    light.position.set(x, y + 1.2, z);
    flash = 1;
    fire.spawn({ pos: [x, y + 0.5, z], vel: [0, 0, 0], size: 11 * s, grow: 0.6, life: 0.14, color: [3, 2.4, 1.6], alpha: 1, fadeIn: 100, drag: 0 });

    // Fireball: white-hot core cooling to dull red.
    for (let i = 0; i < 16; i++) {
      const d = dirUp(-0.2), sp = rnd(3, 10) * s;
      fire.spawn({
        pos: [x + d[0] * 0.4, y + 0.3 + d[1] * 0.4, z + d[2] * 0.4], vel: [d[0] * sp, d[1] * sp + 2, d[2] * sp],
        size: rnd(1.6, 3.2) * s, grow: 1.4, life: rnd(0.35, 0.75) * (big ? 1.6 : 1), drag: 4.5,
        color: [2.6, 1.7, 0.7], colorEnd: [0.7, 0.12, 0.02], alpha: 0.9, fadeIn: 40,
      });
    }
    for (let i = 0; i < 46; i++) {
      const d = dirUp(0.05), sp = rnd(14, 42) * s;
      fire.spawn({
        pos: [x, y + 0.3, z], vel: [d[0] * sp, d[1] * sp, d[2] * sp], size: rnd(0.08, 0.2), grow: 0, life: rnd(0.4, 1.3),
        drag: 1.2, gravity: 9.8, color: [3, 1.9, 0.7], colorEnd: [1.2, 0.3, 0.05], alpha: 1, fadeIn: 100,
      });
    }

    // Smoke: a dark rolling core that rises, thins and drifts downwind.
    for (let i = 0; i < 26; i++) {
      const d = dirUp(0.1), sp = rnd(1.5, 6) * s, k = rnd(0.035, 0.1);
      smoke.spawn({
        pos: [x + d[0] * s, y + 0.5 + d[1] * s, z + d[2] * s], vel: [d[0] * sp * 0.8, d[1] * sp + 1.5, d[2] * sp * 0.8],
        size: rnd(2.2, 3.8) * s, grow: 2.6, life: rnd(4.5, 9), drag: 1.3, gravity: -0.7, wind: 1,
        color: [k, k, k * 1.05], colorEnd: [0.26, 0.26, 0.27], alpha: 0.78, fadeIn: 14,
      });
    }

    if (onGround) {
      // Thrown soil, then the dust ring racing along the ground.
      for (let i = 0; i < 26; i++) {
        const d = dirUp(0.75), sp = rnd(7, 19) * s, k = rnd(0.6, 1);
        smoke.spawn({
          pos: [x, ground + 0.3, z], vel: [d[0] * sp, d[1] * sp, d[2] * sp], size: rnd(0.8, 1.6) * s, grow: 2.2,
          life: rnd(1.1, 2.1), drag: 0.9, gravity: 9.8, color: [0.16 * k, 0.125 * k, 0.09 * k], alpha: 0.85, fadeIn: 30,
        });
      }
      for (let i = 0; i < 30; i++) {
        const a = (i / 30) * Math.PI * 2 + rnd(0, 0.2), sp = rnd(9, 17) * s, k = rnd(0.75, 1.1);
        smoke.spawn({
          pos: [x + Math.cos(a) * s, ground + 0.4, z + Math.sin(a) * s], vel: [Math.cos(a) * sp, rnd(0.2, 1.4), Math.sin(a) * sp],
          size: rnd(1.4, 2.4) * s, grow: 2.8, life: rnd(1.8, 3.6), drag: 2.6, gravity: -0.1, wind: 0.6,
          color: [0.34 * k, 0.3 * k, 0.24 * k], alpha: 0.42, fadeIn: 12,
        });
      }
      terrain.scorch(x, z, 4.2 * s);
      for (let i = 0; i < 16; i++) {
        const d = dirUp(0.35), sp = rnd(6, 20) * s;
        chunkState[chunkNext] = {
          pos: [x, ground + 0.3, z], vel: [d[0] * sp, d[1] * sp, d[2] * sp], rot: [rnd(0, 6), rnd(0, 6), rnd(0, 6)],
          spin: [rnd(-9, 9), rnd(-9, 9), rnd(-9, 9)], size: rnd(0.5, 1.6), rest: false,
        };
        chunkNext = (chunkNext + 1) % MAX_CHUNKS;
      }
      chunks.count = Math.min(MAX_CHUNKS, Math.max(chunks.count, chunkState.length));
      // The crater keeps smouldering for a while.
      emitters.push({ pos: [x, ground + 0.4, z], left: big ? 45 : 22, total: big ? 45 : 22, acc: 0, s });
    }
  }

  function update(dt) {
    if (flash > 0) {
      flash = Math.max(0, flash - dt * 5.5);
      light.intensity = flash * flash * 4200;
    }
    for (let i = emitters.length - 1; i >= 0; i--) {
      const em = emitters[i];
      em.left -= dt;
      if (em.left <= 0) { emitters.splice(i, 1); continue; }
      const k = em.left / em.total;
      em.acc += dt * (3 + 7 * k);
      while (em.acc > 1) {
        em.acc -= 1;
        const g = rnd(0.1, 0.2) + (1 - k) * 0.12;
        smoke.spawn({
          pos: [em.pos[0] + rnd(-0.6, 0.6) * em.s, em.pos[1], em.pos[2] + rnd(-0.6, 0.6) * em.s], vel: [rnd(-0.3, 0.3), rnd(1.2, 2.6), rnd(-0.3, 0.3)],
          size: rnd(0.9, 1.5) * em.s, grow: 3.2, life: rnd(4, 7), drag: 0.5, gravity: -0.25, wind: 1,
          color: [g, g, g], alpha: 0.3 + 0.3 * k, fadeIn: 6,
        });
      }
    }
    let moving = false;
    for (let i = 0; i < chunkState.length; i++) {
      const c = chunkState[i];
      if (!c || c.done) continue;
      if (!c.rest) {
        c.vel[1] -= 9.8 * dt;
        for (let a = 0; a < 3; a++) { c.pos[a] += c.vel[a] * dt; c.rot[a] += c.spin[a] * dt; }
        const g = level.terrain.heightAt(c.pos[0], c.pos[2]) + 0.04;
        if (c.pos[1] <= g) {
          c.pos[1] = g;
          if (Math.abs(c.vel[1]) < 2.5) c.rest = true;
          else { c.vel[0] *= 0.45; c.vel[1] *= -0.25; c.vel[2] *= 0.45; }
        }
      }
      m4.compose(v.fromArray(c.pos), q.setFromEuler(e.set(c.rot[0], c.rot[1], c.rot[2])), sc.setScalar(c.size));
      chunks.setMatrixAt(i, m4);
      moving = true;
      if (c.rest) c.done = true;
    }
    if (moving) chunks.instanceMatrix.needsUpdate = true;
  }

  return {
    explode,
    update,
    dispose() { scene.remove(light, chunks); chunkGeo.dispose(); chunkMat.dispose(); chunks.dispose(); },
  };
}
