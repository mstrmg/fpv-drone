// The campaign map: about 3 km of front line. You start on foot in a netted dugout on our side
// (south), next to the antenna mast; the enemy holds the north. North is −Z.
//
//   z ≈ +1050  our rear: a ruined hamlet, supply track, healthy tree lines
//   z ≈  +700  our dugout (player start), the mast, a few more crews' dugouts
//   z ≈  +560  our forward trench line
//   z  +500 .. −100  grey zone: shredded tree lines, craters, an abandoned farm
//   z ≈  −125  enemy first line: trenches along a tree line, dugouts, dug-in armour
//   z ≈  −540  enemy second line
//   z ≈  −820  enemy-held village with a T-90 and transport
//   z ≈  −950  supply road with a convoy; depot to the west at z ≈ −1050
//
// Same Level shape as the demo maps (ARCHITECTURE.md › Level), plus `start`, `linkOrigin`,
// `linkRangeM` and the fortification props (trenches, dugouts, masts).

import { builder } from './demoLevels.js';
import { dugoutRampRect } from './propColliders.js';

const SIZE = 3072;
const PLAYER = { x: 40, z: 700 }; // centre of the player's dugout

export function createCampaignLevel() {
  const m = builder('Campaign', 58, { size: SIZE, segments: 512, pad: [PLAYER.x, PLAYER.z, 22, 80], relief: 0.75 });
  const { rand, H, props } = m;
  const R = (a, b) => a + rand() * (b - a);

  // ---- Helpers -------------------------------------------------------------------------------

  // Zig-zag fire trench along a rough line: bays every ~9 m stepped ±2.5 m, so a blast in one bay
  // doesn't sweep the whole line. Points carry ground height.
  function trench(pts, { zig = 2.5, bay = 9, width = 1.1 } = {}) {
    const out = [];
    let flip = 1;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
      const len = Math.hypot(x1 - x0, z1 - z0), dx = (x1 - x0) / len, dz = (z1 - z0) / len;
      const n = Math.max(1, Math.round(len / bay));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        const off = zig ? flip * zig : 0;
        flip = -flip;
        const x = x0 + (x1 - x0) * t - dz * off, z = z0 + (z1 - z0) * t + dx * off;
        out.push([x, H(x, z), z]);
      }
    }
    const [xe, ze] = pts[pts.length - 1];
    out.push([xe, H(xe, ze), ze]);
    props.trenches.push({ points: out, width });
    return out;
  }
  // A long trench line with breaks in it (destroyed stretches, gaps between company positions).
  function trenchLine(x0, x1, z, wobble, segLen = [140, 320], gap = [30, 90]) {
    let x = x0;
    while (x < x1) {
      const L = R(...segLen), end = Math.min(x1, x + L);
      const pts = [];
      for (let xx = x; xx <= end; xx += 40) pts.push([xx, z + Math.sin(xx / 97) * wobble + R(-4, 4)]);
      if (pts.length >= 2) trench(pts);
      x = end + R(...gap);
    }
  }
  // Communication trench: no bays, gently winding.
  function commTrench(a, b) {
    const pts = [];
    const n = Math.max(2, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 25));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push([a[0] + (b[0] - a[0]) * t + (i && i < n ? R(-5, 5) : 0), a[1] + (b[1] - a[1]) * t]);
    }
    trench(pts, { zig: 0, width: 0.9 });
  }
  // Log-and-earth dugout under a camo net. `yaw` = direction the front wall faces (0 = north, −Z).
  function dugout(x, z, yaw = 0, opts = {}) {
    const d = { x, y: H(x, z), z, yaw, w: 3.2, d: 3.6, h: 1.95, net: true, collapsed: false, ...opts };
    props.dugouts.push(d);
    if (d.collapsed) m.crater(x + R(-1, 1), z + R(-1, 1), R(2.2, 3.2), false); // the hit that caved it in
    return d;
  }
  function mast(x, z, height = 7.5) { props.masts.push({ x, y: H(x, z), z, height }); }
  function shreddedLine(x0, x1, z, slope = 0, spacing = 13, keep = 0.7) {
    for (let x = x0; x < x1; x += spacing * R(0.6, 1.4)) {
      if (rand() > keep) continue;
      const zz = z + (x - x0) * slope + R(-4, 4);
      // Shelled: short, thin crowns; a few nearly bare stumps.
      const stump = rand() < 0.3;
      m.tree(x, zz, stump ? R(3, 5) : R(6, 11), stump ? R(0.8, 1.3) : R(1.6, 2.8));
    }
  }
  function treeLine(x0, z0, x1, z1, spacing = 8, gapEvery = 0.08) {
    const gaps = [];
    const len = Math.hypot(x1 - x0, z1 - z0);
    for (let d = 0; d < len; d += 60) if (rand() < gapEvery * 6) gaps.push([x0 + (x1 - x0) * d / len, z0 + (z1 - z0) * d / len, R(6, 16)]);
    m.treeLine([x0, z0], [x1, z1], spacing, gaps);
  }
  function craterField(x0, x1, z0, z1, n, rMin = 1.2, rMax = 3.4) {
    for (let i = 0; i < n; i++) m.crater(R(x0, x1), R(z0, z1), R(rMin, rMax));
  }
  const squad = (x, z, yaw, variants, spread = 6) =>
    variants.forEach((v) => m.enemy('infantry', v, x + R(-spread, spread), z + R(-spread / 2, spread / 2), { yaw: yaw + R(-0.4, 0.4) }));

  // ---- Lanes and roads -----------------------------------------------------------------------

  props.lanes.push(
    [[-1536, 1000], [-300, 1010], [400, 990], [1536, 1005]],                  // our rear road
    [[-100, 1536], [-100, 1000], [-60, 820], [10, 730], [60, 640]],            // supply track to the line
    [[-1536, -950], [-200, -940], [600, -960], [1536, -950]],                  // enemy supply road
    [[500, -1536], [520, -960], [500, -820], [470, -560], [420, -200]],        // road through the village to the front
    [[-600, -1050], [-560, -950]],                                             // depot spur
    [[-480, 1536], [-470, 1100], [-500, 700], [-460, 300], [-490, -100], [-470, -520], [-520, -1000], [-480, -1536]], // old N-S field road through the line
    [[780, 1536], [790, 1000], [760, 560], [800, 150], [770, -200], [740, -420]],
    [[-1536, 300], [-900, 290], [-300, 312], [300, 295], [900, 305], [1536, 300]],  // grey-zone track, cratered
    [[-1536, -320], [-700, -330], [0, -312], [600, -325], [1100, -320], [1536, -310]], // enemy lateral road behind the first line
    [[-1536, -700], [-800, -690], [0, -710], [470, -760]],                        // to the village
    [[500, -820], [200, -900], [-200, -1000], [-560, -1040]],                     // village to depot
    [[520, -960], [700, -1200], [900, -1536]],
    [[-1200, 1300], [-900, 1050], [-650, 800], [-480, 600]],                      // our track to the left flank
    [[300, 1536], [260, 1200], [320, 880], [260, 640]],                           // aid post track
  );
  // propLayout-style lanes are 2-point segments; split the polylines.
  props.lanes = props.lanes.flatMap((pl) => pl.slice(1).map((p, i) => [pl[i], p]));
  m.poles([-1536, 1000], [1536, 1005], 40, 9);
  m.poles([-1536, -950], [1536, -950], 40, 22);
  m.poles([500, -1536], [520, -960], 40, -1);
  m.poles([-1536, -320], [1536, -315], 42, 31);

  // ---- Tree lines ----------------------------------------------------------------------------

  treeLine(-1500, 840, 1500, 815, 8);            // our rear windbreak, healthy
  treeLine(-1500, 1250, 600, 1270, 9);
  treeLine(-820, 1500, -800, 860, 9);
  shreddedLine(-1500, 1500, 470, -0.01);        // grey zone, shelled
  shreddedLine(-1500, 1500, 160, 0.008, 15, 0.55);
  shreddedLine(-1300, 1400, -140, 0.004, 10, 0.8); // enemy first line sits along this one
  treeLine(-1500, -520, 1500, -535, 9);
  treeLine(-1500, -1250, 1500, -1240, 8);
  treeLine(980, 900, 990, -600, 10);
  treeLine(-1150, -300, -1160, -1500, 10);

  // ---- Our side ------------------------------------------------------------------------------

  // The player's dugout: front faces north. Mast to the east, launch spot behind the entrance.
  // Dug 2.2 m into the ground; the ramp down to its door is a hole in the terrain.
  const home = dugout(PLAYER.x, PLAYER.z, 0, { player: true, depth: 2.2 });
  const [rx0, rz0, rx1, rz1] = dugoutRampRect(home); // yaw 0: local axes = world axes
  const terrainHoles = [[home.x + rx0, home.z + rz0, home.x + rx1, home.z + rz1]];
  const mastPos = [PLAYER.x + 5.2, PLAYER.z + 2.4];
  mast(...mastPos, 8);
  const launch = [PLAYER.x - 1.2, PLAYER.z + 6.8];
  m.crater(PLAYER.x - 22, PLAYER.z - 15, 2.2, false);
  m.crater(PLAYER.x + 30, PLAYER.z + 18, 1.8, true);
  commTrench([PLAYER.x + 3, PLAYER.z - 8], [PLAYER.x + 18, 565]);

  // Neighbouring crews and positions.
  dugout(-180, 640, 0.1); mast(-176, 644, 6.5);
  dugout(-210, 652, -0.2, { w: 2.8, d: 3.2 });
  dugout(260, 610, -0.05);
  dugout(-520, 600, 0.15, { collapsed: true, net: false });
  dugout(600, 660, 0); mast(605, 663, 7);
  dugout(900, 720, -0.3);
  dugout(-950, 700, 0.2, { collapsed: true });
  dugout(-420, 900, 0.5);
  dugout(320, 880, -0.4, { w: 4.2, d: 5 }); // battalion aid post under a bigger net
  commTrench([-180, 630], [-170, 562]);
  commTrench([600, 650], [610, 566]);

  // Our forward trench line.
  trenchLine(-1100, 1100, 560, 9);
  for (const x of [-860, -430, -60, 310, 700]) m.sandbags(x, 557, Math.PI, 1.7, 1.4);
  craterField(-1300, 1300, 520, 760, 26);

  // Rear: ruined hamlet on the road, bales and a few craters.
  const HX = -650, HZ = 1050;
  for (const [dx, dz, w, h, d, r] of [[-30, -22, 9, 4.2, 7, 0.04], [5, -24, 8, 3.8, 7, -0.03], [40, -20, 10, 4.5, 7, 0.02],
    [-20, 22, 8, 4, 6.5, 0.05], [25, 24, 12, 5, 8, -0.02], [60, 26, 5, 2.8, 4, 0.1]]) {
    const b = m.building(HX + dx, HZ + dz, w, h, d, r);
    if (rand() < 0.6) m.fence(b);
  }
  m.bales(-200, 1150, 8);
  m.bales(700, 1120, 6, true);
  craterField(-1400, 1400, 900, 1450, 18);

  // ---- Grey zone -----------------------------------------------------------------------------

  craterField(-1450, 1450, -90, 520, 190, 1.4, 4.2);
  craterField(-200, 300, 300, 500, 30, 1.2, 3); // the stretch in front of us took a pounding
  // Abandoned farm with a smashed barn.
  const FX = -300, FZ = 250;
  m.fence(m.building(FX, FZ, 9, 3.6, 7, 0.1));
  m.building(FX + 26, FZ + 6, 16, 5, 9, 0.08);
  m.building(FX - 14, FZ + 22, 4, 2.4, 3.5, 0.2);
  m.bales(FX + 40, FZ - 20, 5);
  // Old forward positions, half filled in.
  trench([[-700, 330], [-640, 335], [-600, 322]]);
  trench([[200, 120], [260, 112], [300, 118]]);
  dugout(-650, 325, 0.3, { collapsed: true, net: false });
  dugout(250, 105, Math.PI, { collapsed: true });

  // ---- Mission 1: a squad digging in along the shelled tree line at z ≈ 160 ----------------------

  // Five men spread along the south edge of the trees. They work and walk about their stretch,
  // and when a drone turns up they drop flat and shift position but stay put (hold: true).
  {
    const MZ = 168;
    trench([[40, MZ + 2], [80, MZ - 1], [120, MZ + 1]], { zig: 2, bay: 7 });
    m.sandbags(64, MZ + 3, Math.PI, 1.6, 1.2);
    m.sandbags(112, MZ + 3, Math.PI, 1.6, 1.2);
    for (const [x, z] of [[58, MZ - 6], [98, MZ - 7], [132, MZ - 5]]) m.tree(x, z, R(7, 10), R(1.8, 2.6));
    const squadM1 = [
      ['rifleman', [[45, MZ + 1], [70, MZ + 2], [62, MZ - 2]], 5],
      ['mg', [[64, MZ + 4], [72, MZ + 5]], 9],
      ['rifleman', [[85, MZ], [104, MZ - 2], [95, MZ + 3]], 4],
      ['rpg', [[112, MZ + 4], [120, MZ + 1], [108, MZ - 1]], 7],
      ['officer', [[78, MZ - 4], [118, MZ - 3]], 6],
    ];
    for (const [variant, patrol, idleTime] of squadM1) {
      m.enemy('infantry', variant, patrol[0][0], patrol[0][1], { patrol, idleTime, yaw: Math.PI, hold: true, mission: 'treeline' });
    }
  }

  // ---- Enemy first line (z ≈ −125) ---------------------------------------------------------

  trenchLine(-1000, 900, -122, 7, [160, 360], [25, 70]);
  const firstDugouts = [[-600, -150], [-250, -160], [120, -155], [450, -150], [720, -168], [-880, -148]];
  firstDugouts.forEach(([x, z], i) => dugout(x, z, Math.PI + R(-0.2, 0.2), { collapsed: i === 2 }));
  commTrench([-250, -130], [-240, -500]);
  commTrench([450, -130], [470, -500]);
  for (const x of [-760, -420, -90, 260, 580]) m.sandbags(x, -118, 0, 1.7, 1.4);
  // Squads in the trenches facing south, a few up and about.
  squad(-760, -121, Math.PI, ['mg', 'rifleman']);
  squad(-420, -122, Math.PI, ['rifleman', 'rpg', 'rifleman']);
  squad(-90, -121, Math.PI, ['mg', 'rifleman']);
  squad(260, -123, Math.PI, ['rifleman', 'rifleman']);
  squad(580, -120, Math.PI, ['rpg', 'mg']);
  m.enemy('infantry', 'officer', -250, -150, { patrol: [[-250, -150], [-250, -128], [-180, -126]], idleTime: 6 });
  m.enemy('infantry', 'rifleman', 450, -142, { patrol: [[450, -142], [470, -300], [450, -142]], idleTime: 8 });
  m.enemy('apc', 'bmp', -60, -152, { yaw: Math.PI });          // dug in behind the trench
  m.enemy('tank', 't72', 300, -158, { yaw: Math.PI * 1.05 });  // hiding in the tree line
  m.enemy('apc', 'mtlb', 650, -200, { yaw: Math.PI / 2, riders: ['rifleman', 'rifleman'] });
  // Behind the first line: quads and pickups running ammo along the lateral road, troops on top.
  m.enemy('light', 'atv', -700, -318, { patrol: [[-700, -318], [600, -320], [600, -330], [-700, -326]], yaw: -Math.PI / 2 });
  m.enemy('light', 'atv', 450, -480, { patrol: [[450, -480], [455, -170], [450, -480]], yaw: 0 });
  m.enemy('light', 'pickup', 300, -322, { patrol: [[300, -322], [-900, -328], [-900, -336], [300, -330]], yaw: Math.PI / 2, riders: ['rifleman', 'mg', 'rifleman'] });
  m.enemy('light', 'technical', -300, -330, { yaw: -Math.PI / 2, riders: ['rifleman', 'rifleman'] });
  craterField(-1100, 1000, -200, -100, 40, 1.4, 3.6);

  // ---- Enemy second line (z ≈ −540) --------------------------------------------------------

  trench([[-420, -548], [-300, -556], [-160, -545], [-40, -552]]);
  trench([[150, -560], [260, -552], [380, -560]]);
  dugout(-300, -575, Math.PI + 0.1); mast(-294, -580, 6);
  dugout(270, -578, Math.PI - 0.1);
  dugout(-60, -600, Math.PI);
  squad(-300, -560, Math.PI, ['rifleman', 'rifleman', 'mg']);
  squad(270, -566, Math.PI, ['rifleman', 'rpg']);
  m.enemy('light', 'uaz', 470, -540, { patrol: [[470, -540], [500, -820], [470, -540]], yaw: 0 });

  // ---- Village (enemy rear) ----------------------------------------------------------------

  const VX = 500, VZ = -820;
  for (let row = -1; row <= 1; row++) {
    for (let k = 0; k < 6; k++) {
      if (rand() < 0.2) continue;
      const side = k % 2 ? 1 : -1;
      const x = VX + side * R(22, 30) + row * 4, z = VZ + row * 45 + (k >> 1) * 15 - 15;
      const b = m.building(x, z, R(7, 10), R(3.6, 5), R(6, 8), R(-0.06, 0.06));
      if (rand() < 0.5) m.fence(b);
    }
  }
  m.building(VX + 60, VZ - 10, 20, 7, 11, 0.03); // collective farm shed
  for (let i = 0; i < 10; i++) m.tree(VX + R(-80, 80), VZ + R(-80, 80), R(8, 14), R(2.6, 3.8));
  m.enemy('tank', 't90', VX + 60, VZ + 12, { yaw: Math.PI });
  m.enemy('light', 'technical', VX - 4, VZ - 40, { patrol: [[VX - 4, VZ - 40], [VX + 2, VZ + 60]], yaw: Math.PI });
  m.enemy('truck', 'ural', VX + 40, VZ - 30, { yaw: Math.PI / 2 });
  m.enemy('apc', 'btr', VX - 40, VZ + 30, { yaw: 0.2, riders: ['rifleman', 'rifleman', 'rpg', 'rifleman'] });
  m.enemy('light', 'atv', VX + 5, VZ + 80, { patrol: [[VX + 5, VZ + 80], [VX + 15, VZ - 130], [VX - 280, VZ - 80]], yaw: 0 });
  m.enemy('light', 'pickup', VX - 30, VZ - 60, { yaw: 1.2, riders: ['rifleman', 'rifleman'] });
  squad(VX + 10, VZ, 0, ['officer', 'rifleman', 'rifleman']);
  squad(VX + 55, VZ + 20, Math.PI, ['crew', 'crew']);
  m.enemy('infantry', 'rifleman', VX - 20, VZ - 20, { patrol: [[VX - 20, VZ - 20], [VX - 20, VZ + 40], [VX + 30, VZ + 40]], idleTime: 5 });

  // ---- Supply road and depot ---------------------------------------------------------------

  const road = [[-1300, -950], [1300, -950], [1300, -962], [-1300, -962]];
  m.enemy('truck', 'kamaz', -1000, -950, { patrol: road, yaw: -Math.PI / 2 });
  m.enemy('truck', 'ural', -1040, -950, { patrol: road, yaw: -Math.PI / 2 });
  m.enemy('light', 'uaz', -1070, -950, { patrol: road, yaw: -Math.PI / 2 });
  m.enemy('apc', 'btr', 900, -962, { patrol: [[900, -962], [-900, -962], [-900, -950], [900, -950]], yaw: Math.PI / 2, riders: ['rifleman', 'mg', 'rifleman'] });
  m.enemy('light', 'uaz', -1100, -950, { patrol: road, yaw: -Math.PI / 2, riders: ['rifleman'] });
  m.enemy('light', 'atv', -300, -700, { patrol: [[-300, -700], [-1200, -690], [-300, -706]], yaw: -Math.PI / 2 });
  const DX = -600, DZ = -1060;
  m.enemy('truck', 'fuel', DX - 12, DZ, { yaw: 0.1 });
  m.enemy('truck', 'fuel', DX + 2, DZ + 3, { yaw: 0.1 });
  m.enemy('truck', 'kamaz', DX + 18, DZ - 4, { yaw: 0.05 });
  m.enemy('apc', 'mtlb', DX - 30, DZ - 20, { yaw: 1.4, riders: ['rifleman', 'rifleman', 'officer'] });
  m.enemy('light', 'atv', DX + 20, DZ + 40, { yaw: 2.2 });
  squad(DX, DZ + 14, 0, ['rifleman', 'rifleman', 'officer']);
  dugout(DX + 30, DZ + 20, 0.4); dugout(DX - 40, DZ + 25, -0.3);
  for (const [x, z] of [[DX - 5, DZ + 30], [DX + 40, DZ - 20]]) m.sandbags(x, z, 0);
  m.bales(DX + 60, DZ + 40, 6, true);
  craterField(-1400, 1400, -1450, -200, 45);

  // ---- Mission 2: three bikes running the lateral road behind their line ----------------------
  // A bike and two quads, nose to tail at 50-60 km/h, west to east. Parked at the far end of the
  // road until the mission starts; past the last point they have got away (about two minutes).
  const RUN = [[-700, -330], [0, -312], [600, -325], [1100, -320], [1460, -312]];
  [['moto', -950, 15.8], ['atv', -975, 15.3], ['atv', -1000, 15.3]].forEach(([variant, x, speed]) => {
    const z = -320 - 10 * (x + 1536) / 836;
    m.enemy('light', variant, x, z, { patrol: [[x, z], ...RUN], speed, route: true, waitFor: 'convoy', mission: 'convoy', yaw: -Math.PI / 2 });
  });

  // ---- Missions ---------------------------------------------------------------------------------

  const missions = [{
    id: 'treeline',
    title: 'Treeline',
    objective: 'Take out the squad digging in along the treeline north of us',
    intro: [
      { after: 3, say: 'Hey. Hey, come here. Look what I got here.', dur: 3.2 },
      { say: 'Shelled treeline, bearing {brg} from us. {rng} metres.', dur: 5,
        shot: { look: 'targets', range: 420, height: 160, bearing: 0.15, fov: 9, drift: 0.008 } },
      { say: 'Five of them. Riflemen, a machine gunner with the PK, that one has an RPG... and the officer walking about.', dur: 7,
        shot: { look: 'targets', range: 230, height: 90, bearing: -0.35, fov: 15, drift: 0.012 } },
      { say: 'They\'re digging in. Not going anywhere. Go get them.', dur: 4,
        shot: { look: 'targets', range: 150, height: 70, bearing: 0.5, fov: 9, drift: 0.01 } },
      { after: 0.5, say: 'Goggles are on the table. I\'ll call bearings on the radio.', dur: 4 },
    ],
    outro: [
      { after: 1.5, say: 'Good hits. That\'s the treeline clear.', dur: 4 },
    ],
  }, {
    id: 'convoy',
    title: 'Road runners',
    objective: 'Hit the bike and the two quads on the road before they get away',
    intro: [
      { after: 6, say: 'Wait. Wait, look. Movement on their road.', dur: 3.2,
        shot: { look: 'targets', range: 520, height: 200, bearing: 0.9, fov: 10, drift: 0.004 } },
      { say: 'A bike and two quads, flat out. Fifty, sixty kilometres an hour.', dur: 5,
        shot: { look: 'targets', range: 260, height: 110, bearing: 1.3, fov: 9, drift: 0.004 } },
      { say: 'The road behind their first line. Bearing {brg}, {rng} metres, going {dir}. They\'ll be gone in a couple of minutes.', dur: 5.5,
        shot: { look: 'targets', range: 380, height: 160, bearing: 0.6, fov: 14, drift: 0.004 } },
      { say: 'Get up there. Fast. I\'ll call them for you.', dur: 3.2 },
    ],
    outro: [
      { after: 1.5, say: 'All three. Nice flying.', dur: 3.5 },
    ],
    outroPartial: [
      { after: 1.5, say: 'Some got through. Damn.', dur: 3 },
    ],
    outroFailed: [
      { after: 1.5, say: 'They\'re gone. Too fast for us.', dur: 3.5 },
    ],
    retry: [
      { after: 5, say: 'Hold on... more of them. Same road, bearing {brg}, {rng} metres.', dur: 4,
        shot: { look: 'targets', range: 400, height: 160, bearing: 0.9, fov: 11, drift: 0.004 } },
      { say: 'Don\'t let these ones go.', dur: 2.5 },
    ],
  }];

  // ---- Finish ---------------------------------------------------------------------------------

  const level = m.finish(launch[0], launch[1], 0);
  level.blurb = 'Campaign';
  // On foot inside the dugout, behind the table, facing the front wall.
  level.start = { mode: 'foot', position: [PLAYER.x + 0.55, home.y - home.depth, PLAYER.z + 0.7], yaw: 0.15 };
  level.terrainHoles = terrainHoles;
  level.home = home;  // the dugout the player starts in (also in props.dugouts with player: true)
  // The video link is measured from the antenna at the top of the mast, not from the launch spot.
  level.linkOrigin = [mastPos[0], H(...mastPos) + 8, mastPos[1]];
  level.linkRangeM = 2600;
  level.missions = missions;
  return level;
}
