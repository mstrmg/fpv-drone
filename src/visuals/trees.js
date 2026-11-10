// Windbreak trees: real geometry for trunk and limbs, alpha-tested twig cards for the crown.
// Late autumn, so most crowns are bare twigs with a few trees still holding rust-coloured leaves.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, hashString } from './rng.js';
import { makeTwigTexture } from './textures.js';

const REF_H = 13, REF_R = 3.5; // the proportions the template trees are modelled at

function limb(p0, p1, r0, r1, sides = 5) {
  const dir = new THREE.Vector3().subVectors(p1, p0);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, sides, 1, true);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.applyQuaternion(q);
  g.translate(p0.x, p0.y, p0.z);
  return g;
}

function card(anchor, width, height, yaw, tilt, out) {
  // A quad standing on `anchor`, emitted twice so both sides shade the same way.
  const right = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, Math.cos(yaw));
  const up = new THREE.Vector3(0, Math.cos(tilt), 0).addScaledVector(fwd, Math.sin(tilt));
  const a = anchor.clone().addScaledVector(right, -width / 2);
  const b = anchor.clone().addScaledVector(right, width / 2);
  const c = b.clone().addScaledVector(up, height);
  const d = a.clone().addScaledVector(up, height);
  const centre = anchor.clone().addScaledVector(up, height * 0.5);
  const n = new THREE.Vector3(centre.x / REF_R * 0.8, 0.75, centre.z / REF_R * 0.8).normalize();
  const base = out.pos.length / 3;
  for (const p of [a, b, c, d]) { out.pos.push(p.x, p.y, p.z); out.nrm.push(n.x, n.y, n.z); }
  out.uv.push(0, 0, 1, 0, 1, 1, 0, 1);
  out.idx.push(base, base + 1, base + 2, base, base + 2, base + 3, base, base + 2, base + 1, base, base + 3, base + 2);
}

function buildTemplate(seed) {
  const rand = mulberry32(seed);
  const wood = [];
  const cards = { pos: [], nrm: [], uv: [], idx: [] };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  // Trunk, slightly crooked.
  const lean = () => (rand() - 0.5) * 0.9;
  const spine = [V(0, -0.4, 0), V(lean() * 0.4, 3.4, lean() * 0.4), V(lean(), 7.0, lean()), V(lean(), 10.6, lean())];
  const radii = [0.3, 0.21, 0.14, 0.05];
  for (let i = 0; i < 3; i++) wood.push(limb(spine[i], spine[i + 1], radii[i], radii[i + 1], 6));
  const onTrunk = (y) => {
    for (let i = 0; i < 3; i++) if (y <= spine[i + 1].y) return spine[i].clone().lerp(spine[i + 1], (y - spine[i].y) / (spine[i + 1].y - spine[i].y));
    return spine[3].clone();
  };

  const anchors = [spine[3].clone().setY(9.6)];
  const count = 6 + Math.floor(rand() * 3);
  for (let i = 0; i < count; i++) {
    const y = 3.6 + (i / count) * 5.6 + rand() * 0.6;
    const start = onTrunk(y);
    const az = (i / count) * Math.PI * 2 * 1.618 + rand() * 0.8;
    const el = 0.35 + rand() * 0.6;
    const len = 1.8 + rand() * 1.5;
    const dir = V(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    const end = start.clone().addScaledVector(dir, len);
    wood.push(limb(start, end, 0.1 + (1 - i / count) * 0.05, 0.035, 5));
    anchors.push(end);
    const mid = start.clone().lerp(end, 0.55);
    const az2 = az + (rand() < 0.5 ? 1 : -1) * (0.7 + rand() * 0.5);
    const end2 = mid.clone().add(V(Math.cos(az2) * 1.2, 0.9 + rand() * 0.6, Math.sin(az2) * 1.2));
    wood.push(limb(mid, end2, 0.05, 0.02, 4));
    anchors.push(end2);
  }
  for (const a of anchors) {
    const reach = Math.max(1.6, Math.min(4.2, REF_H - a.y + 0.4));
    card(a.clone().setY(a.y - 0.5), 3.0 + rand() * 1.4, reach, rand() * Math.PI, (rand() - 0.5) * 0.5, cards);
  }
  // Two large cards through the middle give the crown its outline from a distance.
  const y0 = 4.0, yaw = rand() * Math.PI;
  card(V(0, y0, 0), REF_R * 2.15, REF_H - y0 + 0.3, yaw, 0, cards);
  card(V(0, y0, 0), REF_R * 2.15, REF_H - y0 + 0.3, yaw + Math.PI / 2 + (rand() - 0.5) * 0.4, 0, cards);

  const woodGeo = mergeGeometries(wood.map((g) => { g.deleteAttribute('uv'); return g; }));
  const cardGeo = new THREE.BufferGeometry();
  cardGeo.setAttribute('position', new THREE.Float32BufferAttribute(cards.pos, 3));
  cardGeo.setAttribute('normal', new THREE.Float32BufferAttribute(cards.nrm, 3));
  cardGeo.setAttribute('uv', new THREE.Float32BufferAttribute(cards.uv, 2));
  cardGeo.setIndex(cards.idx);
  return { woodGeo, cardGeo };
}

export function createTrees({ scene, level }) {
  const trees = level.objects.filter((o) => o.kind === 'tree');
  const timeU = { value: 0 };
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x4b4239, roughness: 1 });
  const disposables = [woodMat];

  const variants = [0.0, 0.04, 0.14, 0.55, 0.9].map((leaves, i) => {
    const tex = makeTwigTexture(300 + i * 13, leaves);
    const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.22, alphaToCoverage: true, roughness: 1 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = timeU;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            float swayPh = dot(instanceMatrix[3].xyz, vec3(0.31, 0.0, 0.23));
            float swayK = max(position.y - 4.0, 0.0) * 0.012;
            transformed.x += sin(uTime * 1.1 + swayPh + position.y * 0.3) * swayK;
            transformed.z += sin(uTime * 0.83 + swayPh * 1.7) * swayK * 0.7;
          #endif`);
    };
    disposables.push(tex, mat);
    return { ...buildTemplate(900 + i * 71), mat, list: [], leaves };
  });

  for (const t of trees) {
    const h = hashString(t.id);
    const r = (h % 1000) / 1000;
    const v = r < 0.62 ? Math.floor(r / 0.62 * 3) : 3 + (h % 2);
    variants[v].list.push(t);
  }

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const col = new THREE.Color();
  const meshes = [];
  for (const v of variants) {
    if (!v.list.length) continue;
    const wood = new THREE.InstancedMesh(v.woodGeo, woodMat, v.list.length);
    const crown = new THREE.InstancedMesh(v.cardGeo, v.mat, v.list.length);
    v.list.forEach((t, i) => {
      const rand = mulberry32(hashString(t.id) + 5);
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rand() * Math.PI * 2);
      s.set(t.radius / REF_R, t.height / REF_H, t.radius / REF_R);
      p.fromArray(t.position);
      m4.compose(p, q, s);
      wood.setMatrixAt(i, m4);
      crown.setMatrixAt(i, m4);
      const k = 0.8 + rand() * 0.35;
      wood.setColorAt(i, col.setRGB(k, k * (0.96 + rand() * 0.08), k * (0.92 + rand() * 0.1)));
      const c = 0.78 + rand() * 0.4;
      crown.setColorAt(i, col.setRGB(c, c * (0.94 + rand() * 0.1), c * (0.86 + rand() * 0.16)));
    });
    for (const m of [wood, crown]) {
      m.castShadow = true;
      m.receiveShadow = false;
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
      scene.add(m);
      meshes.push(m);
    }
    disposables.push(v.woodGeo, v.cardGeo);
  }

  return {
    update(time) { timeU.value = time; },
    dispose() { meshes.forEach((m) => { scene.remove(m); m.dispose(); }); disposables.forEach((d) => d.dispose()); },
  };
}
