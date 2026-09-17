/**
 * Fooze n Froops — curated 9-hole championship course.
 * Fixed order for solo + multiplayer. Large geometric fairways + real green topo.
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
  return Math.max(22, Math.round(pathLen([tee, ...via, cup]) * PX_TO_FEET));
}

function topo(
  tiltX: number,
  tiltY: number,
  strength: number,
  bumps: GreenTopo['bumps'] = [],
): GreenTopo {
  return { tiltX, tiltY, strength, bumps };
}

function slopeFromTopo(t: GreenTopo): Vec2 {
  const dx = -t.tiltX * t.strength;
  const dy = -t.tiltY * t.strength;
  const mag = Math.hypot(dx, dy);
  if (mag < 1e-6) return { x: 0, y: 0 };
  const scale = Math.min(1.35, mag * 1.5);
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
function vertLane(cx: number, teeY: number, cupY: number, hw: number, end = 36): Vec2[] {
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
  end = 34,
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
  end = 36,
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
  end = 34,
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

function finish(partial: {
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

// ─── Hole 1 — Par 3 opener (was 520×780 / hw 92 → roomier) ───────────────────
function hole1(): HoleDef {
  const W = 780;
  const H = 1180;
  const cx = W / 2;
  const teeY = H - 120;
  const cupY = 120;
  const hw = 148;
  const green = vertLane(cx, teeY, cupY, hw);
  const tee = { x: cx, y: teeY };
  const cup = { x: cx + 36, y: cupY };
  const gateY = H * 0.48;
  const gap = 72;
  const gapC = cx + 42;
  const walls = [
    wall(cx - hw + 14, gateY - 14, Math.max(32, gapC - gap / 2 - (cx - hw + 14)), 28),
    wall(gapC + gap / 2, gateY - 14, Math.max(32, cx + hw - 14 - (gapC + gap / 2)), 28),
  ];
  return finish({
    id: 1,
    name: 'Palm Froops Paradise',
    par: 3,
    width: W,
    height: H,
    green,
    tee,
    cup,
    walls,
    bumpers: [{ x: cx - 48, y: gateY - 110, r: 20 }],
    theme: 'tropical',
    windDeg: -40,
    windMph: 6,
    // Strong right-to-left + downhill toward cup — obvious break
    topo: topo(0.55, -0.78, 1.0, [
      { x: 0.62, y: 0.32, amp: 0.55, rx: 0.26, ry: 0.2 },
      { x: 0.32, y: 0.68, amp: -0.42, rx: 0.22, ry: 0.22 },
      { x: 0.5, y: 0.5, amp: 0.28, rx: 0.18, ry: 0.28 },
    ]),
    features: ['opener', 'gate'],
  });
}

// ─── Hole 2 — Par 4 dogleg risk/reward shortcut ──────────────────────────────
function hole2(): HoleDef {
  const W = 980;
  const H = 1360;
  const stemX = 260;
  const cupX = 720;
  const teeY = H - 120;
  const cornerY = H * 0.42;
  const cupY = 120;
  const hw = 128;
  const green = lDogleg(stemX, cupX, teeY, cornerY, cupY, hw);
  const tee = { x: stemX, y: teeY };
  const cup = { x: cupX + 18, y: cupY };
  const walls = [
    wall(stemX + hw * 0.4, cornerY - 14, 170, 26),
    wall(cupX - hw + 12, cupY + 120, 26, 150),
  ];
  const zones = [zone(stemX + hw + 55, cornerY + 12, 58, 50, 'sand')];
  return finish({
    id: 2,
    name: 'Crimson Leaf Dogleg',
    par: 4,
    width: W,
    height: H,
    green,
    tee,
    cup,
    walls,
    bumpers: [{ x: (stemX + cupX) / 2, y: cornerY + 8, r: 22 }],
    zones,
    theme: 'autumn',
    windDeg: 200,
    windMph: 10,
    topo: topo(-0.62, -0.58, 1.05, [
      { x: 0.28, y: 0.58, amp: 0.58, rx: 0.24, ry: 0.28 },
      { x: 0.72, y: 0.28, amp: -0.48, rx: 0.22, ry: 0.2 },
      { x: 0.55, y: 0.72, amp: 0.32, rx: 0.18, ry: 0.18 },
    ]),
    pathVia: [
      { x: stemX, y: cornerY },
      { x: cupX, y: cornerY },
    ],
    features: ['dogleg', 'shortcut'],
  });
}

// ─── Hole 3 — Par 4 windmill gate ────────────────────────────────────────────
function hole3(): HoleDef {
  const W = 860;
  const H = 1320;
  const cx = W / 2;
  const teeY = H - 118;
  const cupY = 125;
  const hw = 158;
  const green = vertLane(cx, teeY, cupY, hw);
  const tee = { x: cx, y: teeY };
  const cup = { x: cx - 28, y: cupY };
  const millY = H * 0.5;
  const walls = [
    wall(cx - hw + 12, millY + 140, 40, 180),
    wall(cx + hw - 52, millY - 320, 40, 180),
  ];
  const props: CourseProp[] = [
    {
      kind: 'windmill',
      x: cx,
      y: millY,
      r: 28,
      bladeLen: 110,
      rps: 0.2,
      gapHalf: 0.38,
      blades: 4,
    },
  ];
  return finish({
    id: 3,
    name: 'Dutch Devil Windmill',
    par: 4,
    width: W,
    height: H,
    green,
    tee,
    cup,
    walls,
    bumpers: [{ x: cx + 60, y: millY + 160, r: 18 }],
    props,
    theme: 'castle',
    windDeg: 90,
    windMph: 8,
    // Dome under mill + left break toward cup
    topo: topo(0.68, -0.48, 1.08, [
      { x: 0.5, y: 0.5, amp: 0.7, rx: 0.32, ry: 0.26 },
      { x: 0.28, y: 0.22, amp: -0.42, rx: 0.18, ry: 0.18 },
      { x: 0.7, y: 0.7, amp: -0.3, rx: 0.2, ry: 0.2 },
    ]),
    features: ['windmill'],
  });
}

// ─── Hole 4 — Par 3 short bank / narrow (still tighter, but roomier than before)
function hole4(): HoleDef {
  const W = 640;
  const H = 1060;
  const cx = W / 2;
  const teeY = H - 110;
  const cupY = 115;
  const hw = 96;
  const green = vertLane(cx, teeY, cupY, hw, 30);
  const tee = { x: cx, y: teeY };
  const cup = { x: cx, y: cupY };
  const leftX = cx - hw + 8;
  const rightX = cx + hw - 28;
  const walls = [
    wall(leftX, teeY - 240, 22, 130),
    wall(rightX, teeY - 420, 22, 130),
    wall(leftX, teeY - 600, 22, 120),
    wall(cx - hw * 0.7, cupY + 70, hw * 1.4, 18),
  ];
  return finish({
    id: 4,
    name: 'Neon Banker\'s Blitz',
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
    // Strong left bank slope — across-slope putts curve hard
    topo: topo(-0.92, -0.35, 1.12, [
      { x: 0.38, y: 0.45, amp: 0.7, rx: 0.22, ry: 0.34 },
      { x: 0.68, y: 0.62, amp: -0.52, rx: 0.2, ry: 0.22 },
    ]),
    features: ['narrow', 'bank'],
  });
}

// ─── Hole 5 — Par 4 water hazard ─────────────────────────────────────────────
function hole5(): HoleDef {
  const W = 920;
  const H = 1380;
  const cx = W / 2;
  const teeY = H - 125;
  const cupY = 130;
  const neck0 = H * 0.5;
  const neck1 = H * 0.36;
  const green = islandBridge(cx, teeY, cupY, 180, 68, 150, neck0, neck1);
  const tee = { x: cx, y: teeY };
  const cup = { x: cx + 22, y: cupY };
  const midY = (neck0 + neck1) / 2;
  const zones = [
    zone(cx - 118, (teeY + neck0) * 0.5 + 14, 76, 150, 'water'),
    zone(cx + 118, (teeY + neck0) * 0.5 + 14, 76, 150, 'water'),
    zone(cx, neck0 - 40, 100, 50, 'sand'),
  ];
  const walls = [
    wall(cx - 105, neck0 + 28, 58, 22),
    wall(cx + 47, neck0 + 28, 58, 22),
  ];
  return finish({
    id: 5,
    name: 'Blackbeard\'s Moat',
    par: 4,
    width: W,
    height: H,
    green,
    tee,
    cup,
    walls,
    zones,
    bumpers: [{ x: cx, y: neck1 - 55, r: 18 }],
    props: [{ kind: 'sign', x: cx + 200, y: teeY - 50, text: 'BRIDGE' }],
    theme: 'pirate',
    windDeg: 160,
    windMph: 12,
    topo: topo(0.38, -0.82, 1.0, [
      { x: 0.5, y: 0.72, amp: 0.4, rx: 0.28, ry: 0.22 },
      { x: 0.42, y: 0.22, amp: -0.55, rx: 0.24, ry: 0.2 },
      { x: 0.6, y: 0.45, amp: 0.3, rx: 0.18, ry: 0.2 },
    ]),
    pathVia: [{ x: cx, y: midY }],
    features: ['water'],
  });
}

// ─── Hole 6 — Par 5 long + jump shortcut ─────────────────────────────────────
function hole6(): HoleDef {
  const W = 1080;
  const H = 1560;
  const x0 = 300;
  const x1 = 780;
  const teeY = H - 125;
  const yA = H * 0.62;
  const yB = H * 0.34;
  const cupY = 125;
  const hw = 118;
  const green = zChannel(x0, x1, teeY, yA, yB, cupY, hw);
  const tee = { x: x0, y: teeY };
  const cup = { x: x0 - 14, y: cupY };
  const zones = [
    zone(x1, (yA + yB) / 2, 100, 130, 'water'),
    zone(x0 + 75, (teeY + yA) / 2, 70, 90, 'sand'),
  ];
  const ramp: Ramp = {
    x: x0 + hw - 10,
    y: yA - 42,
    w: 100,
    h: 70,
    dir: { x: 0.15, y: -1 },
    minSpeed: 5.5,
    boost: 1.15,
    gap: 220,
  };
  const dl = Math.hypot(ramp.dir.x, ramp.dir.y) || 1;
  ramp.dir = { x: ramp.dir.x / dl, y: ramp.dir.y / dl };

  const walls = [
    wall(x0 + hw * 0.25, yA - 14, Math.max(70, x1 - x0 - hw), 22),
    wall(x0 + hw * 0.25, yB - 8, Math.max(70, x1 - x0 - hw), 22),
  ];
  return finish({
    id: 6,
    name: 'Mirage Canyon Leap',
    par: 5,
    width: W,
    height: H,
    green,
    tee,
    cup,
    walls,
    zones,
    ramps: [ramp],
    bumpers: [{ x: x1 - 30, y: yA - 55, r: 20 }],
    props: [{ kind: 'rock', x: x1 + 130, y: (yA + yB) / 2, r: 28 }],
    theme: 'desert',
    windDeg: -120,
    windMph: 14,
    topo: topo(-0.42, -0.88, 1.1, [
      { x: 0.32, y: 0.62, amp: 0.58, rx: 0.26, ry: 0.22 },
      { x: 0.72, y: 0.4, amp: -0.48, rx: 0.24, ry: 0.24 },
      { x: 0.38, y: 0.18, amp: 0.38, rx: 0.18, ry: 0.18 },
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
  const W = 860;
  const H = 1360;
  const cx = W / 2;
  const teeY = H - 120;
  const cupY = 125;
  const hw = 150;
  const green = vertLane(cx, teeY, cupY, hw);
  const tee = { x: cx, y: teeY };
  const cup = { x: cx + 30, y: cupY };
  const sandY = H * 0.48;
  const zones = [zone(cx, sandY, 180, 150, 'sand')];
  const walls = [
    wall(cx - 58, sandY - 85, 116, 24),
    wall(cx - hw + 14, sandY - 28, 44, 120),
    wall(cx + hw - 58, sandY - 28, 44, 120),
  ];
  const ramp: Ramp = {
    x: cx - 48,
    y: sandY + 80,
    w: 96,
    h: 62,
    dir: { x: 0, y: -1 },
    minSpeed: 5.2,
    boost: 1.2,
    gap: 190,
  };
  return finish({
    id: 7,
    name: 'Orbital Skybridge',
    par: 4,
    width: W,
    height: H,
    green,
    tee,
    cup,
    walls,
    zones,
    ramps: [ramp],
    bumpers: [{ x: cx - 80, y: sandY + 30, r: 18 }],
    props: [{ kind: 'sign', x: cx + 190, y: sandY + 55, text: 'JUMP' }],
    theme: 'space',
    windDeg: 45,
    windMph: 9,
    topo: topo(0.55, -0.7, 1.05, [
      { x: 0.5, y: 0.55, amp: 0.62, rx: 0.28, ry: 0.22 },
      { x: 0.32, y: 0.28, amp: -0.45, rx: 0.2, ry: 0.2 },
      { x: 0.7, y: 0.4, amp: 0.28, rx: 0.16, ry: 0.18 },
    ]),
    features: ['ramp', 'jump'],
  });
}

// ─── Hole 8 — Par 4 volcano / lava ───────────────────────────────────────────
function hole8(): HoleDef {
  const W = 900;
  const H = 1320;
  const cx = W / 2;
  const teeY = H - 120;
  const cupY = 130;
  const hw = 155;
  const green = vertLane(cx, teeY, cupY, hw);
  const tee = { x: cx, y: teeY };
  const cup = { x: cx - 24, y: cupY };
  const volY = H * 0.48;
  const zones = [
    zone(cx, volY + 14, 100, 100, 'lava'),
    zone(cx - 105, volY - 120, 65, 72, 'sand'),
  ];
  const walls = [wall(cx - 80, volY - 78, 160, 22)];
  const props: CourseProp[] = [
    { kind: 'volcano', x: cx, y: volY - 14, r: 68 },
    { kind: 'rock', x: cx - 160, y: volY + 55, r: 24 },
    { kind: 'rock', x: cx + 155, y: volY - 42, r: 22 },
  ];
  return finish({
    id: 8,
    name: 'Mount Magma Mayhem',
    par: 4,
    width: W,
    height: H,
    green,
    tee,
    cup,
    walls,
    zones,
    props,
    bumpers: [{ x: cx + 72, y: volY + 100, r: 18 }],
    theme: 'volcano',
    windDeg: -80,
    windMph: 11,
    // Big volcano mound — rolls away from crater, then downhill to cup
    topo: topo(0.28, -0.95, 1.15, [
      { x: 0.5, y: 0.48, amp: 0.95, rx: 0.3, ry: 0.26 },
      { x: 0.28, y: 0.72, amp: -0.4, rx: 0.18, ry: 0.18 },
      { x: 0.72, y: 0.22, amp: -0.35, rx: 0.18, ry: 0.18 },
    ]),
    features: ['volcano', 'lava'],
  });
}

// ─── Hole 9 — Par 5 finale spectacle + shortcut ──────────────────────────────
function hole9(): HoleDef {
  const W = 1100;
  const H = 1620;
  const stemX = 300;
  const cupX = 800;
  const teeY = H - 130;
  const cornerY = H * 0.4;
  const cupY = 130;
  const hw = 125;
  const green = lDogleg(stemX, cupX, teeY, cornerY, cupY, hw, 38);
  const tee = { x: stemX, y: teeY };
  const cup = { x: cupX, y: cupY };
  const walls = [
    wall(stemX + hw * 0.35, cornerY - 16, 200, 26),
    wall(cupX - hw + 14, cupY + 170, 26, 200),
  ];
  const ramp: Ramp = {
    x: stemX + 55,
    y: cornerY + 55,
    w: 80,
    h: 62,
    dir: { x: 0.55, y: -0.85 },
    minSpeed: 6,
    boost: 1.18,
    gap: 210,
  };
  const dl = Math.hypot(ramp.dir.x, ramp.dir.y) || 1;
  ramp.dir = { x: ramp.dir.x / dl, y: ramp.dir.y / dl };

  const props: CourseProp[] = [
    {
      kind: 'windmill',
      x: cupX,
      y: cupY + 280,
      r: 24,
      bladeLen: 78,
      rps: 0.26,
      gapHalf: 0.42,
      blades: 4,
    },
    { kind: 'sign', x: stemX + 210, y: teeY - 60, text: 'FINALE' },
  ];
  const zones = [zone(stemX + hw * 0.5, (teeY + cornerY) / 2, 72, 100, 'sand')];
  return finish({
    id: 9,
    name: 'Sugar-Rush Fooze Finale',
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
      { x: (stemX + cupX) / 2 + 28, y: cornerY, r: 22 },
      { x: cupX - 55, y: cupY + 110, r: 18 },
    ],
    theme: 'candy',
    windDeg: 30,
    windMph: 15,
    topo: topo(-0.72, -0.62, 1.12, [
      { x: 0.32, y: 0.62, amp: 0.62, rx: 0.26, ry: 0.26 },
      { x: 0.72, y: 0.32, amp: -0.52, rx: 0.24, ry: 0.22 },
      { x: 0.55, y: 0.18, amp: 0.42, rx: 0.2, ry: 0.16 },
      { x: 0.38, y: 0.82, amp: -0.32, rx: 0.18, ry: 0.18 },
    ]),
    pathVia: [
      { x: stemX, y: cornerY },
      { x: cupX, y: cornerY },
    ],
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
