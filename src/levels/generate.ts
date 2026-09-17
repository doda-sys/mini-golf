import type { Bumper, GrassPattern, HoleDef, Vec2, Wall, Zone } from '../types';
import { themeForHoleId, type HoleThemeId } from './themes';
import { makeTopo, type GreenTopo } from './topo';

export const WIND_MAX_MPH = 25;
/** Target pool mix: ~22% par 3, 56% par 4, 22% par 5. */
export const PAR3_SHARE = 220;
export const PAR4_SHARE = 560;
export const PAR5_SHARE = 220;

const CUP_R = 16;
const BORDER = 36;
export const POOL_SIZE = 1000;
export const ROUND_HOLES = 9;

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const ADJECTIVES = [
  'Windy', 'Lucky', 'Crooked', 'Sunny', 'Hidden', 'Bouncy', 'Icy', 'Sandy',
  'Narrow', 'Grand', 'Twisty', 'Quiet', 'Wild', 'Silver', 'Golden', 'Rusty',
  'Foggy', 'Spicy', 'Cosmic', 'Peppy', 'Dusty', 'Misty', 'Jolly', 'Zesty',
];
const NOUNS = [
  'Fairway', 'Dogleg', 'Alley', 'Bowl', 'Lane', 'Cove', 'Pass', 'Ridge',
  'Garden', 'Run', 'Bend', 'Grove', 'Dunes', 'Loop', 'Gate', 'Glen',
  'Trail', 'Basin', 'Creek', 'Knob', 'Hollow', 'Point', 'Meadow', 'Spur',
];

/** Soft short-nap carpet greens — muted pairs for premium mow look. */
const CARPET_PALETTES: Array<[string, string, string]> = [
  ['#2f9b56', '#288a4b', '#3aad62'],
  ['#34a05a', '#2c8f4f', '#3eb068'],
  ['#2a9450', '#238045', '#36a45c'],
  ['#319656', '#28864a', '#3caa64'],
  ['#2d8f52', '#257c46', '#38a05e'],
  ['#288e58', '#217c4c', '#32a064'],
  ['#35964e', '#2c8444', '#40a85a'],
  ['#2b9660', '#248454', '#36a86c'],
];

export type LayoutId =
  | 'straight'
  | 'dogleg_l'
  | 'dogleg_r'
  | 'y_split'
  | 's_curve'
  | 'bank'
  | 'runaround'
  | 'gate'
  | 'island'
  | 'hill'
  | 'horseshoe'
  | 'chicane';

const LAYOUTS: LayoutId[] = [
  'straight',
  'dogleg_l',
  'dogleg_r',
  'y_split',
  's_curve',
  'bank',
  'runaround',
  'gate',
  'island',
  'hill',
  'horseshoe',
  'chicane',
];

type BuiltLayout = {
  green: Vec2[];
  tee: Vec2;
  cup: Vec2;
  walls: Wall[];
  bumpers: Bumper[];
  zones: Zone[];
  pathDir: Vec2;
  difficulty: number;
  pathLen: number;
};

function holeName(id: number, rng: () => number, layout: LayoutId): string {
  const a = ADJECTIVES[(id + Math.floor(rng() * ADJECTIVES.length)) % ADJECTIVES.length];
  const layoutNoun: Partial<Record<LayoutId, string>> = {
    dogleg_l: 'Dogleg',
    dogleg_r: 'Dogleg',
    gate: 'Gate',
    island: 'Isle',
    bank: 'Alley',
    s_curve: 'Bend',
    horseshoe: 'Horseshoe',
    chicane: 'Chicane',
    y_split: 'Fork',
    hill: 'Ridge',
    runaround: 'Loop',
    straight: 'Lane',
  };
  const n =
    rng() < 0.45 && layoutNoun[layout]
      ? layoutNoun[layout]!
      : NOUNS[(id * 3 + Math.floor(rng() * NOUNS.length)) % NOUNS.length];
  return `${a} ${n}`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function pointInPoly(px: number, py: number, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distToEdge(px: number, py: number, poly: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const apx = px - a.x;
    const apy = py - a.y;
    const ab2 = abx * abx + aby * aby || 1;
    let t = (apx * abx + apy * aby) / ab2;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + abx * t;
    const cy = a.y + aby * t;
    const d = Math.hypot(px - cx, py - cy);
    if (d < best) best = d;
  }
  return best;
}

function roundPts(poly: Vec2[]): Vec2[] {
  return poly.map((p) => ({
    x: Math.round(p.x * 10) / 10,
    y: Math.round(p.y * 10) / 10,
  }));
}

function pathLength(pts: Vec2[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return L;
}

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function wall(x: number, y: number, w: number, h: number): Wall {
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

function zoneRect(
  cx: number,
  cy: number,
  w: number,
  h: number,
  kind: Zone['kind'],
  rng: () => number,
): Zone {
  const frictionMul = kind === 'ice' ? 0.38 + rng() * 0.12 : kind === 'sand' ? 2.2 + rng() * 0.5 : 1;
  return {
    x: Math.round(cx - w / 2),
    y: Math.round(cy - h / 2),
    w: Math.round(w),
    h: Math.round(h),
    frictionMul,
    kind,
  };
}

function themeHazards(themeId: HoleThemeId): Zone['kind'][] {
  if (themeId === 'arctic') return ['ice', 'ice', 'sand'];
  if (themeId === 'desert') return ['sand', 'sand', 'water'];
  if (themeId === 'pirate' || themeId === 'tropical') return ['water', 'sand', 'water'];
  if (themeId === 'volcano') return ['sand', 'water', 'sand'];
  return ['sand', 'ice', 'water'];
}

function keepZoneOnGreen(z: Zone, green: Vec2[], tee: Vec2, cup: Vec2): boolean {
  const pts = [
    { x: z.x + 6, y: z.y + 6 },
    { x: z.x + z.w - 6, y: z.y + 6 },
    { x: z.x + 6, y: z.y + z.h - 6 },
    { x: z.x + z.w - 6, y: z.y + z.h - 6 },
    { x: z.x + z.w / 2, y: z.y + z.h / 2 },
  ];
  if (!pts.every((p) => pointInPoly(p.x, p.y, green))) return false;
  const cx = z.x + z.w / 2;
  const cy = z.y + z.h / 2;
  if (Math.hypot(cx - tee.x, cy - tee.y) < 70) return false;
  if (Math.hypot(cx - cup.x, cy - cup.y) < 74) return false;
  return true;
}

function keepWallClear(w: Wall, tee: Vec2, cup: Vec2, pad = 48): boolean {
  const hits = (px: number, py: number) =>
    px >= w.x - pad && px <= w.x + w.w + pad && py >= w.y - pad && py <= w.y + w.h + pad;
  return !hits(tee.x, tee.y) && !hits(cup.x, cup.y);
}

function makeGrass(id: number, rng: () => number): GrassPattern {
  const pal = CARPET_PALETTES[id % CARPET_PALETTES.length];
  const [a, b, sheen] = pal;
  const angle = (rng() - 0.5) * 0.35 + (rng() < 0.5 ? 0 : Math.PI / 2);
  const width = 16 + rng() * 10;
  return { kind: 'carpet', width, angle, a, b, sheen };
}

/**
 * Every hole has wind (calm = 0 mph). Direction is always set so the compass
 * can show blowing-toward even at 0. Deterministic from rng (hole seed).
 */
function makeWind(rng: () => number): { dir: Vec2; mph: number } {
  const ang = rng() * Math.PI * 2;
  const dir = { x: Math.cos(ang), y: Math.sin(ang) };
  const roll = rng();
  let mph: number;
  if (roll < 0.16) mph = 0;
  else if (roll < 0.5) mph = 1 + Math.floor(rng() * 8); // 1–8 light
  else if (roll < 0.82) mph = 9 + Math.floor(rng() * 9); // 9–17 moderate
  else mph = 18 + Math.floor(rng() * 8); // 18–25 strong
  mph = clamp(mph, 0, WIND_MAX_MPH);
  return { dir, mph };
}

/** Topo intensity scales with par so harder holes break more. */
function topoIntensity(par: number, layout: LayoutId, rng: () => number): number {
  let base = par === 3 ? 0.35 : par === 4 ? 0.55 : 0.72;
  if (layout === 'hill') base += 0.2;
  return clamp(base + (rng() - 0.5) * 0.18, 0.22, 1);
}

/** Average downhill from topo tilt — for HUD break hint. */
function slopeFromTopo(topo: GreenTopo): Vec2 {
  const dx = -topo.tiltX * topo.strength;
  const dy = -topo.tiltY * topo.strength;
  const mag = Math.hypot(dx, dy);
  if (mag < 1e-6) return { x: 0, y: 0 };
  // Normalize to ~0–1.1 range similar to legacy slope
  const scale = Math.min(1.1, mag * 1.4);
  return { x: (dx / mag) * scale, y: (dy / mag) * scale };
}

// ─── Geometric channel polygons (axis-aligned rails, course-like) ───────────

/** Generous lane half-width for phone-filling fairways. */
function laneHalf(rng: () => number, lo = 72, hi = 102): number {
  return lo + rng() * (hi - lo);
}

/** Slight end bulbs on a vertical corridor — still orthogonal stepped pads. */
function verticalCorridor(
  cx: number,
  teeY: number,
  cupY: number,
  hw: number,
  endPad = 1.18,
): Vec2[] {
  const teeHw = hw * endPad;
  const cupHw = hw * endPad;
  const teeBulb = hw * 0.55;
  const cupBulb = hw * 0.55;
  // Stepped rounded-rect look: wider tee/cup pads, narrower mid — all right angles
  return [
    { x: cx - teeHw, y: teeY + teeBulb * 0.35 },
    { x: cx + teeHw, y: teeY + teeBulb * 0.35 },
    { x: cx + teeHw, y: teeY - teeBulb },
    { x: cx + hw, y: teeY - teeBulb },
    { x: cx + hw, y: cupY + cupBulb },
    { x: cx + cupHw, y: cupY + cupBulb },
    { x: cx + cupHw, y: cupY - cupBulb * 0.35 },
    { x: cx - cupHw, y: cupY - cupBulb * 0.35 },
    { x: cx - cupHw, y: cupY + cupBulb },
    { x: cx - hw, y: cupY + cupBulb },
    { x: cx - hw, y: teeY - teeBulb },
    { x: cx - teeHw, y: teeY - teeBulb },
  ];
}

/** Simple wide rectangle fairway (no taper). */
function rectCorridor(cx: number, teeY: number, cupY: number, hw: number, endExtra = 18): Vec2[] {
  const top = Math.min(teeY, cupY) - endExtra;
  const bot = Math.max(teeY, cupY) + endExtra;
  return [
    { x: cx - hw, y: bot },
    { x: cx + hw, y: bot },
    { x: cx + hw, y: top },
    { x: cx - hw, y: top },
  ];
}

/**
 * Classic L dogleg as union of 3 channel segments — 8 right-angle verts.
 * Tee at stem bottom, cup at finish top. left=true ⇒ stem on left, finish on right.
 */
function lDoglegPoly(
  stemX: number,
  cupX: number,
  teeY: number,
  cornerY: number,
  cupY: number,
  hw: number,
  endExtra = 22,
): Vec2[] {
  const teeBot = teeY + endExtra;
  const cupTop = cupY - endExtra;
  if (cupX >= stemX) {
    // Stem left → cross right → finish up
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
  // Stem right → cross left → finish up
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

/** U / horseshoe channel — tee bottom-left, cup bottom-right. */
function uChannelPoly(
  leftX: number,
  rightX: number,
  topY: number,
  botY: number,
  hw: number,
  endExtra = 22,
): Vec2[] {
  const bot = botY + endExtra;
  return [
    { x: leftX - hw, y: bot },
    { x: leftX + hw, y: bot },
    { x: leftX + hw, y: topY + hw },
    { x: rightX - hw, y: topY + hw },
    { x: rightX - hw, y: bot },
    { x: rightX + hw, y: bot },
    { x: rightX + hw, y: topY - hw },
    { x: leftX - hw, y: topY - hw },
  ];
}

/**
 * Y / tuning-fork: stem + two rectangular arms + shared cup pad.
 * All axis-aligned edges.
 */
function yChannelPoly(
  cx: number,
  teeY: number,
  forkY: number,
  cupY: number,
  spread: number,
  hw: number,
  endExtra = 22,
): Vec2[] {
  const teeBot = teeY + endExtra;
  const cupTop = cupY - endExtra;
  const cupPad = hw * 1.15;
  return [
    { x: cx - hw, y: teeBot },
    { x: cx + hw, y: teeBot },
    { x: cx + hw, y: forkY },
    { x: cx + spread + hw, y: forkY },
    { x: cx + spread + hw, y: cupY + cupPad },
    { x: cx + cupPad, y: cupY + cupPad },
    { x: cx + cupPad, y: cupTop },
    { x: cx - cupPad, y: cupTop },
    { x: cx - cupPad, y: cupY + cupPad },
    { x: cx - spread - hw, y: cupY + cupPad },
    { x: cx - spread - hw, y: forkY },
    { x: cx - hw, y: forkY },
  ];
}

/**
 * Orthogonal S / double-dogleg (Z-channel): three vertical runs + two cross links.
 * Reads as wooden-rail chicane, not a wavy ribbon.
 */
function zChannelPoly(
  x0: number,
  x1: number,
  teeY: number,
  yA: number,
  yB: number,
  cupY: number,
  hw: number,
  endExtra = 22,
): Vec2[] {
  const teeBot = teeY + endExtra;
  const cupTop = cupY - endExtra;
  // Assume x1 > x0: tee on left column, mid cross right, upper cross left to cup column
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

/**
 * Island hole: wide start pad + rectangular bridge + cup island — orthogonal union.
 */
function islandPoly(
  cx: number,
  teeY: number,
  cupY: number,
  startHw: number,
  bridgeHw: number,
  islandHw: number,
  neckY0: number,
  neckY1: number,
  endExtra = 24,
): Vec2[] {
  const teeBot = teeY + endExtra;
  const cupTop = cupY - endExtra;
  return [
    { x: cx - startHw, y: teeBot },
    { x: cx + startHw, y: teeBot },
    { x: cx + startHw, y: neckY0 },
    { x: cx + bridgeHw, y: neckY0 },
    { x: cx + bridgeHw, y: neckY1 },
    { x: cx + islandHw, y: neckY1 },
    { x: cx + islandHw, y: cupTop },
    { x: cx - islandHw, y: cupTop },
    { x: cx - islandHw, y: neckY1 },
    { x: cx - bridgeHw, y: neckY1 },
    { x: cx - bridgeHw, y: neckY0 },
    { x: cx - startHw, y: neckY0 },
  ];
}

/**
 * Chicane: staggered rectangular corridor (two side offsets) — still geometric.
 */
function chicanePoly(
  cx: number,
  offset: number,
  teeY: number,
  y1: number,
  y2: number,
  y3: number,
  cupY: number,
  hw: number,
  endExtra = 22,
): Vec2[] {
  const teeBot = teeY + endExtra;
  const cupTop = cupY - endExtra;
  const a = cx - offset;
  const b = cx + offset;
  // Outer rail following left then right jogs
  return [
    { x: a - hw, y: teeBot },
    { x: a + hw, y: teeBot },
    { x: a + hw, y: y1 + hw },
    { x: b + hw, y: y1 + hw },
    { x: b + hw, y: y2 - hw },
    { x: a + hw, y: y2 - hw },
    { x: a + hw, y: y3 + hw },
    { x: b + hw, y: y3 + hw },
    { x: b + hw, y: cupTop },
    { x: b - hw, y: cupTop },
    { x: b - hw, y: y3 - hw },
    { x: a - hw, y: y3 - hw },
    { x: a - hw, y: y2 + hw },
    { x: b - hw, y: y2 + hw },
    { x: b - hw, y: y1 - hw },
    { x: a - hw, y: y1 - hw },
  ];
}

// ─── Layout builders ────────────────────────────────────────────────────────

function buildStraight(rng: () => number, W: number, H: number, themeId: HoleThemeId, par = 3): BuiltLayout {
  const hw = laneHalf(rng, 78, 108);
  const teeY = H - BORDER - 70;
  const cupY = BORDER + 70;
  const cx = W / 2 + (rng() - 0.5) * 36;
  const green = verticalCorridor(cx, teeY, cupY, hw);
  const tee = { x: cx, y: teeY };
  // Cup already nudged later; seed a lateral bias here too
  const cupOff = (par >= 4 ? 22 : 12) * (rng() < 0.5 ? 1 : -1);
  const cup = { x: cx + cupOff, y: cupY };
  const walls: Wall[] = [];
  const bumpers: Bumper[] = [];
  const zones: Zone[] = [];
  const kinds = themeHazards(themeId);

  // Always block the dead-center lane (gate with side gap)
  const gateY = teeY + (cupY - teeY) * (0.42 + rng() * 0.18);
  const gap = Math.max(36, 56 - par * 4) + rng() * 12;
  const gapSide = rng() < 0.5 ? -1 : 1;
  const gapCenter = cx + gapSide * (hw * 0.25);
  walls.push(wall(cx - hw + 6, gateY - 12, Math.max(20, gapCenter - gap / 2 - (cx - hw + 6)), 24));
  walls.push(wall(gapCenter + gap / 2, gateY - 12, Math.max(20, cx + hw - 6 - (gapCenter + gap / 2)), 24));

  if (par >= 4 || rng() < 0.65) {
    const midY = (teeY + cupY) / 2;
    const side = rng() < 0.5 ? -1 : 1;
    const z = zoneRect(cx + side * (hw * 0.4), midY, 50 + rng() * 28, 70 + rng() * 40, kinds[0], rng);
    if (keepZoneOnGreen(z, green, tee, cup)) zones.push(z);
  }
  if (par >= 4 || rng() < 0.55) {
    bumpers.push({
      x: cx - gapSide * hw * 0.2,
      y: gateY - 55,
      r: 15 + rng() * 6,
    });
  }
  return {
    green,
    tee,
    cup,
    walls,
    bumpers,
    zones,
    pathDir: { x: cup.x - tee.x, y: cupY - teeY },
    difficulty: 0.28 + par * 0.08 + rng() * 0.15,
    pathLen: Math.abs(teeY - cupY),
  };
}

function buildDogleg(rng: () => number, W: number, H: number, left: boolean, themeId: HoleThemeId, par = 4): BuiltLayout {
  const hw = laneHalf(rng, 70, 96);
  const teeY = H - BORDER - 68;
  const cupY = BORDER + 68;
  const cornerY = H * (0.4 + rng() * 0.12);
  const stemX = left ? W * (0.26 + rng() * 0.08) : W * (0.66 + rng() * 0.08);
  const cupX = left ? W * (0.66 + rng() * 0.1) : W * (0.24 + rng() * 0.1);
  const green = lDoglegPoly(stemX, cupX, teeY, cornerY, cupY, hw);
  const tee = { x: stemX, y: teeY };
  const cup = { x: cupX, y: cupY };
  const walls: Wall[] = [];
  const bumpers: Bumper[] = [];
  const zones: Zone[] = [];

  // Corner guide block — optional short-cut tease
  const blockW = Math.max(48, Math.abs(cupX - stemX) * 0.35);
  const wy = cornerY - 12;
  if (left) {
    const w = wall(stemX + hw * 0.35, wy, blockW, 18);
    if (keepWallClear(w, tee, cup)) walls.push(w);
  } else {
    const w = wall(cupX + hw * 0.2, wy, blockW, 18);
    if (keepWallClear(w, tee, cup)) walls.push(w);
  }

  bumpers.push({
    x: lerp({ x: stemX, y: cornerY }, { x: cupX, y: cornerY }, 0.4).x,
    y: cornerY + (rng() - 0.5) * 16,
    r: 16 + rng() * 5,
  });

  if (rng() < 0.45) {
    const kinds = themeHazards(themeId);
    const z = zoneRect(
      stemX + (left ? hw * 0.35 : -hw * 0.35),
      (teeY + cornerY) / 2,
      48 + rng() * 24,
      80 + rng() * 40,
      kinds[0],
      rng,
    );
    if (keepZoneOnGreen(z, green, tee, cup)) zones.push(z);
  }

  return {
    green,
    tee,
    cup,
    walls,
    bumpers,
    zones,
    pathDir: { x: cup.x - tee.x, y: cup.y - tee.y },
    difficulty: 0.42 + rng() * 0.25,
    pathLen: Math.abs(teeY - cornerY) + Math.abs(cupX - stemX) + Math.abs(cornerY - cupY),
  };
}

function buildYSplit(rng: () => number, W: number, H: number, themeId: HoleThemeId, par = 4): BuiltLayout {
  const hw = laneHalf(rng, 68, 92);
  const teeY = H - BORDER - 68;
  const forkY = H * (0.5 + rng() * 0.08);
  const cupY = BORDER + 68;
  const cx = W / 2;
  const spread = W * (0.2 + rng() * 0.1);
  const green = yChannelPoly(cx, teeY, forkY, cupY, spread, hw);
  const tee = { x: cx, y: teeY };
  const cup = { x: cx, y: cupY };
  const walls: Wall[] = [];
  const bumpers: Bumper[] = [];
  const zones: Zone[] = [];

  // Center divider between arms
  const divH = Math.min(90, Math.abs(forkY - cupY) * 0.35);
  walls.push(wall(cx - 10, forkY - divH - 20, 20, divH));

  if (rng() < 0.55) {
    const kinds = themeHazards(themeId);
    const z = zoneRect(cx + spread * 0.65, (forkY + cupY) / 2, 44 + rng() * 18, 60 + rng() * 28, kinds[0], rng);
    if (keepZoneOnGreen(z, green, tee, cup)) zones.push(z);
  }
  if (rng() < 0.35) bumpers.push({ x: cx - spread * 0.55, y: forkY - 40, r: 15 + rng() * 5 });

  return {
    green,
    tee,
    cup,
    walls: walls.filter((w) => keepWallClear(w, tee, cup)),
    bumpers,
    zones,
    pathDir: { x: 0, y: cupY - teeY },
    difficulty: 0.48 + rng() * 0.22,
    pathLen: Math.abs(teeY - cupY) + spread,
  };
}

function buildSCurve(rng: () => number, W: number, H: number, themeId: HoleThemeId, par = 4): BuiltLayout {
  const hw = laneHalf(rng, 68, 94);
  const teeY = H - BORDER - 68;
  const cupY = BORDER + 68;
  const x0 = W * (0.32 + rng() * 0.08);
  const x1 = W * (0.62 + rng() * 0.08);
  const yA = H * (0.62 + rng() * 0.06);
  const yB = H * (0.34 + rng() * 0.06);
  const green = zChannelPoly(x0, x1, teeY, yA, yB, cupY, hw);
  const tee = { x: x0, y: teeY };
  const cup = { x: x0, y: cupY };
  const walls: Wall[] = [];
  const bumpers: Bumper[] = [];
  const zones: Zone[] = [];

  // Inner corner guides at the two crosses
  walls.push(wall(x0 + hw * 0.2, yA - 10, Math.max(40, x1 - x0 - hw), 16));
  walls.push(wall(x0 + hw * 0.2, yB - 6, Math.max(40, x1 - x0 - hw), 16));

  if (rng() < 0.4) {
    const kinds = themeHazards(themeId);
    const z = zoneRect(x1, (yA + yB) / 2, 44, 55, kinds[Math.floor(rng() * kinds.length)], rng);
    if (keepZoneOnGreen(z, green, tee, cup)) zones.push(z);
  }

  return {
    green,
    tee,
    cup,
    walls: walls.filter((w) => keepWallClear(w, tee, cup)),
    bumpers,
    zones,
    pathDir: { x: cup.x - tee.x, y: cup.y - tee.y },
    difficulty: 0.52 + rng() * 0.22,
    pathLen: Math.abs(teeY - cupY) + Math.abs(x1 - x0) * 2,
  };
}

function buildBank(rng: () => number, W: number, H: number, themeId: HoleThemeId, par = 4): BuiltLayout {
  const hw = laneHalf(rng, 64, 88);
  const teeY = H - BORDER - 68;
  const cupY = BORDER + 68;
  const cx = W / 2 + (rng() - 0.5) * 28;
  const green = rectCorridor(cx, teeY, cupY, hw + 6, 24);
  const tee = { x: cx, y: teeY };
  const cup = { x: cx, y: cupY };
  const walls: Wall[] = [];
  // Parallel inner rails with staggered gaps for bank shots
  const leftX = cx - hw + 4;
  const rightX = cx + hw - 20;
  const seg = (H - BORDER * 2 - 160) / 3;
  for (let i = 0; i < 3; i++) {
    const y0 = teeY - 80 - i * seg;
    if (i !== 1) walls.push(wall(leftX, y0 - seg * 0.65, 18, seg * 0.6));
    if (i !== 0) walls.push(wall(rightX, y0 - seg * 0.5, 18, seg * 0.6));
  }
  walls.push(wall(cx - hw * 0.75, cupY - hw * 0.7, hw * 1.5, 16));

  const bumpers: Bumper[] = [];
  const zones: Zone[] = [];
  if (rng() < 0.3) {
    const kinds = themeHazards(themeId);
    const z = zoneRect(cx, (teeY + cupY) / 2, hw * 0.65, 48, kinds[0], rng);
    if (keepZoneOnGreen(z, green, tee, cup)) zones.push(z);
  }

  return {
    green,
    tee,
    cup,
    walls: walls.filter((w) => keepWallClear(w, tee, cup, 36)),
    bumpers,
    zones,
    pathDir: { x: 0, y: cupY - teeY },
    difficulty: 0.48 + rng() * 0.25,
    pathLen: Math.abs(teeY - cupY),
  };
}

function buildRunaround(rng: () => number, W: number, H: number, themeId: HoleThemeId, par = 4): BuiltLayout {
  const hw = laneHalf(rng, 92, 120);
  const teeY = H - BORDER - 70;
  const cupY = BORDER + 70;
  const cx = W / 2;
  const green = rectCorridor(cx, teeY, cupY, hw, 26);
  const tee = { x: cx, y: teeY };
  const cup = { x: cx, y: cupY };
  const midY = (teeY + cupY) / 2;
  const walls: Wall[] = [];
  const bumpers: Bumper[] = [];
  const zones: Zone[] = [];

  const blockW = 80 + rng() * 50 + (par - 3) * 12;
  const blockH = 100 + rng() * 60 + (par - 3) * 16;
  walls.push(wall(cx - blockW / 2, midY - blockH / 2, blockW, blockH));

  const side = rng() < 0.5 ? -1 : 1;
  bumpers.push({
    x: cx + side * (blockW / 2 + 36),
    y: midY + (rng() - 0.5) * 24,
    r: 16 + rng() * 6,
  });

  if (rng() < 0.45) {
    const kinds = themeHazards(themeId);
    const z = zoneRect(cx - side * (blockW / 2 + 38), midY, 44, 60, kinds[0], rng);
    if (keepZoneOnGreen(z, green, tee, cup)) zones.push(z);
  }

  return {
    green,
    tee,
    cup,
    walls: walls.filter((w) => keepWallClear(w, tee, cup, 50)),
    bumpers,
    zones,
    pathDir: { x: 0, y: cupY - teeY },
    difficulty: 0.38 + rng() * 0.25,
    pathLen: Math.abs(teeY - cupY),
  };
}

function buildGate(rng: () => number, W: number, H: number, themeId: HoleThemeId, par = 3): BuiltLayout {
  const hw = laneHalf(rng, 88, 118);
  const teeY = H - BORDER - 70;
  const cupY = BORDER + 70;
  const cx = W / 2 + (rng() - 0.5) * 24;
  const gateY = H * (0.44 + rng() * 0.1);
  const green = rectCorridor(cx, teeY, cupY, hw, 26);
  const tee = { x: cx, y: teeY };
  const cupOff = (10 + par * 6) * (rng() < 0.5 ? 1 : -1);
  const cup = { x: cx + cupOff, y: cupY };
  // Offset gap so dead-center is blocked; skilled players thread the side
  const gap = Math.max(32, 52 - par * 5) + rng() * 16;
  const gapShift = (hw * 0.22 + rng() * 12) * (rng() < 0.5 ? 1 : -1);
  const walls: Wall[] = [];
  const leftEnd = cx + gapShift - gap / 2;
  const rightStart = cx + gapShift + gap / 2;
  walls.push(wall(cx - hw + 8, gateY - 12, Math.max(24, leftEnd - (cx - hw + 8)), 24));
  walls.push(wall(rightStart, gateY - 12, Math.max(24, cx + hw - 8 - rightStart), 24));
  // Second staggered gate on higher pars
  if (par >= 4) {
    const g2 = gateY + (cupY - gateY) * 0.45;
    const shift2 = -gapShift * 0.7;
    const gap2 = gap + 4;
    const l2 = cx + shift2 - gap2 / 2;
    const r2 = cx + shift2 + gap2 / 2;
    walls.push(wall(cx - hw + 8, g2 - 10, Math.max(20, l2 - (cx - hw + 8)), 20));
    walls.push(wall(r2, g2 - 10, Math.max(20, cx + hw - 8 - r2), 20));
  }

  const bumpers: Bumper[] = [];
  const zones: Zone[] = [];
  if (par >= 4 || rng() < 0.55) bumpers.push({ x: cx - gapShift * 0.3, y: gateY - 70, r: 14 + rng() * 5 });

  if (par >= 4 || rng() < 0.55) {
    const kinds = themeHazards(themeId);
    const z = zoneRect(cx + hw * 0.35, (teeY + gateY) / 2, 48, 64, kinds[0], rng);
    if (keepZoneOnGreen(z, green, tee, cup)) zones.push(z);
  }

  return {
    green,
    tee,
    cup,
    walls: walls.filter((w) => keepWallClear(w, tee, cup)),
    bumpers,
    zones,
    pathDir: { x: cup.x - tee.x, y: cupY - teeY },
    difficulty: 0.36 + par * 0.06 + rng() * 0.2,
    pathLen: Math.abs(teeY - cupY),
  };
}

function buildIsland(rng: () => number, W: number, H: number, themeId: HoleThemeId, par = 5): BuiltLayout {
  const teeY = H - BORDER - 72;
  const cupY = BORDER + 72;
  const cx = W / 2;
  const startHw = 100 + rng() * 40;
  const bridgeHw = 42 + rng() * 18;
  const islandHw = 88 + rng() * 36;
  const neckY0 = H * 0.48;
  const neckY1 = H * 0.34;
  const green = islandPoly(cx, teeY, cupY, startHw, bridgeHw, islandHw, neckY0, neckY1);
  const tee = { x: cx, y: teeY };
  const cup = { x: cx, y: cupY };
  const walls: Wall[] = [];
  const bumpers: Bumper[] = [];
  const zones: Zone[] = [];
  const kinds = themeHazards(themeId);
  const waterKind: Zone['kind'] = kinds.includes('water') ? 'water' : 'sand';
  const neckMidY = (neckY0 + neckY1) / 2;
  // Sand/water flanks sit on the wide pads beside the bridge (still on green)
  const zL = zoneRect(cx - (startHw + bridgeHw) / 2, neckMidY, 52, Math.abs(neckY0 - neckY1) + 20, waterKind, rng);
  const zR = zoneRect(cx + (startHw + bridgeHw) / 2, neckMidY, 52, Math.abs(neckY0 - neckY1) + 20, waterKind, rng);
  if (keepZoneOnGreen(zL, green, tee, cup)) zones.push(zL);
  if (keepZoneOnGreen(zR, green, tee, cup)) zones.push(zR);
  if (zones.length === 0) {
    const z = zoneRect(cx - startHw * 0.45, (teeY + neckY0) / 2, 48, 70, 'sand', rng);
    if (keepZoneOnGreen(z, green, tee, cup)) zones.push(z);
  }

  return {
    green,
    tee,
    cup,
    walls,
    bumpers,
    zones,
    pathDir: { x: 0, y: cupY - teeY },
    difficulty: 0.52 + rng() * 0.25,
    pathLen: Math.abs(teeY - cupY),
  };
}

function buildHill(rng: () => number, W: number, H: number, themeId: HoleThemeId, par = 3): BuiltLayout {
  const base = buildStraight(rng, W, H, themeId, par);
  base.difficulty = 0.38 + rng() * 0.2;
  base.walls = [];
  if (base.bumpers.length > 1) base.bumpers = base.bumpers.slice(0, 1);
  return base;
}

function buildHorseshoe(rng: () => number, W: number, H: number, themeId: HoleThemeId, par = 5): BuiltLayout {
  const hw = laneHalf(rng, 68, 92);
  const top = BORDER + 78;
  const bot = H - BORDER - 78;
  const left = W * (0.26 + rng() * 0.04);
  const right = W * (0.7 + rng() * 0.04);
  const green = uChannelPoly(left, right, top, bot, hw);
  const tee = { x: left, y: bot };
  const cup = { x: right, y: bot };
  const walls: Wall[] = [];
  const bumpers: Bumper[] = [];
  const zones: Zone[] = [];
  // Optional inner post (green is already U — post reinforces the hollow)
  const cx = (left + right) / 2;
  walls.push(wall(cx - 16, top + hw + 8, 32, Math.min(H * 0.28, bot - top - hw * 2.2)));
  if (rng() < 0.4) bumpers.push({ x: cx, y: top + 4, r: 15 + rng() * 5 });
  if (rng() < 0.35) {
    const kinds = themeHazards(themeId);
    const z = zoneRect(left, (top + bot) / 2, 44, 60, kinds[0], rng);
    if (keepZoneOnGreen(z, green, tee, cup)) zones.push(z);
  }
  return {
    green,
    tee,
    cup,
    walls: walls.filter((w) => keepWallClear(w, tee, cup, 50)),
    bumpers,
    zones,
    pathDir: { x: cup.x - tee.x, y: cup.y - tee.y },
    difficulty: 0.52 + rng() * 0.25,
    pathLen: Math.abs(bot - top) * 2 + Math.abs(right - left),
  };
}

function buildChicane(rng: () => number, W: number, H: number, themeId: HoleThemeId, par = 4): BuiltLayout {
  const hw = laneHalf(rng, 70, 96);
  const teeY = H - BORDER - 68;
  const cupY = BORDER + 68;
  const cx = W / 2;
  const offset = W * (0.14 + rng() * 0.08);
  const y1 = H * 0.68;
  const y2 = H * 0.5;
  const y3 = H * 0.32;
  const green = chicanePoly(cx, offset, teeY, y1, y2, y3, cupY, hw);
  const tee = { x: cx - offset, y: teeY };
  const cup = { x: cx + offset, y: cupY };
  const walls: Wall[] = [];
  const bumpers: Bumper[] = [];
  const zones: Zone[] = [];
  walls.push(wall(cx - offset - hw * 0.15, y1 - 10, 90 + rng() * 40, 18));
  walls.push(wall(cx + offset - 70, y2 - 10, 90 + rng() * 40, 18));

  if (rng() < 0.35) {
    const kinds = themeHazards(themeId);
    const z = zoneRect(cx + offset, y2, 48, 52, kinds[0], rng);
    if (keepZoneOnGreen(z, green, tee, cup)) zones.push(z);
  }

  return {
    green,
    tee,
    cup,
    walls: walls.filter((w) => keepWallClear(w, tee, cup)),
    bumpers,
    zones,
    pathDir: { x: cup.x - tee.x, y: cup.y - tee.y },
    difficulty: 0.48 + rng() * 0.25,
    pathLen: Math.abs(teeY - cupY) + offset * 4,
  };
}

function buildLayout(
  layout: LayoutId,
  rng: () => number,
  W: number,
  H: number,
  themeId: HoleThemeId,
  par: number,
): BuiltLayout {
  switch (layout) {
    case 'straight':
      return buildStraight(rng, W, H, themeId, par);
    case 'dogleg_l':
      return buildDogleg(rng, W, H, true, themeId, par);
    case 'dogleg_r':
      return buildDogleg(rng, W, H, false, themeId, par);
    case 'y_split':
      return buildYSplit(rng, W, H, themeId, par);
    case 's_curve':
      return buildSCurve(rng, W, H, themeId, par);
    case 'bank':
      return buildBank(rng, W, H, themeId, par);
    case 'runaround':
      return buildRunaround(rng, W, H, themeId, par);
    case 'gate':
      return buildGate(rng, W, H, themeId, par);
    case 'island':
      return buildIsland(rng, W, H, themeId, par);
    case 'hill':
      return buildHill(rng, W, H, themeId, par);
    case 'horseshoe':
      return buildHorseshoe(rng, W, H, themeId, par);
    case 'chicane':
      return buildChicane(rng, W, H, themeId, par);
    default:
      return buildStraight(rng, W, H, themeId, par);
  }
}

function findOnGreen(target: Vec2, green: Vec2[], minEdge: number): Vec2 {
  if (pointInPoly(target.x, target.y, green) && distToEdge(target.x, target.y, green) >= minEdge) {
    return { x: target.x, y: target.y };
  }
  for (let r = 4; r <= 160; r += 4) {
    for (let a = 0; a < 24; a++) {
      const ang = (a / 24) * Math.PI * 2;
      const x = target.x + Math.cos(ang) * r;
      const y = target.y + Math.sin(ang) * r;
      if (pointInPoly(x, y, green) && distToEdge(x, y, green) >= minEdge) return { x, y };
    }
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of green) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  let best: Vec2 | null = null;
  let bestD = Infinity;
  for (let y = minY; y <= maxY; y += 8) {
    for (let x = minX; x <= maxX; x += 8) {
      if (!pointInPoly(x, y, green) || distToEdge(x, y, green) < minEdge) continue;
      const d = Math.hypot(x - target.x, y - target.y);
      if (d < bestD) { bestD = d; best = { x, y }; }
    }
  }
  return best ?? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

function ensurePlayable(layout: BuiltLayout): BuiltLayout {
  const { green } = layout;
  layout.tee = findOnGreen(layout.tee, green, 22);
  layout.cup = findOnGreen(layout.cup, green, 24);
  if (Math.hypot(layout.cup.x - layout.tee.x, layout.cup.y - layout.tee.y) < 140) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of green) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    const away = {
      x: layout.tee.x < (minX + maxX) / 2 ? maxX - 40 : minX + 40,
      y: layout.tee.y < (minY + maxY) / 2 ? maxY - 40 : minY + 40,
    };
    layout.cup = findOnGreen(away, green, 24);
  }
  layout.walls = layout.walls.filter((w) => keepWallClear(w, layout.tee, layout.cup, 40));
  layout.bumpers = layout.bumpers.filter((b) => {
    const okTee = Math.hypot(b.x - layout.tee.x, b.y - layout.tee.y) > b.r + 36;
    const okCup = Math.hypot(b.x - layout.cup.x, b.y - layout.cup.y) > b.r + CUP_R + 28;
    return okTee && okCup && pointInPoly(b.x, b.y, green);
  });
  layout.zones = layout.zones.filter((z) => keepZoneOnGreen(z, green, layout.tee, layout.cup));
  return layout;
}

/**
 * Enforce ~22% / 56% / 22% par 3/4/5 across the 1000-hole pool.
 * Multiplicative hash makes adjacent ids scramble into buckets; for ids
 * 1..1000 this is a bijection mod 1000 ⇒ exactly 220 / 560 / 220.
 */
export function parForHoleId(id: number, poolSize = POOL_SIZE): number {
  const n = Math.max(1, poolSize);
  const slot = (((id - 1) * 761) % n + n) % n;
  if (slot < PAR3_SHARE) return 3;
  if (slot < PAR3_SHARE + PAR4_SHARE) return 4;
  return 5;
}

const PAR3_LAYOUTS: LayoutId[] = ['gate', 'straight', 'hill', 'runaround', 'bank', 'dogleg_l'];
const PAR4_LAYOUTS: LayoutId[] = ['dogleg_l', 'dogleg_r', 's_curve', 'bank', 'chicane', 'gate', 'runaround', 'y_split'];
const PAR5_LAYOUTS: LayoutId[] = ['horseshoe', 'island', 'y_split', 'chicane', 's_curve', 'dogleg_l', 'dogleg_r', 'bank'];

function layoutForPar(id: number, par: number): LayoutId {
  const list = par === 3 ? PAR3_LAYOUTS : par === 5 ? PAR5_LAYOUTS : PAR4_LAYOUTS;
  return list[(id - 1) % list.length];
}

/**
 * Place a blocker on/near the tee→cup line so a dead-center aim is not a free HIO.
 * Gap / offset keeps skilled bank or thread shots viable.
 */
function blockCenterShot(
  tee: Vec2,
  cup: Vec2,
  walls: Wall[],
  bumpers: Bumper[],
  par: number,
  rng: () => number,
  green: Vec2[],
): void {
  const dx = cup.x - tee.x;
  const dy = cup.y - tee.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  const px = -uy;
  const py = ux;
  // Midpoint blocker — slightly off-center so a bank/gap remains
  const t = 0.38 + rng() * 0.28;
  const mid = { x: tee.x + dx * t, y: tee.y + dy * t };
  const side = rng() < 0.5 ? 1 : -1;
  const offset = (par >= 5 ? 8 : 14) + rng() * 10;
  const bx = mid.x + px * side * offset;
  const by = mid.y + py * side * offset;

  if (par >= 4 || rng() < 0.75) {
    // Cross-bar with a side gap (gate) — blocks straight thread
    const barW = 48 + par * 10 + rng() * 24;
    const barH = 16 + (par >= 5 ? 4 : 0);
    // Orient bar roughly perpendicular to path (AABB approx)
    const alongDominant = Math.abs(dx) > Math.abs(dy);
    let w: Wall;
    if (alongDominant) {
      // path is horizontal-ish → vertical bar
      w = wall(bx - barH / 2, by - barW / 2, barH, barW);
    } else {
      w = wall(bx - barW / 2, by - barH / 2, barW, barH);
    }
    if (keepWallClear(w, tee, cup, 44) && pointInPoly(bx, by, green)) {
      walls.push(w);
    }
  }

  // Bumper on the remaining gap side for higher pars
  if (par >= 4 || rng() < 0.55) {
    const gapSide = -side;
    const gx = mid.x + px * gapSide * (22 + rng() * 18);
    const gy = mid.y + py * gapSide * (22 + rng() * 18);
    if (
      pointInPoly(gx, gy, green) &&
      Math.hypot(gx - tee.x, gy - tee.y) > 50 &&
      Math.hypot(gx - cup.x, gy - cup.y) > 50
    ) {
      bumpers.push({ x: gx, y: gy, r: 14 + rng() * 6 + (par >= 5 ? 2 : 0) });
    }
  }
}

/** Nudge cup off the pure centerline so "aim straight" misses. */
function offsetCupOffCenter(tee: Vec2, cup: Vec2, par: number, rng: () => number): Vec2 {
  const dx = cup.x - tee.x;
  const dy = cup.y - tee.y;
  const dist = Math.hypot(dx, dy) || 1;
  const px = -dy / dist;
  const py = dx / dist;
  const mag = (par === 3 ? 18 : par === 4 ? 28 : 36) + rng() * 16;
  const side = rng() < 0.5 ? 1 : -1;
  return { x: cup.x + px * side * mag, y: cup.y + py * side * mag };
}

/**
 * Procedurally generate one distinct hole from its catalog id (1..POOL_SIZE).
 * Built from named geometric layout templates (rect / L / U / Y / Z channels).
 */
export function generateHole(id: number): HoleDef {
  const rng = mulberry32(id * 2654435761 + 0x9e3779b9);
  const theme = themeForHoleId(id);
  const themeId = theme.id as HoleThemeId;
  const par = parForHoleId(id);
  const layout = layoutForPar(id, par);

  // Phone-filling fairways — size scales mildly with par
  const width = 560 + Math.floor(rng() * 180) + (par - 3) * 20;
  const height = 920 + Math.floor(rng() * 220) + (par - 3) * 40;

  let built = ensurePlayable(buildLayout(layout, rng, width, height, themeId, par));
  built.green = built.green.map((p) => ({
    x: clamp(p.x, 10, width - 10),
    y: clamp(p.y, 10, height - 10),
  }));
  // Offset cup so dead-center aim rarely threads
  built.cup = offsetCupOffCenter(built.tee, built.cup, par, rng);
  built = ensurePlayable(built);
  blockCenterShot(built.tee, built.cup, built.walls, built.bumpers, par, rng, built.green);
  built = ensurePlayable(built);

  // Extra hazard density for higher pars
  if (par >= 4 && built.zones.length < (par === 5 ? 2 : 1) && rng() < 0.7) {
    const kinds = themeHazards(themeId);
    const mid = lerp(built.tee, built.cup, 0.45 + rng() * 0.2);
    const z = zoneRect(mid.x + (rng() - 0.5) * 40, mid.y, 44 + rng() * 20, 55 + rng() * 30, kinds[0], rng);
    if (keepZoneOnGreen(z, built.green, built.tee, built.cup)) built.zones.push(z);
  }

  const grass = makeGrass(id, rng);
  const wind = makeWind(rng);
  const topo = makeTopo(rng, built.pathDir, topoIntensity(par, layout, rng));
  const slope = slopeFromTopo(topo);

  return {
    id,
    name: holeName(id, rng, layout),
    par,
    width: Math.round(width),
    height: Math.round(height),
    green: roundPts(built.green),
    tee: { x: Math.round(built.tee.x), y: Math.round(built.tee.y) },
    cup: { x: Math.round(built.cup.x), y: Math.round(built.cup.y) },
    cupRadius: CUP_R,
    walls: built.walls,
    bumpers: built.bumpers,
    zones: built.zones,
    theme: themeId,
    grass,
    wind: {
      x: Math.round(wind.dir.x * 1000) / 1000,
      y: Math.round(wind.dir.y * 1000) / 1000,
    },
    windMph: wind.mph,
    topo,
    slope: { x: Math.round(slope.x * 1000) / 1000, y: Math.round(slope.y * 1000) / 1000 },
  };
}

export function buildHolePool(size = POOL_SIZE): HoleDef[] {
  const pool: HoleDef[] = [];
  for (let id = 1; id <= size; id++) pool.push(generateHole(id));
  return pool;
}

export function pickCourseIds(seed: number, count = ROUND_HOLES, poolSize = POOL_SIZE): number[] {
  const rng = mulberry32(seed >>> 0 || 1);
  const ids = Array.from({ length: poolSize }, (_, i) => i + 1);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, count);
}

/** 0–1 strength from mph (0–25). */
export function windStrengthFromMph(mph: number): number {
  return Math.min(1, Math.max(0, mph) / WIND_MAX_MPH);
}

/** Legacy helper — prefer windStrengthFromMph(hole.windMph). */
export function windStrength(wind: Vec2, windMph?: number): number {
  if (windMph != null) return windStrengthFromMph(windMph);
  return Math.min(1, Math.hypot(wind.x, wind.y));
}

export function slopeStrength(slope: Vec2): number {
  return Math.min(1, Math.hypot(slope.x, slope.y) / 1.1);
}

export const WIND_CALM_THRESHOLD = 0.5; // mph

/** Exported for tests / debugging. */
export function layoutForHoleId(id: number): LayoutId {
  const par = parForHoleId(id);
  return layoutForPar(id, par);
}
