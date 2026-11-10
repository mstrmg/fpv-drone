// A small pool of soft sprites for dust and, later, smoke.
import * as THREE from 'three';
import { makeSoftParticleTexture } from './textures.js';

const vert = /* glsl */ `
  attribute vec2 aData; // size (m), alpha
  attribute vec3 aColor;
  uniform float uScale;
  varying float vAlpha;
  varying vec3 vColor;
  #include <fog_pars_vertex>
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = min(aData.x * uScale / max(-mvPosition.z, 0.05), 1200.0);
    vAlpha = aData.y;
    vColor = aColor;
    #include <fog_vertex>
  }
`;
const frag = /* glsl */ `
  uniform sampler2D tSprite;
  varying float vAlpha;
  varying vec3 vColor;
  #include <common>
  #include <fog_pars_fragment>
  void main() {
    float a = texture2D(tSprite, gl_PointCoord).a * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor, a);
    #include <fog_fragment>
  }
`;

export function createParticles({ scene, max = 700 }) {
  const pos = new Float32Array(max * 3), data = new Float32Array(max * 2), col = new Float32Array(max * 3);
  const live = [];
  const free = [];
  for (let i = max - 1; i >= 0; i--) free.push(i);
  const geo = new THREE.BufferGeometry();
  const aPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const aData = new THREE.BufferAttribute(data, 2).setUsage(THREE.DynamicDrawUsage);
  const aCol = new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', aPos); geo.setAttribute('aData', aData); geo.setAttribute('aColor', aCol);
  const tex = makeSoftParticleTexture();
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 800 }, tSprite: { value: null } }]),
    vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, fog: true,
  });
  mat.uniforms.tSprite.value = tex;
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 5;
  scene.add(points);

  function spawn(p) {
    if (!free.length) return;
    const i = free.pop();
    live.push({ i, age: 0, drag: 1.5, gravity: 0, grow: 1, alpha: 0.5, ...p, vel: [...p.vel], pos: [...p.pos] });
  }

  function update(dt, pixelsPerUnitAtOneMetre) {
    mat.uniforms.uScale.value = pixelsPerUnitAtOneMetre;
    for (let k = live.length - 1; k >= 0; k--) {
      const p = live[k];
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) { data[p.i * 2 + 1] = 0; free.push(p.i); live[k] = live[live.length - 1]; live.pop(); continue; }
      const damp = Math.exp(-p.drag * dt);
      p.vel[0] *= damp; p.vel[1] = p.vel[1] * damp - p.gravity * dt; p.vel[2] *= damp;
      p.pos[0] += p.vel[0] * dt; p.pos[1] += p.vel[1] * dt; p.pos[2] += p.vel[2] * dt;
      pos.set(p.pos, p.i * 3);
      data[p.i * 2] = p.size * (1 + p.grow * t);
      data[p.i * 2 + 1] = p.alpha * Math.min(1, t * 8) * (1 - t) * (1 - t);
      col.set(p.color, p.i * 3);
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
