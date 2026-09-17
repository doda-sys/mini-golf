import type { Bumper, GrassPattern, HoleDef, Vec2, Wall, Zone } from '../types';
import { themeForHoleId, type HoleThemeId } from './themes';

const CUP_R = 16;
const BORDER = 22;
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
  /** Preferred downhill for hill layouts (unit-ish). */
  pathDir: Vec2;
  difficulty: number; // 0..1
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

/** Expand a centerline into a fairway polygon (left side then right reversed). */
function corridor(centerline: Vec2[], halfWidth: number | ((i: number) => number)): Vec2[] {
  const n = centerline.length;
  if (n < 2) return [];
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = centerline[Math.max(0, i - 1)];
    const next = centerline[Math.min(n - 1, i + 1)];
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    const nx = -ty;
    const ny = tx;
    const w = typeof halfWidth === 'function' ? halfWidth(i) : halfWidth;
    left.push({ x: centerline[i].x + nx * w, y: centerline[i].y + ny * w });
    right.push({ x: centerline[i].x - nx * w, y: centerline[i].y - ny * w });
  }
  // Cap ends with a few fan points for softer tee/cup bulbs
  const start = centerline[0];
  const end = centerline[n - 1];
  const t0x = centerline[1].x - start.x;
  const t0y = centerline[1].y - start.y;
  const t0l = Math.hypot(t0x, t0y) || 1;
  const sTx = t0x / t0l;
  const sTy = t0y / t0l;
  const eTx = end.x - centerline[n - 2].x;
  const eTy = end.y - centerline[n - 2].y;
  const eTl = Math.hypot(eTx, eTy) || 1;
  const eNx = eTx / eTl;
  const eNy = eTy / eTl;
  const hw0 = typeof halfWidth === 'function' ? halfWidth(0) : halfWidth;
  const hwN = typeof halfWidth === 'function' ? halfWidth(n - 1) : halfWidth;

  const startCap: Vec2[] = [];
  const endCap: Vec2[] = [];
  for (let k = 1; k <= 5; k++) {
    const a = Math.PI + (k / 6) * Math.PI; // around start facing back
    const c = Math.cos(a);
    const s = Math.sin(a);
    // rotate local (-sTx,-sTy) frame
    const lx = -sTx;
    const ly = -sTy;
    const rx = -sTy;
    const ry = sTx;
    startCap.push({
      x: start.x + (lx * c + rx * s) * hw0,
      y: start.y + (ly * c + ry * s) * hw0,
    });
  }
  for (let k = 1; k <= 5; k++) {
    const a = (k / 6) * Math.PI;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const lx = eNx;
    const ly = eNy;
    const rx = -eNy;
    const ry = eNx;
    endCap.push({
      x: end.x + (lx * c + rx * s) * hwN,
      y: end.y + (ly * c + ry * s) * hwN,
    });
  }

  return [...startCap, ...left, ...endCap, ...right.reverse()];
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
  if (Math.hypot(cx - tee.x, cy - tee.y) < 48) return false;
  if (Math.hypot(cx - cup.x, cy - cup.y) < 52) return false;
  return true;
}

function keepWallClear(w: Wall, tee: Vec2, cup: Vec2, pad = 36): boolean {
  const hits = (px: number, py: number) =>
    px >= w.x - pad && px <= w.x + w.w + pad && py >= w.y - pad && py <= w.y + w.h + pad;
  return !hits(tee.x, tee.y) && !hits(cup.x, cup.y);
}

function makeGrass(id: number, rng: () => number): GrassPattern {
  const pal = CARPET_PALETTES[id % CARPET_PALETTES.length];
  const [a, b, sheen] = pal;
  // Always short-nap carpet mow — angle near fairway axis (mostly vertical play)
  const angle = (rng() - 0.5) * 0.35 + (rng() < 0.5 ? 0 : Math.PI / 2);
  const width = 16 + rng() * 10;
  return { kind: 'carpet', width, angle, a, b, sheen };
}

/** Gentle wind — mostly calm; never wrecks fair designs. */
function makeWind(rng: () => number): Vec2 {
  if (rng() < 0.55) return { x: 0, y: 0 };
  const ang = rng() * Math.PI * 2;
  const mag = rng() < 0.7 ? 0.14 + rng() * 0.22 : 0.32 + rng() * 0.22; // ~0.14–0.54
  return { x: Math.cos(ang) * mag, y: Math.sin(ang) * mag };
}

/** Slope: rare & gentle unless layout wants a hill break. */
function makeSlope(id: number, layout: LayoutId, pathDir: Vec2, rng: () => number): Vec2 {
  const wantHill = layout === 'hill' || rng() < 0.1;
  if (!wantHill) return { x: 0, y: 0 };
  const pl = Math.hypot(pathDir.x, pathDir.y) || 1;
  // Prefer along-fairway break (readable), with slight lateral mix
  const along = { x: pathDir.x / pl, y: pathDir.y / pl };
  const lat = { x: -along.y, y: along.x };
  const mix = 0.15 + rng() * 0.35;
  const side = rng() < 0.5 ? 1 : -1;
  const dx = along.x * (1 - mix) + lat.x * mix * side;
  const dy = along.y * (1 - mix) + lat.y * mix * side;
  const dl = Math.hypot(dx, dy) || 1;
  const mag = layout === 'hill' ? 0.22 + rng() * 0.28 : 0.14 + rng() * 0.2;
  return { x: (dx / dl) * mag, y: (dy / dl) * mag };
}

// ─── Layout builders (tee near start, cup near end) ─────────────────────────

function buildStraight(rng: () => number, W: number, H: number, themeId: HoleThemeId): BuiltLayout {
  const laneW = 70 + rng() * 50;
  const teeY = H - BORDER - 50;
  const cupY = BORDER + 50;
  const cx = W / 2 + (rng() - 0.5) * 40;
  const path = [
    { x: cx, y: teeY },
    { x: cx + (rng() - 0.5) * 20, y: (teeY + cupY) / 2 },
    { x: cx + (rng() - 0.5) * 30, y: cupY },
  ];
  const green = corridor(path, laneW / 2);
  const tee = { ...path[0] };
  const cup = { ...path[2] };
  const walls: Wall[] = [];
  const bumpers: Bumper[] = [];
  const zones: Zone[] = [];
  const kinds = themeHazards(themeId);

  // Optional side sand / deco bumper — risk on edges, center clear
  if (rng() < 0.55) {
    const mid = path[1];
    const side = rng() < 0.5 ? -1 : 1;
    const z = zoneRect(mid.x + side * (laneW * 0.28), mid.y, 42 + rng() * 24, 56 + rng() * 30, kinds[0], rng);
    if (keepZoneOnGreen(z, green, tee, cup)) zones.push(z);
  }
  if (rng() < 0.35) {
    const mid = lerp(path[0], path[2], 0.55);
    bumpers.push({ x: mid.x + (rng() - 0.5) * laneW * 0.35, y: mid.y, r: 14 + rng() * 6 });
  }
  return {
    green,
    tee,
    cup,
    walls,
    bumpers,
    zones,
    pathDir: { x: cup.x - tee.x, y: cup.y - tee.y },
    difficulty: 0.15 + rng() * 0.2,
    pathLen: pathLength(path),
  };
}

function buildDogleg(rng: () => number, W: number, H: number, left: boolean, themeId: HoleThemeId): BuiltLayout {
  const hw = 48 + rng() * 28;
  const teeY = H - BORDER - 48;
  const cupY = BORDER + 48;
  const cornerY = H * (0.42 + rng() * 0.14);
  const stemX = left ? W * (0.28 + rng() * 0.1) : W * (0.62 + rng() * 0.1);
  const cupX = left ? W * (0.62 + rng() * 0.12) : W * (0.26 + rng() * 0.12);
  const path = [
    { x: stemX, y: teeY },
    { x: stemX, y: cornerY + 40 },
    { x: stemX, y: cornerY },
    { x: lerp({ x: stemX, y: 0 }, { x: cupX, y: 0 }, 0.45).x, y: cornerY },
    { x: cupX, y: cornerY },
    { x: cupX, y: cupY + 30 },
    { x: cupX, y: cupY },
  ];
  const green = corridor(path, (i) => (i <= 1 || i >= 5 ? hw * 1.05 : hw));
  const tee = { ...path[0] };
  const cup = { ...path[path.length - 1] };
  const walls: Wall[] = [];
  const bumpers: Bumper[] = [];
  const zones: Zone[] = [];

  // Corner block — long safe dogleg vs thin risky cut
  const blockW = 18;
  const blockH = 70 + rng() * 40;
  const gap = 28 + rng() * 18; // shortcut gap size
  if (left) {
    // Wall sits inside the elbow, leaving optional gap toward the short cut
    const wx = stemX + hw * 0.15;
    const wy = cornerY - blockH * 0.35;
    const w = wall(wx, wy, Math.max(40, cupX - stemX - gap - hw * 0.3), blockW);
    if (keepWallClear(w, tee, cup)) walls.push(w);
    // Vertical post closing most of shortcut
    const post = wall(cupX - hw * 0.9, cornerY + 8, blockW, Math.max(36, teeY - cornerY - 100));
    // Only if it doesn't seal tee
    if (keepWallClear(post, tee, cup, 44) && post.h > 40) {
      /* skip tall post that blocks play — use bumper instead */
    }
  } else {
    const wx = cupX + hw * 0.2;
    const w = wall(wx, cornerY - blockW / 2, Math.max(40, stemX - cupX - gap - hw * 0.3), blockW);
    if (keepWallClear(w, tee, cup)) walls.push(w);
  }

  // Risk–reward: bumper guarding the short corner
  bumpers.push({
    x: lerp({ x: stemX, y: cornerY }, { x: cupX, y: cornerY }, 0.35).x,
    y: cornerY - (left ? -1 : 1) * (8 + rng() * 10),
    r: 15 + rng() * 5,
  });

  if (rng() < 0.5) {
    const kinds = themeHazards(themeId);
    const z = zoneRect(
      lerp(path[0], path[2], 0.5).x + (left ? hw * 0.35 : -hw * 0.35),
      lerp(path[0], path[2], 0.55).y,
      40 + rng() * 20,
      70 + rng() * 40,
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
    difficulty: 0.45 + rng() * 0.25,
    pathLen: pathLength(path),
  };
}

function buildYSplit(rng: () => number, W: number, H: number, themeId: HoleThemeId): BuiltLayout {
  const hw = 44 + rng() * 22;
  const teeY = H - BORDER - 48;
  const forkY = H * (0.48 + rng() * 0.1);
  const cupY = BORDER + 50;
  const cx = W / 2;
  const spread = W * (0.18 + rng() * 0.1);
  // Build as merged corridors: stem + left arm + right arm meeting at cup plateau
  const stem = [
    { x: cx, y: teeY },
    { x: cx, y: forkY + 20 },
    { x: cx, y: forkY },
  ];
  const leftArm = [
    { x: cx, y: forkY },
    { x: cx - spread, y: forkY - 40 },
    { x: cx - spread * 0.4, y: cupY + 40 },
    { x: cx, y: cupY },
  ];
  const rightArm = [
    { x: cx, y: forkY },
    { x: cx + spread, y: forkY - 40 },
    { x: cx + spread * 0.4, y: cupY + 40 },
    { x: cx, y: cupY },
  ];
  // Approximate Y as a single centerline that goes left then to cup (playable),
  // plus widen at fork — use the longer scenic route as green shape via union-ish fat poly
  const scenic = [...stem, ...leftArm.slice(1)];
  const green = corridor(scenic, (i) => (i < 2 ? hw : hw * (0.95 + (i > 4 ? 0.15 : 0))));
  // Expand green to also cover right arm by adding a second corridor hull points
  const rightPoly = corridor([...stem, ...rightArm.slice(1)], hw);
  // Merge: take bounding union via combining points then convex? No — use stadium merge:
  // Rebuild as polygon that includes both arms explicitly
  const tee = { x: cx, y: teeY };
  const cup = { x: cx, y: cupY };
  const merged = buildYPolygon(cx, teeY, forkY, cupY, spread, hw);

  const walls: Wall[] = [];
  const bumpers: Bumper[] = [];
  const zones: Zone[] = [];

  // Center divider at fork — choose left (safer wider) vs right (tighter)
  walls.push(wall(cx - 9, forkY - 70 - rng() * 30, 18, 55 + rng() * 25));

  if (rng() < 0.6) {
    const kinds = themeHazards(themeId);
    const z = zoneRect(cx + spread * 0.7, forkY - 50, 36 + rng() * 16, 50 + rng() * 24, kinds[0], rng);
    if (keepZoneOnGreen(z, merged, tee, cup)) zones.push(z);
  }
  if (rng() < 0.4) bumpers.push({ x: cx - spread * 0.55, y: forkY - 30, r: 14 + rng() * 5 });

  void green;
  void rightPoly;
  void scenic;

  return {
    green: merged,
    tee,
    cup,
    walls: walls.filter((w) => keepWallClear(w, tee, cup)),
    bumpers,
    zones,
    pathDir: { x: 0, y: cupY - teeY },
    difficulty: 0.5 + rng() * 0.2,
    pathLen: Math.abs(teeY - cupY) + spread,
  };
}

/** Explicit Y / fork fairway polygon. */
function buildYPolygon(
  cx: number,
  teeY: number,
  forkY: number,
  cupY: number,
  spread: number,
  hw: number,
): Vec2[] {
  return [
    { x: cx - hw, y: teeY + hw * 0.6 },
    { x: cx + hw, y: teeY + hw * 0.6 },
    { x: cx + hw, y: forkY + 10 },
    { x: cx + spread + hw * 0.85, y: forkY - 50 },
    { x: cx + spread * 0.35 + hw, y: cupY + 20 },
    { x: cx + hw * 0.9, y: cupY - hw * 0.5 },
    { x: cx - hw * 0.9, y: cupY - hw * 0.5 },
    { x: cx - spread * 0.35 - hw, y: cupY + 20 },
    { x: cx - spread - hw * 0.85, y: forkY - 50 },
    { x: cx - hw, y: forkY + 10 },
  ];
}

function buildSCurve(rng: () => number, W: number, H: number, themeId: HoleThemeId): BuiltLayout {
  const hw = 42 + rng() * 20;
  const teeY = H - BORDER - 48;
  const cupY = BORDER + 48;
  const amp = W * (0.16 + rng() * 0.1);
  const cx = W / 2;
  const path: Vec2[] = [];
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = teeY + (cupY - teeY) * t;
    const x = cx + Math.sin(t * Math.PI * 2) * amp;
    path.push({ x, y });
  }
  const green = corridor(path, hw);
  const tee = { ...path[0] };
  const cup = { ...path[path.length - 1] };
  const walls: Wall[] = [];
  const bumpers: Bumper[] = [];
  const zones: Zone[] = [];

  // Inner banks at the two bends — guide the S
  const b1 = path[2];
  const b2 = path[6];
  walls.push(wall(b1.x - amp * 0.15 - 10, b1.y - 8, 55 + rng() * 20, 16));
  walls.push(wall(b2.x + amp * 0.05 - 40, b2.y - 8, 55 + rng() * 20, 16));
  const filtered = walls.filter((w) => keepWallClear(w, tee, cup));

  if (rng() < 0.45) {
    const kinds = themeHazards(themeId);
    const mid = path[4];
    const z = zoneRect(mid.x, mid.y, 40, 48, kinds[Math.floor(rng() * kinds.length)], rng);
    if (keepZoneOnGreen(z, green, tee, cup)) zones.push(z);
  }

  return {
    green,
    tee,
    cup,
    walls: filtered,
    bumpers,
    zones,
    pathDir: { x: cup.x - tee.x, y: cup.y - tee.y },
    difficulty: 0.55 + rng() * 0.2,
    pathLen: pathLength(path),
  };
}

function buildBank(rng: () => number, W: number, H: number, themeId: HoleThemeId): BuiltLayout {
  const hw = 38 + rng() * 16;
  const teeY = H - BORDER - 48;
  const cupY = BORDER + 48;
  const cx = W / 2 + (rng() - 0.5) * 30;
  const path = [
    { x: cx, y: teeY },
    { x: cx, y: (teeY + cupY) / 2 },
    { x: cx, y: cupY },
  ];
  const green = corridor(path, hw + 8);
  const tee = { ...path[0] };
  const cup = { ...path[2] };
  const walls: Wall[] = [];
  // Parallel rails forming bank-shot corridor with staggered gaps
  const leftX = cx - hw - 6;
  const rightX = cx + hw - 12;
  const seg = (H - BORDER * 2 - 120) / 3;
  for (let i = 0; i < 3; i++) {
    const y0 = teeY - 60 - i * seg;
    if (i !== 1) walls.push(wall(leftX, y0 - seg * 0.7, 16, seg * 0.65));
    if (i !== 0) walls.push(wall(rightX, y0 - seg * 0.55, 16, seg * 0.65));
  }
  // End backboard for bank into cup
  walls.push(wall(cx - hw * 0.7, cupY - hw * 0.85, hw * 1.4, 14));

  const bumpers: Bumper[] = [];
  const zones: Zone[] = [];
  if (rng() < 0.35) {
    const kinds = themeHazards(themeId);
    const z = zoneRect(cx, (teeY + cupY) / 2, hw * 0.7, 40, kinds[0], rng);
    if (keepZoneOnGreen(z, green, tee, cup)) zones.push(z);
  }

  return {
    green,
    tee,
    cup,
    walls: walls.filter((w) => keepWallClear(w, tee, cup, 28)),
    bumpers,
    zones,
    pathDir: { x: 0, y: cupY - teeY },
    difficulty: 0.5 + rng() * 0.25,
    pathLen: Math.abs(teeY - cupY),
  };
}

function buildRunaround(rng: () => number, W: number, H: number, themeId: HoleThemeId): BuiltLayout {
  const hw = 55 + rng() * 30;
  const teeY = H - BORDER - 50;
  const cupY = BORDER + 50;
  const cx = W / 2;
  const path = [
    { x: cx, y: teeY },
    { x: cx, y: (teeY + cupY) / 2 },
    { x: cx, y: cupY },
  ];
  const green = corridor(path, hw);
  const tee = { ...path[0] };
  const cup = { ...path[2] };
  const mid = path[1];
  const walls: Wall[] = [];
  const bumpers: Bumper[] = [];
  const zones: Zone[] = [];

  // Central island obstacle — must go left or right
  const blockW = 50 + rng() * 40;
  const blockH = 70 + rng() * 50;
  walls.push(wall(mid.x - blockW / 2, mid.y - blockH / 2, blockW, blockH));

  // Optional bumper on one side making that route spicier
  const side = rng() < 0.5 ? -1 : 1;
  bumpers.push({ x: mid.x + side * (blockW / 2 + 28), y: mid.y + (rng() - 0.5) * 20, r: 15 + rng() * 6 });

  if (rng() < 0.5) {
    const kinds = themeHazards(themeId);
    const z = zoneRect(mid.x - side * (blockW / 2 + 30), mid.y, 36, 50, kinds[0], rng);
    if (keepZoneOnGreen(z, green, tee, cup)) zones.push(z);
  }

  return {
    green,
    tee,
    cup,
    walls: walls.filter((w) => keepWallClear(w, tee, cup, 40)),
    bumpers,
    zones,
    pathDir: { x: 0, y: cupY - teeY },
    difficulty: 0.4 + rng() * 0.25,
    pathLen: Math.abs(teeY - cupY),
  };
}

function buildGate(rng: () => number, W: number, H: number, themeId: HoleThemeId): BuiltLayout {
  const hw = 58 + rng() * 32;
  const teeY = H - BORDER - 50;
  const cupY = BORDER + 50;
  const cx = W / 2 + (rng() - 0.5) * 24;
  const gateY = H * (0.45 + rng() * 0.12);
  const path = [
    { x: cx, y: teeY },
    { x: cx, y: gateY },
    { x: cx, y: cupY },
  ];
  const green = corridor(path, (i) => (i === 1 ? hw * 0.85 : hw));
  const tee = { ...path[0] };
  const cup = { ...path[2] };
  const gap = 32 + rng() * 22;
  const walls: Wall[] = [];
  const half = hw * 0.85;
  walls.push(wall(cx - half, gateY - 10, half - gap / 2, 20));
  walls.push(wall(cx + gap / 2, gateY - 10, half - gap / 2, 20));

  const bumpers: Bumper[] = [];
  const zones: Zone[] = [];
  if (rng() < 0.4) bumpers.push({ x: cx, y: gateY - 55, r: 13 + rng() * 5 });

  if (rng() < 0.5) {
    const kinds = themeHazards(themeId);
    const z = zoneRect(cx + hw * 0.35, (teeY + gateY) / 2, 40, 55, kinds[0], rng);
    if (keepZoneOnGreen(z, green, tee, cup)) zones.push(z);
  }

  return {
    green,
    tee,
    cup,
    walls: walls.filter((w) => keepWallClear(w, tee, cup)),
    bumpers,
    zones,
    pathDir: { x: 0, y: cupY - teeY },
    difficulty: 0.35 + rng() * 0.25,
    pathLen: Math.abs(teeY - cupY),
  };
}

function buildIsland(rng: () => number, W: number, H: number, themeId: HoleThemeId): BuiltLayout {
  const teeY = H - BORDER - 52;
  const cupY = BORDER + 52;
  const cx = W / 2;
  const startW = 70 + rng() * 36;
  const neckW = 28 + rng() * 14;
  const islandW = 58 + rng() * 28;
  const neckY0 = H * 0.42;
  const neckY1 = H * 0.32;
  const path = [
    { x: cx, y: teeY },
    { x: cx, y: neckY0 + 40 },
    { x: cx, y: (neckY0 + neckY1) / 2 },
    { x: cx, y: neckY1 - 20 },
    { x: cx, y: cupY },
  ];
  const green = corridor(path, (i) => {
    if (i <= 1) return startW / 2;
    if (i === 2) return neckW / 2;
    return islandW / 2;
  });
  const tee = { ...path[0] };
  const cup = { ...path[path.length - 1] };
  const walls: Wall[] = [];
  const bumpers: Bumper[] = [];
  const zones: Zone[] = [];
  const kinds = themeHazards(themeId);
  // Water flanks the neck — miss the bridge and splash
  const waterKind: Zone['kind'] = kinds.includes('water') ? 'water' : 'sand';
  const neckMid = path[2];
  const zL = zoneRect(neckMid.x - neckW / 2 - 36, neckMid.y, 48, Math.abs(neckY0 - neckY1) + 30, waterKind, rng);
  const zR = zoneRect(neckMid.x + neckW / 2 + 36, neckMid.y, 48, Math.abs(neckY0 - neckY1) + 30, waterKind, rng);
  if (keepZoneOnGreen(zL, green, tee, cup)) zones.push(zL);
  if (keepZoneOnGreen(zR, green, tee, cup)) zones.push(zR);
  // If zones fell off green (narrow), place sand on start pad edges instead
  if (zones.length === 0) {
    const z = zoneRect(cx - startW * 0.3, (teeY + neckY0) / 2, 40, 60, 'sand', rng);
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
    difficulty: 0.55 + rng() * 0.25,
    pathLen: Math.abs(teeY - cupY),
  };
}

function buildHill(rng: () => number, W: number, H: number, themeId: HoleThemeId): BuiltLayout {
  // Wide readable fairway — slope is the star
  const base = buildStraight(rng, W, H, themeId);
  base.difficulty = 0.4 + rng() * 0.2;
  // Clear heavy clutter so break is fair
  base.walls = [];
  if (base.bumpers.length > 1) base.bumpers = base.bumpers.slice(0, 1);
  return base;
}

function buildHorseshoe(rng: () => number, W: number, H: number, themeId: HoleThemeId): BuiltLayout {
  const hw = 44 + rng() * 18;
  const cx = W / 2;
  const top = BORDER + 55;
  const bot = H - BORDER - 55;
  const left = W * 0.28;
  const right = W * 0.72;
  const path = [
    { x: left, y: bot },
    { x: left, y: top + 40 },
    { x: left, y: top },
    { x: cx, y: top },
    { x: right, y: top },
    { x: right, y: top + 40 },
    { x: right, y: bot },
  ];
  const green = corridor(path, hw);
  const tee = { ...path[0] };
  const cup = { ...path[path.length - 1] };
  const walls: Wall[] = [];
  const bumpers: Bumper[] = [];
  const zones: Zone[] = [];
  // Inner wall so you must run the U (or bank the top)
  walls.push(wall(cx - 14, top + hw * 0.6, 28, Math.min(H * 0.35, bot - top - hw * 2)));
  if (rng() < 0.45) bumpers.push({ x: cx, y: top + 8, r: 14 + rng() * 5 });
  if (rng() < 0.4) {
    const kinds = themeHazards(themeId);
    const z = zoneRect(left + 10, (top + bot) / 2, 36, 50, kinds[0], rng);
    if (keepZoneOnGreen(z, green, tee, cup)) zones.push(z);
  }
  return {
    green,
    tee,
    cup,
    walls: walls.filter((w) => keepWallClear(w, tee, cup, 40)),
    bumpers,
    zones,
    pathDir: { x: cup.x - tee.x, y: cup.y - tee.y },
    difficulty: 0.55 + rng() * 0.25,
    pathLen: pathLength(path),
  };
}

function buildChicane(rng: () => number, W: number, H: number, themeId: HoleThemeId): BuiltLayout {
  const hw = 46 + rng() * 20;
  const teeY = H - BORDER - 48;
  const cupY = BORDER + 48;
  const cx = W / 2;
  const offset = W * (0.12 + rng() * 0.08);
  const path = [
    { x: cx - offset, y: teeY },
    { x: cx - offset, y: H * 0.65 },
    { x: cx + offset, y: H * 0.5 },
    { x: cx - offset * 0.3, y: H * 0.35 },
    { x: cx + offset * 0.2, y: cupY },
  ];
  const green = corridor(path, hw);
  const tee = { ...path[0] };
  const cup = { ...path[path.length - 1] };
  const walls: Wall[] = [];
  const bumpers: Bumper[] = [];
  const zones: Zone[] = [];
  // Staggered walls creating zig-zag gates
  walls.push(wall(cx - offset - hw * 0.2, H * 0.58, 70 + rng() * 30, 16));
  walls.push(wall(cx + offset - 50, H * 0.42, 70 + rng() * 30, 16));

  if (rng() < 0.4) {
    const kinds = themeHazards(themeId);
    const z = zoneRect(path[2].x, path[2].y, 40, 44, kinds[0], rng);
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
    difficulty: 0.5 + rng() * 0.25,
    pathLen: pathLength(path),
  };
}

function buildLayout(layout: LayoutId, rng: () => number, W: number, H: number, themeId: HoleThemeId): BuiltLayout {
  switch (layout) {
    case 'straight':
      return buildStraight(rng, W, H, themeId);
    case 'dogleg_l':
      return buildDogleg(rng, W, H, true, themeId);
    case 'dogleg_r':
      return buildDogleg(rng, W, H, false, themeId);
    case 'y_split':
      return buildYSplit(rng, W, H, themeId);
    case 's_curve':
      return buildSCurve(rng, W, H, themeId);
    case 'bank':
      return buildBank(rng, W, H, themeId);
    case 'runaround':
      return buildRunaround(rng, W, H, themeId);
    case 'gate':
      return buildGate(rng, W, H, themeId);
    case 'island':
      return buildIsland(rng, W, H, themeId);
    case 'hill':
      return buildHill(rng, W, H, themeId);
    case 'horseshoe':
      return buildHorseshoe(rng, W, H, themeId);
    case 'chicane':
      return buildChicane(rng, W, H, themeId);
    default:
      return buildStraight(rng, W, H, themeId);
  }
}

/** Find a point on the green near a target (spiral search). */
function findOnGreen(target: Vec2, green: Vec2[], minEdge: number): Vec2 {
  if (pointInPoly(target.x, target.y, green) && distToEdge(target.x, target.y, green) >= minEdge) {
    return { x: target.x, y: target.y };
  }
  for (let r = 4; r <= 140; r += 4) {
    for (let a = 0; a < 20; a++) {
      const ang = (a / 20) * Math.PI * 2;
      const x = target.x + Math.cos(ang) * r;
      const y = target.y + Math.sin(ang) * r;
      if (pointInPoly(x, y, green) && distToEdge(x, y, green) >= minEdge) return { x, y };
    }
  }
  // Last resort: denser scan of bbox
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
  // Keep tee/cup on green near their intended path ends (corridor end-caps can drift)
  layout.tee = findOnGreen(layout.tee, green, 18);
  layout.cup = findOnGreen(layout.cup, green, 20);
  // Ensure separation so hole isn't trivial/broken
  if (Math.hypot(layout.cup.x - layout.tee.x, layout.cup.y - layout.tee.y) < 100) {
    // Push cup toward opposite side of green bbox
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of green) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    const away = {
      x: layout.tee.x < (minX + maxX) / 2 ? maxX - 30 : minX + 30,
      y: layout.tee.y < (minY + maxY) / 2 ? maxY - 30 : minY + 30,
    };
    layout.cup = findOnGreen(away, green, 20);
  }
  // Drop walls that somehow cover tee/cup
  layout.walls = layout.walls.filter((w) => keepWallClear(w, layout.tee, layout.cup, 32));
  layout.bumpers = layout.bumpers.filter((b) => {
    const okTee = Math.hypot(b.x - layout.tee.x, b.y - layout.tee.y) > b.r + 28;
    const okCup = Math.hypot(b.x - layout.cup.x, b.y - layout.cup.y) > b.r + CUP_R + 20;
    return okTee && okCup && pointInPoly(b.x, b.y, green);
  });
  layout.zones = layout.zones.filter((z) => keepZoneOnGreen(z, green, layout.tee, layout.cup));
  return layout;
}

function computePar(
  pathLen: number,
  difficulty: number,
  layout: LayoutId,
  rng: () => number,
): number {
  // Classic putt-putt: mostly par 2–3, some 4, rare 5. pathLen is often 450–900px.
  let par = 2;
  if (layout === 'straight' || layout === 'gate' || layout === 'hill') {
    par = pathLen > 620 || difficulty > 0.4 ? 3 : 2;
  } else if (
    layout === 'dogleg_l' ||
    layout === 'dogleg_r' ||
    layout === 'runaround' ||
    layout === 'bank' ||
    layout === 's_curve'
  ) {
    par = 3;
    if (difficulty > 0.62 && pathLen > 780) par = 4;
  } else {
    // y_split, island, horseshoe, chicane
    par = 3;
    if (difficulty > 0.55 || pathLen > 820) par = 4;
  }
  if (rng() < 0.08 && par < 4) par += 1;
  if (rng() < 0.04 && par === 4) par = 5;
  return clamp(par, 2, 5);
}

/**
 * Procedurally generate one distinct hole from its catalog id (1..POOL_SIZE).
 * Built from named layout templates + seeded variation (not noise polygons).
 */
export function generateHole(id: number): HoleDef {
  const rng = mulberry32(id * 2654435761 + 0x9e3779b9);
  const theme = themeForHoleId(id);
  const themeId = theme.id as HoleThemeId;
  const layout = LAYOUTS[(id - 1) % LAYOUTS.length];

  // Size variety — taller for longer narratives
  const width = 440 + Math.floor(rng() * 140);
  const height = 660 + Math.floor(rng() * 160);

  let built = ensurePlayable(buildLayout(layout, rng, width, height, themeId));
  // Clamp green verts into bounds with small margin
  built.green = built.green.map((p) => ({
    x: clamp(p.x, 8, width - 8),
    y: clamp(p.y, 8, height - 8),
  }));
  built = ensurePlayable(built);

  const grass = makeGrass(id, rng);
  const wind = makeWind(rng);
  const slope = makeSlope(id, layout, built.pathDir, rng);
  const par = computePar(built.pathLen, built.difficulty, layout, rng);

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
    wind: { x: Math.round(wind.x * 1000) / 1000, y: Math.round(wind.y * 1000) / 1000 },
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

export function windStrength(wind: Vec2): number {
  return Math.min(1, Math.hypot(wind.x, wind.y) / 1.2);
}

export function slopeStrength(slope: Vec2): number {
  return Math.min(1, Math.hypot(slope.x, slope.y) / 1.1);
}

export const WIND_CALM_THRESHOLD = 0.08;

/** Exported for tests / debugging. */
export function layoutForHoleId(id: number): LayoutId {
  return LAYOUTS[(id - 1) % LAYOUTS.length];
}
