// Procedural textures. Everything is generated at start-up so the game ships no image files.
import * as THREE from 'three';
import { mulberry32, makeTileNoise } from './rng.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

export function canvasTexture(c, { repeat = false, srgb = true, aniso = 8, flipY = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.flipY = flipY;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  return t;
}

// Tileable detail noise. RG = normal of a fractal height field, B = that height, A = fine grain.
export function makeDetailTexture(size = 512) {
  const octs = [4, 8, 16, 32, 64, 128].map((p, i) => [makeTileNoise(101 + i * 7, p), p, 1 / (i + 1.4)]);
  const grain = makeTileNoise(977, 256);
  const hgt = new Float32Array(size * size);
  let min = Infinity, max = -Infinity;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let h = 0;
    for (const [n, p, a] of octs) h += n(x / size * p, y / size * p) * a;
    hgt[y * size + x] = h;
    if (h < min) min = h; if (h > max) max = h;
  }
  const data = new Uint8Array(size * size * 4);
  const at = (x, y) => hgt[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const dx = (at(x + 1, y) - at(x - 1, y)) * 9, dy = (at(x, y + 1) - at(x, y - 1)) * 9;
    data[i] = Math.max(0, Math.min(255, 128 + dx * 127));
    data[i + 1] = Math.max(0, Math.min(255, 128 + dy * 127));
    data[i + 2] = ((hgt[y * size + x] - min) / (max - min)) * 255;
    const g = grain(x / size * 256, y / size * 256) * 0.6 + grain(x / size * 256 * 0.37 + 9, y / size * 256 * 0.37) * 0.4;
    data[i + 3] = g * 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

// A spray of twigs growing from the bottom centre; `leaves` 0..1 adds the last autumn foliage.
export function makeTwigTexture(seed, leaves) {
  const S = 512;
  const [c, g] = canvas(S, S);
  const rand = mulberry32(seed);
  g.lineCap = 'round';
  const leafSpots = [];
  const branch = (x, y, ang, len, w, depth) => {
    const segs = 3;
    let px = x, py = y, a = ang;
    for (let i = 0; i < segs; i++) {
      a += (rand() - 0.5) * 0.5;
      const nx = px + Math.cos(a) * len / segs, ny = py + Math.sin(a) * len / segs;
      const shade = 58 + rand() * 34;
      g.strokeStyle = `rgb(${shade + 14},${shade + 6},${shade})`;
      g.lineWidth = Math.max(2.1, w * (1 - i / segs * 0.35));
      g.beginPath(); g.moveTo(px, py); g.lineTo(nx, ny); g.stroke();
      px = nx; py = ny;
      if (depth <= 2) leafSpots.push([px, py]);
    }
    if (depth <= 0) return;
    const kids = depth > 3 ? 3 : 2 + (rand() < 0.5 ? 1 : 0);
    for (let k = 0; k < kids; k++) {
      const spread = (k / (kids - 1) - 0.5) * 1.25 + (rand() - 0.5) * 0.5;
      branch(px, py, a + spread, len * (0.62 + rand() * 0.2), w * 0.62, depth - 1);
    }
  };
  for (let k = 0; k < 3; k++) branch(S / 2 + (k - 1) * 14, S + 4, -Math.PI / 2 + (k - 1) * 0.55, S * 0.3, 9, 6);
  // Leaves: muted ochre, rust and tired olive.
  const palette = [[132, 100, 54], [108, 76, 44], [100, 90, 54], [142, 114, 66], [88, 66, 42]];
  const count = Math.floor(leafSpots.length * leaves * 3.2);
  for (let i = 0; i < count; i++) {
    const [lx, ly] = leafSpots[Math.floor(rand() * leafSpots.length)];
    const p = palette[Math.floor(rand() * palette.length)];
    const k = 0.75 + rand() * 0.45;
    g.fillStyle = `rgb(${p[0] * k | 0},${p[1] * k | 0},${p[2] * k | 0})`;
    const r = 3 + rand() * 4.5;
    const ex = lx + (rand() - 0.5) * 34, ey = ly + (rand() - 0.5) * 34;
    // Keep foliage inside a rounded outline so the card's square edge never shows.
    if (((ex - S / 2) / (S * 0.44)) ** 2 + ((ey - S * 0.46) / (S * 0.42)) ** 2 > 0.75 + rand() * 0.25) continue;
    g.beginPath();
    g.ellipse(ex, ey, r, r * 0.6, rand() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  const t = canvasTexture(c);
  return t;
}

export function makeGrassTexture() {
  const W = 768, H = 256;
  const [c, g] = canvas(W, H);
  const rand = mulberry32(55);
  g.lineCap = 'round';
  for (let i = 0; i < 150; i++) {
    // Three clumps, one per card of a tuft, each thick in the middle and thin at the sides.
    const third = i % 3;
    const x = (third + 0.5 + (rand() + rand() + rand() - 1.5) * 0.3) * (W / 3);
    const h = H * (0.35 + rand() * 0.62);
    const lean = (rand() - 0.5) * 90;
    const k = 0.7 + rand() * 0.5;
    g.strokeStyle = `rgb(${210 * k | 0},${204 * k | 0},${184 * k | 0})`;
    for (let s = 0; s < 6; s++) {
      const t0 = s / 6, t1 = (s + 1) / 6;
      g.lineWidth = 5.5 * (1 - t0) + 1.2;
      g.beginPath();
      g.moveTo(x + lean * t0 * t0, H - h * t0);
      g.lineTo(x + lean * t1 * t1, H - h * t1);
      g.stroke();
    }
  }
  return canvasTexture(c);
}

export function makeSoftParticleTexture() {
  const S = 128;
  const [c, g] = canvas(S, S);
  const rand = mulberry32(8);
  for (let i = 0; i < 26; i++) {
    const x = S / 2 + (rand() - 0.5) * S * 0.42, y = S / 2 + (rand() - 0.5) * S * 0.42, r = S * (0.14 + rand() * 0.2);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.16)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
  }
  return canvasTexture(c, { srgb: false });
}

function speckle(g, w, h, rand, n, dark, alpha) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(${dark},${dark},${dark},${rand() * alpha})`;
    const s = 1 + rand() * 3;
    g.fillRect(rand() * w, rand() * h, s, s * (0.5 + rand()));
  }
}

function streaks(g, w, h, rand, n, color, alpha) {
  for (let i = 0; i < n; i++) {
    const x = rand() * w, y0 = rand() * h * 0.5, len = h * (0.15 + rand() * 0.5), ww = 2 + rand() * 9;
    const gr = g.createLinearGradient(0, y0, 0, y0 + len);
    gr.addColorStop(0, `rgba(${color},${alpha * (0.4 + rand() * 0.6)})`);
    gr.addColorStop(1, `rgba(${color},0)`);
    g.fillStyle = gr;
    g.fillRect(x, y0, ww, len);
  }
}

function drawWindow(g, x, y, w, h, rand, { frame = '#d9d6cc', boarded = false, broken = false } = {}) {
  g.fillStyle = frame;
  g.fillRect(x - 5, y - 5, w + 10, h + 10);
  if (boarded) {
    g.fillStyle = '#6d5a43';
    g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(30,22,14,0.55)'; g.lineWidth = 2;
    for (let i = 1; i < 5; i++) { g.beginPath(); g.moveTo(x, y + h * i / 5); g.lineTo(x + w, y + h * i / 5 + (rand() - 0.5) * 4); g.stroke(); }
    return;
  }
  const gr = g.createLinearGradient(x, y, x + w * 0.4, y + h);
  gr.addColorStop(0, '#39444c'); gr.addColorStop(0.5, '#1c2227'); gr.addColorStop(1, '#2c3338');
  g.fillStyle = gr;
  g.fillRect(x, y, w, h);
  if (broken) {
    g.fillStyle = '#07090a';
    g.beginPath();
    g.moveTo(x + w * 0.1, y + h); g.lineTo(x + w * 0.3, y + h * 0.3); g.lineTo(x + w * 0.55, y + h * 0.55);
    g.lineTo(x + w * 0.75, y + h * 0.15); g.lineTo(x + w * 0.95, y + h); g.fill();
  } else {
    g.fillStyle = 'rgba(190,205,215,0.16)';
    g.beginPath(); g.moveTo(x, y + h * 0.5); g.lineTo(x + w * 0.6, y); g.lineTo(x + w * 0.9, y); g.lineTo(x, y + h * 0.9); g.fill();
  }
  g.fillStyle = frame;
  g.fillRect(x + w / 2 - 2, y, 4, h);
  g.fillRect(x, y + h * 0.32 - 2, w, 4);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(x - 5, y + h + 5, w + 10, 3);
}

function soot(g, x, y, w, h) {
  const gr = g.createRadialGradient(x + w / 2, y, 4, x + w / 2, y - h * 0.3, h * 1.1);
  gr.addColorStop(0, 'rgba(8,7,6,0.85)'); gr.addColorStop(1, 'rgba(8,7,6,0)');
  g.fillStyle = gr;
  g.fillRect(x - w, y - h * 1.6, w * 3, h * 2.2);
}

// One wall bay with a window. Tiles horizontally; houses use it once vertically, blocks once per floor.
export function makeWallTexture(style, seed) {
  const S = 512;
  const [c, g] = canvas(S, S);
  const rand = mulberry32(seed);
  const damaged = style.damaged;
  if (style.kind === 'brick') {
    g.fillStyle = style.mortar; g.fillRect(0, 0, S, S);
    const bh = 16, bw = 46;
    for (let r = 0; r < S / bh; r++) for (let q = -1; q < S / bw + 1; q++) {
      const k = 0.82 + rand() * 0.3;
      g.fillStyle = `rgb(${style.rgb[0] * k | 0},${style.rgb[1] * k | 0},${style.rgb[2] * k | 0})`;
      g.fillRect(q * bw + (r % 2) * bw / 2 + 1, r * bh + 1, bw - 3, bh - 3);
    }
  } else if (style.kind === 'panel') {
    g.fillStyle = `rgb(${style.rgb})`; g.fillRect(0, 0, S, S);
    speckle(g, S, S, rand, 5000, 40, 0.12);
    speckle(g, S, S, rand, 2500, 235, 0.1);
    g.fillStyle = 'rgba(25,25,25,0.6)';
    g.fillRect(0, 0, S, 5); g.fillRect(0, 0, 5, S);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(0, 5, S, 3); g.fillRect(5, 0, 3, S);
  } else {
    g.fillStyle = `rgb(${style.rgb})`; g.fillRect(0, 0, S, S);
    speckle(g, S, S, rand, 3500, 60, 0.08);
    speckle(g, S, S, rand, 1500, 255, 0.08);
    // Cracked patches showing the clay underneath.
    for (let i = 0; i < (damaged ? 7 : 2); i++) {
      g.fillStyle = `rgba(150,120,90,${0.35 + rand() * 0.3})`;
      g.beginPath();
      const x = rand() * S, y = S * 0.3 + rand() * S * 0.7;
      for (let k = 0; k < 7; k++) g.lineTo(x + Math.cos(k) * (10 + rand() * 30), y + Math.sin(k) * (8 + rand() * 22));
      g.fill();
    }
  }
  streaks(g, S, S, rand, 16, '40,36,30', 0.22);
  const win = style.window;
  if (win) {
    const [wx, wy, ww, wh] = win.map((v) => v * S);
    const broken = damaged && rand() < 0.7;
    if (damaged) soot(g, wx, wy, ww, wh);
    drawWindow(g, wx, wy, ww, wh, rand, { frame: style.frame, boarded: damaged && !broken, broken });
  }
  if (style.plinth) {
    const y = S * (1 - style.plinth);
    g.fillStyle = style.plinthColor; g.fillRect(0, y, S, S - y);
    speckle(g, S, S, rand, 600, 20, 0.2);
    const gr = g.createLinearGradient(0, y - 60, 0, S);
    gr.addColorStop(0, 'rgba(60,48,36,0)'); gr.addColorStop(1, 'rgba(60,48,36,0.6)');
    g.fillStyle = gr; g.fillRect(0, y - 60, S, S - y + 60);
  }
  return canvasTexture(c, { repeat: true });
}

export function makeRoofTexture(kind, seed) {
  const S = 256;
  const [c, g] = canvas(S, S);
  const rand = mulberry32(seed);
  const base = kind === 'slate' ? [118, 120, 118] : kind === 'rust' ? [112, 62, 46] : [70, 74, 78];
  g.fillStyle = `rgb(${base})`; g.fillRect(0, 0, S, S);
  // Corrugation running down the slope.
  for (let x = 0; x < S; x += 16) {
    const gr = g.createLinearGradient(x, 0, x + 16, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0.28)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0.28)');
    g.fillStyle = gr; g.fillRect(x, 0, 16, S);
  }
  g.fillStyle = 'rgba(0,0,0,0.3)';
  for (let y = 0; y < S; y += 64) g.fillRect(0, y, S, 2);
  speckle(g, S, S, rand, 1800, 30, 0.2);
  streaks(g, S, S, rand, 22, kind === 'slate' ? '70,82,50' : '50,30,20', 0.35);
  return canvasTexture(c, { repeat: true });
}

export function makePlankTexture() {
  const S = 256;
  const [c, g] = canvas(S, S);
  const rand = mulberry32(31);
  for (let x = 0; x < S; x += 20) {
    const k = 0.7 + rand() * 0.4;
    g.fillStyle = `rgb(${96 * k | 0},${82 * k | 0},${66 * k | 0})`;
    g.fillRect(x, 0, 19, S);
    g.fillStyle = 'rgba(20,14,8,0.7)'; g.fillRect(x + 19, 0, 1, S);
  }
  speckle(g, S, S, rand, 1200, 20, 0.2);
  return canvasTexture(c, { repeat: true });
}

// Carbon-fibre weave for the drone frame.
export function makeCarbonTexture() {
  const S = 128;
  const [c, g] = canvas(S, S);
  g.fillStyle = '#17181a'; g.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 8) for (let x = 0; x < S; x += 8) {
    const a = ((x + y) / 8) % 2 === 0;
    const gr = a ? g.createLinearGradient(x, y, x + 8, y) : g.createLinearGradient(x, y, x, y + 8);
    gr.addColorStop(0, '#101112'); gr.addColorStop(0.5, '#34363a'); gr.addColorStop(1, '#101112');
    g.fillStyle = gr; g.fillRect(x, y, 8, 8);
  }
  return canvasTexture(c, { repeat: true });
}

// Motion-blurred propeller disc.
export function makePropBlurTexture() {
  const S = 128;
  const [c, g] = canvas(S, S);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(30,30,30,0.0)');
  gr.addColorStop(0.18, 'rgba(30,30,30,0.5)');
  gr.addColorStop(0.8, 'rgba(40,40,40,0.34)');
  gr.addColorStop(0.93, 'rgba(60,60,60,0.5)');
  gr.addColorStop(1, 'rgba(40,40,40,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  return canvasTexture(c);
}
