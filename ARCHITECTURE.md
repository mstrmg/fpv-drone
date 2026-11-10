# Architecture

The game is split into two layers that only talk through the contract in this
file. The **sim** decides what happens; the **visuals** decide what it looks
like. Neither side imports the other's internals.

```
input (keyboard / PS5) ──► sim (fixed 240 Hz step, Rapier) ──► SimState + events ──► visuals (Three.js render, OSD, effects)
```

## Ownership

| Path            | Owner        | Contents |
|-----------------|--------------|----------|
| `src/sim/`      | game systems | flight model, physics world, level data, combat, AI, missions, battery, signal |
| `src/input/`    | game systems | keyboard + gamepad → `Controls` |
| `src/debug/`    | game systems | throwaway box renderer used to develop the sim |
| `src/visuals/`  | visuals      | everything that is drawn: scene, models, terrain mesh, lighting, effects, OSD look, video-feed shader |
| `src/main.js`   | shared       | boot + game loop. Change only with a note to the other thread |
| `ARCHITECTURE.md` | shared     | this contract. Additive changes are fine; breaking changes need agreement |

`src/visuals/index.js` starts as a stub that re-exports the debug renderer.
The visuals thread replaces it with the real implementation.

## Conventions

- Units: metres, seconds, kilograms, radians inside the sim (degrees only where a field name says `Deg`).
- Axes: Three.js convention, right-handed, **+Y up**. A body's forward is **−Z**, right is **+X**.
- Vectors are plain arrays `[x, y, z]`, quaternions `[x, y, z, w]`, so you can
  `vec.fromArray(a)` / `quat.fromArray(q)`.
- State objects are **reused between frames** (no per-frame allocation). Copy
  anything you need to keep.

## Visuals API (implemented in `src/visuals/index.js`)

```js
export function createVisuals({ canvas, uiRoot, level }) {
  return {
    update(state, events, dt), // once per animation frame, after the sim stepped
    resize(width, height),     // CSS pixels; visuals handles devicePixelRatio
    dispose(),
  };
}
```

- `canvas`: the `<canvas id="game">`. Visuals owns the `WebGLRenderer`.
- `uiRoot`: a full-screen `<div>` above the canvas for the OSD / DOM overlays.
- `level`: static `Level` data (below), given once.
- `state`: the current `SimState` (below).
- `events`: array of `SimEvent`s that happened since the last `update` (may be empty).
- `dt`: real seconds since last frame (for animation only; sim time is `state.time`).

The visuals must render the camera exactly at `state.camera` (they may add
shake / effects on top) because the camera angle is a gameplay setting.

## Level (static, given once)

```js
Level = {
  name: string,
  seed: number,
  terrain: {
    size: number,          // world width = depth in metres, centred on origin
    segments: number,      // grid cells per side
    heights: Float32Array, // (segments+1)^2, row-major: index = iz*(segments+1) + ix
                           // vertex x = -size/2 + ix*size/segments, z likewise
    heightAt(x, z): number // bilinear lookup (same surface the physics collides with)
  },
  objects: [               // static colliders; visuals draws something that fills the same volume
    { id, kind: 'building', position:[x,y,z] /* base centre on ground */, rotationY, size:[w,h,d] },
    { id, kind: 'tree',     position:[x,y,z] /* trunk base */, height, radius /* canopy radius */ },
  ],
  spawn: { position:[x,y,z], yaw },
}
```

## SimState (per frame)

```js
SimState = {
  time: number,              // sim seconds since level start
  paused: boolean,
  view: 'fpv' | 'chase',     // which camera the player asked for; chase is a visuals-side follow cam

  drone: {
    position: [x,y,z], quaternion: [x,y,z,w],
    velocity: [x,y,z], angularVelocity: [x,y,z],   // world frame
    motors: [fl, fr, rr, rl],  // normalised RPM 0..1 (prop spin speed); spin dirs: fl,rr = CW; fr,rl = CCW seen from above
    throttle: number,          // stick 0..1
    armed: boolean,
    crashed: boolean,          // props broken, needs reset
    flightMode: 'ACRO' | 'ANGLE',
  },

  camera: { position:[x,y,z], quaternion:[x,y,z,w], fovDeg /* vertical */, tiltDeg },

  hud: {                      // everything the OSD shows; visuals decides the look
    armed, flightMode,
    throttlePct,              // 0..100
    altitudeM,                // above ground under the drone
    speedKmh,
    headingDeg,               // 0 = −Z (north), clockwise
    batteryV, batteryPct, mAhUsed, currentA,
    flightTimeS,
    linkQuality,              // 0..100 (M3 makes this drop)
    warnings: string[],       // e.g. 'CRASH', 'LOW BATTERY', 'THROTTLE', 'DISARMED'
  },

  link: {                     // analog video feed quality, drives the static shader (M3)
    signal: number,           // 0..1, 1 = perfect
    jamming: number,          // 0..1
    lost: boolean,            // feed is gone (show full static / no-signal)
  },

  entities: [                 // M2: troops, vehicles, wrecks. Empty in M1.
    {
      id: string,
      kind: 'infantry' | 'truck' | 'apc' | 'tank',
      position:[x,y,z], quaternion:[x,y,z,w], velocity:[x,y,z],
      health: number,           // 0..1
      status: 'idle' | 'moving' | 'fleeing' | 'prone' | 'destroyed',
      turretYaw?: number,       // radians relative to hull (tank/apc)
    },
  ],
}
```

## SimEvent (one-shot)

Every event has `{ type, time }` plus:

| type               | extra fields | meaning |
|--------------------|--------------|---------|
| `armed`            | –            | motors started |
| `disarmed`         | –            | motors stopped |
| `collision`        | `position, normal, impactSpeed` | the drone bumped something but survived |
| `crash`            | `position, impactSpeed` | the drone broke |
| `reset`            | –            | drone respawned; visuals should clear trails, debris, etc. |
| `explosion`        | `position, radius, kind: 'warhead' \| 'vehicle' \| 'ammo'` | M2 |
| `hit`              | `entityId, position, damage` | M2 |
| `entity_destroyed` | `entityId, kind, position` | M2 |
| `link_lost` / `link_restored` | – | M3 |

## Game loop (`src/main.js`)

1. `input.poll()` → `Controls`
2. sim steps at a fixed 240 Hz using an accumulator (max 0.1 s catch-up)
3. `visuals.update(sim.state, sim.drainEvents(), dt)`

## Controls (input → sim)

```js
Controls = {
  throttle: 0..1, yaw: -1..1, pitch: -1..1, roll: -1..1, // pitch +1 = stick forward (nose down), roll +1 = right, yaw +1 = right
  arm, reset, toggleMode, toggleView, pause, fire,          // edge-triggered booleans (true for one poll)
}
```

Default bindings live in `src/input/` and are listed in the README.
