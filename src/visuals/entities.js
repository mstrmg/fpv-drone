// Enemy troops and vehicles, drawn from `state.entities` (position = base centre, forward = -Z).
//
// Vehicles (vehicleModels.js) ride on a sprung hull that pitches and rolls as they speed up, brake
// and turn. Wheels spin and steer, each track rolls at its own side's speed (so they counter-rotate
// in a pivot turn), turrets slew at a set rate, guns lift toward the drone, and engines puff exhaust.
// A destroyed vehicle flashes into a fireball, then burns from its engine bay and hatches under a
// column of thick black smoke. The paint burns off to soot and grey ash, glass is gone, ERA bricks
// and loose parts are blown off, tyres burst and burn away, and the ammunition cooks off in pops,
// tracers and jets of flame.
//
// Not every kill burns. The sim's damage model (components, crew, wounds) is shown as it is: a tank
// whose crew were killed by a jet through the roof sits intact with its hatches open, smoke seeping
// out and the commander hanging dead over the rim; a thrown track lies behind the hull; a hit gun
// droops; the engine deck smokes or burns; every hit leaves a scorch or a penetration hole where it
// struck. Crews ride head-out, duck when alerted and bail out (the sim turns them into infantry).
//
// Soldiers (soldierModel.js, soldierAnim.js) are skinned and animated; killed ones crumple or are
// thrown by the blast, drop their weapon and leave a little blood. Wounded ones limp, crawl dragging
// a leg, hold the wound, or lie down writhing, with blood soaking through at the wound.
import * as THREE from 'three';
import { mulberry32, hashString } from './rng.js';
import { canvasTexture } from './textures.js';
import { Kit, HALF_PI, VEHICLE_BUILDERS, buildWheelKits, LINK } from './vehicleModels.js';
import { createSoldierFactory, SOLDIER_HEIGHT } from './soldierModel.js';
import { initSoldierAnim, animateSoldier, animateCrew, killSoldierAnim, downSoldierAnim, landSoldier, animateDeadSoldier } from './soldierAnim.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const rnd = (a, b) => a + Math.random() * (b - a);

function canvas(S) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  return [c, c.getContext('2d')];
}

// Worn Russian green: flat paint with faint panel variation, scuffs and dust.
function makePaintTexture(seed, base, shades) {
  const S = 256, [c, g] = canvas(S), rand = mulberry32(seed);
  g.fillStyle = base; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = shades[i % shades.length];
    g.globalAlpha = 0.25 + rand() * 0.3;
    g.beginPath();
    g.ellipse(rand() * S, rand() * S, 10 + rand() * 40, 6 + rand() * 25, rand() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  for (let i = 0; i < 3500; i++) {
    g.fillStyle = `rgba(${rand() < 0.6 ? '45,38,28' : '170,160,130'},${rand() * 0.14})`;
    g.fillRect(rand() * S, rand() * S, 1 + rand() * 3, 1 + rand() * 2);
  }
  for (let i = 0; i < 30; i++) {
    g.strokeStyle = `rgba(110,105,95,${0.2 + rand() * 0.3})`;
    g.lineWidth = 1;
    const x = rand() * S, y = rand() * S;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rand() - 0.5) * 30, y + (rand() - 0.5) * 8); g.stroke();
  }
  return canvasTexture(c, { repeat: true });
}

function makeZTexture() {
  const S = 128, [c, g] = canvas(S);
  g.strokeStyle = 'rgba(232,232,224,0.95)';
  g.lineWidth = 17; g.lineJoin = 'round'; g.lineCap = 'round';
  g.beginPath(); g.moveTo(26, 30); g.lineTo(102, 30); g.lineTo(28, 98); g.lineTo(104, 98); g.stroke();
  const rand = mulberry32(3);
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(0,0,0,${rand()})`; g.fillRect(rand() * S, rand() * S, 2 + rand() * 4, 1 + rand() * 3); }
  return canvasTexture(c);
}

function makeNetTexture() {
  const S = 128, [c, g] = canvas(S);
  g.strokeStyle = '#3a3a35'; g.lineWidth = 3;
  for (let i = -S; i < S * 2; i += 16) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + S, S); g.stroke();
    g.beginPath(); g.moveTo(i, S); g.lineTo(i + S, 0); g.stroke();
  }
  const t = canvasTexture(c, { repeat: true });
  t.repeat.set(4, 4);
  return t;
}

function makeBloodTexture() {
  const S = 128, [c, g] = canvas(S), rand = mulberry32(17);
  for (let i = 0; i < 14; i++) {
    const x = S / 2 + (rand() - 0.5) * S * 0.45, y = S / 2 + (rand() - 0.5) * S * 0.45, r = S * (0.08 + rand() * 0.17);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(70,8,6,0.9)'); gr.addColorStop(0.7, 'rgba(60,6,4,0.6)'); gr.addColorStop(1, 'rgba(50,5,4,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  }
  return canvasTexture(c);
}

// Hull hit marks, alpha in the texture. `hole`: a shaped-charge entry: a small dark hole with a lip
// of bright melted steel, a ring of burnt paint and soot streaks. Otherwise a blast scorch with
// fragment pocks.
function makeHitTexture(hole) {
  const S = 128, [c, g] = canvas(S), rand = mulberry32(hole ? 91 : 93), m = S / 2;
  g.clearRect(0, 0, S, S);
  const soot = g.createRadialGradient(m, m, 0, m, m, m);
  soot.addColorStop(0, 'rgba(12,11,10,0.95)'); soot.addColorStop(hole ? 0.35 : 0.45, 'rgba(18,16,14,0.8)');
  soot.addColorStop(hole ? 0.7 : 0.8, 'rgba(30,27,23,0.35)'); soot.addColorStop(1, 'rgba(30,27,23,0)');
  g.fillStyle = soot; g.fillRect(0, 0, S, S);
  for (let i = 0; i < (hole ? 40 : 70); i++) {                  // streaks thrown out from the centre
    const a = rand() * Math.PI * 2, r0 = S * (hole ? 0.08 : 0.12), r1 = S * (0.25 + rand() * 0.24);
    g.strokeStyle = `rgba(10,9,8,${0.15 + rand() * 0.35})`; g.lineWidth = 1 + rand() * 2.5;
    g.beginPath(); g.moveTo(m + Math.cos(a) * r0, m + Math.sin(a) * r0); g.lineTo(m + Math.cos(a) * r1, m + Math.sin(a) * r1); g.stroke();
  }
  for (let i = 0; i < (hole ? 12 : 45); i++) {                  // fragment pocks with bright bottoms
    const a = rand() * Math.PI * 2, r = S * (0.1 + rand() * 0.36), x = m + Math.cos(a) * r, y = m + Math.sin(a) * r, d = 1 + rand() * 2.2;
    g.fillStyle = 'rgba(5,5,5,0.9)'; g.beginPath(); g.arc(x, y, d, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(120,115,105,0.6)'; g.beginPath(); g.arc(x + 0.5, y + 0.5, d * 0.4, 0, Math.PI * 2); g.fill();
  }
  if (hole) {
    g.fillStyle = 'rgba(150,140,128,0.9)';                      // melted lip
    g.beginPath(); for (let k = 0; k <= 20; k++) { const a = k / 20 * Math.PI * 2, r = S * (0.075 + rand() * 0.02); g.lineTo(m + Math.cos(a) * r, m + Math.sin(a) * r); } g.fill();
    g.fillStyle = 'rgba(0,0,0,1)';
    g.beginPath(); for (let k = 0; k <= 20; k++) { const a = k / 20 * Math.PI * 2, r = S * (0.05 + rand() * 0.015); g.lineTo(m + Math.cos(a) * r, m + Math.sin(a) * r); } g.fill();
  }
  return canvasTexture(c);
}

// One track link per texture repeat (v runs along the belt): steel plate, grouser bar, pins, mud.
function makeTrackTexture() {
  const S = 64, [c, g] = canvas(S), rand = mulberry32(31);
  g.fillStyle = '#1e1c19'; g.fillRect(0, 0, S, S);
  g.fillStyle = '#34302a'; g.fillRect(2, 5, S - 4, S - 10);
  g.fillStyle = '#4a443a'; g.fillRect(3, 26, S - 6, 9);
  g.fillStyle = '#56504a'; g.fillRect(27, 8, 10, 14);
  g.fillStyle = '#121110'; g.fillRect(0, 0, S, 3); g.fillRect(0, S - 3, S, 3);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(${rand() < 0.5 ? '70,58,42' : '30,26,20'},${rand() * 0.5})`;
    g.fillRect(rand() * S, rand() * S, 1 + rand() * 4, 1 + rand() * 3);
  }
  return canvasTexture(c, { repeat: true });
}

// Soft dark disc for contact shadows (alpha in the green channel).
function makeShadowTexture() {
  const S = 64, [c, g] = canvas(S);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, '#fff'); gr.addColorStop(0.55, '#aaa'); gr.addColorStop(1, '#000');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  return canvasTexture(c, { srgb: false });
}

// Paint shader addition: mud splashed up from the ground, thicker low down and blotchy.
function weather(mat, strength = 1) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aH;\nvarying float vH;\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvH = aH; vObj = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vH;\nvarying vec3 vObj;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 cell = floor(vObj * 7.0);
        float mudN = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        float mudN2 = fract(sin(dot(floor(vObj * 2.3), vec3(39.3, 11.1, 83.7))) * 9631.7);
        float mud = smoothstep(1.35, 0.25, vH + (mudN - 0.5) * 0.3 + (mudN2 - 0.5) * 0.45) * ${strength.toFixed(2)};
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.15, 0.12, 0.085) * (0.8 + 0.4 * mudN), clamp(mud, 0.0, 0.85));
        diffuseColor.rgb *= 0.9 + 0.2 * mudN2;`);
  };
  return mat;
}

// A burnt-out hull: soot black with grey ash where the paint burnt off, a little dull oxide, mud
// still on the lower hull, and metal glowing near the fires while they burn. No red.
function makeCharred() {
  const u = { uFire: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) }, uTime: { value: 0 } };
  const m = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0.15 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFire = u.uFire; sh.uniforms.uTime = u.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aH;\nvarying float vH;\nvarying vec3 vObj;\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvH = aH; vObj = position; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uFire[4];\nuniform float uTime;\nvarying float vH;\nvarying vec3 vObj;\nvarying vec3 vWPos;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        float n1 = fract(sin(dot(floor(vObj * 5.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        float n2 = fract(sin(dot(floor(vObj * 1.6), vec3(39.3, 11.1, 83.7))) * 9631.7);
        float n3 = fract(sin(dot(floor(vObj * 14.0), vec3(7.1, 91.7, 23.3))) * 3758.5);
        float ashK = smoothstep(0.55, 0.9, n2 * 0.55 + n1 * 0.45);
        vec3 col = mix(vec3(0.03, 0.028, 0.026), vec3(0.14, 0.137, 0.13), ashK * 0.7);
        col = mix(col, vec3(0.1, 0.09, 0.082), smoothstep(0.65, 0.95, n1) * 0.4);
        col *= 0.85 + 0.25 * n3;
        col = mix(col, vec3(0.085, 0.08, 0.06) * (0.7 + 0.5 * n1), smoothstep(1.1, 0.3, vH) * 0.55);
        diffuseColor.rgb = col;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float heat = 0.0;
        for (int i = 0; i < 4; i++) { vec3 dv = vWPos - uFire[i].xyz; heat += uFire[i].w * exp(-dot(dv, dv) * 2.0); }
        float flick = 0.7 + 0.3 * sin(uTime * 13.0 + n1 * 40.0) * sin(uTime * 5.3 + n3 * 25.0);
        totalEmissiveRadiance += vec3(1.0, 0.33, 0.07) * heat * flick * (0.3 + 0.7 * n3) * 1.6;`);
  };
  m.userData.u = u;
  return m;
}

const CLASS = { light: 0, truck: 1, apc: 2, tank: 3 };

export function createEntities({ scene, level, smoke, fire }) {
  const disposables = [];
  const keep = (x) => { disposables.push(x); return x; };
  const std = (o) => keep(new THREE.MeshStandardMaterial({ roughness: 0.8, ...o }));
  const greenTex = keep(makePaintTexture(5, '#4a5233', ['#3f4729', '#535b39', '#454a30']));
  greenTex.repeat.set(0.4, 0.4);
  const zTex = keep(makeZTexture()), netTex = keep(makeNetTexture()), bloodTex = keep(makeBloodTexture());
  const trackTex = keep(makeTrackTexture()), shadowTex = keep(makeShadowTexture());

  const trackMat = std({ map: trackTex, roughness: 0.85, metalness: 0.5 });
  const vehicleMats = {
    paint: weather(std({ map: greenTex, roughness: 0.78, metalness: 0.12 })),
    era: weather(std({ map: greenTex, color: 0xc8ccb8, roughness: 0.8, metalness: 0.1 })),
    dark: weather(std({ color: 0x2a2c24, roughness: 0.7, metalness: 0.3 }), 0.7),
    steel: weather(std({ color: 0x3a3a36, roughness: 0.5, metalness: 0.75 }), 0.8),
    tyre: weather(std({ color: 0x1b1b1a, roughness: 0.95 }), 0.9),
    trackL: trackMat, trackR: trackMat,
    rubber: weather(std({ color: 0x1c1d1a, roughness: 0.95 })),
    glass: std({ color: 0x1b2328, roughness: 0.1, metalness: 0.5 }),
    wood: std({ color: 0x5a4632, roughness: 0.95 }),
    canvas: weather(std({ color: 0x55573d, roughness: 1 }), 0.6),
    net: std({ map: netTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.5 }),
    mark: std({ map: zTex, transparent: true, alphaTest: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: 0.9 }),
  };
  const holeMat = std({ color: 0x050505, roughness: 1 });
  const netBurnt = std({ map: netTex, color: 0x333333, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 });
  const charredShared = keep(makeCharred());
  const rubberBurnt = std({ color: 0x0b0b0b, roughness: 1 });
  const eraLoose = weather(std({ map: greenTex, color: 0xb8bca8, roughness: 0.85 }));
  const shadowMat = keep(new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: shadowTex, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  const shadowGeo = keep(new THREE.PlaneGeometry(1, 1).rotateX(-HALF_PI));
  const bloodMat = std({ map: bloodTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, roughness: 0.35, opacity: 0.8 });
  const bloodGeo = keep(new THREE.PlaneGeometry(1, 1).rotateX(-HALF_PI));
  const chunkGeo = keep(new THREE.BoxGeometry(1, 1, 1));
  const decalGeo = keep(new THREE.PlaneGeometry(1, 1));
  const decalMat = (map, o = {}) => std({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: 0.9, ...o });
  const holeDecal = decalMat(keep(makeHitTexture(true)), { metalness: 0.3 });
  const scorchDecal = decalMat(keep(makeHitTexture(false)), { metalness: 0.2 });
  const pockDecal = decalMat(scorchDecal.map, { opacity: 0.55 });
  // Blood soaking through cloth: dark and wet, not bright red.
  const stainMat = decalMat(bloodTex, { color: 0x4a2a24, roughness: 0.35, polygonOffsetFactor: -6 });
  const holeDisc = keep(new THREE.CircleGeometry(1, 16).rotateX(-HALF_PI));
  const holeRect = keep(new THREE.PlaneGeometry(1, 1).rotateX(-HALF_PI));
  const raycaster = new THREE.Raycaster();

  const contactShadow = (w, d, opacity = 0.55) => {
    const m = new THREE.Mesh(shadowGeo, opacity === 0.55 ? shadowMat : shadowMat);
    m.scale.set(w, 1, d);
    m.position.y = 0.03;
    m.renderOrder = -1;
    m.userData.shadow = true;
    return m;
  };

  // Fire glow: a fixed pool of lights (a changing light count would recompile every shader).
  const fireLights = [0, 1].map(() => {
    const l = new THREE.PointLight(new THREE.Color().setRGB(1, 0.55, 0.22), 0, 32, 2);
    scene.add(l);
    return l;
  });

  const trackGeos = (group) => group.traverse((o) => { if (o.isMesh) disposables.push(o.geometry); });

  // ---- Vehicle templates, built on first use and cloned per vehicle ----
  const templates = new Map(), wheelProtos = new Map();
  function template(kind, variant) {
    const group = VEHICLE_BUILDERS[kind] ?? VEHICLE_BUILDERS.truck;
    const name = group[variant] ? variant : Object.keys(group)[0];
    const key = `${kind}:${name}`;
    if (templates.has(key)) return templates.get(key);
    const t = group[name]();
    const root = new THREE.Group();
    const pivotY = t.size[1] * 0.3;
    const body = new THREE.Group(); body.name = 'body'; body.position.y = pivotY;
    const inner = new THREE.Group(); inner.name = 'inner'; inner.position.y = -pivotY;
    body.add(inner); root.add(body);
    const hull = t.hull.build(vehicleMats);
    for (const m of [...hull.children]) if (m.userData.slot === 'trackL' || m.userData.slot === 'trackR') { m.name = m.userData.slot; root.add(m); }
    inner.add(hull);
    for (const w of t.wheels) {
      const wk = `${w.type}:${w.r}:${w.w}`;
      if (!wheelProtos.has(wk)) {
        const { tyre, rim } = buildWheelKits(w);
        const g = new THREE.Group();
        if (Object.keys(tyre.parts).length) { const tm = tyre.build(vehicleMats); tm.name = 'tyre'; g.add(tm); }
        g.add(rim.build(vehicleMats));
        trackGeos(g);
        wheelProtos.set(wk, g);
      }
      const wg = wheelProtos.get(wk).clone();
      wg.position.set(w.x, w.y, w.z);
      wg.rotation.order = 'YXZ';
      wg.name = 'wheel';
      wg.userData = { r: w.r, side: Math.sign(w.x), steer: w.steer ?? 0, type: w.type };
      root.add(wg);
    }
    for (const [name, p] of Object.entries(t.parts ?? {})) {
      const g = p.kit.build(vehicleMats); g.position.fromArray(p.pos); g.name = name; inner.add(g);
    }
    let tur = null;
    if (t.turret) {
      tur = t.turret.kit.build(vehicleMats);
      tur.position.fromArray(t.turret.pos); tur.name = 'turret';
      const gun = t.turret.gun.kit.build(vehicleMats); gun.position.fromArray(t.turret.gun.pos); gun.name = 'gun'; tur.add(gun);
      if (t.turret.cage) { const cage = t.turret.cage.kit.build(vehicleMats); cage.position.fromArray(t.turret.cage.pos); cage.name = 'cage'; tur.add(cage); }
      inner.add(tur);
    }
    // Hatch lids on hinges, each over a dark opening that shows when it swings open.
    for (const h of t.hatches ?? []) {
      const parent = h.on === 'turret' && tur ? tur : inner;
      const hinge = new THREE.Group();
      hinge.name = 'hatch:' + h.name;
      hinge.position.fromArray(h.pos);
      hinge.rotation.y = Math.atan2(-h.dir[0], -h.dir[1]);
      const depth = h.r ? h.r * 2 : h.d;
      const lidKit = new Kit((h.on === 'turret' && t.turret ? t.turret.pos[1] : 0) + h.pos[1]);
      if (h.r) lidKit.cyl('paint', h.r, h.r * 0.97, 0.05, 0, 0.025, -h.r, 0, 0, 0, 16);
      else lidKit.box('paint', h.w, 0.05, h.d, 0, 0.025, -h.d / 2);
      lidKit.box('steel', 0.14, 0.03, 0.03, 0, 0.065, -depth * 0.7);                 // handle
      lidKit.box('dark', 0.08, 0.05, 0.06, 0, 0.03, -0.02);                          // hinge block
      const lid = lidKit.build(vehicleMats);
      lid.name = 'lid';
      hinge.add(lid);
      const hole = new THREE.Mesh(h.r ? holeDisc : holeRect, holeMat);
      hole.userData.slot = 'hole';
      hole.position.set(0, 0.006, -depth / 2);
      if (h.r) hole.scale.setScalar(h.r * 0.85); else hole.scale.set(h.w * 0.85, 1, h.d * 0.85);
      hinge.add(hole);
      parent.add(hinge);
      lid.traverse((o) => { if (o.isMesh) disposables.push(o.geometry); });
    }
    trackGeos(body);
    for (const c of root.children) if (c.isMesh) disposables.push(c.geometry);
    root.add(contactShadow(t.size[0] * 1.25, t.size[2] * 1.12));
    const tpl = { root, t, pivotY };
    templates.set(key, tpl);
    return tpl;
  }

  const soldiers = createSoldierFactory();

  const live = new Map();
  const debris = [];    // thrown parts: { obj, vel, spin, lift, rest, own }
  const pools = [];     // blood stains
  const blasts = [];    // recent explosions, to throw soldiers away from them
  const alerted = new Map();
  let clock = 0;
  const tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpV3 = new THREE.Vector3(),
    fwd = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), dronePos = new THREE.Vector3();

  function createVehicle(e) {
    const tpl = template(e.kind, e.variant);
    const root = tpl.root.clone(true);
    scene.add(root);
    const v = {
      id: e.id, kind: e.kind, variant: e.variant, root, tpl, t: tpl.t, pivotY: tpl.pivotY,
      body: root.getObjectByName('body'), inner: root.getObjectByName('inner'),
      turret: root.getObjectByName('turret'), gun: root.getObjectByName('gun'),
      wheels: root.children.filter((c) => c.name === 'wheel'), tracks: root.children.filter((c) => c.name === 'trackL' || c.name === 'trackR'),
      owned: [], dead: false, rollL: 0, rollR: 0, pitch: 0, pv: 0, rollA: 0, rv: 0, lastYaw: null, lastVf: 0, acc: 0, yawRate: 0,
      steer: 0, turretYaw: 0, gunEl: 0, exhaustAcc: Math.random(), dustAcc: 0, smokeAcc: 0, sink: 0, sinkTarget: 0, tilt: 0, tiltTarget: 0,
      phase: Math.random() * 100, rand: mulberry32(hashString(e.id) + 77), deathT: 0, flashT: 0, emit: [], events: [],
    };
    for (const tm of v.tracks) {
      const m = tm.material.clone();
      m.map = trackTex.clone();
      tm.material = m;
      v.owned.push(m, m.map);
    }
    v.hatches = (v.t.hatches ?? []).map((h) => {
      const hinge = root.getObjectByName('hatch:' + h.name);
      return { name: h.name, spec: h, hinge, lid: hinge?.getObjectByName('lid'), k: 0 };
    }).filter((h) => h.lid);
    v.crewFigs = [];                 // built when first needed
    v.headOut = v.rand() < 0.5;      // without crew data from the sim: the commander rides head-out
    v.decals = []; v.innerSmoke = 0; v.thrown = {}; v.hatchAcc = 0; v.fireAcc = 0;
    return v;
  }

  function createSoldier(e) {
    const s = soldiers.make(e.variant || 'rifleman', hashString(e.id));
    initSoldierAnim(s);
    const sh = contactShadow(0.9, 0.9);
    sh.material = shadowMat;
    s.root.add(sh);
    scene.add(s.root);
    return { id: e.id, kind: 'infantry', s, root: s.root, shadow: sh, dead: false, down: false, offset: new THREE.Vector3(), owned: [], stains: {}, trail: 0, last: null };
  }

  // Detach a part, keeping its world transform, and send it flying away from `from`.
  function toss(obj, from, speed, lift, spinK = 1, own = false) {
    if (!obj || !obj.parent) return;
    scene.attach(obj);
    const d = tmpV.copy(obj.getWorldPosition(tmpV2)).sub(from);
    d.y = 0;
    if (d.lengthSq() < 1e-4) d.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    d.normalize().multiplyScalar(speed * (0.6 + Math.random() * 0.6));
    d.y = lift * (0.7 + Math.random() * 0.6);
    debris.push({
      obj, vel: d.clone(), rest: false, own,
      spin: new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6).multiplyScalar(spinK),
      lift: new THREE.Box3().setFromObject(obj).getSize(tmpV3).y * 0.3,
    });
  }

  function chunk(at, size, mat, from, speed, lift) {
    const m = new THREE.Mesh(chunkGeo, mat);
    m.scale.copy(size);
    m.position.copy(at);
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    m.castShadow = true;
    scene.add(m);
    toss(m, from, speed, lift, 1.5, true);
  }

  // ---- Vehicle deaths ----------------------------------------------------------------------------

  function knockOffEra(v, fresh) {
    const meshes = [];
    v.root.traverse((o) => { if (o.isMesh && o.userData.slot === 'era' && o.geometry.userData.ranges) meshes.push(o); });
    const c = new THREE.Vector3(), box = new THREE.Box3(), size = new THREE.Vector3(), from = v.root.position;
    for (const o of meshes) {
      const ranges = o.geometry.userData.ranges;
      const g = o.geometry.clone();
      v.owned.push(g);
      o.geometry = g;
      const p = g.attributes.position;
      for (const [start, n] of ranges) {
        if (v.rand() > 0.42) continue;
        c.set(0, 0, 0); box.makeEmpty();
        for (let i = start; i < start + n; i++) { tmpV.fromBufferAttribute(p, i); c.add(tmpV); box.expandByPoint(tmpV); }
        c.multiplyScalar(1 / n);
        for (let i = start; i < start + n; i++) p.setXYZ(i, c.x, c.y, c.z);
        if (fresh && Math.random() < 0.7) chunk(o.localToWorld(c.clone()), box.getSize(size).clone(), eraLoose, from, rnd(4, 10), rnd(4, 9));
      }
      p.needsUpdate = true;
      g.computeBoundingSphere();
    }
  }

  function killVehicle(v, e, fresh = true, quiet = false) {
    if (v.dead) return;
    v.dead = true;
    v.quiet = quiet;
    for (const f of v.crewFigs) { f.s.root.visible = false; f.k = 0; }
    if (fresh && !quiet) v.blown = true;    // the blast throws the hatches open
    v.deathT = fresh ? 0 : 1e4;
    const t = v.t, cls = CLASS[v.kind] ?? 1, fuel = v.variant === 'fuel';
    v.burnDur = [55, 80, 100, 130][cls] * (0.8 + v.rand() * 0.4);
    v.charred = makeCharred();
    v.owned.push(v.charred);
    v.root.updateMatrixWorld(true);
    v.root.traverse((o) => {
      if (!o.isMesh || o.userData.shadow || o.userData.decal || o.isSkinnedMesh) return;
      const slot = o.userData.slot;
      if (slot === 'hole') return;
      if (slot === 'mark') o.visible = false;
      else if (slot === 'glass') o.material = holeMat;
      else if (slot === 'net') o.material = netBurnt;
      else if (slot === 'trackL' || slot === 'trackR') { o.material.color.setScalar(0.32); o.material.roughness = 1; }
      else if (slot === 'tyre') o.material = rubberBurnt;
      else o.material = v.charred;
    });
    if (!quiet) knockOffEra(v, fresh);
    if (v.gun) v.gun.rotation.x = -0.06 - v.rand() * 0.1; // barrel sags
    v.gunEl = v.gun ? v.gun.rotation.x : 0;

    // Fires: the engine bay first, then hatches; fuel trucks burn along the tank.
    v.emit = (t.fires ?? [t.engine]).map((p, i) => ({
      p: new THREE.Vector3(...p), power: (i === 0 ? 1 : 0.7) * (fuel ? 1.6 : 1),
      start: i === 0 ? 0 : 1 + v.rand() * 6, dur: v.burnDur * (i === 0 ? 1 : 0.45 + v.rand() * 0.4), fAcc: 0, sAcc: 0,
    }));
    // Tyres: one or two burst now, the rest catch and burn away, letting the hull down onto its rims.
    let tyres = v.wheels.filter((w) => w.userData.type === 'tyre');
    v.tyreCount = tyres.length;
    v.burnt = { L: 0, R: 0 };
    v.sinkTarget = 0;
    // Light vehicles and trucks can lose a wheel to the blast.
    if (fresh && !quiet && tyres.length && v.rand() < 0.4) {
      const w = tyres[Math.floor(v.rand() * tyres.length)];
      burnTyre(v, w, true);
      toss(w, v.root.position, 5, 7);
      tyres = tyres.filter((x) => x !== w);
    }
    tyres.forEach((w, i) => {
      const burst = fresh && !quiet && i < 2 && v.rand() < 0.6;
      const at = burst ? 0 : fresh ? rnd(6, v.burnDur * 0.55) : 0;
      v.events.push({ at, fn: () => burnTyre(v, w, burst, !fresh) });
      if (!burst && fresh) v.emit.push({ p: w.position.clone().setY(w.position.y + 0.2), power: 0.55, start: Math.max(0, at - 12), dur: 30, fAcc: 0, sAcc: 0, root: true });
    });
    for (const n of t.burnAway ?? []) {
      const part = v.inner.getObjectByName(n);
      if (part) v.events.push({ at: fresh ? rnd(2, 7) : 0, fn: () => { part.visible = false; if (fresh) flare(part.getWorldPosition(tmpV), 1.2); } });
    }
    if (!fresh) { for (const ev of v.events) ev.fn(); v.events.length = 0; v.sink = v.sinkTarget; v.tilt = v.tiltTarget; return; }
    if (quiet) {
      // Caught fire without blowing up (a fuel or engine fire spreading): no fireball; the rounds
      // inside start to cook off once it is well alight.
      if (v.kind === 'tank' || v.kind === 'apc') v.popAt = rnd(10, 25);
      return;
    }

    // The moment of the kill: flash, fireball, a burst of black smoke, parts and debris thrown.
    const c = v.inner.localToWorld(tmpV.set(0, t.size[1] * 0.6, 0)).clone();
    const S = [1.3, 1.8, 2.0, 2.5][cls] * (fuel ? 2.4 : 1);
    v.flashT = fuel ? 0.6 : 0.35;
    fire.spawn({ pos: [c.x, c.y, c.z], vel: [0, 0, 0], size: 6 * S, grow: 0.5, life: 0.13, color: [3, 2.5, 1.8], alpha: 1, fadeIn: 100, drag: 0 });
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, el = rnd(0.1, 1.4), sp = rnd(1.5, 5) * S;
      fire.spawn({
        pos: [c.x + rnd(-0.5, 0.5) * S, c.y, c.z + rnd(-0.5, 0.5) * S], vel: [Math.cos(a) * Math.cos(el) * sp, Math.sin(el) * sp + 2, Math.sin(a) * Math.cos(el) * sp],
        size: rnd(0.9, 1.7) * S, grow: 1.2, life: rnd(0.5, 1.1) * (fuel ? 1.8 : 1), drag: 3, gravity: -2,
        color: [2.6, 1.5, 0.5], colorEnd: [0.45, 0.1, 0.02], alpha: 0.9, fadeIn: 30,
      });
    }
    for (let i = 0; i < 10; i++) {
      const g = rnd(0.03, 0.07);
      smoke.spawn({ pos: [c.x + rnd(-1, 1), c.y, c.z + rnd(-1, 1)], vel: [rnd(-1.5, 1.5), rnd(2, 5), rnd(-1.5, 1.5)], size: rnd(1.2, 2) * S, grow: 3, life: rnd(6, 10), drag: 0.6, gravity: -0.2, wind: 1, color: [g, g, g], alpha: 0.75, fadeIn: 12 });
    }
    sparks(c, 40, 16);
    const at = v.root.position;
    for (const n of t.tossOnDeath ?? []) if (v.rand() < 0.65) toss(v.inner.getObjectByName(n), at, 4, 6);
    if (v.rand() < 0.5) toss(v.root.getObjectByName('cage'), at, 3, 7);
    // Torn plates and lumps of the hull.
    const n = [5, 7, 8, 10][cls];
    for (let i = 0; i < n; i++) {
      const plate = Math.random() < 0.6;
      const size = plate ? new THREE.Vector3(rnd(0.25, 0.7), rnd(0.02, 0.05), rnd(0.2, 0.55)) : new THREE.Vector3(rnd(0.15, 0.35), rnd(0.1, 0.25), rnd(0.15, 0.35));
      chunk(tmpV2.copy(c).add(tmpV3.set(rnd(-1, 1), rnd(-0.3, 0.5), rnd(-1.5, 1.5))), size, charredShared, at, rnd(4, 12), rnd(4, 11));
    }
    if (v.kind === 'tank' || v.kind === 'apc') v.popAt = rnd(2, 5);
    if (v.kind === 'tank' && v.rand() < 0.6) v.jetAt = rnd(3, 9);
  }

  function burnTyre(v, w, burst, quiet = false) {
    const ty = w.getObjectByName('tyre');
    if (!ty || !ty.visible) return;
    ty.visible = false;
    const side = w.userData.side < 0 ? 'L' : 'R';
    v.burnt[side]++;
    if (quiet) burst = false;
    const total = v.tyreCount || 1;
    const k = (v.burnt.L + v.burnt.R) / total;
    v.sinkTarget = (v.t.sink ?? 0) * k;
    const per = Math.max(1, total / 2);
    v.tiltTarget = 0.045 * (v.burnt.L - v.burnt.R) / per;
    const p = w.getWorldPosition(tmpV).clone();
    if (burst) {
      for (let i = 0; i < 3; i++) chunk(p, new THREE.Vector3(rnd(0.15, 0.35), 0.06, rnd(0.1, 0.25)), rubberBurnt, v.root.position, rnd(3, 7), rnd(2, 5));
      smoke.spawn({ pos: [p.x, p.y, p.z], vel: [0, 1, 0], size: 1.2, grow: 2, life: 2, drag: 2, color: [0.1, 0.1, 0.1], alpha: 0.6 });
    } else if (!quiet) flare(p, 0.8);
  }

  function flare(p, s) {
    for (let i = 0; i < 6; i++) {
      fire.spawn({ pos: [p.x + rnd(-0.3, 0.3), p.y, p.z + rnd(-0.3, 0.3)], vel: [rnd(-0.5, 0.5), rnd(1.5, 3.5), rnd(-0.5, 0.5)], size: rnd(0.6, 1.2) * s, grow: 0.8, life: rnd(0.5, 0.9), drag: 1.5, color: [2.4, 1.2, 0.35], colorEnd: [0.5, 0.1, 0.02], alpha: 0.85, fadeIn: 20 });
    }
  }

  function sparks(p, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, el = rnd(0.1, 1.4), sp = rnd(0.4, 1) * speed;
      fire.spawn({ pos: [p.x, p.y, p.z], vel: [Math.cos(a) * Math.cos(el) * sp, Math.sin(el) * sp, Math.sin(a) * Math.cos(el) * sp], size: rnd(0.06, 0.13), grow: 0, life: rnd(0.4, 1.3), drag: 0.8, gravity: 9.8, color: [3, 2, 0.9], colorEnd: [1.2, 0.3, 0.05], alpha: 1, fadeIn: 100 });
    }
  }

  // Ammunition cooking off inside: a bang, sparks and stray tracers, a puff of smoke.
  function ammoPop(v) {
    const fp = v.t.turret ? v.t.turret.pos : v.t.fires?.[1] ?? v.t.engine;
    const p = v.inner.localToWorld(tmpV.set(fp[0], fp[1] + 0.4, fp[2])).clone();
    fire.spawn({ pos: [p.x, p.y, p.z], vel: [0, 0, 0], size: rnd(1.8, 3.2), grow: 0.5, life: 0.1, color: [3, 2.4, 1.6], alpha: 1, fadeIn: 100, drag: 0 });
    sparks(p, Math.floor(rnd(20, 40)), rnd(10, 18));
    for (let i = 0, n = Math.floor(rnd(2, 6)); i < n; i++) {
      const a = Math.random() * Math.PI * 2, el = rnd(0.2, 1.3), sp = rnd(22, 40);
      fire.spawn({ pos: [p.x, p.y, p.z], vel: [Math.cos(a) * Math.cos(el) * sp, Math.sin(el) * sp, Math.sin(a) * Math.cos(el) * sp], size: 0.2, grow: 0, life: rnd(0.6, 1.0), drag: 0.25, gravity: 9.8, color: [3, 2.2, 1.1], colorEnd: [2, 0.6, 0.1], alpha: 1, fadeIn: 100 });
    }
    for (let i = 0; i < 3; i++) smoke.spawn({ pos: [p.x, p.y, p.z], vel: [rnd(-1, 1), rnd(1.5, 3), rnd(-1, 1)], size: 1.0, grow: 3, life: 3, drag: 1.5, wind: 1, color: [0.12, 0.12, 0.12], alpha: 0.6 });
    v.flashT = Math.max(v.flashT, 0.15);
  }

  function cookOff(v, e) {
    if (!v.dead) killVehicle(v, e, true);
    if (!v.turret || v.turret.parent !== v.inner) return;
    // The ammunition goes up: turret thrown clear on a jet of flame, cage and loose kit with it.
    toss(v.root.getObjectByName('cage'), v.root.position, 6, 12);
    toss(v.turret, v.root.position, 3, 14 + Math.random() * 5, 0.7);
    for (const n of ['drums', 'skirtL', 'skirtR', 'hatch']) toss(v.inner.getObjectByName(n), v.root.position, 7, 8);
    v.jetAt = v.deathT; v.jetDur = 2.2;
    v.flashT = 0.5;
  }

  // Burning, smoke columns, pops and glow for a wreck. Returns how brightly it burns now.
  function burnWreck(v, e, dt) {
    v.deathT += dt;
    for (let i = v.events.length - 1; i >= 0; i--) if (v.deathT >= v.events[i].at) { v.events[i].fn(); v.events.splice(i, 1); }
    const allowFire = e.onFire !== false;
    let glow = 0;
    const u = v.charred.userData.u;
    u.uTime.value = clock;
    u.uFire.value.forEach((f) => f.set(0, -1e4, 0, 0));
    v.emit.forEach((em, i) => {
      const age = v.deathT - em.start, life = age / em.dur;
      if (age < 0 || life > 1 || !allowFire) return;
      const env = Math.min(1, age / 1.5) * (1 - life * life) * em.power;
      glow = Math.max(glow, env);
      const w = (em.root ? v.root : v.inner).localToWorld(tmpV.copy(em.p));
      if (i < 4) u.uFire.value[i].set(w.x, w.y, w.z, env * 1.3);
      em.fAcc += dt * 15 * env; em.sAcc += dt * 3.6 * env;
      while (em.fAcc > 1) {
        em.fAcc -= 1;
        fire.spawn({ pos: [w.x + rnd(-0.3, 0.3), w.y + rnd(-0.1, 0.2), w.z + rnd(-0.3, 0.3)], vel: [rnd(-0.4, 0.4), rnd(1.5, 3.5), rnd(-0.4, 0.4)], size: rnd(0.45, 1.0) * Math.sqrt(em.power), grow: 0.5, life: rnd(0.4, 0.85), drag: 1, wind: 0.4, color: [2.3, 1.05, 0.3], colorEnd: [0.5, 0.09, 0.02], alpha: 0.85, fadeIn: 20 });
      }
      while (em.sAcc > 1) {
        em.sAcc -= 1;
        const g = rnd(0.02, 0.05);
        smoke.spawn({ pos: [w.x + rnd(-0.3, 0.3), w.y + 0.4, w.z + rnd(-0.3, 0.3)], vel: [rnd(-0.3, 0.3), rnd(3, 5), rnd(-0.3, 0.3)], size: rnd(1.0, 1.7), grow: 5, life: rnd(10, 14), drag: 0.15, gravity: -0.15, wind: 1.1, color: [g, g, g], alpha: 0.8, fadeIn: 6 });
      }
    });
    // Ammunition: pops while it burns, sometimes a long jet of flame from the turret ring.
    if (v.popAt !== undefined && allowFire && v.deathT > v.popAt && v.deathT < v.burnDur * 0.7) { ammoPop(v); v.popAt = v.deathT + rnd(1.5, 7); }
    if (v.jetAt !== undefined && v.deathT > v.jetAt && v.deathT < v.jetAt + (v.jetDur ?? 3) && allowFire) {
      const fp = v.t.turret?.pos ?? v.t.engine;
      const p = v.inner.localToWorld(tmpV.set(fp[0], fp[1] + 0.3, fp[2]));
      for (let i = 0; i < 2; i++) fire.spawn({ pos: [p.x + rnd(-0.2, 0.2), p.y, p.z + rnd(-0.2, 0.2)], vel: [rnd(-1, 1), rnd(10, 17), rnd(-1, 1)], size: rnd(0.6, 1.1), grow: 1.6, life: rnd(0.45, 0.8), drag: 1.2, color: [3, 2, 0.9], colorEnd: [0.9, 0.22, 0.03], alpha: 0.95, fadeIn: 40 });
      if (Math.random() < 0.4) sparks(p, 3, 12);
      glow = Math.max(glow, 1.5);
    }
    // After the fire: a thin smoulder that lasts.
    if (glow < 0.15) {
      v.smokeAcc += dt * 1.1;
      if (v.smokeAcc > 1) {
        v.smokeAcc -= 1;
        const w = v.inner.localToWorld(tmpV.fromArray(v.t.engine));
        smoke.spawn({ pos: [w.x, w.y, w.z], vel: [rnd(-0.2, 0.2), rnd(0.8, 1.5), rnd(-0.2, 0.2)], size: 0.7, grow: 4, life: 8, drag: 0.4, gravity: -0.1, wind: 1, color: [0.22, 0.21, 0.2], alpha: 0.22, fadeIn: 8 });
      }
    }
    v.flashT = Math.max(0, v.flashT - dt);
    return glow;
  }

  // ---- Living vehicles ---------------------------------------------------------------------------

  function driveVehicle(v, e, dt, drone) {
    const t = v.t, q = tmpQ.fromArray(e.quaternion);
    fwd.set(0, 0, -1).applyQuaternion(q);
    const vel = e.velocity ?? [0, 0, 0];
    const vf = vel[0] * fwd.x + vel[1] * fwd.y + vel[2] * fwd.z;
    const yaw = Math.atan2(-fwd.x, -fwd.z);
    let w = 0;
    if (v.lastYaw !== null && dt > 0) w = wrap(yaw - v.lastYaw) / dt;
    v.lastYaw = yaw;
    if (dt > 0) {
      v.yawRate += (clamp(w, -2, 2) - v.yawRate) * Math.min(1, dt * 5);
      v.acc += (clamp((vf - v.lastVf) / dt, -8, 8) - v.acc) * Math.min(1, dt * 4);
    }
    v.lastVf = vf;
    // Sprung hull: squats when pulling away, dips when braking, leans out of turns, engine rumble.
    const tp = clamp(v.acc * (t.tracked ? 0.012 : 0.009), -0.04, 0.04) + 0.004 * Math.sin(v.rollL * 2.1) * Math.min(1, Math.abs(vf) / 3);
    const tr = clamp(-v.yawRate * vf * 0.012, -0.045, 0.045);
    v.pv += ((tp - v.pitch) * 45 - v.pv * 7) * dt; v.pitch += v.pv * dt;
    v.rv += ((tr - v.rollA) * 45 - v.rv * 7) * dt; v.rollA += v.rv * dt;
    const hum = Math.sin(clock * 47 + v.phase);
    const running = engineRunning(e);
    v.body.rotation.set(v.pitch + (running ? 0.0012 * Math.sin(clock * 31 + v.phase) : 0), 0, v.rollA);
    v.body.position.y = v.pivotY + (running ? 0.0025 * hum : 0);
    // Wheels and tracks, each side at its own speed.
    const halfW = t.size[0] * 0.4;
    v.rollL += (vf - v.yawRate * halfW) * dt;
    v.rollR += (vf + v.yawRate * halfW) * dt;
    if (!t.tracked && dt > 0) {
      const target = Math.abs(vf) > 0.3 ? clamp(Math.atan((v.yawRate * t.size[2] * 0.55) / vf), -0.5, 0.5) : v.steer;
      v.steer += (target - v.steer) * Math.min(1, dt * 4);
    }
    for (const wg of v.wheels) {
      wg.rotation.x = -(wg.userData.side < 0 ? v.rollL : v.rollR) / wg.userData.r;
      if (wg.userData.steer) wg.rotation.y = v.steer * wg.userData.steer;
    }
    for (const tm of v.tracks) tm.material.map.offset.y = -(tm.name === 'trackL' ? v.rollL : v.rollR) / LINK;
    // Turret slews toward the sim's aim; the gun lifts toward the drone when it bears on it.
    if (v.turret && v.turret.parent === v.inner) {
      const rate = { tank: 0.7, apc: 1.1, light: 2.2 }[v.kind] ?? 1;
      v.turretYaw += clamp(wrap((e.turretYaw ?? 0) - v.turretYaw), -rate * dt, rate * dt);
      v.turret.rotation.y = v.turretYaw;
      if (v.gun) {
        let target = 0;
        const manned = (e.crewAlive ?? 1) > 0 && e.firepower !== 'disabled' && !e.abandoned;
        if (v.gunDead) target = v.gunDroop;
        else if (drone && manned) {
          const l = v.root.worldToLocal(tmpV.copy(drone));
          const dist = Math.hypot(l.x, l.z);
          const maxEl = v.kind === 'tank' ? 0.24 : v.variant === 'btr' ? 1.0 : 1.2;
          if (dist < 250 && Math.abs(wrap(Math.atan2(-l.x, -l.z) - v.turretYaw)) < 0.35) target = clamp(Math.atan2(l.y - t.size[1], dist), -0.08, maxEl);
        }
        v.gunEl += clamp(target - v.gunEl, -0.35 * dt, 0.35 * dt);
        v.gun.rotation.x = v.gunEl;
      }
    }
    // Exhaust: a light haze at idle, a black puff when the driver puts his foot down.
    const hard = v.acc > 0.8;
    v.exhaustAcc += running ? dt * (1.6 + Math.max(0, v.acc) * 4 + Math.abs(vf) * 0.3) : 0;
    while (v.exhaustAcc > 1) {
      v.exhaustAcc -= 1;
      for (const ex of t.exhaust ?? []) {
        const p = v.inner.localToWorld(tmpV.set(ex[0], ex[1], ex[2]));
        const d = tmpV2.set(ex[3], ex[4], ex[5]).applyQuaternion(v.root.quaternion);
        const g = hard ? 0.07 : 0.33;
        smoke.spawn({ pos: [p.x, p.y, p.z], vel: [d.x * 1.3, d.y * 1.3 + 0.4, d.z * 1.3], size: 0.25, grow: 5, life: 2.2, drag: 1.5, gravity: -0.2, wind: 1, color: [g, g, g * 1.06], alpha: hard ? 0.45 : 0.15, fadeIn: 10 });
      }
    }
    // Dust kicked up behind when driving fast.
    if (Math.abs(vf) > 2.5) {
      v.dustAcc += dt * Math.abs(vf) * 0.8;
      while (v.dustAcc > 1) {
        v.dustAcc -= 1;
        const sx = Math.random() < 0.5 ? -1 : 1;
        const p = v.root.localToWorld(tmpV.set(sx * t.size[0] * 0.42, 0.25, t.size[2] * 0.45 * Math.sign(vf)));
        smoke.spawn({ pos: [p.x, p.y, p.z], vel: [rnd(-0.5, 0.5), rnd(0.4, 1), rnd(-0.5, 0.5)], size: 0.8, grow: 3, life: 2.5, drag: 1.2, wind: 1, color: [0.31, 0.27, 0.21], alpha: 0.22 });
      }
    }
    // Damage smoke from the engine bay, thicker as damage grows; small flames when it is bad.
    const hurt = e.smoke ? ({ none: 0, light: 0.35, heavy: 1 }[e.smoke] ?? 0)
      : e.damage ? ({ none: 0, light: 0.35, heavy: 1 }[e.damage] ?? 0)
      : e.components ? 0 : clamp((0.6 - (e.health ?? 1)) / 0.6, 0, 1);
    if (hurt > 0) {
      const p = v.inner.localToWorld(tmpV.fromArray(t.engine));
      v.smokeAcc += dt * (2 + 8 * hurt);
      while (v.smokeAcc > 1) {
        v.smokeAcc -= 1;
        const g = 0.2 - 0.12 * hurt;
        smoke.spawn({ pos: [p.x + rnd(-0.3, 0.3), p.y, p.z + rnd(-0.3, 0.3)], vel: [rnd(-0.3, 0.3), rnd(1.5, 3), rnd(-0.3, 0.3)], size: 0.8, grow: 3.5, life: 4.5, drag: 0.5, gravity: -0.2, wind: 1, color: [g, g, g], alpha: 0.3 + 0.35 * hurt, fadeIn: 8 });
        if (!e.fire && hurt > 0.9 && Math.random() < 0.25) flare(p, 0.5);
      }
    }
  }

  // ---- Damage that doesn't burn: crew, hatches, tracks, guns, hit marks --------------------------------

  function engineRunning(e) {
    if (e.abandoned || (e.crewTotal > 0 && e.crewAlive === 0)) return false;
    const en = e.components?.engine;
    return !en || en.state !== 'destroyed';
  }

  // Which pose a crew seat shows: 'hatch' / 'driver' / 'gunner' (alive, out), 'slumped' (dead, out),
  // or null (inside, bailed out, or gone).
  function crewMode(v, e, spot) {
    if (v.dead) return null;
    const m = Array.isArray(e.crew) ? e.crew.find((c) => c.role === spot.role) : null;
    if (m) {
      if (m.state === 'bailed' || !m.visible) return null;
      return m.state === 'dead' ? 'slumped' : spot.mode ?? 'hatch';
    }
    if (Array.isArray(e.crew) && spot.mode !== 'gunner') return null;
    // No crew data: gunners stand at their gun; commanders ride head-out until something happens.
    if (spot.mode === 'gunner') return (e.health ?? 1) > 0 ? 'gunner' : 'slumped';
    const calm = !(alerted.has(e.id) && clock - alerted.get(e.id) < 60) && (e.health ?? 1) >= 1 && e.status !== 'fleeing';
    return spot.role === 'commander' && v.headOut && calm ? 'hatch' : null;
  }

  function crewFigure(v, spot) {
    let f = v.crewFigs.find((x) => x.spot === spot);
    if (f) return f;
    const parent = spot.on === 'turret' && v.turret ? v.turret : v.inner;
    const s = soldiers.make('crew', hashString(v.id + spot.role) + 5);
    initSoldierAnim(s);
    s.root.position.fromArray(spot.pos);
    s.root.scale.setScalar(s.scale);
    s.root.visible = false;
    parent.add(s.root);
    f = { spot, s, k: 0, mode: null };
    v.crewFigs.push(f);
    return f;
  }

  function updateCrewAndHatches(v, e, dt) {
    const want = {};
    for (const spot of v.t.crew ?? []) {
      const mode = crewMode(v, e, spot);
      let f = v.crewFigs.find((x) => x.spot === spot);
      if (!mode && !f) continue;
      f ??= crewFigure(v, spot);
      if (mode) { f.mode = mode; if (spot.hatch) want[spot.hatch] = true; }
      // Climb up once the hatch is open, duck back down when told to; the dead stay where they fell.
      const h = v.hatches.find((x) => x.name === spot.hatch);
      const open = !h || h.k > 0.75;
      const tk = mode && open ? 1 : 0;
      f.k += clamp(tk - f.k, -dt * 2.2, dt * 1.6);
      f.s.root.visible = f.k > 0.02;
      f.s.root.position.set(spot.pos[0], spot.pos[1] - (1 - f.k) * 0.95 + (f.mode === 'slumped' ? 0.06 : 0), spot.pos[2]);
      if (f.s.root.visible && dt > 0) {
        const al = alerted.has(e.id) && clock - alerted.get(e.id) < 60;
        animateCrew(f.s, { dt, mode: f.mode === 'driver' ? 'hatch' : f.mode, alert: al, seated: spot.mode === 'driver' });
      }
    }
    for (const h of v.hatches) {
      const open = v.blown || !!e.hatches?.[h.name] || !!want[h.name] || (h.name === 'rear' && e.bailing);
      h.k += clamp((open ? 1 : 0) - h.k, -dt * 1.2, dt * (v.blown ? 8 : 1.4));
      const a = h.k * h.k * (3 - 2 * h.k);
      h.lid.rotation.x = a * (h.spec.r ? 1.95 : 1.75);
    }
  }

  // Thrown track: the belt comes off and lies in a crumpled run behind the hull on that side.
  function throwTrack(v, side) {
    v.thrown[side] = true;
    const belt = v.tracks.find((t) => t.name === 'track' + side);
    if (belt) belt.visible = false;
    const sz = v.t.size, w = sz[0] * 0.16, len = sz[2] * 0.9;
    const g = new THREE.PlaneGeometry(w, len, 1, 28).rotateX(-HALF_PI);
    const pos = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      pos.setY(i, 0.04 + Math.max(0, Math.sin(z * 1.7 + side.length) * 0.06) + (z < -len * 0.3 ? 0.2 * ((-len * 0.3 - z) / len) : 0));
      pos.setX(i, pos.getX(i) + Math.sin(z * 0.8) * 0.12);
      uv.setY(i, uv.getY(i) * len / LINK);
    }
    g.computeVertexNormals();
    const mat = trackMat.clone();
    const m = new THREE.Mesh(g, mat);
    m.userData.slot = 'trackL';
    v.owned.push(mat);
    m.castShadow = m.receiveShadow = true;
    const sx = side === 'L' ? -1 : 1;
    m.position.set(sx * (sz[0] / 2 - w / 2), 0, sz[2] * 0.42);
    m.rotation.y = sx * 0.12;
    v.root.add(m);
    v.owned.push(g);
    const p = v.root.localToWorld(tmpV.set(sx * sz[0] * 0.5, 0.4, 0)).clone();
    sparks(p, 12, 6);
    smoke.spawn({ pos: [p.x, p.y, p.z], vel: [0, 0.8, 0], size: 1.4, grow: 2, life: 2.5, drag: 2, wind: 1, color: [0.3, 0.27, 0.22], alpha: 0.45 });
  }

  // Shows the components' state: thrown tracks, a drooping gun, flat tyres, smoke seeping from open
  // hatches after a penetration, and an engine fire that is not (yet) the whole vehicle burning.
  function damageLook(v, e, dt) {
    const c = e.components;
    if (c) {
      for (const side of ['L', 'R']) if (c['track' + side]?.state === 'destroyed' && !v.thrown[side]) throwTrack(v, side);
      if (c.gun?.state === 'destroyed' && !v.gunDead && v.gun) {
        v.gunDead = true; v.gunDroop = -0.06 - v.rand() * 0.06;
        v.gun.rotation.y = (v.rand() - 0.5) * 0.06;
      }
      if (c.wheels?.state === 'destroyed' && !v.flat) {
        v.flat = true;
        const tyres = v.wheels.filter((w) => w.userData.type === 'tyre');
        const w = tyres[Math.floor(v.rand() * tyres.length)];
        if (w) { w.position.y -= w.userData.r * 0.18; v.tiltTarget = 0.025 * w.userData.side; v.sinkTarget = 0.04; }
      }
    }
    // Smoke from inside after a penetration or a crew kill, out of whatever is open.
    if ((e.kill === 'crew' || (e.crewTotal > 0 && e.crewAlive === 0)) && v.innerSmoke < 0.35 && !v.crewSmoked) { v.crewSmoked = true; v.innerSmoke = 0.8; }
    v.innerSmoke = Math.max(0, v.innerSmoke - dt / 140);
    if (v.innerSmoke > 0.01) {
      v.hatchAcc += dt * 5 * v.innerSmoke;
      while (v.hatchAcc > 1) {
        v.hatchAcc -= 1;
        const open = v.hatches.filter((h) => h.k > 0.3);
        if (!open.length) break;
        const h = open[Math.floor(Math.random() * open.length)];
        const p = h.hinge.localToWorld(tmpV.set(0, 0.1, -(h.spec.r ?? h.spec.d / 2)));
        const g = rnd(0.16, 0.26);
        smoke.spawn({ pos: [p.x, p.y, p.z], vel: [rnd(-0.2, 0.2), rnd(0.8, 1.6), rnd(-0.2, 0.2)], size: 0.35, grow: 2.2, life: rnd(3, 5), drag: 0.8, gravity: -0.15, wind: 1, color: [g, g, g * 1.04], alpha: 0.32 * Math.min(1, v.innerSmoke * 2), fadeIn: 10 });
      }
    }
    // Engine fire: flames through the deck grilles, black smoke, the glow on the hull.
    let glow = 0;
    if (e.fire === 'engine') {
      const p = v.inner.localToWorld(tmpV.fromArray(v.t.engine));
      glow = 0.6 + 0.15 * Math.sin(clock * 9 + v.phase);
      v.fireAcc += dt * 12;
      while (v.fireAcc > 1) {
        v.fireAcc -= 1;
        fire.spawn({ pos: [p.x + rnd(-0.5, 0.5), p.y + 0.05, p.z + rnd(-0.5, 0.5)], vel: [rnd(-0.3, 0.3), rnd(1.2, 2.8), rnd(-0.3, 0.3)], size: rnd(0.35, 0.8), grow: 0.5, life: rnd(0.35, 0.7), drag: 1, wind: 0.4, color: [2.3, 1.05, 0.3], colorEnd: [0.5, 0.09, 0.02], alpha: 0.85, fadeIn: 20 });
        if (Math.random() < 0.3) {
          const g = rnd(0.03, 0.06);
          smoke.spawn({ pos: [p.x + rnd(-0.3, 0.3), p.y + 0.4, p.z + rnd(-0.3, 0.3)], vel: [rnd(-0.3, 0.3), rnd(2.5, 4), rnd(-0.3, 0.3)], size: rnd(0.8, 1.3), grow: 4, life: rnd(8, 11), drag: 0.2, gravity: -0.15, wind: 1.1, color: [g, g, g], alpha: 0.7, fadeIn: 6 });
        }
      }
    }
    return glow;
  }

  // A mark where a hit struck the hull: a penetration hole, a blast scorch or fragment pocks. The
  // sim gives the point and normal in the hull's frame; the mark goes onto the drawn surface there.
  function hullMark(v, e, ev) {
    const q = tmpQ.fromArray(e.quaternion);
    let p, n;
    if (ev.localPosition) {
      p = new THREE.Vector3().fromArray(ev.localPosition).applyQuaternion(q).add(tmpV.fromArray(e.position));
      n = new THREE.Vector3().fromArray(ev.localNormal ?? [0, 1, 0]).applyQuaternion(q).normalize();
    } else {
      p = new THREE.Vector3().fromArray(ev.position);
      n = p.clone().sub(v.inner.localToWorld(tmpV.set(0, v.t.size[1] * 0.5, 0))).normalize();
    }
    v.root.updateMatrixWorld(true);
    raycaster.set(tmpV2.copy(p).addScaledVector(n, 1.2), tmpV3.copy(n).negate());
    raycaster.far = 3;
    const hits = raycaster.intersectObject(v.root, true).filter((h) => h.object.isMesh && !h.object.isSkinnedMesh && !h.object.userData.shadow && !h.object.userData.decal && h.object.userData.slot !== 'hole' && h.object.visible);
    let target = v.inner, at = p, nw = n;
    if (hits.length) {
      const h = hits[0];
      target = h.object; at = h.point;
      if (h.face) nw = h.face.normal.clone().transformDirection(h.object.matrixWorld);
    }
    const jet = ev.penetrated || ev.source === 'jet';
    const mat = jet ? holeDecal : ev.source === 'fragments' ? pockDecal : scorchDecal;
    const size = jet ? rnd(0.3, 0.42) : ev.source === 'fragments' ? rnd(0.5, 0.8) : rnd(0.8, 1.2);
    const d = new THREE.Mesh(decalGeo, mat);
    d.userData.decal = true;
    d.position.copy(at).addScaledVector(nw, 0.005);
    d.quaternion.setFromUnitVectors(tmpV.set(0, 0, 1), nw);
    d.rotateZ(Math.random() * Math.PI * 2);
    d.scale.setScalar(size);
    scene.add(d);
    target.attach(d);
    v.decals.push(d);
    if (v.decals.length > 14) { const old = v.decals.shift(); old.parent?.remove(old); }
    if (jet) {
      // The jet went in: a puff of smoke and dust out of every opening.
      v.innerSmoke = Math.max(v.innerSmoke, 0.6);
      for (const h of v.hatches) if (h.k > 0.3) {
        const hp = h.hinge.localToWorld(tmpV.set(0, 0.1, -(h.spec.r ?? h.spec.d / 2)));
        for (let i = 0; i < 3; i++) smoke.spawn({ pos: [hp.x, hp.y, hp.z], vel: [rnd(-0.5, 0.5), rnd(2, 4), rnd(-0.5, 0.5)], size: 0.5, grow: 3, life: 2.5, drag: 1.5, wind: 1, color: [0.22, 0.21, 0.2], alpha: 0.5 });
        sparks(hp, 6, 6);
      }
    }
  }

  // ---- Soldiers -----------------------------------------------------------------------------------

  function bloodMist(p, n = 4) {
    for (let i = 0; i < n; i++) {
      smoke.spawn({ pos: p, vel: [(Math.random() - 0.5) * 2, 0.5 + Math.random() * 1.2, (Math.random() - 0.5) * 2], size: 0.25 + Math.random() * 0.2, grow: 1.5, life: 0.5 + Math.random() * 0.4, drag: 3, gravity: 2, color: [0.32, 0.03, 0.02], alpha: 0.4, fadeIn: 30 });
    }
  }

  function killSoldier(v, e) {
    v.dead = true;
    const s = v.s, rand = mulberry32(hashString(e.id) + 13);
    if (v.down) { s.st.dead.alive = false; return; }   // died where he lay
    // A close blast throws the body; one farther off just knocks it down.
    let push = null;
    for (const b of blasts) {
      const d = Math.hypot(e.position[0] - b.pos[0], e.position[2] - b.pos[2]);
      const reach = (b.radius ?? 8) * 1.6;
      if (d < reach && clock - b.time < 1.5) {
        const k = 1 - d / reach;
        const dir = new THREE.Vector3(e.position[0] - b.pos[0], 0, e.position[2] - b.pos[2]);
        if (dir.lengthSq() < 1e-3) dir.set(rand() - 0.5, 0, rand() - 0.5);
        dir.normalize();
        push = { vel: dir.multiplyScalar(3 + k * 9).setY(2 + k * 6), spin: (rand() - 0.5) * 10 + Math.sign(rand() - 0.5) * k * 6 };
        break;
      }
    }
    v.fly = push ? { vel: push.vel } : null;
    killSoldierAnim(s, push);
    toss(s.weapon, new THREE.Vector3().fromArray(e.position), push ? 4 : 1.2, push ? 4 : 1.5, 1.5);
    bloodMist([e.position[0], e.position[1] + 1.1, e.position[2]], push ? 6 : 3);
  }

  function addPool(x, z, size, grow = 10) {
    const m = new THREE.Mesh(bloodGeo, bloodMat);
    m.position.set(x, level.terrain.heightAt(x, z) + 0.03, z);
    m.rotation.y = Math.random() * Math.PI * 2;
    m.scale.setScalar(0.01);
    m.userData = { target: size, t: 0, grow };
    scene.add(m);
    pools.push(m);
    if (pools.length > 160) scene.remove(pools.shift());
  }

  // Blood soaking through the uniform at a wound, stuck to the bone so it moves with the limb.
  const STAIN_AT = {
    torso: ['chest', [0, -0.1, -0.6], [0, 0, 1]], head: null,
    armL: ['armL', [0, -0.14, -0.5], [0, 0, 1]], armR: ['armR', [0, -0.14, -0.5], [0, 0, 1]],
    legL: ['thighL', [0, -0.2, -0.6], [0, 0, 1]], legR: ['thighR', [0, -0.2, -0.6], [0, 0, 1]],
  };
  function stain(v, part, severity) {
    const at = STAIN_AT[part];
    if (!at || v.stains[part]) return;
    v.stains[part] = true;
    const s = v.s, bone = s.bones[at[0]];
    s.root.updateMatrixWorld(true);
    const o = bone.localToWorld(new THREE.Vector3(at[1][0] + (Math.random() - 0.5) * 0.06, at[1][1] + (Math.random() - 0.5) * 0.08, at[1][2]));
    const dir = new THREE.Vector3(...at[2]).transformDirection(bone.matrixWorld);
    s.body.boundingSphere = null;
    raycaster.set(o, dir); raycaster.far = 1;
    const hit = raycaster.intersectObject(s.root, true).find((h) => h.object.isMesh && !h.object.userData.decal && !h.object.userData.shadow);
    const d = new THREE.Mesh(decalGeo, stainMat);
    d.userData.decal = true;
    const nrm = hit?.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : dir.clone().negate();
    d.position.copy(hit ? hit.point : bone.getWorldPosition(new THREE.Vector3())).addScaledVector(nrm, 0.004);
    d.quaternion.setFromUnitVectors(tmpV.set(0, 0, 1), nrm);
    d.rotateZ(Math.random() * Math.PI * 2);
    d.scale.setScalar(0.09 + 0.12 * severity);
    scene.add(d);
    bone.attach(d);           // keeps the world placement, then follows the limb
  }
  function woundStains(v, e) {
    const w = e.wounds;
    if (!w) return;
    for (const part of ['torso', 'armL', 'armR', 'legL', 'legR']) if ((w[part] ?? 1) < 0.85) stain(v, part, clamp(1 - w[part], 0.2, 1));
  }

  function updateSoldier(v, e, dt, speed, drone) {
    const s = v.s;
    const sc = s.scale * clamp((e.size?.[1] ?? SOLDIER_HEIGHT) / SOLDIER_HEIGHT, 0.85, 1.15);
    s.root.scale.setScalar(sc);
    if (dt > 0) woundStains(v, e);
    // Down: collapses where he stands, drops the weapon and lies writhing (and bleeding).
    if (e.status === 'down' && !v.down && !v.dead) {
      v.down = true;
      s.root.position.fromArray(e.position);
      s.root.quaternion.fromArray(e.quaternion);
      downSoldierAnim(s);
      toss(s.weapon, new THREE.Vector3().fromArray(e.position), 1.2, 1.2, 1);
    }
    if (v.down && !v.dead) {
      s.root.position.fromArray(e.position).add(v.offset);
      if (dt > 0) animateDeadSoldier(s, dt);
      if (!v.pooled && e.bleeding !== false && s.st.dead.t > 2) {
        v.pooled = true;
        s.bones.chest.getWorldPosition(tmpV);
        addPool(tmpV.x, tmpV.z, 0.5 + Math.random() * 0.4, 40);
      }
      return;
    }
    if (v.dead) {
      if (v.fly) {
        // Thrown: a ballistic arc, then a thud.
        v.fly.vel.y -= 9.8 * dt;
        v.offset.addScaledVector(v.fly.vel, dt);
        const gy = level.terrain.heightAt(e.position[0] + v.offset.x, e.position[2] + v.offset.z) - e.position[1];
        if (v.offset.y <= gy) {
          v.offset.y = gy;
          v.fly = null;
          landSoldier(s);
          smoke.spawn({ pos: [e.position[0] + v.offset.x, e.position[1] + v.offset.y + 0.2, e.position[2] + v.offset.z], vel: [0, 0.5, 0], size: 0.9, grow: 2, life: 1.4, drag: 2, color: [0.3, 0.26, 0.2], alpha: 0.4 });
        }
      }
      s.root.position.fromArray(e.position).add(v.offset);
      if (dt > 0) animateDeadSoldier(s, dt);
      v.shadow.visible = !v.fly;
      const d = s.st.dead;
      if (!v.pooled && d.landed && (d.t > 0.8 || v.down)) {
        v.pooled = true;
        s.bones.chest.getWorldPosition(tmpV);
        addPool(tmpV.x, tmpV.z, 0.45 + Math.random() * 0.35);
      }
      return;
    }
    s.root.position.fromArray(e.position);
    s.root.quaternion.fromArray(e.quaternion);
    const al = alerted.has(e.id) && clock - alerted.get(e.id) < 60 ? 1 : 0;
    if (dt > 0) animateSoldier(s, { dt, speed, status: e.status, drone, alert: al, wounds: e.wounds });
    // A bleeding man leaves a trail of drops.
    if (e.bleeding && dt > 0) {
      v.trail += speed * dt;
      if (v.trail > 0.9) { v.trail = 0; addPool(e.position[0] + rnd(-0.2, 0.2), e.position[2] + rnd(-0.2, 0.2), rnd(0.1, 0.22), 1); }
    }
    v.shadow.scale.set(0.9, 1, 0.9 + s.st.p * 0.5);
  }

  // ---- Events and the frame -------------------------------------------------------------------------

  function hit(ev, byId) {
    const p = ev.position;
    const v = live.get(ev.entityId), e = byId.get(ev.entityId);
    if (v && v.kind === 'infantry') {
      bloodMist(p, 3);
      if (ev.bodyPart && !v.dead) stain(v, ev.bodyPart, clamp((ev.damage ?? 0.3) * 2, 0.3, 1));
      return;
    }
    if (v && e && !v.dead) hullMark(v, e, ev);
    sparks({ x: p[0], y: p[1], z: p[2] }, ev.weakSpot || ev.penetrated ? 40 : 18, 16);
    for (let i = 0; i < 5; i++) smoke.spawn({ pos: p, vel: [(Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3], size: 0.8, grow: 2.5, life: 1.8, drag: 2, color: [0.2, 0.19, 0.17], alpha: 0.5, wind: 0.6 });
  }

  function vehicleNear(ev) {
    const byId = ev.objectId && live.get(ev.objectId);
    if (byId && byId.kind !== 'infantry') return byId;
    let best = null, bd = 6;
    for (const v of live.values()) {
      if (v.kind === 'infantry') continue;
      const d = v.root.position.distanceTo(tmpV.fromArray(ev.position));
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  function update(state, events, dt) {
    clock += dt;
    const ents = state.entities ?? [];
    const byId = new Map(ents.map((e) => [e.id, e]));
    const drone = state.drone && !state.drone.destroyed && state.drone.position ? dronePos.fromArray(state.drone.position) : null;
    for (const ev of events) {
      if (ev.type === 'hit') hit(ev, byId);
      else if (ev.type === 'entity_alerted') alerted.set(ev.entityId, clock);
      else if (ev.type === 'explosion') {
        blasts.push({ pos: ev.position, radius: ev.radius, time: clock });
        if (blasts.length > 8) blasts.shift();
        if (ev.kind === 'ammo' || ev.kind === 'vehicle') {
          const v = vehicleNear(ev);
          if (v) {
            const e = byId.get(v.id);
            if (ev.turretToss || (v.kind === 'tank' && ev.kind === 'ammo')) cookOff(v, e);
            else {
              if (!v.dead) killVehicle(v, e, true);
              for (const n of ['hatch', 'spare', 'cage', 'drums']) toss(v.root.getObjectByName(n), v.root.position, 6, 9);
              if (ev.kind === 'vehicle') for (const em of v.emit) em.power *= 1.25;
              ammoPop(v);
            }
          }
        }
      } else if (ev.type === 'entity_destroyed') {
        const v = live.get(ev.entityId);
        if (v && !v.dead && v.kind !== 'infantry') killVehicle(v, byId.get(ev.entityId), true);
      } else if (ev.type === 'targets_reset' || (ev.type === 'reset' && ents.length === 0)) {
        // Every enemy respawns with the same id: drop wrecks and corpses so they are rebuilt intact.
        clear();
        smoke.clear(); fire.clear();
      }
    }

    const seen = new Set();
    const burning = [];
    for (const e of ents) {
      seen.add(e.id);
      let v = live.get(e.id);
      const alive = ['idle', 'moving', 'fleeing', 'prone', 'wounded', 'crawling', undefined].includes(e.status);
      if (v && (v.dead || v.down) && alive) { remove(e.id, v); v = null; } // came back to life (respawned)
      if (!v) {
        v = e.kind === 'infantry' ? createSoldier(e) : createVehicle(e);
        live.set(e.id, v);
        if (e.status === 'destroyed') {
          if (v.kind === 'infantry') {
            v.dead = true;
            killSoldierAnim(v.s, null);
            toss(v.s.weapon, new THREE.Vector3().fromArray(e.position), 1, 1);
            for (let i = 0; i < 30; i++) animateDeadSoldier(v.s, 0.1);
            v.s.st.dead.landed = true;
          } else {
            v.root.position.fromArray(e.position); v.root.quaternion.fromArray(e.quaternion);
            killVehicle(v, e, false);
            if (e.onFire) v.deathT = 5;
          }
        }
      }
      const speed = Math.hypot(e.velocity?.[0] ?? 0, e.velocity?.[2] ?? 0);

      if (v.kind === 'infantry') {
        if (e.status === 'destroyed' && !v.dead) killSoldier(v, e);
        updateSoldier(v, e, dt, speed, drone);
        continue;
      }

      if (e.status === 'destroyed' && !v.dead) killVehicle(v, e, true);
      // Burning without having blown up: the fire takes hold quietly.
      if (e.fire === 'full' && !v.dead) killVehicle(v, e, true, true);
      v.sink += (v.sinkTarget - v.sink) * Math.min(1, dt * 0.4);
      v.tilt += (v.tiltTarget - v.tilt) * Math.min(1, dt * 0.4);
      v.root.position.fromArray(e.position);
      v.root.quaternion.fromArray(e.quaternion);
      if (v.tilt) v.root.rotateZ(v.tilt);
      v.root.position.addScaledVector(up.set(0, 1, 0).applyQuaternion(v.root.quaternion), -v.sink);
      const sz = v.t.size;
      if (e.size) v.root.scale.set(clamp(e.size[0] / sz[0], 0.85, 1.15), clamp(e.size[1] / sz[1], 0.85, 1.15), clamp(e.size[2] / sz[2], 0.85, 1.15));
      v.root.updateMatrixWorld(true);
      if (!v.dead) {
        if (dt > 0) {
          driveVehicle(v, e, dt, drone);
          const glow = damageLook(v, e, dt);
          if (glow > 0) burning.push({ v, glow });
        }
        updateCrewAndHatches(v, e, dt);
        continue;
      }
      updateCrewAndHatches(v, e, dt);
      v.body.rotation.set(0, 0, 0);
      v.body.position.y = v.pivotY;
      if (dt > 0) {
        const glow = burnWreck(v, e, dt);
        if (glow > 0 || v.flashT > 0) burning.push({ v, glow });
      }
    }
    for (const [id, v] of live) if (!seen.has(id)) remove(id, v);

    // Fire lights go to the brightest fires nearest the drone.
    const ref = drone ?? (state.camera?.position ? tmpV3.fromArray(state.camera.position) : null);
    burning.sort((a, b) => b.glow / (1 + (ref ? a.v.root.position.distanceToSquared(ref) : 0)) - a.glow / (1 + (ref ? b.v.root.position.distanceToSquared(ref) : 0)));
    fireLights.forEach((l, i) => {
      const b = burning[i];
      if (!b) { l.intensity = 0; return; }
      const fp = b.v.t.fires?.[0] ?? b.v.t.engine;
      b.v.inner.localToWorld(l.position.set(fp[0], fp[1] + 1.0, fp[2]));
      const flick = 0.75 + 0.25 * Math.sin(clock * 17 + i) * Math.sin(clock * 6.3 + i * 2);
      l.intensity = 220 * Math.min(1.5, b.glow) * flick + 3500 * b.v.flashT * b.v.flashT;
    });

    // Thrown parts: fly, bounce once or twice, settle.
    for (const d of debris) {
      if (d.rest) continue;
      d.vel.y -= 9.8 * dt;
      d.obj.position.addScaledVector(d.vel, dt);
      d.obj.rotation.x += d.spin.x * dt; d.obj.rotation.y += d.spin.y * dt; d.obj.rotation.z += d.spin.z * dt;
      const gy = level.terrain.heightAt(d.obj.position.x, d.obj.position.z) + d.lift;
      if (d.obj.position.y < gy) {
        d.obj.position.y = gy;
        if (Math.abs(d.vel.y) < 3) { d.rest = true; d.obj.rotation.x *= 0.25; d.obj.rotation.z *= 0.25; }
        else { d.vel.multiplyScalar(0.35); d.vel.y = Math.abs(d.vel.y) * 0.8; d.spin.multiplyScalar(0.5); }
        if (d.obj.scale.x > 0.3 || !d.own) smoke.spawn({ pos: [d.obj.position.x, gy, d.obj.position.z], vel: [0, 0.6, 0], size: 1, grow: 2, life: 1.6, drag: 2, color: [0.3, 0.26, 0.2], alpha: 0.45 });
      }
    }
    for (const p of pools) {
      const u = p.userData;
      if (u.t < 1) { u.t = Math.min(1, u.t + dt / (u.grow ?? 10)); p.scale.setScalar(u.target * Math.sqrt(u.t)); }
    }
  }

  function remove(id, v) {
    scene.remove(v.root);
    for (const o of v.owned ?? []) o.dispose();
    live.delete(id);
  }
  function clear() {
    for (const [id, v] of live) remove(id, v);
    for (const d of debris) scene.remove(d.obj);
    debris.length = 0;
    for (const p of pools) scene.remove(p);
    pools.length = 0;
    blasts.length = 0;
    alerted.clear();
    fireLights.forEach((l) => { l.intensity = 0; });
  }

  return {
    update,
    dispose() {
      clear();
      fireLights.forEach((l) => scene.remove(l));
      soldiers.dispose();
      disposables.forEach((d) => d.dispose());
    },
  };
}
