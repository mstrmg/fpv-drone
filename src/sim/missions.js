// Campaign missions. The other soldier in the dugout flies the spotter drone: at the start of a
// mission he calls you over, and his spotter feed shows the targets (what they are and where) while
// he talks. Nothing is marked on the map: you find them again yourself.
//
// level.missions = [{
//   id, title, objective,                      // objective: one line for the HUD
//   intro: [{ say, after?, dur?, shot? }],     // lines in order; `after` s of silence first; `dur` s on screen
//   outro: [{ say, after?, dur? }],           // all targets dealt with
//   outroPartial?, outroFailed?,               // some / all of them got away (enemy defs with `route: true`)
//   retry?: [...],                             // after a failure: the targets are put back and this plays instead of the intro
// }]
// Targets with `waitFor: <id>` sit still until that mission starts. A target on a `route` that reaches
// its last point has escaped: the mission ends once every target is dealt with or gone (no timer shown).
// If any got away the mission has failed: the outro plays, then the mission restarts.
// A shot is the spotter camera while that line plays: { look: 'targets' | [x,y,z], range, height, bearing, fov }
// (camera `range` m from the look point, `height` m above it, from `bearing` rad: 0 = from the south).
// A line may say `{brg}` / `{rng}` / `{dir}`: the targets' compass bearing (3 digits, 0 = north = −Z) and range
// from the dugout, rounded the way he would say it, and the way they are moving.
// While you fly an active mission he calls the bearing and range from your drone over the radio now and then.
// Targets are the level enemies whose def has `mission: <id>`. A target counts as dealt with once it
// is dead or can no longer fight (down / crawling, or a knocked-out vehicle).

const SPEAKER = 'SASHA';

export function createMissions({ level, entities, state, emit }) {
  const list = level.missions ?? [];
  const m = {
    id: null, title: null, objective: null, phase: 'none',   // 'intro' | 'active' | 'outro' | 'done' | 'none'
    done: 0, total: 0, escaped: 0,
    speaker: SPEAKER, line: null, lineId: 0,                 // the subtitle on screen now; lineId changes per line
    cutscene: null,                                          // spotter camera { position, target, fovDeg } while briefing
    spotter: { position: [0, 0, 0], target: [0, 0, 0], fovDeg: 10 }, // what his drone sees all the time (the TV in the dugout)
    bearing: null,          // { fromHome: { deg, m }, fromDrone: { deg, m } | null, moving: 'east' | ... | null }: where the targets are
  };
  state.mission = list.length ? m : null;
  if (!list.length) return { update() {}, skip() { return false; }, reset() {}, next() {} };

  let index = -1, script = [], step = 0, clock = 0, lineEnds = 0, waiting = 0;
  let targets = [];
  const centre = [0, 0, 0];
  const camPos = [0, 0, 0], camTarget = [0, 0, 0];

  let failed = false;
  function start(i, retry = false) {
    index = i; failed = false;
    const def = list[i];
    if (!def) { m.phase = 'done'; m.line = null; m.cutscene = null; return; }
    m.id = def.id; m.title = def.title; m.objective = def.objective;
    targets = entities.list.filter((e) => e.tag === def.id);
    m.total = targets.length; m.done = 0; m.escaped = 0;
    for (const e of targets) if (e.waitFor === def.id) e.go = true;
    m.phase = 'intro';
    run((retry ? def.retry : null) ?? def.intro ?? []);
    emit({ type: 'mission', id: def.id, phase: 'intro', title: def.title, retry });
  }

  function run(lines) { script = lines; step = 0; clock = 0; waiting = lines[0]?.after ?? 0; lineEnds = -1; m.line = null; m.cutscene = null; }

  function fill(text) {
    const b = m.bearing;
    if (!b) return text;
    return text.replace('{brg}', brg(b.fromHome.deg)).replace('{rng}', String(roundRange(b.fromHome.m)))
      .replace('{dir}', b.moving ?? 'along it');
  }

  function say(l) {
    m.line = fill(l.say); m.lineId++;
    lineEnds = clock + (l.dur ?? Math.max(2.5, l.say.length * 0.065));
    m.cutscene = l.shot ? shot(l.shot) : null;
    emit({ type: 'mission_line', speaker: SPEAKER, text: m.line, lineId: m.lineId });
  }

  function aim() {
    const live = targets.filter((e) => !dealtWith(e) && !e.escaped);
    const pool = live.length ? live : targets;
    centre[0] = centre[1] = centre[2] = 0;
    for (const e of pool) { centre[0] += e.x; centre[1] += e.y; centre[2] += e.z; }
    const n = Math.max(1, pool.length);
    centre[0] /= n; centre[1] /= n; centre[2] /= n;
    return centre;
  }

  function shot(s) {
    return { spec: s, position: camPos, target: camTarget, fovDeg: s.fov ?? 12 };
  }

  // The spotter drone hovers: the camera eases round the look point and keeps the group in frame.
  function moveCamera() {
    const c = m.cutscene;
    if (!c) return;
    const s = c.spec;
    const look = s.look === 'targets' || !s.look ? aim() : s.look;
    const b = (s.bearing ?? 0) + clock * (s.drift ?? 0.01);
    camTarget[0] = look[0]; camTarget[1] = look[1] + (s.lift ?? 1.0); camTarget[2] = look[2];
    camPos[0] = look[0] + Math.sin(b) * (s.range ?? 300);
    camPos[2] = look[2] + Math.cos(b) * (s.range ?? 300);
    camPos[1] = Math.max(look[1], level.terrain.heightAt(camPos[0], camPos[2])) + (s.height ?? 120);
  }

  // Between briefings his drone circles over the targets of the mission (or the enemy line).
  let orbit = 0;
  function spotterView(dt) {
    const sp = m.spotter;
    if (m.cutscene) {
      for (let i = 0; i < 3; i++) { sp.position[i] = m.cutscene.position[i]; sp.target[i] = m.cutscene.target[i]; }
      sp.fovDeg = m.cutscene.fovDeg;
      return;
    }
    orbit += dt * 0.02;
    const live = targets.some((e) => !e.destroyed) && m.phase !== 'done';
    const rest = level.spotterRest ?? [0, -130];
    const look = live ? aim() : [rest[0], level.terrain.heightAt(rest[0], rest[1]), rest[1]];
    const R = 330, b = 0.2 + Math.sin(orbit) * 0.5;
    sp.target[0] = look[0]; sp.target[1] = look[1] + 1; sp.target[2] = look[2];
    sp.position[0] = look[0] + Math.sin(b) * R;
    sp.position[2] = look[2] + Math.cos(b) * R;
    sp.position[1] = Math.max(look[1], level.terrain.heightAt(sp.position[0], sp.position[2])) + 130;
    sp.fovDeg = live ? 11 : 16;
  }

  // Compass bearing (0 = north = −Z, 90 = east = +X) and range from one point to another.
  const home = level.home ? [level.home.x, level.home.z] : level.start ? [level.start.position[0], level.start.position[2]] : [0, 0];
  const CARD = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  function fix(out, from, to) {
    const dx = to[0] - from[0], dz = to[2] - from[1];
    out.deg = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
    out.m = Math.hypot(dx, dz);
    return out;
  }
  const brg = (deg) => String(Math.round(deg) % 360).padStart(3, '0');
  const roundRange = (r) => r < 200 ? Math.round(r / 10) * 10 : r < 1000 ? Math.round(r / 50) * 50 : Math.round(r / 100) * 100;
  const fromHome = { deg: 0, m: 0 }, fromDrone = { deg: 0, m: 0 };
  function track() {
    const live = targets.filter((e) => !dealtWith(e) && !e.escaped);
    if (!targets.length || (!live.length && m.phase === 'active')) { m.bearing = null; return; }
    const c = aim();
    fix(fromHome, home, c);
    const d = state.drone;
    const flying = state.mode !== 'foot' && d && !d.destroyed && !d.crashed;
    if (flying) fix(fromDrone, [d.position[0], d.position[2]], c);
    let vx = 0, vz = 0;
    for (const e of live) { vx += e.s.velocity[0]; vz += e.s.velocity[2]; }
    const n = Math.max(1, live.length);
    const moving = Math.hypot(vx / n, vz / n) > 3 ? CARD[Math.round(((Math.atan2(vx, -vz) * 180 / Math.PI + 360) % 360) / 45) % 8] : null;
    m.bearing = { fromHome, fromDrone: flying ? fromDrone : null, moving };
  }

  // On the radio while you fly: where they are from you. More often when they are moving.
  let callT = 0, callEnds = 0, called = 0;
  function callouts(dt) {
    if (m.phase !== 'active') { callT = 0; called = 0; return; }
    callT += dt;
    if (m.line && callT >= callEnds) m.line = null;
    const b = m.bearing?.fromDrone;
    if (!b || m.line) return;
    const every = called === 0 ? 5 : m.bearing.moving ? 14 : 22;
    if (callT < every) return;
    if (b.m < 60) return; // he can see you're on them
    const deg = brg(b.deg), r = roundRange(b.m), mv = m.bearing.moving;
    const lines = b.m < 200
      ? [`Close now. ${deg}, ${r} metres.`, `${r} metres, bearing ${deg}. Look down.`]
      : mv
        ? [`They're bearing ${deg} from you, ${r} metres, heading ${mv}.`, `${deg}, ${r} out. Still going ${mv}.`]
        : [`They're bearing ${deg} from you, ${r} metres.`, `From you: ${deg}, about ${r}.`];
    const text = lines[called % lines.length];
    called++; callT = 0;
    m.line = text; m.lineId++;
    callEnds = Math.max(2.8, text.length * 0.065);
    emit({ type: 'mission_line', speaker: SPEAKER, text, lineId: m.lineId, radio: true });
  }

  function dealtWith(e) {
    if (e.destroyed) return true;
    if (e.def.vehicle) return !e.v.operational || e.v.abandoned;
    return e.cond === 'down' || e.cond === 'crawling' || e.cond === 'dead';
  }

  function update(dt) {
    if (index < 0) { start(0); }
    clock += dt;
    if (m.phase === 'active') {
      m.done = targets.filter(dealtWith).length;
      m.escaped = targets.filter((e) => e.escaped && !dealtWith(e)).length;
      if (m.done + m.escaped >= m.total) {
        m.phase = 'outro';
        const def = list[index];
        failed = m.escaped > 0;
        emit({ type: 'mission', id: m.id, phase: failed ? 'failed' : 'complete', title: m.title, done: m.done, escaped: m.escaped });
        run((m.escaped === 0 ? def.outro : m.done === 0 ? def.outroFailed ?? def.outroPartial : def.outroPartial) ?? def.outro ?? []);
      }
    }
    if (m.phase === 'intro' || m.phase === 'outro') {
      if (lineEnds >= 0 && clock >= lineEnds) {
        lineEnds = -1; m.line = null; step++;
        if (!script[step]?.shot) m.cutscene = null; // stay on the feed between two shots
        waiting = script[step]?.after ?? 0.4;
        clock = 0;
      }
      if (lineEnds < 0) {
        if (step >= script.length) finishScript();
        else if (clock >= waiting) { clock = 0; say(script[step]); }
      }
    }
    track();
    callouts(dt);
    moveCamera();
    spotterView(dt);
  }

  function finishScript() {
    m.line = null; m.cutscene = null;
    if (m.phase === 'intro') { m.phase = 'active'; emit({ type: 'mission', id: m.id, phase: 'active', title: m.title }); }
    else if (m.phase === 'outro' && failed) { entities.resetUnits(targets); start(index, true); }
    else if (m.phase === 'outro') start(index + 1);
  }

  // Interact during the briefing skips it.
  function skip() {
    if (m.phase !== 'intro' || (!m.line && step === 0)) return false;
    finishScript();
    return true;
  }

  // Key 7: on to the next mission straight away (whatever is left of this one stays where it is).
  function next() {
    if (index < 0 || index >= list.length) return;
    emit({ type: 'mission', id: m.id, phase: 'skipped', title: m.title });
    start(index + 1);
  }

  function reset() { index = -1; m.phase = 'none'; m.line = null; m.cutscene = null; }

  return { update, skip, reset, next };
}
