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
  const copper = std({ color: 0xb87333, roughness: 0.35, metalness: 0.9 });
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
  // Firing wires: two coiled steel-spring leads bent up from the fuse into the bottom of the camera's
  // view, each ending in a tight copper contact coil that closes the circuit on impact.
  const springSteel = std({ color: 0x8a8d90, roughness: 0.35, metalness: 0.9 });
  const coilAlong = (curve, turns, radius, wireR, mat) => {
    const frames = curve.computeFrenetFrames(200, false);
    const pts = [];
    for (let i = 0; i <= 200; i++) {
      const t = i / 200, a = t * turns * Math.PI * 2;
      const p = curve.getPointAt(t);
      pts.push(p.addScaledVector(frames.normals[i], Math.cos(a) * radius).addScaledVector(frames.binormals[i], Math.sin(a) * radius));
    }
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 400, wireR, 4), mat, 0, 0, 0);
  };
  for (const sx of [-1, 1]) {
    const lead = new THREE.CatmullRomCurve3([
      new THREE.Vector3(sx * 0.006, -0.05, -0.19),
      new THREE.Vector3(sx * 0.014, -0.04, -0.225),
      new THREE.Vector3(sx * 0.02, -0.018, -0.25),
      new THREE.Vector3(sx * 0.024, 0.006, -0.262),
    ]);
    coilAlong(lead, 15, 0.0035, 0.0009, springSteel);
    const tip = lead.getPointAt(1), dir = lead.getTangentAt(1);
    const contact = new THREE.LineCurve3(tip.clone(), tip.clone().addScaledVector(dir, 0.022));
    coilAlong(contact, 9, 0.0026, 0.0008, copper);
  }
  scene.add(group);

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
    },
    dispose() { scene.remove(group); disposables.forEach((x) => x.dispose()); },
  };
}
