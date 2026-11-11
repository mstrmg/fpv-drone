// Two very small demo maps (about 300 m across) plus the map registry the game boots from.
// Same Level shape as createTestLevel (see ARCHITECTURE.md › Level), with hand-placed props.

import { createTerrain, createTestLevel, mulberry32 } from './level.js';

const SIZE = 320; // metres; the map edge is the off-map boundary (half = 160 m)

function builder(name, seed, terrainOpts) {
  const terrain = createTerrain({ size: SIZE, segments: 160, seed, ...terrainOpts });
  const rand = mulberry32(seed * 131 + 9);
  const H = (x, z) => terrain.heightAt(x, z);
  const objects = [], enemies = [];
  const props = { lanes: [], craters: [], poles: [], wires: [], fences: [], bales: [], sandbags: [] };
  let id = 0;
  const b = {
    terrain, rand, H, objects, enemies, props,
    building(x, z, w, h, d, rotationY = 0) {
      const o = { id: `b${id++}`, kind: 'building', position: [x, H(x, z), z], rotationY, size: [w, h, d] };
      objects.push(o);
      return o;
    },
    tree(x, z, height, radius) {
      objects.push({ id: `t${id++}`, kind: 'tree', position: [x, H(x, z), z], height, radius });
    },
    treeLine([x0, z0], [x1, z1], spacing = 6, gaps = []) {
      const len = Math.hypot(x1 - x0, z1 - z0), count = Math.floor(len / spacing);
      for (let i = 0; i <= count; i++) {
        const t = i / count;
        const x = x0 + (x1 - x0) * t + (rand() - 0.5) * 4, z = z0 + (z1 - z0) * t + (rand() - 0.5) * 4;
        if (gaps.some(([gx, gz, r]) => Math.hypot(x - gx, z - gz) < r)) continue;
        b.tree(x, z, 9 + rand() * 8, 2.4 + rand() * 1.8);
      }
    },
    enemy(kind, variant, x, z, extra = {}) { enemies.push({ kind, variant, position: [x, z], ...extra }); },
    crater(x, z, r, water = rand() < 0.35) { props.craters.push({ x, y: H(x, z), z, r, rim: 0.32 + rand() * 0.2, water }); },
    craters(cx, cz, spread, n) {
      for (let i = 0; i < n; i++) b.crater(cx + (rand() - 0.5) * spread, cz + (rand() - 0.5) * spread, 1.4 + rand() * 2.6);
    },
    // Three layers of sandbags in an arc; `face` is the direction the position looks (0 = +Z, south).
    sandbags(cx, cz, face = 0, R = 1.7, arc = 1.6) {
      for (let layer = 0; layer < 3; layer++) {
        for (let a = -arc; a <= arc; a += 0.3) {
          const ang = face + a + (layer % 2) * 0.15, x = cx + Math.sin(ang) * R, z = cz + Math.cos(ang) * R;
          props.sandbags.push({ x, y: H(x, z) + 0.1 + layer * 0.19, z, yaw: ang + Math.PI / 2, roll: (rand() - 0.5) * 0.1, layer });
        }
      }
    },
    bales(cx, cz, n, wrapped = false) {
      for (let k = 0; k < n; k++) {
        const x = cx + (rand() - 0.5) * 14, z = cz + (rand() - 0.5) * 14;
        props.bales.push({ x, y: H(x, z) + 0.68, z, yaw: rand() * Math.PI, radius: 0.75, length: 1.2, wrapped });
      }
    },
    // Fence round a building's yard with a gate gap on the side facing −Z (local), some panels down.
    fence(o, padX = 4, padZ = 5) {
      const ry = o.rotationY, cos = Math.cos(ry), sin = Math.sin(ry);
      const hw = o.size[0] / 2 + padX, hd = o.size[2] / 2 + padZ;
      const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
      for (let c = 0; c < 4; c++) {
        const [x0, z0] = corners[c], [x1, z1] = corners[(c + 1) % 4];
        const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / 2.4));
        for (let k = 0; k < n; k++) {
          if (c === 0 && Math.abs(k - n / 2) < 1.2) continue;
          if (rand() < 0.15) continue;
          const t0 = k / n, t1 = (k + 1) / n;
          const lx0 = x0 + (x1 - x0) * t0, lz0 = z0 + (z1 - z0) * t0, lx1 = x0 + (x1 - x0) * t1, lz1 = z0 + (z1 - z0) * t1;
          const wx0 = o.position[0] + lx0 * cos + lz0 * sin, wz0 = o.position[2] - lx0 * sin + lz0 * cos;
          const wx1 = o.position[0] + lx1 * cos + lz1 * sin, wz1 = o.position[2] - lx1 * sin + lz1 * cos;
          const lean = rand() < 0.15 ? (rand() - 0.5) * 0.6 : (rand() - 0.5) * 0.06;
          props.fences.push({ a: [wx0, H(wx0, wz0), wz0], b: [wx1, H(wx1, wz1), wz1], lean, height: 1.2 });
        }
      }
    },
    // Telegraph poles along a straight run, 5 m to its left, with three sagging wires between them.
    poles([ax, az], [bx, bz], every = 36, snappedAt = -1) {
      const len = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / len, dz = (bz - az) / len;
      const yaw = Math.atan2(dx, dz);
      let prev = null, i = 0;
      for (let d = 8; d < len - 4; d += every, i++) {
        const x = ax + dx * d - dz * 5, z = az + dz * d + dx * 5;
        const snapped = i === snappedAt;
        const lean = snapped ? 0.9 : (rand() - 0.5) * 0.08;
        const rotation = [lean * Math.cos(yaw), yaw, lean * Math.sin(yaw)];
        const y = H(x, z) - 0.3;
        props.poles.push({ x, y, z, rotation, height: snapped ? 4.1 : 7.5, radius: 0.13, snapped });
        if (snapped) { prev = null; continue; }
        const ends = [-0.7, 0, 0.7].map((wx) => [x + wx * Math.cos(yaw), y + 7.15, z - wx * Math.sin(yaw)]);
        if (prev) for (let w = 0; w < 3; w++) props.wires.push({ a: prev[w], b: ends[w], sag: 0.7 + rand() * 0.3 });
        prev = ends;
      }
    },
    finish(spawnX, spawnZ, yaw = 0) {
      return { name, seed, terrain, objects, enemies, props, spawn: { position: [spawnX, H(spawnX, spawnZ) + 0.1, spawnZ], yaw } };
    },
  };
  return b;
}

// Map 1: a single windbreak held by a dug-in squad, a BMP hiding in the trees and a supply truck
// running the lane behind it. Launch from a cratered field 100 m south.
export function createTreelineLevel() {
  const m = builder('Treeline', 21, { pad: [0, 0, 20, 70], relief: 0.6 });
  const LINE_Z = -100;
  m.props.lanes.push([[-160, LINE_Z - 14], [160, LINE_Z - 14]], [[12, 160], [12, -160]]);
  m.treeLine([-150, LINE_Z], [150, LINE_Z + 4], 5.5, [[12, LINE_Z + 2, 7]]);
  m.treeLine([-150, LINE_Z - 8], [150, LINE_Z - 5], 9, [[12, LINE_Z - 6, 8]]); // ragged second row

  // Fighting positions along the south edge of the trees, looking at the launch field.
  for (const [x, f] of [[-55, 0.1], [-18, 0], [38, -0.1], [78, 0.05]]) m.sandbags(x, LINE_Z + 7, f);
  m.enemy('infantry', 'mg', -55, LINE_Z + 6, { yaw: Math.PI });
  m.enemy('infantry', 'rifleman', -18, LINE_Z + 6, { yaw: Math.PI });
  m.enemy('infantry', 'rpg', 38, LINE_Z + 6, { yaw: Math.PI });
  m.enemy('infantry', 'rifleman', 78, LINE_Z + 6, { yaw: Math.PI });
  m.enemy('infantry', 'officer', 20, LINE_Z - 4, { patrol: [[20, LINE_Z - 4], [-30, LINE_Z - 4]], idleTime: 5 });
  m.enemy('apc', 'bmp', -95, LINE_Z - 2, { yaw: Math.PI }); // nosed into the trees
  m.enemy('truck', 'ural', -120, LINE_Z - 14, { patrol: [[-120, LINE_Z - 14], [120, LINE_Z - 14]], yaw: -Math.PI / 2 });

  // The field in front has been shelled.
  m.craters(-30, -55, 60, 9);
  m.craters(55, -70, 40, 6);
  m.crater(20, -30, 3.6, true);
  // A lone tree and a wrapped bale stack near the launch point to fly round.
  m.tree(-35, -18, 11, 3.2);
  m.bales(45, -10, 6, true);
  return m.finish(0, 0, 0);
}

// Map 2: a farmstead at a crossroads. A tank is parked by the barn, a technical guards the
// junction, and a few soldiers loiter in the yards. Launch from the orchard road 100 m south.
export function createFarmsteadLevel() {
  const m = builder('Farmstead', 34, { pad: [10, -40, 20, 110], relief: 0.8 });
  const X = 15, Z = -95; // crossroads
  m.props.lanes.push([[-160, Z], [160, Z]], [[X, 160], [X, -160]]);
  m.poles([-160, Z], [160, Z], 34, 4);

  const house1 = m.building(X - 22, Z - 18, 9, 4.5, 7, 0.05);
  const house2 = m.building(X + 24, Z - 17, 8, 4, 7, -0.04);
  const house3 = m.building(X - 24, Z + 18, 8, 4.2, 6.5, 0.02);
  const barn = m.building(X + 32, Z + 24, 18, 7.5, 10, 0.03);
  m.building(X + 14, Z + 30, 4, 2.6, 3.5, 0.1); // shed
  for (const h of [house1, house2, house3]) m.fence(h);
  m.fence(barn, 6, 6);

  // Orchard behind the houses, a tree line on the west edge and a couple of yard trees.
  for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
    if (m.rand() < 0.15) continue;
    m.tree(X - 70 + c * 8 + (m.rand() - 0.5) * 1.5, Z - 40 - r * 8 + (m.rand() - 0.5) * 1.5, 5 + m.rand() * 2, 2 + m.rand() * 0.8);
  }
  m.treeLine([-110, -150], [-100, 40], 6);
  m.tree(X - 10, Z - 26, 13, 3.6);
  m.tree(X + 8, Z + 16, 12, 3.4);

  m.bales(X + 70, Z + 30, 9);
  m.bales(X + 60, Z - 20, 5, true);
  m.sandbags(X - 6, Z + 8, 0.3);
  m.craters(X + 5, Z + 55, 50, 6);
  m.crater(X - 40, Z, 3.2, true);

  m.enemy('tank', 't72', X + 32, Z + 9, { yaw: Math.PI * 0.9 }); // parked in front of the barn doors
  m.enemy('light', 'technical', X + 6, Z + 6, { patrol: [[X + 6, Z + 6], [X + 6, Z - 30]], yaw: 0 });
  m.enemy('truck', 'fuel', X + 50, Z + 26, { yaw: Math.PI / 2 });
  m.enemy('infantry', 'officer', X - 18, Z - 9, { yaw: Math.PI });
  m.enemy('infantry', 'rifleman', X - 4, Z + 8, { yaw: Math.PI * 0.95 });
  m.enemy('infantry', 'mg', X - 8, Z + 9, { yaw: Math.PI * 1.05 });
  m.enemy('infantry', 'crew', X + 28, Z + 6, { yaw: 0 });
  m.enemy('infantry', 'rifleman', X + 24, Z - 6, { patrol: [[X + 24, Z - 6], [X + 24, Z - 30], [X - 20, Z - 30]], idleTime: 4 });
  return m.finish(X, 5, 0);
}

export const LEVELS = [
  { id: 'range', name: 'Test range', blurb: '1 km of farmland, a village and a dozen targets', create: () => createTestLevel() },
  { id: 'treeline', name: 'Treeline', blurb: 'Tiny: one windbreak, a dug-in squad and a BMP', create: createTreelineLevel },
  { id: 'farmstead', name: 'Farmstead', blurb: 'Tiny: a crossroads farm with a T-72 by the barn', create: createFarmsteadLevel },
];

export function createLevel(id) {
  return (LEVELS.find((l) => l.id === id) ?? LEVELS[0]).create();
}
