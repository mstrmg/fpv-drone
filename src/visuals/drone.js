// The player's quad: a 7-inch carbon FPV frame with top-mounted battery, seen at the edges of the
// frame from its own camera and from outside by the spotter.
import * as THREE from 'three';
import { makeCarbonTexture, makePropBlurTexture } from './textures.js';

const MOTORS = [[-0.115, -0.115, -1], [0.115, -0.115, 1], [0.115, 0.115, -1], [-0.115, 0.115, 1]]; // fl, fr, rr, rl; last = spin sign (CW seen from above is negative Y rotation)

export function createDrone({ scene }) {
  const group = new THREE.Group();
  const disposables = [];
  const keep = (x) => { disposables.push(x); return x; };
  const std = (opts) => keep(new THREE.MeshStandardMaterial(opts));
  const carbonTex = keep(makeCarbonTexture());
  carbonTex.repeat.set(6, 6);
  const carbon = std({ map: carbonTex, roughness: 0.42, metalness: 0.25 });
  const steel = std({ color: 0x8d9299, roughness: 0.32, metalness: 0.95 });
  const dark = std({ color: 0x15161a, roughness: 0.55, metalness: 0.4 });
  const anod = std({ color: 0x2b2440, roughness: 0.3, metalness: 0.9 });
  const rubber = std({ color: 0x1c1c1c, roughness: 0.95 });
  const propMat = std({ color: 0x2a2c2e, roughness: 0.5, transparent: true });
  const wrap = std({ color: 0x1b1d22, roughness: 0.6 });
  const label = std({ color: 0xc9a227, roughness: 0.7 });
  const strap = std({ color: 0x8a2f1b, roughness: 0.9 });
  const white = std({ color: 0xd8d8d2, roughness: 0.6 });
  const lens = std({ color: 0x05070a, roughness: 0.08, metalness: 0.6 });

  const add = (geo, mat, x, y, z, parent = group) => {
    const m = new THREE.Mesh(keep(geo), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cyl = (r0, r1, h, s = 16) => new THREE.CylinderGeometry(r0, r1, h, s);

  // Frame plates and arms.
  add(box(0.05, 0.003, 0.2), carbon, 0, -0.012, 0);
  add(box(0.046, 0.002, 0.17), carbon, 0, 0.014, 0);
  for (const [x, z] of [[-0.02, -0.085], [0.02, -0.085], [-0.02, -0.03], [0.02, -0.03], [-0.02, 0.03], [0.02, 0.03], [-0.02, 0.085], [0.02, 0.085]]) {
    add(cyl(0.0025, 0.0025, 0.026, 8), anod, x, 0.001, z);
  }
  add(box(0.034, 0.014, 0.034), dark, 0, -0.002, 0.005); // flight controller stack
  add(box(0.03, 0.01, 0.03), dark, 0, 0.0, 0.055);       // video transmitter

  const props = [];
  MOTORS.forEach(([x, z, sign]) => {
    const arm = add(box(0.016, 0.005, 0.17), carbon, x / 2, -0.0125, z / 2);
    arm.rotation.y = Math.atan2(x, z);
    add(cyl(0.0145, 0.0145, 0.006), dark, x, -0.007, z);
    add(cyl(0.0148, 0.0148, 0.013, 20), anod, x, 0.0025, z);
    add(cyl(0.012, 0.0148, 0.003, 20), steel, x, 0.0105, z);
    add(cyl(0.0035, 0.0035, 0.014, 8), steel, x, 0.018, z);
    add(cyl(0.006, 0.007, 0.012, 8), rubber, x, -0.021, z); // landing pad
    const hub = new THREE.Group();
    hub.position.set(x, 0.0205, z);
    group.add(hub);
    const blades = new THREE.Group();
    hub.add(blades);
    for (let k = 0; k < 3; k++) {
      const blade = add(box(0.082, 0.0012, 0.017), propMat, 0, 0, 0, blades);
      const a = (k / 3) * Math.PI * 2;
      blade.position.set(Math.cos(a) * 0.047, 0, -Math.sin(a) * 0.047);
      blade.rotation.set(0, a, 0);
      blade.rotateX(0.22 * -sign);
    }
    add(cyl(0.0075, 0.0075, 0.006, 10), propMat, 0, 0, 0, blades);
    const discMat = keep(new THREE.MeshBasicMaterial({ map: props.length ? props[0].disc.material.map : keep(makePropBlurTexture()), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    const disc = new THREE.Mesh(keep(new THREE.CircleGeometry(0.089, 28)), discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.001;
    hub.add(disc);
    props.push({ blades, disc, sign, angle: Math.random() * 6 });
  });

  // Battery on top with strap and lead.
  add(box(0.046, 0.034, 0.135), wrap, 0, 0.0325, 0.005);
  add(box(0.0465, 0.02, 0.07), label, 0, 0.0325, 0.0);
  add(box(0.05, 0.037, 0.018), strap, 0, 0.0325, -0.03);
  add(box(0.05, 0.037, 0.018), strap, 0, 0.0325, 0.04);
  add(box(0.012, 0.008, 0.03), label, 0.012, 0.03, 0.085);

  // FPV camera, tilted like the real one.
  const cam = new THREE.Group();
  cam.position.set(0, 0.003, -0.094);
  group.add(cam);
  add(box(0.02, 0.02, 0.016), dark, 0, 0, 0, cam);
  const lensMesh = add(cyl(0.007, 0.008, 0.012, 16), dark, 0, 0, -0.012, cam);
  lensMesh.rotation.x = Math.PI / 2;
  const glass = add(cyl(0.0055, 0.0055, 0.001, 16), lens, 0, 0, -0.0185, cam);
  glass.rotation.x = Math.PI / 2;
  add(box(0.002, 0.03, 0.026), carbon, -0.0125, 0.002, -0.088);
  add(box(0.002, 0.03, 0.026), carbon, 0.0125, 0.002, -0.088);

  // Antennas.
  const vtx = new THREE.Group();
  vtx.position.set(0, 0.012, 0.095);
  vtx.rotation.x = 0.6;
  group.add(vtx);
  add(cyl(0.0015, 0.0015, 0.075, 6), rubber, 0, 0.0375, 0, vtx);
  add(cyl(0.008, 0.008, 0.018, 12), white, 0, 0.08, 0, vtx);
  for (const s of [-1, 1]) {
    const rx = add(cyl(0.001, 0.001, 0.07, 5), white, s * 0.022, 0.03, 0.1);
    rx.rotation.set(0.5, 0, -s * 0.5);
  }

  // Warhead slung under the frame: a shaped-charge round held on with tape, fuse wires at the nose.
  const olive = std({ color: 0x3f4a2c, roughness: 0.7, metalness: 0.2 });
  const tape = std({ color: 0x9a9a94, roughness: 0.8 });
  const war = new THREE.Group();
  war.position.set(0, -0.052, -0.02);
  war.rotation.x = Math.PI / 2; // cylinders run along the body's Z axis
  group.add(war);
  add(cyl(0.036, 0.036, 0.11, 18), olive, 0, 0.0, 0, war);
  add(cyl(0.012, 0.036, 0.1, 18), olive, 0, -0.105, 0, war);   // nose cone, pointing forward
  add(cyl(0.008, 0.012, 0.03, 12), steel, 0, -0.17, 0, war);   // fuse
  add(cyl(0.036, 0.016, 0.05, 18), olive, 0, 0.08, 0, war);
  add(cyl(0.016, 0.016, 0.12, 12), olive, 0, 0.165, 0, war);   // tail tube
  add(cyl(0.0372, 0.0372, 0.018, 18), tape, 0, -0.03, 0, war);
  add(cyl(0.0372, 0.0372, 0.018, 18), tape, 0, 0.035, 0, war);
  // Contact fuse wires, as on the real drones: two thin white leads from the fuse on the warhead nose,
  // bent up into the bottom of the camera's view in wide sweeps out to either side, one of them
  // coiled into a loop. On impact they touch and fire the charge. They are floppy, so they lag,
  // whip and buzz with the drone: the bend is a spring-damper per wire (see update), applied in the
  // vertex shader.
  const wireMat = std({ color: 0xdedcd4, roughness: 0.55, metalness: 0.05 });
  const bendU = { uTipL: { value: new THREE.Vector3() }, uTipR: { value: new THREE.Vector3() } };
  wireMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, bendU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aBend;\nuniform vec3 uTipL, uTipR;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float bw = abs(aBend);
        transformed += (aBend < 0.0 ? uTipL : uTipR) * (bw * bw * (3.0 - bw) * 0.5); // cantilever shape`);
  };
  wireMat.customProgramCacheKey = () => 'fuse-wire';
  add(box(0.03, 0.016, 0.014), dark, 0, -0.05, -0.212);                  // fuse cap the leads come out of
  add(box(0.032, 0.006, 0.0145), tape, 0, -0.05, -0.212);
  // Points placed by where they appear in the picture: (x, y) across the frame (-1..1, y up) at a
  // distance d in front of the lens, for the FPV camera on its 30 degree mount.
  const camC = new THREE.Vector3(0, 0.03, -0.09), camF = new THREE.Vector3(0, 0.5, -0.866), camU = new THREE.Vector3(0, 0.866, 0.5);
  const S = (x, y, d) => camC.clone().addScaledVector(camF, d).add(new THREE.Vector3(x * 1.44 * d, 0, 0)).addScaledVector(camU, y * 0.81 * d);
  const loop = (cx, cy, rx, ry, d0, d1, a0, turns, n) => Array.from({ length: n }, (_, i) => {
    const a = a0 - (i / n) * turns * Math.PI * 2;
    return S(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, d0 + (d1 - d0) * (0.5 + 0.5 * Math.sin(a)));
  });
  const leads = [
    // Left: up from the nose, then a long sweep out to the left edge.
    { sx: -1, pts: [new THREE.Vector3(-0.005, -0.046, -0.218), S(-0.04, -1.3, 0.15), S(-0.16, -0.95, 0.19), S(-0.36, -0.68, 0.23),
      S(-0.62, -0.6, 0.25), S(-0.9, -0.66, 0.26), S(-1.15, -0.78, 0.26), S(-1.4, -0.92, 0.25)] },
    // Right: up into the middle, a loop, then out to the right edge.
    { sx: 1, pts: [new THREE.Vector3(0.005, -0.046, -0.218), S(0.03, -1.3, 0.16), S(0.0, -0.9, 0.2),
      ...loop(0.12, -0.56, 0.2, 0.17, 0.21, 0.26, Math.PI * 1.1, 0.92, 9),
      S(0.36, -0.72, 0.24), S(0.66, -0.78, 0.25), S(0.98, -0.83, 0.25), S(1.35, -0.92, 0.24)] },
  ];
  const wires = [];
  for (const { sx, pts } of leads) {
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const steps = 360, geo = new THREE.TubeGeometry(curve, steps, 0.0014, 6);
    const n = geo.attributes.position.count, bend = new Float32Array(n);
    for (let v = 0; v < n; v++) bend[v] = sx * Math.floor(v / 7) / steps;
    geo.setAttribute('aBend', new THREE.BufferAttribute(bend, 1));
    add(geo, wireMat, 0, 0, 0).castShadow = false;
    // Dynamics: offset u of the far end (drone frame) under inertial load; ~4 Hz, lightly damped.
    const tip = curve.getPointAt(0.7), axis = curve.getTangentAt(0.7);
    wires.push({ sx, axis, r: tip, u: new THREE.Vector3(), v: new THREE.Vector3(), w: 2 * Math.PI * (sx < 0 ? 3.7 : 4.3), uni: sx < 0 ? bendU.uTipL : bendU.uTipR });
  }
  scene.add(group);

  // Wire dynamics. The far part of each lead feels the drone's specific force (acceleration minus
  // gravity) plus the rotation terms at its lever arm; the steady hover sag is already in the shape.
  const vel = new THREE.Vector3(), prevVel = new THREE.Vector3(), ang = new THREE.Vector3(), prevAng = new THREE.Vector3();
  const acc = new THREE.Vector3(), alpha = new THREE.Vector3(), qInv = new THREE.Quaternion();
  const load = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3();
  let primed = false;
  function shakeWhiskers(d, dt) {
    if (!(dt > 0)) return;
    const h = Math.min(dt, 0.05);
    vel.fromArray(d.velocity ?? [0, 0, 0]); ang.fromArray(d.angularVelocity ?? [0, 0, 0]);
    if (!primed) { prevVel.copy(vel); prevAng.copy(ang); primed = true; }
    acc.subVectors(vel, prevVel).divideScalar(h); alpha.subVectors(ang, prevAng).divideScalar(h);
    prevVel.copy(vel); prevAng.copy(ang);
    qInv.copy(group.quaternion).invert();
    acc.y += 9.81;                                  // specific force, world
    acc.applyQuaternion(qInv); ang.applyQuaternion(qInv); alpha.applyQuaternion(qInv);
    acc.y -= 9.81;                                  // minus the level-hover load baked into the shape
    const buzz = d.crashed ? 0 : (d.motors[0] + d.motors[1] + d.motors[2] + d.motors[3]) / 4;
    for (const s of wires) {
      load.copy(acc).add(t1.crossVectors(alpha, s.r)).add(t1.crossVectors(ang, t2.crossVectors(ang, s.r)));
      load.addScaledVector(s.axis, -load.dot(s.axis)).clampLength(0, 45);
      const n = 4, hs = h / n, k = s.w * s.w, c = 2 * 0.05 * s.w;
      for (let i = 0; i < n; i++) {
        s.v.x += (-load.x - k * s.u.x - c * s.v.x + (Math.random() - 0.5) * 12 * buzz) * hs;
        s.v.y += (-load.y - k * s.u.y - c * s.v.y + (Math.random() - 0.5) * 12 * buzz) * hs;
        s.v.z += (-load.z - k * s.u.z - c * s.v.z + (Math.random() - 0.5) * 12 * buzz) * hs;
        s.v.addScaledVector(s.axis, -s.v.dot(s.axis));
        s.u.addScaledVector(s.v, hs);
      }
      s.u.clampLength(0, 0.045);
      // Motor vibration on top: a fine high-frequency shimmer.
      s.uni.value.copy(s.u).add(t1.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.0008 * buzz));
    }
  }

  return {
    group,
    update(d, tiltDeg, fpv, dt) {
      group.position.fromArray(d.position);
      group.quaternion.fromArray(d.quaternion);
      cam.rotation.x = THREE.MathUtils.degToRad(tiltDeg);
      cam.visible = !fpv; // it would sit inside the lens
      let maxBlur = 0;
      for (let i = 0; i < 4; i++) {
        const p = props[i], rpm = d.crashed ? 0 : d.motors[i];
        p.angle += p.sign * rpm * 260 * dt;
        p.blades.rotation.y = p.angle;
        const blur = THREE.MathUtils.smoothstep(rpm, 0.05, 0.3);
        p.disc.material.opacity = blur * 0.85;
        p.disc.visible = blur > 0.01;
        maxBlur = Math.max(maxBlur, blur);
      }
      propMat.opacity = 1 - maxBlur * 0.8;
      shakeWhiskers(d, dt);
    },
    dispose() { scene.remove(group); disposables.forEach((x) => x.dispose()); },
  };
}
