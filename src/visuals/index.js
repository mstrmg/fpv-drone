// Visuals entry point. Implements the Visuals API in ARCHITECTURE.md: everything that is drawn.
import * as THREE from 'three';
import { makeDetailTexture } from './textures.js';
import { createEnvironment } from './environment.js';
import { createTerrain } from './terrain.js';
import { createTrees } from './trees.js';
import { createGrass } from './grass.js';
import { createBuildings } from './buildings.js';
import { createProps } from './props.js';
import { createFortifications } from './fortifications.js';
import { createRoads } from './roads.js';
import { createDrone } from './drone.js';
import { createParticles } from './particles.js';
import { createExplosions } from './explosions.js';
import { createEntities } from './entities.js';
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
  const props = createProps({ scene, level, terrain });
  const forts = createFortifications({ scene, level });
  const roads = createRoads({ scene, level });
  const grass = createGrass({ scene, level, maps: terrain.maps, count: quality.grass });
  const drone = createDrone({ scene });
  const particles = createParticles({ scene, max: 1600 });
  const fire = createParticles({ scene, max: 500, additive: true });
  const explosions = createExplosions({ scene, level, smoke: particles, fire, terrain });
  const entities = createEntities({ scene, level, smoke: particles, fire });
  const feed = createFeed({ renderer });
  // Sasha's TV in the dugout: his spotter drone's picture, rendered small into a texture.
  const tvTarget = forts.tv ? new THREE.WebGLRenderTarget(384, 216, { type: THREE.HalfFloatType, depthBuffer: true }) : null;
  const tvCam = new THREE.PerspectiveCamera(12, 384 / 216, 1, 6000);
  let tvFrame = 0;
  if (tvTarget) forts.tv.setPicture(tvTarget.texture);
  const osd = createOSD();
  feed.uniforms.tOsd.value = osd.texture;
  feed.uniforms.uExposure.value = 0.82;

  // DOM overlay: things that are not part of the video feed.
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;font-family:ui-monospace,Menlo,Consolas,monospace;color:#e9e9e4;';
  const help = document.createElement('div');
  help.style.cssText = 'position:absolute;left:50%;bottom:3.2%;transform:translateX(-50%);font-size:12px;letter-spacing:.04em;padding:6px 12px;background:rgba(0,0,0,.45);border-radius:3px;white-space:nowrap;transition:opacity 2s;';
  const FLY_HELP = 'W/S throttle · A/D yaw · arrows pitch/roll · Space arm · R reset · M mode · P pause' + (level.start ? ' · E / ◯ goggles off' : '');
  const FOOT_HELP = 'WASD walk · click + mouse (or arrows / right stick) look · Shift run · E / ✕ at the table: goggles on' + (level.missions?.length ? ' · 7 skip mission' : '');
  help.textContent = level.start ? FOOT_HELP : FLY_HELP;
  const prompt = document.createElement('div');
  prompt.style.cssText = 'position:absolute;left:50%;top:58%;transform:translateX(-50%);display:none;font-size:13px;letter-spacing:.12em;padding:5px 12px;background:rgba(0,0,0,.4);border-radius:3px;white-space:nowrap;';
  prompt.textContent = 'E / ✕   PUT ON GOGGLES';
  const dot = document.createElement('div');
  dot.style.cssText = 'position:absolute;left:50%;top:50%;width:3px;height:3px;margin:-1.5px;border-radius:50%;background:rgba(255,255,255,.55);display:none;';
  overlay.append(prompt, dot);
  // Campaign: what the other soldier says (subtitles), the current objective, mission banners.
  const subtitle = document.createElement('div');
  subtitle.style.cssText = 'position:absolute;left:50%;bottom:11%;transform:translateX(-50%);max-width:80%;display:none;font:15px/1.45 system-ui,sans-serif;text-align:center;padding:6px 14px;background:rgba(0,0,0,.55);border-radius:3px;text-shadow:0 1px 2px #000;';
  const objective = document.createElement('div');
  objective.style.cssText = 'position:absolute;right:3%;top:5%;display:none;max-width:34%;font-size:12px;letter-spacing:.06em;line-height:1.5;text-align:right;text-shadow:0 0 3px #000;';
  const banner = document.createElement('div');
  banner.style.cssText = 'position:absolute;left:50%;top:30%;transform:translateX(-50%);display:none;font-size:22px;letter-spacing:.4em;text-indent:.4em;padding:10px 22px;background:rgba(0,0,0,.45);border-radius:3px;white-space:nowrap;';
  overlay.append(subtitle, objective, banner);
  let bannerUntil = 0, spokenId = 0;
  const mute = params.has('mute');
  // He speaks the lines too, with whatever voice the browser has.
  function speak(text) {
    const synth = window.speechSynthesis;
    if (mute || !synth || typeof SpeechSynthesisUtterance === 'undefined') return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voices = synth.getVoices();
    u.voice = voices.find((vo) => /en[-_]GB/i.test(vo.lang) && /male|daniel|george|arthur/i.test(vo.name))
      ?? voices.find((vo) => /^en/i.test(vo.lang)) ?? null;
    u.rate = 1.02; u.pitch = 0.75; u.volume = 0.9;
    synth.speak(u);
  }
  const paused = document.createElement('div');
  paused.style.cssText = 'position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.45);font-size:28px;letter-spacing:.5em;text-indent:.5em;';
  paused.textContent = 'PAUSED';
  const spotter = document.createElement('div');
  spotter.style.cssText = 'position:absolute;left:3%;top:5%;display:none;font-size:13px;letter-spacing:.14em;line-height:1.7;text-shadow:0 0 3px #000;';
  spotter.innerHTML = '<span style="color:#ff5a4a">&#9679; REC</span> &nbsp;SPOTTER UAV<br><span style="opacity:.75">TARGET AREA &middot; ZOOM 7X</span>';
  overlay.append(help, paused, spotter);
  let spotterHtml = '';
  uiRoot.appendChild(overlay);
  const helpTimer = setTimeout(() => { help.style.opacity = '0'; }, 14000);
  let helpFade = 0;

  let time = 0, glitch = 0, shake = 0, height = 1, washAcc = 0, rollSpeed = 0;
  // After the drone detonates its camera is gone: static first, then the spotter drone's view of the strike.
  const strike = { active: false, t: 0, pos: new THREE.Vector3(), eye: new THREE.Vector3() };
  const v = new THREE.Vector3(), lookTarget = new THREE.Vector3();
  const injected = [];
  const debug = { renderer, scene, camera, freeCam: null, inject: (ev) => injected.push(ev) };
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
      } else if (ev.type === 'explosion') {
        explosions.explode(ev);
        const dist = v.fromArray(ev.position).distanceTo(lookTarget.fromArray(state.drone.position));
        if (dist < 3 && (ev.kind ?? 'warhead') === 'warhead') beginStrike(ev.position);
        else { shake = Math.max(shake, Math.min(1, 14 / (dist + 1))); glitch = Math.max(glitch, Math.min(0.6, 8 / (dist + 1))); }
      } else if (ev.type === 'targets_reset') {
        explosions.clear();
      } else if (ev.type === 'drone_lost') {
        if (!strike.active) beginStrike(state.drone.position);
      } else if (ev.type === 'reset') {
        glitch = 0.5; shake = 0;
        strike.active = false;
      } else if (ev.type === 'mission') {
        if (ev.phase === 'active' || ev.phase === 'complete' || ev.phase === 'failed') {
          banner.textContent = ev.phase === 'active' ? `MISSION · ${ev.title.toUpperCase()}`
            : ev.phase === 'complete' ? 'MISSION COMPLETE' : ev.done ? `MISSION FAILED · ${ev.escaped} GOT AWAY` : 'MISSION FAILED · THEY GOT AWAY';
          bannerUntil = time + 3.5;
        }
      } else if (ev.type === 'mode') {
        // Goggles on: the feed comes up with a burst of static. Off: straight back to your own eyes.
        if (ev.mode === 'drone') glitch = 1.2;
        else { glitch = 0; strike.active = false; }
        help.textContent = ev.mode === 'drone' ? FLY_HELP : FOOT_HELP;
        help.style.opacity = '1';
        clearTimeout(helpFade);
        helpFade = setTimeout(() => { help.style.opacity = '0'; }, 9000);
      } else if (ev.type === 'armed') {
        glitch = Math.max(glitch, 0.15);
      } else if (ev.type === 'drone_hit') {
        // A round or a thrown helmet clipped the frame: a jolt and a burst of static.
        glitch = Math.max(glitch, ev.cause === 'bullet' ? 0.7 : 0.45);
        shake = Math.max(shake, 0.6);
      }
    }
  }

  function beginStrike(position) {
    strike.active = true;
    strike.t = 0;
    strike.pos.fromArray(position);
    // The spotter hovers well back and high, on the side the smoke drifts away from.
    const a = Math.random() * 1.2 + 2.6;
    strike.eye.set(strike.pos.x + Math.cos(a) * 95, 0, strike.pos.z + Math.sin(a) * 95);
    strike.eye.y = Math.max(strike.pos.y, level.terrain.heightAt(strike.eye.x, strike.eye.z)) + 70;
  }

  function placeCamera(state, dt) {
    const aspect = camera.aspect;
    if (debug.freeCam) {
      const f = debug.freeCam;
      camera.position.fromArray(f.position);
      camera.lookAt(lookTarget.fromArray(f.target));
      camera.fov = f.analog ? lensFov(f.fov ?? 78, aspect) : (f.fov ?? 60);
      return !!f.analog;
    }
    const cut = state.mission?.cutscene;
    if (cut && state.mode === 'foot') {
      // The other soldier's spotter feed, full screen while he talks you through it.
      camera.position.fromArray(cut.position);
      camera.position.x += Math.sin(time * 0.31) * 0.8;
      camera.position.y += Math.sin(time * 0.23 + 1) * 0.5;
      lookTarget.fromArray(cut.target);
      lookTarget.x += Math.sin(time * 1.1) * 0.15;
      lookTarget.y += Math.sin(time * 0.7) * 0.1;
      camera.lookAt(lookTarget);
      camera.fov = cut.fovDeg;
      return false;
    }
    if (strike.active && strike.t > 0.45) {
      // Long lens on a hovering drone: slow drift and a little hand-off wobble.
      camera.position.copy(strike.eye);
      camera.position.x += Math.sin(time * 0.31) * 1.2;
      camera.position.y += Math.sin(time * 0.23 + 1) * 0.8;
      lookTarget.copy(strike.pos);
      lookTarget.y += 2.5 + Math.sin(time * 0.9) * 0.25;
      lookTarget.x += Math.sin(time * 1.3) * 0.2;
      camera.lookAt(lookTarget);
      camera.fov = 11;
      return false;
    }
    camera.position.fromArray(state.camera.position);
    camera.quaternion.fromArray(state.camera.quaternion);
    if (state.mode === 'foot') { camera.fov = state.camera.fovDeg; return false; } // your own eyes: no lens, no feed
    camera.fov = lensFov(state.camera.fovDeg, aspect);
    if (shake > 0.001) {
      // Knocks rattle the camera for a moment; the pose itself still comes from the sim.
      camera.rotateX(Math.sin(time * 71) * 0.012 * shake);
      camera.rotateZ(Math.sin(time * 53 + 1.3) * 0.02 * shake);
    }
    return true;
  }

  function update(state, events, dt) {
    time += dt;
    handleEvents(state, events);
    if (injected.length) { const extra = injected.splice(0); handleEvents(state, extra); events = events.concat(extra); }
    if (strike.active) strike.t += dt;
    const briefing = !!(state.mission?.cutscene && state.mode === 'foot');
    const spotting = (strike.active && strike.t > 0.45) || briefing;
    glitch = Math.max(state.drone.crashed ? 0.32 : 0, glitch - dt * (glitch > 0.6 ? 2.2 : 0.9));
    shake = Math.max(0, shake - dt * 3.5);

    const foot = state.mode === 'foot';
    drone.update(state.drone, state.camera.tiltDeg, !debug.freeCam && !foot, state.paused ? 0 : dt);
    drone.group.visible = !strike.active && !state.drone.destroyed;
    const analog = placeCamera(state, dt);
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
    // A long lens brings far trees close, so detail is chosen by apparent rather than true distance.
    trees.update(time, camera.position, dt, Math.min(1, Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / 0.8));
    grass.update(briefing ? lookTarget.fromArray(state.mission.cutscene.target) : spotting ? strike.pos : camera.position, time, spotting ? 0 : height);
    particles.update(state.paused ? 0 : dt);
    fire.update(state.paused ? 0 : dt);
    explosions.update(state.paused ? 0 : dt);
    entities.update(state, events, state.paused ? 0 : dt);
    forts.update(state.paused ? 0 : dt, camera.position);
    prompt.style.display = foot && state.prompt === 'goggles' && !state.paused && !debug.freeCam && !briefing ? 'block' : 'none';
    dot.style.display = foot && !debug.freeCam && !briefing ? 'block' : 'none';
    const ms = state.mission;
    if (ms) {
      subtitle.style.display = ms.line ? 'block' : 'none';
      if (ms.line) subtitle.innerHTML = `<span style="color:#d9c46a;letter-spacing:.12em;font-size:12px">${ms.speaker}</span>&nbsp; ${ms.line}`
        + (briefing ? '<div style="opacity:.5;font-size:11px;margin-top:3px">E / ✕ skip</div>' : '');
      if (ms.line && ms.lineId !== spokenId) { spokenId = ms.lineId; speak(ms.line); }
      const showObj = (ms.phase === 'active') && !briefing && !state.paused;
      objective.style.display = showObj ? 'block' : 'none';
      if (showObj) objective.innerHTML = `<span style="opacity:.6">OBJECTIVE</span><br>${ms.objective}<br><span style="color:#d9c46a">${ms.done} / ${ms.total}</span>`;
      banner.style.display = time < bannerUntil ? 'block' : 'none';
    }
    osd.update(state, dt);

    const u = feed.uniforms;
    const link = state.link ?? { signal: 1, jamming: 0, lost: false };
    u.uTime.value = time;
    u.uAnalog.value = analog ? 1 : 0;
    u.uSignal.value = override.signal !== null ? +override.signal : link.signal;
    u.uJam.value = override.jam !== null ? +override.jam : link.jamming;
    u.uLost.value = override.lost !== null ? +override.lost : (link.lost ? 1 : 0);
    u.uGlitch.value = analog ? glitch : 0;
    // The picture starts rolling once the link is poor, faster as it gets worse.
    const bad = (1 - u.uSignal.value) + u.uJam.value * 0.6 + u.uGlitch.value;
    // The sim's link.roll (0..1) sets the speed when it is present; otherwise estimate it from the signal.
    const rollAmt = link.roll ?? THREE.MathUtils.smoothstep(bad, 0.35, 1.0);
    rollSpeed += (rollAmt * 1.6 - rollSpeed) * Math.min(1, dt * 3);
    u.uGlitch.value = Math.max(u.uGlitch.value, rollAmt * 0.35); // tearing grows with the roll
    u.uRoll.value = (u.uRoll.value + rollSpeed * dt) % 1;
    if (rollSpeed < 0.02) u.uRoll.value *= Math.max(0, 1 - dt * 4); // relock
    if (strike.active && !spotting) {
      // The last frame tears for an instant, then the link is gone.
      u.uGlitch.value = 1.5;
      u.uLost.value = strike.t > 0.1 ? 1 : 0;
    }
    u.uOsd.value = spotting || foot ? 0 : 1;
    if (foot && !debug.freeCam) { u.uLost.value = 0; u.uGlitch.value = 0; }
    u.uSpotter.value = spotting ? 1 : 0;
    spotter.style.display = spotting && !debug.freeCam ? 'block' : 'none';
    // His feed carries where the targets are from us: bearing and range.
    const bh = state.mission?.bearing?.fromHome;
    const fixText = bh ? `TGT BRG ${String(Math.round(bh.deg) % 360).padStart(3, '0')}° · ${Math.round(bh.m / 10) * 10} M` : '';
    if (spotting) {
      const html = briefing && fixText ? `<span style="color:#ff5a4a">&#9679; REC</span> &nbsp;SPOTTER UAV<br><span style="opacity:.9">${fixText}</span>`
        : '<span style="color:#ff5a4a">&#9679; REC</span> &nbsp;SPOTTER UAV<br><span style="opacity:.75">TARGET AREA &middot; ZOOM 7X</span>';
      if (spotterHtml !== html) { spotterHtml = html; spotter.innerHTML = html; }
    }
    forts.tv?.info(fixText);
    paused.style.display = state.paused ? 'flex' : 'none';

    renderTv(state, foot && !briefing);
    feed.render(scene, camera);
  }

  // The TV only updates when you are in the dugout looking about, every other frame.
  function renderTv(state, on) {
    const sp = state.mission?.spotter;
    if (!tvTarget || !sp || !on || state.paused) return;
    if (camera.position.distanceToSquared(forts.tv.position) > 9 * 9 || (tvFrame++ & 1)) return;
    tvCam.position.fromArray(sp.position);
    tvCam.position.x += Math.sin(time * 0.31) * 0.8;
    tvCam.position.y += Math.sin(time * 0.23 + 1) * 0.5;
    tvCam.lookAt(lookTarget.fromArray(sp.target));
    tvCam.fov = sp.fovDeg;
    tvCam.updateProjectionMatrix();
    forts.tv.visible(false);
    // The sun's shadow map only covers the dugout around you: the far-off picture goes without.
    const autoShadow = renderer.shadowMap.autoUpdate, shadowK = env.sun.shadow.intensity;
    renderer.shadowMap.autoUpdate = false;
    env.sun.shadow.intensity = 0;
    env.sky.position.copy(tvCam.position);
    renderer.setRenderTarget(tvTarget);
    renderer.render(scene, tvCam);
    renderer.setRenderTarget(null);
    renderer.shadowMap.autoUpdate = autoShadow;
    env.sun.shadow.intensity = shadowK;
    env.sky.position.copy(camera.position);
    forts.tv.visible(true);
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
      clearTimeout(helpTimer); clearTimeout(helpFade);
      overlay.remove();
      for (const part of [env, terrain, trees, buildings, props, forts, roads, grass, drone, particles, fire, explosions, entities, feed, osd]) part.dispose();
      detailTex.dispose();
      tvTarget?.dispose();
      renderer.dispose();
      if (window.__fpvVisuals === debug) delete window.__fpvVisuals;
    },
  };
}
