// Dry grass tufts that follow the camera. Placement, height and tint come from the same maps the
// ground shader reads, so grass only grows where the ground says it should.
import * as THREE from 'three';
import { mulberry32 } from './rng.js';
import { makeGrassTexture } from './textures.js';

const vert = /* glsl */ `
  uniform vec3 uCam;
  uniform float uTime, uTile, uSize, uSeg, uLight;
  uniform sampler2D tHeight, tFieldColor, tFieldData, tLocal;
  attribute vec4 aOff;
  varying vec2 vUv;
  varying vec3 vCol;
  #include <fog_pars_vertex>

  void main() {
    // Wrap each tuft into the tile centred on the camera.
    vec2 w = aOff.xy + floor((uCam.xz - aOff.xy) / uTile + 0.5) * uTile;
    float dist = length(w - uCam.xz);
    float R = uTile * 0.5;
    float fade = 1.0 - smoothstep(R * 0.5, R * 0.97, dist);

    vec2 tuv = w / uSize + 0.5;
    float inside = step(abs(tuv.x - 0.5), 0.499) * step(abs(tuv.y - 0.5), 0.499);
    float h = texture2D(tHeight, (tuv * uSeg + 0.5) / (uSeg + 1.0)).r;
    vec2 fuv = w / 4096.0 + 0.5;
    vec3 fdat = texture2D(tFieldData, fuv).rgb;
    vec3 fcol = texture2D(tFieldColor, fuv).rgb;
    vec3 loc = texture2D(tLocal, tuv).rgb;

    float dens = fdat.g * (1.0 - smoothstep(0.12, 0.45, loc.g));
    float show = step(0.5 + aOff.z * 0.45, dens);
    float hgt = (0.2 + 0.5 * aOff.w) * mix(0.5, 1.0, dens) * fade * show * inside;
    float wid = 0.5 + 0.45 * aOff.z;

    float a = aOff.w * 6.2831853;
    float ca = cos(a), sa = sin(a);
    vec3 p = position;
    p.xz = vec2(ca * p.x - sa * p.z, sa * p.x + ca * p.z) * wid;
    p.y *= hgt;
    float wph = uTime * 1.7 + w.x * 0.35 + w.y * 0.27;
    p.xz += vec2(sin(wph), cos(wph * 0.8)) * 0.07 * uv.y * uv.y * hgt * 2.0;

    vec3 straw = vec3(0.40, 0.36, 0.24);
    vec3 col = mix(fcol * 1.2, straw, 0.2 + 0.4 * aOff.z);
    col *= mix(0.8, 1.25, uv.y) * (0.82 + 0.36 * fract(aOff.w * 7.3));
    col *= (1.0 - loc.r * 0.6) * uLight;
    vCol = col;
    vUv = uv;

    vec4 mvPosition = viewMatrix * vec4(vec3(w.x, h, w.y) + p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const frag = /* glsl */ `
  uniform sampler2D tBlades;
  varying vec2 vUv;
  varying vec3 vCol;
  #include <common>
  #include <fog_pars_fragment>
  void main() {
    vec4 t = texture2D(tBlades, vUv);
    if (t.a < 0.4) discard;
    gl_FragColor = vec4(vCol * t.rgb, 1.0);
    #include <fog_fragment>
  }
`;

export function createGrass({ scene, level, maps, count = 52000, tile = 110 }) {
  const quads = [];
  const uvs = [];
  const idx = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI, c = Math.cos(a) * 0.5, s = Math.sin(a) * 0.5;
    const b = k * 4;
    quads.push(-c, 0, -s, c, 0, s, c, 1, s, -c, 1, -s);
    const u0 = k / 3 + 0.004, u1 = (k + 1) / 3 - 0.004;
    uvs.push(u0, 0, u1, 0, u1, 1, u0, 1);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(quads, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  const rand = mulberry32(4242);
  const off = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) off.set([rand() * tile, rand() * tile, rand(), rand()], i * 4);
  geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
  geo.instanceCount = count;

  const blades = makeGrassTexture();
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uTile: { value: tile },
      uSize: { value: level.terrain.size }, uSeg: { value: level.terrain.segments }, uLight: { value: 1.3 },
      tHeight: { value: null }, tFieldColor: { value: null }, tFieldData: { value: null }, tLocal: { value: null }, tBlades: { value: null },
    }]),
    vertexShader: vert, fragmentShader: frag, side: THREE.DoubleSide, fog: true,
  });
  // merge() clones values, so textures are assigned afterwards.
  mat.uniforms.tHeight.value = maps.heightTex;
  mat.uniforms.tFieldColor.value = maps.fieldColor;
  mat.uniforms.tFieldData.value = maps.fieldData;
  mat.uniforms.tLocal.value = maps.localMap;
  mat.uniforms.tBlades.value = blades;

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  scene.add(mesh);

  return {
    update(camPos, time, heightAboveGround) {
      mesh.visible = heightAboveGround < 90;
      mat.uniforms.uCam.value.copy(camPos);
      mat.uniforms.uTime.value = time;
    },
    dispose() { scene.remove(mesh); geo.dispose(); mat.dispose(); blades.dispose(); },
  };
}
