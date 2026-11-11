// Dirt roads: a ribbon draped over the terrain along every lane (level.props.lanes), with a
// packed-earth texture: two wheel ruts with standing water, a grassy crown, ragged soft edges.
// The terrain shader still paints mud under them; the ribbon gives the road its shape up close.

import * as THREE from 'three';
import { canvasTexture } from './textures.js';
import { mulberry32 } from './rng.js';

const WIDTH = 5.2;        // m
const TILE = 14;          // m of road per texture repeat
const STEP = 3;           // m between cross-sections

function roadTexture() {
  const W = 128, H = 512, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d'), rand = mulberry32(31);
  const img = g.createImageData(W, H), d = img.data;
  // Smooth 1D noise along the road, so ruts and edges wander.
  const wob = (v, f, s) => Math.sin(v * f + s) * 0.5 + Math.sin(v * f * 2.3 + s * 1.7) * 0.3 + Math.sin(v * f * 5.1 + s * 0.3) * 0.2;
  for (let y = 0; y < H; y++) {
    const v = (y / H) * Math.PI * 2; // tiles along v
    const edgeL = 0.06 + 0.05 * wob(v, 3, 1), edgeR = 0.94 + 0.05 * wob(v, 3, 4);
    const rutL = 0.3 + 0.02 * wob(v, 2, 2), rutR = 0.7 + 0.02 * wob(v, 2, 5);
    const wetL = wob(v, 4, 7) > 0.35, wetR = wob(v, 4, 9) > 0.45;
    for (let x = 0; x < W; x++) {
      const u = x / W, n = rand();
      // Packed earth, a little lighter where it is dry and worn.
      let r = 128, gg = 116, b = 96;
      const k = 0.82 + 0.3 * n;
      r *= k; gg *= k; b *= k;
      // Wheel ruts: darker, wetter, with water lying in the deep parts.
      for (const [cx, wet] of [[rutL, wetL], [rutR, wetR]]) {
        const t = Math.max(0, 1 - Math.abs(u - cx) / 0.09);
        r *= 1 - 0.45 * t; gg *= 1 - 0.43 * t; b *= 1 - 0.4 * t;
        if (wet && t > 0.55) { r = 60 + 25 * n; gg = 62 + 25 * n; b = 60 + 22 * n; }
      }
      // Grass on the crown between the ruts, and along the verges.
      const crown = Math.max(0, 1 - Math.abs(u - 0.5) / 0.1) * (0.6 + 0.4 * wob(v, 6, 3));
      const verge = Math.max(0, 1 - Math.min(Math.abs(u - edgeL), Math.abs(u - edgeR)) / 0.08);
      const grass = Math.min(1, crown * 0.8 + verge * 0.7) * (n > 0.35 ? 1 : 0.4);
      r += (78 - r) * grass; gg += (84 - gg) * grass; b += (48 - b) * grass;
      // Ragged edges fade into the field.
      const inside = Math.min(u - edgeL, edgeR - u);
      const a = Math.max(0, Math.min(1, inside / 0.07 + (n - 0.5) * 0.5));
      const i = (y * W + x) * 4;
      d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = a * 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = canvasTexture(c, { repeat: true });
  t.wrapS = THREE.ClampToEdgeWrapping;
  return t;
}

export function createRoads({ scene, level }) {
  const segs = level.props?.lanes ?? [];
  if (!segs.length) return { dispose() {} };
  const T = level.terrain, half = T.size / 2 - 1;
  const holes = level.terrainHoles ?? [];
  const inHole = (x, z) => holes.some(([x0, z0, x1, z1]) => x > x0 - 2 && x < x1 + 2 && z > z0 - 2 && z < z1 + 2);

  // Chain the 2-point segments back into polylines.
  const lines = [];
  for (const [a, b] of segs) {
    const last = lines[lines.length - 1];
    if (last && last[last.length - 1][0] === a[0] && last[last.length - 1][1] === a[1]) last.push(b);
    else lines.push([a, b]);
  }

  const pos = [], uv = [], idx = [];
  for (const pl of lines) {
    // Resample every STEP m.
    const pts = [];
    for (let i = 0; i < pl.length - 1; i++) {
      const [x0, z0] = pl[i], [x1, z1] = pl[i + 1];
      const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(L / STEP));
      for (let k = 0; k < n; k++) pts.push([x0 + (x1 - x0) * k / n, z0 + (z1 - z0) * k / n]);
    }
    pts.push(pl[pl.length - 1]);
    let dist = 0, base = -1;
    for (let i = 0; i < pts.length; i++) {
      const [x, z] = pts[i];
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1];
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      if (i > 0) dist += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
      const ok = Math.abs(x) < half && Math.abs(z) < half && !inHole(x, z);
      if (!ok) { base = -1; continue; }
      const v0 = pos.length / 3;
      for (const s of [-1, 1]) {
        const px = x + tz * s * WIDTH / 2, pz = z - tx * s * WIDTH / 2;
        pos.push(px, T.heightAt(px, pz) + 0.2, pz);
        uv.push(s < 0 ? 0 : 1, dist / TILE);
      }
      if (base >= 0) idx.push(base, v0, base + 1, base + 1, v0, v0 + 1);
      base = v0;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const map = roadTexture();
  const mat = new THREE.MeshStandardMaterial({
    map, transparent: true, depthWrite: false, roughness: 0.92, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -16,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.renderOrder = -1;
  scene.add(mesh);
  return {
    dispose() { scene.remove(mesh); geo.dispose(); mat.dispose(); map.dispose(); },
  };
}
