// Soldiers: a skinned body (a uniform with folds, lofted over a skeleton) plus rigid kit carried by
// the bones: a shaped head and face, helmet or hat, plate carrier and pouches, gloves, boots and a
// weapon. Variants differ in weapon (AK-74M, AKM, AK-12, PKM, RPG-7, AKS-74U), camo, kit, headgear,
// face shape and skin tone; tank crews get a padded helmet and coveralls. Units are metres; the soldier faces -Z with his right side at +X.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './rng.js';
import { canvasTexture } from './textures.js';
import { Kit, HALF_PI } from './vehicleModels.js';

const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

// Rest pose joints, standing with arms down.
export const JOINTS = { hips: [0, 0.96, 0], spine: [0, 1.07, 0.005], chest: [0, 1.26, 0], neck: [0, 1.47, 0], head: [0, 1.585, -0.01] };
for (const [s, n] of [[1, 'R'], [-1, 'L']]) {
  JOINTS['clav' + n] = [s * 0.03, 1.43, 0];
  JOINTS['arm' + n] = [s * 0.185, 1.42, 0];
  JOINTS['fore' + n] = [s * 0.205, 1.11, 0.02];
  JOINTS['hand' + n] = [s * 0.225, 0.85, 0.005];
  JOINTS['thigh' + n] = [s * 0.095, 0.93, 0];
  JOINTS['shin' + n] = [s * 0.1, 0.5, -0.005];
  JOINTS['foot' + n] = [s * 0.105, 0.085, 0.02];
}
const PARENT = {
  hips: null, spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  clavR: 'chest', clavL: 'chest', armR: 'clavR', armL: 'clavL', foreR: 'armR', foreL: 'armL', handR: 'foreR', handL: 'foreL',
  thighR: 'hips', thighL: 'hips', shinR: 'thighR', shinL: 'thighL', footR: 'shinR', footL: 'shinL',
};
export const BONE_NAMES = Object.keys(PARENT);
const BI = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i]));
export const SOLDIER_HEIGHT = 1.78;

// ---- Geometry helpers -------------------------------------------------------------------------

// A tube through rings. Each ring: { p, rx (side radius), rz (front radius), ox, oz (offsets),
// w: [[bone, weight], ...], wr (fold amplitude) }. `sq` > 2 squares the section off.
function loft(rings, o = {}) {
  const segs = o.segs ?? 14, ex = 2 / (o.sq ?? 2), ref = V3(o.ref ?? [0, 0, -1]);
  const pos = [], uv = [], si = [], sw = [], idx = [];
  const P = rings.map((r) => V3(r.p));
  const T = new THREE.Vector3(), F = new THREE.Vector3(), S = new THREE.Vector3(), q = new THREE.Vector3();
  const rand = mulberry32(o.seed ?? 7);
  const pushW = (w = [['hips', 1]]) => {
    const ws = [...w, ['hips', 0], ['hips', 0], ['hips', 0]].slice(0, 4);
    for (const [b, k] of ws) { si.push(BI[b]); sw.push(k); }
  };
  let len = 0;
  rings.forEach((r, i) => {
    if (i) len += P[i].distanceTo(P[i - 1]);
    T.subVectors(P[Math.min(i + 1, P.length - 1)], P[Math.max(i - 1, 0)]).normalize();
    F.copy(ref).addScaledVector(T, -ref.dot(T)).normalize();
    S.crossVectors(T, F);
    const ph = rand() * 6.28, circ = Math.PI * (r.rx + r.rz);
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const k = 1 + (r.wr ?? 0) * (0.6 * Math.sin(a * 5 + ph) + 0.4 * Math.sin(a * 9 + ph * 2.3));
      const cx = Math.sign(c) * Math.abs(c) ** ex * r.rx * k + (r.ox ?? 0);
      const cz = Math.sign(s) * Math.abs(s) ** ex * r.rz * k + (r.oz ?? 0);
      q.copy(P[i]).addScaledVector(S, cx).addScaledVector(F, cz);
      pos.push(q.x, q.y, q.z);
      uv.push(((j / segs) * circ) / 0.35, len / 0.35);
      pushW(r.w);
    }
  });
  const row = segs + 1;
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < segs; j++) {
    const a = i * row + j, b = a + row;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const cap = (i, end) => {
    const c = pos.length / 3;
    pos.push(P[i].x + (rings[i].ox ?? 0) * 0, P[i].y, P[i].z); uv.push(0, len / 0.35); pushW(rings[i].w);
    for (let j = 0; j < segs; j++) { const a = i * row + j; if (end) idx.push(c, a + 1, a); else idx.push(c, a, a + 1); }
  };
  if (o.cap0) cap(0, false);
  if (o.cap1) cap(rings.length - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function withColor(g, c = 1) {
  const n = g.attributes.position.count;
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(c), 3));
  return g;
}
function only(g, keep) {
  for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
  return g;
}
function mirrorX(g) {
  g.scale(-1, 1, 1);
  const ix = g.index.array;
  for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  g.computeVertexNormals();
  return g;
}

// ---- The skinned uniform ----------------------------------------------------------------------

function buildUniform() {
  const parts = [];
  const W = (...a) => a;
  parts.push(loft([
    { p: [0, 0.8, 0.005], rx: 0.12, rz: 0.085, w: W(['hips', 1]) },
    { p: [0, 0.85, 0.005], rx: 0.165, rz: 0.11, w: W(['hips', 1]) },
    { p: [0, 0.93, 0], rx: 0.18, rz: 0.12, w: W(['hips', 1]), wr: 0.02 },
    { p: [0, 1.02, 0], rx: 0.172, rz: 0.115, w: W(['hips', 0.5], ['spine', 0.5]), wr: 0.045 },
    { p: [0, 1.11, 0], rx: 0.163, rz: 0.11, w: W(['spine', 1]), wr: 0.03 },
    { p: [0, 1.2, 0], rx: 0.17, rz: 0.116, w: W(['spine', 0.5], ['chest', 0.5]), wr: 0.02 },
    { p: [0, 1.3, -0.004], rx: 0.183, rz: 0.122, w: W(['chest', 1]) },
    { p: [0, 1.38, 0], rx: 0.19, rz: 0.118, w: W(['chest', 1]) },
    { p: [0, 1.435, 0.005], rx: 0.168, rz: 0.1, w: W(['chest', 1]) },
    { p: [0, 1.47, 0.005], rx: 0.1, rz: 0.076, w: W(['chest', 0.7], ['neck', 0.3]) },
    { p: [0, 1.5, 0.005], rx: 0.066, rz: 0.062, w: W(['neck', 1]) },
  ], { segs: 22, sq: 2.4, cap0: true, seed: 3 }));
  for (const [s, n] of [[1, 'R'], [-1, 'L']]) {
    const A = JOINTS['arm' + n], E = JOINTS['fore' + n], H = JOINTS['hand' + n];
    const arm = 'arm' + n, fore = 'fore' + n;
    parts.push(loft([
      { p: [A[0] - s * 0.03, A[1] + 0.025, A[2]], rx: 0.056, rz: 0.06, w: W(['chest', 0.55], [arm, 0.45]) },
      { p: lerp3(A, E, 0.1), rx: 0.064, rz: 0.068, w: W([arm, 1]) },
      { p: lerp3(A, E, 0.35), rx: 0.057, rz: 0.06, w: W([arm, 1]), wr: 0.03 },
      { p: lerp3(A, E, 0.65), rx: 0.052, rz: 0.055, w: W([arm, 1]), wr: 0.05 },
      { p: lerp3(A, E, 0.88), rx: 0.05, rz: 0.053, w: W([arm, 0.8], [fore, 0.2]), wr: 0.07 },
      { p: E, rx: 0.048, rz: 0.051, w: W([arm, 0.5], [fore, 0.5]), wr: 0.06 },
      { p: lerp3(E, H, 0.12), rx: 0.049, rz: 0.052, w: W([fore, 0.85], [arm, 0.15]), wr: 0.05 },
      { p: lerp3(E, H, 0.38), rx: 0.05, rz: 0.05, w: W([fore, 1]), wr: 0.03 },
      { p: lerp3(E, H, 0.72), rx: 0.043, rz: 0.04, w: W([fore, 1]), wr: 0.04 },
      { p: lerp3(E, H, 0.92), rx: 0.038, rz: 0.035, w: W([fore, 1]) },
      { p: lerp3(E, H, 0.99), rx: 0.042, rz: 0.04, w: W([fore, 1]) },
    ], { segs: 14, cap1: true, seed: 11 + s }));
    const Hp = JOINTS['thigh' + n], K = JOINTS['shin' + n], F = JOINTS['foot' + n];
    const th = 'thigh' + n, sh = 'shin' + n;
    parts.push(loft([
      { p: [Hp[0] - s * 0.01, Hp[1] + 0.04, Hp[2]], rx: 0.09, rz: 0.1, w: W(['hips', 0.7], [th, 0.3]) },
      { p: lerp3(Hp, K, 0.05), rx: 0.1, rz: 0.106, w: W(['hips', 0.3], [th, 0.7]) },
      { p: lerp3(Hp, K, 0.25), rx: 0.096, rz: 0.1, w: W([th, 1]), wr: 0.03 },
      { p: lerp3(Hp, K, 0.55), rx: 0.086, rz: 0.088, w: W([th, 1]), wr: 0.05 },
      { p: lerp3(Hp, K, 0.85), rx: 0.072, rz: 0.076, w: W([th, 0.85], [sh, 0.15]), wr: 0.06 },
      { p: K, rx: 0.067, rz: 0.071, oz: 0.004, w: W([th, 0.5], [sh, 0.5]), wr: 0.07 },
      { p: lerp3(K, F, 0.12), rx: 0.065, rz: 0.069, w: W([sh, 0.85], [th, 0.15]), wr: 0.06 },
      { p: lerp3(K, F, 0.35), rx: 0.064, rz: 0.068, oz: -0.012, w: W([sh, 1]), wr: 0.05 },
      { p: lerp3(K, F, 0.62), rx: 0.057, rz: 0.058, w: W([sh, 1]), wr: 0.07 },
      { p: lerp3(K, F, 0.82), rx: 0.054, rz: 0.054, w: W([sh, 1]), wr: 0.08 },
      { p: lerp3(K, F, 1.0), rx: 0.048, rz: 0.048, w: W([sh, 1]) },
    ], { segs: 16, cap1: true, seed: 21 + s }));
  }
  return mergeGeometries(parts);
}

// ---- Head and face ----------------------------------------------------------------------------

// A head with a jaw, nose, brow, eye sockets, cheekbones, lips and ears. `rand` varies the features
// slightly; the vertex colours shade eyes, brows, lips, stubble and hair over the skin tone.
function buildHead(rand) {
  const g = new THREE.SphereGeometry(1, 48, 36);
  const p = g.attributes.position, n = p.count, col = new Float32Array(n * 3);
  const jaw = 0.9 + rand() * 0.2, nose = 0.8 + rand() * 0.5, noseW = 0.85 + rand() * 0.4, brow = 0.6 + rand() * 0.7;
  const cheek = rand(), chin = 0.7 + rand() * 0.6, lips = 0.8 + rand() * 0.6, wid = 0.95 + rand() * 0.09, deep = 0.96 + rand() * 0.08;
  const beard = rand() < 0.45 ? 0.72 + rand() * 0.12 : 1, hair = 0.22 + rand() * 0.2;
  for (let i = 0; i < n; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ax = Math.abs(x), front = Math.max(0, -z);
    const low = sstep(0.1, -0.9, y);
    x *= wid * (1 - 0.34 * low + 0.1 * (jaw - 1) * low);
    if (z < 0) z *= 0.92; else if (y > -0.35) z *= 1.06 * deep; else z *= 0.85;
    z -= 0.13 * chin * low * front * front;
    const gn = Math.exp(-((x / (0.12 * noseW)) ** 2) - ((y + 0.1) / 0.27) ** 2) * front ** 4;
    z -= 0.3 * nose * gn;
    const gb = Math.exp(-(((y - 0.24) / 0.09) ** 2)) * sstep(0.5, 0.9, front);
    z -= 0.05 * brow * gb;
    const ge = Math.exp(-(((ax - 0.36) / 0.14) ** 2) - ((y - 0.1) / 0.1) ** 2) * front;
    z += 0.07 * ge;
    const gc = Math.exp(-(((ax - 0.6) / 0.2) ** 2) - ((y + 0.02) / 0.15) ** 2);
    x *= 1 + 0.06 * cheek * gc;
    const gl = Math.exp(-((x / 0.24) ** 2) - ((y + 0.5) / 0.08) ** 2) * front ** 3;
    z -= 0.06 * lips * gl;
    const gm = Math.exp(-((x / 0.2) ** 2) - ((y + 0.55) / 0.025) ** 2) * front;
    z += 0.035 * gm;
    p.setXYZ(i, x * 0.078, y * 0.112, z * 0.098);
    // Colour multipliers on the skin tone.
    let r = 1, gg = 1, b = 1;
    const shade = (k) => { r *= k; gg *= k; b *= k; };
    shade(1 - 0.35 * ge);
    const pupil = Math.exp(-(((ax - 0.36) / 0.065) ** 2) - ((y - 0.1) / 0.05) ** 2) * front;
    shade(1 - 0.8 * pupil);
    const gbr = Math.exp(-(((ax - 0.35) / 0.17) ** 2) - ((y - 0.25) / 0.035) ** 2) * front;
    shade(1 - (1 - hair) * gbr);
    r *= 1 - 0.1 * gl; gg *= 1 - 0.38 * gl; b *= 1 - 0.32 * gl;
    if (beard < 1 && y < -0.25 && gl < 0.3) shade(1 - (1 - beard) * sstep(-0.25, -0.45, y));
    const scalp = sstep(0.32, 0.5, y + Math.max(0, z) * 0.5) * (front > 0.55 && y < 0.62 ? 0 : 1);
    shade(1 - (1 - hair) * scalp);
    col[i * 3] = r; col[i * 3 + 1] = gg; col[i * 3 + 2] = b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const ears = [-1, 1].map((s) => withColor(new THREE.SphereGeometry(1, 10, 8).scale(0.011, 0.03, 0.02).translate(s * 0.077, 0.0, 0.012), 0.93));
  return only(mergeGeometries([only(g, ['position', 'normal', 'uv', 'color']), ...ears.map((e) => only(e, ['position', 'normal', 'uv', 'color']))]), ['position', 'normal', 'uv', 'color']);
}

// Hands curled to grip, wrist at the origin, pointing down, palm facing the body (-X for the right).
function buildHand(side) {
  const palm = new THREE.SphereGeometry(1, 10, 8).scale(0.018, 0.05, 0.043).translate(0, -0.05, 0);
  const fingers = new THREE.TorusGeometry(0.022, 0.011, 6, 10, Math.PI * 1.1).rotateX(Math.PI).scale(1, 1, 3.4).translate(-0.022, -0.096, 0);
  const thumb = new THREE.CapsuleGeometry(0.01, 0.035, 3, 6).rotateX(0.5).rotateZ(-0.5).translate(-0.022, -0.045, -0.032);
  let g = mergeGeometries([palm, fingers, thumb].map((x) => only(x.index ? x : x, ['position', 'normal', 'uv'])));
  if (side < 0) g = mirrorX(g);
  return withColor(g);
}

// Helmet shell whose rim drops lower at the sides and back than at the brow.
function helmetShell(rx, ry, rz, brow = 1.38, back = 1.78, flare = 0.08) {
  const A = 30, VS = 10, pos = [], uv = [], idx = [];
  for (let a = 0; a <= A; a++) {
    const az = (a / A) * Math.PI * 2, f = Math.max(0, -Math.sin(az));
    const thMax = back - (back - brow) * f ** 1.5;
    for (let v = 0; v <= VS; v++) {
      const th = (v / VS) * thMax, k = 1 + flare * Math.max(0, th - 1.35);
      pos.push(Math.sin(th) * Math.cos(az) * rx * k, Math.cos(th) * ry, Math.sin(th) * Math.sin(az) * rz * k);
      uv.push(a / A * 3, v / VS);
    }
  }
  for (let a = 0; a < A; a++) for (let v = 0; v < VS; v++) {
    const i = a * (VS + 1) + v, j = i + VS + 1;
    idx.push(i, i + 1, j, j, i + 1, j + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---- Weapons ----------------------------------------------------------------------------------
// Origin at the receiver above the pistol grip; barrel along -Z. `R` and `L` are where the wrists go.

function curvedMag(k, slot, x0, y0, z0, n = 5, step = 0.042, bend = 0.12, w = 0.026, d = 0.06) {
  let y = y0, z = z0, a = 0.1;
  for (let i = 0; i < n; i++) {
    k.box(slot, w, step + 0.006, d, x0, y - (Math.cos(a) * step) / 2, z - (Math.sin(a) * step) / 2, a);
    y -= Math.cos(a) * step; z -= Math.sin(a) * step; a += bend;
  }
}

function akKit(type) {
  const k = new Kit(1.2);
  const furn = type === 'akm' ? 'wood' : 'gun';
  k.box('gun', 0.048, 0.07, 0.3, 0, 0, -0.05);                                 // receiver
  k.cyl('gun', 0.025, 0.025, 0.28, 0, 0.032, -0.06, HALF_PI, 0, 0, 10);         // dust cover
  k.cyl('metal', 0.011, 0.011, 0.44, 0, 0.012, -0.42, HALF_PI, 0, 0, 8);        // barrel
  k.cyl('metal', 0.013, 0.013, 0.22, 0, 0.044, -0.32, HALF_PI, 0, 0, 8);        // gas tube
  k.box(furn, 0.054, 0.048, 0.2, 0, 0.0, -0.31);                                 // handguard
  k.box('metal', 0.026, 0.06, 0.03, 0, 0.03, -0.55);                             // front sight block
  k.cyl('metal', type === 'akm' ? 0.014 : 0.02, 0.02, 0.08, 0, 0.012, -0.67, HALF_PI, 0, 0, 8); // muzzle brake
  k.box('metal', 0.02, 0.018, 0.04, 0, 0.044, -0.17);                            // rear sight
  k.box(furn, 0.03, 0.1, 0.042, 0, -0.07, 0.045, -0.32);                        // pistol grip
  k.box('metal', 0.008, 0.012, 0.07, 0, -0.04, -0.005);                          // trigger guard
  curvedMag(k, type === 'akm' ? 'metal' : 'gun', 0, -0.03, -0.12, 5, 0.04, 0.11);
  if (type === 'akm') {
    k.add('wood', new THREE.CylinderGeometry(0.04, 0.024, 0.3, 8).rotateX(HALF_PI).scale(0.9, 1.4, 1), 0, -0.035, 0.24);
    k.box('metal', 0.034, 0.11, 0.015, 0, -0.06, 0.39);
  } else {
    k.box('gun', 0.036, 0.04, 0.28, 0, -0.005, 0.22);                            // folding stock
    k.box('gun', 0.03, 0.12, 0.035, 0, -0.04, 0.36, 0.15);
    k.box('gun', 0.018, 0.04, 0.16, 0, -0.045, 0.27, -0.2);
  }
  if (type === 'ak12') {
    k.box('gun', 0.03, 0.012, 0.3, 0, 0.062, -0.08);                             // rail
    k.cyl('gun', 0.018, 0.018, 0.09, 0, 0.088, -0.08, HALF_PI, 0, 0, 10);        // optic
    k.box('glass', 0.02, 0.02, 0.003, 0, 0.088, -0.126);
    k.box('gun', 0.03, 0.03, 0.04, 0, -0.035, -0.36);                           // forward grip
  }
  return { kit: k, R: [0.0, -0.13, 0.08], L: [-0.01, -0.06, -0.26], butt: [0, -0.03, 0.4], muzzle: [0, 0.012, -0.71] };
}

function aksuKit() {
  const k = new Kit(1.2);
  k.box('gun', 0.046, 0.068, 0.26, 0, 0, -0.04);
  k.cyl('gun', 0.024, 0.024, 0.24, 0, 0.03, -0.05, HALF_PI, 0, 0, 10);
  k.box('wood', 0.052, 0.045, 0.13, 0, 0.0, -0.22);
  k.cyl('metal', 0.012, 0.012, 0.12, 0, 0.012, -0.32, HALF_PI, 0, 0, 8);
  k.cyl('metal', 0.022, 0.022, 0.07, 0, 0.012, -0.4, HALF_PI, 0, 0, 8);
  k.box('gun', 0.03, 0.095, 0.04, 0, -0.07, 0.04, -0.32);
  curvedMag(k, 'gun', 0, -0.03, -0.1, 5, 0.04, 0.11);
  k.rod('metal', new THREE.Vector3(0.015, -0.01, 0.09), new THREE.Vector3(0.015, -0.03, 0.4), 0.007, 4);
  k.rod('metal', new THREE.Vector3(-0.015, -0.01, 0.09), new THREE.Vector3(-0.015, -0.03, 0.4), 0.007, 4);
  k.box('metal', 0.04, 0.09, 0.012, 0, -0.04, 0.4);
  return { kit: k, R: [0.0, -0.13, 0.08], L: [-0.01, -0.06, -0.2], butt: [0, -0.03, 0.4], muzzle: [0, 0.012, -0.44] };
}

function pkmKit() {
  const k = new Kit(1.2);
  k.box('gun', 0.055, 0.085, 0.36, 0, 0, -0.06);
  k.box('gun', 0.06, 0.03, 0.2, 0, 0.055, -0.04);                                // feed cover
  k.cyl('metal', 0.015, 0.015, 0.64, 0, 0.01, -0.55, HALF_PI, 0, 0, 10);         // barrel
  k.cyl('metal', 0.022, 0.02, 0.09, 0, 0.01, -0.9, HALF_PI, 0, 0, 8);            // flash hider
  k.box('metal', 0.03, 0.05, 0.04, 0, 0.05, -0.38);                              // carry handle
  k.cyl('metal', 0.013, 0.013, 0.2, 0, -0.025, -0.38, HALF_PI, 0, 0, 6);        // gas tube
  for (const s of [-1, 1]) k.rod('metal', new THREE.Vector3(s * 0.012, -0.02, -0.74), new THREE.Vector3(s * 0.02, -0.04, -0.42), 0.006, 4); // folded bipod
  k.box('gun', 0.032, 0.1, 0.045, 0, -0.075, 0.04, -0.3);
  k.rod('gun', new THREE.Vector3(0, 0.02, 0.12), new THREE.Vector3(0, -0.01, 0.45), 0.014, 5);  // skeleton stock
  k.rod('gun', new THREE.Vector3(0, -0.06, 0.1), new THREE.Vector3(0, -0.07, 0.45), 0.013, 5);
  k.box('gun', 0.04, 0.14, 0.03, 0, -0.03, 0.46);
  k.box('dark', 0.09, 0.13, 0.18, -0.045, -0.1, -0.12);                          // 100-round box
  k.box('metal', 0.03, 0.02, 0.06, -0.035, 0.02, -0.06, 0, 0, 0.6);              // belt
  return { kit: k, R: [0.0, -0.13, 0.08], L: [-0.04, -0.17, -0.12], butt: [0, -0.02, 0.47], muzzle: [0, 0.01, -0.95] };
}

function rpgKit() {
  const k = new Kit(1.4);
  k.cyl('gun', 0.035, 0.035, 0.98, 0, 0, 0.08, HALF_PI, 0, 0, 12);              // tube
  k.cyl('wood', 0.046, 0.046, 0.32, 0, 0, -0.05, HALF_PI, 0, 0, 12);             // heat shield
  k.cyl('gun', 0.035, 0.065, 0.14, 0, 0, 0.62, -HALF_PI, 0, 0, 12);              // venturi flare
  k.box('gun', 0.03, 0.11, 0.045, 0, -0.085, 0.02, -0.2);                        // trigger grip
  k.box('gun', 0.03, 0.1, 0.04, 0, -0.08, -0.22, -0.1);                          // front grip
  k.box('dark', 0.03, 0.06, 0.12, -0.06, 0.04, -0.04);                           // PGO-7 sight
  k.cyl('dark', 0.02, 0.02, 0.05, -0.06, 0.04, 0.035, HALF_PI, 0, 0, 8);
  // PG-7V grenade in the muzzle.
  k.cyl('dark', 0.022, 0.022, 0.12, 0, 0, -0.46, HALF_PI, 0, 0, 8);
  k.cyl('warhead', 0.06, 0.085, 0.1, 0, 0, -0.56, HALF_PI, 0, 0, 14);
  k.cyl('warhead', 0.085, 0.015, 0.22, 0, 0, -0.72, HALF_PI, 0, 0, 14);
  k.cyl('metal', 0.008, 0.012, 0.05, 0, 0, -0.85, HALF_PI, 0, 0, 6);
  return { kit: k, R: [0.0, -0.15, 0.08], L: [-0.01, -0.15, -0.16], butt: [0, 0, 0.3], muzzle: [0, 0, -0.85], shoulder: true };
}

function binocularKit() {
  const k = new Kit(1.6);
  for (const s of [-1, 1]) {
    k.cyl('dark', 0.026, 0.024, 0.12, s * 0.032, 0, 0, HALF_PI, 0, 0, 10);
    k.cyl('glass', 0.02, 0.02, 0.005, s * 0.032, 0, -0.062, HALF_PI, 0, 0, 10);
  }
  k.box('dark', 0.03, 0.02, 0.05, 0, 0.005, 0.0);
  return { kit: k, R: [0.09, -0.06, 0.04], L: [-0.09, -0.06, 0.04] };
}

// ---- Camouflage ---------------------------------------------------------------------------------

function camoCanvas(kind, seed) {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d'), rand = mulberry32(seed);
  const blobs = (cols, n, rx, ry) => {
    for (let i = 0; i < n; i++) {
      g.fillStyle = cols[i % cols.length];
      const x = rand() * S, y = rand() * S, a = rand() * 3, w = rx * (0.5 + rand()), h = ry * (0.5 + rand());
      for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { g.beginPath(); g.ellipse(x + ox, y + oy, w, h, a, 0, Math.PI * 2); g.fill(); }
    }
  };
  if (kind === 'emr') {
    // Russian digital: square pixels in four colours.
    g.fillStyle = '#7d8064'; g.fillRect(0, 0, S, S);
    const cell = 8, N = S / cell;
    for (const [col, th] of [['#5b6448', 0.45], ['#5a4b3b', 0.62], ['#2e2f27', 0.78]]) {
      const grid = Array.from({ length: N * N }, () => rand());
      g.fillStyle = col;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        let v = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) v += grid[((y + dy + N) % N) * N + ((x + dx + N) % N)];
        if (v / 9 > th * 0.5 + 0.27) g.fillRect(x * cell, y * cell, cell, cell);
      }
    }
  } else if (kind === 'flora') {
    // VSR-98 "Flora": wavy horizontal bands.
    g.fillStyle = '#8a8c6c'; g.fillRect(0, 0, S, S);
    const bands = [['#5d6943', 0.0], ['#a49b78', 0.3], ['#594a39', 0.55], ['#5d6943', 0.75]];
    for (const [col, y0] of bands) {
      g.fillStyle = col;
      g.beginPath();
      const ph = rand() * 6.28, amp = 8 + rand() * 10, th = 18 + rand() * 18;
      for (let x = 0; x <= S; x += 8) g.lineTo(x, y0 * S + Math.sin((x / S) * 6.283 * 2 + ph) * amp);
      for (let x = S; x >= 0; x -= 8) g.lineTo(x, y0 * S + th + Math.sin((x / S) * 6.283 * 2 + ph + 1) * amp);
      g.fill();
    }
  } else if (kind === 'ataka') {
    g.fillStyle = '#857a5c'; g.fillRect(0, 0, S, S);
    blobs(['#4f5a3a', '#5e4c38', '#393427'], 46, 22, 9);
  } else {
    g.fillStyle = '#545a40'; g.fillRect(0, 0, S, S);
    blobs(['#4c523a', '#5b6046'], 30, 30, 20);
  }
  // Wear, dirt and fabric grain.
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(${rand() < 0.55 ? '40,34,26' : '150,140,115'},${rand() * 0.12})`;
    g.fillRect(rand() * S, rand() * S, 1 + rand() * 2, 1 + rand() * 2);
  }
  return c;
}

// ---- Factory ------------------------------------------------------------------------------------

const SKIN_TONES = [
  ['#e2bba3', 0.2], ['#d2a184', 0.18], ['#b98663', 0.15], ['#9b6c4c', 0.13],
  ['#6e4730', 0.12], ['#4b2f1f', 0.12], ['#36221a', 0.1],
];
const CAMO = ['emr', 'flora', 'ataka', 'olive'];
const GEAR = ['#4a4e39', '#3c4334', '#6f6248', '#53523f'];
const HEAD_VARIANTS = 10;

function pick(rand, list) {
  let r = rand() * list.reduce((a, x) => a + x[1], 0);
  for (const x of list) { if ((r -= x[1]) <= 0) return x[0]; }
  return list[list.length - 1][0];
}

export function createSoldierFactory() {
  const disposables = [];
  const keep = (x) => { disposables.push(x); return x; };
  const std = (o) => keep(new THREE.MeshStandardMaterial({ roughness: 0.9, ...o }));

  // Materials, shared between soldiers that pick the same option.
  const camoMats = CAMO.map((k, i) => {
    const t = keep(canvasTexture(camoCanvas(k, 40 + i), { repeat: true }));
    return std({ map: t, roughness: 0.95 });
  });
  const camoGearMats = camoMats.map((m) => std({ map: m.map, color: 0xb0b0a8, roughness: 0.9, side: THREE.DoubleSide }));
  const gearMats = GEAR.map((c) => std({ color: c, roughness: 0.88, side: THREE.DoubleSide }));
  const skinMats = SKIN_TONES.map(([c]) => std({ color: c, vertexColors: true, roughness: 0.62 }));
  const shared = {
    helmetPaint: std({ color: 0x3f4632, roughness: 0.7, side: THREE.DoubleSide }),
    knit: std({ color: 0x2b2c27, roughness: 1, side: THREE.DoubleSide }),
    knitTan: std({ color: 0x5d5642, roughness: 1, side: THREE.DoubleSide }),
    glove: std({ color: 0x2a2a25, roughness: 0.85 }),
    gloveTan: std({ color: 0x6b5e47, roughness: 0.9 }),
    boot: std({ color: 0x1d1a16, roughness: 0.7 }),
    bootTan: std({ color: 0x5a4a36, roughness: 0.85 }),
    sole: std({ color: 0x151412, roughness: 0.9 }),
    gun: std({ color: 0x1a1a19, roughness: 0.55, metalness: 0.3 }),
    metal: std({ color: 0x2a2a28, roughness: 0.4, metalness: 0.8 }),
    wood: std({ color: 0x6a3f22, roughness: 0.6 }),
    dark: std({ color: 0x2e3127, roughness: 0.8 }),
    glass: std({ color: 0x182028, roughness: 0.1, metalness: 0.6 }),
    warhead: std({ color: 0x3d4434, roughness: 0.6, metalness: 0.3 }),
    strap: std({ color: 0x2c2d25, roughness: 0.95, side: THREE.DoubleSide }),
    tapeWhite: std({ color: 0xd8d8d0, roughness: 0.7, side: THREE.DoubleSide }),
    tapeRed: std({ color: 0x9a1c18, roughness: 0.7, side: THREE.DoubleSide }),
    tapeYellow: std({ color: 0xd6b52a, roughness: 0.7, side: THREE.DoubleSide }),
    mat: std({ color: 0x4f5a45, roughness: 0.9 }),
    tanker: std({ color: 0x1d1e1b, roughness: 0.85, side: THREE.DoubleSide }),
    tankerCanvas: std({ color: 0x4a4a39, roughness: 0.95, side: THREE.DoubleSide }),
  };
  // Tank crews' one-piece coveralls: black or dark olive.
  const coveralls = [std({ color: 0x23251f, roughness: 0.95 }), std({ color: 0x3a3f2f, roughness: 0.95 })];

  const uniformGeo = keep(buildUniform());
  const headGeos = Array.from({ length: HEAD_VARIANTS }, (_, i) => keep(buildHead(mulberry32(900 + i * 37))));
  const neckGeo = keep(withColor(new THREE.CylinderGeometry(0.05, 0.057, 0.17, 12).translate(0, 0.06, 0.008)));
  const handGeo = { R: keep(buildHand(1)), L: keep(buildHand(-1)) };
  // Balaclava: an oversized head with the eye band cut out.
  const balaclavaGeo = keep((() => {
    const g = buildHead(mulberry32(5)).toNonIndexed();
    const p = g.attributes.position, keepTri = [];
    for (let i = 0; i < p.count; i += 3) {
      let cy = 0, cz = 0, cx = 0;
      for (let k = 0; k < 3; k++) { cx += Math.abs(p.getX(i + k)) / 3; cy += p.getY(i + k) / 3; cz += p.getZ(i + k) / 3; }
      const eyeBand = cz < -0.04 && cy > -0.005 && cy < 0.03 && cx < 0.07;
      if (!eyeBand) keepTri.push(i);
    }
    const pos = [];
    for (const i of keepTri) for (let k = 0; k < 3; k++) pos.push(p.getX(i + k) * 1.06, p.getY(i + k) * 1.04 - 0.004, p.getZ(i + k) * 1.06);
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.computeVertexNormals();
    return out;
  })());

  // Rigid kit, grouped by the bone that carries it. Coordinates are in the rest pose (world), and
  // are moved into the bone's space when built.
  function boneKit(bone, fill) { const k = new Kit(); fill(k); return { bone, kit: k }; }
  const J = (n) => JOINTS[n];

  const headgear = {
    helmet: boneKit('head', (k) => {
      k.add('helmet', helmetShell(0.118, 0.112, 0.134), 0, 1.69, -0.006);
    }),
    helmetGoggles: boneKit('head', (k) => {
      k.add('helmet', helmetShell(0.118, 0.112, 0.134), 0, 1.69, -0.006);
      k.add('strap', new THREE.CylinderGeometry(0.127, 0.127, 0.03, 20, 1, true).scale(1, 1, 1.12), 0, 1.71, -0.006);
      k.box('dark', 0.16, 0.05, 0.04, 0, 1.73, -0.15, -0.3);
      k.box('glass', 0.14, 0.035, 0.01, 0, 1.73, -0.172, -0.3);
    }),
    knit: boneKit('head', (k) => {
      k.add('knit', helmetShell(0.086, 0.105, 0.104, 1.25, 1.55, 0), 0, 1.69, -0.006);
      k.add('knit', new THREE.TorusGeometry(0.09, 0.012, 6, 20).rotateX(HALF_PI).scale(1, 1, 1.18), 0, 1.69 - 0.0, -0.006, 0.12);
    }),
    boonie: boneKit('head', (k) => {
      k.add('helmet', helmetShell(0.088, 0.1, 0.106, 1.3, 1.5, 0), 0, 1.7, -0.006);
      k.add('helmet', new THREE.CylinderGeometry(0.16, 0.17, 0.03, 20, 1, true), 0, 1.69, -0.006);
      k.add('helmet', new THREE.RingGeometry(0.09, 0.17, 20, 1).rotateX(-HALF_PI), 0, 1.705, -0.006);
    }),
    // Soviet-pattern padded tank helmet: a soft cap with three padded rolls over the top, ear pieces
    // for the intercom and a strap under the chin.
    tanker: boneKit('head', (k) => {
      k.add('helmet', helmetShell(0.104, 0.112, 0.122, 1.6, 2.0, 0), 0, 1.685, -0.004);
      for (const x of [-0.045, 0, 0.045]) {
        k.add('helmet', new THREE.TorusGeometry(0.108 - Math.abs(x) * 0.25, 0.016, 6, 18, Math.PI).rotateY(HALF_PI).scale(1, 1, 1.08), x, 1.688, -0.004);
      }
      for (const sd of [-1, 1]) {
        k.add('helmet', new THREE.TorusGeometry(0.03, 0.012, 6, 14).rotateY(HALF_PI), sd * 0.103, 1.645, 0.0);
        k.cyl('dark', 0.026, 0.026, 0.02, sd * 0.105, 1.645, 0.0, 0, 0, HALF_PI, 12);
      }
      k.add('strap', new THREE.TorusGeometry(0.085, 0.006, 4, 16, Math.PI).rotateZ(Math.PI).scale(1.15, 1, 1), 0, 1.6, -0.035, 0.35);
      k.box('strap', 0.025, 0.035, 0.02, 0.07, 1.62, -0.11);                      // intercom lead plug
    }),
    cap: boneKit('head', (k) => {
      k.add('helmet', new THREE.CylinderGeometry(0.095, 0.088, 0.08, 18, 1).scale(1, 1, 1.15), 0, 1.735, -0.006);
      k.add('helmet', new THREE.CylinderGeometry(0.06, 0.06, 0.008, 12, 1, false, HALF_PI, Math.PI).scale(1.4, 1, 1.1), 0, 1.71, -0.1, 0.25);
    }),
  };

  const chestKits = {
    carrier: boneKit('chest', (k) => {
      const plate = new THREE.Shape([[-0.14, -0.17], [0.14, -0.17], [0.14, 0.09], [0.08, 0.16], [-0.08, 0.16], [-0.14, 0.09]].map(([x, y]) => new THREE.Vector2(x, y)));
      const geo = () => new THREE.ExtrudeGeometry(plate, { depth: 0.05, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 1 });
      k.add('gear', geo(), 0, 1.27, -0.185, 0.05);
      k.add('gear', geo(), 0, 1.27, 0.12, -0.04);
      k.add('gear', new THREE.CylinderGeometry(1, 1, 0.13, 18, 1, true).scale(0.2, 1, 0.142), 0, 1.17, -0.01);
      for (const s of [-1, 1]) k.box('gear', 0.065, 0.025, 0.3, s * 0.105, 1.465, -0.01);
      for (let i = 0; i < 3; i++) {                                                // magazine pouches
        k.box('gear', 0.07, 0.13, 0.055, -0.085 + i * 0.085, 1.16, -0.225);
        k.box('gear', 0.072, 0.03, 0.06, -0.085 + i * 0.085, 1.235, -0.225);
      }
      k.box('gear', 0.06, 0.11, 0.045, -0.085, 1.34, -0.22);                       // radio pouch
      k.rod('dark', new THREE.Vector3(-0.1, 1.39, -0.22), new THREE.Vector3(-0.12, 1.62, -0.2), 0.004, 4);
      k.box('strap', 0.035, 0.12, 0.03, 0.09, 1.36, -0.215);                        // tourniquet
      for (const s of [-1, 1]) k.box('gear', 0.06, 0.1, 0.05, s * 0.2, 1.16, -0.02); // grenade pouches
    }),
    vestOld: boneKit('chest', (k) => {
      // Older 6B23 soft vest with a chest rig over it.
      k.add('gear', new THREE.CylinderGeometry(1, 1.03, 0.33, 18, 1, true).scale(0.2, 1, 0.137), 0, 1.27, -0.004);
      for (const s of [-1, 1]) k.box('gear', 0.07, 0.02, 0.28, s * 0.11, 1.45, 0);
      for (let i = 0; i < 4; i++) k.box('gear', 0.065, 0.12, 0.05, -0.12 + i * 0.08, 1.14, -0.17);
      k.box('strap', 0.36, 0.03, 0.03, 0, 1.22, -0.17);
    }),
    pack: boneKit('chest', (k) => {
      k.box('gear', 0.3, 0.36, 0.15, 0, 1.24, 0.24);
      k.box('gear', 0.24, 0.12, 0.05, 0, 1.15, 0.33);
      k.cyl('mat', 0.065, 0.065, 0.36, 0, 1.47, 0.23, 0, 0, HALF_PI, 10);
    }),
  };

  const hipsKit = boneKit('hips', (k) => {
    k.add('strap', new THREE.CylinderGeometry(1, 1, 0.045, 18, 1, true).scale(0.185, 1, 0.127), 0, 0.99, 0);
    k.box('gear', 0.12, 0.13, 0.07, 0.1, 0.92, 0.15);                              // dump pouch
    k.cyl('gear', 0.04, 0.04, 0.16, -0.16, 0.93, 0.08, 0, 0, 0, 10);              // canteen
    k.box('gear', 0.08, 0.1, 0.04, 0.17, 0.94, -0.06);                             // first aid
  });
  const holsterKit = boneKit('hips', (k) => {
    k.box('dark', 0.04, 0.13, 0.08, 0.195, 0.9, -0.02, 0, 0, 0.15);
    k.box('gun', 0.03, 0.04, 0.06, 0.195, 0.98, -0.02, 0, 0, 0.15);
  });
  const neckKit = boneKit('neck', (k) => {
    k.add('strap', new THREE.CylinderGeometry(0.07, 0.085, 0.06, 14, 1, true), 0, 1.475, 0.005); // collar
  });

  const limbKits = [];
  for (const [s, n] of [[1, 'R'], [-1, 'L']]) {
    const K = J('shin' + n), Fo = J('foot' + n);
    limbKits.push(boneKit('foot' + n, (k) => {
      const g = loft([
        { p: [Fo[0], Fo[1] - 0.04, Fo[2] + 0.075], rx: 0.04, rz: 0.04 },
        { p: [Fo[0], Fo[1] - 0.035, Fo[2] + 0.04], rx: 0.048, rz: 0.055 },
        { p: [Fo[0], Fo[1] - 0.045, Fo[2] - 0.04], rx: 0.05, rz: 0.045 },
        { p: [Fo[0], Fo[1] - 0.055, Fo[2] - 0.12], rx: 0.048, rz: 0.035 },
        { p: [Fo[0], Fo[1] - 0.06, Fo[2] - 0.18], rx: 0.04, rz: 0.026 },
        { p: [Fo[0], Fo[1] - 0.063, Fo[2] - 0.205], rx: 0.022, rz: 0.016 },
      ], { segs: 12, ref: [0, 1, 0], cap0: true, cap1: true });
      k.add('boot', only(g, ['position', 'normal', 'uv']));
      k.box('sole', 0.1, 0.022, 0.29, Fo[0], 0.012, Fo[2] - 0.06);
    }));
    limbKits.push(boneKit('shin' + n, (k) => {
      k.cyl('boot', 0.058, 0.052, 0.17, Fo[0], 0.19, Fo[2] + 0.005, 0, 0, 0, 12);
      k.cyl('strap', 0.06, 0.06, 0.02, Fo[0], 0.27, Fo[2] + 0.005, 0, 0, 0, 12);
    }));
    limbKits.push(boneKit('shin' + n, (k) => {
      k.box('dark', 0.1, 0.12, 0.04, K[0], K[1] - 0.02, K[2] - 0.075, 0.1);       // knee pad
    }));
    const Hp = J('thigh' + n);
    limbKits.push(boneKit('thigh' + n, (k) => {
      k.box('cloth', 0.035, 0.15, 0.13, s * 0.19, 0.68, 0.0);                      // cargo pocket
    }));
    limbKits.push(boneKit('hand' + n, () => {}));
    limbKits.push(boneKit('arm' + n, (k) => {
      k.add('tape', new THREE.CylinderGeometry(0.063, 0.064, 0.05, 14, 1, true), J('arm' + n)[0] + s * 0.01, 1.27, 0.008, 0, 0, s * 0.06);
    }));
    limbKits.push(boneKit('thigh' + n, (k) => {
      k.add('tape', new THREE.CylinderGeometry(0.093, 0.09, 0.05, 14, 1, true), Hp[0] + s * 0.004, 0.75, -0.002);
    }));
  }
  // Index the limb kits by role for per-soldier selection.
  const [bootR, bootShaftR, kneeR, pocketR, , tapeArmR, tapeLegR, bootL, bootShaftL, kneeL, pocketL, , tapeArmL, tapeLegL] = limbKits;

  const PROTO = new Proxy({}, { get: () => shared.dark });
  // Builds a kit into a group in its bone's space. Built once; soldiers clone it and pick materials.
  function bake(bk) {
    const g = bk.kit.build(PROTO), j = JOINTS[bk.bone];
    g.traverse((o) => { if (o.isMesh) { o.geometry.translate(-j[0], -j[1], -j[2]); disposables.push(o.geometry); } });
    return { bone: bk.bone, group: g };
  }
  const baked = new Map();
  const bakeOnce = (bk) => { if (!baked.has(bk)) baked.set(bk, bake(bk)); return baked.get(bk); };

  const weapons = {
    ak74: akKit('ak74'), akm: akKit('akm'), ak12: akKit('ak12'), aksu: aksuKit(), pkm: pkmKit(), rpg: rpgKit(), binos: binocularKit(),
  };
  const weaponGroups = {};
  for (const [name, w] of Object.entries(weapons)) {
    const g = w.kit.build(PROTO);
    g.traverse((o) => { if (o.isMesh) disposables.push(o.geometry); });
    weaponGroups[name] = g;
  }

  // Rest-pose inverse bind matrices, the same for every soldier.
  const restBones = makeBones();
  const restRoot = new THREE.Group();
  restRoot.add(restBones.list[0]);
  restRoot.updateMatrixWorld(true);
  const boneInverses = restBones.list.map((b) => b.matrixWorld.clone().invert());

  function makeBones() {
    const map = {}, list = [];
    for (const name of BONE_NAMES) {
      const b = new THREE.Bone();
      b.name = name;
      const j = JOINTS[name], par = PARENT[name];
      if (par) { const pj = JOINTS[par]; b.position.set(j[0] - pj[0], j[1] - pj[1], j[2] - pj[2]); map[par].add(b); } else b.position.set(j[0], j[1], j[2]);
      map[name] = b; list.push(b);
    }
    return { map, list };
  }

  // One soldier. `variant` is the sim's role; everything else comes from the seed.
  // opts.friendly: one of ours (yellow tape on the arms and legs).
  function make(variant, seed, opts = {}) {
    const rand = mulberry32(seed);
    const root = new THREE.Group();
    const { map: bones, list } = makeBones();
    root.add(list[0]);
    const camo = Math.floor(rand() * camoMats.length);
    const crew = variant === 'crew';
    const coverall = crew && rand() < 0.65 ? coveralls[Math.floor(rand() * coveralls.length)] : null;
    const body = new THREE.SkinnedMesh(uniformGeo, coverall ?? camoMats[camo]);
    body.frustumCulled = false;
    body.castShadow = body.receiveShadow = true;
    root.add(body);
    root.updateMatrixWorld(true);
    body.bind(new THREE.Skeleton(list, boneInverses.map((m) => m.clone())), new THREE.Matrix4());

    const tone = pick(rand, SKIN_TONES.map((t, i) => [i, t[1]]));
    const skin = skinMats[tone];
    const gearMat = rand() < 0.3 ? camoGearMats[camo] : gearMats[Math.floor(rand() * gearMats.length)];
    const officer = variant === 'officer';
    const headKind = crew ? 'tanker' : officer ? 'cap' : pick(rand, [['helmet', 0.55], ['helmetGoggles', 0.12], ['knit', 0.18], ['boonie', 0.15]]);
    const helmetMat = headKind === 'tanker' ? (rand() < 0.65 ? shared.tanker : shared.tankerCanvas)
      : headKind === 'knit' ? (rand() < 0.6 ? shared.knit : shared.knitTan)
      : headKind === 'boonie' || headKind === 'cap' ? camoGearMats[camo] : rand() < 0.65 ? camoGearMats[camo] : shared.helmetPaint;
    const balaclava = !officer && !crew && rand() < 0.35;
    const gloves = rand() < 0.7;
    const tape0 = rand() < 0.75 ? (rand() < 0.65 ? shared.tapeWhite : shared.tapeRed) : null;
    const tape = opts.friendly ? shared.tapeYellow : tape0;
    const mats = {
      gear: gearMat, strap: shared.strap, helmet: helmetMat, knit: helmetMat, dark: shared.dark, glass: shared.glass,
      boot: rand() < 0.7 ? shared.boot : shared.bootTan, sole: shared.sole, cloth: coverall ?? camoMats[camo], mat: shared.mat, tape,
      gun: shared.gun, metal: shared.metal, wood: shared.wood, warhead: shared.warhead,
    };
    const attach = (bk) => {
      const b = bakeOnce(bk), g = b.group.clone();
      g.traverse((o) => {
        if (!o.isMesh) return;
        o.material = mats[o.userData.slot] ?? shared.dark;
        o.castShadow = true;
        if (!o.material) o.visible = false;
      });
      bones[b.bone].add(g);
      return g;
    };
    attach(headgear[headKind]);
    if (!crew) attach(rand() < 0.75 || officer ? chestKits.carrier : chestKits.vestOld);
    else if (rand() < 0.3) attach(chestKits.vestOld);
    if (!officer && !crew && rand() < 0.45) attach(chestKits.pack);
    attach(hipsKit);
    if (officer || (crew && rand() < 0.5)) attach(holsterKit);
    attach(neckKit);
    for (const k of [bootR, bootL, bootShaftR, bootShaftL, pocketR, pocketL]) attach(k);
    if (rand() < 0.5) { attach(kneeR); attach(kneeL); }
    if (tape) { attach(tapeArmL); attach(tapeArmR); if (rand() < 0.6) { attach(tapeLegL); attach(tapeLegR); } }

    // Head, neck and hands.
    const headGeo = headGeos[Math.floor(rand() * headGeos.length)];
    const head = new THREE.Mesh(headGeo, skin);
    head.position.set(0, 1.668 - JOINTS.head[1], -0.012 - JOINTS.head[2]);
    head.castShadow = true;
    bones.head.add(head);
    if (balaclava) {
      const b = new THREE.Mesh(balaclavaGeo, rand() < 0.6 ? shared.knit : camoGearMats[camo]);
      b.position.copy(head.position);
      bones.head.add(b);
    }
    const neck = new THREE.Mesh(neckGeo, balaclava ? shared.knit : skin);
    bones.neck.add(neck);
    const handMat = gloves ? (rand() < 0.6 ? shared.glove : shared.gloveTan) : skin;
    for (const n of ['R', 'L']) {
      const h = new THREE.Mesh(handGeo[n], handMat);
      h.castShadow = true;
      bones['hand' + n].add(h);
    }

    // Weapon.
    const gun = variant === 'mg' ? 'pkm' : variant === 'rpg' ? 'rpg' : officer || crew ? 'aksu' : pick(rand, [['ak74', 0.6], ['akm', 0.25], ['ak12', 0.15]]);
    const weapon = weaponGroups[gun].clone();
    weapon.traverse((o) => { if (o.isMesh) { o.material = mats[o.userData.slot] ?? shared.gun; o.castShadow = true; } });
    const wpivot = new THREE.Group();
    wpivot.add(weapon);
    bones.chest.add(wpivot);
    let binos = null;
    if (officer) {
      binos = weaponGroups.binos.clone();
      binos.traverse((o) => { if (o.isMesh) o.material = mats[o.userData.slot] ?? shared.dark; });
      bones.chest.add(binos);
    }
    const scale = (0.95 + rand() * 0.09);
    return {
      root, bones, body, weapon, wpivot, gun, info: weapons[gun], binos, binosInfo: weapons.binos, officer, crew, variant, scale,
      seed, rand,
    };
  }

  return {
    make,
    dispose() { disposables.forEach((d) => d.dispose()); },
  };
}
