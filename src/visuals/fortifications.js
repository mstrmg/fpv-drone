// Field fortifications from level.props: zig-zag trenches with plank revetments and spoil banks,
// log-and-earth dugouts under camo nets (some caved in by hits), antenna masts with guy lines,
// and the inside of the player's own dugout: log walls, a table with the goggles, the radio and a
// laptop, a lamp, spare drones and the other soldier on the bench.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './rng.js';
import { canvasTexture, makePlankTexture, makeBarkTextures } from './textures.js';
import { DUGOUT_WALL, DUGOUT_DOOR, DUGOUT_MOUND, dugoutRampRect } from '../sim/propColliders.js';
import { createSoldierFactory } from './soldierModel.js';
import { initSoldierAnim, animateCrew, animateSoldier, killSoldierAnim, animateDeadSoldier } from './soldierAnim.js';
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

// The overlay on Sasha's TV: his drone's sight and a REC mark, over the live picture.
function tvOverlayTexture() {
  const W = 384, H = 216, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const tex = canvasTexture(c, {});
  // `info`: the bottom line, e.g. the targets' bearing and range from the dugout.
  tex.draw = (info) => { drawTvOverlay(g, W, H, info); tex.needsUpdate = true; };
  tex.draw('');
  return tex;
}

function drawTvOverlay(g, W, H, info) {
  g.clearRect(0, 0, W, H);
  g.strokeStyle = 'rgba(235,240,230,0.8)'; g.lineWidth = 1.5;
  const cx = W / 2, cy = H / 2;
  for (const [x0, y0, x1, y1] of [[cx - 22, cy, cx - 7, cy], [cx + 7, cy, cx + 22, cy], [cx, cy - 22, cx, cy - 7], [cx, cy + 7, cx, cy + 22]]) {
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  }
  // Corner brackets.
  for (const [x, y, sx, sy] of [[14, 14, 1, 1], [W - 14, 14, -1, 1], [14, H - 14, 1, -1], [W - 14, H - 14, -1, -1]]) {
    g.beginPath(); g.moveTo(x, y + sy * 16); g.lineTo(x, y); g.lineTo(x + sx * 16, y); g.stroke();
  }
  g.font = 'bold 12px monospace';
  g.fillStyle = '#e8463a'; g.beginPath(); g.arc(24, 30, 4.5, 0, 7); g.fill();
  g.fillStyle = 'rgba(235,240,230,0.85)';
  g.fillText('REC', 33, 34);
  g.fillText('x16', W - 44, 34);
  g.fillText('ALT 130  BAT 62%', 20, H - 22);
  if (info) { g.font = 'bold 15px monospace'; g.fillStyle = 'rgba(245,245,235,0.95)'; g.fillText(info, W - 20 - g.measureText(info).width, H - 22); }
}

export function createFortifications({ scene, level }) {
  const pr = level.props ?? {};
  const trenches = pr.trenches ?? [], dugouts = pr.dugouts ?? [], masts = pr.masts ?? [];
  const camoNets = pr.camoNets ?? [], mortars = pr.mortars ?? [], friendlies = pr.friendlies ?? [];
  const group = new THREE.Group();
  scene.add(group);
  const disposables = [];
  const keep = (x) => { disposables.push(x); return x; };
  if (!trenches.length && !dugouts.length && !masts.length && !camoNets.length && !mortars.length && !friendlies.length) {
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
  const earthGeos = [], nets = [[], []], rampParts = [], rampFloors = [];
  for (const d of dugouts) buildDugout(d);

  function buildDugout(d) {
    const hw = d.w / 2, hd = d.d / 2;
    if (d.player) buildRoom(d);
    else if (d.collapsed) {
      // Caved in by a hit: roof logs sticking up out of the churned earth.
      for (let k = 0; k < 7; k++) log(d, (rand() - 0.5) * d.w, 0.15 + rand() * 0.25, (rand() - 0.5) * d.d, 1.6 + rand() * 1.8, rand() < 0.5, LOG_R, (rand() - 0.5) * 0.9);
    } else {
      // Ends of the roof logs show at the edge of the mound.
      for (let z = -hd; z <= hd; z += LOG_R * 2.2) log(d, 0, 0.12, z, d.w + 1.2, false);
    }
    earthGeos.push(earthMound(d));
    if (d.net) nets[d.collapsed ? 1 : 0].push(netGeo(d));
  }

  // The player's dugout: a log-lined room dug `depth` m down, a log ceiling at ground level,
  // and a ramp with plank-revetted sides and log steps up from the rear door.
  function buildRoom(d) {
    const hw = d.w / 2, hd = d.d / 2, D = d.depth, y0 = -D;
    const [g0, g1] = DUGOUT_DOOR;
    const rows = Math.floor((D - LOG_R * 2) / (LOG_R * 2));
    for (let r = 0; r < rows; r++) {
      const y = y0 + LOG_R + r * LOG_R * 2;
      log(d, 0, y, -hd - LOG_R, d.w + 0.3, false);
      log(d, -hw - LOG_R, y, 0, d.d + 0.3, true);
      log(d, hw + LOG_R, y, 0, d.d + 0.3, true);
      log(d, (-hw - 0.15 + g0) / 2, y, hd + LOG_R, g0 + hw + 0.15, false);
      log(d, (g1 + hw + 0.15) / 2, y, hd + LOG_R, hw + 0.15 - g1, false);
    }
    for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd], [g0, hd], [g1, hd], [-hw, 0], [hw, 0]]) {
      toWorld(d, lx, y0 + D / 2, lz);
      logs.push(new THREE.Matrix4().compose(p.clone(), q.setFromEuler(e.set(0, 0, Math.PI / 2)).clone(), sc.set(D, 0.1, 0.1).clone()));
    }
    // Ceiling: logs across the room just under the ground, on two beams.
    for (let z = -hd - 0.1; z <= hd + 0.12; z += LOG_R * 2.05) log(d, 0, -LOG_R, z, d.w + 0.6, false);
    for (const x of [-0.6, 0.8]) log(d, x, -LOG_R * 2 - 0.08, 0, d.d + 0.3, true, 0.1);

    // Ramp.
    const [rx0, rz0, rx1, rz1] = dugoutRampRect(d), L = rz1 - rz0;
    const c = Math.cos(d.yaw), s = Math.sin(d.yaw);
    const W = (lx, ly, lz) => [d.x + lx * c + lz * s, d.y + ly, d.z - lx * s + lz * c];
    const quad = (list, a, b, cc, dd) => list.push(...a, ...b, ...cc, ...a, ...cc, ...dd);
    // The pit itself: mud floor and the earth behind the logs (seen through the gaps).
    const ex = hw + LOG_R * 2.2, ez = hd + LOG_R * 2.2;
    quad(rampFloors, W(-ex, y0 + 0.005, -ez), W(-ex, y0 + 0.005, ez), W(ex, y0 + 0.005, ez), W(ex, y0 + 0.005, -ez));
    quad(rampParts, W(-ex, y0, -ez), W(ex, y0, -ez), W(ex, 0, -ez), W(-ex, 0, -ez));
    quad(rampParts, W(-ex, y0, ez), W(-ex, y0, -ez), W(-ex, 0, -ez), W(-ex, 0, ez));
    quad(rampParts, W(ex, y0, -ez), W(ex, y0, ez), W(ex, 0, ez), W(ex, 0, -ez));
    quad(rampParts, W(-ex, y0, ez), W(g0, y0, ez), W(g0, 0, ez), W(-ex, 0, ez));
    quad(rampParts, W(g1, y0, ez), W(ex, y0, ez), W(ex, 0, ez), W(g1, 0, ez));
    const slope = (z) => y0 + (z - rz0) / L * D;
    // Floor (mud) and the side revetments (planks from the floor up to the ground).
    quad(rampFloors, W(rx0, y0 + 0.02, rz0), W(rx0, 0.02, rz1), W(rx1, 0.02, rz1), W(rx1, y0 + 0.02, rz0));
    for (const [x, sgn] of [[rx0, 1], [rx1, -1]]) {
      const N = 6;
      for (let k = 0; k < N; k++) {
        const za = rz0 + (k / N) * L, zb = rz0 + ((k + 1) / N) * L;
        const a = W(x, slope(za) - 0.05, za), b = W(x, slope(zb) - 0.05, zb), cc = W(x, 0.06, zb), dd = W(x, 0.06, za);
        if (sgn > 0) quad(rampParts, a, dd, cc, b); else quad(rampParts, a, b, cc, dd);
      }
      // Posts holding the planks back.
      for (let z = rz0 + 0.4; z < rz1; z += 1.0) {
        toWorld(d, x + sgn * 0.05, (slope(z) + 0.1) / 2, z);
        logs.push(new THREE.Matrix4().compose(p.clone(), q.setFromEuler(e.set(0, 0, Math.PI / 2)).clone(), sc.set(-slope(z) + 0.15, 0.06, 0.06).clone()));
      }
    }
    // Log steps.
    for (let z = rz0 + 0.35; z < rz1 - 0.1; z += 0.42) log(d, (rx0 + rx1) / 2, slope(z) + 0.04, z, rx1 - rx0, false, 0.06);
    // Lintel over the door.
    log(d, (g0 + g1) / 2, -LOG_R * 3, hd + 0.05, g1 - g0 + 0.6, false, 0.1);
  }

  // Earth heaped over the roof: a low mound sloping out to the ground. Over the player's ramp the
  // triangles are dropped so the hole stays open.
  function earthMound(d) {
    const t = DUGOUT_WALL, hw = d.w / 2 + t, hd = d.d / 2 + t, BANKW = 1.5;
    const N = 24;
    const g = new THREE.PlaneGeometry((hw + BANKW) * 2, (hd + BANKW) * 2, N, N).rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    const col = [];
    const r = mulberry32(Math.round(d.x * 13 + d.z * 7));
    const c = Math.cos(d.yaw), s = Math.sin(d.yaw);
    const top = DUGOUT_MOUND * (d.collapsed ? 0.45 : 1);
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i), lz = pos.getZ(i);
      const out = Math.hypot(Math.max(0, Math.abs(lx) - hw * 0.7), Math.max(0, Math.abs(lz) - hd * 0.7));
      const k = Math.min(1, out / (BANKW + hw * 0.3));
      const ground = H(d.x + lx * c + lz * s, d.z - lx * s + lz * c) - d.y;
      let y = top * (1 - k * k * (3 - 2 * k)) + (ground - 0.06) * k * k;
      if (d.collapsed) y -= 0.25 * Math.exp(-(lx * lx + lz * lz) / 2);
      y += (r() - 0.5) * 0.07;
      pos.setY(i, y);
      const sh = 0.7 + r() * 0.35;
      col.push(sh, sh * 0.96, sh * 0.9);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    if (d.player) {
      const [rx0, rz0, rx1] = dugoutRampRect(d);
      const idx = g.index.array, kept = [];
      for (let i = 0; i < idx.length; i += 3) {
        const mx = (pos.getX(idx[i]) + pos.getX(idx[i + 1]) + pos.getX(idx[i + 2])) / 3;
        const mz = (pos.getZ(idx[i]) + pos.getZ(idx[i + 1]) + pos.getZ(idx[i + 2])) / 3;
        if (mz > rz0 - 0.15 && mx > rx0 - 0.25 && mx < rx1 + 0.25) continue;
        kept.push(idx[i], idx[i + 1], idx[i + 2]);
      }
      g.setIndex(kept);
    }
    g.rotateY(d.yaw);
    g.translate(d.x, d.y, d.z);
    g.computeVertexNormals();
    return g;
  }

  // Camo net over the mound, pegged to the ground all round. On the player's dugout it also
  // covers the deep part of the entrance ramp, stretched flat on poles at shoulder height.
  function netGeo(d) {
    const t = DUGOUT_WALL;
    const hw = d.w / 2 + t + 0.4, hd = d.d / 2 + t + 0.4;
    const SPREAD = 1.9;
    const ramp = d.player ? dugoutRampRect(d) : null;
    const rampEnd = ramp ? ramp[1] + (ramp[3] - ramp[1]) * 0.55 : 0;
    const zMax = ramp ? Math.max(hd + SPREAD, rampEnd + 0.4) : hd + SPREAD;
    const W = (hw + SPREAD) * 2, zMin = -hd - SPREAD;
    const N = 26;
    const g = new THREE.PlaneGeometry(W, zMax - zMin, N, N).rotateX(-Math.PI / 2).translate(0, 0, (zMax + zMin) / 2);
    const pos = g.attributes.position, uv = g.attributes.uv;
    const r = mulberry32(Math.round(d.x * 31 + d.z * 17 + 5));
    const lumps = Array.from({ length: 5 }, () => [(r() - 0.5) * W * 0.6, (r() - 0.5) * (zMax - zMin) * 0.6, 0.08 + r() * 0.15]);
    const c = Math.cos(d.yaw), s = Math.sin(d.yaw);
    const top = DUGOUT_MOUND * (d.collapsed ? 0.45 : 1) + 0.22;
    const inBand = (lx) => ramp && lx > ramp[0] - 0.45 && lx < ramp[2] + 0.45;
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i), lz = pos.getZ(i);
      const out = Math.hypot(Math.max(0, Math.abs(lx) - hw), Math.max(0, Math.abs(lz) - hd, lz > 0 && inBand(lx) ? 0 : -1));
      const k = Math.min(1, Math.max(0, out) / SPREAD);
      let y = top * (1 - k * k * (3 - 2 * k)) - 0.04;
      y -= 0.1 * Math.abs(Math.sin(lx * 1.3)) * Math.abs(Math.sin(lz * 1.1)) * (1 - k);
      for (const [bx, bz, a] of lumps) y += a * Math.exp(-((lx - bx) ** 2 + (lz - bz) ** 2) / 1.5) * (1 - k);
      if (ramp && inBand(lx) && lz > ramp[1] - 0.6 && lz < rampEnd + 0.2) {
        // Over the ramp: flat on its poles, sagging a little between them.
        const sag = 0.08 * Math.sin(((lz - ramp[1]) / (rampEnd - ramp[1])) * Math.PI);
        y = Math.max(y, 0.8 - sag - Math.max(0, Math.abs(lx - (ramp[0] + ramp[2]) / 2) - 0.7) * 0.9);
      }
      const wx = d.x + lx * c + lz * s, wz = d.z - lx * s + lz * c;
      y = Math.max(y + d.y, H(wx, wz) + 0.05) - d.y;
      pos.setY(i, y);
      uv.setXY(i, lx / 2.2, lz / 2.2);
    }
    const idx = g.index.array, kept = [];
    for (let i = 0; i < idx.length; i += 3) {
      const tri = [idx[i], idx[i + 1], idx[i + 2]];
      const mx = (pos.getX(tri[0]) + pos.getX(tri[1]) + pos.getX(tri[2])) / 3;
      const mz = (pos.getZ(tri[0]) + pos.getZ(tri[1]) + pos.getZ(tri[2])) / 3;
      if (ramp && mz > rampEnd && mx > ramp[0] - 0.3 && mx < ramp[2] + 0.3) continue; // the way out stays open
      if (d.collapsed && r() < 0.3) continue;                                            // torn
      kept.push(...tri);
    }
    g.setIndex(kept);
    g.rotateY(d.yaw);
    g.translate(d.x, d.y, d.z);
    g.computeVertexNormals();
    return g;
  }

  // Camo nets thrown over a vehicle: a flat top on poles, draped down to the ground all round, lumpy.
  function camoNetGeo(n) {
    const SPREAD = 2.6, W = n.w + SPREAD * 2, D = n.d + SPREAD * 2, N = 30;
    const g = new THREE.PlaneGeometry(W, D, N, N).rotateX(-Math.PI / 2);
    const pos = g.attributes.position, uv = g.attributes.uv;
    const r = mulberry32(Math.round(n.x * 13 + n.z * 7));
    const lumps = Array.from({ length: 7 }, () => [(r() - 0.5) * W * 0.8, (r() - 0.5) * D * 0.8, (r() - 0.5) * 0.35]);
    const c = Math.cos(n.yaw), s = Math.sin(n.yaw);
    const base = H(n.x, n.z);
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i), lz = pos.getZ(i);
      const out = Math.hypot(Math.max(0, Math.abs(lx) - n.w / 2), Math.max(0, Math.abs(lz) - n.d / 2));
      const k = Math.min(1, out / SPREAD);
      let y = n.h * (1 - k * k * (3 - 2 * k));
      // Sags between the poles at the corners and centre.
      y -= 0.25 * (1 - k) * Math.abs(Math.sin(lx / n.w * Math.PI)) * Math.abs(Math.sin(lz / n.d * Math.PI * 2));
      for (const [bx, bz, a] of lumps) y += a * Math.exp(-((lx - bx) ** 2 + (lz - bz) ** 2) / 2.5);
      const wx = n.x + lx * c + lz * s, wz = n.z - lx * s + lz * c;
      pos.setY(i, Math.max(base + y, H(wx, wz) + 0.04));
      pos.setX(i, wx); pos.setZ(i, wz);
      uv.setXY(i, lx / 2.2, lz / 2.2);
    }
    g.computeVertexNormals();
    return g;
  }
  for (const n of camoNets) nets[0].push(camoNetGeo(n));

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

  for (const [list, mat] of [[rampParts, plank], [rampFloors, floorMat]]) {
    if (!list.length) continue;
    const geo = keep(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute(list, 3));
    const uv = [];
    for (let i = 0; i < list.length; i += 3) uv.push((list[i] + list[i + 2]) * 0.8, list[i + 1] * 0.8);
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true; m.castShadow = mat === plank;
    group.add(m);
  }

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
        const y = Math.max(H(x, z) + 0.03, k === N ? best.y + DUGOUT_MOUND + 0.2 : H(x, z) + 0.03);
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
  let buddy = null, lamp = null, soldiers = null, tvMat = null, tvScreen = null, tvInfo = null, tvText = '';
  const tvParts = [];
  const spares = [];
  if (home) {
    const d = home, hw = d.w / 2, hd = d.d / 2;
    const room = new THREE.Group();
    room.position.set(d.x, d.y - d.depth, d.z);
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
    // The TV on the front wall: what Sasha's spotter drone sees, live (the picture is set from outside).
    const tvW = 0.8, tvH = 0.45, tvY = 1.42, tvZ = -hd + 0.05;
    add(new THREE.BoxGeometry(tvW + 0.05, tvH + 0.05, 0.05), plastic, tx, tvY, tvZ);
    tvMat = keep(new THREE.MeshBasicMaterial({ color: 0x050605, toneMapped: true }));
    tvScreen = new THREE.Mesh(keep(new THREE.PlaneGeometry(tvW, tvH)), tvMat);
    tvScreen.position.set(tx, tvY, tvZ + 0.04);
    room.add(tvScreen);
    tvInfo = keep(tvOverlayTexture());
    const tvOver = new THREE.Mesh(keep(new THREE.PlaneGeometry(tvW, tvH)),
      keep(new THREE.MeshBasicMaterial({ map: tvInfo, transparent: true, depthWrite: false, color: 0x9a9a9a })));
    tvOver.position.set(tx, tvY, tvZ + 0.052);
    room.add(tvOver);
    tvParts.push(tvScreen, tvOver);
    // Hung from the roof logs on two wires, a cable down to the table.
    for (const x of [-0.25, 0.25]) add(new THREE.CylinderGeometry(0.004, 0.004, d.depth - tvY - tvH / 2, 4), plastic, tx + x, (d.depth + tvY + tvH / 2) / 2, tvZ);
    add(new THREE.CylinderGeometry(0.006, 0.006, tvY - tvH / 2 - 0.78, 5), plastic, tx + 0.28, (tvY - tvH / 2 + 0.78) / 2, tvZ + 0.03);

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
    bulb.position.set(0.1, d.depth - 0.55, -0.4);
    room.add(bulb);
    const wire = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.004, 0.004, 0.22, 4)), plastic);
    wire.position.set(0.1, d.depth - 0.43, -0.4); room.add(wire);
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

  // ---- Mortar pits: an 82 mm tube on its baseplate and bipod, ammo boxes, spent cases --------------
  for (const mo of mortars) {
    const g = new THREE.Group();
    g.position.set(mo.x, H(mo.x, mo.z), mo.z);
    g.rotation.y = mo.yaw;
    group.add(g);
    const mk = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(keep(geo), mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
      m.castShadow = m.receiveShadow = true; g.add(m); return m;
    };
    mk(new THREE.CylinderGeometry(0.32, 0.36, 0.06, 14), steel, 0, 0.03, 0.35);                       // baseplate
    const EL = 0.95;                                                                                   // ~55° up, firing along −Z
    const tube = mk(new THREE.CylinderGeometry(0.045, 0.05, 1.22, 12), black, 0, 0.55, -0.0, -EL);
    tube.position.set(0, 0.03 + Math.cos(EL) * 0.61, 0.35 - Math.sin(EL) * 0.61);
    for (const sx of [-1, 1]) {
      const leg = mk(new THREE.CylinderGeometry(0.016, 0.016, 0.85, 6), steel, sx * 0.22, 0.38, -0.32, 0.15, 0, sx * 0.3);
      void leg;
    }
    mk(new THREE.BoxGeometry(0.08, 0.1, 0.12), black, 0, 0.72, -0.28);                                  // sight / traverse
    const box = keep(new THREE.MeshStandardMaterial({ color: 0x4d5435, roughness: 0.85 }));
    for (const [x, z, ry] of [[1.1, 0.9, 0.2], [1.3, 1.25, -0.1], [-1.2, 1.1, 0.4]]) mk(new THREE.BoxGeometry(0.55, 0.18, 0.3), box, x, 0.09, z, 0, ry);
    const brass = keep(new THREE.MeshStandardMaterial({ color: 0x9a7f3a, roughness: 0.4, metalness: 0.7 }));
    for (let k = 0; k < 6; k++) mk(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 6), brass, -0.6 + k * 0.17, 0.03, 1.6 + (k % 2) * 0.2, 0, 0, Math.PI / 2);
  }

  // ---- Our men in the outpost trench (mission 6): kneeling behind the parapet, firing back --------
  const pinned = [];
  if (friendlies.length) {
    soldiers ??= createSoldierFactory();
    friendlies.forEach((f, i) => {
      const s = soldiers.make(i % 3 === 2 ? 'mg' : 'rifleman', 777 + i * 31, { friendly: true });
      initSoldierAnim(s);
      s.st.kneel = true;
      s.root.position.set(f.x, H(f.x, f.z), f.z);
      s.root.rotation.y = f.yaw;
      group.add(s.root);
      pinned.push({ s, dead: false, f });
    });
  }
  let lost = 0;
  function setCasualties(n) {
    if (n === lost) return;
    if (n < lost) {
      // A fresh team: everyone back up.
      for (const p of pinned) if (p.dead) { initSoldierAnim(p.s); p.s.st.kneel = true; p.dead = false; p.s.root.position.y = H(p.f.x, p.f.z); }
    }
    lost = n;
    for (let i = 0; i < pinned.length; i++) {
      const p = pinned[(i * 2 + 1) % pinned.length]; // not left to right
      if (i < n && !p.dead) { p.dead = true; killSoldierAnim(p.s, null); }
    }
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
    // Sasha's TV: `tv.setPicture(texture)`, `tv.position` (world), `tv.visible(on)` to hide it while
    // its own picture is rendered.
    tv: tvScreen ? {
      position: tvScreen.getWorldPosition(new THREE.Vector3()),
      setPicture(tex) { tvMat.map = tex; tvMat.color.setScalar(tex ? 0.75 : 0.02); tvMat.needsUpdate = true; },
      visible(on) { for (const o of tvParts) o.visible = on; },
      info(text) { if (text !== tvText) { tvText = text; tvInfo.draw(text); } },
    } : null,
    casualties: setCasualties,  // how many of our men in the outpost trench have been hit
    update(dt, camPos) {
      t += dt;
      if (buddy) {
        // Only animate him when we could see him.
        const near = camPos.distanceToSquared(buddy.root.getWorldPosition(p)) < 60 * 60;
        if (near) animateCrew(buddy, { dt, mode: 'gunner', alert: false, seated: true });
      }
      if (lamp) lamp.intensity = 2.2 * (0.96 + 0.04 * Math.sin(t * 13) * Math.sin(t * 3.1));
      if (pinned.length && dt > 0 && camPos.distanceToSquared(pinned[0].s.root.position) < 700 * 700) {
        for (const p of pinned) {
          if (p.dead) animateDeadSoldier(p.s, dt);
          else animateSoldier(p.s, { dt, speed: 0, status: 'idle', drone: null, alert: 1 });
        }
      }
    },
    dispose() {
      scene.remove(group);
      spares.forEach((s) => s.dispose());
      soldiers?.dispose();
      disposables.forEach((x) => x.dispose());
    },
  };
}
