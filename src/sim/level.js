// Static level data shared by the sim (colliders) and visuals (meshes).
// See ARCHITECTURE.md › Level.

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

// Smooth 2D value noise on a lattice, seeded.
function makeNoise(seed) {
  const rand = mulberry32(seed);
  const N = 256;
  const perm = new Uint16Array(N * 2);
  const vals = new Float32Array(N);
  for (let i = 0; i < N; i++) { perm[i] = i; vals[i] = rand() * 2 - 1; }
  for (let i = N - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < N; i++) perm[N + i] = perm[i];
  const lat = (x, z) => vals[perm[(perm[x & 255] + z) & 511] & 255];
  const s = (t) => t * t * (3 - 2 * t);
  return (x, z) => {
    const xi = Math.floor(x), zi = Math.floor(z);
    const xf = s(x - xi), zf = s(z - zi);
    const a = lat(xi, zi), b = lat(xi + 1, zi), c = lat(xi, zi + 1), d = lat(xi + 1, zi + 1);
    return a + (b - a) * xf + (c - a) * zf + (a - b - c + d) * xf * zf;
  };
}

export function createTerrain({ size = 1024, segments = 256, seed = 1 } = {}) {
  const noise = makeNoise(seed);
  const n = segments + 1;
  const heights = new Float32Array(n * n);
  const step = size / segments;
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const x = -size / 2 + ix * step;
      const z = -size / 2 + iz * step;
      // Gentle rolling farmland (Ukrainian steppe is mostly flat) + a few ridges.
      let h = 0;
      h += noise(x / 260, z / 260) * 14;
      h += noise(x / 90 + 17, z / 90 - 5) * 4;
      h += noise(x / 30 - 40, z / 30 + 9) * 0.8;
      // Flatten a pad around spawn.
      const d = Math.hypot(x, z);
      const pad = Math.min(1, Math.max(0, (d - 30) / 60));
      heights[iz * n + ix] = h * pad;
    }
  }

  function heightAt(x, z) {
    const fx = (x + size / 2) / step;
    const fz = (z + size / 2) / step;
    const ix = Math.min(segments - 1, Math.max(0, Math.floor(fx)));
    const iz = Math.min(segments - 1, Math.max(0, Math.floor(fz)));
    const tx = Math.min(1, Math.max(0, fx - ix));
    const tz = Math.min(1, Math.max(0, fz - iz));
    const h00 = heights[iz * n + ix];
    const h10 = heights[iz * n + ix + 1];
    const h01 = heights[(iz + 1) * n + ix];
    const h11 = heights[(iz + 1) * n + ix + 1];
    // Match the triangle split used by the physics trimesh (diagonal 00→11).
    if (tx >= tz) return h00 + (h10 - h00) * tx + (h11 - h10) * tz;
    return h00 + (h11 - h01) * tx + (h01 - h00) * tz;
  }

  return { size, segments, heights, heightAt };
}

export function createTestLevel(seed = 7) {
  const terrain = createTerrain({ size: 1024, segments: 256, seed });
  const rand = mulberry32(seed * 31 + 3);
  const objects = [];
  let id = 0;

  const place = (x, z) => [x, terrain.heightAt(x, z), z];

  // A small village: a couple of streets of houses and sheds.
  const villageCenter = [180, -220];
  for (let row = -2; row <= 2; row++) {
    for (let col = -4; col <= 4; col++) {
      if (rand() < 0.25) continue;
      const x = villageCenter[0] + col * 22 + (rand() - 0.5) * 6;
      const z = villageCenter[1] + row * 30 + (rand() - 0.5) * 6;
      const w = 7 + rand() * 6, d = 6 + rand() * 5, h = 3 + rand() * 4;
      objects.push({ id: `b${id++}`, kind: 'building', position: place(x, z), rotationY: (rand() - 0.5) * 0.3, size: [w, h, d] });
    }
  }
  // A few tall structures to fly around near spawn.
  for (const [x, z, w, h, d] of [[40, -60, 12, 18, 12], [-50, -90, 8, 30, 8], [10, -140, 30, 10, 14]]) {
    objects.push({ id: `b${id++}`, kind: 'building', position: place(x, z), rotationY: 0, size: [w, h, d] });
  }

  // Tree lines (windbreaks between fields), a very Ukrainian landscape feature.
  const treeLines = [
    [[-400, -40], [400, -40]],
    [[-400, -320], [380, -300]],
    [[-120, -450], [-120, 300]],
    [[260, 400], [260, -60]],
  ];
  for (const [[x0, z0], [x1, z1]] of treeLines) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const count = Math.floor(len / 7);
    for (let i = 0; i < count; i++) {
      const t = i / count;
      const x = x0 + (x1 - x0) * t + (rand() - 0.5) * 5;
      const z = z0 + (z1 - z0) * t + (rand() - 0.5) * 5;
      if (Math.hypot(x, z) < 25) continue; // keep spawn clear
      objects.push({ id: `t${id++}`, kind: 'tree', position: place(x, z), height: 9 + rand() * 9, radius: 2.5 + rand() * 2 });
    }
  }
  // Scattered single trees.
  for (let i = 0; i < 120; i++) {
    const x = (rand() - 0.5) * 900, z = (rand() - 0.5) * 900;
    if (Math.hypot(x, z) < 40) continue;
    objects.push({ id: `t${id++}`, kind: 'tree', position: place(x, z), height: 6 + rand() * 10, radius: 2 + rand() * 2.5 });
  }

  // Enemies (sim-only; visuals reads them from state.entities). Positions are [x, z].
  const enemies = [];
  const at = (kind, variant, x, z, extra = {}) => enemies.push({ kind, variant, position: [x, z], ...extra });
  // Easy first targets, 80 m north of the spawn.
  const loopA = [[-10, -80], [15, -95], [-5, -110]];
  ['rifleman', 'rifleman', 'rpg'].forEach((v, i) => at('infantry', v, -10 + i * 3, -80 - i * 2, { patrol: loopA, yaw: 2.5, idleTime: 3 }));
  // Squad on patrol west of the tall buildings, led by an officer.
  const loopB = [[-80, -105], [-58, -120], [-80, -135], [-100, -120]];
  ['officer', 'rifleman', 'rifleman', 'mg'].forEach((v, i) => at('infantry', v, -80 - i * 2, -105 - i, { patrol: loopB, idleTime: 3 }));
  // Convoy driving loops on the road to the north: jeep, truck, BTR.
  at('light', 'uaz', -200, -190, { patrol: [[-200, -190], [40, -190], [40, -215], [-200, -215]], yaw: -Math.PI / 2 });
  at('truck', 'ural', -180, -190, { patrol: [[-180, -190], [40, -190], [40, -215], [-180, -215]], yaw: -Math.PI / 2 });
  at('apc', 'btr', -170, -240, { patrol: [[-170, -240], [30, -240], [30, -262], [-170, -262]], yaw: -Math.PI / 2 });
  // A technical on a short beat, a parked fuel tanker, and a BMP and MT-LB further out.
  at('light', 'technical', 60, -150, { patrol: [[60, -150], [110, -150]], yaw: -Math.PI / 2 });
  at('truck', 'fuel', 150, -175, {});
  at('apc', 'bmp', 90, -230, { patrol: [[90, -230], [150, -230]], yaw: -Math.PI / 2 });
  at('apc', 'mtlb', -60, -290, { patrol: [[-60, -290], [0, -290]], yaw: -Math.PI / 2 });
  at('light', 'pickup', -120, -260, { patrol: [[-120, -260], [-120, -300]], yaw: 0 });
  at('truck', 'kamaz', -90, -330, {});
  // Dug-in tanks: a T-80 with its squad, a T-72 to the west and a T-90 far east.
  at('tank', 't80', 120, -90, { yaw: Math.PI / 2 });
  ['rifleman', 'rifleman', 'rifleman', 'mg', 'rpg', 'rifleman'].forEach((v, i) =>
    at('infantry', v, 108 + (i % 3) * 3, -86 - Math.floor(i / 3) * 4 - 6, {}));
  at('tank', 't72', -150, -70, { yaw: 0 });
  at('tank', 't90', 300, -130, { yaw: Math.PI / 2 });

  return {
    name: 'Test range',
    seed,
    terrain,
    objects,
    enemies,
    spawn: { position: [0, terrain.heightAt(0, 0) + 0.1, 0], yaw: 0 },
  };
}
