// Deterministic placement of the front-line scenery, as plain data, so the sim can give the same
// objects colliders and the visuals can draw them. Pure JS (no three.js) and self-contained: the
// sim may copy or move this file and publish the result as `level.props`; the visuals prefer
// `level.props` when it exists and fall back to calling `propLayout(level)` themselves.
//
// propLayout(level) → {
//   lanes:    [[[x, z], [x, z]], ...]                 dirt lanes (also painted into the ground)
//   craters:  [{ x, y, z, r, water }]                 old shell craters; spoil rim ≈ 0.3 m high at radius 0.85 r
//   poles:    [{ x, y, z, rotation: [rx, ry, rz], height, radius, snapped }]
//             wooden pole from (x, y, z) up its local +Y for `height` m; Euler XYZ; crossarm at the top
//   wires:    [{ a: [x, y, z], b: [x, y, z], sag }]   cable between insulators, drooping `sag` m at mid-span
//   fences:   [{ a: [x, y, z], b: [x, y, z], lean, height }]  one panel between posts (ground at a and b), 0.1 m thick
//   bales:    [{ x, y, z, yaw, radius, length, wrapped }]     round bale, axis horizontal along local X
//   sandbags: [{ x, y, z, yaw, layer }]               single bags ≈ 0.62 x 0.2 x 0.3 m, stacked in arcs
// }
// All heights come from level.terrain.heightAt, so the data matches the ground exactly.

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Rotate v by Euler angles in three.js 'XYZ' order (the matrix is Rx * Ry * Rz).
function rotXYZ([x, y, z], [a, b, c]) {
  let x1 = x * Math.cos(c) - y * Math.sin(c), y1 = x * Math.sin(c) + y * Math.cos(c), z1 = z;
  const x2 = x1 * Math.cos(b) + z1 * Math.sin(b), z2 = -x1 * Math.sin(b) + z1 * Math.cos(b);
  x1 = x2; z1 = z2;
  const y3 = y1 * Math.cos(a) - z1 * Math.sin(a), z3 = y1 * Math.sin(a) + z1 * Math.cos(a);
  return [x1, y3, z3];
}

export function lanes(level) {
  const half = level.terrain.size / 2, out = [];
  const buildings = level.objects.filter((o) => o.kind === 'building');
  // Lanes follow the windbreaks, as they do between real fields.
  out.push([[-half, -27], [half, -27]]);
  out.push([[-108, -27], [-108, 330]]);
  out.push([[272, -27], [272, 420]]);
  out.push([[-440, -305], [440, -287]]);
  if (buildings.length > 6) {
    // Village streets between the rows of houses, joined to the lane network.
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, n = 0;
    for (const b of buildings) {
      if (b.size[1] > 9) continue;
      n++;
      x0 = Math.min(x0, b.position[0]); x1 = Math.max(x1, b.position[0]);
      z0 = Math.min(z0, b.position[2]);
    }
    if (n) {
      for (const z of [-235, -205]) out.push([[x0 - 22, z], [x1 + 14, z]]);
      out.push([[x0 - 22, z0 - 14], [x0 - 22, -27]]);
      out.push([[x0 - 22, -265], [x1 + 14, -265]]);
      out.push([[x0 - 22, -175], [x1 + 14, -175]]);
    }
  }
  return out;
}

export function propLayout(level) {
  const rand = mulberry32(4242);
  const H = (x, z) => level.terrain.heightAt(x, z);
  const half = level.terrain.size / 2;
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
  const out = { lanes: lanes(level), craters: [], poles: [], wires: [], fences: [], bales: [], sandbags: [] };

  // Shell craters, clustered as artillery falls.
  for (let i = 0, tries = 0; i < 46 && tries < 600; tries++) {
    const cx = (rand() - 0.5) * 520, cz = (rand() - 0.5) * 520;
    for (let k = 0, n = 1 + Math.floor(rand() * 4); k < n; k++) {
      const x = cx + (rand() - 0.5) * 30, z = cz + (rand() - 0.5) * 30, r = 1.6 + rand() * 3;
      if (!clear(x, z, r)) continue;
      i++;
      out.craters.push({ x, y: H(x, z), z, r, rim: 0.32 + rand() * 0.2, water: rand() < 0.4 });
    }
  }

  // Telegraph poles 5 m off the lanes every 42 m, with three wires; about one in twelve snapped.
  for (const pts of out.lanes) {
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
        const y = H(x, z) - 0.3, rotation = [lean * Math.cos(yaw), yaw, lean * Math.sin(yaw)];
        const height = snapped ? 4.1 : 7.5;
        out.poles.push({ x, y, z, rotation, height, radius: 0.13, snapped });
        if (snapped) { prev = null; continue; }
        const ends = [-0.7, 0, 0.7].map((wx) => { const r = rotXYZ([wx, 7.15, 0], rotation); return [x + r[0], y + r[1], z + r[2]]; });
        if (prev) for (let w = 0; w < 3; w++) out.wires.push({ a: prev[w], b: ends[w], sag: 0.7 + rand() * 0.3 });
        prev = ends;
      }
    }
  }

  // Fences round the houses: panels between posts, a gate gap, sections knocked down.
  for (const b of buildings) {
    if (b.size[1] > 9) continue;
    const ry = b.rotationY ?? 0, cos = Math.cos(ry), sin = Math.sin(ry);
    const hw = b.size[0] / 2 + 4 + rand() * 2, hd = b.size[2] / 2 + 4 + rand() * 3;
    const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
    for (let c = 0; c < 4; c++) {
      const [x0, z0] = corners[c], [x1, z1] = corners[(c + 1) % 4];
      const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 2.4));
      for (let k = 0; k < n; k++) {
        if (c === 0 && Math.abs(k - n / 2) < 1.2) continue;
        if (rand() < 0.18) continue;
        const t0 = k / n, t1 = (k + 1) / n;
        const lx0 = x0 + (x1 - x0) * t0, lz0 = z0 + (z1 - z0) * t0, lx1 = x0 + (x1 - x0) * t1, lz1 = z0 + (z1 - z0) * t1;
        const wx0 = b.position[0] + lx0 * cos + lz0 * sin, wz0 = b.position[2] - lx0 * sin + lz0 * cos;
        const wx1 = b.position[0] + lx1 * cos + lz1 * sin, wz1 = b.position[2] - lx1 * sin + lz1 * cos;
        const lean = rand() < 0.15 ? (rand() - 0.5) * 0.6 : (rand() - 0.5) * 0.06;
        out.fences.push({ a: [wx0, H(wx0, wz0), wz0], b: [wx1, H(wx1, wz1), wz1], lean, height: 1.2 });
      }
    }
  }

  // Round hay bales in clusters, some in black silage wrap.
  for (let c = 0, tries = 0; c < 7 && tries < 200; tries++) {
    const cx = (rand() - 0.5) * 460, cz = (rand() - 0.5) * 460;
    if (!clear(cx, cz, 12)) continue;
    c++;
    const wrapped = rand() < 0.3;
    for (let k = 0, n = 4 + Math.floor(rand() * 8); k < n; k++) {
      const x = cx + (rand() - 0.5) * 24, z = cz + (rand() - 0.5) * 24;
      if (!clear(x, z, 1)) continue;
      out.bales.push({ x, y: H(x, z) + 0.68, z, yaw: rand() * Math.PI, radius: 0.75, length: 1.2, wrapped });
    }
  }

  // Sandbagged fighting positions: three layers of bags in an arc facing the enemy.
  for (let c = 0, tries = 0; c < 6 && tries < 200; tries++) {
    const cx = (rand() - 0.5) * 300, cz = (rand() - 0.5) * 300;
    if (!clear(cx, cz, 3)) continue;
    c++;
    const face = rand() * Math.PI * 2, R = 1.5 + rand() * 0.5;
    for (let layer = 0; layer < 3; layer++) {
      for (let a = -1.6; a <= 1.6; a += 0.3) {
        const ang = face + a + (layer % 2) * 0.15, x = cx + Math.sin(ang) * R, z = cz + Math.cos(ang) * R;
        out.sandbags.push({ x, y: H(x, z) + 0.1 + layer * 0.19, z, yaw: ang + Math.PI / 2, roll: (rand() - 0.5) * 0.1, layer });
      }
    }
  }
  return out;
}
