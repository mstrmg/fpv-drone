// Windbreak trees. Each species is grown once as a branching skeleton: trunk, limbs, branches and
// twigs. Nearby trees draw that whole skeleton with bark, plus small twig-and-leaf cards on the
// branch tips. Distant trees draw only trunk and limbs with a few large cards over the same
// skeleton, so the outline holds when the detail swaps. Scrub fills the foot of the tree lines.
import * as THREE from 'three';
import { mulberry32, hashString } from './rng.js';
import { makeTwigTexture, makeBarkTextures, LEAF_RUST, LEAF_YELLOW } from './textures.js';

const REF_H = 13, REF_R = 3.5; // proportions the templates are grown at; instances are scaled to fit
const NEAR_DIST = 115, LOD_HYSTERESIS = 12;
const UP = new THREE.Vector3(0, 1, 0);

// Branching habit per species. Arrays are indexed by branch level (0 = trunk).
const SPECIES = {
  ash: {
    bark: 'rough', trunkR: 0.3, trunkLen: 10.2, children: [9, 5, 3], angle: [0.85, 0.75, 0.7],
    len: [0, 3.5, 1.9, 0.95], ratio: [0.42, 0.5, 0.55], crook: [0.05, 0.16, 0.22, 0.28], lift: [0, 0.16, 0.1, 0.05],
  },
  oak: {
    bark: 'rough', trunkR: 0.36, trunkLen: 9.2, children: [8, 5, 3], angle: [1.1, 0.9, 0.8],
    len: [0, 3.9, 2.1, 1.0], ratio: [0.5, 0.52, 0.55], crook: [0.09, 0.3, 0.34, 0.36], lift: [0, 0.1, 0.08, 0.02],
  },
  birch: {
    bark: 'birch', trunkR: 0.2, trunkLen: 11.2, children: [11, 5, 3], angle: [0.75, 0.8, 0.7],
    len: [0, 3.2, 1.8, 1.1], ratio: [0.34, 0.45, 0.5], crook: [0.04, 0.12, 0.2, 0.25], lift: [0, 0.2, -0.06, -0.3],
  },
};

const TEMPLATES = [
  { species: 'ash', seed: 11, leaves: 0.0, share: 0.24 },
  { species: 'ash', seed: 23, leaves: 0.05, share: 0.2 },
  { species: 'oak', seed: 37, leaves: 0.16, share: 0.14 },
  { species: 'oak', seed: 41, leaves: 0.75, share: 0.14 },
  { species: 'birch', seed: 53, leaves: 0.1, palette: LEAF_YELLOW, share: 0.16 },
  { species: 'birch', seed: 67, leaves: 0.5, palette: LEAF_YELLOW, share: 0.12 },
];

function insideCrown(p) {
  if (Math.hypot(p.x, p.z) < 0.9 && p.y < REF_H) return true; // along the trunk
  const d1 = Math.hypot(p.x, p.y - (REF_H - REF_R), p.z);
  const d2 = Math.hypot(p.x, p.y - (REF_H - 1.8 * REF_R), p.z);
  return d1 < REF_R * 1.02 || d2 < REF_R * 0.82;
}

function growSkeleton(seed, sp) {
  const rand = mulberry32(seed);
  const branches = [];
  const tmp = new THREE.Vector3(), perp = new THREE.Vector3(), q = new THREE.Quaternion();
  const grow = (start, dir, len, r0, level, phase) => {
    const nSeg = [7, 4, 3, 2][level];
    const pts = [start.clone()], radii = [r0], dirs = [dir.clone()];
    const d = dir.clone();
    for (let i = 1; i <= nSeg; i++) {
      tmp.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(sp.crook[level] * 2);
      d.add(tmp); d.y += sp.lift[level]; d.normalize();
      const p = pts[pts.length - 1].clone().addScaledVector(d, len / nSeg);
      if (level > 0 && !insideCrown(p)) break;
      pts.push(p); dirs.push(d.clone());
      radii.push(r0 * (1 - (i / nSeg) * (level === 0 ? 0.78 : 0.7)));
    }
    if (pts.length < 2) return;
    branches.push({ pts, radii, dirs, level });
    if (level >= 3) return;
    const n = sp.children[level];
    for (let c = 0; c < n; c++) {
      const t = (level === 0 ? 0.3 : 0.22) + (1 - (level === 0 ? 0.3 : 0.22)) * ((c + rand() * 0.8) / n);
      const f = t * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)), k = f - i;
      const at = pts[i].clone().lerp(pts[i + 1], k);
      const pd = dirs[i + 1];
      const pr = radii[i] + (radii[i + 1] - radii[i]) * k;
      // Fan children around the parent with the golden angle so they never line up.
      perp.set(1, 0, 0).cross(pd);
      if (perp.lengthSq() < 0.01) perp.set(0, 0, 1).cross(pd);
      perp.normalize().applyQuaternion(q.setFromAxisAngle(pd, phase + c * 2.39996 + rand() * 0.5));
      const a = sp.angle[level] + (rand() - 0.5) * 0.35;
      const cd = pd.clone().multiplyScalar(Math.cos(a)).addScaledVector(perp, Math.sin(a)).normalize();
      const cl = sp.len[level + 1] * (0.7 + rand() * 0.6) * (1 - 0.35 * t);
      grow(at, cd, cl, Math.max(0.011, pr * sp.ratio[level]), level + 1, rand() * 6.28);
    }
  };
  grow(new THREE.Vector3(0, -0.4, 0), new THREE.Vector3((rand() - 0.5) * 0.08, 1, (rand() - 0.5) * 0.08).normalize(), sp.trunkLen + 0.4, sp.trunkR, 0, rand() * 6.28);
  return branches;
}

// Sweeps a tube along every branch up to `maxLevel`.
function buildWood(branches, maxLevel, sidesByLevel) {
  const pos = [], nrm = [], uv = [], idx = [];
  const tan = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), n = new THREE.Vector3();
  for (const br of branches) {
    if (br.level > maxLevel) continue;
    const sides = sidesByLevel[br.level];
    const base = pos.length / 3;
    let dist = 0;
    const uRep = br.level === 0 ? 2 : 1;
    for (let i = 0; i < br.pts.length; i++) {
      const p = br.pts[i];
      tan.copy(br.dirs[Math.min(i + 1, br.dirs.length - 1)]);
      a.set(0, 0, 1).cross(tan);
      if (a.lengthSq() < 0.01) a.set(1, 0, 0).cross(tan);
      a.normalize(); b.crossVectors(tan, a);
      if (i > 0) dist += p.distanceTo(br.pts[i - 1]);
      const flare = br.level === 0 && i === 0 ? 1.45 : 1; // root flare
      for (let s = 0; s <= sides; s++) {
        const ang = (s / sides) * Math.PI * 2;
        n.copy(a).multiplyScalar(Math.cos(ang)).addScaledVector(b, Math.sin(ang));
        const r = br.radii[i] * flare;
        pos.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r);
        nrm.push(n.x, n.y, n.z);
        uv.push((s / sides) * uRep, dist / 1.6);
      }
    }
    for (let i = 0; i < br.pts.length - 1; i++) for (let s = 0; s < sides; s++) {
      const v0 = base + i * (sides + 1) + s, v1 = v0 + sides + 1;
      idx.push(v0, v0 + 1, v1, v0 + 1, v1 + 1, v1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

class Cards {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.idx = []; }
  // A quad standing on `anchor` along `up`, emitted twice so both sides shade alike.
  add(anchor, up, right, width, height) {
    const a = anchor.clone().addScaledVector(right, -width / 2), b = anchor.clone().addScaledVector(right, width / 2);
    const c = b.clone().addScaledVector(up, height), d = a.clone().addScaledVector(up, height);
    const cx = anchor.x + up.x * height * 0.5, cz = anchor.z + up.z * height * 0.5;
    const n = new THREE.Vector3(cx / REF_R * 0.8, 0.75, cz / REF_R * 0.8).normalize();
    const base = this.pos.length / 3;
    for (const p of [a, b, c, d]) { this.pos.push(p.x, p.y, p.z); this.nrm.push(n.x, n.y, n.z); }
    this.uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3, base, base + 2, base + 1, base, base + 3, base + 2);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    return g;
  }
}

function buildNearCards(branches, seed, droop) {
  const rand = mulberry32(seed + 1);
  const cards = new Cards();
  const up = new THREE.Vector3(), right = new THREE.Vector3(), r = new THREE.Vector3();
  for (const br of branches) {
    if (br.level < 2) continue;
    const tip = br.pts[br.pts.length - 1], dir = br.dirs[br.dirs.length - 1];
    const n = br.level === 2 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      up.copy(dir).multiplyScalar(0.75); up.y += 0.25 - droop; up.normalize();
      right.crossVectors(up, r.set(rand() - 0.5, rand() - 0.5, rand() - 0.5)).normalize();
      const size = (br.level === 2 ? 1.9 : 1.45) * (0.8 + rand() * 0.45);
      cards.add(tip.clone().addScaledVector(up, -size * 0.12), up, right, size, size);
    }
  }
  return cards.build();
}

function buildFarCards(branches, seed) {
  const rand = mulberry32(seed + 2);
  const cards = new Cards();
  const right = new THREE.Vector3(), up = new THREE.Vector3();
  for (const br of branches) {
    if (br.level !== 1) continue;
    const mid = br.pts[Math.floor((br.pts.length - 1) * 0.5)];
    const yaw = rand() * Math.PI;
    right.set(Math.cos(yaw), 0, Math.sin(yaw));
    up.set((rand() - 0.5) * 0.4, 1, (rand() - 0.5) * 0.4).normalize();
    const size = 3.4 + rand() * 1.2;
    cards.add(mid.clone().setY(mid.y - 0.6), up, right, size, Math.min(size, REF_H + 0.3 - mid.y + 0.6));
  }
  const yaw = rand() * Math.PI;
  for (const off of [0, Math.PI / 2]) {
    right.set(Math.cos(yaw + off), 0, Math.sin(yaw + off));
    cards.add(new THREE.Vector3(0, 4.0, 0), UP, right, REF_R * 2.1, REF_H - 3.7);
  }
  return cards.build();
}

const SWAY = /* glsl */ `#include <begin_vertex>
  #ifdef USE_INSTANCING
    float swayPh = dot(instanceMatrix[3].xyz, vec3(0.31, 0.0, 0.23));
    float swayK = max(position.y - 4.0, 0.0) * 0.011;
    transformed.x += sin(uTime * 1.1 + swayPh + position.y * 0.3) * swayK;
    transformed.z += sin(uTime * 0.83 + swayPh * 1.7) * swayK * 0.7;
  #endif`;

export function createTrees({ scene, level }) {
  const trees = level.objects.filter((o) => o.kind === 'tree');
  const timeU = { value: 0 };
  const disposables = [];
  const keep = (x) => { disposables.push(x); return x; };
  const sway = (mat) => {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = timeU;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <begin_vertex>', SWAY);
    };
    return keep(mat);
  };

  const barkMats = {};
  for (const kind of ['rough', 'birch']) {
    const { map, normalMap } = makeBarkTextures(kind);
    keep(map); keep(normalMap);
    barkMats[kind] = sway(new THREE.MeshStandardMaterial({ map, normalMap, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.95 }));
  }

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const col = new THREE.Color();
  const meshes = [];
  const addMesh = (geo, mat, count, shadow = true) => {
    const m = new THREE.InstancedMesh(keep(geo), mat, count);
    m.castShadow = shadow;
    m.frustumCulled = false; // instances are re-sorted between detail levels, so bounds would go stale
    m.count = 0;
    scene.add(m);
    meshes.push(m);
    return m;
  };

  // Sort the level's trees into templates.
  const templates = TEMPLATES.map((t) => ({ ...t, list: [] }));
  for (const t of trees) {
    let r = (hashString(t.id) % 10000) / 10000, pick = templates[0];
    for (const tpl of templates) { if (r < tpl.share) { pick = tpl; break; } r -= tpl.share; }
    const rand = mulberry32(hashString(t.id) + 5);
    q.setFromAxisAngle(UP, rand() * Math.PI * 2);
    s.set(t.radius / REF_R, t.height / REF_H, t.radius / REF_R);
    m4.compose(p.fromArray(t.position), q, s);
    const k = 0.82 + rand() * 0.3, c = 0.8 + rand() * 0.38;
    pick.list.push({
      x: t.position[0], z: t.position[2], near: false, matrix: m4.clone(),
      wood: new THREE.Color(k, k * (0.96 + rand() * 0.08), k * (0.92 + rand() * 0.1)),
      crown: new THREE.Color(c, c * (0.94 + rand() * 0.1), c * (0.86 + rand() * 0.16)),
    });
  }

  for (const tpl of templates) {
    if (!tpl.list.length) continue;
    const sp = SPECIES[tpl.species];
    const skeleton = growSkeleton(tpl.seed, sp);
    const tex = keep(makeTwigTexture(300 + tpl.seed, tpl.leaves, tpl.palette ?? LEAF_RUST));
    const cardMat = sway(new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.25, alphaToCoverage: true, roughness: 1 }));
    const n = tpl.list.length;
    tpl.nearWood = addMesh(buildWood(skeleton, 3, [9, 6, 4, 3]), barkMats[sp.bark], n);
    tpl.nearCrown = addMesh(buildNearCards(skeleton, tpl.seed, tpl.species === 'birch' ? 0.45 : 0), cardMat, n);
    tpl.farWood = addMesh(buildWood(skeleton, 1, [6, 4]), barkMats[sp.bark], n);
    tpl.farCrown = addMesh(buildFarCards(skeleton, tpl.seed), cardMat, n);
    tpl.dirty = true;
  }

  // Scrub at the foot of the trees: low crossed cards, purely decorative.
  if (trees.length) {
    const rand = mulberry32(level.seed + 404);
    const cards = new Cards();
    const right = new THREE.Vector3(), up = new THREE.Vector3();
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + rand();
      right.set(Math.cos(a), 0, Math.sin(a));
      up.set(-Math.sin(a) * 0.35, 1, Math.cos(a) * 0.35).normalize();
      cards.add(new THREE.Vector3(Math.cos(a + 1.2) * 0.35, -0.1, Math.sin(a + 1.2) * 0.35), up, right, 1.9, 1.5);
    }
    const tex = keep(makeTwigTexture(808, 0.45, LEAF_RUST));
    const mat = sway(new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.25, alphaToCoverage: true, roughness: 1 }));
    const spots = [];
    for (const t of trees) {
      const n = rand() < 0.75 ? (rand() < 0.4 ? 2 : 1) : 0;
      for (let i = 0; i < n; i++) {
        const a = rand() * Math.PI * 2, d = 1.2 + rand() * 2.6;
        const x = t.position[0] + Math.cos(a) * d, z = t.position[2] + Math.sin(a) * d;
        if (Math.hypot(x - level.spawn.position[0], z - level.spawn.position[2]) < 12) continue;
        spots.push([x, level.terrain.heightAt(x, z), z, 0.55 + rand() * 0.6, rand() * 6.28, 0.7 + rand() * 0.4]);
      }
    }
    const scrub = addMesh(cards.build(), mat, spots.length, false);
    spots.forEach(([x, y, z, sc, yaw, c], i) => {
      m4.compose(p.set(x, y, z), q.setFromAxisAngle(UP, yaw), s.set(sc * 1.1, sc, sc * 1.1));
      scrub.setMatrixAt(i, m4);
      scrub.setColorAt(i, col.setRGB(c, c * 0.97, c * 0.9));
    });
    scrub.count = spots.length;
    scrub.frustumCulled = true;
    scrub.computeBoundingSphere();
  }

  let lodClock = 1;
  function refreshLod(cam, zoom) {
    for (const tpl of templates) {
      if (!tpl.list.length) continue;
      let changed = tpl.dirty;
      for (const t of tpl.list) {
        const d = Math.hypot(t.x - cam.x, t.z - cam.z, cam.y * 0.5) * zoom;
        const near = t.near ? d < NEAR_DIST + LOD_HYSTERESIS : d < NEAR_DIST;
        if (near !== t.near) { t.near = near; changed = true; }
      }
      if (!changed) continue;
      tpl.dirty = false;
      let nn = 0, nf = 0;
      for (const t of tpl.list) {
        const wood = t.near ? tpl.nearWood : tpl.farWood, crown = t.near ? tpl.nearCrown : tpl.farCrown;
        const i = t.near ? nn++ : nf++;
        wood.setMatrixAt(i, t.matrix); wood.setColorAt(i, t.wood);
        crown.setMatrixAt(i, t.matrix); crown.setColorAt(i, t.crown);
      }
      tpl.nearWood.count = tpl.nearCrown.count = nn;
      tpl.farWood.count = tpl.farCrown.count = nf;
      for (const m of [tpl.nearWood, tpl.nearCrown, tpl.farWood, tpl.farCrown]) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    }
  }

  return {
    update(time, camPos, dt = 0.016, zoom = 1) {
      timeU.value = time;
      lodClock += dt;
      if (lodClock > 0.2) { lodClock = 0; refreshLod(camPos, zoom); }
    },
    dispose() { meshes.forEach((m) => { scene.remove(m); m.dispose(); }); disposables.forEach((d) => d.dispose()); },
  };
}
