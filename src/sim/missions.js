// Campaign missions. The other soldier in the dugout flies the spotter drone: at the start of a
// mission he calls you over, and his spotter feed shows the targets (what they are and where) while
// he talks. Nothing is marked on the map: you find them again yourself.
//
// level.missions = [{
//   id, title, objective,                      // objective: one line for the HUD
//   intro: [{ say, after?, dur?, shot? }],     // lines in order; `after` s of silence first; `dur` s on screen
//   outro: [{ say, after?, dur? }],
// }]
// A shot is the spotter camera while that line plays: { look: 'targets' | [x,y,z], range, height, bearing, fov }
// (camera `range` m from the look point, `height` m above it, from `bearing` rad: 0 = from the south).
// Targets are the level enemies whose def has `mission: <id>`. A target counts as dealt with once it
// is dead or can no longer fight (down / crawling, or a knocked-out vehicle).

const SPEAKER = 'SASHA';

export function createMissions({ level, entities, state, emit }) {
  const list = level.missions ?? [];
  const m = {
    id: null, title: null, objective: null, phase: 'none',   // 'intro' | 'active' | 'outro' | 'done' | 'none'
    done: 0, total: 0,
    speaker: SPEAKER, line: null, lineId: 0,                 // the subtitle on screen now; lineId changes per line
    cutscene: null,                                          // spotter camera { position, target, fovDeg } while briefing
  };
  state.mission = list.length ? m : null;
  if (!list.length) return { update() {}, skip() { return false; }, reset() {} };

  let index = -1, script = [], step = 0, clock = 0, lineEnds = 0, waiting = 0;
  let targets = [];
  const centre = [0, 0, 0];
  const camPos = [0, 0, 0], camTarget = [0, 0, 0];

  function start(i) {
    index = i;
    const def = list[i];
    if (!def) { m.phase = 'done'; m.line = null; m.cutscene = null; return; }
    m.id = def.id; m.title = def.title; m.objective = def.objective;
    targets = entities.list.filter((e) => e.tag === def.id);
    m.total = targets.length; m.done = 0;
    m.phase = 'intro';
    run(def.intro ?? []);
    emit({ type: 'mission', id: def.id, phase: 'intro', title: def.title });
  }

  function run(lines) { script = lines; step = 0; clock = 0; waiting = lines[0]?.after ?? 0; lineEnds = -1; m.line = null; m.cutscene = null; }

  function say(l) {
    m.line = l.say; m.lineId++;
    lineEnds = clock + (l.dur ?? Math.max(2.5, l.say.length * 0.065));
    m.cutscene = l.shot ? shot(l.shot) : null;
    emit({ type: 'mission_line', speaker: SPEAKER, text: l.say, lineId: m.lineId });
  }

  function aim() {
    const live = targets.filter((e) => !e.destroyed);
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
      if (m.done >= m.total) {
        m.phase = 'outro';
        emit({ type: 'mission', id: m.id, phase: 'complete', title: m.title });
        run(list[index].outro ?? []);
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
    moveCamera();
  }

  function finishScript() {
    m.line = null; m.cutscene = null;
    if (m.phase === 'intro') { m.phase = 'active'; emit({ type: 'mission', id: m.id, phase: 'active', title: m.title }); }
    else if (m.phase === 'outro') start(index + 1);
  }

  // Interact during the briefing skips it.
  function skip() {
    if (m.phase !== 'intro' || (!m.line && step === 0)) return false;
    finishScript();
    return true;
  }

  function reset() { index = -1; m.phase = 'none'; m.line = null; m.cutscene = null; }

  return { update, skip, reset };
}
