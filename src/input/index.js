// Keyboard + gamepad (PS5 DualSense, standard mapping) → Controls.
// See ARCHITECTURE.md › Controls.

export const KEY_BINDINGS = {
  throttleUp: ['KeyW'],
  throttleDown: ['KeyS'],
  yawLeft: ['KeyA'],
  yawRight: ['KeyD'],
  pitchForward: ['ArrowUp'],
  pitchBack: ['ArrowDown'],
  rollLeft: ['ArrowLeft'],
  rollRight: ['ArrowRight'],
  throttleCut: ['KeyX'],
  arm: ['Space'],
  reset: ['KeyR'],
  toggleMode: ['KeyM'],
  pause: ['KeyP', 'Escape'],
  fire: ['KeyF'],
  resetTargets: ['KeyT'],
  interact: ['KeyE'],          // on foot: put the goggles on
  goggles: ['KeyE', 'KeyG'],   // flying: take them off again (campaign)
};

// On foot (campaign start): WASD walk, mouse (click to capture) or arrows look, Shift run.
export const FOOT_KEYS = { forward: ['KeyW'], back: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
  lookLeft: ['ArrowLeft'], lookRight: ['ArrowRight'], lookUp: ['ArrowUp'], lookDown: ['ArrowDown'] };

// Standard Gamepad mapping indices (DualSense in Chrome/Firefox/Edge).
export const PAD = {
  axes: { lx: 0, ly: 1, rx: 2, ry: 3 },
  buttons: { cross: 0, circle: 1, square: 2, triangle: 3, l1: 4, r1: 5, l2: 6, r2: 7, create: 8, options: 9, l3: 10, r3: 11 },
};

export const DEFAULT_INPUT_SETTINGS = {
  deadzone: 0.04,
  // Keyboard: sticks slew toward the target so keys aren't binary jumps.
  keyStickRate: 5,      // stick units / s
  keyStickMax: 0.75,    // full key press = 75% stick (full-rate flips with Shift)
  keyThrottleRate: 0.6, // throttle units / s while W/S held
  // 'stick': Mode 2 left stick on a self-centring pad: centre = 0%, full up = 100%,
  //          below centre stays 0%. 'r2': R2 trigger is throttle.
  padThrottle: 'stick',
  mouseSensitivity: 0.0022, // rad per pixel
  padLookRate: 2.6,         // rad/s at full right stick
  keyLookRate: 1.8,         // rad/s with the arrow keys
};

const EDGE_ACTIONS = ['arm', 'reset', 'toggleMode', 'pause', 'fire', 'resetTargets', 'interact', 'goggles'];
const PAD_EDGES = { arm: ['l1', 'l2'], reset: ['options', 'triangle'], toggleMode: ['square'], pause: ['create'], fire: ['r2', 'cross'], interact: ['cross'], goggles: ['circle'] };

export function createInput(target = window, settings = {}) {
  const s = { ...DEFAULT_INPUT_SETTINGS, ...settings };
  const down = new Set();
  const pressed = new Set(); // edge-triggered key codes since last poll
  const kb = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
  const padPrev = new Map();
  let source = 'keyboard';
  let lastPadThrottle = null;

  const controls = { throttle: 0, yaw: 0, pitch: 0, roll: 0, source: 'keyboard', moveX: 0, moveZ: 0, lookX: 0, lookY: 0, sprint: false };
  let mode = 'drone'; // main.js keeps this in step with the sim (foot | drone)
  let mouseX = 0, mouseY = 0;
  const onMouse = (e) => {
    if (typeof document === 'undefined' || !document.pointerLockElement) return;
    mouseX += e.movementX || 0; mouseY += e.movementY || 0;
  };
  target.addEventListener('mousemove', onMouse);
  for (const a of EDGE_ACTIONS) controls[a] = false;

  const onDown = (e) => {
    if (e.repeat) return;
    if (Object.values(KEY_BINDINGS).some((codes) => codes.includes(e.code))) e.preventDefault();
    if (e.code.startsWith('Arrow')) e.preventDefault();
    down.add(e.code);
    pressed.add(e.code);
    source = 'keyboard';
  };
  const onUp = (e) => down.delete(e.code);
  const onBlur = () => down.clear();
  target.addEventListener('keydown', onDown);
  target.addEventListener('keyup', onUp);
  target.addEventListener('blur', onBlur);

  const held = (action) => KEY_BINDINGS[action].some((c) => down.has(c));
  const tapped = (action) => KEY_BINDINGS[action].some((c) => pressed.has(c));
  const approach = (cur, want, rate, dt) => {
    const d = want - cur, m = rate * dt;
    return Math.abs(d) <= m ? want : cur + Math.sign(d) * m;
  };
  const dz = (v) => {
    const a = Math.abs(v);
    return a < s.deadzone ? 0 : Math.sign(v) * (a - s.deadzone) / (1 - s.deadzone);
  };

  function readPad() {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected && p.mapping === 'standard') return p;
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  // Edge actions stay set until the sim has consumed them (a frame can run zero sim steps).
  function consumeEdges() {
    for (const a of EDGE_ACTIONS) controls[a] = false;
  }

  function poll(dt) {
    const foot = mode === 'foot';

    // --- Keyboard
    const boost = down.has('ShiftLeft') || down.has('ShiftRight') ? 1 / s.keyStickMax : 1;
    const max = s.keyStickMax * boost;
    const axis = (neg, pos) => (held(pos) ? 1 : 0) - (held(neg) ? 1 : 0);
    const fk = (a) => FOOT_KEYS[a].some((c) => down.has(c));
    const fa = (neg, pos) => (fk(pos) ? 1 : 0) - (fk(neg) ? 1 : 0);
    if (foot) {
      // Walking: the drone sticks rest at zero so nothing is stale when the goggles go on.
      kb.pitch = kb.roll = kb.yaw = kb.throttle = 0;
      controls.moveX = fa('left', 'right');
      controls.moveZ = fa('back', 'forward');
      controls.lookX = mouseX * s.mouseSensitivity + fa('lookLeft', 'lookRight') * s.keyLookRate * dt;
      controls.lookY = mouseY * s.mouseSensitivity - fa('lookDown', 'lookUp') * s.keyLookRate * dt;
      controls.sprint = down.has('ShiftLeft') || down.has('ShiftRight');
    } else {
      controls.moveX = controls.moveZ = controls.lookX = controls.lookY = 0;
      controls.sprint = false;
    }
    mouseX = mouseY = 0;
    kb.pitch = approach(kb.pitch, foot ? 0 : axis('pitchBack', 'pitchForward') * max, s.keyStickRate, dt);
    kb.roll = approach(kb.roll, foot ? 0 : axis('rollLeft', 'rollRight') * max, s.keyStickRate, dt);
    kb.yaw = approach(kb.yaw, foot ? 0 : axis('yawLeft', 'yawRight') * max, s.keyStickRate, dt);
    kb.throttle = foot ? 0 : Math.min(1, Math.max(0, kb.throttle + axis('throttleDown', 'throttleUp') * s.keyThrottleRate * dt));
    if (held('throttleCut')) kb.throttle = 0;
    for (const a of EDGE_ACTIONS) if (tapped(a)) controls[a] = true;
    pressed.clear();

    // --- Gamepad
    const pad = readPad();
    let padActive = false;
    if (pad) {
      const ax = (i) => dz(pad.axes[i] ?? 0);
      const btn = (name) => {
        const b = pad.buttons[PAD.buttons[name]];
        return b ? (b.pressed || b.value > 0.5) : false;
      };
      const throttle = s.padThrottle === 'r2'
        ? (pad.buttons[PAD.buttons.r2]?.value ?? 0)
        : Math.min(1, Math.max(0, -dz(pad.axes[PAD.axes.ly] ?? 0)));
      const sticks = { yaw: ax(PAD.axes.lx), roll: ax(PAD.axes.rx), pitch: -ax(PAD.axes.ry) };
      // The pad takes over once a stick moves; keyboard takes over on a key press.
      if (lastPadThrottle !== null && Math.abs(throttle - lastPadThrottle) > 0.02) source = 'gamepad';
      if (Math.abs(sticks.yaw) + Math.abs(sticks.roll) + Math.abs(sticks.pitch) > 0.1) source = 'gamepad';
      lastPadThrottle = throttle;
      for (const [action, names] of Object.entries(PAD_EDGES)) {
        for (const n of names) {
          if (s.padThrottle === 'r2' && n === 'r2') continue;
          const now = btn(n);
          if (now && !padPrev.get(n)) { controls[action] = true; source = 'gamepad'; }
          padPrev.set(n, now);
        }
      }
      if (foot) {
        // Left stick walks, right stick looks, L3 (or R1) runs.
        const mx = ax(PAD.axes.lx), mz = -ax(PAD.axes.ly), lx = ax(PAD.axes.rx), ly = ax(PAD.axes.ry);
        if (Math.abs(mx) + Math.abs(mz) + Math.abs(lx) + Math.abs(ly) > 0.1) source = 'gamepad';
        controls.moveX = Math.max(-1, Math.min(1, controls.moveX + mx));
        controls.moveZ = Math.max(-1, Math.min(1, controls.moveZ + mz));
        controls.lookX += lx * Math.abs(lx) * s.padLookRate * dt;
        controls.lookY += ly * Math.abs(ly) * s.padLookRate * dt;
        controls.sprint ||= btn('l3') || btn('r1');
      }
      if (source === 'gamepad') {
        padActive = true;
        controls.throttle = throttle;
        controls.yaw = sticks.yaw;
        controls.roll = sticks.roll;
        controls.pitch = sticks.pitch;
      }
    }
    if (!padActive) {
      controls.throttle = kb.throttle;
      controls.yaw = kb.yaw;
      controls.pitch = kb.pitch;
      controls.roll = kb.roll;
    } else {
      kb.throttle = 0; // so switching back to keyboard doesn't jump to a stale throttle
    }
    if (foot) controls.throttle = controls.yaw = controls.pitch = controls.roll = 0;
    controls.source = padActive ? 'gamepad' : 'keyboard';
    controls.gamepadName = pad ? pad.id : null;
    return controls;
  }

  return {
    controls,
    settings: s,
    poll,
    consumeEdges,
    setMode(m) { mode = m; },
    dispose() {
      target.removeEventListener('mousemove', onMouse);
      target.removeEventListener('keydown', onDown);
      target.removeEventListener('keyup', onUp);
      target.removeEventListener('blur', onBlur);
    },
  };
}
