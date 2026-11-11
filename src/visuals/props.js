// Front-line set dressing, visual only (no collision): old shell craters with spoil rims and
// rainwater, telegraph poles with sagging wires along the lanes (some snapped), broken fences round
// the houses, round hay bales in the fields and sandbagged fighting positions.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './rng.js';
import { canvasTexture } from './textures.js';

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
  const rand = mulberry32(4242);
  const H = (x, z) => level.terrain.heightAt(x, z);
  const half = level.terrain.size / 2;
  const disposables = [];
  const keep = (x) => { disposables.push(x); return x; };
  const group = new THREE.Group();
  scene.add(group);
  const buildings = level.objects.filter((o) => o.kind === 'building');
  const trees = level.objects.filter((o) => o.kind === 'tree');
  const sp = level.spawn.position;
  const clear = (x, z, r) => {
    if (Math.abs(x) > half - 10 || Math.abs(z) > half - 10) return false;
    if (Math.hypot(x - sp[0], z - sp[2]) < 18) return false;
    for (const b of buildings) if (Math.hypot(x - b.position[0], z - b.position[2]) < Math.max(b.size[0], b.size[2]) * 0.8 + r + 4) return false;
    for (const t of trees) if (Math.hypot(x - t.position[0], z - t.position[2]) < (t.radius ?? 2) + r + 1) return false;
    return true;
  };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const nrm = new THREE.Vector3(), upV = new THREE.Vector3(0, 1, 0);
  const normalAt = (x, z) => nrm.set(H(x - 1, z) - H(x + 1, z), 2, H(x, z - 1) - H(x, z + 1)).normalize();
  const instanced = (geo, mat, list, shadow = true) => {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((mtx, i) => im.setMatrixAt(i, mtx));
    im.castShadow = shadow; im.receiveShadow = true;
    group.add(im);
    return im;
  };

  // ---- Shell craters: churned soil painted into the ground, a spoil rim, sometimes rainwater ----
  const soil = keep(new THREE.MeshStandardMaterial({ color: 0x3a3126, roughness: 1 }));
  const water = keep(new THREE.MeshStandardMaterial({ color: 0x16150f, roughness: 0.06, metalness: 0.1 }));
  const rimGeo = keep(new THREE.TorusGeometry(1, 0.3, 6, 20).rotateX(Math.PI / 2));
  const poolGeo = keep(new THREE.CircleGeometry(1, 18).rotateX(-Math.PI / 2));
  const rims = [], puddles = [];
  for (let i = 0, tries = 0; i < 46 && tries < 600; tries++) {
    // Clustered, as artillery falls.
    const cx = (rand() - 0.5) * 520, cz = (rand() - 0.5) * 520;
    for (let k = 0, n = 1 + Math.floor(rand() * 4); k < n; k++) {
      const x = cx + (rand() - 0.5) * 30, z = cz + (rand() - 0.5) * 30, r = 1.6 + rand() * 3;
      if (!clear(x, z, r)) continue;
      i++;
      terrain.scorch(x, z, r * 1.3);
      q.setFromUnitVectors(upV, normalAt(x, z));
      rims.push(new THREE.Matrix4().compose(p.set(x, H(x, z) + 0.02, z), q, s.set(r * 0.85, 0.32 + rand() * 0.2, r * 0.85)));
      if (rand() < 0.4) puddles.push(new THREE.Matrix4().compose(p.set(x, H(x, z) + 0.035, z), q, s.set(r * 0.55, 1, r * 0.55)));
    }
  }
  instanced(rimGeo, soil, rims);
  instanced(poolGeo, water, puddles, false);

  // ---- Telegraph poles and wires along the lanes; war has snapped a few ----
  const wood = keep(new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.95 }));
  const poleGeo = keep(mergeGeometries([
    new THREE.CylinderGeometry(0.1, 0.14, 7.5, 7).translate(0, 3.75, 0),
    new THREE.BoxGeometry(1.7, 0.1, 0.1).translate(0, 7.0, 0),
    ...[-0.7, 0, 0.7].map((x) => new THREE.CylinderGeometry(0.03, 0.04, 0.14, 6).translate(x, 7.12, 0)),
  ].map((g) => (g.index ? g.toNonIndexed() : g))));
  const poles = [], wirePts = [];
  for (const pts of terrain.tracks ?? []) {
    for (let si = 0; si < pts.length - 1; si++) {
      const [ax, az] = pts[si], [bx, bz] = pts[si + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 60) continue;
      const dx = (bx - ax) / len, dz = (bz - az) / len, ox = -dz * 5, oz = dx * 5;
      const yaw = Math.atan2(dx, dz);
      let prev = null;
      for (let d = 20; d < len - 10; d += 42) {
        const x = ax + dx * d + ox, z = az + dz * d + oz;
        if (Math.abs(x) > half - 5 || Math.abs(z) > half - 5) { prev = null; continue; }
        const snapped = rand() < 0.08;
        const lean = snapped ? 0.4 + rand() * 0.9 : (rand() - 0.5) * 0.08;
        const y = H(x, z) - 0.3;
        e.set(lean * Math.cos(yaw), yaw, lean * Math.sin(yaw));
        q.setFromEuler(e);
        const mtx = new THREE.Matrix4().compose(p.set(x, y, z), q, s.set(1, snapped ? 0.55 : 1, 1));
        poles.push(mtx);
        if (snapped) { prev = null; continue; }
        // Wire ends at the insulators, in world space.
        const ends = [-0.7, 0, 0.7].map((wx) => new THREE.Vector3(wx, 7.15, 0).applyMatrix4(mtx));
        if (prev) {
          for (let w = 0; w < 3; w++) {
            const A = prev[w], B = ends[w], N = 10, sag = 0.7 + rand() * 0.3;
            for (let k = 0; k < N; k++) {
              const t0 = k / N, t1 = (k + 1) / N;
              const P0 = A.clone().lerp(B, t0), P1 = A.clone().lerp(B, t1);
              P0.y -= sag * 4 * t0 * (1 - t0); P1.y -= sag * 4 * t1 * (1 - t1);
              wirePts.push(P0.x, P0.y, P0.z, P1.x, P1.y, P1.z);
            }
          }
        }
        prev = ends;
      }
    }
  }
  instanced(poleGeo, wood, poles);
  if (wirePts.length) {
    const g = keep(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3));
    const lines = new THREE.LineSegments(g, keep(new THREE.LineBasicMaterial({ color: 0x1a1a18 })));
    group.add(lines);
  }

  // ---- Fences round the houses: posts, two rails, gaps where they have been knocked down ----
  const fencePosts = [], fenceRails = [];
  const postGeo = keep(new THREE.BoxGeometry(0.1, 1.3, 0.1).translate(0, 0.55, 0));
  const railGeo = keep(new THREE.BoxGeometry(1, 0.08, 0.03));
  for (const b of buildings) {
    if (b.size[1] > 9) continue;
    const ry = b.rotationY ?? 0, cos = Math.cos(ry), sin = Math.sin(ry);
    const hw = b.size[0] / 2 + 4 + rand() * 2, hd = b.size[2] / 2 + 4 + rand() * 3;
    const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
    for (let c = 0; c < 4; c++) {
      const [x0, z0] = corners[c], [x1, z1] = corners[(c + 1) % 4];
      const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 2.4));
      for (let k = 0; k < n; k++) {
        if (c === 0 && Math.abs(k - n / 2) < 1.2) continue; // gate
        if (rand() < 0.18) continue; // knocked down
        const t0 = k / n, t1 = (k + 1) / n;
        const lx0 = x0 + (x1 - x0) * t0, lz0 = z0 + (z1 - z0) * t0, lx1 = x0 + (x1 - x0) * t1, lz1 = z0 + (z1 - z0) * t1;
        const wx0 = b.position[0] + lx0 * cos + lz0 * sin, wz0 = b.position[2] - lx0 * sin + lz0 * cos;
        const wx1 = b.position[0] + lx1 * cos + lz1 * sin, wz1 = b.position[2] - lx1 * sin + lz1 * cos;
        const lean = rand() < 0.15 ? (rand() - 0.5) * 0.6 : (rand() - 0.5) * 0.06;
        const h0 = H(wx0, wz0), h1 = H(wx1, wz1);
        e.set(0, 0, lean); q.setFromEuler(e);
        fencePosts.push(new THREE.Matrix4().compose(p.set(wx0, h0 - 0.1, wz0), q, s.set(1, 1, 1)));
        const yaw = Math.atan2(wz1 - wz0, wx1 - wx0), seg = Math.hypot(wx1 - wx0, wz1 - wz0);
        for (const ry2 of [0.45, 0.95]) {
          e.set(0, -yaw, Math.atan2(h1 - h0, seg) + lean * 0.5); q.setFromEuler(e);
          fenceRails.push(new THREE.Matrix4().compose(p.set((wx0 + wx1) / 2, (h0 + h1) / 2 + ry2, (wz0 + wz1) / 2), q, s.set(seg, 1, 1)));
        }
      }
    }
  }
  instanced(postGeo, wood, fencePosts);
  instanced(railGeo, wood, fenceRails);

  // ---- Round hay bales, some in black silage wrap ----
  const strawTex = keep(strawTexture());
  const straw = keep(new THREE.MeshStandardMaterial({ map: strawTex, roughness: 1 }));
  const wrap = keep(new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.35 }));
  const baleGeo = keep(new THREE.CylinderGeometry(0.75, 0.75, 1.2, 16).rotateZ(Math.PI / 2));
  const bales = [], wrapped = [];
  for (let c = 0, tries = 0; c < 7 && tries < 200; tries++) {
    const cx = (rand() - 0.5) * 460, cz = (rand() - 0.5) * 460;
    if (!clear(cx, cz, 12)) continue;
    c++;
    const blk = rand() < 0.3;
    for (let k = 0, n = 4 + Math.floor(rand() * 8); k < n; k++) {
      const x = cx + (rand() - 0.5) * 24, z = cz + (rand() - 0.5) * 24;
      if (!clear(x, z, 1)) continue;
      q.setFromEuler(e.set(0, rand() * Math.PI, 0));
      (blk ? wrapped : bales).push(new THREE.Matrix4().compose(p.set(x, H(x, z) + 0.68, z), q, s.set(1, 1, 1)));
    }
  }
  instanced(baleGeo, straw, bales);
  instanced(baleGeo, wrap, wrapped);

  // ---- Sandbagged fighting positions ----
  const bagMat = keep(new THREE.MeshStandardMaterial({ color: 0x6d6450, roughness: 1 }));
  const bagGeo = keep(new THREE.CapsuleGeometry(0.15, 0.32, 3, 8).rotateZ(Math.PI / 2).scale(1, 0.65, 1));
  const bags = [];
  for (let c = 0, tries = 0; c < 6 && tries < 200; tries++) {
    const cx = (rand() - 0.5) * 300, cz = (rand() - 0.5) * 300;
    if (!clear(cx, cz, 3)) continue;
    c++;
    const face = rand() * Math.PI * 2, R = 1.5 + rand() * 0.5;
    for (let layer = 0; layer < 3; layer++) {
      for (let a = -1.6; a <= 1.6; a += 0.3) {
        const ang = face + a + (layer % 2) * 0.15, x = cx + Math.sin(ang) * R, z = cz + Math.cos(ang) * R;
        q.setFromEuler(e.set(0, ang + Math.PI / 2, (rand() - 0.5) * 0.1));
        bags.push(new THREE.Matrix4().compose(p.set(x, H(x, z) + 0.1 + layer * 0.19, z), q, s.set(1, 1, 1)));
      }
    }
  }
  instanced(bagGeo, bagMat, bags);

  return {
    dispose() {
      scene.remove(group);
      group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
      disposables.forEach((d) => d.dispose());
    },
  };
}
