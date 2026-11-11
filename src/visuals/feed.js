// The video feed. The scene is rendered to an HDR target, then one pass turns it into what the
// pilot's goggles show: a wide cheap lens, an analog transmission, and the flight controller's OSD
// burned into the picture. Chase view skips the analog part and only grades the image.
import * as THREE from 'three';

export const LENS_K = 0.16;

// The lens pass magnifies the centre, so the scene is rendered wider to keep the centre true to the sim's FOV.
export function lensFov(fovDeg, aspect) {
  const rc2 = 0.25 * (aspect * aspect + 1);
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2) * (1 + LENS_K * rc2)));
}

const vert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const frag = /* glsl */ `
  uniform sampler2D tScene, tOsd;
  uniform float uTime, uSignal, uJam, uLost, uGlitch, uAnalog, uAspect, uExposure, uOsd, uSpotter;
  varying vec2 vUv;
  const vec3 LW = vec3(0.299, 0.587, 0.114);

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise(float x) {
    float i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(hash12(vec2(i, 7.0)), hash12(vec2(i + 1.0, 7.0)), f);
  }
  vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
  vec3 develop(vec3 c) { return pow(aces(c * uExposure), vec3(1.0 / 2.2)); }

  vec2 lens(vec2 uv) {
    vec2 c = uv - 0.5;
    c.x *= uAspect;
    float rc2 = 0.25 * (uAspect * uAspect + 1.0);
    c *= (1.0 + ${LENS_K.toFixed(3)} * dot(c, c)) / (1.0 + ${LENS_K.toFixed(3)} * rc2);
    c.x /= uAspect;
    return c + 0.5;
  }

  vec3 src(vec2 uv) {
    vec3 c = develop(texture2D(tScene, mix(uv, lens(uv), uAnalog)).rgb);
    vec4 o = texture2D(tOsd, uv);
    return mix(c, o.rgb, o.a * uOsd);
  }

  void main() {
    vec2 uv = vUv;
    vec2 vc = vUv - 0.5;
    if (uAnalog < 0.5) {
      vec3 c = src(uv);
      c *= 1.0 - dot(vc, vc) * 0.35;
      if (uSpotter > 0.5) {
        // Long-lens digital camera: flatter, a little soft, hazy blacks, compression grain.
        c = mix(vec3(dot(c, LW)), c, 0.8) * 0.94 + 0.045;
        c += (hash12(floor(gl_FragCoord.xy / 2.0) + uTime * 30.0) - 0.5) * 0.03;
      }
      c += (hash12(gl_FragCoord.xy + uTime * 60.0) - 0.5) * 0.012;
      gl_FragColor = vec4(c, 1.0);
      return;
    }

    float bad = clamp((1.0 - uSignal) + uJam * 0.6 + uGlitch, 0.0, 1.5);
    float lines = 486.0;
    float ly = floor(uv.y * lines);
    float t = floor(uTime * 50.0);

    // Line jitter, tearing bands and, when the link is nearly gone, picture roll.
    uv.x += (hash12(vec2(ly, t)) - 0.5) * 0.004 * smoothstep(0.08, 1.0, bad);
    float band = vnoise(uv.y * 6.0 + uTime * 3.1);
    float tear = smoothstep(1.0 - bad * 0.55, 1.0, band);
    uv.x += tear * (hash12(vec2(ly * 0.13, t)) - 0.3) * 0.12 * bad;
    float roll = smoothstep(0.75, 1.0, bad) * fract(uTime * 0.7);
    uv.y = fract(uv.y + roll);

    // Analog bandwidth: soft luma with edge ringing, and chroma smeared much wider.
    float dx = 1.0 / 720.0;
    vec3 c0 = src(uv);
    vec3 cl = src(uv - vec2(dx, 0.0)), cr = src(uv + vec2(dx, 0.0));
    vec3 cl2 = src(uv - vec2(dx * 3.2, 0.0)), cr2 = src(uv + vec2(dx * 3.2, 0.0));
    float y0 = dot(c0, LW);
    float yb = dot(c0 * 0.44 + (cl + cr) * 0.28, LW);
    float y = yb + (y0 - dot((cl2 + cr2) * 0.5, LW)) * 0.3;
    vec3 chroma = (cl2 + cl + c0 + cr + cr2) * 0.2;
    chroma -= dot(chroma, LW);
    float sat = mix(1.06, 0.0, smoothstep(0.3, 0.95, bad));
    vec3 col = vec3(y) + chroma * sat;

    // Small-sensor camera response: hard contrast, a slightly cold cast.
    col = (col - 0.5) * 1.12 + 0.515;
    col *= vec3(0.985, 1.0, 1.0);

    float n = hash12(floor(gl_FragCoord.xy / 1.5) + vec2(t * 17.0, t * 29.0));
    col += (n - 0.5) * (0.04 + 0.55 * bad * bad);
    float snow = step(1.0 - 0.025 * bad * bad, hash12(floor(gl_FragCoord.xy / 2.0) + t * 1.3));
    col = mix(col, vec3(0.95), snow);
    col *= 1.0 - 0.05 * (0.5 + 0.5 * sin(gl_FragCoord.y * 2.0943951));
    col += smoothstep(0.6, 1.0, sin(vUv.y * 9.0 - uTime * 7.0)) * uJam * 0.22;

    vec3 stat = vec3(hash12(floor(gl_FragCoord.xy / 2.0) + t * 3.7)) * (0.5 + 0.5 * vnoise(vUv.y * 30.0 + uTime * 20.0));
    col = mix(col, stat, max(uLost, smoothstep(0.9, 1.25, bad)));

    col *= 1.0 - dot(vc, vc) * 0.6;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createFeed({ renderer }) {
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true });
  rt.texture.minFilter = rt.texture.magFilter = THREE.LinearFilter;
  const blank = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  blank.needsUpdate = true;
  const u = {
    tScene: { value: rt.texture }, tOsd: { value: blank },
    uTime: { value: 0 }, uSignal: { value: 1 }, uJam: { value: 0 }, uLost: { value: 0 }, uGlitch: { value: 0 },
    uSpotter: { value: 0 }, uAnalog: { value: 1 }, uAspect: { value: 1 }, uExposure: { value: 1 }, uOsd: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: vert, fragmentShader: frag, depthTest: false, depthWrite: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const postScene = new THREE.Scene();
  postScene.add(quad);
  const postCam = new THREE.Camera();

  return {
    uniforms: u,
    setSize(w, h, ratio) {
      rt.setSize(Math.max(2, Math.round(w * ratio)), Math.max(2, Math.round(h * ratio)));
      u.uAspect.value = w / h;
    },
    render(scene, camera) {
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(postScene, postCam);
    },
    dispose() { rt.dispose(); mat.dispose(); quad.geometry.dispose(); blank.dispose(); },
  };
}
