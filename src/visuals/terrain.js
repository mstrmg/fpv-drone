// Ground: the physics height field drawn as a patchwork of fields, dirt tracks and leaf litter,
// plus a skirt that carries the landscape out to the haze.
import * as THREE from 'three';
import { mulberry32 } from './rng.js';
import { canvasTexture } from './textures.js';

const FIELD_SPAN = 4096; // metres covered by the field maps

const FIELD_TYPES = [
  { name: 'plowed', color: [50, 42, 35], plow: 1.0, grass: 0.0, weight: 3 },
  { name: 'harrowed', color: [86, 72, 57], plow: 0.45, grass: 0.0, weight: 2 },
  { name: 'stubble', color: [128, 116, 84], plow: 0.35, grass: 0.35, weight: 3 },
  { name: 'winter', color: [76, 88, 56], plow: 0.4, grass: 0.22, weight: 2 },
  { name: 'fallow', color: [98, 93, 64], plow: 0.0, grass: 1.0, weight: 3 },
  { name: 'sunflower', color: [76, 64, 46], plow: 0.25, grass: 0.65, weight: 1 },
];
const FALLOW = FIELD_TYPES[4];

function splits(rand, from, to, minStep, maxStep, forced) {
  const out = [from];
  let v = from;
  while (v < to - minStep) { v += minStep + rand() * (maxStep - minStep); if (v < to - minStep * 0.5) out.push(v); }
  const kept = out.filter((s) => forced.every((f) => Math.abs(s - f) > minStep * 0.6));
  return [...kept, ...forced, to].sort((a, b) => a - b);
}

function buildFieldMaps(level) {
  const S = 2048, k = S / FIELD_SPAN, half = FIELD_SPAN / 2;
  const colorC = document.createElement('canvas'); colorC.width = colorC.height = S;
  const dataC = document.createElement('canvas'); dataC.width = dataC.height = S;
  const cg = colorC.getContext('2d'), dg = dataC.getContext('2d');
  cg.fillStyle = `rgb(${FALLOW.color})`; cg.fillRect(0, 0, S, S);
  dg.fillStyle = 'rgb(0,255,0)'; dg.fillRect(0, 0, S, S);

  const rand = mulberry32(level.seed * 977 + 11);
  const totalW = FIELD_TYPES.reduce((a, t) => a + t.weight, 0);
  const pick = () => { let r = rand() * totalW; for (const t of FIELD_TYPES) { r -= t.weight; if (r <= 0) return t; } return FALLOW; };

  // Strips running east-west, each cut into fields. The level's tree lines sit on field borders.
  const zs = splits(rand, -half, half, 190, 430, [-320, -40]);
  for (let i = 0; i < zs.length - 1; i++) {
    const z0 = zs[i], z1 = zs[i + 1];
    const central = z1 > -520 && z0 < 520;
    const xs = splits(rand, -half, half, 220, 560, central ? [-120, 260] : []);
    for (let j = 0; j < xs.length - 1; j++) {
      const x0 = xs[j], x1 = xs[j + 1];
      let type = pick();
      if (x0 <= 0 && x1 > 0 && z0 <= 0 && z1 > 0) type = FALLOW; // the launch field
      const inset = 3;
      const px = (x0 + half + inset) * k, pz = (z0 + half + inset) * k;
      const pw = (x1 - x0 - inset * 2) * k, ph = (z1 - z0 - inset * 2) * k;
      const shade = 0.86 + rand() * 0.28;
      cg.fillStyle = `rgb(${type.color.map((c) => Math.min(255, c * shade) | 0)})`;
      cg.fillRect(px, pz, pw, ph);
      const ang = (rand() < 0.5 ? 0 : 0.5) + (rand() - 0.5) * 0.04;
      dg.fillStyle = `rgb(${type.plow * 255 | 0},${type.grass * 255 | 0},${((ang + 1) % 1) * 255 | 0})`;
      dg.fillRect(px, pz, pw, ph);
    }
  }
  return {
    fieldColor: canvasTexture(colorC, { aniso: 4, flipY: false }),
    fieldData: canvasTexture(dataC, { srgb: false, aniso: 1, flipY: false }),
  };
}

// Dirt tracks, worn yards, shade and leaf litter. R = shade, G = bare mud, B = leaf litter. 1 px per metre.
function buildLocalMap(level) {
  const size = level.terrain.size;
  const S = 1024, k = S / size, half = size / 2;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'lighter';
  const X = (x) => (x + half) * k;

  const blob = (x, z, r, rgb, a) => {
    const gr = g.createRadialGradient(X(x), X(z), 0, X(x), X(z), r * k);
    gr.addColorStop(0, `rgba(${rgb},${a})`);
    gr.addColorStop(0.55, `rgba(${rgb},${a * 0.7})`);
    gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr;
    g.fillRect(X(x - r), X(z - r), r * 2 * k, r * 2 * k);
  };

  const tracks = [];
  const buildings = level.objects.filter((o) => o.kind === 'building');
  const trees = level.objects.filter((o) => o.kind === 'tree');
  // Lanes follow the windbreaks, as they do between real fields.
  tracks.push([[-half, -27], [half, -27]]);
  tracks.push([[-108, -27], [-108, 330]]);
  tracks.push([[272, -27], [272, 420]]);
  tracks.push([[-440, -305], [440, -287]]);
  if (buildings.length > 6) {
    // Village streets between the rows of houses, joined to the lane network.
    let cx = 0, cz = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, n = 0;
    for (const b of buildings) {
      if (b.size[1] > 9) continue;
      cx += b.position[0]; cz += b.position[2]; n++;
      x0 = Math.min(x0, b.position[0]); x1 = Math.max(x1, b.position[0]);
      z0 = Math.min(z0, b.position[2]); z1 = Math.max(z1, b.position[2]);
    }
    if (n) {
      for (const z of [-235, -205]) tracks.push([[x0 - 22, z], [x1 + 14, z]]);
      tracks.push([[x0 - 22, z0 - 14], [x0 - 22, -27]]);
      tracks.push([[x0 - 22, -265], [x1 + 14, -265]]);
      tracks.push([[x0 - 22, -175], [x1 + 14, -175]]);
    }
  }

  g.filter = 'blur(1.2px)';
  g.lineCap = 'round';
  for (const pts of tracks) {
    g.strokeStyle = 'rgba(0,255,0,0.5)'; g.lineWidth = 5.5 * k;
    g.beginPath(); pts.forEach(([x, z], i) => (i ? g.lineTo(X(x), X(z)) : g.moveTo(X(x), X(z)))); g.stroke();
    g.strokeStyle = 'rgba(0,255,0,0.5)'; g.lineWidth = 3.2 * k;
    g.stroke();
  }
  g.filter = 'none';

  for (const b of buildings) {
    const r = Math.max(b.size[0], b.size[2]);
    blob(b.position[0], b.position[2], r * 1.25, '0,255,0', 0.55);
    blob(b.position[0], b.position[2], r * 0.95, '255,0,0', 0.5);
  }
  for (const t of trees) {
    blob(t.position[0], t.position[2], t.radius * 1.7, '255,0,0', 0.42);
    blob(t.position[0], t.position[2], t.radius * 1.9, '0,0,255', 0.5);
  }
  // Trampled launch spot.
  blob(level.spawn.position[0], level.spawn.position[2], 7, '0,255,0', 0.95);
  const tex = canvasTexture(c, { srgb: false, aniso: 4, flipY: false });
  return { localMap: tex, tracks };
}

function buildHeightTexture(terrain) {
  const n = terrain.segments + 1;
  const data = new Uint16Array(n * n);
  for (let i = 0; i < data.length; i++) data[i] = THREE.DataUtils.toHalfFloat(terrain.heights[i]);
  const t = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.HalfFloatType);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

function buildSkirt(terrain) {
  const seg = terrain.segments, n = seg + 1, half = terrain.size / 2, step = terrain.size / seg;
  const rim = [];
  const push = (ix, iz) => rim.push([-half + ix * step, terrain.heights[iz * n + ix], -half + iz * step]);
  for (let i = 0; i < seg; i++) push(i, 0);
  for (let i = 0; i < seg; i++) push(seg, i);
  for (let i = 0; i < seg; i++) push(seg - i, seg);
  for (let i = 0; i < seg; i++) push(0, seg - i);
  const rings = [[half, 1], [half + 30, 0.86], [half + 90, 0.62], [half + 220, 0.34], [half + 480, 0.12], [1500, 0], [2600, 0], [6000, 0]];
  const m = rim.length;
  const pos = new Float32Array(rings.length * m * 3);
  rings.forEach(([ext, fall], r) => rim.forEach(([x, y, z], j) => {
    pos.set([x * ext / half, y * fall, z * ext / half], (r * m + j) * 3);
  }));
  const idx = [];
  for (let r = 0; r < rings.length - 1; r++) for (let j = 0; j < m; j++) {
    const a = r * m + j, b = r * m + (j + 1) % m, c = (r + 1) * m + j, d = (r + 1) * m + (j + 1) % m;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

const fragDecl = /* glsl */ `
  uniform sampler2D tFieldColor, tFieldData, tLocal, tDetail;
  varying vec3 vWp;
`;

const fragAlbedo = /* glsl */ `
  vec2 wxz = vWp.xz;
  float camDist = length(vWp - cameraPosition);
  vec2 fuv = wxz / ${FIELD_SPAN.toFixed(1)} + 0.5;
  vec3 fcol = texture2D(tFieldColor, fuv).rgb;
  vec3 fdat = texture2D(tFieldData, fuv).rgb;
  vec2 luv = wxz / LOCAL_SIZE + 0.5;
  float inside = step(abs(luv.x - 0.5), 0.5) * step(abs(luv.y - 0.5), 0.5);
  vec3 loc = texture2D(tLocal, luv).rgb * inside;
  vec4 d1 = texture2D(tDetail, wxz / 5.3);
  vec4 d2 = texture2D(tDetail, wxz / 41.0 + 0.37);
  vec4 d3 = texture2D(tDetail, wxz / 330.0 + 0.11);
  float nearK = 1.0 - smoothstep(30.0, 200.0, camDist);

  vec3 alb = fcol;
  alb *= 0.70 + 0.6 * d3.b;
  alb *= 0.80 + 0.4 * d2.b;
  alb *= mix(1.0, 0.72 + 0.56 * d1.a, nearK);

  // Furrows and drill rows, faded out before they can alias.
  float ang = fdat.b * 3.14159265;
  vec2 fdir = vec2(cos(ang), sin(ang));
  float fs = dot(wxz, fdir);
  float fph = fs * (6.2831853 / 0.75) + d2.b * 3.0;
  float furrowAmp = fdat.r * clamp(1.0 - fwidth(fph) * 0.45, 0.0, 1.0);
  float furrow = sin(fph);
  float rows = sin(fs * (6.2831853 / 9.0) + d3.b * 4.0);
  alb *= 1.0 + furrow * 0.24 * furrowAmp + rows * 0.06 * fdat.r;

  // Churned mud on tracks and yards, with standing water in the ruts.
  float mudN = smoothstep(0.25, 0.75, loc.g + (d2.b - 0.5) * 0.5 + (d1.b - 0.5) * 0.3);
  vec3 mud = vec3(0.105, 0.083, 0.06) * (0.7 + 0.6 * d1.b);
  alb = mix(alb, mud, mudN * 0.92);
  float wet = mudN * smoothstep(0.42, 0.28, d2.b) * smoothstep(0.45, 0.65, d1.b + (d3.b - 0.5));
  alb *= 1.0 - wet * 0.55;

  // Fallen leaves under the trees.
  float litter = smoothstep(0.2, 0.8, loc.b + (d1.a - 0.5) * 0.7);
  alb = mix(alb, vec3(0.17, 0.10, 0.045) * (0.7 + 0.6 * d1.b), litter * 0.62);

  alb *= 1.0 - loc.r * 0.62;
  diffuseColor.rgb = alb;
  float groundRough = mix(0.97, 0.3, wet);
`;

const fragNormal = /* glsl */ `
  vec2 gn = (d1.rg - 0.5) * 1.4 * nearK + (d2.rg - 0.5) * 0.9;
  gn += fdir * cos(fph) * 1.1 * furrowAmp;
  gn *= 1.0 - wet;
  normal = normalize(normal + (viewMatrix * vec4(gn.x, 0.0, gn.y, 0.0)).xyz * 0.55);
`;

export function createTerrain({ scene, level, detailTex }) {
  const { terrain } = level;
  const fields = buildFieldMaps(level);
  const { localMap, tracks } = buildLocalMap(level);
  const heightTex = buildHeightTexture(terrain);

  const geo = new THREE.PlaneGeometry(terrain.size, terrain.size, terrain.segments, terrain.segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, terrain.heights[i]);
  geo.computeVertexNormals();

  const uniforms = {
    tFieldColor: { value: fields.fieldColor },
    tFieldData: { value: fields.fieldData },
    tLocal: { value: localMap },
    tDetail: { value: detailTex },
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  mat.defines = { LOCAL_SIZE: terrain.size.toFixed(1) };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = transformed;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + fragDecl)
      .replace('#include <map_fragment>', fragAlbedo)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = groundRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + fragNormal);
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  const skirtGeo = buildSkirt(terrain);
  const skirt = new THREE.Mesh(skirtGeo, mat);
  skirt.frustumCulled = false;
  scene.add(mesh, skirt);

  return {
    maps: { fieldColor: fields.fieldColor, fieldData: fields.fieldData, localMap, heightTex },
    tracks,
    dispose() {
      geo.dispose(); skirtGeo.dispose(); mat.dispose();
      fields.fieldColor.dispose(); fields.fieldData.dispose(); localMap.dispose(); heightTex.dispose();
    },
  };
}
