// Boot + game loop. Shared file: see ARCHITECTURE.md › Game loop.
import { LEVELS, createLevel } from './sim/demoLevels.js';
import { pickMap } from './mapPicker.js';
import { createSim, SIM_HZ } from './sim/index.js';
import { createInput } from './input/index.js';
import { createVisuals as createRealVisuals } from './visuals/index.js';
import { createDebugVisuals } from './debug/debugVisuals.js';

const canvas = document.getElementById('game');
const uiRoot = document.getElementById('ui');

// ?map=<id> skips the picker (see LEVELS in src/sim/demoLevels.js).
const mapId = new URLSearchParams(location.search).get('map') ?? await pickMap(uiRoot, LEVELS);
const level = createLevel(mapId);
const sim = await createSim({ level });
const input = createInput(window);
// ?debug forces the placeholder renderer.
const useDebug = new URLSearchParams(location.search).has('debug');
const visuals = (useDebug ? createDebugVisuals : createRealVisuals)({ canvas, uiRoot, level });

// On foot, a click captures the mouse for looking around (Esc releases it).
canvas.addEventListener('click', () => {
  if (sim.state.mode === 'foot' && !document.pointerLockElement) canvas.requestPointerLock?.();
});

function resize() { visuals.resize(window.innerWidth, window.innerHeight); }
window.addEventListener('resize', resize);
resize();

const STEP = 1 / SIM_HZ;
let acc = 0;
let last = performance.now();

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  input.setMode(sim.state.mode);
  const controls = input.poll(dt);
  acc += dt;
  while (acc >= STEP) {
    sim.step(STEP, controls);
    input.consumeEdges(); // edge-triggered actions apply once, not once per sub-step
    acc -= STEP;
  }
  visuals.update(sim.state, sim.drainEvents(), dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Handy in the console while tuning.
window.__fpv = { sim, input, level };
