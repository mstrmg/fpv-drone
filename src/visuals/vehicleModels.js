// Procedural models of the vehicles seen on the front, one builder per variant in ARCHITECTURE.md:
//   tank:  t72 (T-72B3), t80 (T-80BVM), t90 (T-90M)
//   apc:   btr (BTR-82A), bmp (BMP-2), mtlb (MT-LB)
//   truck: ural (Ural-4320), kamaz (KamAZ-5350), fuel (Ural fuel tanker)
//   light: uaz (UAZ-469), pickup, technical (pickup with a heavy machine gun), atv (quad bike), moto (dirt bike)
// Each builder returns kits for the sprung hull, the turret and gun, loose parts a wreck can shed,
// and a list of wheels (road wheels, sprockets, tyres) that the animation spins.
// Units are metres; forward is -Z, up is +Y, origin is the base centre on the ground.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const HALF_PI = Math.PI / 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Collects primitives per material slot and merges them into one mesh per slot. Every vertex also
// gets `aH`, its height above the vehicle's base, which the paint shader uses for mud and soot.
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
  // Extrudes a side profile given as [z, y] points across the vehicle's width, centred on x.
  profile(slot, pts, width, x = 0) {
    const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
    g.rotateY(-HALF_PI);
    return this.add(slot, g, x + width / 2, 0, 0);
  }
  // Extrudes a cross-section given as [x, y] points along the vehicle's length.
  section(slot, pts, length, z = 0) {
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false });
    return this.add(slot, g, 0, 0, z - length / 2);
  }
  build(mats) {
    const g = new THREE.Group();
    for (const [slot, list] of Object.entries(this.parts)) {
      // Vertex ranges of each primitive, so a wreck can knock single ERA bricks off a merged mesh.
      let start = 0;
      const ranges = list.map((x) => { const r = [start, x.attributes.position.count]; start += r[1]; return r; });
      const geo = mergeGeometries(list);
      geo.userData.ranges = ranges;
      const p = geo.attributes.position, h = new Float32Array(p.count);
      for (let i = 0; i < p.count; i++) h[i] = p.getY(i) + this.base;
      geo.setAttribute('aH', new THREE.BufferAttribute(h, 1));
      const m = new THREE.Mesh(geo, mats[slot]);
      m.castShadow = slot !== 'mark' && slot !== 'net' && slot !== 'glass';
      m.receiveShadow = true;
      m.userData.slot = slot;
      g.add(m);
      list.forEach((x) => x.dispose());
    }
    return g;
  }
}

// ---- Shared pieces ----------------------------------------------------------------------------

// A welded anti-drone screen: posts up from the roof carrying a frame and a mesh roof.
function copeCage(kit, w, d, h, zc = 0) {
  const x = w / 2, z0 = zc - d / 2, z1 = zc + d / 2;
  const corners = [[-x, z0], [x, z0], [x, z1], [-x, z1]];
  corners.forEach(([cx, cz], i) => {
    kit.rod('steel', V(cx * 0.55, 0, cz * 0.6 + zc * 0.4), V(cx, h, cz), 0.025);
    const [nx, nz] = corners[(i + 1) % 4];
    kit.rod('steel', V(cx, h, cz), V(nx, h, nz), 0.03);
  });
  for (let i = 1; i < 4; i++) kit.rod('steel', V(-x, h + 0.01, z0 + (d * i) / 4), V(x, h + 0.01, z0 + (d * i) / 4), 0.018);
  kit.add('net', new THREE.PlaneGeometry(w, d), 0, h + 0.02, zc, -HALF_PI);
}

function zMark(kit, x, y, z, size, ry) {
  kit.add('mark', new THREE.PlaneGeometry(size, size), x, y, z, 0, ry, 0);
}

// A grid of reactive-armour bricks on a sloped plate.
function eraRows(kit, rows, cols, x0, x1, zA, yA, zB, yB, tilt, brick = [0.5, 0.11, 0.38]) {
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const t = (r + 0.5) / rows, x = x0 + ((c + 0.5) / cols) * (x1 - x0);
    kit.box('era', brick[0], brick[1], brick[2], x, yA + (yB - yA) * t + 0.06, zA + (zB - zA) * t, tilt);
  }
}

// The track as a closed belt around the road wheels, sprocket and idler. Its UVs run along the
// belt (one texture repeat per link) so the texture can scroll as the vehicle drives.
export const LINK = 0.16;
function trackBelt(kit, x, w, th, path) {
  // Resample the outline into short segments.
  const pts = [];
  for (let i = 0; i < path.length; i++) {
    const a = path[i], b = path[(i + 1) % path.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.08));
    for (let k = 0; k < n; k++) pts.push([a[0] + (b[0] - a[0]) * (k / n), a[1] + (b[1] - a[1]) * (k / n)]);
  }
  const n = pts.length, s = [0];
  for (let i = 1; i <= n; i++) s.push(s[i - 1] + Math.hypot(pts[i % n][0] - pts[i - 1][0], pts[i % n][1] - pts[i - 1][1]));
  const nor = pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const tz = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tz, ty) || 1;
    return [ty / l, -tz / l]; // outward for a loop running forward along the bottom
  });
  const pos = [], nrm = [], uv = [];
  const quad = (A, B, C, D, N, UA, UB, UC, UD) => {
    for (const [P, U] of [[A, UA], [B, UB], [C, UC], [A, UA], [C, UC], [D, UD]]) { pos.push(...P); nrm.push(...N); uv.push(...U); }
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, v0 = s[i] / LINK, v1 = s[i + 1] / LINK;
    const o = (k, sgn) => [pts[k][0] + nor[k][0] * th * 0.5 * sgn, pts[k][1] + nor[k][1] * th * 0.5 * sgn];
    const oi = o(i, 1), oj = o(j, 1), ii = o(i, -1), ij = o(j, -1);
    const P = (zy, xx) => [xx, zy[1], zy[0]];
    const nm = [0, (nor[i][1] + nor[j][1]) / 2, (nor[i][0] + nor[j][0]) / 2];
    quad(P(oi, x - w / 2), P(oi, x + w / 2), P(oj, x + w / 2), P(oj, x - w / 2), nm, [0, v0], [1, v0], [1, v1], [0, v1]);
    quad(P(ii, x + w / 2), P(ii, x - w / 2), P(ij, x - w / 2), P(ij, x + w / 2), [0, -nm[1], -nm[2]], [1, v0], [0, v0], [0, v1], [1, v1]);
    quad(P(ii, x + w / 2), P(ij, x + w / 2), P(oj, x + w / 2), P(oi, x + w / 2), [1, 0, 0], [0.9, v0], [0.9, v1], [1, v1], [1, v0]);
    quad(P(oi, x - w / 2), P(oj, x - w / 2), P(ij, x - w / 2), P(ii, x - w / 2), [-1, 0, 0], [0, v0], [0, v1], [0.1, v1], [0.1, v0]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  kit.add(x < 0 ? 'trackL' : 'trackR', g);
}

function arc(out, cz, cy, r, a0, a1, steps = 8) {
  for (let k = 0; k <= steps; k++) { const a = a0 + (a1 - a0) * (k / steps); out.push([cz + Math.cos(a) * r, cy + Math.sin(a) * r]); }
}

// Tracked running gear. `rear` and `front` are the sprocket/idler wheels; `rollers` are return
// rollers (empty for vehicles whose track rests on the road wheels).
function trackedGear(kit, wheels, o) {
  const th = 0.07, roadY = o.roadR + th;
  for (const sx of [-1, 1]) {
    const x = sx * o.x;
    for (const z of o.roadZ) wheels.push({ type: 'road', x, y: roadY, z, r: o.roadR, w: o.w * 0.86 });
    wheels.push({ type: 'sprocket', x, y: o.rear.y, z: o.rear.z, r: o.rear.r, w: o.w * 0.7 });
    wheels.push({ type: 'idler', x, y: o.front.y, z: o.front.z, r: o.front.r, w: o.w * 0.7 });
    for (const z of o.rollers ?? []) wheels.push({ type: 'roller', x, y: o.rollerY, z, r: 0.1, w: o.w * 0.5 });
    // Belt outline in (z, y), running rearward along the ground first.
    const half = th / 2, path = [];
    const first = o.roadZ[0], last = o.roadZ[o.roadZ.length - 1];
    path.push([first, half]);
    path.push([last, half]);
    arc(path, o.rear.z, o.rear.y, o.rear.r + half, -HALF_PI * 0.75, HALF_PI, 8);
    if (o.rollers?.length) {
      for (const z of [...o.rollers].sort((a, b) => b - a)) path.push([z, o.rollerY + 0.1 + half]);
    } else {
      const tops = [...o.roadZ].sort((a, b) => b - a);
      for (let i = 0; i < tops.length; i++) {
        path.push([tops[i], roadY + o.roadR + half]);
        if (i < tops.length - 1) path.push([(tops[i] + tops[i + 1]) / 2, roadY + o.roadR + half - 0.03]);
      }
    }
    arc(path, o.front.z, o.front.y, o.front.r + half, HALF_PI, Math.PI * 1.25, 8);
    trackBelt(kit, x, o.w, th, path);
  }
  return roadY;
}

function tyreWheels(wheels, r, w, x, zs, y = r, steerAxles = 1) {
  zs.forEach((z, i) => { for (const sx of [-1, 1]) wheels.push({ type: 'tyre', x: sx * x, y, z, r, w, steer: i < steerAxles ? 1 - i * 0.45 : 0 }); });
}

// ---- Tanks ------------------------------------------------------------------------------------

function tankHull(kit, o) {
  const W = o.width, L = o.length, hz = L / 2;
  // Lower hull between the tracks and upper hull with the steep glacis.
  kit.profile('paint', [[-hz + 0.25, 0.48], [hz - 0.25, 0.48], [hz, 0.7], [hz, 1.05], [-hz, 1.05], [-hz - 0.1, 0.82]], W - 1.25);
  kit.profile('paint', [[-hz - 0.12, 1.0], [hz, 1.0], [hz + 0.06, 1.42], [hz - 0.4, 1.5], [-hz + 1.25, 1.5], [-hz - 0.2, 1.06]], W - 0.2);
  for (const sx of [-1, 1]) kit.box('paint', 0.6, 0.04, L - 0.3, sx * (W / 2 - 0.4), 1.46, 0.05); // fenders
  kit.box('dark', W - 0.5, 0.12, 0.25, 0, 1.08, -hz - 0.2);
  for (const sx of [-1, 1]) kit.box('dark', 0.12, 0.08, 0.5, sx * 1.35, 1.02, -hz - 0.32);
  kit.cyl('dark', 0.24, 0.24, 0.03, -0.45, 1.515, -hz + 1.55, 0, 0, 0, 14);  // driver's hatch ring
  kit.box('glass', 0.18, 0.05, 0.06, -0.45, 1.56, -hz + 1.38);
  for (const sx of [-1, 1]) kit.box('glass', 0.06, 0.06, 0.04, sx * 1.0, 1.2, -hz - 0.1); // headlights
  return { hz };
}

// Kit carried on the outside of a tank: tow cables, headlight guards, spare track links on the
// lower glacis, and (Soviet style) extra fuel drums on the right fender.
function tankStowage(kit, o) {
  const { hz, W } = o, x = W / 2 - 0.08;
  for (const sx of [-1, 1]) {
    for (const dy of [0, -0.05]) kit.rod('steel', V(sx * x, 1.37 + dy, -hz + 0.6), V(sx * x, 1.37 + dy, hz - 0.8), 0.021, 5);
    kit.cyl('steel', 0.06, 0.06, 0.025, sx * x, 1.345, -hz + 0.52, 0, 0, HALF_PI, 8);
    kit.rod('steel', V(sx * 1.0, 1.12, -hz - 0.16), V(sx * 1.0, 1.32, -hz - 0.24), 0.01, 4);
    kit.rod('steel', V(sx * 0.9, 1.32, -hz - 0.24), V(sx * 1.1, 1.32, -hz - 0.24), 0.01, 4);
  }
  for (let i = 0; i < 5; i++) {
    kit.box('dark', 0.36, 0.045, 0.15, -1.1 + i * 0.55, 0.7, -hz + 0.06, -0.85);
    kit.box('steel', 0.08, 0.06, 0.06, -1.1 + i * 0.55, 0.74, -hz + 0.02, -0.85);
  }
  if (o.fuel) for (let i = 0; i < 3; i++) {
    kit.cyl('dark', 0.17, 0.17, 0.75, W / 2 - 0.32, 1.67, -0.2 + i * 0.85, HALF_PI, 0, 0, 12);
    kit.box('steel', 0.4, 0.03, 0.05, W / 2 - 0.32, 1.67, 0.15 + i * 0.85);
  }
}

function tankCommonTurretBits(tur, o) {
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 4; k++) tur.cyl('dark', 0.045, 0.045, 0.32, sx * (0.9 + k * 0.1), 0.55, -0.85 + k * 0.12, -0.9, 0, 0, 7); // smoke dischargers
  }
  tur.cyl('dark', 0.34, 0.37, 0.24, 0.55, o.roof, 0.2, 0, 0, 0, 14);          // commander's cupola
  for (let k = 0; k < 6; k++) {                                                 // vision blocks
    const a = (k / 6) * Math.PI * 2;
    tur.box('glass', 0.08, 0.05, 0.03, 0.55 + Math.sin(a) * 0.35, o.roof + 0.06, 0.2 + Math.cos(a) * 0.35, 0, a, 0);
  }
  tur.cyl('dark', 0.26, 0.26, 0.03, -0.45, o.gunnerY, o.gunnerZ, 0, 0, 0, 14);  // gunner's hatch ring
  for (const sx of [-1, 1]) tur.rod('steel', V(sx * 0.95, 0.5, 0.9), V(sx * 1.1, 0.42, 1.25), 0.015, 4); // grab rails
  tur.cyl('steel', 0.03, 0.03, 1.3, 0.55, o.roof + 0.24, -0.3, HALF_PI, 0, 0, 6); // Kord MG
  tur.box('dark', 0.16, 0.18, 0.5, 0.55, o.roof + 0.22, 0.1);
  tur.rod('steel', V(-0.75, 0.6, 1.1), V(-0.9, 3.0, 1.35), 0.008, 4);          // radio whip
}

function tankGun(len, r) {
  const gun = new Kit(1.85);
  gun.cyl('steel', r * 0.85, r, len, 0, 0, -len / 2, HALF_PI, 0, 0, 12);
  gun.cyl('dark', r * 1.6, r * 1.6, 1.2, 0, 0, -1.0, HALF_PI, 0, 0, 12);       // thermal sleeve
  gun.cyl('dark', r * 1.6, r * 1.6, 1.0, 0, 0, -len * 0.62, HALF_PI, 0, 0, 12);
  gun.cyl('steel', r * 1.75, r * 1.6, 0.55, 0, 0, -len * 0.45, HALF_PI, 0, 0, 14); // fume extractor
  gun.cyl('steel', r * 1.15, r * 1.15, 0.2, 0, 0, -len + 0.05, HALF_PI, 0, 0, 12);
  return gun;
}

// Crew seats shown out of the hatches: `pos` is where the figure stands (its feet; the lower body is
// hidden in the hull). Drivers sit, with the legs forward.
function tankCrew(hz, cmdY) {
  return [
    { role: 'commander', on: 'turret', pos: [0.55, cmdY, 0.2], hatch: 'commander' },
    { role: 'driver', on: 'hull', pos: [-0.44, 0.08, -hz + 1.6], hatch: 'driver', mode: 'driver' },
  ];
}

// Hatch lids: hinged at `pos`, the lid extending along `dir` (x, z) from the hinge.
function tankHatches(hz, cupolaTop, gunnerY, gunnerZ) {
  return [
    { name: 'commander', on: 'turret', pos: [0.55, cupolaTop + 0.01, 0.5], r: 0.3, dir: [0, -1] },
    { name: 'gunner', on: 'turret', pos: [-0.45, gunnerY + 0.01, gunnerZ + 0.25], r: 0.25, dir: [0, -1] },
    { name: 'driver', on: 'hull', pos: [-0.65, 1.535, -hz + 1.55], r: 0.21, dir: [1, 0] },
  ];
}

function buildT72() {
  const hull = new Kit(), wheels = [], parts = {};
  const L = 6.9, W = 3.6;
  const { hz } = tankHull(hull, { width: W, length: L });
  eraRows(hull, 3, 6, -1.55, 1.55, -hz - 0.12, 1.0, -hz + 1.25, 1.5, -0.34);  // Kontakt-5 on the glacis
  hull.box('dark', 1.9, 0.06, 1.6, 0, 1.53, hz - 1.15);                         // engine deck
  for (let i = 0; i < 6; i++) hull.box('steel', 1.8, 0.02, 0.04, 0, 1.57, hz - 1.8 + i * 0.25);
  for (const sx of [-1, 1]) hull.box('dark', 0.9, 0.35, 0.45, sx * 1.25, 1.62, 1.2); // stowage
  hull.box('dark', 0.5, 0.15, 0.35, -1.55, 1.3, hz - 0.6);                      // exhaust on the left fender
  trackedGear(hull, wheels, { x: 1.42, w: 0.58, roadR: 0.37, roadZ: [-2.3, -1.44, -0.58, 0.28, 1.14, 2.0], rear: { z: 3.05, y: 0.62, r: 0.33 }, front: { z: -3.1, y: 0.55, r: 0.3 } });
  for (const sx of [-1, 1]) {
    const sk = new Kit(0.85);
    sk.box('rubber', 0.04, 0.62, 4.7, 0, 0, 0.5);
    for (let i = 0; i < 3; i++) sk.box('era', 0.12, 0.5, 0.48, sx * 0.06, 0, -2.2 + i * 0.5);
    zMark(sk, sx * 0.035, 0.05, 1.2, 0.55, sx * HALF_PI);
    parts[sx < 0 ? 'skirtL' : 'skirtR'] = { kit: sk, pos: [sx * 1.74, 0.85, 0] };
  }
  const drums = new Kit(1.3);
  drums.cyl('dark', 0.3, 0.3, 0.95, -0.85, 0, 0, 0, 0, HALF_PI, 14);
  drums.cyl('dark', 0.3, 0.3, 0.95, 0.85, 0, 0, 0, 0, HALF_PI, 14);
  drums.cyl('wood', 0.13, 0.13, 3.0, 0, 0.42, 0.1, 0, 0, HALF_PI, 8);
  parts.drums = { kit: drums, pos: [0, 1.3, hz + 0.1] };
  // Cast turret: flattened dome with K-5 "horseshoe" wedges either side of the gun.
  const tur = new Kit(1.5);
  tur.add('paint', new THREE.SphereGeometry(1, 22, 10, 0, Math.PI * 2, 0, HALF_PI).scale(1.55, 0.66, 1.72), 0, 0, 0.15);
  tur.cyl('paint', 1.6, 1.6, 0.12, 0, 0.0, 0.15, 0, 0, 0, 22);
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const a = sx * (0.32 + k * 0.3);
      tur.box('era', 0.62, 0.42, 0.58, Math.sin(a) * 1.25, 0.32 - k * 0.04, -Math.cos(a) * 1.25 + 0.05, 0.12, a + sx * 0.25, 0);
    }
    tur.box('dark', 0.55, 0.3, 0.45, sx * 1.05, 0.38, 1.5);
  }
  for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) tur.box('era', 0.36, 0.08, 0.34, -0.6 + c * 0.4, 0.68, -0.55 + r * 0.38, -0.06);
  tur.box('dark', 0.5, 0.42, 0.5, -0.55, 0.85, -0.45);                           // Sosna-U sight
  tur.box('glass', 0.38, 0.22, 0.02, -0.55, 0.88, -0.71);
  tur.cyl('dark', 0.11, 0.11, 2.2, 0, 0.55, 1.55, 0, 0, HALF_PI, 10);           // snorkel
  tur.box('paint', 0.9, 0.55, 0.55, 0, 0.32, -1.35);                            // mantlet
  tankCommonTurretBits(tur, { roof: 0.78, gunnerY: 0.63, gunnerZ: 0.35 });
  tur.cyl('canvas', 0.15, 0.15, 1.5, 0, 0.5, 1.55, 0, 0, HALF_PI, 10);          // rolled tarpaulin
  tankStowage(hull, { hz, W });
  const cage = new Kit(2.3);
  copeCage(cage, 3.3, 3.6, 0.95, 0.1);
  return {
    hull, wheels, parts, size: [W, 2.2, L], tracked: true, era: true, engine: [0, 1.6, hz - 1.0],
    exhaust: [[-1.75, 1.3, hz - 0.6, -1, 0.3, 0.3]], fires: [[0, 1.6, hz - 1.0], [0.55, 2.4, 0.0], [-0.45, 1.55, -hz + 1.55]],
    turret: { kit: tur, pos: [0, 1.5, -0.25], gun: { kit: tankGun(5.1, 0.1), pos: [0, 0.35, -1.55] }, cage: { kit: cage, pos: [0, 0.8, 0] } },
    tossOnDeath: ['drums', 'skirtL', 'skirtR'], sink: 0.05,
    hatches: tankHatches(hz, 0.9, 0.645, 0.35), crew: tankCrew(hz, -0.43),
  };
}

function buildT80() {
  const hull = new Kit(), wheels = [], parts = {};
  const L = 7.0, W = 3.6;
  const { hz } = tankHull(hull, { width: W, length: L });
  eraRows(hull, 3, 5, -1.5, 1.5, -hz - 0.12, 1.0, -hz + 1.25, 1.5, -0.34, [0.58, 0.1, 0.42]); // Relikt panels
  // Gas turbine: big louvred exhaust in the rear plate and a long low engine deck.
  hull.box('dark', 1.7, 0.45, 0.08, 0, 1.15, hz + 0.08);
  for (let i = 0; i < 5; i++) hull.box('steel', 1.6, 0.03, 0.1, 0, 0.98 + i * 0.09, hz + 0.12, 0.6);
  hull.box('dark', 2.2, 0.06, 2.0, 0, 1.53, hz - 1.3);
  for (let i = 0; i < 8; i++) hull.box('steel', 2.0, 0.02, 0.04, 0, 1.57, hz - 2.1 + i * 0.22);
  trackedGear(hull, wheels, { x: 1.42, w: 0.58, roadR: 0.34, roadZ: [-2.35, -1.5, -0.62, 0.26, 1.14, 2.02], rear: { z: 3.1, y: 0.6, r: 0.32 }, front: { z: -3.12, y: 0.52, r: 0.28 }, rollers: [-1.9, -0.9, 0.1, 1.1, 2.1], rollerY: 0.76 });
  for (const sx of [-1, 1]) {
    const sk = new Kit(0.85);
    sk.box('rubber', 0.04, 0.6, 5.2, 0, 0, 0.3);
    for (let i = 0; i < 4; i++) sk.box('era', 0.1, 0.48, 0.5, sx * 0.05, 0, -2.2 + i * 0.52);
    zMark(sk, sx * 0.035, 0.05, 1.4, 0.55, sx * HALF_PI);
    parts[sx < 0 ? 'skirtL' : 'skirtR'] = { kit: sk, pos: [sx * 1.74, 0.85, 0] };
  }
  const tur = new Kit(1.5);
  tur.add('paint', new THREE.SphereGeometry(1, 22, 10, 0, Math.PI * 2, 0, HALF_PI).scale(1.5, 0.62, 1.65), 0, 0, 0.2);
  tur.cyl('paint', 1.55, 1.55, 0.12, 0, 0, 0.2, 0, 0, 0, 22);
  for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) {
    const a = sx * (0.34 + k * 0.28);
    tur.box('era', 0.6, 0.38, 0.12, Math.sin(a) * 1.4, 0.36, -Math.cos(a) * 1.4 + 0.2, 0.25, a, 0); // Relikt panels
  }
  // Slat armour around the rear bustle.
  for (let i = 0; i < 9; i++) tur.box('steel', 0.03, 0.55, 0.03, -1.3 + i * 0.32, 0.35, 1.85);
  tur.box('steel', 2.7, 0.04, 0.04, 0, 0.6, 1.85); tur.box('steel', 2.7, 0.04, 0.04, 0, 0.1, 1.85);
  tur.box('dark', 0.45, 0.4, 0.45, -0.55, 0.8, -0.4);
  tur.box('glass', 0.34, 0.2, 0.02, -0.55, 0.83, -0.63);
  tur.box('paint', 0.85, 0.5, 0.5, 0, 0.3, -1.3);
  tankCommonTurretBits(tur, { roof: 0.74, gunnerY: 0.6, gunnerZ: 0.35 });
  tankStowage(hull, { hz, W });
  const cage = new Kit(2.3);
  copeCage(cage, 3.2, 3.8, 0.9, 0.3);
  return {
    hull, wheels, parts, size: [W, 2.2, L], tracked: true, era: true, engine: [0, 1.6, hz - 1.2],
    exhaust: [[0, 1.15, hz + 0.15, 0, 0.1, 1]], fires: [[0, 1.6, hz - 1.2], [0.55, 2.35, 0.1], [-0.45, 1.55, -hz + 1.55]],
    turret: { kit: tur, pos: [0, 1.5, -0.3], gun: { kit: tankGun(5.0, 0.1), pos: [0, 0.33, -1.5] }, cage: { kit: cage, pos: [0, 0.78, 0] } },
    tossOnDeath: ['skirtL', 'skirtR'], sink: 0.05,
    hatches: tankHatches(hz, 0.86, 0.615, 0.35), crew: tankCrew(hz, -0.47),
  };
}

function buildT90() {
  const hull = new Kit(), wheels = [], parts = {};
  const L = 7.1, W = 3.8;
  const { hz } = tankHull(hull, { width: W, length: L });
  eraRows(hull, 3, 5, -1.6, 1.6, -hz - 0.12, 1.0, -hz + 1.25, 1.5, -0.34, [0.6, 0.1, 0.42]);
  hull.box('dark', 1.9, 0.06, 1.6, 0, 1.53, hz - 1.15);
  for (const sx of [-1, 1]) hull.box('dark', 0.9, 0.35, 0.45, sx * 1.35, 1.62, 1.2);
  hull.box('dark', 0.5, 0.15, 0.35, -1.65, 1.3, hz - 0.6);
  trackedGear(hull, wheels, { x: 1.5, w: 0.58, roadR: 0.37, roadZ: [-2.3, -1.44, -0.58, 0.28, 1.14, 2.0], rear: { z: 3.1, y: 0.62, r: 0.33 }, front: { z: -3.12, y: 0.55, r: 0.3 } });
  for (const sx of [-1, 1]) {
    const sk = new Kit(0.85);
    sk.box('rubber', 0.04, 0.62, 5.0, 0, 0, 0.4);
    for (let i = 0; i < 5; i++) sk.box('era', 0.12, 0.5, 0.5, sx * 0.06, 0, -2.25 + i * 0.52);
    zMark(sk, sx * 0.035, 0.05, 1.6, 0.55, sx * HALF_PI);
    parts[sx < 0 ? 'skirtL' : 'skirtR'] = { kit: sk, pos: [sx * 1.84, 0.85, 0] };
  }
  // Welded turret: flat-sided, angular, with a big box bustle and Relikt wedges on the front.
  const tur = new Kit(1.5);
  tur.section('paint', [[-1.55, 0], [1.55, 0], [1.45, 0.62], [1.05, 0.78], [-1.05, 0.78], [-1.45, 0.62]], 2.6, 0.25);
  tur.box('paint', 2.4, 0.62, 1.1, 0, 0.33, 1.95);                                 // bustle
  for (const sx of [-1, 1]) {
    tur.box('era', 1.0, 0.55, 0.9, sx * 0.95, 0.32, -1.35, 0, sx * 0.35, 0);       // front wedges
    tur.box('era', 0.12, 0.5, 1.6, sx * 1.62, 0.32, 0.0);                          // side panels
  }
  for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) tur.box('era', 0.4, 0.08, 0.36, -0.65 + c * 0.43, 0.82, -0.7 + r * 0.4);
  tur.box('dark', 0.5, 0.42, 0.5, -0.6, 0.98, -0.45);
  tur.box('glass', 0.38, 0.22, 0.02, -0.6, 1.0, -0.71);
  tur.cyl('dark', 0.16, 0.16, 0.45, 0.65, 1.02, -0.2, 0, 0, 0, 12);                 // panoramic sight
  tur.box('paint', 0.9, 0.55, 0.5, 0, 0.32, -1.5);
  tankCommonTurretBits(tur, { roof: 0.86, gunnerY: 0.79, gunnerZ: 0.45 });
  tur.cyl('canvas', 0.15, 0.15, 1.7, 0, 0.75, 2.55, 0, 0, HALF_PI, 10);
  tankStowage(hull, { hz, W, fuel: true });
  const cage = new Kit(2.4);
  copeCage(cage, 3.4, 4.0, 0.9, 0.35);
  return {
    hull, wheels, parts, size: [W, 2.2, L], tracked: true, era: true, engine: [0, 1.6, hz - 1.0],
    exhaust: [[-1.85, 1.3, hz - 0.6, -1, 0.3, 0.3]], fires: [[0, 1.6, hz - 1.0], [0.65, 2.45, 0.0], [-0.45, 1.55, -hz + 1.55]],
    turret: { kit: tur, pos: [0, 1.5, -0.3], gun: { kit: tankGun(5.2, 0.1), pos: [0, 0.38, -1.75] }, cage: { kit: cage, pos: [0, 0.92, 0] } },
    tossOnDeath: ['skirtL', 'skirtR'], sink: 0.05,
    hatches: tankHatches(hz, 0.98, 0.805, 0.45), crew: tankCrew(hz, -0.35),
  };
}

// ---- APCs -------------------------------------------------------------------------------------

function buildBtr() {
  const hull = new Kit(), wheels = [], parts = {};
  hull.profile('paint', [[-3.85, 1.12], [-3.25, 0.52], [3.35, 0.52], [3.8, 1.0], [3.75, 1.5], [-3.85, 1.5]], 2.5);
  hull.profile('paint', [[-3.85, 1.48], [3.75, 1.48], [3.6, 2.0], [-2.3, 2.08], [-3.88, 1.52]], 2.4);
  for (const sx of [-1, 1]) {
    hull.box('paint', 0.06, 0.65, 7.2, sx * 1.3, 1.78, -0.05, 0, 0, sx * 0.28);
    hull.box('paint', 0.3, 0.06, 7.3, sx * 1.35, 1.48, 0);
    hull.box('dark', 0.05, 0.6, 0.9, sx * 1.38, 1.7, -0.35, 0, 0, sx * 0.28);     // side door
    hull.box('dark', 0.05, 0.25, 0.4, sx * 1.4, 1.25, -0.35);
    for (let i = 0; i < 3; i++) hull.box('glass', 0.04, 0.12, 0.08, sx * 1.4, 1.95, -2.3 + i * 0.9, 0, 0, sx * 0.28);
    zMark(hull, sx * 1.47, 1.15, 1.6, 0.55, sx * HALF_PI);
  }
  hull.box('dark', 2.0, 0.04, 0.9, 0, 1.75, -3.0, -0.75);                         // trim vane
  hull.box('glass', 0.5, 0.25, 0.04, -0.5, 1.92, -2.25, -0.6);
  hull.box('glass', 0.5, 0.25, 0.04, 0.5, 1.92, -2.25, -0.6);
  hull.box('dark', 0.55, 0.06, 0.55, -0.6, 2.1, 1.3);
  hull.box('dark', 1.6, 0.06, 0.9, 0, 2.03, 2.6);
  hull.box('dark', 0.6, 0.3, 0.1, 0, 1.0, 3.8);
  tyreWheels(wheels, 0.57, 0.42, 1.27, [-2.75, -1.35, 0.7, 2.1], 0.57, 2);
  const tur = new Kit(2.08);
  tur.cyl('paint', 0.62, 0.78, 0.5, 0, 0.25, 0, 0, 0, 0, 16);
  tur.box('paint', 0.7, 0.3, 0.5, 0, 0.18, -0.65);
  tur.box('dark', 0.25, 0.25, 0.3, 0.42, 0.62, -0.1);
  tur.box('glass', 0.18, 0.12, 0.02, 0.42, 0.66, -0.26);
  for (let k = 0; k < 3; k++) for (const sx of [-1, 1]) tur.cyl('dark', 0.04, 0.04, 0.26, sx * (0.55 + k * 0.08), 0.42, 0.2 + k * 0.1, -0.8, 0, 0, 6);
  const gun = new Kit(2.3);
  gun.cyl('steel', 0.045, 0.05, 2.5, 0, 0, -1.25, HALF_PI, 0, 0, 10);
  gun.cyl('steel', 0.07, 0.07, 0.25, 0, 0, -2.45, HALF_PI, 0, 0, 10);
  gun.cyl('steel', 0.025, 0.025, 0.8, 0.22, 0, -0.4, HALF_PI, 0, 0, 6);
  const cage = new Kit(2.6);
  copeCage(cage, 1.9, 2.0, 0.8, 0);
  const hatch = new Kit(2.1);
  hatch.box('dark', 0.55, 0.06, 0.55, 0, 0, 0);
  parts.hatch = { kit: hatch, pos: [0.6, 2.1, 1.3] };
  return {
    hull, wheels, parts, size: [2.9, 2.4, 7.6], engine: [0, 2.0, 2.6],
    exhaust: [[1.35, 1.6, 2.9, 1, 0.2, 0.2]], fires: [[0, 2.1, 2.6], [0.6, 2.15, 1.3], [-1.38, 1.7, -0.35]],
    turret: { kit: tur, pos: [0, 2.05, -1.0], gun: { kit: gun, pos: [0, 0.25, -0.75] }, cage: { kit: cage, pos: [0, 0.55, 0] } },
    tossOnDeath: ['hatch'], sink: 0.3,
    hatches: [
      { name: 'commander', on: 'hull', pos: [0.5, 2.085, -1.35], r: 0.22, dir: [0, -1] },
      { name: 'driver', on: 'hull', pos: [-0.5, 2.085, -1.35], r: 0.22, dir: [0, -1] },
    ],
    crew: [{ role: 'commander', on: 'hull', pos: [0.5, 0.65, -1.57], hatch: 'commander' }, { role: 'driver', on: 'hull', pos: [-0.5, 0.66, -1.57], hatch: 'driver', mode: 'driver' }],
  };
}

function buildBmp() {
  const hull = new Kit(), wheels = [], parts = {};
  // Low hull with the ribbed "washboard" bow and flat roof.
  hull.profile('paint', [[-3.35, 0.95], [-2.85, 0.45], [3.2, 0.45], [3.35, 0.7], [3.3, 1.5], [-1.15, 1.6], [-3.4, 1.05]], 3.0);
  for (let i = 0; i < 7; i++) hull.box('paint', 2.9, 0.05, 0.08, 0, 1.08 + i * 0.075, -3.2 + i * 0.3, -0.25); // ribs
  for (const sx of [-1, 1]) {
    hull.box('paint', 0.5, 0.04, 6.5, sx * 1.35, 1.12, 0.05);                     // fenders
    zMark(hull, sx * 1.52, 1.25, 1.3, 0.5, sx * HALF_PI);
    for (let i = 0; i < 4; i++) hull.box('glass', 0.03, 0.08, 0.12, sx * 1.48, 1.45, -0.2 + i * 0.7); // firing ports
  }
  // Rear doors with their built-in fuel tanks.
  for (const sx of [-1, 1]) hull.box('paint', 0.62, 0.95, 0.25, sx * 0.42, 1.0, 3.38);
  hull.box('dark', 0.8, 0.06, 0.5, -0.6, 1.58, -1.4);                             // driver/engine hatches
  hull.box('dark', 0.9, 0.06, 0.7, 0.55, 1.6, -2.0);
  for (let i = 0; i < 4; i++) hull.box('dark', 0.55, 0.05, 0.5, (i % 2 ? 1 : -1) * 0.5, 1.53, 1.3 + Math.floor(i / 2) * 0.8);
  trackedGear(hull, wheels, { x: 1.35, w: 0.32, roadR: 0.29, roadZ: [-2.15, -1.35, -0.55, 0.25, 1.05, 1.85], rear: { z: 2.8, y: 0.45, r: 0.27 }, front: { z: -2.85, y: 0.62, r: 0.26 }, rollers: [-1.6, -0.2, 1.2], rollerY: 0.74 });
  // Two-man turret with the 30 mm cannon and the Konkurs missile launcher.
  const tur = new Kit(1.6);
  tur.cyl('paint', 0.85, 1.05, 0.45, 0, 0.22, 0, 0, 0, 0, 18);
  tur.cyl('paint', 0.55, 0.85, 0.22, 0, 0.55, 0.05, 0, 0, 0, 18);
  tur.box('dark', 0.3, 0.25, 0.3, -0.4, 0.75, -0.25);
  tur.box('glass', 0.2, 0.12, 0.02, -0.4, 0.78, -0.41);
  tur.cyl('dark', 0.08, 0.08, 1.35, 0.1, 0.92, 0.1, HALF_PI, 0, 0, 10);           // missile tube
  tur.box('steel', 0.2, 0.15, 0.2, 0.1, 0.77, 0.1);
  for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) tur.cyl('dark', 0.04, 0.04, 0.24, sx * (0.78 + k * 0.06), 0.4, -0.2 + k * 0.12, -0.8, 0, 0, 6);
  const gun = new Kit(1.9);
  gun.cyl('steel', 0.04, 0.045, 2.9, 0, 0, -1.45, HALF_PI, 0, 0, 10);
  gun.cyl('steel', 0.06, 0.06, 0.3, 0, 0, -2.85, HALF_PI, 0, 0, 10);
  gun.cyl('dark', 0.11, 0.11, 0.6, 0, 0, -0.25, HALF_PI, 0, 0, 10);
  const cage = new Kit(2.3);
  copeCage(cage, 2.2, 2.4, 0.75, 0);
  return {
    hull, wheels, parts, size: [3.2, 2.2, 6.7], tracked: true, engine: [0.55, 1.6, -2.0],
    exhaust: [[1.5, 1.2, -1.6, 1, 0.2, 0]], fires: [[0.55, 1.65, -2.0], [0, 1.6, 1.6], [-0.6, 1.6, -1.4]],
    turret: { kit: tur, pos: [0, 1.58, -0.35], gun: { kit: gun, pos: [0, 0.32, -0.75] }, cage: { kit: cage, pos: [0, 0.65, 0] } },
    tossOnDeath: [], sink: 0.04,
    hatches: [
      { name: 'commander', on: 'turret', pos: [0.38, 0.67, 0.5], r: 0.22, dir: [0, -1] },
      { name: 'gunner', on: 'turret', pos: [-0.38, 0.67, 0.5], r: 0.22, dir: [0, -1] },
      { name: 'rear', on: 'hull', pos: [0.5, 1.56, 1.05], w: 0.55, d: 0.5, dir: [0, 1] },
    ],
    crew: [{ role: 'commander', on: 'turret', pos: [0.38, -0.62, 0.28], hatch: 'commander' }, { role: 'gunner', on: 'turret', pos: [-0.38, -0.62, 0.28], hatch: 'gunner' }],
  };
}

function buildMtlb() {
  const hull = new Kit(), wheels = [], parts = {};
  // Flat, boxy, low: a cab at the front and a long troop compartment.
  hull.profile('paint', [[-3.25, 0.85], [-2.9, 0.42], [3.15, 0.42], [3.25, 0.6], [3.25, 1.62], [-2.5, 1.68], [-3.28, 1.35]], 2.85);
  for (const sx of [-1, 1]) zMark(hull, sx * 1.44, 1.2, 1.0, 0.5, sx * HALF_PI);
  hull.box('glass', 0.55, 0.22, 0.04, -0.55, 1.5, -2.9, -0.5);
  hull.box('glass', 0.55, 0.22, 0.04, 0.55, 1.5, -2.9, -0.5);
  hull.cyl('dark', 0.3, 0.3, 0.03, -0.55, 1.7, -2.0, 0, 0, 0, 14);
  for (let i = 0; i < 2; i++) for (const sx of [-1, 1]) hull.box('dark', 0.75, 0.06, 0.9, sx * 0.6, 1.66, 0.6 + i * 1.3); // roof hatches
  for (const sx of [-1, 1]) hull.box('paint', 0.6, 0.95, 0.06, sx * 0.55, 1.05, 3.27);                       // rear doors
  hull.box('dark', 1.6, 0.04, 0.5, 0, 1.69, -1.2);                                                          // engine louvres
  // Small machine-gun cupola, fixed (no turret in the sim).
  hull.cyl('paint', 0.36, 0.42, 0.32, 0.6, 1.84, -2.1, 0, 0, 0, 14);
  hull.cyl('steel', 0.025, 0.025, 1.0, 0.6, 1.88, -2.7, HALF_PI, 0, 0, 6);
  // Logs and kit lashed to the roof, as these carriers usually have.
  hull.cyl('wood', 0.12, 0.12, 2.4, -0.9, 1.82, 1.4, HALF_PI, 0, 0, 8);
  hull.box('canvas', 1.2, 0.35, 0.7, 0.4, 1.86, 2.5);
  trackedGear(hull, wheels, { x: 1.25, w: 0.35, roadR: 0.3, roadZ: [-2.1, -1.27, -0.44, 0.39, 1.22, 2.05], rear: { z: 2.75, y: 0.5, r: 0.26 }, front: { z: -2.8, y: 0.62, r: 0.26 } });
  const cage = new Kit(1.75);
  copeCage(cage, 2.3, 3.5, 0.75, 0.6);
  parts.cage = { kit: cage, pos: [0, 1.75, 0] };
  return {
    hull, wheels, parts, size: [2.9, 2.0, 6.5], tracked: true, engine: [0, 1.7, -1.2],
    exhaust: [[1.3, 1.4, -1.0, 1, 0.2, 0]], fires: [[0, 1.7, -1.2], [0.6, 1.7, 0.6], [-0.6, 1.7, 1.9]],
    tossOnDeath: ['cage'], sink: 0.04,
    hatches: [
      { name: 'commander', on: 'hull', pos: [0.6, 2.005, -1.82], r: 0.28, dir: [0, -1] },
      { name: 'driver', on: 'hull', pos: [-0.55, 1.715, -1.72], r: 0.28, dir: [0, -1] },
    ],
    crew: [{ role: 'commander', on: 'hull', pos: [0.6, 0.62, -2.1], hatch: 'commander' }, { role: 'driver', on: 'hull', pos: [-0.55, 0.32, -2.0], hatch: 'driver', mode: 'driver' }],
  };
}

// ---- Trucks -----------------------------------------------------------------------------------

function uralCab(hull) {
  hull.box('dark', 0.95, 0.28, 7.1, 0, 0.98, 0.25);                               // chassis rails
  hull.profile('paint', [[-3.55, 0.9], [-1.95, 0.9], [-1.95, 1.95], [-3.25, 1.85], [-3.6, 1.55]], 1.5);
  for (const sx of [-1, 1]) hull.profile('paint', [[-3.6, 1.05], [-2.1, 1.05], [-2.0, 1.5], [-2.3, 1.62], [-3.3, 1.62], [-3.55, 1.4]], 0.45, sx * 0.98);
  hull.box('dark', 1.3, 0.55, 0.06, 0, 1.4, -3.62);
  hull.box('dark', 2.4, 0.16, 0.22, 0, 0.92, -3.65);
  for (const sx of [-1, 1]) hull.cyl('glass', 0.11, 0.11, 0.08, sx * 0.95, 1.5, -3.55, HALF_PI, 0, 0, 10);
  hull.profile('paint', [[-1.95, 1.0], [-0.55, 1.0], [-0.55, 2.75], [-1.75, 2.75], [-1.98, 2.0]], 2.35);
  hull.box('glass', 2.1, 0.62, 0.04, 0, 2.38, -1.88, 0.12);
  for (const sx of [-1, 1]) {
    hull.box('glass', 0.04, 0.5, 0.75, sx * 1.18, 2.38, -1.2);
    hull.box('dark', 0.03, 0.02, 1.05, sx * 1.185, 1.55, -1.25);
    hull.box('dark', 0.03, 1.2, 0.02, sx * 1.185, 1.75, -0.75);
    hull.rod('steel', V(sx * 1.18, 2.4, -1.85), V(sx * 1.5, 2.55, -1.9), 0.015, 4);
    hull.box('dark', 0.05, 0.3, 0.2, sx * 1.5, 2.5, -1.9);
    hull.box('dark', 0.55, 0.55, 0.9, sx * 1.0, 1.15, 0.2);
    zMark(hull, sx * 1.19, 1.65, -1.25, 0.6, sx * HALF_PI);
  }
}

function canvasBed(hull, parts, z0, len, top = 2.75) {
  const zc = z0 + len / 2;
  hull.box('wood', 2.5, 0.12, len, 0, 1.35, zc);
  for (const sx of [-1, 1]) hull.box('wood', 0.06, 0.55, len, sx * 1.22, 1.68, zc);
  hull.box('wood', 2.5, 0.55, 0.06, 0, 1.68, z0 + len);
  hull.box('wood', 2.5, 0.55, 0.06, 0, 1.68, z0);
  for (let i = 0; i < 4; i++) {
    const z = z0 + 0.15 + (i * (len - 0.3)) / 3;
    for (const sx of [-1, 1]) hull.rod('steel', V(sx * 1.2, 1.9, z), V(sx * 1.2, top, z), 0.02, 4);
    hull.rod('steel', V(-1.2, top, z), V(1.2, top, z), 0.02, 4);
  }
  const tarp = new Kit(2.3);
  tarp.box('canvas', 2.56, top - 1.8, len + 0.05, 0, 0, 0);
  tarp.cyl('canvas', 1.28, 1.28, len + 0.05, 0, (top - 1.8) / 2, 0, HALF_PI, 0, 0, 16);
  parts.tarp = { kit: tarp, pos: [0, 2.3, zc] };
}

function buildUral() {
  const hull = new Kit(), wheels = [], parts = {};
  uralCab(hull);
  canvasBed(hull, parts, -0.65, 4.45);
  const spare = new Kit(1.9);
  spare.cyl('tyre', 0.55, 0.55, 0.36, 0, 0, 0, HALF_PI, 0, 0, 14);
  spare.cyl('steel', 0.3, 0.3, 0.38, 0, 0, 0, HALF_PI, 0, 0, 10);
  parts.spare = { kit: spare, pos: [0, 1.9, -0.32] };
  tyreWheels(wheels, 0.56, 0.38, 1.0, [-2.75, 0.95, 2.45], 0.56, 1);
  return {
    hull, wheels, parts, size: [2.5, 2.9, 7.4], engine: [0, 1.6, -2.7],
    exhaust: [[1.2, 2.2, -0.7, 0, 1, 0]], fires: [[0, 1.6, -2.7], [0, 2.0, -1.2], [0, 1.9, 1.6]],
    tossOnDeath: ['spare'], burnAway: ['tarp'], sink: 0.28,
  };
}

function buildKamaz() {
  const hull = new Kit(), wheels = [], parts = {};
  hull.box('dark', 0.95, 0.28, 7.6, 0, 0.98, 0.3);
  // Cab-over: a tall flat-fronted cab sitting over the front axle.
  hull.profile('paint', [[-3.9, 1.0], [-2.3, 1.0], [-2.3, 3.05], [-3.75, 3.05], [-3.92, 2.3]], 2.45);
  hull.box('glass', 2.15, 0.75, 0.04, 0, 2.55, -3.88, 0.08);
  hull.box('dark', 1.6, 0.35, 0.05, 0, 1.55, -3.93);
  hull.box('dark', 2.45, 0.22, 0.25, 0, 1.0, -3.95);
  for (const sx of [-1, 1]) {
    hull.cyl('glass', 0.1, 0.1, 0.06, sx * 0.95, 1.2, -3.97, HALF_PI, 0, 0, 10);
    hull.box('glass', 0.04, 0.55, 0.7, sx * 1.23, 2.5, -3.2);
    hull.box('dark', 0.03, 1.4, 0.02, sx * 1.235, 1.95, -2.7);
    hull.rod('steel', V(sx * 1.22, 2.6, -3.7), V(sx * 1.55, 2.7, -3.75), 0.015, 4);
    hull.box('dark', 0.05, 0.35, 0.22, sx * 1.55, 2.65, -3.75);
    hull.box('dark', 0.6, 0.55, 1.0, sx * 1.0, 1.2, -1.6);
    zMark(hull, sx * 1.235, 2.0, -3.1, 0.6, sx * HALF_PI);
  }
  hull.profile('paint', [[-3.9, 0.7], [-2.3, 0.7], [-2.3, 1.05], [-3.9, 1.05]], 2.5); // wheel arches
  canvasBed(hull, parts, -2.05, 5.6, 3.0);
  tyreWheels(wheels, 0.55, 0.4, 1.02, [-3.15, 1.4, 2.75], 0.55, 1);
  return {
    hull, wheels, parts, size: [2.5, 3.1, 7.8], engine: [0, 1.5, -3.0],
    exhaust: [[1.25, 3.0, -2.2, 0, 1, 0]], fires: [[0, 1.6, -3.0], [0, 2.4, -3.1], [0, 2.0, 0.8]],
    tossOnDeath: [], burnAway: ['tarp'], sink: 0.27,
  };
}

function buildFuel() {
  const hull = new Kit(), wheels = [], parts = {};
  uralCab(hull);
  // Oval fuel tank with walkway, ladder and hose boxes.
  hull.box('dark', 2.3, 0.15, 4.6, 0, 1.25, 1.6);
  const tank = new Kit(1.35);
  tank.add('paint', new THREE.CylinderGeometry(1, 1, 4.4, 20).rotateX(HALF_PI).scale(1.15, 0.78, 1), 0, 0.78, 0);
  tank.cyl('paint', 0.3, 0.3, 0.2, 0, 1.62, -0.5, 0, 0, 0, 12);                   // filler domes
  tank.cyl('paint', 0.3, 0.3, 0.2, 0, 1.62, 1.0, 0, 0, 0, 12);
  tank.box('steel', 0.5, 0.03, 4.0, 0, 1.62, 0.2);
  for (let i = 0; i < 6; i++) tank.box('steel', 0.04, 0.04, 0.5, 0.55, 0.6 + i * 0.18, 2.25);
  tank.box('dark', 2.2, 0.5, 0.7, 0, 0.3, 2.45);                                   // hose box
  zMark(tank, 1.16, 0.8, 0.2, 0.9, HALF_PI);
  zMark(tank, -1.16, 0.8, 0.2, 0.9, -HALF_PI);
  parts.tank = { kit: tank, pos: [0, 1.35, 1.6] };
  tyreWheels(wheels, 0.56, 0.38, 1.0, [-2.75, 0.95, 2.45], 0.56, 1);
  return {
    hull, wheels, parts, size: [2.5, 3.0, 8.0], engine: [0, 1.6, -2.7],
    exhaust: [[1.2, 2.2, -0.7, 0, 1, 0]], fires: [[0, 1.6, -2.7], [0, 2.9, 0.8], [0.6, 2.6, 2.6], [-0.6, 2.4, 1.6]],
    tossOnDeath: ['tank'], sink: 0.28,
  };
}

// ---- Light vehicles ---------------------------------------------------------------------------

function buildUaz() {
  const hull = new Kit(), wheels = [], parts = {};
  hull.box('dark', 0.8, 0.2, 3.8, 0, 0.62, 0);
  hull.profile('paint', [[-2.0, 0.65], [1.95, 0.65], [1.95, 1.3], [-0.8, 1.3], [-0.95, 1.35], [-2.0, 1.2]], 1.7);
  hull.box('glass', 1.55, 0.45, 0.04, 0, 1.58, -0.85, 0.15);
  hull.box('steel', 1.6, 0.04, 0.04, 0, 1.82, -0.82);
  // Canvas top over the rear.
  const top = new Kit(1.3);
  top.box('canvas', 1.68, 0.6, 2.7, 0, 0.3, 0);
  parts.top = { kit: top, pos: [0, 1.3, 0.55] };
  hull.box('dark', 0.9, 0.3, 0.06, 0, 1.0, -2.02);
  for (const sx of [-1, 1]) {
    hull.cyl('glass', 0.09, 0.09, 0.05, sx * 0.55, 1.05, -2.02, HALF_PI, 0, 0, 10);
    hull.profile('paint', [[-1.95, 0.75], [-0.8, 0.75], [-0.8, 1.0], [-1.0, 1.15], [-1.75, 1.15], [-1.95, 1.0]], 0.22, sx * 0.85); // fenders
    hull.box('dark', 0.02, 0.6, 0.02, sx * 0.86, 1.0, 0.15);
    zMark(hull, sx * 0.86, 1.0, 0.7, 0.45, sx * HALF_PI);
  }
  const spare = new Kit(1.15);
  spare.cyl('tyre', 0.38, 0.38, 0.22, 0, 0, 0, HALF_PI, 0, 0, 14);
  parts.spare = { kit: spare, pos: [0, 1.15, 2.08] };
  tyreWheels(wheels, 0.38, 0.24, 0.8, [-1.2, 1.2], 0.38, 1);
  return {
    hull, wheels, parts, size: [1.8, 1.9, 4.1], engine: [0, 1.0, -1.5],
    exhaust: [[0.5, 0.45, 2.0, 0, 0, 1]], fires: [[0, 1.0, -1.5], [0, 1.3, 0.3]],
    tossOnDeath: ['spare'], burnAway: ['top'], sink: 0.22,
  };
}

function pickupBody(hull) {
  hull.box('dark', 0.85, 0.2, 4.9, 0, 0.6, 0);
  hull.profile('paint', [[-2.6, 0.62], [-0.5, 0.62], [-0.5, 1.15], [-1.6, 1.15], [-2.6, 1.05]], 1.85);  // bonnet
  hull.profile('paint', [[-1.6, 0.62], [0.35, 0.62], [0.35, 1.8], [-0.6, 1.8], [-1.1, 1.18], [-1.6, 1.15]], 1.85); // cab
  hull.box('glass', 1.65, 0.5, 0.04, 0, 1.47, -0.86, 0.9);
  for (const sx of [-1, 1]) {
    hull.box('glass', 0.04, 0.42, 1.0, sx * 0.93, 1.5, -0.2);
    hull.box('dark', 0.03, 0.55, 0.02, sx * 0.935, 1.0, -0.25);
    hull.box('dark', 0.05, 0.12, 0.18, sx * 1.0, 1.4, -0.95);
    hull.cyl('glass', 0.08, 0.08, 0.05, sx * 0.65, 0.95, -2.6, HALF_PI, 0, 0, 10);
  }
  hull.box('dark', 1.1, 0.25, 0.05, 0, 0.95, -2.62);
  hull.box('steel', 1.9, 0.14, 0.15, 0, 0.62, -2.68);
  // Load bed.
  hull.box('paint', 1.85, 0.08, 2.1, 0, 0.82, 1.45);
  for (const sx of [-1, 1]) hull.box('paint', 0.06, 0.45, 2.1, sx * 0.9, 1.05, 1.45);
  hull.box('paint', 1.85, 0.45, 0.06, 0, 1.05, 2.48);
}

function buildPickup() {
  const hull = new Kit(), wheels = [], parts = {};
  pickupBody(hull);
  hull.box('dark', 0.8, 0.4, 0.6, 0.3, 1.06, 1.2);                                 // load: crates and a jerrycan
  hull.box('wood', 0.6, 0.35, 0.5, -0.4, 1.04, 1.8);
  for (const sx of [-1, 1]) zMark(hull, sx * 0.935, 1.05, 0.0, 0.45, sx * HALF_PI);
  tyreWheels(wheels, 0.38, 0.26, 0.82, [-1.65, 1.45], 0.38, 1);
  return {
    hull, wheels, parts, size: [2.0, 1.9, 5.2], engine: [0, 0.95, -2.0],
    exhaust: [[0.6, 0.45, 2.55, 0, 0, 1]], fires: [[0, 0.95, -2.0], [0, 1.3, -0.3]],
    tossOnDeath: [], sink: 0.22,
  };
}

function buildTechnical() {
  const hull = new Kit(), wheels = [], parts = {};
  pickupBody(hull);
  for (const sx of [-1, 1]) zMark(hull, sx * 0.935, 1.05, 0.0, 0.45, sx * HALF_PI);
  hull.box('dark', 0.6, 0.35, 0.4, -0.5, 1.03, 2.1);                               // ammunition boxes
  tyreWheels(wheels, 0.38, 0.26, 0.82, [-1.65, 1.45], 0.38, 1);
  // Pintle-mounted heavy machine gun with a shield, turning with turretYaw.
  const tur = new Kit(0.9);
  tur.cyl('steel', 0.06, 0.08, 0.75, 0, 0.38, 0, 0, 0, 0, 8);
  tur.box('steel', 0.6, 0.45, 0.04, 0, 0.95, -0.3);
  tur.box('dark', 0.16, 0.18, 0.7, 0, 0.82, 0.05);
  tur.box('dark', 0.18, 0.2, 0.25, 0.15, 0.78, 0.0);                               // ammo can
  tur.rod('dark', V(-0.08, 0.82, 0.38), V(-0.08, 0.75, 0.55), 0.02, 4);
  const gun = new Kit(1.72);
  gun.cyl('steel', 0.025, 0.03, 1.5, 0, 0, -0.75, HALF_PI, 0, 0, 8);
  gun.cyl('steel', 0.05, 0.05, 0.15, 0, 0, -1.45, HALF_PI, 0, 0, 8);
  return {
    hull, wheels, parts, size: [2.0, 2.3, 5.2], engine: [0, 0.95, -2.0],
    exhaust: [[0.6, 0.45, 2.55, 0, 0, 1]], fires: [[0, 0.95, -2.0], [0, 1.3, -0.3], [0, 1.2, 1.4]],
    turret: { kit: tur, pos: [0, 0.86, 1.4], gun: { kit: gun, pos: [0, 0.86, -0.15] } },
    tossOnDeath: [], sink: 0.22,
    crew: [{ role: 'gunner', on: 'turret', pos: [0, 0.0, 0.62], mode: 'gunner' }],
  };
}

// Quad bike: tubular frame, plastic body with racks front and back, fat knobbly tyres, and the rider
// sitting astride it (crew spot 'rider': a soldier, not a tanker).
function buildAtv() {
  const hull = new Kit(), wheels = [], parts = {};
  hull.box('dark', 0.35, 0.18, 1.5, 0, 0.42, 0);                                   // frame + engine block
  hull.box('steel', 0.3, 0.28, 0.35, 0, 0.45, 0.05);
  // Body: front and rear fender pods and the tank/seat spine.
  hull.profile('paint', [[-1.0, 0.55], [-0.45, 0.55], [-0.4, 0.78], [-0.6, 0.86], [-0.98, 0.8]], 1.05);
  hull.profile('paint', [[0.4, 0.55], [1.0, 0.55], [1.02, 0.78], [0.85, 0.84], [0.42, 0.82]], 1.08);
  hull.profile('paint', [[-0.45, 0.6], [0.45, 0.6], [0.45, 0.8], [-0.2, 0.9], [-0.45, 0.88]], 0.42);
  hull.box('dark', 0.36, 0.1, 0.7, 0, 0.88, 0.15);                                 // seat
  // Racks with kit strapped on.
  for (const [z, y] of [[-0.8, 0.88], [0.78, 0.86]]) {
    for (const sx of [-1, 1]) hull.rod('steel', V(sx * 0.45, y, z - 0.18), V(sx * 0.45, y, z + 0.18), 0.012, 4);
    for (const dz of [-0.18, 0, 0.18]) hull.rod('steel', V(-0.45, y, z + dz), V(0.45, y, z + dz), 0.01, 4);
  }
  hull.box('canvas', 0.5, 0.22, 0.3, 0.05, 1.0, 0.8, 0, 0.2, 0);                   // bag on the back rack
  hull.box('dark', 0.25, 0.32, 0.17, -0.25, 1.05, 0.85);                           // jerrycan
  hull.box('wood', 0.42, 0.16, 0.3, 0, 0.97, -0.8);                                // ammo box on the front rack
  // Handlebars and headlight.
  hull.rod('steel', V(0, 0.82, -0.45), V(0, 1.02, -0.4), 0.025, 6);
  hull.rod('dark', V(-0.38, 1.04, -0.38), V(0.38, 1.04, -0.38), 0.016, 5);
  hull.box('dark', 0.16, 0.08, 0.1, 0, 0.98, -0.48);
  hull.cyl('glass', 0.05, 0.05, 0.03, 0, 0.82, -1.0, HALF_PI, 0, 0, 10);
  hull.box('dark', 0.9, 0.06, 0.06, 0, 0.42, -1.05);                               // bumper
  zMark(hull, 0.535, 0.7, 0.7, 0.22, HALF_PI);
  zMark(hull, -0.535, 0.7, 0.7, 0.22, -HALF_PI);
  tyreWheels(wheels, 0.3, 0.24, 0.5, [-0.68, 0.68], 0.3, 1);
  return {
    hull, wheels, parts, size: [1.2, 1.3, 2.1], engine: [0, 0.5, 0.05],
    exhaust: [[0.2, 0.5, 1.0, 0, 0, 1]], fires: [[0, 0.6, 0.1]],
    tossOnDeath: [], sink: 0.12,
    crew: [{ role: 'driver', on: 'hull', pos: [0, 0.93 - 0.86, 0.12], mode: 'rider', variant: 'rifleman' }],
  };
}

// Military dirt bike: one rider, olive paint, a bag strapped on the back.
function buildMoto() {
  const hull = new Kit(), wheels = [], parts = {};
  // Frame: steering head down to the swingarm pivot, engine and exhaust.
  hull.rod('dark', V(0, 0.98, -0.55), V(0, 0.42, -0.05), 0.03, 6);
  hull.rod('dark', V(0, 0.98, -0.55), V(0, 0.82, 0.25), 0.025, 6);
  hull.rod('dark', V(0, 0.42, -0.05), V(0, 0.48, 0.25), 0.03, 6);
  for (const sx of [-1, 1]) hull.rod('dark', V(sx * 0.07, 0.48, 0.22), V(sx * 0.07, 0.33, 0.7), 0.022, 5); // swingarm
  hull.box('steel', 0.24, 0.3, 0.36, 0, 0.47, -0.08);                               // engine
  hull.cyl('dark', 0.1, 0.1, 0.26, 0, 0.42, -0.08, 0, 0, HALF_PI, 10);
  hull.rod('steel', V(0.13, 0.42, -0.25), V(0.16, 0.62, 0.35), 0.03, 6);             // exhaust pipe
  hull.cyl('steel', 0.05, 0.05, 0.38, 0.17, 0.68, 0.55, HALF_PI - 0.15, 0, 0, 8);    // silencer
  // Tank, side panels, seat, fenders.
  hull.profile('paint', [[-0.55, 0.82], [-0.05, 0.84], [0.05, 0.92], [-0.2, 1.02], [-0.5, 0.98]], 0.3);
  hull.profile('paint', [[0.05, 0.62], [0.45, 0.66], [0.5, 0.82], [0.1, 0.85]], 0.26);
  hull.box('dark', 0.25, 0.08, 0.62, 0, 0.9, 0.3, 0.06, 0, 0);                       // seat
  hull.box('paint', 0.15, 0.03, 0.55, 0, 0.88, 0.82, -0.25, 0, 0);                   // rear fender
  hull.box('paint', 0.14, 0.03, 0.4, 0, 0.74, -0.82, 0.2, 0, 0);                     // front fender
  hull.box('canvas', 0.36, 0.2, 0.26, 0, 1.0, 0.72, 0, 0.1, 0);                      // bag on the back
  // Forks, bars, headlight.
  for (const sx of [-1, 1]) hull.rod('steel', V(sx * 0.07, 1.02, -0.58), V(sx * 0.07, 0.35, -0.8), 0.022, 6);
  hull.rod('dark', V(-0.36, 1.1, -0.52), V(0.36, 1.1, -0.52), 0.014, 5);
  for (const sx of [-1, 1]) hull.box('dark', 0.1, 0.035, 0.035, sx * 0.33, 1.1, -0.52);   // grips
  hull.box('dark', 0.14, 0.12, 0.06, 0, 0.98, -0.66);
  hull.cyl('glass', 0.05, 0.05, 0.03, 0, 0.97, -0.7, HALF_PI, 0, 0, 10);
  zMark(hull, 0.155, 0.92, -0.3, 0.14, HALF_PI);
  zMark(hull, -0.155, 0.92, -0.3, 0.14, -HALF_PI);
  for (const [z, steer] of [[-0.8, 1], [0.7, 0]]) wheels.push({ type: 'tyre', x: 0, y: 0.33, z, r: 0.33, w: 0.11, steer });
  return {
    hull, wheels, parts, size: [0.8, 1.2, 2.1], engine: [0, 0.47, -0.08],
    exhaust: [[0.17, 0.68, 0.75, 0, 0, 1]], fires: [[0, 0.6, 0]],
    tossOnDeath: [], sink: 0.05,
    crew: [{ role: 'driver', on: 'hull', pos: [0, 0.94 - 0.86, 0.28], mode: 'rider', variant: 'rifleman' }],
  };
}

export const VEHICLE_BUILDERS = {
  tank: { t72: buildT72, t80: buildT80, t90: buildT90 },
  apc: { btr: buildBtr, bmp: buildBmp, mtlb: buildMtlb },
  truck: { ural: buildUral, kamaz: buildKamaz, fuel: buildFuel },
  light: { uaz: buildUaz, pickup: buildPickup, technical: buildTechnical, atv: buildAtv, moto: buildMoto },
};

// Wheels. Tyres burn off in a wreck, leaving the steel rim; tracked vehicles have dual road wheels.
export function buildWheelKits(w) {
  const tyre = new Kit(w.r), rim = new Kit(w.r);
  const { r } = w, width = w.w;
  if (w.type === 'tyre') {
    tyre.cyl('tyre', r, r, width, 0, 0, 0, 0, 0, HALF_PI, 20);
    for (let k = 0; k < 12; k++) tyre.box('tyre', width + 0.02, 0.05, 0.12, 0, Math.sin(k * 0.5236) * r, Math.cos(k * 0.5236) * r, k * 0.5236); // tread blocks
    rim.cyl('paint', r * 0.58, r * 0.58, width + 0.04, 0, 0, 0, 0, 0, HALF_PI, 14);
    rim.cyl('dark', r * 0.22, r * 0.22, width + 0.1, 0, 0, 0, 0, 0, HALF_PI, 8);
    for (let k = 0; k < 6; k++) rim.cyl('steel', 0.025, 0.025, width + 0.08, 0, Math.sin(k * 1.047) * r * 0.38, Math.cos(k * 1.047) * r * 0.38, 0, 0, HALF_PI, 5);
  } else if (w.type === 'road') {
    for (const s of [-1, 1]) {
      tyre.cyl('rubber', r, r, width * 0.38, s * width * 0.27, 0, 0, 0, 0, HALF_PI, 18);
      rim.cyl('paint', r * 0.86, r * 0.7, width * 0.3, s * width * 0.32, 0, 0, 0, 0, HALF_PI, 16);
    }
    rim.cyl('steel', r * 0.32, r * 0.32, width * 1.05, 0, 0, 0, 0, 0, HALF_PI, 10);
    for (let k = 0; k < 6; k++) rim.cyl('dark', r * 0.08, r * 0.08, width * 1.0, 0, Math.sin(k * 1.047) * r * 0.55, Math.cos(k * 1.047) * r * 0.55, 0, 0, HALF_PI, 6);
  } else if (w.type === 'sprocket') {
    rim.cyl('steel', r * 0.9, r * 0.9, width, 0, 0, 0, 0, 0, HALF_PI, 16);
    for (let k = 0; k < 13; k++) { const a = (k / 13) * Math.PI * 2; rim.box('steel', width * 0.8, 0.07, 0.07, 0, Math.sin(a) * r, Math.cos(a) * r, a); }
    rim.cyl('dark', r * 0.35, r * 0.35, width * 1.1, 0, 0, 0, 0, 0, HALF_PI, 10);
  } else if (w.type === 'idler') {
    rim.cyl('steel', r, r, width, 0, 0, 0, 0, 0, HALF_PI, 16);
    for (let k = 0; k < 6; k++) rim.cyl('dark', r * 0.12, r * 0.12, width * 1.02, 0, Math.sin(k * 1.047) * r * 0.55, Math.cos(k * 1.047) * r * 0.55, 0, 0, HALF_PI, 6);
  } else {
    rim.cyl('steel', r, r, width, 0, 0, 0, 0, 0, HALF_PI, 10);
  }
  return { tyre, rim };
}
