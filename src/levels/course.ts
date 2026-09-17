/**
 * Fooze n Froops — curated 9-hole championship course.
 * Fixed order for solo + multiplayer. Templates stay expandable later.
 */
import type {
  Bumper,
  CourseProp,
  GrassPattern,
  GreenTopo,
  HoleDef,
  Ramp,
  Vec2,
  Wall,
  Zone,
} from '../types';
import type { HoleThemeId } from './themes';

export const ROUND_HOLES = 9;
/** Kept for UI compatibility — play uses the curated 9, not a large pool. */
export const POOL_SIZE = 9;
export const WIND_MAX_MPH = 25;
/** World px → display feet (mini-golf scale). */
export const PX_TO_FEET = 0.14;

const CUP_R = 16;

function wall(x: number, y: number, w: number, h: number): Wall {
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

function zone(
  cx: number,
  cy: number,
  w: number,
  h: number,
  kind: Zone['kind'],
): Zone {
  const frictionMul = kind === 'ice' ? 0.4 : kind === 'sand' ? 2.4 : 1;
  return {
    x: Math.round(cx - w / 2),
    y: Math.round(cy - h / 2),
    w: Math.round(w),
    h: Math.round(h),
    frictionMul,
    kind,
  };
}

function carpet(angle = 0): GrassPattern {
  return {
    kind: 'carpet',
    width: 18,
    angle,
    a: '#2f9b56',
    b: '#288a4b',
    sheen: '#3aad62',
  };
}

function pathLen(pts: Vec2[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) {
    L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return L;
}

function feetFromPath(tee: Vec2, via: Vec2[], cup: Vec2): number {
  return Math.max(18, Math.round(pathLen([tee, ...via, cup]) * PX_TO_FEET));
}

function topo(
  tiltX: number,
  tiltY: number,
  strength: number,
  bumps: GreenTopo['bumps'] = [],
): GreenTopo {
  return {
    tiltX,
    tiltY,
    strength,
    bumps,
  };
}

function slopeFromTopo(t: GreenTopo): Vec2 {
  const dx = -t.tiltX * t.strength;
  const dy = -t.tiltY * t.strength;
  const mag = Math.hypot(dx, dy);
  if (mag < 1e-6) return { x: 0, y: 0 };
  const scale = Math.min(1.25, mag * 1.6);
  return {
    x: Math.round((dx / mag) * scale * 1000) / 1000,
    y: Math.round((dy / mag) * scale * 1000) / 1000,
  };
}

function wind(deg: number, mph: number): { wind: Vec2; windMph: number } {
  const a = (deg * Math.PI) / 180;
  return {
    wind: {
      x: Math.round(Math.cos(a) * 1000) / 1000,
      y: Math.round(Math.sin(a) * 1000) / 1000,
    },
    windMph: Math.max(0, Math.min(WIND_MAX_MPH, mph)),
  };
}

/** Vertical corridor with tee/cup pads. */
function vertLane(cx: number, teeY: number, cupY: number, hw: number, end = 28): Vec2[] {
  const bot = Math.max(teeY, cupY) + end;
  const top = Math.min(teeY, cupY) - end;
  return [
    { x: cx - hw, y: bot },
    { x: cx + hw, y: bot },
    { x: cx + hw, y: top },
    { x: cx - hw, y: top },
  ];
}

/** Classic L dogleg (stem bottom → cross → finish top). */
function lDogleg(
  stemX: number,
  cupX: number,
  teeY: number,
  cornerY: number,
  cupY: number,
  hw: number,
  end = 26,
): Vec2[] {
  const teeBot = teeY + end;
  const cupTop = cupY - end;
  if (cupX >= stemX) {
    return [
      { x: stemX - hw, y: teeBot },
      { x: stemX + hw, y: teeBot },
      { x: stemX + hw, y: cornerY + hw },
      { x: cupX + hw, y: cornerY + hw },
      { x: cupX + hw, y: cupTop },
      { x: cupX - hw, y: cupTop },
      { x: cupX - hw, y: cornerY - hw },
      { x: stemX - hw, y: cornerY - hw },
    ];
  }
  return [
    { x: stemX + hw, y: teeBot },
    { x: stemX - hw, y: teeBot },
    { x: stemX - hw, y: cornerY + hw },
    { x: cupX - hw, y: cornerY + hw },
    { x: cupX - hw, y: cupTop },
    { x: cupX + hw, y: cupTop },
    { x: cupX + hw, y: cornerY - hw },
    { x: stemX + hw, y: cornerY - hw },
  ];
}

/** Island: wide tee pad + narrow bridge + cup island. */
function islandBridge(
  cx: number,
  teeY: number,
  cupY: number,
  startHw: number,
  bridgeHw: number,
  islandHw: number,
  neck0: number,
  neck1: number,
  end = 28,
): Vec2[] {
  const teeBot = teeY + end;
  const cupTop = cupY - end;
  return [
    { x: cx - startHw, y: teeBot },
    { x: cx + startHw, y: teeBot },
    { x: cx + startHw, y: neck0 },
    { x: cx + bridgeHw, y: neck0 },
    { x: cx + bridgeHw, y: neck1 },
    { x: cx + islandHw, y: neck1 },
    { x: cx + islandHw, y: cupTop },
    { x: cx - islandHw, y: cupTop },
    { x: cx - islandHw, y: neck1 },
    { x: cx - bridgeHw, y: neck1 },
    { x: cx - bridgeHw, y: neck0 },
    { x: cx - startHw, y: neck0 },
  ];
}

/** Double-dogleg Z channel. */
function zChannel(
  x0: number,
  x1: number,
  teeY: number,
  yA: number,
  yB: number,
  cupY: number,
  hw: number,
  end = 26,
): Vec2[] {
  const teeBot = teeY + end;
  const cupTop = cupY - end;
  return [
    { x: x0 - hw, y: teeBot },
    { x: x0 + hw, y: teeBot },
    { x: x0 + hw, y: yA + hw },
    { x: x1 + hw, y: yA + hw },
    { x: x1 + hw, y: yB - hw },
    { x: x0 + hw, y: yB - hw },
    { x: x0 + hw, y: cupTop },
    { x: x0 - hw, y: cupTop },
    { x: x0 - hw, y: yB + hw },
    { x: x1 - hw, y: yB + hw },
    { x: x1 - hw, y: yA - hw },
    { x: x0 - hw, y: yA - hw },
  ];
}

function finish( partial: {
  id: number;
  name: string;
  par: number;
  width: number;
  height: number;
  green: Vec2[];
  tee: Vec2;
  cup: Vec2;
  walls?: Wall[];
  bumpers?: Bumper[];
  zones?: Zone[];
  ramps?: Ramp[];
  props?: CourseProp[];
  theme: HoleThemeId;
  grass?: GrassPattern;
  windDeg: number;
  windMph: number;
  topo: GreenTopo;
  pathVia?: Vec2[];
  features?: string[];
}): HoleDef {
  const t = partial.topo;
  const w = wind(partial.windDeg, partial.windMph);
  const lengthFeet = feetFromPath(partial.tee, partial.pathVia ?? [], partial.cup);
  return {
    id: partial.id,
    name: partial.name,
    par: partial.par,
    lengthFeet,
    width: partial.width,
    height: partial.height,
    green: partial.green,
    tee: partial.tee,
    cup: partial.cup,
    cupRadius: CUP_R,
    walls: partial.walls ?? [],
    bumpers: partial.bumpers ?? [],
    zones: partial.zones ?? [],
    ramps: partial.ramps ?? [],
    props: partial.props ?? [],
    theme: partial.theme,
    grass: partial.grass ?? carpet(),
    wind: w.wind,
    windMph: w.windMph,
    topo: t,
    slope: slopeFromTopo(t),
    features: partial.features,
  };
}

// ─── Hole 1 — Par 3 opener ───────────────────────────────────────────────────
function hole1(): HoleDef {
  const W = 520;
  const H = 780;
  const cx = W / 2;
  const teeY = H - 90;
  const cupY = 90;
  const hw = 92;
  const green = vertLane(cx, teeY, cupY, hw);
  const tee = { x: cx, y: teeY };
  const cup = { x: cx + 22, y: cupY };
  // Center gate with side gap — not a free HIO
  const gateY = H * 0.48;
  const gap = 48;
  const gapC = cx + 28;
  const walls = [
    wall(cx - hw + 10, gateY - 11, Math.max(24, gapC - gap / 2 - (cx - hw + 10)), 22),
    wall(gapC + gap / 2, gateY - 11, Math.max(24, cx + hw - 10 - (gapC + gap / 2)), 22),
  ];
  return finish({
    id: 1,
    name: 'Froops Fairway',
    par: 3,
    width: W,
    height: H,
    green,
    tee,
    cup,
    walls,
    bumpers: [{ x: cx - 30, y: gateY - 70, r: 16 }],
    theme: 'tropical',
    windDeg: -40,
    windMph: 6,
    topo: topo(0.35, -0.55, 0.72, [
      { x: 0.55, y: 0.35, amp: 0.4, rx: 0.22, ry: 0.18 },
      { x: 0.35, y: 0.65, amp: -0.3, rx: 0.2, ry: 0.2 },
    ]),
    features: ['opener', 'gate'],
  });
}

// ─── Hole 2 — Par 4 dogleg risk/reward shortcut ──────────────────────────────
function hole2(): HoleDef {
  const W = 640;
  const H = 900;
  const stemX = 180;
  const cupX = 460;
  const teeY = H - 90;
  const cornerY = H * 0.42;
  const cupY = 90;
  const hw = 78;
  const green = lDogleg(stemX, cupX, teeY, cornerY, cupY, hw);
  const tee = { x: stemX, y: teeY };
  const cup = { x: cupX + 12, y: cupY };
  // Corner blocker — safe route around; narrow shortcut gap near inner corner
  const walls = [
    wall(stemX + hw * 0.4, cornerY - 10, 110, 18),
    // Outer nudge wall on finish
    wall(cupX - hw + 8, cupY + 80, 18, 100),
  ];
  // Shortcut: thin sand-lined alley through the corner (risky)
  const zones = [
    zone(stemX + hw + 36, cornerY + 8, 40, 36, 'sand'),
  ];
  return finish({
    id: 2,
    name: 'Dogleg Delight',
    par: 4,
    width: W,
    height: H,
    green,
    tee,
    cup,
    walls,
    bumpers: [{ x: (stemX + cupX) / 2, y: cornerY + 6, r: 17 }],
    zones,
    theme: 'autumn',
    windDeg: 200,
    windMph: 10,
    topo: topo(-0.45, -0.4, 0.78, [
      { x: 0.3, y: 0.55, amp: 0.45, rx: 0.2, ry: 0.25 },
      { x: 0.7, y: 0.3, amp: -0.35, rx: 0.18, ry: 0.18 },
      { x: 0.55, y: 0.7, amp: 0.25, rx: 0.15, ry: 0.15 },
    ]),
    pathVia: [{ x: stemX, y: cornerY }, { x: cupX, y: cornerY }],
    features: ['dogleg', 'shortcut'],
  });
}

// ─── Hole 3 — Par 4 windmill gate ────────────────────────────────────────────
function hole3(): HoleDef {
  const W = 560;
  const H = 880;
  const cx = W / 2;
  const teeY = H - 88;
  const cupY = 95;
  const hw = 100;
  const green = vertLane(cx, teeY, cupY, hw);
  const tee = { x: cx, y: teeY };
  const cup = { x: cx - 18, y: cupY };
  const millY = H * 0.5;
  // Static side rails leave center for the windmill
  const walls = [
    wall(cx - hw + 8, millY + 90, 28, 120),
    wall(cx + hw - 36, millY - 210, 28, 120),
  ];
  const props: CourseProp[] = [
    {
      kind: 'windmill',
      x: cx,
      y: millY,
      r: 22,
      bladeLen: 78,
      rps: 0.22,
      gapHalf: 0.38,
      blades: 4,
    },
  ];
  return finish({
    id: 3,
    name: 'Windmill Whirl',
    par: 4,
    width: W,
    height: H,
    green,
    tee,
    cup,
    walls,
    bumpers: [{ x: cx + 40, y: millY + 110, r: 15 }],
    props,
    theme: 'castle',
    windDeg: 90,
    windMph: 8,
    topo: topo(0.5, -0.35, 0.8, [
      { x: 0.5, y: 0.5, amp: 0.5, rx: 0.28, ry: 0.22 },
      { x: 0.3, y: 0.25, amp: -0.3, rx: 0.16, ry: 0.16 },
    ]),
    features: ['windmill'],
  });
}

// ─── Hole 4 — Par 3 short bank / narrow ──────────────────────────────────────
function hole4(): HoleDef {
  const W = 420;
  const H = 700;
  const cx = W / 2;
  const teeY = H - 80;
  const cupY = 85;
  const hw = 58;
  const green = vertLane(cx, teeY, cupY, hw, 22);
  const tee = { x: cx, y: teeY };
  const cup = { x: cx, y: cupY };
  // Staggered inner rails — bank shots
  const leftX = cx - hw + 6;
  const rightX = cx + hw - 20;
  const walls = [
    wall(leftX, teeY - 160, 16, 90),
    wall(rightX, teeY - 280, 16, 90),
    wall(leftX, teeY - 400, 16, 80),
    wall(cx - hw * 0.7, cupY + 50, hw * 1.4, 14),
  ];
  return finish({
    id: 4,
    name: "Banker's Alley",
    par: 3,
    width: W,
    height: H,
    green,
    tee,
    cup,
    walls,
    theme: 'neon',
    grass: carpet(Math.PI / 2),
    windDeg: 0,
    windMph: 4,
    topo: topo(-0.65, -0.25, 0.88, [
      { x: 0.4, y: 0.45, amp: 0.55, rx: 0.2, ry: 0.3 },
      { x: 0.65, y: 0.6, amp: -0.4, rx: 0.18, ry: 0.2 },
    ]),
    features: ['narrow', 'bank'],
  });
}

// ─── Hole 5 — Par 4 water hazard (~20% of course) ────────────────────────────
function hole5(): HoleDef {
  const W = 600;
  const H = 920;
  const cx = W / 2;
  const teeY = H - 95;
  const cupY = 100;
  const neck0 = H * 0.5;
  const neck1 = H * 0.36;
  const green = islandBridge(cx, teeY, cupY, 120, 46, 100, neck0, neck1);
  const tee = { x: cx, y: teeY };
  const cup = { x: cx + 14, y: cupY };
  const midY = (neck0 + neck1) / 2;
  // Water on the wide tee-pad flanks (still inside green) — miss the bridge and splash
  const zones = [
    zone(cx - 78, (teeY + neck0) * 0.5 + 10, 52, 100, 'water'),
    zone(cx + 78, (teeY + neck0) * 0.5 + 10, 52, 100, 'water'),
    zone(cx, neck0 - 28, 70, 36, 'sand'),
  ];
  // Soft gate before bridge
  const walls = [
    wall(cx - 70, neck0 + 20, 40, 16),
    wall(cx + 30, neck0 + 20, 40, 16),
  ];
  return finish({
    id: 5,
    name: "Pirate's Moat",
    par: 4,
    width: W,
    height: H,
    green,
    tee,
    cup,
    walls,
    zones,
    bumpers: [{ x: cx, y: neck1 - 40, r: 15 }],
    props: [{ kind: 'sign', x: cx + 140, y: teeY - 40, text: 'BRIDGE' }],
    theme: 'pirate',
    windDeg: 160,
    windMph: 12,
    topo: topo(0.25, -0.6, 0.75, [
      { x: 0.5, y: 0.7, amp: 0.3, rx: 0.25, ry: 0.2 },
      { x: 0.45, y: 0.25, amp: -0.4, rx: 0.2, ry: 0.18 },
    ]),
    pathVia: [{ x: cx, y: midY }],
    features: ['water'],
  });
}

// ─── Hole 6 — Par 5 long + jump shortcut ─────────────────────────────────────
function hole6(): HoleDef {
  const W = 700;
  const H = 1040;
  const x0 = 200;
  const x1 = 500;
  const teeY = H - 95;
  const yA = H * 0.62;
  const yB = H * 0.34;
  const cupY = 95;
  const hw = 72;
  const green = zChannel(x0, x1, teeY, yA, yB, cupY, hw);
  const tee = { x: x0, y: teeY };
  const cup = { x: x0 - 10, y: cupY };
  // Water in the middle of the long safe route
  const zones = [
    zone(x1, (yA + yB) / 2, 70, 90, 'water'),
    zone(x0 + 50, (teeY + yA) / 2, 48, 60, 'sand'),
  ];
  // Shortcut ramp: jump from lower arm across water toward upper finish
  const ramp: Ramp = {
    x: x0 + hw - 8,
    y: yA - 30,
    w: 70,
    h: 50,
    dir: { x: 0.15, y: -1 },
    minSpeed: 5.5,
    boost: 1.15,
    gap: 160,
  };
  // Normalize dir
  const dl = Math.hypot(ramp.dir.x, ramp.dir.y) || 1;
  ramp.dir = { x: ramp.dir.x / dl, y: ramp.dir.y / dl };

  const walls = [
    wall(x0 + hw * 0.25, yA - 10, Math.max(50, x1 - x0 - hw), 16),
    wall(x0 + hw * 0.25, yB - 6, Math.max(50, x1 - x0 - hw), 16),
  ];
  return finish({
    id: 6,
    name: 'Canyon Leap',
    par: 5,
    width: W,
    height: H,
    green,
    tee,
    cup,
    walls,
    zones,
    ramps: [ramp],
    bumpers: [{ x: x1 - 20, y: yA - 40, r: 16 }],
    props: [{ kind: 'rock', x: x1 + 90, y: (yA + yB) / 2, r: 22 }],
    theme: 'desert',
    windDeg: -120,
    windMph: 14,
    topo: topo(-0.3, -0.7, 0.85, [
      { x: 0.35, y: 0.6, amp: 0.45, rx: 0.22, ry: 0.2 },
      { x: 0.7, y: 0.4, amp: -0.35, rx: 0.2, ry: 0.22 },
      { x: 0.4, y: 0.2, amp: 0.3, rx: 0.16, ry: 0.16 },
    ]),
    pathVia: [
      { x: x0, y: yA },
      { x: x1, y: yA },
      { x: x1, y: yB },
      { x: x0, y: yB },
    ],
    features: ['water', 'shortcut', 'ramp'],
  });
}

// ─── Hole 7 — Par 4 ramp / jump ──────────────────────────────────────────────
function hole7(): HoleDef {
  const W = 560;
  const H = 900;
  const cx = W / 2;
  const teeY = H - 90;
  const cupY = 95;
  const hw = 96;
  const green = vertLane(cx, teeY, cupY, hw);
  const tee = { x: cx, y: teeY };
  const cup = { x: cx + 20, y: cupY };
  // Sand pit in center — jump over or go around via side lanes
  const sandY = H * 0.48;
  const zones = [
    zone(cx, sandY, 120, 100, 'sand'),
  ];
  // Side walls force either bank around or ramp jump
  const walls = [
    wall(cx - 40, sandY - 60, 80, 18),
    wall(cx - hw + 10, sandY - 20, 30, 80),
    wall(cx + hw - 40, sandY - 20, 30, 80),
  ];
  const ramp: Ramp = {
    x: cx - 35,
    y: sandY + 55,
    w: 70,
    h: 45,
    dir: { x: 0, y: -1 },
    minSpeed: 5.2,
    boost: 1.2,
    gap: 130,
  };
  return finish({
    id: 7,
    name: 'Skybridge Ramp',
    par: 4,
    width: W,
    height: H,
    green,
    tee,
    cup,
    walls,
    zones,
    ramps: [ramp],
    bumpers: [{ x: cx - 55, y: sandY + 20, r: 14 }],
    props: [{ kind: 'sign', x: cx + 130, y: sandY + 40, text: 'JUMP' }],
    theme: 'space',
    windDeg: 45,
    windMph: 9,
    topo: topo(0.4, -0.5, 0.82, [
      { x: 0.5, y: 0.55, amp: 0.5, rx: 0.24, ry: 0.2 },
      { x: 0.35, y: 0.3, amp: -0.35, rx: 0.18, ry: 0.18 },
    ]),
    features: ['ramp', 'jump'],
  });
}

// ─── Hole 8 — Par 4 volcano / lava ───────────────────────────────────────────
function hole8(): HoleDef {
  const W = 580;
  const H = 880;
  const cx = W / 2;
  const teeY = H - 90;
  const cupY = 100;
  const hw = 98;
  const green = vertLane(cx, teeY, cupY, hw);
  const tee = { x: cx, y: teeY };
  const cup = { x: cx - 16, y: cupY };
  const volY = H * 0.48;
  const zones = [
    zone(cx, volY + 10, 70, 70, 'lava'),
    zone(cx - 70, volY - 80, 45, 50, 'sand'),
  ];
  // Paths around the volcano
  const walls = [
    wall(cx - 55, volY - 55, 110, 16),
  ];
  const props: CourseProp[] = [
    { kind: 'volcano', x: cx, y: volY - 10, r: 48 },
    { kind: 'rock', x: cx - 110, y: volY + 40, r: 18 },
    { kind: 'rock', x: cx + 105, y: volY - 30, r: 16 },
  ];
  return finish({
    id: 8,
    name: 'Volcano Vista',
    par: 4,
    width: W,
    height: H,
    green,
    tee,
    cup,
    walls,
    zones,
    props,
    bumpers: [{ x: cx + 50, y: volY + 70, r: 15 }],
    theme: 'volcano',
    windDeg: -80,
    windMph: 11,
    topo: topo(0.2, -0.75, 0.9, [
      { x: 0.5, y: 0.48, amp: 0.7, rx: 0.25, ry: 0.22 },
      { x: 0.3, y: 0.7, amp: -0.3, rx: 0.16, ry: 0.16 },
      { x: 0.7, y: 0.25, amp: -0.25, rx: 0.15, ry: 0.15 },
    ]),
    features: ['volcano', 'lava'],
  });
}

// ─── Hole 9 — Par 5 finale spectacle + shortcut ──────────────────────────────
function hole9(): HoleDef {
  const W = 720;
  const H = 1080;
  const stemX = 200;
  const cupX = 520;
  const teeY = H - 100;
  const cornerY = H * 0.4;
  const cupY = 100;
  const hw = 76;
  // Long dogleg with wide lanes
  const green = lDogleg(stemX, cupX, teeY, cornerY, cupY, hw, 30);
  // Widen mid with a bulge — still geometric: add via larger hw already
  const tee = { x: stemX, y: teeY };
  const cup = { x: cupX, y: cupY };
  const walls = [
    wall(stemX + hw * 0.35, cornerY - 12, 130, 18),
    wall(cupX - hw + 10, cupY + 120, 18, 140),
  ];
  // Shortcut ramp across the inner corner (hard to hit)
  const ramp: Ramp = {
    x: stemX + 40,
    y: cornerY + 40,
    w: 55,
    h: 45,
    dir: { x: 0.55, y: -0.85 },
    minSpeed: 6,
    boost: 1.18,
    gap: 150,
  };
  const dl = Math.hypot(ramp.dir.x, ramp.dir.y) || 1;
  ramp.dir = { x: ramp.dir.x / dl, y: ramp.dir.y / dl };

  const props: CourseProp[] = [
    {
      kind: 'windmill',
      x: cupX,
      y: cupY + 200,
      r: 18,
      bladeLen: 55,
      rps: 0.28,
      gapHalf: 0.42,
      blades: 4,
    },
    { kind: 'sign', x: stemX + 150, y: teeY - 50, text: 'FINALE' },
  ];
  const zones = [
    zone(stemX + hw * 0.5, (teeY + cornerY) / 2, 50, 70, 'sand'),
  ];
  return finish({
    id: 9,
    name: 'Fooze Finale',
    par: 5,
    width: W,
    height: H,
    green,
    tee,
    cup,
    walls,
    zones,
    ramps: [ramp],
    props,
    bumpers: [
      { x: (stemX + cupX) / 2 + 20, y: cornerY, r: 18 },
      { x: cupX - 40, y: cupY + 80, r: 14 },
    ],
    theme: 'candy',
    windDeg: 30,
    windMph: 15,
    topo: topo(-0.55, -0.45, 0.92, [
      { x: 0.35, y: 0.6, amp: 0.5, rx: 0.22, ry: 0.22 },
      { x: 0.7, y: 0.35, amp: -0.4, rx: 0.2, ry: 0.2 },
      { x: 0.55, y: 0.2, amp: 0.35, rx: 0.18, ry: 0.15 },
      { x: 0.4, y: 0.8, amp: -0.25, rx: 0.15, ry: 0.15 },
    ]),
    pathVia: [{ x: stemX, y: cornerY }, { x: cupX, y: cornerY }],
    features: ['shortcut', 'ramp', 'windmill', 'finale'],
  });
}

/** The championship nine — always in this order. */
export const CURATED_HOLES: HoleDef[] = [
  hole1(),
  hole2(),
  hole3(),
  hole4(),
  hole5(),
  hole6(),
  hole7(),
  hole8(),
  hole9(),
];

export function getCuratedHole(id: number): HoleDef {
  const h = CURATED_HOLES.find((x) => x.id === id);
  if (!h) throw new Error(`Unknown curated hole id ${id}`);
  return h;
}

export function curatedIds(): number[] {
  return CURATED_HOLES.map((h) => h.id);
}

export function windStrengthFromMph(mph: number): number {
  return Math.min(1, Math.max(0, mph) / WIND_MAX_MPH);
}

export function windStrength(windVec: Vec2, windMph?: number): number {
  if (windMph != null) return windStrengthFromMph(windMph);
  return Math.min(1, Math.hypot(windVec.x, windVec.y));
}

export function slopeStrength(slope: Vec2): number {
  return Math.min(1, Math.hypot(slope.x, slope.y) / 1.25);
}

export const WIND_CALM_THRESHOLD = 0.5;
