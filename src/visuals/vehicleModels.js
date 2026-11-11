// Procedural models of the vehicles seen on the front: a T-72B3-style tank with Kontakt-5 reactive
// armour and a welded "cope cage" over the turret, a BTR-82A-style eight-wheeled APC, and an
// Ural-style army truck. Parts that can be torn off in a wreck are built as separate named groups.
// Units are metres; forward is -Z, up is +Y, origin is the base centre on the ground.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const HALF_PI = Math.PI / 2;

// Collects primitives per material slot and merges them into one mesh per slot. Every vertex also
// gets `aH`, its height above the vehicle's base, which the paint shader uses for mud and dust.
export class Kit {
  constructor(base = 0) { this.parts = {}; this.base = base; }
  add(slot, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    geo.rotateX(rx); geo.rotateY(ry); geo.rotateZ(rz);
    geo.translate(x, y, z);
    if (geo.index) geo = geo.toNonIndexed();
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    (this.parts[slot] ??= []).push(geo);
    return this;
  }
  box(slot, w, h, d, x, y, z, rx, ry, rz) { return this.add(slot, new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz); }
  cyl(slot, r0, r1, h, x, y, z, rx, ry, rz, seg = 12) { return this.add(slot, new THREE.CylinderGeometry(r0, r1, h, seg), x, y, z, rx, ry, rz); }
  // A rod between two points.
  rod(slot, a, b, r, seg = 5) {
    const d = new THREE.Vector3().subVectors(b, a), len = d.length();
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    return this.add(slot, g, a.x, a.y, a.z);
  }
  // Extrudes a side profile given as [z, y] points across the vehicle's width.
  profile(slot, pts, width, x = 0) {
    const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
    g.rotateY(-HALF_PI);
    return this.add(slot, g, x + width / 2, 0, 0);
  }
  build(mats) {
    const g = new THREE.Group();
    for (const [slot, list] of Object.entries(this.parts)) {
      const geo = mergeGeometries(list);
      const p = geo.attributes.position, h = new Float32Array(p.count);
      for (let i = 0; i < p.count; i++) h[i] = p.getY(i) + this.base;
      geo.setAttribute('aH', new THREE.BufferAttribute(h, 1));
      const m = new THREE.Mesh(geo, mats[slot]);
      m.castShadow = true; m.receiveShadow = true;
      m.userData.slot = slot;
      g.add(m);
      list.forEach((x) => x.dispose());
    }
    return g;
  }
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// A welded anti-drone screen: posts up from the turret roof carrying a frame and a mesh roof.
function copeCage(kit, w, d, h, y0, zc = 0) {
  const x = w / 2, z0 = zc - d / 2, z1 = zc + d / 2, top = y0 + h;
  const corners = [[-x, z0], [x, z0], [x, z1], [-x, z1]];
  corners.forEach(([cx, cz], i) => {
    kit.rod('steel', V(cx * 0.55, y0, cz * 0.6 + zc * 0.4), V(cx, top, cz), 0.025);
    const [nx, nz] = corners[(i + 1) % 4];
    kit.rod('steel', V(cx, top, cz), V(nx, top, nz), 0.03);
  });
  for (let i = 1; i < 4; i++) kit.rod('steel', V(-x, top + 0.01, z0 + (d * i) / 4), V(x, top + 0.01, z0 + (d * i) / 4), 0.018);
  kit.add('net', new THREE.PlaneGeometry(w, d), 0, top + 0.02, zc, -HALF_PI);
}

function zMark(kit, x, y, z, size, ry) {
  kit.add('mark', new THREE.PlaneGeometry(size, size), x, y, z, 0, ry, 0);
}

// ---- Tank -------------------------------------------------------------------------------------

export function buildTank() {
  const body = new Kit(), parts = {};
  // Lower hull between the tracks and the upper hull with its steep glacis, from side profiles.
  body.profile('paint', [[-3.05, 0.48], [3.05, 0.48], [3.3, 0.7], [3.3, 1.05], [-3.3, 1.05], [-3.4, 0.82]], 2.15);
  body.profile('paint', [[-3.42, 1.0], [3.3, 1.0], [3.36, 1.42], [2.9, 1.5], [-2.2, 1.5], [-3.5, 1.06]], 3.38);
  // Kontakt-5 bricks across the glacis.
  for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) {
    const t = (r + 0.5) / 3, z = -3.45 + t * 1.2, y = 1.06 + t * 0.42;
    body.box('era', 0.5, 0.11, 0.38, -1.3 + c * 0.52, y + 0.07, z, -0.34);
  }
  body.box('dark', 3.1, 0.12, 0.25, 0, 1.08, -3.5);              // tow bar / lip
  for (const s of [-1, 1]) body.box('dark', 0.12, 0.08, 0.5, s * 1.4, 1.02, -3.62); // tow hooks
  body.box('dark', 1.9, 0.06, 1.6, 0, 1.53, 2.3);                // engine deck grilles
  for (let i = 0; i < 6; i++) body.box('steel', 1.8, 0.02, 0.04, 0, 1.57, 1.65 + i * 0.25);
  body.box('dark', 0.9, 0.35, 0.45, 1.25, 1.62, 1.2);            // fender stowage boxes
  body.box('dark', 0.9, 0.35, 0.45, -1.25, 1.62, 1.2);
  body.box('dark', 0.4, 0.05, 0.3, -0.45, 1.53, -1.9);           // driver's hatch
  body.box('glass', 0.18, 0.05, 0.06, -0.45, 1.56, -2.08);
  body.box('dark', 0.05, 0.05, 0.3, 1.0, 1.18, -3.42);           // headlights
  body.box('dark', 0.05, 0.05, 0.3, -1.0, 1.18, -3.42);

  // Running gear: six road wheels, drive sprocket at the rear, idler at the front, and the track.
  for (const s of [-1, 1]) {
    const x = s * 1.42;
    for (let i = 0; i < 6; i++) {
      const z = -2.3 + i * 0.86;
      body.cyl('tyre', 0.38, 0.38, 0.17, x - s * 0.13, 0.42, z, 0, 0, HALF_PI, 16);
      body.cyl('tyre', 0.38, 0.38, 0.17, x + s * 0.13, 0.42, z, 0, 0, HALF_PI, 16);
      body.cyl('steel', 0.14, 0.14, 0.5, x, 0.42, z, 0, 0, HALF_PI, 8);
    }
    body.cyl('steel', 0.36, 0.36, 0.48, x, 0.62, 3.05, 0, 0, HALF_PI, 14);
    for (let k = 0; k < 10; k++) body.box('steel', 0.5, 0.08, 0.1, x, 0.62 + Math.sin(k * 0.628) * 0.36, 3.05 + Math.cos(k * 0.628) * 0.36, k * 0.628);
    body.cyl('steel', 0.3, 0.3, 0.46, x, 0.55, -3.1, 0, 0, HALF_PI, 14);
    // Track: bottom run, top run and the wrap around both ends.
    body.box('track', 0.58, 0.08, 5.9, x, 0.04, 0.05);
    body.box('track', 0.58, 0.07, 5.8, x, 0.87, 0.0);
    for (let k = 0; k <= 6; k++) {
      const a = -HALF_PI + (k / 6) * Math.PI;
      body.box('track', 0.58, 0.07, 0.4, x, 0.62 + Math.sin(a) * 0.44, 3.05 + Math.cos(a) * 0.44, -a - HALF_PI);
      body.box('track', 0.58, 0.07, 0.36, x, 0.55 + Math.sin(a) * 0.38, -3.1 - Math.cos(a) * 0.38, a + HALF_PI);
    }
    // Fender over the track.
    body.box('paint', 0.6, 0.04, 6.4, x, 1.46, 0);
  }
  // Rubber side skirts with ERA panels at the front, separate so a wreck can shed them.
  for (const s of [-1, 1]) {
    const sk = new Kit(0.85);
    sk.box('rubber', 0.04, 0.62, 4.7, 0, 0, 0.5);
    for (let i = 0; i < 3; i++) sk.box('era', 0.12, 0.5, 0.48, s * 0.06, 0, -2.2 + i * 0.5);
    zMark(sk, s * 0.035, 0.05, 1.2, 0.55, s * HALF_PI);
    parts[s < 0 ? 'skirtL' : 'skirtR'] = { kit: sk, pos: [s * 1.74, 0.85, 0] };
  }
  // Rear: fuel drums on the hull plate and the unditching log.
  const drums = new Kit(1.3);
  drums.cyl('dark', 0.3, 0.3, 0.95, -0.85, 0, 0, 0, 0, HALF_PI, 14);
  drums.cyl('dark', 0.3, 0.3, 0.95, 0.85, 0, 0, 0, 0, HALF_PI, 14);
  drums.cyl('wood', 0.13, 0.13, 3.0, 0, 0.42, 0.1, 0, 0, HALF_PI, 8);
  parts.drums = { kit: drums, pos: [0, 1.3, 3.55] };

  // Turret: flattened cast dome, K-5 "horseshoe" wedges either side of the gun, sights and cupola.
  const tur = new Kit(1.5);
  tur.add('paint', new THREE.SphereGeometry(1, 22, 10, 0, Math.PI * 2, 0, HALF_PI).scale(1.55, 0.66, 1.72), 0, 0, 0.15);
  tur.cyl('paint', 1.6, 1.6, 0.12, 0, 0.0, 0.15, 0, 0, 0, 22);
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const a = s * (0.32 + k * 0.3);
      tur.box('era', 0.62, 0.42, 0.58, Math.sin(a) * 1.25, 0.32 - k * 0.04, -Math.cos(a) * 1.25 + 0.05, 0.12, a + s * 0.25, 0);
    }
    for (let k = 0; k < 4; k++) tur.cyl('dark', 0.045, 0.045, 0.32, s * (0.9 + k * 0.1), 0.55, -0.95 + k * 0.12, -0.9, 0, 0, 7); // smoke dischargers
    tur.box('dark', 0.55, 0.3, 0.45, s * 1.05, 0.38, 1.5);                 // bustle stowage
  }
  for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) tur.box('era', 0.36, 0.08, 0.34, -0.6 + c * 0.4, 0.68, -0.55 + r * 0.38, -0.06); // roof ERA
  tur.box('dark', 0.5, 0.42, 0.5, -0.55, 0.85, -0.45);                    // Sosna-U sight box
  tur.box('glass', 0.38, 0.22, 0.02, -0.55, 0.88, -0.71);
  tur.cyl('dark', 0.34, 0.37, 0.24, 0.55, 0.78, 0.15, 0, 0, 0, 14);       // commander's cupola
  tur.cyl('steel', 0.03, 0.03, 1.3, 0.55, 1.0, -0.35, HALF_PI, 0, 0, 6);  // Kord machine gun
  tur.box('dark', 0.16, 0.18, 0.5, 0.55, 0.98, 0.05);
  tur.cyl('dark', 0.11, 0.11, 2.2, 0, 0.55, 1.55, 0, 0, HALF_PI, 10);     // snorkel tube
  tur.rod('steel', V(-0.75, 0.6, 1.1), V(-0.9, 3.0, 1.35), 0.008, 4);      // radio whip
  tur.box('paint', 0.9, 0.55, 0.55, 0, 0.32, -1.35);                       // mantlet
  // Gun as its own group so a wreck's barrel can droop.
  const gun = new Kit(1.85);
  gun.cyl('steel', 0.085, 0.1, 5.1, 0, 0, -2.55, HALF_PI, 0, 0, 12);
  gun.cyl('dark', 0.15, 0.15, 1.2, 0, 0, -1.0, HALF_PI, 0, 0, 12);         // thermal sleeve
  gun.cyl('dark', 0.15, 0.15, 1.1, 0, 0, -3.35, HALF_PI, 0, 0, 12);
  gun.cyl('steel', 0.17, 0.15, 0.55, 0, 0, -2.2, HALF_PI, 0, 0, 14);       // fume extractor
  gun.cyl('steel', 0.11, 0.11, 0.2, 0, 0, -5.05, HALF_PI, 0, 0, 12);       // muzzle reference
  const cage = new Kit(2.3);
  copeCage(cage, 3.3, 3.6, 0.95, 0, 0.1);
  return {
    body, size: [3.6, 2.4, 7.0], engine: [0, 1.7, 2.4], sink: 0.05,
    turret: { kit: tur, pos: [0, 1.5, -0.25], gun: { kit: gun, pos: [0, 0.35, -1.55] }, cage: { kit: cage, pos: [0, 0.8, 0] } },
    parts, tossOnDeath: ['drums', 'skirtL', 'skirtR'],
  };
}

// ---- APC --------------------------------------------------------------------------------------

export function buildApc() {
  const body = new Kit(), parts = {}, wheels = [];
  // Boat-shaped hull: sharp bow for swimming, sides that lean in above the wheels.
  body.profile('paint', [[-3.85, 1.12], [-3.25, 0.52], [3.35, 0.52], [3.8, 1.0], [3.75, 1.5], [-3.85, 1.5]], 2.5);
  body.profile('paint', [[-3.85, 1.48], [3.75, 1.48], [3.6, 2.0], [-2.3, 2.08], [-3.88, 1.52]], 2.4);
  for (const s of [-1, 1]) {
    // Sloped upper side plates and the side door between the second and third axles.
    body.box('paint', 0.06, 0.65, 7.2, s * 1.3, 1.78, -0.05, 0, 0, s * 0.28);
    body.box('paint', 0.3, 0.06, 7.3, s * 1.35, 1.48, 0);
    body.box('dark', 0.05, 0.6, 0.9, s * 1.38, 1.7, -0.35, 0, 0, s * 0.28);
    body.box('dark', 0.05, 0.25, 0.4, s * 1.4, 1.25, -0.35);
    for (let i = 0; i < 3; i++) body.box('glass', 0.04, 0.12, 0.08, s * 1.4, 1.95, -2.3 + i * 0.9, 0, 0, s * 0.28); // vision blocks
    zMark(body, s * 1.47, 1.15, 1.6, 0.55, s * HALF_PI);
  }
  body.box('dark', 2.0, 0.04, 0.9, 0, 1.75, -3.0, -0.75);          // folded trim vane
  body.box('glass', 0.5, 0.25, 0.04, -0.5, 1.92, -2.25, -0.6);      // driver's windows
  body.box('glass', 0.5, 0.25, 0.04, 0.5, 1.92, -2.25, -0.6);
  body.box('dark', 0.55, 0.06, 0.55, -0.6, 2.1, 1.3);               // roof hatches
  body.box('dark', 0.55, 0.06, 0.55, 0.6, 2.1, 1.3);
  body.box('dark', 1.6, 0.06, 0.9, 0, 2.03, 2.6);                  // engine grilles
  body.box('dark', 0.6, 0.3, 0.1, 0, 1.0, 3.8);                    // water-jet door
  for (const s of [-1, 1]) body.box('dark', 0.1, 0.1, 0.12, s * 0.9, 1.25, -3.85);
  for (const z of [-2.75, -1.35, 0.7, 2.1]) for (const s of [-1, 1]) wheels.push([s * 1.27, 0.57, z, 0.57, 0.42]);
  // Small one-man turret with the 30 mm cannon and coaxial MG.
  const tur = new Kit(2.08);
  tur.cyl('paint', 0.62, 0.78, 0.5, 0, 0.25, 0, 0, 0, 0, 16);
  tur.box('paint', 0.7, 0.3, 0.5, 0, 0.18, -0.65);
  tur.box('dark', 0.25, 0.25, 0.3, 0.42, 0.62, -0.1);               // sights
  tur.box('glass', 0.18, 0.12, 0.02, 0.42, 0.66, -0.26);
  for (let k = 0; k < 3; k++) for (const s of [-1, 1]) tur.cyl('dark', 0.04, 0.04, 0.26, s * (0.55 + k * 0.08), 0.42, 0.2 + k * 0.1, -0.8, 0, 0, 6);
  const gun = new Kit(2.3);
  gun.cyl('steel', 0.045, 0.05, 2.5, 0, 0, -1.25, HALF_PI, 0, 0, 10);
  gun.cyl('steel', 0.07, 0.07, 0.25, 0, 0, -2.45, HALF_PI, 0, 0, 10);
  gun.cyl('steel', 0.025, 0.025, 0.8, 0.22, 0, -0.4, HALF_PI, 0, 0, 6);
  const cage = new Kit(2.6);
  copeCage(cage, 1.9, 2.0, 0.8, 0, 0);
  // Spare door/hatch that can be blown off.
  const hatch = new Kit(2.1);
  hatch.box('dark', 0.55, 0.06, 0.55, 0, 0, 0);
  parts.hatch = { kit: hatch, pos: [0.6, 2.1, 1.3] };
  return {
    body, wheels, size: [2.9, 2.8, 7.65], engine: [0, 2.0, 2.6], sink: 0.3,
    turret: { kit: tur, pos: [0, 2.05, -1.0], gun: { kit: gun, pos: [0, 0.25, -0.75] }, cage: { kit: cage, pos: [0, 0.55, 0] } },
    parts, tossOnDeath: ['hatch'],
  };
}

// ---- Truck ------------------------------------------------------------------------------------

export function buildTruck() {
  const body = new Kit(), parts = {}, wheels = [];
  body.box('dark', 0.95, 0.28, 7.1, 0, 0.98, 0.25);                      // chassis rails
  // Long bonnet with a sloped front and flat-sided wings.
  body.profile('paint', [[-3.55, 0.9], [-1.95, 0.9], [-1.95, 1.95], [-3.25, 1.85], [-3.6, 1.55]], 1.5);
  for (const s of [-1, 1]) body.profile('paint', [[-3.6, 1.05], [-2.1, 1.05], [-2.0, 1.5], [-2.3, 1.62], [-3.3, 1.62], [-3.55, 1.4]], 0.45, s * 0.98);
  body.box('dark', 1.3, 0.55, 0.06, 0, 1.4, -3.62);                     // grille
  body.box('dark', 2.4, 0.16, 0.22, 0, 0.92, -3.65);                    // bumper
  for (const s of [-1, 1]) body.cyl('glass', 0.11, 0.11, 0.08, s * 0.95, 1.5, -3.55, HALF_PI, 0, 0, 10); // headlights
  // Cab with doors, windscreen and mirrors.
  body.profile('paint', [[-1.95, 1.0], [-0.55, 1.0], [-0.55, 2.75], [-1.75, 2.75], [-1.98, 2.0]], 2.35);
  body.box('glass', 2.1, 0.62, 0.04, 0, 2.38, -1.88, 0.12);
  for (const s of [-1, 1]) {
    body.box('glass', 0.04, 0.5, 0.75, s * 1.18, 2.38, -1.2);
    body.box('dark', 0.03, 0.02, 1.05, s * 1.185, 1.55, -1.25);         // door seams
    body.box('dark', 0.03, 1.2, 0.02, s * 1.185, 1.75, -0.75);
    body.rod('steel', V(s * 1.18, 2.4, -1.85), V(s * 1.5, 2.55, -1.9), 0.015, 4);
    body.box('dark', 0.05, 0.3, 0.2, s * 1.5, 2.5, -1.9);
    body.box('dark', 0.55, 0.55, 0.9, s * 1.0, 1.15, 0.2);              // fuel tanks and steps
    zMark(body, s * 1.19, 1.65, -1.25, 0.6, s * HALF_PI);
  }
  // Load bed: plank sides, bows and a canvas tarp (the tarp burns away in a wreck).
  body.box('wood', 2.5, 0.12, 4.5, 0, 1.35, 1.6);
  for (const s of [-1, 1]) body.box('wood', 0.06, 0.55, 4.5, s * 1.22, 1.68, 1.6);
  body.box('wood', 2.5, 0.55, 0.06, 0, 1.68, 3.83);
  body.box('wood', 2.5, 0.55, 0.06, 0, 1.68, -0.63);
  for (let i = 0; i < 4; i++) {
    const z = -0.5 + i * 1.4;
    for (const s of [-1, 1]) body.rod('steel', V(s * 1.2, 1.9, z), V(s * 1.2, 2.75, z), 0.02, 4);
    body.rod('steel', V(-1.2, 2.75, z), V(1.2, 2.75, z), 0.02, 4);
  }
  const tarp = new Kit(2.3);
  tarp.box('canvas', 2.56, 0.95, 4.55, 0, 0, 0);
  tarp.cyl('canvas', 1.28, 1.28, 4.55, 0, 0.45, 0, HALF_PI, 0, 0, 16);
  parts.tarp = { kit: tarp, pos: [0, 2.3, 1.6] };
  // Spare wheel behind the cab.
  const spare = new Kit(1.9);
  spare.cyl('tyre', 0.55, 0.55, 0.36, 0, 0, 0, HALF_PI, 0, 0, 14);
  spare.cyl('steel', 0.3, 0.3, 0.38, 0, 0, 0, HALF_PI, 0, 0, 10);
  parts.spare = { kit: spare, pos: [0, 1.9, -0.32] };
  for (const z of [-2.75, 0.95, 2.45]) for (const s of [-1, 1]) wheels.push([s * 1.0, 0.56, z, 0.56, 0.38]);
  return { body, wheels, size: [2.5, 3.4, 7.4], engine: [0, 1.6, -2.7], sink: 0.28, parts, tossOnDeath: ['spare'], burnAway: ['tarp'] };
}

// Wheel with a tyre that burns off in a wreck, leaving the steel rim.
export function buildWheel(r, w) {
  const tyre = new Kit(r), rim = new Kit(r);
  tyre.cyl('tyre', r, r, w, 0, 0, 0, 0, 0, HALF_PI, 18);
  tyre.cyl('tyre', r * 0.92, r * 0.92, w + 0.04, 0, 0, 0, 0, 0, HALF_PI, 18);
  for (let k = 0; k < 9; k++) tyre.box('tyre', w + 0.02, 0.05, 0.1, 0, Math.sin(k * 0.698) * r, Math.cos(k * 0.698) * r, k * 0.698); // tread lugs
  rim.cyl('steel', r * 0.6, r * 0.6, w + 0.06, 0, 0, 0, 0, 0, HALF_PI, 12);
  rim.cyl('dark', r * 0.25, r * 0.25, w + 0.1, 0, 0, 0, 0, 0, HALF_PI, 8);
  return { tyre, rim };
}
