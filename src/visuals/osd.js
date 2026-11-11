// Flight-controller style on-screen display: a blocky white pixel font with a black outline, drawn
// to a small canvas that the feed shader burns into the video, so static and smear hit it too.
import * as THREE from 'three';

const FONT = {
  '0': '01110 10001 10011 10101 11001 10001 01110', '1': '00100 01100 00100 00100 00100 00100 01110',
  '2': '01110 10001 00001 00010 00100 01000 11111', '3': '11111 00010 00100 00010 00001 10001 01110',
  '4': '00010 00110 01010 10010 11111 00010 00010', '5': '11111 10000 11110 00001 00001 10001 01110',
  '6': '00110 01000 10000 11110 10001 10001 01110', '7': '11111 00001 00010 00100 01000 01000 01000',
  '8': '01110 10001 10001 01110 10001 10001 01110', '9': '01110 10001 10001 01111 00001 00010 01100',
  A: '01110 10001 10001 11111 10001 10001 10001', B: '11110 10001 10001 11110 10001 10001 11110',
  C: '01110 10001 10000 10000 10000 10001 01110', D: '11100 10010 10001 10001 10001 10010 11100',
  E: '11111 10000 10000 11110 10000 10000 11111', F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01110 10001 10000 10111 10001 10001 01111', H: '10001 10001 10001 11111 10001 10001 10001',
  I: '01110 00100 00100 00100 00100 00100 01110', J: '00111 00010 00010 00010 00010 10010 01100',
  K: '10001 10010 10100 11000 10100 10010 10001', L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001', N: '10001 10001 11001 10101 10011 10001 10001',
  O: '01110 10001 10001 10001 10001 10001 01110', P: '11110 10001 10001 11110 10000 10000 10000',
  Q: '01110 10001 10001 10001 10101 10010 01101', R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110', T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110', V: '10001 10001 10001 10001 10001 01010 00100',
  W: '10001 10001 10001 10101 10101 10101 01010', X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 10001 01010 00100 00100 00100', Z: '11111 00001 00010 00100 01000 10000 11111',
  '.': '00000 00000 00000 00000 00000 01100 01100', ':': '00000 01100 01100 00000 01100 01100 00000',
  '%': '11000 11001 00010 00100 01000 10011 00011', '/': '00000 00001 00010 00100 01000 10000 00000',
  '-': '00000 00000 00000 11111 00000 00000 00000', '+': '00000 00100 00100 11111 00100 00100 00000',
  '!': '00100 00100 00100 00100 00100 00000 00100', '|': '00100 00100 00100 00100 00100 00100 00100',
  "'": '00000 00000 00000 00100 00100 00100 00100',
  // Icons
  b: '01110 11111 10001 10001 11111 11111 11111', // battery
  a: '00100 01110 10101 00100 00100 00100 00100', // altitude
  s: '00000 00100 00010 11111 00010 00100 00000', // speed
  l: '00001 00001 00101 00101 10101 10101 10101', // link
  t: '01110 10101 10101 10111 10001 10001 01110', // timer
  v: '00000 00000 00000 11111 01110 00100 00000', // heading caret
  h: '00100 01110 11111 01110 01110 01110 01110', // throttle
};

const PX = 3, CW = 6 * PX, CH = 9 * PX, ROWS = 16, H = CH * ROWS, PAD = 3;
const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function buildAtlas() {
  const keys = Object.keys(FONT);
  const cw = 5 * PX + PAD * 2, ch = 7 * PX + PAD * 2;
  const c = document.createElement('canvas');
  c.width = cw * keys.length; c.height = ch;
  const g = c.getContext('2d');
  const index = {};
  keys.forEach((key, n) => {
    index[key] = n;
    const rows = FONT[key].split(' ');
    const draw = (ox, oy, w) => {
      for (let r = 0; r < 7; r++) for (let q = 0; q < 5; q++) {
        if (rows[r][q] === '1') g.fillRect(n * cw + PAD + q * PX + ox - w, PAD + r * PX + oy - w, PX + w * 2, PX + w * 2);
      }
    };
    g.fillStyle = '#000'; draw(0, 0, 2);
    g.fillStyle = '#f4f4f0'; draw(0, 0, 0);
  });
  return { canvas: c, index, cw, ch };
}

export function createOSD() {
  const atlas = buildAtlas();
  const canvas = document.createElement('canvas');
  canvas.width = 768; canvas.height = H;
  let g = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const euler = new THREE.Euler(), quat = new THREE.Quaternion();
  let cols = 42, acc = 1, clock = 0;

  function text(str, x, y, align = 'left') {
    str = String(str).toUpperCase();
    const w = str.length * CW;
    let px = Math.round(align === 'right' ? x - w : align === 'center' ? x - w / 2 : x);
    for (const chRaw of str) {
      const n = atlas.index[chRaw] ?? atlas.index[chRaw.toLowerCase()];
      if (n !== undefined) g.drawImage(atlas.canvas, n * atlas.cw, 0, atlas.cw, atlas.ch, px - PAD, Math.round(y) - PAD, atlas.cw, atlas.ch);
      px += CW;
    }
  }
  // Icons are lower-case keys in the font table and must not be upper-cased.
  function icon(key, x, y) {
    const n = atlas.index[key];
    g.drawImage(atlas.canvas, n * atlas.cw, 0, atlas.cw, atlas.ch, Math.round(x) - PAD, Math.round(y) - PAD, atlas.cw, atlas.ch);
  }
  function dash(x, y, w, h = PX) {
    g.fillStyle = '#000'; g.fillRect(Math.round(x - w / 2) - 2, Math.round(y - h / 2) - 2, w + 4, h + 4);
    g.fillStyle = '#f4f4f0'; g.fillRect(Math.round(x - w / 2), Math.round(y - h / 2), w, h);
  }

  function draw(state) {
    const W = canvas.width, hud = state.hud;
    const L = CW * 2, R = W - CW * 2, cx = W / 2, cy = H / 2;
    const row = (r) => r * CH + 3;
    const blink = Math.floor(clock * 2.5) % 2 === 0;
    g.clearRect(0, 0, W, H);

    // Top: link, mode, compass tape, timer.
    icon('l', L, row(1)); text(String(Math.round(hud.linkQuality)).padStart(3, ' '), L + CW, row(1));
    text(hud.flightMode, L, row(2));
    const t = Math.floor(hud.flightTimeS);
    text(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`, R, row(1), 'right');
    icon('t', R - CW * 6.4, row(1));
    text(hud.armed ? 'ARMED' : 'DISARMED', R, row(2), 'right');

    const pxPerDeg = 3.4, span = 44;
    const hdg = ((hud.headingDeg % 360) + 360) % 360;
    for (let d = Math.ceil((hdg - span) / 15) * 15; d <= hdg + span; d += 15) {
      const x = cx + (d - hdg) * pxPerDeg;
      const dn = ((d % 360) + 360) % 360;
      if (dn % 45 === 0) text(CARDINALS[dn / 45], x, row(1), 'center');
      else dash(x, row(1) + 10, PX, 9);
    }
    icon('v', cx - CW / 2 + 1, row(0) + 6);
    text(String(Math.round(hdg) % 360).padStart(3, '0'), cx, row(2), 'center');

    // Centre: crosshair and artificial horizon.
    dash(cx, cy, 9, PX); dash(cx, cy, PX, 9);
    dash(cx - 24, cy, 15); dash(cx + 24, cy, 15);
    quat.fromArray(state.drone.quaternion);
    euler.setFromQuaternion(quat, 'YXZ');
    const pitchPx = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(euler.x) * 2.6, -110, 110);
    const slope = Math.tan(THREE.MathUtils.clamp(euler.z, -1.25, 1.25));
    for (let i = -5; i <= 5; i++) {
      if (i === 0) continue;
      const x = cx + i * 30 + Math.sign(i) * 34;
      const y = cy + pitchPx + slope * (x - cx);
      if (Math.abs(y - cy) < 120) dash(x, y, 18);
    }
    for (const sgn of [-1, 1]) for (let k = -2; k <= 2; k++) dash(cx + sgn * 232, cy + k * 30, k === 0 ? 15 : 9);

    // Sides: speed and altitude.
    icon('s', L, row(7.5)); text(`${Math.round(hud.speedKmh)}`.padStart(3, ' '), L + CW, row(7.5)); text('KMH', L + CW * 4.4, row(7.5));
    const alt = Math.max(0, hud.altitudeM);
    text(`${alt.toFixed(alt < 100 ? 1 : 0)}M`, R, row(7.5), 'right');
    icon('a', R - CW * 7.2, row(7.5));

    // Bottom: battery, current, capacity, throttle.
    const low = hud.batteryPct < 20;
    if (!low || blink) { icon('b', L, row(13)); text(`${hud.batteryV.toFixed(1)}V`, L + CW * 1.3, row(13)); }
    text(`${hud.currentA.toFixed(1)}A`, L + CW * 1.3, row(14));
    text(`${Math.round(hud.mAhUsed)} MAH`, R, row(13), 'right');
    text(`${String(Math.round(hud.throttlePct)).padStart(3, ' ')}%`, R, row(14), 'right');
    icon('h', R - CW * 5.4, row(14));

    // Warhead state under the mode, when the sim reports one.
    if (hud.warhead && hud.warhead !== 'NONE') {
      const arming = hud.warhead === 'SAFE' && hud.warheadArmInM > 0;
      if (hud.warhead !== 'ARMED' || blink) text(arming ? `ARM IN ${Math.ceil(hud.warheadArmInM)}M` : `WH ${hud.warhead}`, L, row(3));
    }

    // Warnings blink in the lower centre, as flight controllers do.
    const warn = hud.warnings.filter((w) => w !== 'DISARMED');
    if (warn.length && blink) warn.slice(0, 2).forEach((w, i) => text(w, cx, row(11 + i), 'center'));
    texture.needsUpdate = true;
  }

  return {
    texture,
    resize(aspect) {
      cols = Math.max(28, Math.round((H * aspect) / CW));
      canvas.width = cols * CW;
      texture.dispose(); // size changed, so the GPU copy must be reallocated
      g = canvas.getContext('2d');
      g.imageSmoothingEnabled = false;
      acc = 1;
    },
    update(state, dt) {
      clock += dt; acc += dt;
      if (acc < 1 / 30) return;
      acc = 0;
      draw(state);
    },
    dispose() { texture.dispose(); },
  };
}
