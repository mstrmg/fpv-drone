// Visuals entry point. Implements the Visuals API in ARCHITECTURE.md: everything that is drawn.
import * as THREE from 'three';
import { makeDetailTexture } from './textures.js';
import { createEnvironment } from './environment.js';
import { createTerrain } from './terrain.js';
import { createTrees } from './trees.js';
import { createGrass } from './grass.js';
import { createBuildings } from './buildings.js';
import { createDrone } from './drone.js';
import { createParticles } from './particles.js';
import { createFeed, lensFov } from './feed.js';
import { createOSD } from './osd.js';

const QUALITY = {
  low: { ratio: 1, shadows: false, grass: 16000 },
  medium: { ratio: 1.25, shadows: true, grass: 32000 },
  high: { ratio: 1.5, shadows: true, grass: 52000 },
};

export function createVisuals({ canvas, uiRoot, level }) {
  const params = new URLSearchParams(location.search);
  const quality = QUALITY[params.get('q')] ?? QUALITY.high;
  // Preview overrides for the feed, e.g. ?signal=0.4&jam=0.5
  const override = { signal: params.get('signal'), jam: params.get('jam'), lost: params.get('lost') };

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(78, 1, 0.05, 9000);

  const detailTex = makeDetailTexture(512);
  const env = createEnvironment({ scene, renderer, noiseTex: detailTex });
  const terrain = createTerrain({ scene, level, detailTex });
  const trees = createTrees({ scene, level });
  const buildings = createBuildings({ scene, level });
  const grass = createGrass({ scene, level, maps: terrain.maps, count: quality.grass });
  const drone = createDrone({ scene });
  const particles = createParticles({ scene });
  const feed = createFeed({ renderer });
  const osd = createOSD();
  feed.uniforms.tOsd.value = osd.texture;
  feed.uniforms.uExposure.value = 0.82;

  // DOM overlay: things that are not part of the video feed.
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;font-family:ui-monospace,Menlo,Consolas,monospace;color:#e9e9e4;';
  const help = document.createElement('div');
  help.style.cssText = 'position:absolute;left:50%;bottom:3.2%;transform:translateX(-50%);font-size:12px;letter-spacing:.04em;padding:6px 12px;background:rgba(0,0,0,.45);border-radius:3px;white-space:nowrap;transition:opacity 2s;';
  help.textContent = 'W/S throttle · A/D yaw · arrows pitch/roll · Space arm · R reset · M mode · V view · P pause';
  const paused = document.createElement('div');
  paused.style.cssText = 'position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.45);font-size:28px;letter-spacing:.5em;text-indent:.5em;';
  paused.textContent = 'PAUSED';
  overlay.append(help, paused);
  uiRoot.appendChild(overlay);
  const helpTimer = setTimeout(() => { help.style.opacity = '0'; }, 14000);

  let time = 0, glitch = 0, shake = 0, height = 1, washAcc = 0, lastView = null;
  const q = new THREE.Quaternion(), v = new THREE.Vector3(), fwd = new THREE.Vector3();
  const chasePos = new THREE.Vector3(), chaseLook = new THREE.Vector3(), lookTarget = new THREE.Vector3();
  const debug = { renderer, scene, camera, freeCam: null };
  window.__fpvVisuals = debug;

  function handleEvents(state, events) {
    for (const ev of events) {
      if (ev.type === 'collision') {
        const k = Math.min(1, ev.impactSpeed / 12);
        glitch = Math.max(glitch, 0.25 + k * 0.5);
        shake = Math.max(shake, 0.3 + k * 0.7);
        particles.dust(ev.position, { count: 6 + Math.round(k * 8), speed: 1 + k * 2.5 });
      } else if (ev.type === 'crash') {
        glitch = 1.4;
        shake = 1;
        const k = Math.min(1, ev.impactSpeed / 25);
        particles.dust(ev.position, { count: 26, speed: 2.5 + k * 5, size: 0.9, life: 2.6, alpha: 0.55 });
      } else if (ev.type === 'reset') {
        glitch = 0.5; shake = 0;
        particles.clear();
        lastView = null;
      } else if (ev.type === 'armed') {
        glitch = Math.max(glitch, 0.15);
      }
    }
  }

  function placeCamera(state, dt) {
    const fpv = state.view !== 'chase';
    const aspect = camera.aspect;
    if (debug.freeCam) {
      const f = debug.freeCam;
      camera.position.fromArray(f.position);
      camera.lookAt(lookTarget.fromArray(f.target));
      camera.fov = f.analog ? lensFov(f.fov ?? 78, aspect) : (f.fov ?? 60);
      return !!f.analog;
    }
    if (fpv) {
      camera.position.fromArray(state.camera.position);
      camera.quaternion.fromArray(state.camera.quaternion);
      camera.fov = lensFov(state.camera.fovDeg, aspect);
      if (shake > 0.001) {
        // Knocks rattle the camera for a moment; the pose itself still comes from the sim.
        camera.rotateX(Math.sin(time * 71) * 0.012 * shake);
        camera.rotateZ(Math.sin(time * 53 + 1.3) * 0.02 * shake);
      }
      return true;
    }
    // Chase: behind and above, following yaw only, eased so it feels like a camera operator.
    const d = state.drone;
    q.fromArray(d.quaternion);
    fwd.set(0, 0, -1).applyQuaternion(q);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();
    v.fromArray(d.position).addScaledVector(fwd, -1.25);
    v.y += 0.42;
    v.y = Math.max(v.y, level.terrain.heightAt(v.x, v.z) + 0.25);
    lookTarget.fromArray(d.position).addScaledVector(fwd, 1.5);
    if (lastView !== 'chase') { chasePos.copy(v); chaseLook.copy(lookTarget); }
    const k = 1 - Math.exp(-dt * 9);
    chasePos.lerp(v, k);
    chaseLook.lerp(lookTarget, 1 - Math.exp(-dt * 14));
    camera.position.copy(chasePos);
    camera.lookAt(chaseLook);
    camera.fov = 58;
    return false;
  }

  function update(state, events, dt) {
    time += dt;
    handleEvents(state, events);
    glitch = Math.max(state.drone.crashed ? 0.32 : 0, glitch - dt * (glitch > 0.6 ? 2.2 : 0.9));
    shake = Math.max(0, shake - dt * 3.5);

    drone.update(state.drone, state.camera.tiltDeg, debug.freeCam ? 'chase' : state.view, state.paused ? 0 : dt);
    const analog = placeCamera(state, dt);
    lastView = state.view;
    camera.updateProjectionMatrix();

    const d = state.drone;
    const ground = level.terrain.heightAt(camera.position.x, camera.position.z);
    height = camera.position.y - ground;

    // Prop wash kicks up dust when hovering just above the ground.
    const thrust = (d.motors[0] + d.motors[1] + d.motors[2] + d.motors[3]) / 4;
    const droneAlt = d.position[1] - level.terrain.heightAt(d.position[0], d.position[2]);
    if (!state.paused && !d.crashed && thrust > 0.22 && droneAlt < 1.3) {
      washAcc += dt * 26 * thrust * (1 - droneAlt / 1.3);
      while (washAcc > 1) {
        washAcc -= 1;
        particles.dust([d.position[0], d.position[1] - droneAlt, d.position[2]], { count: 1, speed: 2.4 + thrust * 3, size: 0.45, life: 1.1, up: 0.25, alpha: 0.22 });
      }
    }

    env.update(camera.position, time);
    trees.update(time);
    grass.update(camera.position, time, height);
    const drawH = renderer.domElement.height;
    particles.update(state.paused ? 0 : dt, drawH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)));
    osd.update(state, dt);

    const u = feed.uniforms;
    const link = state.link ?? { signal: 1, jamming: 0, lost: false };
    u.uTime.value = time;
    u.uAnalog.value = analog ? 1 : 0;
    u.uSignal.value = override.signal !== null ? +override.signal : link.signal;
    u.uJam.value = override.jam !== null ? +override.jam : link.jamming;
    u.uLost.value = override.lost !== null ? +override.lost : (link.lost ? 1 : 0);
    u.uGlitch.value = analog ? glitch : 0;
    paused.style.display = state.paused ? 'flex' : 'none';

    feed.render(scene, camera);
  }

  function resize(w, h) {
    const ratio = Math.min(window.devicePixelRatio || 1, quality.ratio);
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    feed.setSize(w, h, ratio);
    osd.resize(w / h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  return {
    update,
    resize,
    dispose() {
      clearTimeout(helpTimer);
      overlay.remove();
      for (const part of [env, terrain, trees, buildings, grass, drone, particles, feed, osd]) part.dispose();
      detailTex.dispose();
      renderer.dispose();
      if (window.__fpvVisuals === debug) delete window.__fpvVisuals;
    },
  };
}
