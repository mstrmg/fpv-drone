// Front-line set dressing: old shell craters with spoil rims and rainwater, telegraph poles with
// sagging wires along the lanes (some snapped), broken fences round the houses, round hay bales in
// the fields and sandbagged fighting positions. Placement comes from propLayout.js (shared with the
// sim through `level.props`, so the same objects can have colliders).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './rng.js';
import { canvasTexture } from './textures.js';
import { propLayout } from './propLayout.js';

function strawTexture() {
  const S = 128, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d'), rand = mulberry32(61);
  g.fillStyle = '#8c7a4f'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) {
    g.strokeStyle = `rgba(${rand() < 0.5 ? '170,150,100' : '90,75,48'},${0.3 + rand() * 0.4})`;
    g.lineWidth = 1;
    const x = rand() * S, y = rand() * S;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + 6 + rand() * 12, y + (rand() - 0.5) * 3); g.stroke();
  }
  return canvasTexture(c, { repeat: true });
}

export function createProps({ scene, level, terrain }) {
  const L = level.props ?? propLayout(level);
  const H = (x, z) => level.terrain.heightAt(x, z);
  const disposables = [];
  const keep = (x) => { disposables.push(x); return x; };
  const group = new THREE.Group();
  scene.add(group);
  const q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const nrm = new THREE.Vector3(), upV = new THREE.Vector3(0, 1, 0);
  const normalAt = (x, z) => nrm.set(H(x - 1, z) - H(x + 1, z), 2, H(x, z - 1) - H(x, z + 1)).normalize();
  const M = (pos, quat, scl) => new THREE.Matrix4().compose(pos, quat, scl);
  const instanced = (geo, mat, list, shadow = true) => {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((mtx, i) => im.setMatrixAt(i, mtx));
    im.castShadow = shadow; im.receiveShadow = true;
    group.add(im);
    return im;
  };

  // Craters.
  const soil = keep(new THREE.MeshStandardMaterial({ color: 0x3a3126, roughness: 1 }));
  const water = keep(new THREE.MeshStandardMaterial({ color: 0x16150f, roughness: 0.06, metalness: 0.1 }));
  const rimGeo = keep(new THREE.TorusGeometry(1, 0.3, 6, 20).rotateX(Math.PI / 2));
  const poolGeo = keep(new THREE.CircleGeometry(1, 18).rotateX(-Math.PI / 2));
  const rims = [], puddles = [];
  for (const c of L.craters) {
    terrain.scorch(c.x, c.z, c.r * 1.3);
    q.setFromUnitVectors(upV, normalAt(c.x, c.z));
    rims.push(M(p.set(c.x, c.y + 0.02, c.z), q, s.set(c.r * 0.85, c.rim ?? 0.4, c.r * 0.85)));
    if (c.water) puddles.push(M(p.set(c.x, c.y + 0.035, c.z), q, s.set(c.r * 0.55, 1, c.r * 0.55)));
  }
  instanced(rimGeo, soil, rims);
  instanced(poolGeo, water, puddles, false);

  // Telegraph poles and wires.
  const wood = keep(new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.95 }));
  const poleGeo = keep(mergeGeometries([
    new THREE.CylinderGeometry(0.1, 0.14, 7.5, 7).translate(0, 3.75, 0),
    new THREE.BoxGeometry(1.7, 0.1, 0.1).translate(0, 7.0, 0),
    ...[-0.7, 0, 0.7].map((x) => new THREE.CylinderGeometry(0.03, 0.04, 0.14, 6).translate(x, 7.12, 0)),
  ].map((g) => (g.index ? g.toNonIndexed() : g))));
  instanced(poleGeo, wood, L.poles.map((o) => M(p.set(o.x, o.y, o.z), q.setFromEuler(e.set(...o.rotation)), s.set(1, o.height / 7.5, 1))));
  const wirePts = [];
  for (const w of L.wires) {
    const N = 10;
    for (let k = 0; k < N; k++) {
      for (const t of [k / N, (k + 1) / N]) {
        wirePts.push(w.a[0] + (w.b[0] - w.a[0]) * t, w.a[1] + (w.b[1] - w.a[1]) * t - w.sag * 4 * t * (1 - t), w.a[2] + (w.b[2] - w.a[2]) * t);
      }
    }
  }
  if (wirePts.length) {
    const g = keep(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3));
    group.add(new THREE.LineSegments(g, keep(new THREE.LineBasicMaterial({ color: 0x1a1a18 }))));
  }

  // Fences: a post at the start of each panel and two rails.
  const postGeo = keep(new THREE.BoxGeometry(0.1, 1.3, 0.1).translate(0, 0.55, 0));
  const railGeo = keep(new THREE.BoxGeometry(1, 0.08, 0.03));
  const posts = [], rails = [];
  for (const f of L.fences) {
    const [x0, h0, z0] = f.a, [x1, h1, z1] = f.b;
    posts.push(M(p.set(x0, h0 - 0.1, z0), q.setFromEuler(e.set(0, 0, f.lean)), s.set(1, 1, 1)));
    const yaw = Math.atan2(z1 - z0, x1 - x0), seg = Math.hypot(x1 - x0, z1 - z0);
    for (const ry of [0.45, 0.95]) {
      rails.push(M(p.set((x0 + x1) / 2, (h0 + h1) / 2 + ry, (z0 + z1) / 2), q.setFromEuler(e.set(0, -yaw, Math.atan2(h1 - h0, seg) + f.lean * 0.5)), s.set(seg, 1, 1)));
    }
  }
  instanced(postGeo, wood, posts);
  instanced(railGeo, wood, rails);

  // Hay bales.
  const strawTex = keep(strawTexture());
  const straw = keep(new THREE.MeshStandardMaterial({ map: strawTex, roughness: 1 }));
  const wrap = keep(new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.35 }));
  const baleGeo = keep(new THREE.CylinderGeometry(0.75, 0.75, 1.2, 16).rotateZ(Math.PI / 2));
  const bale = (b) => M(p.set(b.x, b.y, b.z), q.setFromEuler(e.set(0, b.yaw, 0)), s.set(b.radius / 0.75, b.radius / 0.75, b.length / 1.2));
  instanced(baleGeo, straw, L.bales.filter((b) => !b.wrapped).map(bale));
  instanced(baleGeo, wrap, L.bales.filter((b) => b.wrapped).map(bale));

  // Sandbags.
  const bagMat = keep(new THREE.MeshStandardMaterial({ color: 0x6d6450, roughness: 1 }));
  const bagGeo = keep(new THREE.CapsuleGeometry(0.15, 0.32, 3, 8).rotateZ(Math.PI / 2).scale(1, 0.65, 1));
  instanced(bagGeo, bagMat, L.sandbags.map((b) => M(p.set(b.x, b.y, b.z), q.setFromEuler(e.set(0, b.yaw, b.roll ?? 0)), s.set(1, 1, 1))));

  return {
    dispose() {
      scene.remove(group);
      group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
      disposables.forEach((d) => d.dispose());
    },
  };
}
