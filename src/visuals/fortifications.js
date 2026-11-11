// Field fortifications from level.props: zig-zag trenches with plank revetments and spoil banks,
// log-and-earth dugouts under camo nets (some caved in by hits), antenna masts with guy lines,
// and the inside of the player's own dugout: log walls, a table with the goggles, the radio and a
// laptop, a lamp, spare drones and the other soldier on the bench.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './rng.js';
import { canvasTexture, makePlankTexture, makeBarkTextures } from './textures.js';
import { dugoutBoxes, DUGOUT_WALL, DUGOUT_DOOR, DUGOUT_OPEN_REAR } from '../sim/propColliders.js';
import { createSoldierFactory } from './soldierModel.js';
import { initSoldierAnim, animateCrew } from './soldierAnim.js';
import { createDrone } from './drone.js';

const BANK = 1.5;        // how far an earth bank runs out beyond a dugout wall
const TRENCH_BERM = 0.55; // spoil heaped either side of a trench
const TRENCH_SPOIL = 1.5;

// Camo net: knotted mesh with burlap and leaf garnish, holes see-through (alpha test).
function netTexture(seed, burnt) {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d'), rand = mulberry32(seed);
  g.clearRect(0, 0, S, S);
  const pal = burnt ? ['#2b2a24', '#3a362b', '#1d1c18', '#4a4436'] : ['#4b5233', '#5d5a3a', '#3a4229', '#6e6444', '#2f3522', '#56603a'];
  // Garnish: irregular leaf patches, denser in clumps.
  for (let i = 0; i < 520; i++) {
    const x = rand() * S, y = rand() * S, r = 4 + rand() * 11;
    g.fillStyle = pal[Math.floor(rand() * pal.length)];
    g.beginPath();
    const n = 5 + Math.floor(rand() * 4);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, rr = r * (0.5 + rand() * 0.7);
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr * 0.7;
      k ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.fill();
    for (const [dx, dy] of [[S, 0], [-S, 0], [0, S], [0, -S]]) { g.save(); g.translate(dx, dy); g.fill(); g.restore(); }
  }
  // Cut holes so the light comes through in specks.
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < (burnt ? 260 : 150); i++) {
    const x = rand() * S, y = rand() * S, r = 2 + rand() * (burnt ? 12 : 6);
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // The net cord itself, a diamond mesh.
  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = burnt ? 'rgba(20,20,18,0.9)' : 'rgba(46,48,34,0.95)';
  g.lineWidth = 1.4;
  for (let k = -S; k < S * 2; k += 16) {
    g.beginPath(); g.moveTo(k, 0); g.lineTo(k + S, S); g.stroke();
    g.beginPath(); g.moveTo(k, 0); g.lineTo(k - S, S); g.stroke();
  }
  const t = canvasTexture(c, { repeat: true });
  return t;
}

function mudTexture(seed) {
  const S = 128, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d'), rand = mulberry32(seed);
  g.fillStyle = '#3b3125'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 1400; i++) {
    const v = rand();
    g.fillStyle = v < 0.5 ? `rgba(28,22,15,${0.3 + rand() * 0.4})` : `rgba(92,78,58,${0.15 + rand() * 0.3})`;
    g.fillRect(rand() * S, rand() * S, 1 + rand() * 4, 1 + rand() * 3);
  }
  // Clods and stones.
  for (let i = 0; i < 80; i++) {
    g.fillStyle = `rgba(${110 + rand() * 40 | 0},${100 + rand() * 30 | 0},${80 + rand() * 20 | 0},0.5)`;
    g.beginPath(); g.arc(rand() * S, rand() * S, 0.8 + rand() * 2, 0, 7); g.fill();
  }
  return canvasTexture(c, { repeat: true });
}

// Laptop screen: a dark map with grid squares and a few marks, as the navigator would have.
function screenTexture() {
  const W = 256, H = 160, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d'), rand = mulberry32(5);
  g.fillStyle = '#1f2a1c'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 26; i++) {
    g.fillStyle = `rgba(${60 + rand() * 50 | 0},${80 + rand() * 50 | 0},${40 + rand() * 30 | 0},0.6)`;
    g.fillRect(rand() * W, rand() * H, 20 + rand() * 70, 14 + rand() * 40);
  }
  g.strokeStyle = 'rgba(200,210,190,0.25)'; g.lineWidth = 1;
  for (let x = 0; x < W; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let y = 0; y < H; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.strokeStyle = '#d9c46a'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(10, 120); for (let x = 10; x < W; x += 20) g.lineTo(x, 70 + Math.sin(x * 0.05) * 10); g.stroke();
  for (let i = 0; i < 7; i++) { g.fillStyle = '#e04a3a'; g.beginPath(); g.arc(30 + rand() * 200, 15 + rand() * 50, 3, 0, 7); g.fill(); }
  g.fillStyle = '#5fa8e0'; g.beginPath(); g.arc(128, 140, 4, 0, 7); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, 0, W, 12);
  g.fillStyle = '#cfd6c4'; g.font = '9px monospace'; g.fillText('SQ 41-17   ALT 212   ●REC', 4, 9);
  return canvasTexture(c, {});
}

export function createFortifications({ scene, level }) {
  const pr = level.props ?? {};
  const trenches = pr.trenches ?? [], dugouts = pr.dugouts ?? [], masts = pr.masts ?? [];
  const group = new THREE.Group();
  scene.add(group);
  const disposables = [];
  const keep = (x) => { disposables.push(x); return x; };
  if (!trenches.length && !dugouts.length && !masts.length) {
    return { update() {}, dispose() { scene.remove(group); } };
  }
  const H = (x, z) => level.terrain.heightAt(x, z);
  const rand = mulberry32(level.seed * 7 + 3);

  // ---- Materials ---------------------------------------------------------------------------
  const mudMap = keep(mudTexture(11));
  const earth = keep(new THREE.MeshStandardMaterial({ map: mudMap, vertexColors: true, roughness: 1 }));
  const floorMat = keep(new THREE.MeshStandardMaterial({ map: mudMap, color: 0x6a5f50, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  const plankMap = keep(makePlankTexture());
  const plank = keep(new THREE.MeshStandardMaterial({ map: plankMap, color: 0x8a8070, roughness: 0.95, side: THREE.DoubleSide }));
  const bark = makeBarkTextures('rough');
  keep(bark.map); keep(bark.normalMap);
  const logMat = keep(new THREE.MeshStandardMaterial({ map: bark.map, normalMap: bark.normalMap, color: 0x8c7a66, roughness: 0.95 }));
  const steel = keep(new THREE.MeshStandardMaterial({ color: 0x3c4236, roughness: 0.55, metalness: 0.5 }));
  const black = keep(new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 }));
  const lineMat = keep(new THREE.LineBasicMaterial({ color: 0x1b1b19 }));
  const netMats = [false, true].map((burnt) => {
    const map = keep(netTexture(burnt ? 92 : 91, burnt));
    map.repeat.set(1, 1);
    return keep(new THREE.MeshStandardMaterial({ map, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1 }));
  });

  // ---- Trenches ----------------------------------------------------------------------------
  // Each run: a mud floor, plank-and-post walls up to the spoil banks either side.
  {
    const floor = [], walls = [], banks = [];
    const bankCol = [];
    const v = (arr, ...p) => arr.push(...p);
    for (const t of trenches) {
      const P = t.points, hw = t.width / 2;
      for (let i = 0; i < P.length - 1; i++) {
        const [x0, , z0] = P[i], [x1, , z1] = P[i + 1];
        const len = Math.hypot(x1 - x0, z1 - z0);
        if (len < 0.01) continue;
        // Overlap the ends a little so the zig-zag corners close.
        const dx = (x1 - x0) / len, dz = (z1 - z0) / len, nx = -dz, nz = dx, ext = hw;
        const ax = x0 - dx * ext, az = z0 - dz * ext, bx = x1 + dx * ext, bz = z1 + dz * ext;
        const g = (x, z) => H(x, z);
        for (const s of [-1, 1]) {
          // Inner edge (top of the wall) and outer toe of the bank.
          const ix0 = ax + nx * hw * s, iz0 = az + nz * hw * s, ix1 = bx + nx * hw * s, iz1 = bz + nz * hw * s;
          const ox0 = ax + nx * (hw + TRENCH_SPOIL) * s, oz0 = az + nz * (hw + TRENCH_SPOIL) * s;
          const ox1 = bx + nx * (hw + TRENCH_SPOIL) * s, oz1 = bz + nz * (hw + TRENCH_SPOIL) * s;
          const top0 = g(ix0, iz0) + TRENCH_BERM * (0.8 + rand() * 0.4), top1 = g(ix1, iz1) + TRENCH_BERM * (0.8 + rand() * 0.4);
          const bot0 = g(ix0, iz0) - 0.05, bot1 = g(ix1, iz1) - 0.05;
          // Bank (two triangles), wound so it faces outwards/up.
          const quad = s > 0
            ? [[ix0, top0, iz0], [ox0, g(ox0, oz0) - 0.08, oz0], [ox1, g(ox1, oz1) - 0.08, oz1], [ix1, top1, iz1]]
            : [[ix0, top0, iz0], [ix1, top1, iz1], [ox1, g(ox1, oz1) - 0.08, oz1], [ox0, g(ox0, oz0) - 0.08, oz0]];
          const [A, B, C, D] = quad;
          v(banks, ...A, ...B, ...C, ...A, ...C, ...D);
          const shade = 0.75 + rand() * 0.3;
          for (let k = 0; k < 6; k++) bankCol.push(shade, shade * 0.97, shade * 0.92);
          // Revetment wall: inner face, from the floor up to the bank top.
          const W = s < 0
            ? [[ix0, bot0, iz0], [ix1, bot1, iz1], [ix1, top1, iz1], [ix0, top0, iz0]]
            : [[ix1, bot1, iz1], [ix0, bot0, iz0], [ix0, top0, iz0], [ix1, top1, iz1]];
          v(walls, ...W[0], ...W[1], ...W[2], ...W[0], ...W[2], ...W[3]);
        }
        const f = [[ax - nx * hw, az - nz * hw], [ax + nx * hw, az + nz * hw], [bx + nx * hw, bz + nz * hw], [bx - nx * hw, bz - nz * hw]]
          .map(([x, z]) => [x, g(x, z) + 0.04, z]);
        v(floor, ...f[0], ...f[1], ...f[2], ...f[0], ...f[2], ...f[3]);
      }
    }
    const mk = (pos, mat, uvScale, colors) => {
      if (!pos.length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      // World-space planar UVs (x/z for floors and banks, along-wall for revetments).
      const uv = [];
      for (let i = 0; i < pos.length; i += 3) uv.push((pos[i] + pos[i + 2]) * uvScale, pos[i + 1] * uvScale + (pos[i] - pos[i + 2]) * 0.02);
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      if (colors) geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(keep(geo), mat);
      m.receiveShadow = true; m.castShadow = mat !== floorMat;
      group.add(m);
    };
    mk(banks, earth, 0.35, bankCol);
    mk(walls, plank, 0.6);
    mk(floor, floorMat, 0.5);
  }

  // ---- Logs (instanced): dugout walls, roofs and corner posts --------------------------------
  const logs = [];
  const LOG_R = 0.11;
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const toWorld = (d, lx, ly, lz) => {
    const c = Math.cos(d.yaw), s = Math.sin(d.yaw);
    return p.set(d.x + lx * c + lz * s, d.y + ly, d.z - lx * s + lz * c);
  };
  // A log along local X (or Z) through (lx, ly, lz), `len` long.
  const log = (d, lx, ly, lz, len, alongZ, r = LOG_R, tilt = 0) => {
    toWorld(d, lx, ly, lz);
    q.setFromEuler(e.set(tilt, d.yaw + (alongZ ? Math.PI / 2 : 0) + (rand() - 0.5) * 0.03, 0, 'YXZ'));
    logs.push(new THREE.Matrix4().compose(p.clone(), q.clone(), sc.set(len, r * (0.9 + rand() * 0.2), r * (0.9 + rand() * 0.2)).clone()));
  };

  // ---- Earth banks + roof mound per dugout (one merged mesh) ---------------------------------
  const earthGeos = [], nets = [[], []];
  for (const d of dugouts) buildDugout(d);

  function buildDugout(d) {
    const t = DUGOUT_WALL, hw = d.w / 2, hd = d.d / 2;
    const h = d.collapsed ? d.h * 0.55 : d.h;
    // Inside faces of the walls: stacked horizontal logs.
    const rows = Math.max(3, Math.floor(h / (LOG_R * 2)));
    for (let r = 0; r < rows; r++) {
      const y = LOG_R + r * LOG_R * 2;
      log(d, 0, y, -hd - LOG_R, d.w + 0.3, false);
      log(d, -hw - LOG_R, y, 0, d.d + 0.3, true);
      log(d, hw + LOG_R, y, 0, d.d + 0.3, true);
      const [g0, g1] = DUGOUT_DOOR;
      log(d, (-hw - 0.15 + g0) / 2, y, hd + LOG_R, g0 + hw + 0.15, false);
      log(d, (g1 + hw + 0.15) / 2, y, hd + LOG_R, hw + 0.15 - g1, false);
    }
    // Corner and door posts.
    for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd], [DUGOUT_DOOR[0], hd], [DUGOUT_DOOR[1], hd]]) {
      toWorld(d, lx, h / 2, lz);
      logs.push(new THREE.Matrix4().compose(p.clone(), q.setFromEuler(e.set(0, 0, Math.PI / 2)).clone(), sc.set(h + 0.1, 0.1, 0.1).clone()));
    }
    // Roof: logs across the room (along X), laid side by side from the front wall back.
    const z0 = -hd - t * 0.5, z1 = hd - DUGOUT_OPEN_REAR;
    let i = 0;
    for (let z = z0; z <= z1; z += LOG_R * 2.1, i++) {
      const sag = d.collapsed ? -Math.max(0, Math.sin((z - z0) / (z1 - z0) * Math.PI)) * 0.7 : 0;
      log(d, 0, h + LOG_R + sag * (0.5 + rand()), z, d.w + t * 1.5, false, LOG_R, d.collapsed ? (rand() - 0.5) * 0.5 : 0);
    }
    // Lintel over the open rear part (holds the net up) and its two posts.
    if (!d.collapsed) log(d, 0, h + 0.5, hd + 0.05, d.w + 0.4, false, 0.08);

    // Earth: bank round the outside of the walls, and the earth heaped on the roof.
    const geo = earthMound(d, h);
    earthGeos.push(geo);
    if (d.net) nets[d.collapsed ? 1 : 0].push(netGeo(d, h));
  }

  // A ring-shaped bank from the wall top out to the ground, with a mound over the roofed part.
  function earthMound(d, h) {
    const t = DUGOUT_WALL, hw = d.w / 2 + t, hd = d.d / 2 + t;
    const N = 28; // grid over the whole footprint incl. the bank
    const W = (hw + BANK) * 2, D = (hd + BANK) * 2;
    const g = new THREE.PlaneGeometry(W, D, N, N).rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    const col = [];
    const r = mulberry32(Math.round(d.x * 13 + d.z * 7));
    const roofZ1 = d.d / 2 - DUGOUT_OPEN_REAR;
    const c = Math.cos(d.yaw), s = Math.sin(d.yaw);
    const keepTri = [];
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i), lz = pos.getZ(i);
      // Distance outside the outer wall rectangle.
      const ox = Math.max(0, Math.abs(lx) - hw), oz = Math.max(0, Math.abs(lz) - hd);
      const out = Math.hypot(ox, oz);
      const wx = d.x + lx * c + lz * s, wz = d.z - lx * s + lz * c;
      const ground = H(wx, wz) - d.y;
      let y;
      const inRoom = Math.abs(lx) < d.w / 2 && Math.abs(lz) < d.d / 2;
      if (out > 0) {
        const k = Math.min(1, out / BANK);
        y = (h + 0.15) * (1 - k * k * (3 - 2 * k)) + (ground - 0.12) * k;
      } else if (lz < roofZ1 + 0.1 || !inRoom) {
        // Over the roof: a rounded mound of earth on the logs.
        const nx = lx / hw, nz = (lz - (-hd + roofZ1) / 2) / (hd + roofZ1);
        y = h + 0.24 + 0.35 * Math.max(0, 1 - nx * nx - nz * nz * 0.6) + (d.collapsed ? -0.25 : 0);
      } else {
        y = -10; // open rear: no earth (triangles dropped below)
      }
      y += (r() - 0.5) * 0.08;
      pos.setY(i, y);
      const k = 0.7 + r() * 0.35;
      col.push(k, k * 0.96, k * 0.9);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    // Drop the triangles over the open rear part and the doorway.
    const idx = g.index.array, kept = [];
    for (let i = 0; i < idx.length; i += 3) {
      const tri = [idx[i], idx[i + 1], idx[i + 2]];
      if (tri.some((v) => pos.getY(v) < -5)) continue;
      // Doorway cut: a notch through the rear bank.
      const mx = (pos.getX(tri[0]) + pos.getX(tri[1]) + pos.getX(tri[2])) / 3;
      const mz = (pos.getZ(tri[0]) + pos.getZ(tri[1]) + pos.getZ(tri[2])) / 3;
      if (mz > d.d / 2 - 0.1 && mx > DUGOUT_DOOR[0] - 0.05 && mx < DUGOUT_DOOR[1] + 0.05) continue;
      kept.push(...tri);
    }
    g.setIndex(kept);
    g.rotateY(d.yaw);
    g.translate(d.x, d.y, d.z);
    g.computeVertexNormals();
    return g;
  }

  // Camo net draped over the dugout on poles, pegged to the ground all round.
  function netGeo(d, h) {
    const t = DUGOUT_WALL;
    const hw = d.w / 2 + t + 0.3, hd = d.d / 2 + t + 0.3;
    const SPREAD = 2.4;
    const W = (hw + SPREAD) * 2, D = (hd + SPREAD) * 2, N = 26;
    const g = new THREE.PlaneGeometry(W, D, N, N).rotateX(-Math.PI / 2);
    const pos = g.attributes.position, uv = g.attributes.uv;
    const r = mulberry32(Math.round(d.x * 31 + d.z * 17 + 5));
    const lumps = Array.from({ length: 6 }, () => [(r() - 0.5) * W * 0.7, (r() - 0.5) * D * 0.7, 0.15 + r() * 0.25]);
    const c = Math.cos(d.yaw), s = Math.sin(d.yaw);
    const top = h + (d.collapsed ? 0.45 : 0.75);
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i), lz = pos.getZ(i);
      const ox = Math.max(0, Math.abs(lx) - hw), oz = Math.max(0, Math.abs(lz) - hd);
      const out = Math.hypot(ox, oz);
      const k = Math.min(1, out / SPREAD);
      let y = top * (1 - k * k * (3 - 2 * k) * 1.02);
      // Sags between the poles, lumps where it lies on things.
      y -= 0.18 * Math.abs(Math.sin(lx * 1.3)) * Math.abs(Math.sin(lz * 1.1)) * (1 - k);
      for (const [bx, bz, a] of lumps) y += a * Math.exp(-((lx - bx) ** 2 + (lz - bz) ** 2) / 1.5) * (1 - k);
      // The flap over the doorway is tied up out of the way.
      const doorX = (DUGOUT_DOOR[0] + DUGOUT_DOOR[1]) / 2;
      if (lz > d.d / 2 && Math.abs(lx - doorX) < 1.1) y = Math.max(y, Math.min(top, 2.15) - Math.max(0, Math.abs(lx - doorX) - 0.6) * 1.2);
      const wx = d.x + lx * c + lz * s, wz = d.z - lx * s + lz * c;
      y = Math.max(y + d.y, H(wx, wz) + 0.06) - d.y;
      pos.setY(i, y);
      uv.setXY(i, lx / 2.2, lz / 2.2);
    }
    let geo = g;
    if (d.collapsed) {
      // Torn: drop chunks of the net.
      const idx = g.index.array, kept = [];
      for (let i = 0; i < idx.length; i += 6) if (r() > 0.3) kept.push(...idx.slice(i, i + 6));
      g.setIndex(kept);
    }
    geo.rotateY(d.yaw);
    geo.translate(d.x, d.y, d.z);
    geo.computeVertexNormals();
    return geo;
  }

  if (earthGeos.length) {
    const merged = keep(mergeGeometries(earthGeos));
    earthGeos.forEach((g) => g.dispose());
    const m = new THREE.Mesh(merged, earth);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  }
  nets.forEach((list, i) => {
    if (!list.length) return;
    const merged = keep(mergeGeometries(list));
    list.forEach((g) => g.dispose());
    const m = new THREE.Mesh(merged, netMats[i]);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  });

  // ---- Antenna masts ---------------------------------------------------------------------------
  const mastParts = [];
  const guyPts = [];
  for (const m of masts) {
    const h = m.height, b = new THREE.Vector3(m.x, m.y, m.z);
    // Telescopic sections, getting thinner.
    const secs = [[0, h * 0.4, 0.045], [h * 0.38, h * 0.72, 0.035], [h * 0.7, h, 0.026]];
    for (const [y0, y1, r] of secs) mastParts.push(new THREE.CylinderGeometry(r, r, y1 - y0, 8).translate(m.x, m.y + (y0 + y1) / 2, m.z));
    // Collars at the joints.
    for (const y of [h * 0.39, h * 0.71]) mastParts.push(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 8).translate(m.x, m.y + y, m.z));
    // Tripod feet.
    for (let k = 0; k < 3; k++) {
      const a = k * 2.094 + 0.3;
      const leg = new THREE.CylinderGeometry(0.02, 0.02, 1.25, 6).rotateZ(0.6).rotateY(a).translate(m.x + Math.cos(a) * 0.32, m.y + 0.45, m.z - Math.sin(a) * 0.32);
      mastParts.push(leg);
    }
    // At the top: whip, a panel antenna facing the front and a small yagi.
    const ty = m.y + h;
    mastParts.push(new THREE.CylinderGeometry(0.008, 0.012, 1.1, 5).translate(m.x, ty + 0.55, m.z));
    mastParts.push(new THREE.BoxGeometry(0.06, 0.06, 0.25).translate(m.x, ty - 0.25, m.z - 0.12)); // bracket
    mastParts.push(new THREE.BoxGeometry(0.34, 0.34, 0.05).rotateX(-0.25).translate(m.x, ty - 0.25, m.z - 0.28));
    mastParts.push(new THREE.CylinderGeometry(0.01, 0.01, 0.9, 5).rotateX(Math.PI / 2).translate(m.x + 0.12, ty - 0.6, m.z - 0.45));
    for (let k = 0; k < 6; k++) mastParts.push(new THREE.CylinderGeometry(0.006, 0.006, 0.28 - k * 0.02, 4).rotateZ(Math.PI / 2).translate(m.x + 0.12, ty - 0.6, m.z - 0.1 - k * 0.14));
    // Guy lines from two heights to three pegs.
    for (let k = 0; k < 3; k++) {
      const a = k * 2.094 + 0.9, R = h * 0.55;
      const gx = m.x + Math.cos(a) * R, gz = m.z - Math.sin(a) * R, gy = H(gx, gz) + 0.05;
      for (const fy of [0.55, 0.92]) guyPts.push(m.x, m.y + h * fy, m.z, gx, gy, gz);
    }
    // Feed cable down the mast and along the ground to the nearest dugout.
    let best = null, bd = 25;
    for (const d of dugouts) { const dd = Math.hypot(d.x - m.x, d.z - m.z); if (dd < bd) { bd = dd; best = d; } }
    if (best) {
      guyPts.push(m.x + 0.05, m.y + h * 0.95, m.z, m.x + 0.05, m.y + 0.05, m.z);
      const N = 10;
      let px = m.x + 0.05, pz = m.z, py = m.y + 0.05;
      for (let k = 1; k <= N; k++) {
        const tt = k / N;
        // Into the dugout over the top of the side bank nearest the mast.
        const ex = best.x + Math.cos(best.yaw) * (best.w / 2 + DUGOUT_WALL * 0.6) * Math.sign((m.x - best.x) * Math.cos(best.yaw) - (m.z - best.z) * Math.sin(best.yaw) || 1);
        const ez = best.z - Math.sin(best.yaw) * (best.w / 2 + DUGOUT_WALL * 0.6) * Math.sign((m.x - best.x) * Math.cos(best.yaw) - (m.z - best.z) * Math.sin(best.yaw) || 1);
        const x = m.x + (ex - m.x) * tt + Math.sin(tt * 9) * 0.25 * (1 - tt), z = m.z + (ez - m.z) * tt;
        const y = Math.max(H(x, z) + 0.03, k === N ? best.y + best.h + 0.2 : H(x, z) + 0.03);
        guyPts.push(px, py, pz, x, y, z);
        px = x; py = y; pz = z;
      }
    }
  }
  if (mastParts.length) {
    const merged = keep(mergeGeometries(mastParts.map((g) => (g.index ? g.toNonIndexed() : g))));
    mastParts.forEach((g) => g.dispose());
    const m = new THREE.Mesh(merged, steel);
    m.castShadow = true;
    group.add(m);
  }
  if (guyPts.length) {
    const g = keep(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(guyPts, 3));
    group.add(new THREE.LineSegments(g, lineMat));
  }

  // ---- Inside the player's dugout ---------------------------------------------------------------
  const home = dugouts.find((d) => d.player);
  let buddy = null, lamp = null, soldiers = null;
  const spares = [];
  if (home) {
    const d = home, hw = d.w / 2, hd = d.d / 2;
    const room = new THREE.Group();
    room.position.set(d.x, d.y, d.z);
    room.rotation.y = d.yaw;
    group.add(room);
    const add = (geo, mat, x, y, z, ry = 0, rx = 0) => {
      const m = new THREE.Mesh(keep(geo), mat);
      m.position.set(x, y, z); m.rotation.set(rx, ry, 0, 'YXZ');
      m.castShadow = m.receiveShadow = true;
      room.add(m);
      return m;
    };
    const darkWood = keep(new THREE.MeshStandardMaterial({ map: plankMap, color: 0x6f6252, roughness: 0.95 }));
    const olive = keep(new THREE.MeshStandardMaterial({ color: 0x47503a, roughness: 0.8 }));
    const crate = keep(new THREE.MeshStandardMaterial({ map: plankMap, color: 0x6e7552, roughness: 0.9 }));
    const plastic = keep(new THREE.MeshStandardMaterial({ color: 0x1e1f1d, roughness: 0.45 }));

    // Duckboard floor.
    for (let k = 0; k < 9; k++) add(new THREE.BoxGeometry(0.13, 0.03, d.d - 0.2), darkWood, -hw + 0.25 + k * 0.34, 0.03, 0);
    for (const z of [-hd + 0.5, 0, hd - 0.5]) add(new THREE.BoxGeometry(d.w - 0.2, 0.04, 0.08), darkWood, 0, 0.01, z);

    // The table along the front wall, where the goggles are.
    const tx = 0.45, tz = -hd + 0.45;
    add(new THREE.BoxGeometry(1.35, 0.045, 0.62), darkWood, tx, 0.76, tz);
    for (const [ox, oz] of [[-0.6, -0.25], [0.6, -0.25], [-0.6, 0.25], [0.6, 0.25]]) add(new THREE.BoxGeometry(0.06, 0.75, 0.06), darkWood, tx + ox, 0.375, tz + oz);
    // Goggles: box body, two lenses, a fabric strap.
    const gog = new THREE.Group();
    gog.position.set(tx + 0.36, 0.83, tz + 0.05); gog.rotation.y = 0.4;
    room.add(gog);
    const gb = new THREE.Mesh(keep(new THREE.BoxGeometry(0.19, 0.075, 0.1)), plastic); gog.add(gb);
    const lens = keep(new THREE.MeshStandardMaterial({ color: 0x0d1418, roughness: 0.1, metalness: 0.7 }));
    for (const x of [-0.045, 0.045]) { const l = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 14).rotateX(Math.PI / 2)), lens); l.position.set(x, 0, 0.055); gog.add(l); }
    const strap = new THREE.Mesh(keep(new THREE.TorusGeometry(0.11, 0.012, 4, 20, Math.PI * 1.3).rotateX(Math.PI / 2)), olive);
    strap.position.set(0, -0.02, -0.05); gog.add(strap);
    const ant = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 5)), plastic); ant.position.set(0.08, 0.07, -0.02); ant.rotation.z = -0.3; gog.add(ant);
    gog.traverse((o) => { o.castShadow = true; });
    // Radio transmitter: body, two gimbals and an antenna.
    const tx2 = new THREE.Group();
    tx2.position.set(tx - 0.05, 0.8, tz + 0.08); tx2.rotation.y = -0.2;
    room.add(tx2);
    tx2.add(new THREE.Mesh(keep(new THREE.BoxGeometry(0.2, 0.045, 0.12)), plastic));
    for (const x of [-0.05, 0.05]) { const st = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.006, 0.006, 0.04, 5)), steel); st.position.set(x, 0.04, 0.01); tx2.add(st); }
    const ta = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.005, 0.007, 0.16, 5)), plastic); ta.position.set(0.07, 0.08, -0.05); ta.rotation.x = -0.4; tx2.add(ta);
    // Laptop with the map up.
    const scr = keep(screenTexture());
    const lap = new THREE.Group();
    lap.position.set(tx - 0.42, 0.785, tz + 0.02); lap.rotation.y = 0.35;
    room.add(lap);
    lap.add(new THREE.Mesh(keep(new THREE.BoxGeometry(0.34, 0.02, 0.24)), plastic));
    const lid = new THREE.Group(); lid.position.set(0, 0.01, -0.12); lid.rotation.x = -0.25; lap.add(lid);
    const back = new THREE.Mesh(keep(new THREE.BoxGeometry(0.34, 0.22, 0.012).translate(0, 0.11, 0)), plastic); lid.add(back);
    const screen = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.31, 0.19).translate(0, 0.11, 0.007)),
      keep(new THREE.MeshBasicMaterial({ map: scr, color: 0xb8c4b0 })));
    lid.add(screen);
    // Powerbank and battery packs, a mug.
    for (let k = 0; k < 3; k++) add(new THREE.BoxGeometry(0.14, 0.05, 0.045), plastic, tx + 0.05 + k * 0.06, 0.81, tz - 0.2, 0.1 * k);
    add(new THREE.CylinderGeometry(0.04, 0.035, 0.09, 12), olive, tx + 0.55, 0.83, tz - 0.18);

    // Bench along the west wall (where the other soldier sits) and one along the east wall.
    const bench = (x, z0, z1) => {
      add(new THREE.BoxGeometry(0.34, 0.05, z1 - z0), darkWood, x, 0.45, (z0 + z1) / 2);
      for (const z of [z0 + 0.15, z1 - 0.15]) add(new THREE.BoxGeometry(0.3, 0.43, 0.06), darkWood, x, 0.215, z);
    };
    bench(-hw + 0.22, -hd + 0.25, 0.7);
    // Ammo crates and drone boxes stacked at the back.
    const crateAt = (x, y, z, w, h, dd, ry) => add(new THREE.BoxGeometry(w, h, dd), crate, x, y + h / 2, z, ry);
    crateAt(hw - 0.35, 0, hd - 0.45, 0.6, 0.32, 0.4, 0.05);
    crateAt(hw - 0.35, 0.32, hd - 0.45, 0.55, 0.28, 0.38, -0.08);
    crateAt(hw - 0.3, 0, 0.0, 0.5, 0.4, 0.62, 0.02);
    crateAt(-hw + 0.3, 0, hd - 0.4, 0.45, 0.3, 0.5, 0.2);
    // Jerry can and a sleeping mat rolled up.
    add(new THREE.BoxGeometry(0.17, 0.46, 0.34), olive, -hw + 0.32, 0.23, hd - 1.0, 0.1);
    add(new THREE.CylinderGeometry(0.11, 0.11, 0.62, 12).rotateZ(Math.PI / 2), olive, hw - 0.4, 0.73, hd - 0.45);

    // Spare drones on the crates: the real model, parked.
    for (const [x, y, z, ry] of [[hw - 0.3, 0.42, 0.0, 0.3], [hw - 0.38, 0.62, hd - 0.42, -0.4]]) {
      const dr = createDrone({ scene: room });
      dr.group.position.set(x, y + 0.04, z);
      dr.group.rotation.y = ry;
      dr.group.scale.setScalar(0.999);
      spares.push(dr);
    }

    // A bulb on a wire under the roof, and its warm light.
    const bulb = new THREE.Mesh(keep(new THREE.SphereGeometry(0.035, 10, 8)), keep(new THREE.MeshBasicMaterial({ color: 0xffd9a0 })));
    bulb.position.set(0.1, d.h - 0.25, -0.4);
    room.add(bulb);
    const wire = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.004, 0.004, 0.22, 4)), plastic);
    wire.position.set(0.1, d.h - 0.13, -0.4); room.add(wire);
    lamp = new THREE.PointLight(0xffc98a, 2.2, 6, 1.6);
    lamp.position.copy(bulb.position).y -= 0.05;
    room.add(lamp);

    // The other soldier: on the bench with a tablet, keeping an eye on the map.
    soldiers = createSoldierFactory();
    buddy = soldiers.make('rifleman', 4242, { friendly: true });
    initSoldierAnim(buddy);
    buddy.root.position.set(-hw + 0.24, 0.45 - 0.86, -0.55);
    buddy.root.rotation.y = -Math.PI / 2 + 0.35; // faces east, turned towards the table
    room.add(buddy.root);
    const tab = new THREE.Mesh(keep(new THREE.BoxGeometry(0.24, 0.012, 0.17)), plastic);
    const tabScreen = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.22, 0.15).rotateX(-Math.PI / 2).translate(0, 0.007, 0)), keep(new THREE.MeshBasicMaterial({ map: scr, color: 0x9fac98 })));
    tab.add(tabScreen);
    tab.position.set(0, 0.06, -0.42); tab.rotation.x = 0.75;
    buddy.bones.chest.add(tab);
  }

  // ---- Logs mesh ------------------------------------------------------------------------------
  if (logs.length) {
    const geo = keep(new THREE.CylinderGeometry(1, 1, 1, 9, 1).rotateZ(Math.PI / 2));
    const im = new THREE.InstancedMesh(geo, logMat, logs.length);
    logs.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = im.receiveShadow = true;
    group.add(im);
    disposables.push({ dispose: () => im.dispose() });
  }

  let t = 0;
  return {
    update(dt, camPos) {
      t += dt;
      if (buddy) {
        // Only animate him when we could see him.
        const near = camPos.distanceToSquared(buddy.root.getWorldPosition(p)) < 60 * 60;
        if (near) animateCrew(buddy, { dt, mode: 'gunner', alert: false, seated: true });
      }
      if (lamp) lamp.intensity = 2.2 * (0.96 + 0.04 * Math.sin(t * 13) * Math.sin(t * 3.1));
    },
    dispose() {
      scene.remove(group);
      spares.forEach((s) => s.dispose());
      soldiers?.dispose();
      disposables.forEach((x) => x.dispose());
    },
  };
}
