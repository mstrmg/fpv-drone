// Sky, sun, haze and image-based ambient light: a heavy late-autumn overcast.
import * as THREE from 'three';

export const SUN_DIR = new THREE.Vector3(0.52, 0.42, 0.74).normalize();
export const FOG_COLOR = new THREE.Color().setRGB(0.60, 0.635, 0.66);
export const FOG_DENSITY = 0.00062;

const skyVert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
    gl_Position.z = gl_Position.w; // pin to the far plane
  }
`;

const skyFrag = /* glsl */ `
  uniform sampler2D tNoise;
  uniform vec3 sunDir;
  uniform vec3 fogColor;
  uniform float time;
  uniform float forEnv;
  varying vec3 vDir;

  float fbm(vec2 p) {
    float a = texture2D(tNoise, p).b;
    float b = texture2D(tNoise, p * 2.7 + 0.31).b;
    float c = texture2D(tNoise, p * 7.3 + 0.67).b;
    return a * 0.6 + b * 0.28 + c * 0.12;
  }

  void main() {
    vec3 d = normalize(vDir);
    float e = d.y;
    // Cloud deck on a flat ceiling above the camera.
    vec2 cp = d.xz / (max(e, 0.0) + 0.16);
    vec2 wind = vec2(time * 0.0016, time * 0.0007);
    float c1 = fbm(cp * 0.085 + wind);
    float c2 = fbm(cp * 0.21 - wind * 1.7 + 3.1);
    float cloud = smoothstep(0.3, 0.72, c1 * 0.7 + c2 * 0.3);

    float sunAmt = max(dot(d, sunDir), 0.0);
    // Under-lit grey base, brighter where the deck is thin.
    vec3 dark = vec3(0.36, 0.39, 0.43);
    vec3 light = vec3(0.98, 0.98, 0.96);
    vec3 col = mix(light, dark, cloud);
    // Sunlight bleeding through around the sun.
    col += vec3(1.0, 0.9, 0.74) * (pow(sunAmt, 6.0) * 0.55 + pow(sunAmt, 60.0) * 1.6) * (1.0 - cloud * 0.72);
    // A few breaks of washed-out blue.
    float gap = smoothstep(0.34, 0.2, c1) * smoothstep(0.02, 0.3, e);
    col = mix(col, vec3(0.50, 0.66, 0.86), gap * 0.55);
    // The eye-visible sky is held back so cloud detail survives exposure; the light it casts is not.
    col *= forEnv > 0.5 ? 1.25 : 0.6;

    float haze = smoothstep(0.26, 0.0, e);
    col = mix(col, fogColor, haze * haze * (3.0 - 2.0 * haze) * 0.98 + 0.02);
    if (forEnv > 0.5 && e < 0.0) col = mix(fogColor, vec3(0.085, 0.078, 0.062), smoothstep(0.0, -0.12, e));
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createEnvironment({ scene, renderer, noiseTex }) {
  scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);
  scene.background = FOG_COLOR;

  const uniforms = {
    tNoise: { value: noiseTex },
    sunDir: { value: SUN_DIR },
    fogColor: { value: FOG_COLOR },
    time: { value: 0 },
    forEnv: { value: 0 },
  };
  const skyMat = new THREE.ShaderMaterial({
    uniforms, vertexShader: skyVert, fragmentShader: skyFrag,
    side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
  });
  const skyGeo = new THREE.SphereGeometry(1, 48, 24);
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.scale.setScalar(100);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);

  // Bake the sky into a prefiltered environment map so every surface gets soft overcast ambient light.
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(skyGeo, skyMat);
  envSky.scale.setScalar(100);
  envScene.add(envSky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  uniforms.forEnv.value = 1;
  const envRT = pmrem.fromScene(envScene, 0, 1, 1000);
  uniforms.forEnv.value = 0;
  pmrem.dispose();
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.85;

  // The sun is a weak, warm key light behind the cloud.
  const sun = new THREE.DirectionalLight(new THREE.Color().setRGB(1.0, 0.9, 0.76), 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const R = 120;
  Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: 600 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.25;
  sun.shadow.radius = 5;
  sun.shadow.intensity = 0.75;
  scene.add(sun, sun.target);

  const snap = (2 * R) / 2048 * 4;
  function update(camPos, time) {
    uniforms.time.value = time;
    sky.position.copy(camPos);
    // Shadow box follows the camera in whole-texel steps so shadow edges do not crawl.
    const tx = Math.round(camPos.x / snap) * snap, tz = Math.round(camPos.z / snap) * snap;
    sun.target.position.set(tx, 0, tz);
    sun.position.set(tx, 0, tz).addScaledVector(SUN_DIR, 300);
  }

  return {
    update,
    sun,
    sky, // follows the camera; move it along for a second camera far away
    dispose() { envRT.dispose(); skyGeo.dispose(); skyMat.dispose(); },
  };
}
