// Village houses, apartment blocks and sheds. Each one fills the collision box the sim gave it.
import * as THREE from 'three';
import { mulberry32, hashString } from './rng.js';
import { makeWallTexture, makeRoofTexture, makePlankTexture } from './textures.js';

class Builder {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.idx = []; }
  poly(pts, uvs, m) {
    const base = this.pos.length / 3;
    const v = pts.map((p) => new THREE.Vector3(...p).applyMatrix4(m));
    const n = new THREE.Vector3().subVectors(v[1], v[0]).cross(new THREE.Vector3().subVectors(v[v.length - 1], v[0])).normalize();
    v.forEach((p, i) => { this.pos.push(p.x, p.y, p.z); this.nrm.push(n.x, n.y, n.z); this.uv.push(uvs[i][0], uvs[i][1]); });
    for (let i = 1; i < v.length - 1; i++) this.idx.push(base, base + i, base + i + 1);
  }
  box(cx, cy, cz, w, h, d, m, uvScale = 1) {
    const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    const q = (a, b, c, e, uw, uh) => this.poly([a, b, c, e], [[0, 0], [uw * uvScale, 0], [uw * uvScale, uh * uvScale], [0, uh * uvScale]], m);
    q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], w, h);
    q([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], w, h);
    q([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], d, h);
    q([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], d, h);
    q([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], w, d);
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

const HOUSE_STYLES = [
  { kind: 'plaster', rgb: [212, 206, 194], frame: '#587f9e' },
  { kind: 'plaster', rgb: [203, 188, 148], frame: '#e2ddd0' },
  { kind: 'brick', rgb: [194, 190, 180], mortar: '#8f8a80', frame: '#e2ddd0' },
  { kind: 'brick', rgb: [148, 84, 62], mortar: '#9a9488', frame: '#d8d2c4' },
].map((s) => ({ ...s, window: [0.3, 0.3, 0.4, 0.34], plinth: 0.13, plinthColor: '#5b5650' }));
const BLOCK_STYLE = { kind: 'panel', rgb: [152, 151, 146], frame: '#cfcabd', window: [0.24, 0.24, 0.52, 0.46] };
const SHED_STYLE = { kind: 'panel', rgb: [128, 133, 134], frame: '#6f7478', window: [0.08, 0.1, 0.84, 0.16] };

export function createBuildings({ scene, level }) {
  const buildings = level.objects.filter((o) => o.kind === 'building');
  const mats = new Map();
  const builders = new Map();
  const disposables = [];
  const material = (key, make) => {
    if (!mats.has(key)) { const m = make(); mats.set(key, m); builders.set(key, new Builder()); }
    return builders.get(key);
  };
  const wall = (style, damaged, key) => material(`wall:${key}:${damaged}`, () => {
    const tex = makeWallTexture({ ...style, damaged }, hashString(key) + (damaged ? 17 : 0));
    disposables.push(tex);
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92 });
  });
  const roof = (kind) => material(`roof:${kind}`, () => {
    const tex = makeRoofTexture(kind, hashString(kind));
    disposables.push(tex);
    return new THREE.MeshStandardMaterial({ map: tex, roughness: kind === 'slate' ? 0.9 : 0.6, metalness: kind === 'rust' ? 0.25 : 0, side: THREE.DoubleSide });
  });
  const planks = () => material('planks', () => {
    const tex = makePlankTexture();
    disposables.push(tex);
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
  });
  const concrete = () => material('concrete', () => new THREE.MeshStandardMaterial({ color: 0x6f6d68, roughness: 0.95 }));

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  for (const b of buildings) {
    const rand = mulberry32(hashString(b.id) + level.seed);
    let [w, h, d] = b.size;
    let rot = b.rotationY;
    const flat = h > 9 || w >= 20 || d >= 20;
    if (!flat && d > w) { [w, d] = [d, w]; rot += Math.PI / 2; } // ridge runs along the long side
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rot);
    m.compose(new THREE.Vector3(b.position[0], b.position[1] - 0.6, b.position[2]), q, one);
    const y0 = 0, base = 0.6; // walls start below ground so slopes never show a gap
    const hx = w / 2, hz = d / 2;
    const walls = (builder, top, bay, vRepeat) => {
      const uw = Math.max(1, Math.round(w / bay)), ud = Math.max(1, Math.round(d / bay));
      const v0 = -base / (top / vRepeat);
      const f = (a, c, u) => builder.poly([[a[0], y0, a[1]], [c[0], y0, c[1]], [c[0], top + base, c[1]], [a[0], top + base, a[1]]], [[0, v0], [u, v0], [u, vRepeat], [0, vRepeat]], m);
      f([-hx, hz], [hx, hz], uw); f([hx, hz], [hx, -hz], ud); f([hx, -hz], [-hx, -hz], uw); f([-hx, -hz], [-hx, hz], ud);
    };

    if (flat) {
      const shed = h <= 12;
      const style = shed ? SHED_STYLE : BLOCK_STYLE;
      const damaged = rand() < 0.35;
      const top = h - 0.3;
      const floors = shed ? Math.max(1, Math.round(top / 5)) : Math.max(1, Math.round(top / 3));
      walls(wall(style, damaged, shed ? 'shed' : 'block'), top, shed ? 5 : 3.2, floors);
      const r = roof('tar');
      r.box(0, top + base + 0.15, 0, w + 0.5, 0.3, d + 0.5, m, 0.25);
    } else {
      const si = Math.floor(rand() * HOUSE_STYLES.length);
      const damaged = rand() < 0.3;
      const wallTop = h * 0.6;
      walls(wall(HOUSE_STYLES[si], damaged, `house${si}`), wallTop, 3.4, 1);
      const o = 0.45, yT = wallTop + base, yR = h + base;
      const drop = o * (yR - yT) / hz;
      const ey = yT - drop, ez = hz + o, ex = hx + o;
      const r = roof(rand() < 0.6 ? 'slate' : 'rust');
      const slope = Math.hypot(ez, yR - ey);
      const ru = (2 * ex) / 2.4, rv = slope / 2.4;
      r.poly([[-ex, ey, ez], [ex, ey, ez], [ex, yR, 0], [-ex, yR, 0]], [[0, 0], [ru, 0], [ru, rv], [0, rv]], m);
      r.poly([[ex, ey, -ez], [-ex, ey, -ez], [-ex, yR, 0], [ex, yR, 0]], [[0, 0], [ru, 0], [ru, rv], [0, rv]], m);
      const p = planks();
      const gu = d / 2.5, gv = (yR - yT) / 2.5;
      p.poly([[hx, yT, hz], [hx, yT, -hz], [hx, yR, 0]], [[0, 0], [gu, 0], [gu / 2, gv]], m);
      p.poly([[-hx, yT, -hz], [-hx, yT, hz], [-hx, yR, 0]], [[0, 0], [gu, 0], [gu / 2, gv]], m);
      // Chimney, kept inside the collision box.
      const cxp = (rand() - 0.5) * hx, czp = hz * 0.35;
      concrete().box(cxp, yR - 0.55, czp, 0.55, 1.1, 0.55, m);
    }
  }

  const meshes = [];
  for (const [key, builder] of builders) {
    if (!builder.idx.length) continue;
    const mesh = new THREE.Mesh(builder.build(), mats.get(key));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    meshes.push(mesh);
  }
  return {
    dispose() {
      meshes.forEach((x) => { scene.remove(x); x.geometry.dispose(); });
      mats.forEach((x) => x.dispose());
      disposables.forEach((x) => x.dispose());
    },
  };
}
