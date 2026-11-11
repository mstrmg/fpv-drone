# FPV Drone

A realistic-style FPV strike-drone game in the browser, built with Three.js and Rapier physics.

## Run

```bash
npm install
npm run dev        # open the printed URL (add ?debug to force the placeholder renderer)
npm run test:sim   # headless flight-model checks (hover point, rates, crash, landing)
```

## Controls

| Action | Keyboard | PS5 controller (Mode 2) |
|---|---|---|
| Throttle | W / S (stays where you leave it), X = cut | Left stick up (centre = 0%, full up = 100%) |
| Yaw | A / D | Left stick left/right |
| Pitch / roll | Arrow keys (hold Shift for full rates) | Right stick |
| Arm / disarm | Space (throttle must be low) | L1 or L2 |
| Reset after crash | R | Options or Triangle |
| Acro / Angle mode | M | Square |
| Detonate warhead | F | R2 or Cross |
| Respawn all enemies | T | – |
| Pause | P / Esc | Create |

The drone flies in **acro (rate) mode** like a real FPV quad: the sticks set rotation
speed, and it does not level itself. Press M for Angle mode, which self-levels and is
easier on a keyboard.

## Layout

See [ARCHITECTURE.md](ARCHITECTURE.md). `src/sim` holds the game systems and `src/visuals` the rendering.
