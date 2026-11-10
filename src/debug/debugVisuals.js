// Throwaway placeholder renderer used to develop the sim. Boxes, flat colours,
// a plain-text OSD. Implements the Visuals API from ARCHITECTURE.md.

import * as THREE from 'three';

export function createDebugVisuals({ canvas, uiRoot, level }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xa9bccb);
  scene.fog = new THREE.Fog(0xa9bccb, 150, 900);
  const camera = new THREE.PerspectiveCamera(78, 1, 0.05, 2000);

  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x4a4030, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(200, 300, 100);
  scene.add(sun);

  // Terrain
  const { terrain } = level;
  const geo = new THREE.PlaneGeometry(terrain.size, terrain.size, terrain.segments, terrain.segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cLow = new THREE.Color(0x5d7a3a), cHigh = new THREE.Color(0x8a8350), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    // PlaneGeometry rotated -90° about X lays rows along +Z, matching heights[] row-major order.
    const h = terrain.heights[i];
    pos.setY(i, h);
    const checker = ((Math.floor(pos.getX(i) / 16) + Math.floor(pos.getZ(i) / 16)) & 1) * 0.04;
    c.copy(cLow).lerp(cHigh, Math.min(1, Math.max(0, (h + 10) / 25))).offsetHSL(0, 0, checker);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  scene.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true })));

  // Static objects
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const buildingMat = new THREE.MeshLambertMaterial({ color: 0xb8ad9a });
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5a4330 });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x2f5a2a });
  const ballGeo = new THREE.IcosahedronGeometry(1, 1);
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.3, 1, 6);
  for (const o of level.objects) {
    if (o.kind === 'building') {
      const m = new THREE.Mesh(boxGeo, buildingMat);
      m.scale.set(...o.size);
      m.position.set(o.position[0], o.position[1] + o.size[1] / 2, o.position[2]);
      m.rotation.y = o.rotationY;
      scene.add(m);
    } else if (o.kind === 'tree') {
      const trunkH = o.height * 0.6;
      const t = new THREE.Mesh(trunkGeo, trunkMat);
      t.scale.set(1, trunkH, 1);
      t.position.set(o.position[0], o.position[1] + trunkH / 2, o.position[2]);
      scene.add(t);
      for (const [r, y] of [[o.radius, o.height - o.radius], [o.radius * 0.8, o.height - o.radius * 1.8]]) {
        const b = new THREE.Mesh(ballGeo, leafMat);
        b.scale.setScalar(r);
        b.position.set(o.position[0], o.position[1] + y, o.position[2]);
        scene.add(b);
      }
    }
  }

  // Drone mesh (hidden: FPV only)
  const drone = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.05, 0.32), new THREE.MeshLambertMaterial({ color: 0x222222 }));
  drone.add(frame);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.1), new THREE.MeshLambertMaterial({ color: 0xff3020 }));
  nose.position.set(0, 0.03, -0.16);
  drone.add(nose);
  const props = [];
  for (const [x, z] of [[-0.115, -0.115], [0.115, -0.115], [0.115, 0.115], [-0.115, 0.115]]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.005, 16), new THREE.MeshBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.5 }));
    p.position.set(x, 0.035, z);
    drone.add(p);
    props.push(p);
  }
  scene.add(drone);

  // Entities (M2) as coloured boxes, keyed by id
  const entityMeshes = new Map();
  const entityColors = { infantry: 0x6b6b3a, truck: 0x4f5b3a, apc: 0x3e4a33, tank: 0x37402d };
  const entitySizes = { infantry: [0.5, 1.8, 0.4], truck: [2.5, 2.8, 7], apc: [3, 2.3, 7.5], tank: [3.6, 2.4, 7] };

  // OSD (plain text)
  const osd = document.createElement('div');
  osd.style.cssText = 'position:absolute;inset:0;font:bold 16px/1.3 monospace;color:#fff;text-shadow:0 0 3px #000,0 0 2px #000;pointer-events:none;';
  const tl = document.createElement('div'); tl.style.cssText = 'position:absolute;left:3%;top:4%;';
  const tr = document.createElement('div'); tr.style.cssText = 'position:absolute;right:3%;top:4%;text-align:right;';
  const bl = document.createElement('div'); bl.style.cssText = 'position:absolute;left:3%;bottom:5%;';
  const br = document.createElement('div'); br.style.cssText = 'position:absolute;right:3%;bottom:5%;text-align:right;';
  const mid = document.createElement('div'); mid.style.cssText = 'position:absolute;left:0;right:0;top:58%;text-align:center;font-size:22px;color:#ffd84a;';
  const help = document.createElement('div');
  help.style.cssText = 'position:absolute;left:50%;top:4%;transform:translateX(-50%);font:12px/1.4 monospace;color:#fff;opacity:.75;text-align:center;';
  help.textContent = 'W/S throttle · A/D yaw · arrows pitch/roll (Shift = full rate) · Space arm · R reset · M acro/angle · F detonate · P pause';
  const cross = document.createElement('div');
  cross.style.cssText = 'position:absolute;left:50%;top:50%;width:14px;height:14px;margin:-7px 0 0 -7px;border:2px solid rgba(255,255,255,.8);border-radius:50%;';
  osd.append(tl, tr, bl, br, mid, help, cross);
  uiRoot.appendChild(osd);
  setTimeout(() => { help.style.transition = 'opacity 2s'; help.style.opacity = '0'; }, 15000);

  // Explosions: expanding spheres (lethal radius) that fade out.
  const blasts = [];
  const blastGeo = new THREE.IcosahedronGeometry(1, 2);
  // Video static overlay while the link is lost.
  const noise = document.createElement('canvas');
  noise.width = 160; noise.height = 90;
  noise.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated;display:none;';
  uiRoot.insertBefore(noise, osd); // under the OSD text
  const nctx = noise.getContext('2d');
  const nimg = nctx.createImageData(noise.width, noise.height);

  function update(state, events, dt) {
    const d = state.drone;
    drone.position.fromArray(d.position);
    drone.quaternion.fromArray(d.quaternion);
    props.forEach((p, i) => { p.material.opacity = 0.2 + d.motors[i] * 0.6; });

    camera.position.fromArray(state.camera.position);
    camera.quaternion.fromArray(state.camera.quaternion);
    camera.fov = state.camera.fovDeg;
    drone.visible = false; // FPV only: the camera sits inside the frame
    camera.updateProjectionMatrix();

    const seen = new Set();
    for (const e of state.entities) {
      seen.add(e.id);
      let m = entityMeshes.get(e.id);
      if (!m) {
        m = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: entityColors[e.kind] ?? 0xff00ff }));
        const s = entitySizes[e.kind] ?? [1, 1, 1];
        m.scale.set(...s);
        m.geometry = boxGeo.clone().translate(0, 0.5, 0);
        entityMeshes.set(e.id, m);
        scene.add(m);
      }
      m.position.fromArray(e.position);
      m.quaternion.fromArray(e.quaternion);
      m.material.color.setHex(e.status === 'destroyed' ? 0x1a1a1a : (entityColors[e.kind] ?? 0xff00ff));
    }
    for (const [id, m] of entityMeshes) if (!seen.has(id)) { scene.remove(m); entityMeshes.delete(id); }

    for (const ev of events) {
      if (ev.type === 'crash') flash('#300');
      if (ev.type === 'explosion') {
        const m = new THREE.Mesh(blastGeo, new THREE.MeshBasicMaterial({ color: 0xffa020, transparent: true, opacity: 0.9 }));
        m.position.fromArray(ev.position);
        scene.add(m);
        blasts.push({ m, age: 0, r: ev.radius });
      }
      if (ev.type === 'reset') for (const b of blasts.splice(0)) scene.remove(b.m);
    }
    for (let i = blasts.length - 1; i >= 0; i--) {
      const b = blasts[i];
      b.age += dt;
      b.m.scale.setScalar(b.r * Math.min(1, b.age * 6));
      b.m.material.opacity = Math.max(0, 0.9 - b.age * 0.6);
      b.m.material.color.setHex(b.age > 0.3 ? 0x333333 : 0xffa020);
      if (b.age > 1.5) { scene.remove(b.m); blasts.splice(i, 1); }
    }
    noise.style.display = state.link.lost ? 'block' : 'none';
    if (state.link.lost) {
      const px = nimg.data;
      for (let i = 0; i < px.length; i += 4) { const g = Math.random() * 255; px[i] = px[i + 1] = px[i + 2] = g; px[i + 3] = 255; }
      nctx.putImageData(nimg, 0, 0);
    }

    const h = state.hud;
    const t = Math.floor(h.flightTimeS);
    tl.innerHTML = `${h.batteryV.toFixed(1)}V ${h.batteryPct}%<br>${h.currentA.toFixed(1)}A ${h.mAhUsed}mAh`;
    const wh = h.warhead === 'SAFE' ? `SAFE ${h.warheadArmInM}m` : h.warhead;
    tr.innerHTML = `LQ ${h.linkQuality}<br>${h.flightMode}<br>WH ${wh}`;
    bl.innerHTML = `THR ${h.throttlePct}%<br>${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    br.innerHTML = `${h.speedKmh.toFixed(0)} km/h<br>ALT ${h.altitudeM.toFixed(1)}m  HDG ${h.headingDeg.toFixed(0)}`;
    mid.textContent = (state.paused ? 'PAUSED  ' : '') + h.warnings.join('  ');

    renderer.render(scene, camera);
  }

  function flash(color) {
    osd.style.transition = 'none';
    osd.style.background = color;
    requestAnimationFrame(() => { osd.style.transition = 'background 0.6s'; osd.style.background = 'transparent'; });
  }

  function resize(w, h) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  return {
    update,
    resize,
    dispose() { renderer.dispose(); osd.remove(); },
  };
}
