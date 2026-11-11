// A small pool of soft sprites for dust and, later, smoke.
import * as THREE from 'three';
import { mulberry32 } from './rng.js';

const vert = /* glsl */ `
  attribute vec3 iPos;
  attribute vec2 aData; // size (m), alpha
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  varying vec2 vUv;
  #include <fog_pars_vertex>
  void main() {
    // Camera-facing quad. Unlike GL points it has no size limit, so smoke can fill the view up close.
    vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
    mvPosition.xy += position.xy * aData.x;
    gl_Position = projectionMatrix * mvPosition;
    vUv = position.xy + 0.5;
    vAlpha = aData.y;
    vColor = aColor;
    #include <fog_vertex>
  }
`;
const frag = /* glsl */ `
  uniform sampler2D tSprite;
  varying float vAlpha;
  varying vec3 vColor;
  varying vec2 vUv;
  #include <common>
  #include <fog_pars_fragment>
  void main() {
    float a = texture2D(tSprite, vUv).r * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor, a);
    #include <fog_fragment>
  }
`;

// Soft, slightly lumpy puff.
function makeSprite() {
  const S = 64, data = new Uint8Array(S * S * 4), rand = mulberry32(8);
  const lumps = Array.from({ length: 7 }, () => [0.25 + rand() * 0.5, 0.25 + rand() * 0.5, 0.16 + rand() * 0.16]);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = (x + 0.5) / S, v = (y + 0.5) / S;
    const r = Math.hypot(u - 0.5, v - 0.5) * 2;
    let a = Math.max(0, 1 - r * r); a *= a;
    let l = 0;
    for (const [lx, ly, lr] of lumps) l += Math.max(0, 1 - Math.hypot(u - lx, v - ly) / lr);
    const val = Math.min(1, a * (0.55 + 0.3 * l)) * 255;
    data.fill(val, (y * S + x) * 4, (y * S + x) * 4 + 4);
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

export const WIND = [1.5, 0, 0.6]; // m/s, drifts smoke

export function createParticles({ scene, max = 700, additive = false }) {
  const pos = new Float32Array(max * 3), data = new Float32Array(max * 2), col = new Float32Array(max * 3);
  const live = [];
  const free = [];
  for (let i = max - 1; i >= 0; i--) free.push(i);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const aPos = new THREE.InstancedBufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const aData = new THREE.InstancedBufferAttribute(data, 2).setUsage(THREE.DynamicDrawUsage);
  const aCol = new THREE.InstancedBufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', aPos); geo.setAttribute('aData', aData); geo.setAttribute('aColor', aCol);
  geo.instanceCount = max;
  const tex = makeSprite();
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { tSprite: { value: null } }]),
    vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, fog: !additive,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  mat.uniforms.tSprite.value = tex;
  const points = new THREE.Mesh(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 5;
  scene.add(points);

  function spawn(p) {
    if (!free.length) return;
    const i = free.pop();
    live.push({ i, age: 0, drag: 1.5, gravity: 0, grow: 1, alpha: 0.5, wind: 0, fadeIn: 8, ...p, vel: [...p.vel], pos: [...p.pos] });
  }

  function update(dt) {
    for (let k = live.length - 1; k >= 0; k--) {
      const p = live[k];
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) { data[p.i * 2 + 1] = 0; free.push(p.i); live[k] = live[live.length - 1]; live.pop(); continue; }
      const damp = Math.exp(-p.drag * dt);
      p.vel[0] *= damp; p.vel[1] = p.vel[1] * damp - p.gravity * dt; p.vel[2] *= damp;
      p.pos[0] += (p.vel[0] + WIND[0] * p.wind) * dt; p.pos[1] += p.vel[1] * dt; p.pos[2] += (p.vel[2] + WIND[2] * p.wind) * dt;
      if (p.floor !== undefined && p.pos[1] < p.floor) { p.pos[1] = p.floor; p.vel[1] = 0; }
      pos.set(p.pos, p.i * 3);
      data[p.i * 2] = p.size * (1 + p.grow * t);
      data[p.i * 2 + 1] = p.alpha * Math.min(1, t * p.fadeIn) * (1 - t) * (1 - t);
      if (p.colorEnd) {
        const c = p.color, e = p.colorEnd, o = p.i * 3;
        col[o] = c[0] + (e[0] - c[0]) * t; col[o + 1] = c[1] + (e[1] - c[1]) * t; col[o + 2] = c[2] + (e[2] - c[2]) * t;
      } else col.set(p.color, p.i * 3);
    }
    aPos.needsUpdate = aData.needsUpdate = aCol.needsUpdate = true;
  }

  function clear() {
    for (const p of live) { data[p.i * 2 + 1] = 0; free.push(p.i); }
    live.length = 0;
  }

  // A burst of ground dust, used for knocks, crashes and prop wash.
  function dust(position, { count = 10, speed = 2, size = 0.6, life = 1.6, up = 1, alpha = 0.45 } = {}) {
    for (let n = 0; n < count; n++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.9);
      const k = 0.75 + Math.random() * 0.4;
      spawn({
        pos: [position[0] + Math.cos(a) * 0.1, position[1] + 0.05 + Math.random() * 0.15, position[2] + Math.sin(a) * 0.1],
        vel: [Math.cos(a) * s, up * (0.3 + Math.random()) * speed * 0.5, Math.sin(a) * s],
        size: size * (0.6 + Math.random() * 0.8), grow: 2.5, life: life * (0.6 + Math.random() * 0.8),
        color: [0.30 * k, 0.26 * k, 0.2 * k], alpha, drag: 2.2, gravity: -0.15,
      });
    }
  }

  return { spawn, dust, update, clear, dispose() { scene.remove(points); geo.dispose(); mat.dispose(); tex.dispose(); } };
}
