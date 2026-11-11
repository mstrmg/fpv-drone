// Enemy troops and vehicles, drawn from `state.entities`. Vehicle models live in vehicleModels.js.
// Damage shows as smoke from the engine bay. A destroyed vehicle turns into a soot-black wreck:
// tyres burn away so it settles onto its rims, the tarp burns off, loose parts are thrown, and a
// cook-off throws a tank's turret. Killed soldiers are thrown by nearby blasts and fall in varied
// poses, dropping their rifles, with a little blood on the ground.
// Entity position is the base centre on the ground; forward is -Z (see ARCHITECTURE.md).
import * as THREE from 'three';
import { mulberry32, hashString } from './rng.js';
import { canvasTexture } from './textures.js';
import { Kit, HALF_PI, buildTank, buildApc, buildTruck, buildWheel } from './vehicleModels.js';

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
    const x = rand() * S, y = rand() * S;
    g.ellipse(x, y, 10 + rand() * 40, 6 + rand() * 25, rand() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  for (let i = 0; i < 3500; i++) {
    g.fillStyle = `rgba(${rand() < 0.6 ? '45,38,28' : '170,160,130'},${rand() * 0.14})`;
    g.fillRect(rand() * S, rand() * S, 1 + rand() * 3, 1 + rand() * 2);
  }
  for (let i = 0; i < 30; i++) { // bare-metal scratches
    g.strokeStyle = `rgba(110,105,95,${0.2 + rand() * 0.3})`;
    g.lineWidth = 1;
    const x = rand() * S, y = rand() * S;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rand() - 0.5) * 30, y + (rand() - 0.5) * 8); g.stroke();
  }
  return canvasTexture(c, { repeat: true });
}

// The white invasion "Z" painted by hand on hull sides.
function makeZTexture() {
  const S = 128, [c, g] = canvas(S);
  g.strokeStyle = 'rgba(232,232,224,0.95)';
  g.lineWidth = 17; g.lineJoin = 'round'; g.lineCap = 'round';
  g.beginPath(); g.moveTo(26, 30); g.lineTo(102, 30); g.lineTo(28, 98); g.lineTo(104, 98); g.stroke();
  // Weather it: knock holes in the paint.
  const rand = mulberry32(3);
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(0,0,0,${rand()})`; g.fillRect(rand() * S, rand() * S, 2 + rand() * 4, 1 + rand() * 3); }
  return canvasTexture(c);
}

// Welded steel mesh for the cope cage roof.
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

// A dark, uneven stain soaking into soil.
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

// ---- Infantry ---------------------------------------------------------------------------------

function buildSoldierParts() {
  // Limb geometries have their pivot at the joint so they can swing.
  const k = { torso: new Kit(), head: new Kit(), legL: new Kit(), legR: new Kit(), armL: new Kit(), armR: new Kit(), rifle: new Kit() };
  k.torso.box('uniform', 0.42, 0.55, 0.24, 0, 0.27, 0);
  k.torso.box('vest', 0.46, 0.42, 0.3, 0, 0.32, 0);
  for (let i = 0; i < 3; i++) k.torso.box('vest', 0.1, 0.13, 0.06, -0.13 + i * 0.13, 0.25, -0.17); // magazine pouches
  k.torso.box('vest', 0.36, 0.34, 0.16, 0, 0.3, 0.21);                                            // pack
  k.torso.box('uniform', 0.4, 0.14, 0.22, 0, -0.04, 0);
  k.head.add('skin', new THREE.SphereGeometry(0.11, 10, 8), 0, 0.12, 0);
  k.head.add('helmet', new THREE.SphereGeometry(0.14, 12, 8, 0, Math.PI * 2, 0, HALF_PI * 1.05), 0, 0.15, 0.01);
  k.head.add('helmet', new THREE.CylinderGeometry(0.15, 0.15, 0.03, 12), 0, 0.15, 0.01);
  for (const n of ['legL', 'legR']) {
    k[n].box('uniform', 0.16, 0.46, 0.18, 0, -0.23, 0);
    k[n].box('uniform', 0.17, 0.12, 0.2, 0, -0.45, -0.02); // knee pad
    k[n].box('uniform', 0.14, 0.42, 0.16, 0, -0.66, 0.02);
    k[n].box('boot', 0.15, 0.13, 0.28, 0, -0.9, -0.04);
  }
  for (const n of ['armL', 'armR']) {
    k[n].box('uniform', 0.12, 0.32, 0.13, 0, -0.16, 0);
    k[n].box('uniform', 0.11, 0.3, 0.12, 0, -0.44, -0.06, 0.5);
    k[n].add('glove', new THREE.SphereGeometry(0.05, 6, 5), 0, -0.6, -0.14);
  }
  k.rifle.box('gun', 0.05, 0.08, 0.72, 0, 0, -0.2);
  k.rifle.box('gun', 0.04, 0.2, 0.07, 0, -0.11, -0.12, 0.35);        // curved magazine
  k.rifle.box('gun', 0.05, 0.08, 0.26, 0, -0.01, 0.27);               // folding stock
  k.rifle.cyl('gun', 0.012, 0.012, 0.3, 0, 0.02, -0.68, HALF_PI, 0, 0, 6);
  return k;
}

// Landing poses for a killed soldier: body roll/pitch and limb angles. Positive leg/arm x swings forward.
const DEATH_POSES = [
  { body: [-1.5, 0, 0.05], y: 0.15, legL: [0.15, 0, -0.3], legR: [-0.35, 0, 0.35], armL: [-2.7, 0, -0.3], armR: [0.4, 0, 0.6] },   // face down, sprawled
  { body: [1.52, 0, -0.1], y: 0.16, legL: [0.45, 0, -0.25], legR: [0.05, 0, 0.2], armL: [-0.3, 0, -1.3], armR: [-1.2, 0, 1.1] },    // on back, arms out
  { body: [-0.2, 0, 1.5], y: 0.16, legL: [1.1, 0, 0], legR: [0.8, 0, 0.1], armL: [1.3, 0, 0], armR: [0.9, 0, -0.2] },               // curled on side
  { body: [-1.05, 0, 0.2], y: 0.38, legL: [1.45, 0, -0.2], legR: [1.2, 0, 0.25], armL: [0.2, 0, -0.2], armR: [0.6, 0, 0.3] },       // collapsed sitting forward
  { body: [-1.5, 0.6, -0.2], y: 0.15, legL: [-0.6, 0, -0.1], legR: [0.5, 0, 0.3], armL: [0.2, 0, -0.5], armR: [-2.2, 0, 0.6] },     // face down, twisted
];

// ---- Main module ------------------------------------------------------------------------------

export function createEntities({ scene, level, smoke, fire }) {
  const disposables = [];
  const keep = (x) => { disposables.push(x); return x; };
  const std = (o) => keep(new THREE.MeshStandardMaterial({ roughness: 0.8, ...o }));
  const greenTex = keep(makePaintTexture(5, '#4a5233', ['#3f4729', '#535b39', '#454a30']));
  greenTex.repeat.set(0.4, 0.4);
  const uniformTex = keep(makePaintTexture(9, '#5f6346', ['#4d5138', '#6e6a4f', '#3f4231']));
  uniformTex.repeat.set(3, 3);
  const zTex = keep(makeZTexture()), netTex = keep(makeNetTexture()), bloodTex = keep(makeBloodTexture());

  const vehicleMats = {
    paint: weather(std({ map: greenTex, roughness: 0.78, metalness: 0.12 })),
    era: weather(std({ map: greenTex, color: 0xc8ccb8, roughness: 0.8, metalness: 0.1 })),
    dark: weather(std({ color: 0x2a2c24, roughness: 0.7, metalness: 0.3 }), 0.7),
    steel: weather(std({ color: 0x3a3a36, roughness: 0.5, metalness: 0.75 }), 0.8),
    tyre: weather(std({ color: 0x1b1b1a, roughness: 0.95 }), 0.9),
    track: std({ color: 0x2b2824, roughness: 0.85, metalness: 0.55 }),
    rubber: weather(std({ color: 0x1c1d1a, roughness: 0.95 })),
    glass: std({ color: 0x1b2328, roughness: 0.1, metalness: 0.5 }),
    wood: std({ color: 0x5a4632, roughness: 0.95 }),
    canvas: weather(std({ color: 0x55573d, roughness: 1 }), 0.6),
    net: std({ map: netTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.5 }),
    mark: std({ map: zTex, transparent: true, alphaTest: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: 0.9 }),
  };
  // A wreck is soot-black with rust and scorched paint showing through.
  const burnt = std({ color: 0x1a1714, roughness: 1, metalness: 0.15 });
  const rust = std({ color: 0x35251b, roughness: 1, metalness: 0.1 });
  const ash = std({ color: 0x2f2a25, roughness: 1 });
  const wreckOf = { paint: rust, era: burnt, dark: burnt, steel: burnt, tyre: burnt, track: burnt, rubber: burnt, glass: burnt, wood: ash, canvas: ash, net: burnt };
  const soldierMats = {
    uniform: std({ map: uniformTex, roughness: 0.95 }),
    vest: std({ color: 0x40432f, roughness: 0.9 }),
    helmet: std({ color: 0x3d4331, roughness: 0.7 }),
    skin: std({ color: 0xa8826a, roughness: 0.8 }),
    glove: std({ color: 0x2a2a24, roughness: 0.9 }),
    boot: std({ color: 0x1d1a16, roughness: 0.8 }),
    gun: std({ color: 0x1b1b1b, roughness: 0.5, metalness: 0.6 }),
  };
  const bloodMat = std({ map: bloodTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, roughness: 0.35, opacity: 0.8 });
  const bloodGeo = keep(new THREE.PlaneGeometry(1, 1).rotateX(-HALF_PI));

  const track = (group) => group.traverse((o) => { if (o.isMesh) disposables.push(o.geometry); });

  // Build each vehicle template once. Instances clone the group, so geometry and materials are shared.
  const templates = {};
  for (const [kind, make] of [['truck', buildTruck], ['apc', buildApc], ['tank', buildTank]]) {
    const t = make();
    const root = new THREE.Group();
    root.add(t.body.build(vehicleMats));
    const wheelProtos = {};
    for (const [x, y, z, r, w] of t.wheels ?? []) {
      const key = `${r}:${w}`;
      if (!wheelProtos[key]) {
        const { tyre, rim } = buildWheel(r, w);
        const g = new THREE.Group();
        const tm = tyre.build(vehicleMats); tm.name = 'tyre'; g.add(tm);
        g.add(rim.build(vehicleMats));
        wheelProtos[key] = g;
      }
      const wg = wheelProtos[key].clone();
      wg.position.set(x, y, z);
      wg.userData.r = r;
      wg.name = 'wheel';
      root.add(wg);
    }
    for (const [name, p] of Object.entries(t.parts ?? {})) {
      const g = p.kit.build(vehicleMats); g.position.fromArray(p.pos); g.name = name; root.add(g);
    }
    if (t.turret) {
      const tur = t.turret.kit.build(vehicleMats);
      tur.position.fromArray(t.turret.pos); tur.name = 'turret';
      const gun = t.turret.gun.kit.build(vehicleMats); gun.position.fromArray(t.turret.gun.pos); gun.name = 'gun'; tur.add(gun);
      const cage = t.turret.cage.kit.build(vehicleMats); cage.position.fromArray(t.turret.cage.pos); cage.name = 'cage'; tur.add(cage);
      root.add(tur);
    }
    track(root);
    templates[kind] = { root, t };
  }
  const soldierGeo = {};
  for (const [k, kit] of Object.entries(buildSoldierParts())) { soldierGeo[k] = kit.build(soldierMats); track(soldierGeo[k]); }

  function makeSoldier(seed) {
    const rand = mulberry32(seed);
    const root = new THREE.Group();
    const body = new THREE.Group(); // pivots at the hips
    body.position.y = 0.95;
    root.add(body);
    const part = (k, x, y, z, parent = body) => { const p = soldierGeo[k].clone(); p.position.set(x, y, z); parent.add(p); return p; };
    const torso = part('torso', 0, 0.06, 0);
    part('head', 0, 0.62, 0, torso);
    const legL = part('legL', -0.1, 0, 0), legR = part('legR', 0.1, 0, 0);
    const armL = part('armL', -0.27, 0.52, 0, torso), armR = part('armR', 0.27, 0.52, 0, torso);
    const rifle = part('rifle', 0.08, 0.3, -0.25, torso);
    rifle.rotation.set(-0.15, 0.5, 0.25);
    armL.rotation.x = -0.8; armR.rotation.x = -0.6;
    root.scale.setScalar(0.94 + rand() * 0.12);
    return { root, body, torso, legL, legR, armL, armR, rifle, phase: rand() * 6.28, lean: 0 };
  }

  const live = new Map();
  const debris = [];   // thrown parts: { obj, vel, spin, lift, rest }
  const pools = [];    // blood stains
  const blasts = [];   // recent explosions, to throw soldiers away from them
  let clock = 0;
  const tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

  function create(e) {
    if (e.kind === 'infantry') {
      const s = makeSoldier(hashString(e.id));
      scene.add(s.root);
      return { kind: e.kind, s, root: s.root, dead: false, offset: new THREE.Vector3() };
    }
    const tpl = templates[e.kind] ?? templates.truck;
    const root = tpl.root.clone(true);
    scene.add(root);
    return {
      kind: e.kind, root, tpl, wheels: root.children.filter((c) => c.name === 'wheel'),
      turret: root.getObjectByName('turret'), gun: root.getObjectByName('gun'),
      dead: false, roll: 0, smokeAcc: 0, burn: 0, sink: 0, sinkTarget: 0, rand: mulberry32(hashString(e.id) + 77),
    };
  }

  // Detach a part, keeping its world transform, and send it flying.
  function toss(obj, from, speed, lift, spinK = 1) {
    if (!obj || !obj.parent) return;
    scene.attach(obj);
    const d = tmpV.copy(obj.getWorldPosition(tmpV2)).sub(from);
    d.y = 0;
    if (d.lengthSq() < 1e-4) d.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    d.normalize().multiplyScalar(speed * (0.6 + Math.random() * 0.6));
    d.y = lift * (0.7 + Math.random() * 0.6);
    debris.push({
      obj, vel: d.clone(), rest: false,
      spin: new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6).multiplyScalar(spinK),
      lift: new THREE.Box3().setFromObject(obj).getSize(tmpV2).y * 0.3,
    });
  }

  function killVehicle(v) {
    v.dead = true;
    v.burn = v.kind === 'tank' ? 90 : 60;
    v.root.traverse((o) => {
      if (!o.isMesh) return;
      if (o.userData.slot === 'mark') o.visible = false;
      else o.material = wreckOf[o.userData.slot] ?? burnt;
    });
    const t = v.tpl.t;
    // Tyres burn away and the hull settles onto its rims.
    for (const w of v.wheels) { const ty = w.getObjectByName('tyre'); if (ty) ty.visible = false; }
    v.sinkTarget = t.sink ?? 0;
    for (const n of t.burnAway ?? []) { const p = v.root.getObjectByName(n); if (p) p.visible = false; }
    const at = v.root.position;
    for (const n of t.tossOnDeath ?? []) if (v.rand() < 0.65) toss(v.root.getObjectByName(n), at, 4, 6);
    if (v.rand() < 0.5) toss(v.root.getObjectByName('cage'), at, 3, 7);
    if (v.gun) v.gun.rotation.x = -0.06 - v.rand() * 0.1; // barrel sags
  }

  function cookOff(v) {
    // The ammunition goes up: turret thrown clear, cage and loose kit with it.
    if (!v.turret || v.turret.parent !== v.root) return;
    if (!v.dead) killVehicle(v); // the blast can arrive before the status change
    toss(v.root.getObjectByName('cage'), v.root.position, 6, 12);
    toss(v.turret, v.root.position, 3, 14 + Math.random() * 5, 0.7);
    for (const n of ['drums', 'skirtL', 'skirtR', 'hatch']) toss(v.root.getObjectByName(n), v.root.position, 7, 8);
  }

  function bloodMist(p, n = 4) {
    for (let i = 0; i < n; i++) {
      smoke.spawn({ pos: p, vel: [(Math.random() - 0.5) * 2, 0.5 + Math.random() * 1.2, (Math.random() - 0.5) * 2], size: 0.25 + Math.random() * 0.2, grow: 1.5, life: 0.5 + Math.random() * 0.4, drag: 3, gravity: 2, color: [0.32, 0.03, 0.02], alpha: 0.4, fadeIn: 30 });
    }
  }

  function hit(ev) {
    const p = ev.position;
    const v = live.get(ev.entityId);
    if (v && v.kind === 'infantry') { bloodMist(p, 3); return; }
    // Metal struck: sparks, a bigger, hotter spray for a weak-spot hit.
    const n = ev.weakSpot ? 40 : 18;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, el = Math.random() * 1.2, sp = 6 + Math.random() * 14;
      fire.spawn({ pos: p, vel: [Math.cos(a) * Math.cos(el) * sp, Math.sin(el) * sp, Math.sin(a) * Math.cos(el) * sp], size: 0.1, grow: 0, life: 0.25 + Math.random() * 0.4, drag: 1, gravity: 9.8, color: [3, 2, 0.9], colorEnd: [1, 0.3, 0.05], alpha: 1, fadeIn: 100 });
    }
    for (let i = 0; i < 5; i++) smoke.spawn({ pos: p, vel: [(Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3], size: 0.8, grow: 2.5, life: 1.8, drag: 2, color: [0.2, 0.19, 0.17], alpha: 0.5, wind: 0.6 });
  }

  function killSoldier(v, e) {
    v.dead = true;
    const s = v.s, rand = mulberry32(hashString(e.id) + 13);
    s.pose = DEATH_POSES[Math.floor(rand() * DEATH_POSES.length)];
    s.deathT = 0;
    // Find the blast that did it: close ones throw the body, farther ones just knock it down.
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
    s.fly = push ? { vel: push.vel, spin: push.spin, air: true } : null;
    // Weapon falls away.
    toss(s.rifle, new THREE.Vector3().fromArray(e.position), push ? 4 : 1.2, push ? 4 : 1.5, 1.5);
    bloodMist([e.position[0], e.position[1] + 1.1, e.position[2]], push ? 6 : 3);
  }

  function addPool(x, z, size) {
    const m = new THREE.Mesh(bloodGeo, bloodMat);
    m.position.set(x, level.terrain.heightAt(x, z) + 0.03, z);
    m.rotation.y = Math.random() * Math.PI * 2;
    m.scale.setScalar(0.01);
    m.userData = { target: size, t: 0 };
    scene.add(m);
    pools.push(m);
  }

  function animateSoldier(v, e, dt, speed) {
    const s = v.s;
    if (s.fly && s.fly.air) {
      // Thrown: ballistic arc with a tumble, then a thud.
      const f = s.fly;
      f.vel.y -= 9.8 * dt;
      v.offset.addScaledVector(f.vel, dt);
      s.body.rotation.x += f.spin * dt;
      const gy = level.terrain.heightAt(e.position[0] + v.offset.x, e.position[2] + v.offset.z) - e.position[1];
      if (v.offset.y <= gy) {
        v.offset.y = gy;
        f.air = false;
        s.body.rotation.x = ((s.body.rotation.x + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        smoke.spawn({ pos: [e.position[0] + v.offset.x, e.position[1] + v.offset.y + 0.2, e.position[2] + v.offset.z], vel: [0, 0.5, 0], size: 0.8, grow: 2, life: 1.4, drag: 2, color: [0.3, 0.26, 0.2], alpha: 0.4 });
      }
    }
    s.root.position.fromArray(e.position).add(v.offset);
    if (v.dead) {
      if (s.fly && s.fly.air) return;
      // Settle into the landing pose.
      s.deathT += dt;
      const k = 1 - Math.exp(-dt * (s.fly ? 14 : 5));
      const P = s.pose;
      const set = (obj, r) => { obj.rotation.x += (r[0] - obj.rotation.x) * k; obj.rotation.y += (r[1] - obj.rotation.y) * k; obj.rotation.z += (r[2] - obj.rotation.z) * k; };
      set(s.body, P.body); set(s.legL, P.legL); set(s.legR, P.legR); set(s.armL, P.armL); set(s.armR, P.armR);
      s.body.position.y += (P.y - s.body.position.y) * k;
      s.torso.rotation.x += (0 - s.torso.rotation.x) * k;
      if (!s.pooled && s.deathT > 0.8) {
        s.pooled = true;
        s.torso.getWorldPosition(tmpV);
        addPool(tmpV.x, tmpV.z, 0.5 + Math.random() * 0.4);
      }
      return;
    }
    s.root.quaternion.fromArray(e.quaternion);
    const prone = e.status === 'prone';
    s.lean += ((prone ? 1 : 0) - s.lean) * Math.min(1, dt * 3);
    s.body.rotation.x = -s.lean * HALF_PI * 0.97;
    s.body.position.y = 0.95 - s.lean * 0.78;
    const pace = Math.min(1, speed / 1.6) * (prone ? 0.2 : 1);
    s.phase += dt * (3 + speed * 2.4);
    const sw = Math.sin(s.phase) * 0.7 * pace;
    s.legL.rotation.x = sw;
    s.legR.rotation.x = -sw;
    s.torso.rotation.x = e.status === 'fleeing' ? -0.25 : -0.05 * pace;
    s.armL.rotation.x = -0.8 - sw * 0.2;
  }

  function update(state, events, dt) {
    clock += dt;
    for (const ev of events) {
      if (ev.type === 'hit') hit(ev);
      else if (ev.type === 'explosion') {
        blasts.push({ pos: ev.position, radius: ev.radius, time: clock });
        if (blasts.length > 8) blasts.shift();
        if (ev.kind === 'ammo' || (ev.kind === 'vehicle' && ev.cause === 'cookoff')) {
          for (const v of live.values()) if (v.kind !== 'infantry' && v.root.position.distanceTo(tmpV.fromArray(ev.position)) < 6) {
            if (v.kind === 'tank' && ev.kind === 'ammo') cookOff(v);
            else { if (!v.dead) killVehicle(v); for (const n of ['hatch', 'spare', 'cage', 'drums']) toss(v.root.getObjectByName(n), v.root.position, 6, 9); }
          }
        }
      } else if (ev.type === 'entity_destroyed') {
        const v = live.get(ev.entityId);
        if (v && !v.dead && v.kind !== 'infantry') killVehicle(v);
      } else if (ev.type === 'targets_reset' || (ev.type === 'reset' && (state.entities ?? []).length === 0)) {
        // Every enemy respawns with the same id: drop wrecks and corpses so they are rebuilt intact.
        clear();
        smoke.clear(); fire.clear();
      }
    }

    const seen = new Set();
    for (const e of state.entities ?? []) {
      seen.add(e.id);
      let v = live.get(e.id);
      if (v && v.dead && e.status !== 'destroyed') { remove(e.id, v); v = null; } // came back to life
      if (!v) {
        v = create(e); live.set(e.id, v);
        if (e.status === 'destroyed') {
          if (v.kind === 'infantry') { killSoldier(v, e); v.s.deathT = 9; } else { killVehicle(v); v.sink = v.sinkTarget; }
        }
      }
      const speed = Math.hypot(e.velocity?.[0] ?? 0, e.velocity?.[2] ?? 0);

      if (v.kind === 'infantry') {
        if (e.status === 'destroyed' && !v.dead) killSoldier(v, e);
        animateSoldier(v, e, dt, speed);
        continue;
      }

      if (e.status === 'destroyed' && !v.dead) killVehicle(v);
      v.sink += (v.sinkTarget - v.sink) * Math.min(1, dt * 0.4);
      v.root.position.fromArray(e.position);
      v.root.quaternion.fromArray(e.quaternion);
      v.root.position.addScaledVector(up.set(0, 1, 0).applyQuaternion(v.root.quaternion), -v.sink);
      const sz = v.tpl.t.size;
      if (e.size) v.root.scale.set(e.size[0] / sz[0], e.size[1] / sz[1], e.size[2] / sz[2]);
      if (!v.dead) {
        v.roll += speed * dt;
        for (const w of v.wheels) w.rotation.x = -v.roll / w.userData.r;
        if (v.turret && e.turretYaw !== undefined) v.turret.rotation.y = e.turretYaw;
      }
      // Smoke from the engine bay, thicker as damage grows; wrecks burn, then smoulder.
      const hurt = v.dead ? 1 : e.damage ? ({ none: 0, light: 0.35, heavy: 1 }[e.damage] ?? 0) : THREE.MathUtils.clamp((0.6 - (e.health ?? 1)) / 0.6, 0, 1);
      if (hurt > 0) {
        tmpV.fromArray(v.tpl.t.engine).applyQuaternion(tmpQ.fromArray(e.quaternion)).add(v.root.position);
        if (v.dead) v.burn = Math.max(0, v.burn - dt);
        const burning = e.onFire ?? (v.dead && v.burn > 0);
        v.smokeAcc += dt * (burning ? 16 : v.dead ? 2.5 : 2 + 8 * hurt);
        while (v.smokeAcc > 1) {
          v.smokeAcc -= 1;
          const g = burning ? 0.04 + Math.random() * 0.05 : 0.18 + Math.random() * 0.1;
          const jx = (Math.random() - 0.5) * (burning ? 1.6 : 0.4), jz = (Math.random() - 0.5) * (burning ? 2.5 : 0.4);
          smoke.spawn({ pos: [tmpV.x + jx, tmpV.y, tmpV.z + jz], vel: [(Math.random() - 0.5) * 0.6, 2 + Math.random() * 2.5, (Math.random() - 0.5) * 0.6], size: burning ? 1.8 : 0.9, grow: 3.5, life: burning ? 8 : 4.5, drag: 0.4, gravity: -0.3, wind: 1, color: [g, g, g], alpha: burning ? 0.7 : 0.35 + 0.3 * hurt, fadeIn: 8 });
          if (burning && Math.random() < 0.8) {
            fire.spawn({ pos: [tmpV.x + jx * 0.8, tmpV.y - 0.2, tmpV.z + jz * 0.8], vel: [0, 1.5 + Math.random() * 2.5, 0], size: 0.7 + Math.random() * 1.1, grow: 0.4, life: 0.45 + Math.random() * 0.6, drag: 1, color: [2.4, 1.15, 0.35], colorEnd: [0.6, 0.12, 0.02], alpha: 0.85, fadeIn: 20 });
          }
        }
      }
    }
    for (const [id, v] of live) if (!seen.has(id)) remove(id, v);

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
        smoke.spawn({ pos: [d.obj.position.x, gy, d.obj.position.z], vel: [0, 0.6, 0], size: 1, grow: 2, life: 1.6, drag: 2, color: [0.3, 0.26, 0.2], alpha: 0.45 });
      }
    }
    for (const p of pools) {
      const u = p.userData;
      if (u.t < 1) { u.t = Math.min(1, u.t + dt / 10); p.scale.setScalar(u.target * Math.sqrt(u.t)); }
    }
  }

  function remove(id, v) {
    scene.remove(v.root);
    live.delete(id);
  }
  function clear() {
    for (const [id, v] of live) remove(id, v);
    for (const d of debris) scene.remove(d.obj);
    debris.length = 0;
    for (const p of pools) scene.remove(p);
    pools.length = 0;
    blasts.length = 0;
  }

  return {
    update,
    dispose() { clear(); disposables.forEach((d) => d.dispose()); },
  };
}
