// Enemy troops and vehicles, drawn from `state.entities`. Models are built from primitives at
// start-up: infantry in winter field kit, a canvas-backed army truck, an eight-wheeled APC and a
// main battle tank. Damage shows as smoke, destroyed vehicles turn into burnt, smouldering wrecks.
// Entity position is the base centre on the ground; forward is -Z (see ARCHITECTURE.md).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, hashString } from './rng.js';
import { canvasTexture } from './textures.js';

// Camouflage: olive base with dark green and brown blotches, used on vehicles and uniforms.
function makeCamoTexture(seed, base, blots) {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d'), rand = mulberry32(seed);
  g.fillStyle = base; g.fillRect(0, 0, S, S);
  for (const col of blots) {
    g.fillStyle = col;
    for (let i = 0; i < 9; i++) {
      const x = rand() * S, y = rand() * S, r = 14 + rand() * 30;
      g.beginPath();
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2, rr = r * (0.6 + rand() * 0.6);
        for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) g.lineTo(x + ox + Math.cos(a) * rr * 1.5, y + oy + Math.sin(a) * rr);
      }
      g.fill();
    }
  }
  // Dust and grime.
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = `rgba(${rand() < 0.5 ? '40,34,26' : '150,140,115'},${rand() * 0.12})`;
    g.fillRect(rand() * S, rand() * S, 1 + rand() * 2, 1 + rand() * 2);
  }
  return canvasTexture(c, { repeat: true });
}

// Collects primitives per material slot and merges them into one geometry per slot.
class Kit {
  constructor() { this.parts = {}; }
  add(slot, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    geo.rotateX(rx); geo.rotateY(ry); geo.rotateZ(rz);
    geo.translate(x, y, z);
    if (geo.index) geo = geo.toNonIndexed();
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    (this.parts[slot] ??= []).push(geo);
    return this;
  }
  box(slot, w, h, d, x, y, z, rx, ry, rz) { return this.add(slot, new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz); }
  cyl(slot, r0, r1, h, x, y, z, rx, ry, rz, seg = 12) { return this.add(slot, new THREE.CylinderGeometry(r0, r1, h, seg), x, y, z, rx, ry, rz); }
  build(mats) {
    const g = new THREE.Group();
    for (const [slot, list] of Object.entries(this.parts)) {
      const m = new THREE.Mesh(mergeGeometries(list), mats[slot]);
      m.castShadow = true; m.receiveShadow = true;
      m.userData.slot = slot;
      g.add(m);
      list.forEach((x) => x.dispose());
    }
    return g;
  }
}

const HALF_PI = Math.PI / 2;

// ---- Vehicles -------------------------------------------------------------------------------

function wheel(kit, x, y, z, r, w) {
  kit.cyl('tyre', r, r, w, x, y, z, 0, 0, HALF_PI, 14);
  kit.cyl('metal', r * 0.55, r * 0.55, w + 0.02, x, y, z, 0, 0, HALF_PI, 10);
}

function buildTruck() {
  const body = new Kit(), wheels = [];
  // Chassis rails, cab with bonnet, canvas-covered bed.
  body.box('dark', 0.9, 0.25, 7.0, 0, 0.95, 0.2);
  body.box('paint', 2.4, 1.0, 1.7, 0, 1.55, -2.65);   // bonnet
  body.box('paint', 2.4, 1.5, 1.7, 0, 2.15, -1.2);    // cab
  body.box('glass', 2.2, 0.62, 0.05, 0, 2.5, -2.06);  // windscreen
  body.box('glass', 0.05, 0.5, 0.8, 1.21, 2.5, -1.25);
  body.box('glass', 0.05, 0.5, 0.8, -1.21, 2.5, -1.25);
  body.box('dark', 2.3, 0.35, 0.1, 0, 1.25, -3.52);   // grille
  body.box('paint', 2.5, 0.12, 0.7, 0, 1.75, -2.6);   // wings
  body.box('paint', 2.5, 0.5, 4.4, 0, 1.4, 1.6);      // bed floor + sides
  body.box('canvas', 2.5, 1.7, 4.3, 0, 2.5, 1.6);     // tarp
  body.cyl('canvas', 1.25, 1.25, 4.3, 0, 3.3, 1.6, HALF_PI, 0, 0, 14);
  body.box('dark', 0.5, 0.5, 0.8, 1.3, 1.2, -0.6);    // fuel tank
  body.box('dark', 2.4, 0.15, 0.2, 0, 0.8, -3.55);    // bumper
  for (const z of [-2.55, 0.9, 2.45]) for (const s of [-1, 1]) wheels.push([s * 1.05, 0.55, z, 0.55, 0.4]);
  return { body, wheels, size: [2.5, 3.6, 7.2], turret: null, engine: [0, 1.6, -2.6] };
}

function buildApc() {
  const body = new Kit(), wheels = [];
  // Boat-shaped hull with sloped glacis, small one-man turret.
  body.box('paint', 2.9, 1.1, 6.4, 0, 1.45, 0.1);
  body.box('paint', 2.6, 0.6, 1.4, 0, 1.25, -3.6, -0.55);         // lower glacis
  body.box('paint', 2.5, 0.45, 5.6, 0, 2.15, 0.4);                // upper deck
  body.box('paint', 2.8, 0.7, 1.1, 0, 1.95, -2.75, 0.5);          // upper glacis
  body.box('dark', 3.0, 0.08, 6.0, 0, 1.0, 0.2);                  // skirt line
  body.box('dark', 1.0, 0.25, 0.7, 0.6, 2.5, 2.2);                // hatches
  body.box('dark', 1.0, 0.25, 0.7, -0.6, 2.5, 2.2);
  body.box('dark', 0.3, 0.3, 0.3, 1.2, 2.25, -2.0);               // vision blocks
  body.box('dark', 0.3, 0.3, 0.3, -1.2, 2.25, -2.0);
  for (const z of [-2.4, -1.05, 0.95, 2.3]) for (const s of [-1, 1]) wheels.push([s * 1.35, 0.6, z, 0.6, 0.45]);
  const turret = new Kit();
  turret.cyl('paint', 0.7, 0.85, 0.65, 0, 0.33, 0, 0, 0, 0, 14);
  turret.cyl('metal', 0.07, 0.07, 2.0, 0, 0.4, -1.2, HALF_PI, 0, 0, 8);
  turret.cyl('metal', 0.05, 0.05, 1.0, 0.28, 0.4, -0.7, HALF_PI, 0, 0, 6);
  return { body, wheels, size: [3, 2.9, 7.5], turret: { kit: turret, pos: [0, 2.35, -0.6] }, engine: [0, 2.3, 2.4] };
}

function buildTank() {
  const body = new Kit(), wheels = [];
  // Low hull, tracks with road wheels and side skirts, explosive reactive armour bricks, round turret.
  body.box('paint', 3.3, 0.9, 6.6, 0, 1.15, 0);
  body.box('paint', 3.3, 0.5, 1.2, 0, 1.25, -3.6, 0.6);         // glacis
  body.box('track', 0.62, 0.95, 6.4, 1.55, 0.55, 0.0);
  body.box('track', 0.62, 0.95, 6.4, -1.55, 0.55, 0.0);
  body.box('paint', 0.08, 0.55, 5.0, 1.88, 0.95, -0.4);         // skirts
  body.box('paint', 0.08, 0.55, 5.0, -1.88, 0.95, -0.4);
  for (let i = 0; i < 6; i++) for (const s of [-1, 1]) {
    body.cyl('tyre', 0.38, 0.38, 0.5, s * 1.55, 0.42, -2.4 + i * 0.95, 0, 0, HALF_PI, 12);
    body.cyl('metal', 0.18, 0.18, 0.54, s * 1.55, 0.42, -2.4 + i * 0.95, 0, 0, HALF_PI, 8);
  }
  for (let i = 0; i < 8; i++) for (const s of [-1, 1]) body.box('era', 0.32, 0.12, 0.42, s * (0.45 + (i % 4) * 0.36), 1.62 + (i < 4 ? 0 : 0.0), -3.25 + (i < 4 ? 0 : 0.45), 0.6);
  body.cyl('dark', 0.3, 0.3, 1.4, 1.2, 1.75, 3.1, 0, 0, HALF_PI, 10);   // fuel drums
  body.cyl('dark', 0.3, 0.3, 1.4, -1.2, 1.75, 3.1, 0, 0, HALF_PI, 10);
  body.box('dark', 2.4, 0.15, 1.6, 0, 1.68, 2.4);                       // engine deck grilles
  const turret = new Kit();
  turret.cyl('paint', 1.35, 1.6, 0.75, 0, 0.38, 0.1, 0, 0, 0, 18);
  turret.add('paint', new THREE.SphereGeometry(1.35, 18, 8, 0, Math.PI * 2, 0, HALF_PI), 0, 0.72, 0.1);
  turret.add('paint', new THREE.BoxGeometry(1, 1, 1).scale(2.6, 0.01, 1).translate(0, 0, 0), 0, 0.72, 0);
  for (let i = 0; i < 7; i++) for (const s of [-1, 1]) {
    const a = s * (0.35 + i * 0.13);
    turret.box('era', 0.45, 0.25, 0.32, Math.sin(a) * 1.45, 0.75, -Math.cos(a) * 1.45 + 0.1, 0.3, a, 0);
  }
  turret.cyl('metal', 0.1, 0.12, 5.6, 0, 0.62, -3.6, HALF_PI, 0, 0, 10);  // gun
  turret.cyl('dark', 0.17, 0.17, 1.0, 0, 0.62, -2.0, HALF_PI, 0, 0, 10);  // thermal sleeve
  turret.box('dark', 0.45, 0.35, 0.5, 0.75, 1.4, 0.2);                     // commander's cupola
  turret.cyl('metal', 0.04, 0.04, 1.2, 0.75, 1.75, -0.2, HALF_PI, 0, 0, 6); // MG
  turret.box('dark', 0.9, 0.35, 0.5, -0.55, 1.35, 0.7);                    // stowage
  return { body, wheels, size: [3.6, 2.4, 7], turret: { kit: turret, pos: [0, 1.6, 0.3] }, engine: [0, 1.8, 2.6] };
}

// ---- Infantry -------------------------------------------------------------------------------

function buildSoldierParts() {
  // Returns limb geometries (pivot at the joint) so the walk cycle can swing them.
  const kits = { torso: new Kit(), head: new Kit(), legL: new Kit(), legR: new Kit(), armL: new Kit(), armR: new Kit(), rifle: new Kit() };
  kits.torso.box('uniform', 0.42, 0.55, 0.24, 0, 0.27, 0);
  kits.torso.box('vest', 0.46, 0.4, 0.3, 0, 0.32, 0);
  kits.torso.box('vest', 0.36, 0.3, 0.14, 0, 0.3, 0.2);          // backpack
  kits.torso.box('uniform', 0.4, 0.14, 0.22, 0, -0.04, 0);        // hips
  kits.head.add('skin', new THREE.SphereGeometry(0.11, 10, 8), 0, 0.12, 0);
  kits.head.add('helmet', new THREE.SphereGeometry(0.135, 12, 8, 0, Math.PI * 2, 0, HALF_PI * 1.05), 0, 0.15, 0.01);
  for (const k of ['legL', 'legR']) {
    kits[k].box('uniform', 0.16, 0.46, 0.18, 0, -0.23, 0);
    kits[k].box('uniform', 0.14, 0.42, 0.16, 0, -0.66, 0.02);
    kits[k].box('boot', 0.15, 0.12, 0.27, 0, -0.9, -0.04);
  }
  for (const k of ['armL', 'armR']) {
    kits[k].box('uniform', 0.12, 0.32, 0.13, 0, -0.16, 0);
    kits[k].box('uniform', 0.11, 0.3, 0.12, 0, -0.44, -0.06, 0.5);
    kits[k].add('skin', new THREE.SphereGeometry(0.05, 6, 5), 0, -0.6, -0.14);
  }
  kits.rifle.box('gun', 0.05, 0.08, 0.75, 0, 0, -0.2);
  kits.rifle.box('gun', 0.04, 0.18, 0.06, 0, -0.1, -0.12, 0.3);   // magazine
  kits.rifle.box('wood', 0.05, 0.1, 0.25, 0, -0.02, 0.25);         // stock
  return kits;
}

// ---- Main module ----------------------------------------------------------------------------

export function createEntities({ scene, level, smoke, fire }) {
  const disposables = [];
  const keep = (x) => { disposables.push(x); return x; };
  const std = (o) => keep(new THREE.MeshStandardMaterial({ roughness: 0.8, ...o }));
  const camoV = keep(makeCamoTexture(5, '#4d5536', ['#2f3a23', '#5d5236', '#26281e']));
  camoV.repeat.set(0.35, 0.35);
  const camoU = keep(makeCamoTexture(9, '#6b6a4c', ['#4a4c33', '#7d7558', '#3b3a2b']));
  camoU.repeat.set(3, 3);

  const vehicleMats = {
    paint: std({ map: camoV, roughness: 0.75, metalness: 0.15 }),
    dark: std({ color: 0x23251f, roughness: 0.7, metalness: 0.3 }),
    metal: std({ color: 0x2f312c, roughness: 0.45, metalness: 0.7 }),
    tyre: std({ color: 0x1a1a19, roughness: 0.95 }),
    track: std({ color: 0x26241f, roughness: 0.9, metalness: 0.4 }),
    canvas: std({ color: 0x5a5a3f, roughness: 1 }),
    glass: std({ color: 0x1b2328, roughness: 0.1, metalness: 0.5 }),
    era: std({ map: camoV, color: 0xb9bda8, roughness: 0.8, metalness: 0.1 }),
  };
  // A wreck is soot-black with rust showing through, whatever it was painted.
  const burnt = std({ color: 0x1c1915, roughness: 1, metalness: 0.2 });
  const rust = std({ color: 0x4a2c1c, roughness: 1, metalness: 0.1 });
  const wreckMats = Object.fromEntries(Object.keys(vehicleMats).map((k) => [k, k === 'paint' || k === 'era' ? rust : burnt]));
  const soldierMats = {
    uniform: std({ map: camoU, roughness: 0.95 }),
    vest: std({ color: 0x3f4230, roughness: 0.9 }),
    helmet: std({ color: 0x3c4230, roughness: 0.7 }),
    skin: std({ color: 0xb08a72, roughness: 0.8 }),
    boot: std({ color: 0x1d1a16, roughness: 0.8 }),
    gun: std({ color: 0x1b1b1b, roughness: 0.5, metalness: 0.6 }),
    wood: std({ color: 0x4a3322, roughness: 0.8 }),
  };
  const deadSoldier = std({ color: 0x2c2a22, roughness: 1 });

  // Build each vehicle template once; instances clone the group (geometry is shared).
  const templates = {};
  for (const [kind, make] of [['truck', buildTruck], ['apc', buildApc], ['tank', buildTank]]) {
    const t = make();
    const wheelGroups = t.wheels.map(([x, y, z, r, w]) => { const k = new Kit(); wheel(k, 0, 0, 0, r, w); const gr = k.build(vehicleMats); gr.position.set(x, y, z); gr.userData.r = r; return gr; });
    const root = new THREE.Group();
    root.add(t.body.build(vehicleMats));
    wheelGroups.forEach((w) => root.add(w));
    let turret = null;
    if (t.turret) { turret = t.turret.kit.build(vehicleMats); turret.position.fromArray(t.turret.pos); turret.name = 'turret'; root.add(turret); }
    root.traverse((o) => { if (o.isMesh) disposables.push(o.geometry); });
    templates[kind] = { root, engine: t.engine, size: t.size, hasWheels: t.wheels.length > 0 };
  }
  const soldierKits = buildSoldierParts();
  const soldierGeo = {};
  for (const [k, kit] of Object.entries(soldierKits)) { soldierGeo[k] = kit.build(soldierMats); soldierGeo[k].traverse((o) => { if (o.isMesh) disposables.push(o.geometry); }); }

  function makeSoldier(seed) {
    const rand = mulberry32(seed);
    const root = new THREE.Group();
    const body = new THREE.Group(); // pivots at the hips
    body.position.y = 0.95;
    root.add(body);
    const part = (k, x, y, z, parent = body) => { const p = soldierGeo[k].clone(); p.position.set(x, y, z); parent.add(p); return p; };
    const torso = part('torso', 0, 0.06, 0);
    const head = part('head', 0, 0.62, 0, torso);
    const legL = part('legL', -0.1, 0, 0), legR = part('legR', 0.1, 0, 0);
    const armL = part('armL', -0.27, 0.52, 0, torso), armR = part('armR', 0.27, 0.52, 0, torso);
    const rifle = part('rifle', 0.08, 0.3, -0.25, torso);
    rifle.rotation.set(-0.15, 0.5, 0.25);
    armL.rotation.x = -0.8; armR.rotation.x = -0.6;
    const s = 0.94 + rand() * 0.12;
    root.scale.setScalar(s);
    return { root, body, torso, head, legL, legR, armL, armR, phase: rand() * 6.28, lean: 0 };
  }

  const live = new Map();
  const tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3();

  function create(e) {
    const rand = mulberry32(hashString(e.id));
    if (e.kind === 'infantry') {
      const s = makeSoldier(hashString(e.id));
      scene.add(s.root);
      return { kind: e.kind, s, root: s.root, dead: false, smokeAcc: 0, burn: 0 };
    }
    const tpl = templates[e.kind] ?? templates.truck;
    const root = tpl.root.clone(true);
    // Each vehicle gets slightly different grime by nudging its paint colour.
    const k = 0.85 + rand() * 0.25;
    const paint = vehicleMats.paint.clone(); paint.color.setRGB(k, k * (0.97 + rand() * 0.06), k * 0.95);
    keep(paint);
    root.traverse((o) => { if (o.isMesh && o.userData.slot === 'paint') o.material = paint; });
    scene.add(root);
    const wheels = root.children.filter((c) => c.userData.r);
    return { kind: e.kind, root, tpl, wheels, turret: root.getObjectByName('turret'), dead: false, roll: 0, smokeAcc: 0, burn: 0, turretFly: null };
  }

  function killVehicle(v) {
    v.dead = true;
    v.burn = v.kind === 'tank' ? 90 : 60;
    v.root.traverse((o) => { if (o.isMesh) o.material = wreckMats[o.userData.slot] ?? burnt; });
  }

  function tossTurret(v) {
    if (!v.turret || v.turretFly) return;
    {
      // Ammunition cook-off throws the turret clear of the hull.
      const wp = v.turret.getWorldPosition(new THREE.Vector3());
      const wq = v.turret.getWorldQuaternion(new THREE.Quaternion());
      v.root.remove(v.turret); scene.add(v.turret);
      v.turret.position.copy(wp); v.turret.quaternion.copy(wq);
      const a = Math.random() * Math.PI * 2;
      v.turretFly = { vel: new THREE.Vector3(Math.cos(a) * 3, 13 + Math.random() * 5, Math.sin(a) * 3), spin: new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 3), rest: false };
    }
  }

  function hit(ev) {
    const p = ev.position;
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, el = Math.random() * 1.2, sp = 6 + Math.random() * 14;
      fire.spawn({ pos: p, vel: [Math.cos(a) * Math.cos(el) * sp, Math.sin(el) * sp, Math.sin(a) * Math.cos(el) * sp], size: 0.1, grow: 0, life: 0.25 + Math.random() * 0.4, drag: 1, gravity: 9.8, color: [3, 2, 0.9], colorEnd: [1, 0.3, 0.05], alpha: 1, fadeIn: 100 });
    }
    for (let i = 0; i < 5; i++) smoke.spawn({ pos: p, vel: [(Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3], size: 0.8, grow: 2.5, life: 1.8, drag: 2, color: [0.2, 0.19, 0.17], alpha: 0.5, wind: 0.6 });
  }

  function update(state, events, dt) {
    for (const ev of events) {
      if (ev.type === 'hit') hit(ev);
      else if (ev.type === 'entity_destroyed') {
        const v = live.get(ev.entityId);
        if (v && !v.dead && v.kind !== 'infantry') killVehicle(v);
      } else if (ev.type === 'explosion' && ev.kind === 'ammo') {
        // The sim's delayed secondary blast; a tank caught in it loses its turret.
        for (const v of live.values()) if (v.kind === 'tank' && v.root.position.distanceTo(tmpV.fromArray(ev.position)) < 6) tossTurret(v);
      } else if (ev.type === 'reset' && state.entities.length === 0) clear();
    }

    const seen = new Set();
    for (const e of state.entities ?? []) {
      seen.add(e.id);
      let v = live.get(e.id);
      if (!v) { v = create(e); live.set(e.id, v); if (e.status === 'destroyed' && v.kind !== 'infantry') killVehicle(v); }
      const speed = Math.hypot(e.velocity?.[0] ?? 0, e.velocity?.[2] ?? 0);

      if (v.kind === 'infantry') {
        const s = v.s;
        if (!v.turretFly) { s.root.position.fromArray(e.position); s.root.quaternion.fromArray(e.quaternion); }
        const dead = e.status === 'destroyed';
        const prone = e.status === 'prone' || dead;
        const target = prone ? 1 : 0;
        s.lean += (target - s.lean) * Math.min(1, dt * (dead ? 6 : 3));
        s.body.rotation.x = -s.lean * HALF_PI * (dead ? 1.0 : 0.97);
        s.body.position.y = 0.95 - s.lean * 0.78;
        s.body.rotation.z = dead ? 0.4 : 0;
        const pace = Math.min(1, speed / 1.6) * (prone ? 0.2 : 1);
        s.phase += dt * (3 + speed * 2.4);
        const sw = Math.sin(s.phase) * 0.7 * pace;
        s.legL.rotation.x = dead ? 0.2 : sw;
        s.legR.rotation.x = dead ? -0.3 : -sw;
        s.torso.rotation.x = e.status === 'fleeing' ? -0.25 : -0.05 * pace;
        s.armL.rotation.x = dead ? 0.6 : -0.8 - sw * 0.2;
        if (dead && !v.dead) {
          v.dead = true;
          s.root.traverse((o) => { if (o.isMesh && o.material !== soldierMats.skin) o.material = deadSoldier; });
        }
        continue;
      }

      v.root.position.fromArray(e.position);
      v.root.quaternion.fromArray(e.quaternion);
      if (e.status === 'destroyed' && !v.dead) killVehicle(v);
      if (e.size) v.root.scale.set(e.size[0] / v.tpl.size[0], e.size[1] / v.tpl.size[1], e.size[2] / v.tpl.size[2]);
      if (!v.dead) {
        v.roll += speed * dt;
        for (const w of v.wheels) w.rotation.x = -v.roll / w.userData.r;
        if (v.turret && e.turretYaw !== undefined) v.turret.rotation.y = e.turretYaw;
      }
      // Damage smoke from the engine bay, thicker as health drops; wrecks burn, then smoulder.
      const hurt = v.dead ? 1 : e.damage ? { none: 0, light: 0.35, heavy: 1 }[e.damage] ?? 0 : THREE.MathUtils.clamp((0.6 - (e.health ?? 1)) / 0.6, 0, 1);
      if (hurt > 0) {
        tmpV.fromArray(v.tpl.engine).applyQuaternion(tmpQ.fromArray(e.quaternion)).add(v.root.position);
        if (v.dead) v.burn = Math.max(0, v.burn - dt);
        const burning = e.onFire ?? (v.dead && v.burn > 0);
        v.smokeAcc += dt * (burning ? 14 : v.dead ? 2.5 : 2 + 8 * hurt);
        while (v.smokeAcc > 1) {
          v.smokeAcc -= 1;
          const g = burning ? 0.05 + Math.random() * 0.05 : 0.18 + Math.random() * 0.1;
          smoke.spawn({ pos: [tmpV.x, tmpV.y, tmpV.z], vel: [(Math.random() - 0.5) * 0.6, 2 + Math.random() * 2, (Math.random() - 0.5) * 0.6], size: burning ? 1.6 : 0.9, grow: 3.5, life: burning ? 7 : 4.5, drag: 0.4, gravity: -0.3, wind: 1, color: [g, g, g], alpha: burning ? 0.65 : 0.35 + 0.3 * hurt, fadeIn: 8 });
          if (burning && Math.random() < 0.7) {
            fire.spawn({ pos: [tmpV.x + (Math.random() - 0.5), tmpV.y, tmpV.z + (Math.random() - 0.5)], vel: [0, 1.5 + Math.random() * 2, 0], size: 0.8 + Math.random() * 0.8, grow: 0.4, life: 0.5 + Math.random() * 0.5, drag: 1, color: [2.2, 1.1, 0.35], colorEnd: [0.6, 0.12, 0.02], alpha: 0.8, fadeIn: 20 });
          }
        }
      }
      if (v.turretFly && !v.turretFly.rest) {
        const f = v.turretFly, t = v.turret;
        f.vel.y -= 9.8 * dt;
        t.position.addScaledVector(f.vel, dt);
        t.rotation.x += f.spin.x * dt; t.rotation.y += f.spin.y * dt; t.rotation.z += f.spin.z * dt;
        const gy = level.terrain.heightAt(t.position.x, t.position.z) + 0.6;
        if (t.position.y < gy) { t.position.y = gy; f.rest = true; t.rotation.x *= 0.3; t.rotation.z = Math.sign(t.rotation.z || 1) * 0.35; }
      }
    }
    for (const [id, v] of live) if (!seen.has(id)) remove(id, v);
  }

  function remove(id, v) {
    scene.remove(v.root);
    if (v.turretFly) scene.remove(v.turret);
    live.delete(id);
  }
  function clear() { for (const [id, v] of live) remove(id, v); }

  return {
    update,
    dispose() { clear(); disposables.forEach((d) => d.dispose()); },
  };
}
